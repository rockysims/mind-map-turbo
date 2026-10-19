/**
 * The pure half of selecting nodes and moving them through the clipboard:
 * which nodes a box on screen takes, what part of the graph a copy carries,
 * and where a paste lands.
 *
 * A copy is the induced subgraph — the chosen nodes and only the edges between
 * them — because that is the shape `importGraphData` can fold back in without
 * inventing an endpoint. Everything else a copy carries (tag colours, layout
 * factors, asset metadata, pin stamps) is cut down to what those nodes and
 * edges actually use, so pasting into another document brings no settings the
 * reader never saw on the nodes they copied.
 */

import { withSeededComponentPins } from '$lib/migrations';
import type { EdgeData } from '../../types/edge';
import type { MultigraphData, Point, TagPhysicsConfig } from '../../types/multigraph';
import type { NodeData } from '../../types/node';
import { isDerivedEdgeId } from './derivedEdges';
import { referencedAssetIds } from './graph';
import { boundsOf } from './graphImport';
import { nodeScreenCircle, type NodeFocusCandidate, type ViewTransform } from './nodeFocus';
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
