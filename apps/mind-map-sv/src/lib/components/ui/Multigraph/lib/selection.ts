/**
 * The pure half of selecting nodes and moving them through the clipboard:
 * which nodes a box on screen takes, what part of the graph a copy carries,
 * where a paste lands, and which edges a held selection leaves slack.
 *
 * A copy is the induced subgraph — the chosen nodes and only the edges between
 * them — because that is the shape `importGraphData` can fold back in without
 * inventing an endpoint. Everything else a copy carries (tag colours, layout
 * factors, asset metadata, pin stamps) is cut down to what those nodes and
 * edges actually use, so pasting into another document brings no settings the
 * reader never saw on the nodes they copied. The edges that left the chosen
 * nodes travel beside it, for a paste back into the same document to rebuild.
 */

import { withSeededComponentPins } from '$lib/migrations';
import type { EdgeData } from '../../types/edge';
import type { MultigraphData, Point, TagPhysicsConfig } from '../../types/multigraph';
import type { NodeData } from '../../types/node';
import { isDerivedEdgeId } from './derivedEdges';
import { addEdge, referencedAssetIds } from './graph';
import { boundsOf } from './graphImport';
import { nodeScreenCircle, type NodeFocusCandidate, type ViewTransform } from './nodeFocus';
import type { EdgeEndpointIds } from './physics';
import type { StageRect } from './stageCoordinates';

type SelectionContainment = 'intersect' | 'center' | 'enclose';

/**
 * Any overlap takes the node: the owner's ruling, over centre-inside
 * (docs/ui-decisions/2026-10-18--pointer--a-selection-box-takes-any-node-it-overlaps.md).
 */
const DEFAULT_CONTAINMENT: SelectionContainment = 'intersect';

/**
 * The ids of the candidates a selection box takes, in candidate order.
 *
 * `rect` and `stageRect` are both in client pixels, and `rect` is already
 * normalised (non-negative width and height) — the Stage reports it that way.
 * The test is made against each node's on-screen circle, so a node drawn large
 * at a deep zoom is as easy to catch as it looks:
 *
 * - `'intersect'`: the circle overlaps the box at all, touching included.
 * - `'center'`: the circle's centre is inside the box.
 * - `'enclose'`: the whole circle is inside the box.
 */
export function nodeIdsInScreenRect(
	candidates: readonly NodeFocusCandidate[],
	rect: StageRect,
	stageRect: StageRect,
	view: ViewTransform,
	options: { containment?: SelectionContainment } = {}
): string[] {
	const containment = options.containment ?? DEFAULT_CONTAINMENT;
	const right = rect.left + rect.width;
	const bottom = rect.top + rect.height;

	const ids: string[] = [];
	for (const candidate of candidates) {
		const { center, radius } = nodeScreenCircle(
			candidate.node.id,
			candidate.position,
			candidate.radius,
			stageRect,
			view
		);

		let taken: boolean;
		if (containment === 'center') {
			taken =
				center.x >= rect.left && center.x <= right && center.y >= rect.top && center.y <= bottom;
		} else if (containment === 'enclose') {
			taken =
				center.x - radius >= rect.left &&
				center.x + radius <= right &&
				center.y - radius >= rect.top &&
				center.y + radius <= bottom;
		} else {
			// The circle meets the box exactly when the box's nearest point to the
			// centre is within one radius of it — which also covers a box that sits
			// wholly inside the circle, where a corner test would miss.
			const nearestX = Math.min(Math.max(center.x, rect.left), right);
			const nearestY = Math.min(Math.max(center.y, rect.top), bottom);
			taken = Math.hypot(center.x - nearestX, center.y - nearestY) <= radius;
		}

		if (taken) ids.push(candidate.node.id);
	}
	return ids;
}

/**
 * The part of `data` a copy of `nodeIds` carries, as a graph of its own.
 *
 * - Nodes keep `data.nodes` order; an id in the set with no node behind it is
 *   ignored.
 * - Edges are the ones with both ends kept. Derived edges never are: they are
 *   recomputed from the quantity index, and a copied one would arrive as an
 *   authored edge.
 * - Tag colours and layout factors are those of tags a kept node or edge
 *   carries; `tagPhysicsConfig` stays absent when none survive, as it is in a
 *   graph nobody tuned.
 * - Asset metadata is that of the assets the kept nodes reference.
 * - `weightConfig` comes whole, since it names what every weight means.
 * - `pinSequence` is the highest pin stamp among the kept nodes, so the copy
 *   does not claim pins it no longer holds.
 * - An `!ai` output binding to a node left behind is dropped, as `removeNode`
 *   drops one to a deleted node.
 *
 * Neither argument is mutated. Kept nodes and edges are the same objects as in
 * `data`, except a node that lost a binding.
 */
export function inducedSubgraph(
	data: MultigraphData,
	nodeIds: ReadonlySet<string>
): MultigraphData {
	const keptNodes = data.nodes.filter((node) => nodeIds.has(node.id));
	// The ids actually present, so a binding to an id that was asked for but
	// names no node is dropped too.
	const keptIds = new Set(keptNodes.map((node) => node.id));
	const nodes = keptNodes.map((node) => withPromotedBindingsWithin(node, keptIds));

	const edges = data.edges.filter(
		(edge) =>
			!isDerivedEdgeId(edge.id) && keptIds.has(edge.sourceNodeId) && keptIds.has(edge.targetNodeId)
	);

	const posByNodeId: Record<string, Point> = {};
	for (const node of nodes) {
		if (Object.prototype.hasOwnProperty.call(data.posByNodeId, node.id)) {
			posByNodeId[node.id] = data.posByNodeId[node.id];
		}
	}

	const nodeTags = tagsCarried(nodes);
	const edgeTags = tagsCarried(edges);

	const subgraph: MultigraphData = {
		nodes,
		edges,
		posByNodeId,
		tagColorConfig: {
			nodeTags: entriesFor(data.tagColorConfig.nodeTags, nodeTags),
			edgeTags: entriesFor(data.tagColorConfig.edgeTags, edgeTags)
		}
	};

	const tagPhysicsConfig = tagPhysicsConfigFor(data.tagPhysicsConfig, nodeTags, edgeTags);
	if (tagPhysicsConfig !== undefined) subgraph.tagPhysicsConfig = tagPhysicsConfig;

	if (data.weightConfig !== undefined) subgraph.weightConfig = data.weightConfig;

	if (data.assets !== undefined) {
		subgraph.assets = entriesFor(data.assets, referencedAssetIds(subgraph));
	}

	const pinSequence = highestPinStamp(nodes);
	if (pinSequence !== undefined) subgraph.pinSequence = pinSequence;

	return subgraph;
}

/**
 * The edges of `data` that cross the boundary of `nodeIds`: exactly one end in
 * the set, the other outside it. In `data.edges` order, and the edge objects
 * themselves, untouched. Derived edges are left out, as `inducedSubgraph`
 * leaves them out: the maths recomputes them wherever the nodes land.
 *
 * What a copy carries beside its induced subgraph, so a paste into the same
 * document can reconnect the copies to the nodes left behind
 * (`docs/ui-decisions/2026-10-19--editing--a-paste-into-the-same-document-reconnects-the-copies-to-their-outside-neighbours.md`).
 */
export function boundaryEdgesOf(data: MultigraphData, nodeIds: ReadonlySet<string>): EdgeData[] {
	return data.edges.filter(
		(edge) =>
			!isDerivedEdgeId(edge.id) && nodeIds.has(edge.sourceNodeId) !== nodeIds.has(edge.targetNodeId)
	);
}

/**
 * `edges` with every edge that crosses the boundary of `heldNodeIds` — exactly
 * one end held — set to pull with no force (`springFactor: 0`), so a held
 * selection neither drags the rest of the graph toward it nor is dragged; the
 * nodes on both sides still repel by hops, which reads the edges and not their
 * factors
 * (`docs/ui-decisions/2026-10-19--layout--a-selection-holds-still-and-its-boundary-edges-go-slack.md`).
 *
 * Every kind of edge alike, derived ones included: a layout graph's edges are
 * all springs, whoever composed them. An edge with both ends held or neither
 * is the same object; and when none crosses — an empty set included — the
 * very same array comes back, because this runs on every relax frame and the
 * caller tells "nothing changed" by identity. Only a layout graph should ever
 * carry the result: `springFactor` is layout tuning, and persistence drops it.
 */
export function slackenBoundaryEdges<Edge extends EdgeEndpointIds>(
	edges: Edge[],
	heldNodeIds: ReadonlySet<string>
): Edge[] {
	if (heldNodeIds.size === 0) return edges;

	let changed = false;
	const slackened = edges.map((edge) => {
		if (heldNodeIds.has(edge.sourceNodeId) === heldNodeIds.has(edge.targetNodeId)) return edge;
		changed = true;
		return { ...edge, springFactor: 0 };
	});
	return changed ? slackened : edges;
}

/**
 * `host` — a graph a paste has just been folded into — with each boundary edge
 * rebuilt between the pasted copy of its inside end and the original node at
 * its outside end, plus the ids those new edges were given, in order.
 *
 * `nodeIdMap` is the paste's own (copied id → pasted id). An edge is rebuilt
 * when exactly one end is in that map and the other names a node `host` held
 * before the paste; otherwise it is skipped, because its outside node is gone
 * or the edge did not leave this copy. A pasted node is never taken for the
 * outside end, even when it was minted the id the outside node once had. The
 * new edge gets a fresh id and keeps the original's direction and tags.
 *
 * Only for a paste into the document the copy came from: anywhere else an
 * outside id names whatever node happens to have it.
 */
export function reconnectBoundaryEdges(
	host: MultigraphData,
	boundaryEdges: readonly EdgeData[],
	nodeIdMap: ReadonlyMap<string, string>
): { next: MultigraphData; edgeIds: string[] } {
	const pastedIds = new Set(nodeIdMap.values());
	const hostIds = new Set(host.nodes.map((node) => node.id));
	let next = host;
	const edgeIds: string[] = [];

	for (const edge of boundaryEdges) {
		const pastedSource = nodeIdMap.get(edge.sourceNodeId);
		const pastedTarget = nodeIdMap.get(edge.targetNodeId);
		if ((pastedSource === undefined) === (pastedTarget === undefined)) continue;
		const outsideId = pastedSource === undefined ? edge.sourceNodeId : edge.targetNodeId;
		if (!hostIds.has(outsideId) || pastedIds.has(outsideId)) continue;

		const reconnected = addEdge(
			next,
			pastedSource ?? edge.sourceNodeId,
			pastedTarget ?? edge.targetNodeId,
			{ tags: edge.tags, directed: edge.directed }
		);
		// Both ends were checked above, so this always adds; the guard keeps a
		// refusal from reporting someone else's edge as the new one.
		if (reconnected === next) continue;
		next = reconnected;
		edgeIds.push(reconnected.edges[reconnected.edges.length - 1].id);
	}

	return { next, edgeIds };
}

/**
 * The translation that centres `incoming`'s bounding box on `anchor`, both in
 * graph coordinates. One translation for the whole graph, so the copied layout
 * arrives as it was arranged. A graph with no nodes has nothing to move.
 */
export function pastePlacement(incoming: MultigraphData, anchor: Point): Point {
	const bounds = boundsOf(incoming);
	if (bounds === undefined) return { x: 0, y: 0 };

	return {
		x: anchor.x - (bounds.minX + bounds.maxX) / 2,
		y: anchor.y - (bounds.minY + bounds.maxY) / 2
	};
}

/**
 * `incoming` with each component's beacon pinned when nothing in it is pinned,
 * else `incoming` itself.
 *
 * A pasted component with no pin collapses to its single beacon under the
 * bounded-neighbourhood rule, so the reader would paste three nodes and see
 * one. This is the rule a load applies, applied to what arrives by paste.
 */
export function withSeededPinIfPinless(incoming: MultigraphData): MultigraphData {
	return withSeededComponentPins(incoming);
}

/** The node with every `!ai` binding to a node outside `keptIds` dropped. Same object when there is none. */
function withPromotedBindingsWithin(node: NodeData, keptIds: ReadonlySet<string>): NodeData {
	const ai = node.addons?.ai;
	if (ai === undefined) return node;

	const entries = Object.entries(ai.promoted).filter(([, nodeId]) => keptIds.has(nodeId));
	if (entries.length === Object.keys(ai.promoted).length) return node;

	return {
		...node,
		addons: { ...node.addons, ai: { ...ai, promoted: Object.fromEntries(entries) } }
	};
}

function tagsCarried(elements: readonly (NodeData | EdgeData)[]): Set<string> {
	const tags = new Set<string>();
	for (const element of elements) {
		for (const tag of element.tags) tags.add(tag);
	}
	return tags;
}

/** The entries of `record` whose key is in `keys`, in `record`'s order. */
function entriesFor<T>(
	record: Readonly<Record<string, T>>,
	keys: ReadonlySet<string>
): Record<string, T> {
	return Object.fromEntries(Object.entries(record).filter(([key]) => keys.has(key)));
}

function tagPhysicsConfigFor(
	config: TagPhysicsConfig | undefined,
	nodeTags: ReadonlySet<string>,
	edgeTags: ReadonlySet<string>
): TagPhysicsConfig | undefined {
	if (config === undefined) return undefined;

	const filtered: TagPhysicsConfig = {
		nodeTags: entriesFor(config.nodeTags, nodeTags),
		edgeTags: entriesFor(config.edgeTags, edgeTags)
	};
	const empty =
		Object.keys(filtered.nodeTags).length === 0 && Object.keys(filtered.edgeTags).length === 0;
	return empty ? undefined : filtered;
}

function highestPinStamp(nodes: readonly NodeData[]): number | undefined {
	let highest: number | undefined;
	for (const node of nodes) {
		if (node.lastPinnedSeq === undefined) continue;
		if (highest === undefined || node.lastPinnedSeq > highest) highest = node.lastPinnedSeq;
	}
	return highest;
}
