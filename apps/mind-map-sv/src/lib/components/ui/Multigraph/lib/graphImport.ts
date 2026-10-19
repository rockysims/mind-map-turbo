/**
 * Fold one graph's contents into another as a separate component.
 *
 * Ids are per-graph sequential (`n0`, `e0` from `nextId`) and every graph starts
 * with `n0`, so a collision between two documents is guaranteed, not likely.
 * Nothing validates id uniqueness on load either, so a naive concat corrupts
 * silently — every incoming id is therefore reminted against the host's used
 * ids, and the map is applied to node ids, edge endpoints, and position keys in
 * one pass.
 *
 * Purely additive: nothing in the host is dropped, rewritten, or merged. Node
 * merging is a separate, deliberate gesture.
 *
 * Import… and paste both come through here; the only difference between them
 * is where the incoming component lands, which is why the offset can be given.
 */

import { APP_CONFIG } from '../../../../appConfig';
import type { EdgeData } from '../../types/edge';
import type { MultigraphData, Point, TagPhysicsConfig } from '../../types/multigraph';
import type { NodeData } from '../../types/node';
import { isDerivedEdgeId } from './derivedEdges';
import type { GraphBounds } from './graphMath';
import { nextId } from './graph';

const NODE_ID_PREFIX = 'n';
const EDGE_ID_PREFIX = 'e';

const DEFAULT_POSITION: Point = { x: 0, y: 0 };

/**
 * Clear space left between the host's right edge and the import's left edge.
 * Positions are node centers, so this is exactly the two radii of a
 * full-size pair: the components start out touching, and physics opens the
 * seam that says "this arrived separately" without carrying the import away.
 */
const IMPORT_GAP_PX = APP_CONFIG.multigraph.nodeRadiusPx * 2;

interface GraphImportResult {
	/** The host graph with the incoming graph folded in. */
	next: MultigraphData;
	/** Incoming node id → the id it was given in `next`. */
	nodeIdMap: Map<string, string>;
	/** Incoming edge id → the id it was given in `next`. Derived edges are absent. */
	edgeIdMap: Map<string, string>;
	/** Translation applied to every incoming position. */
	offset: Point;
}

interface GraphImportOptions {
	/**
	 * Translation for every incoming position, used as given. Absent, the import
	 * is parked beside the host's bounding box; a paste passes the translation
	 * that lands it on the point the reader chose.
	 */
	offset?: Point;
}

/**
 * Fold `incoming` into `host`, returning a new graph plus the id maps.
 *
 * Neither argument is mutated. Nodes and edges are shallow-copied, so the
 * result shares the immutable-by-convention arrays inside them with `incoming`.
 */
export function importGraphData(
	host: MultigraphData,
	incoming: MultigraphData,
	options: GraphImportOptions = {}
): GraphImportResult {
	const nodeIdMap = mintIds(
		NODE_ID_PREFIX,
		incoming.nodes.map((node) => node.id),
		host.nodes.map((node) => node.id)
	);

	// Derived edges are recomputed from the quantity index on every render, so
	// importing one would materialize it as an authored edge that outlives the
	// math it described.
	const incomingEdges = incoming.edges.filter((edge) => !isDerivedEdgeId(edge.id));
	const edgeIdMap = mintIds(
		EDGE_ID_PREFIX,
		incomingEdges.map((edge) => edge.id),
		host.edges.map((edge) => edge.id)
	);

	const offset =
		options.offset === undefined ? importOffset(host, incoming) : { ...options.offset };
	const pinShift = pinSequenceShift(host, incoming);

	const nodes: NodeData[] = incoming.nodes.map((source) => {
		const id = nodeIdMap.get(source.id) as string;
		const node = withRemappedPromotedBindings(source, nodeIdMap);
		return node.lastPinnedSeq === undefined
			? { ...node, id }
			: { ...node, id, lastPinnedSeq: node.lastPinnedSeq + pinShift };
	});

	const edges: EdgeData[] = incomingEdges.map((edge) => ({
		...edge,
		id: edgeIdMap.get(edge.id) as string,
		sourceNodeId: nodeIdMap.get(edge.sourceNodeId) ?? edge.sourceNodeId,
		targetNodeId: nodeIdMap.get(edge.targetNodeId) ?? edge.targetNodeId
	}));

	// Keyed off the node list rather than off `posByNodeId`, so an incoming node
	// with no stored position still gets one and an orphan key does not survive.
	const posByNodeId: Record<string, Point> = { ...host.posByNodeId };
	for (const node of incoming.nodes) {
		const position = incoming.posByNodeId[node.id] ?? DEFAULT_POSITION;
		posByNodeId[nodeIdMap.get(node.id) as string] = {
			x: position.x + offset.x,
			y: position.y + offset.y
		};
	}

	const assets =
		host.assets === undefined && incoming.assets === undefined
			? undefined
			: // Host last: an asset id already in the host is the host's.
				{ ...(incoming.assets ?? {}), ...(host.assets ?? {}) };

	const tagPhysicsConfig = mergedTagPhysicsConfig(host, incoming);

	// Taken whole, never merged key by key: a label and its unit belong
	// together. The host's wins; an incoming one is adopted only by a host that
	// names nothing, which relabels any weights the host already had.
	const weightConfig = host.weightConfig ?? incoming.weightConfig;

	const pinSequence = mergedPinSequence(host, incoming, nodes, pinShift);

	return {
		next: {
			...host,
			nodes: [...host.nodes, ...nodes],
			edges: [...host.edges, ...edges],
			posByNodeId,
			tagColorConfig: {
				// Host last again: a tag name the reader has already colored keeps
				// that color. Uncolored tags fall back to a deterministic hash color,
				// so nothing here is ever left without one.
				nodeTags: { ...incoming.tagColorConfig.nodeTags, ...host.tagColorConfig.nodeTags },
				edgeTags: { ...incoming.tagColorConfig.edgeTags, ...host.tagColorConfig.edgeTags }
			},
			...(tagPhysicsConfig === undefined ? {} : { tagPhysicsConfig }),
			...(weightConfig === undefined ? {} : { weightConfig }),
			...(assets === undefined ? {} : { assets }),
			...(pinSequence === undefined ? {} : { pinSequence })
		},
		nodeIdMap,
		edgeIdMap,
		offset
	};
}

/**
 * The node with every `!ai` output binding pointed at its target's minted id.
 *
 * A binding names its node by id, and incoming ids are exactly the ones that
 * collide with the host's, so a binding left alone would quietly point at
 * whichever host node happens to share the id. A binding whose target did not
 * come along has no node to point at in the result, and is dropped the way
 * `removeNode` drops a binding to a deleted node.
 */
function withRemappedPromotedBindings(node: NodeData, nodeIdMap: Map<string, string>): NodeData {
	const ai = node.addons?.ai;
	if (ai === undefined) return node;

	const promoted: Record<string, string> = {};
	for (const [outputName, targetId] of Object.entries(ai.promoted)) {
		const minted = nodeIdMap.get(targetId);
		if (minted !== undefined) promoted[outputName] = minted;
	}

	return { ...node, addons: { ...node.addons, ai: { ...ai, promoted } } };
}

/**
 * Per-tag layout factors, merged per namespace with the host last, exactly as
 * colours are: a tag the reader already tuned keeps its factor, and a tag only
 * the import tuned brings its factor along. Absent on both sides stays absent,
 * so importing into an untuned graph does not add an empty field.
 */
function mergedTagPhysicsConfig(
	host: MultigraphData,
	incoming: MultigraphData
): TagPhysicsConfig | undefined {
	if (host.tagPhysicsConfig === undefined && incoming.tagPhysicsConfig === undefined) {
		return undefined;
	}

	return {
		nodeTags: { ...incoming.tagPhysicsConfig?.nodeTags, ...host.tagPhysicsConfig?.nodeTags },
		edgeTags: { ...incoming.tagPhysicsConfig?.edgeTags, ...host.tagPhysicsConfig?.edgeTags }
	};
}

/**
 * Fresh host-style ids for every id in `incomingIds`, in order. Ids already
 * minted are fed back in, so the map is injective as well as collision-free.
 */
function mintIds(prefix: string, incomingIds: string[], hostIds: string[]): Map<string, string> {
	const usedIds = [...hostIds];
	const idMap = new Map<string, string>();

	for (const incomingId of incomingIds) {
		if (idMap.has(incomingId)) continue;
		const minted = nextId(prefix, usedIds);
		usedIds.push(minted);
		idMap.set(incomingId, minted);
	}

	return idMap;
}

/**
 * A translation that parks the incoming graph beside the host's bounding box,
 * vertically centered on it. Only the whole component moves, so the incoming
 * graph's internal geometry — and any layout the reader arranged by hand —
 * survives the trip.
 */
function importOffset(host: MultigraphData, incoming: MultigraphData): Point {
	const hostBounds = boundsOf(host);
	const incomingBounds = boundsOf(incoming);
	if (!hostBounds || !incomingBounds) return { ...DEFAULT_POSITION };

	return {
		x: hostBounds.maxX + IMPORT_GAP_PX - incomingBounds.minX,
		y: (hostBounds.minY + hostBounds.maxY) / 2 - (incomingBounds.minY + incomingBounds.maxY) / 2
	};
}

/**
 * Bounding box over node positions, or undefined when there are no nodes. A
 * node with no stored position counts at the origin, which is where the import
 * puts it too.
 */
export function boundsOf(data: MultigraphData): GraphBounds | undefined {
	if (data.nodes.length === 0) return undefined;

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;

	for (const node of data.nodes) {
		const position = data.posByNodeId[node.id] ?? DEFAULT_POSITION;
		if (position.x < minX) minX = position.x;
		if (position.x > maxX) maxX = position.x;
		if (position.y < minY) minY = position.y;
		if (position.y > maxY) maxY = position.y;
	}

	return { minX, minY, maxX, maxY };
}

/**
 * How far every incoming pin stamp moves. Pin recency elects a component's
 * beacon, so the stamps have to stay ordered among themselves *and* land past
 * everything the host has issued — otherwise an import could silently outrank,
 * or be outranked by, pins the reader made at a different time.
 */
function pinSequenceShift(host: MultigraphData, incoming: MultigraphData): number {
	const hostCeiling = pinCeiling(host);
	const lowestIncoming = lowestPinStamp(incoming);

	// With no incoming stamps there is no order to preserve, and the only thing
	// carried over is the counter itself — stack it on the host's ceiling.
	if (lowestIncoming === undefined) return hostCeiling;

	return hostCeiling + 1 - lowestIncoming;
}

/** Highest stamp the host has issued, self-healing when `pinSequence` is stale. */
function pinCeiling(data: MultigraphData): number {
	let highest = data.pinSequence ?? 0;
	for (const node of data.nodes) {
		const seq = node.lastPinnedSeq ?? 0;
		if (seq > highest) highest = seq;
	}
	return highest;
}

function lowestPinStamp(data: MultigraphData): number | undefined {
	let lowest: number | undefined;
	for (const node of data.nodes) {
		if (node.lastPinnedSeq === undefined) continue;
		if (lowest === undefined || node.lastPinnedSeq < lowest) lowest = node.lastPinnedSeq;
	}
	return lowest;
}

function mergedPinSequence(
	host: MultigraphData,
	incoming: MultigraphData,
	rebasedNodes: NodeData[],
	pinShift: number
): number | undefined {
	if (host.pinSequence === undefined && incoming.pinSequence === undefined) {
		const stamped = rebasedNodes.some((node) => node.lastPinnedSeq !== undefined);
		if (!stamped) return undefined;
	}

	let highest = pinCeiling(host);
	for (const node of rebasedNodes) {
		const seq = node.lastPinnedSeq ?? 0;
		if (seq > highest) highest = seq;
	}
	if (incoming.pinSequence !== undefined && incoming.pinSequence + pinShift > highest) {
		highest = incoming.pinSequence + pinShift;
	}

	return highest;
}
