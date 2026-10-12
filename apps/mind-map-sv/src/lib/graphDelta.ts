/**
 * The difference between two states of one document, small enough to serialize.
 *
 * In memory a history entry is a whole graph, and that is cheap: the house
 * immutability rule means every collection an edit did not touch is shared with
 * the entry beside it, so a "snapshot" retains one new array per collection the
 * edit rewrote and nothing else. `JSON.stringify` destroys exactly that — a
 * serialized snapshot *is* a deep copy — so K persisted entries would be K full
 * graphs in a draft already policed by a storage quota. Hence deltas at the
 * boundary, snapshots in memory.
 *
 * Computing one is cheap for the same reason the O(1) identity test works: a
 * reference-identity walk finds exactly what changed, in O(N) comparisons
 * producing O(changed) output, with no deep equality anywhere.
 *
 * Deliberately not a general diff. It carries no `posByNodeId`, because whole
 * position maps are what the format exists to avoid — only the positions of
 * nodes the target has and the source does not, so a resurrected node lands
 * where it was standing rather than at the origin. Everything else keeps
 * whatever position the canvas has now.
 */

import type { EdgeData } from './components/ui/types/edge';
import type {
	GraphAssetMetadata,
	MultigraphData,
	Point,
	TagColorConfig,
	TagPhysicsConfig,
	WeightConfig
} from './components/ui/types/multigraph';
import type { NodeData } from './components/ui/types/node';

/**
 * What happened to one collection.
 *
 * `added` carries the index each element sits at in the target, so applying the
 * delta reproduces the target's order rather than appending resurrected elements
 * at the end — where they would quietly change which node is `nodes[0]`, and so
 * which node a primary election falls back to.
 */
type ElementDelta<TElement> = {
	added: Array<{ index: number; element: TElement }>;
	removed: string[];
	changed: TElement[];
};

/**
 * A step from one state of a document to another.
 *
 * The graph-level fields appear only when they changed, and `null` is how the
 * format says "the target does not have this one at all" — `tagPhysicsConfig`,
 * `weightConfig`, `assets` and `pinSequence` are optional on `MultigraphData`, and a delta that could only
 * say "unchanged" or "here is a value" could never take one away.
 */
export type GraphDelta = {
	nodes: ElementDelta<NodeData>;
	edges: ElementDelta<EdgeData>;
	tagColorConfig?: TagColorConfig;
	tagPhysicsConfig?: TagPhysicsConfig | null;
	weightConfig?: WeightConfig | null;
	assets?: Record<string, GraphAssetMetadata> | null;
	pinSequence?: number | null;
	removedPositions: Record<string, Point>;
};

/** The step from `from` to `to`, found by comparing element references. */
export function diffByReference(from: MultigraphData, to: MultigraphData): GraphDelta {
	const delta: GraphDelta = {
		nodes: elementDelta(from.nodes, to.nodes),
		edges: elementDelta(from.edges, to.edges),
		removedPositions: positionsOnlyIn(to, from)
	};

	if (from.tagColorConfig !== to.tagColorConfig) delta.tagColorConfig = to.tagColorConfig;
	if (from.tagPhysicsConfig !== to.tagPhysicsConfig) {
		delta.tagPhysicsConfig = to.tagPhysicsConfig ?? null;
	}
	// An import can add a weight label, and undoing it must take the label away.
	if (from.weightConfig !== to.weightConfig) delta.weightConfig = to.weightConfig ?? null;
	if (from.assets !== to.assets) delta.assets = to.assets ?? null;
	if (from.pinSequence !== to.pinSequence) delta.pinSequence = to.pinSequence ?? null;

	return delta;
}

/** Apply a delta produced by `diffByReference(graph, target)`, reproducing `target`. */
export function applyDelta(graph: MultigraphData, delta: GraphDelta): MultigraphData {
	const nodes = applyElementDelta(graph.nodes, delta.nodes);
	const edges = applyElementDelta(graph.edges, delta.edges);
	const liveNodeIds = new Set(nodes.map((node) => node.id));

	const posByNodeId: Record<string, Point> = {};
	for (const nodeId of Object.keys(graph.posByNodeId)) {
		if (liveNodeIds.has(nodeId)) posByNodeId[nodeId] = graph.posByNodeId[nodeId];
	}
	for (const [nodeId, position] of Object.entries(delta.removedPositions)) {
		if (liveNodeIds.has(nodeId)) posByNodeId[nodeId] = position;
	}

	const next: MultigraphData = {
		...graph,
		nodes,
		edges,
		posByNodeId,
		tagColorConfig: delta.tagColorConfig ?? graph.tagColorConfig
	};

	if (delta.tagPhysicsConfig !== undefined) {
		if (delta.tagPhysicsConfig === null) delete next.tagPhysicsConfig;
		else next.tagPhysicsConfig = delta.tagPhysicsConfig;
	}
	if (delta.weightConfig !== undefined) {
		if (delta.weightConfig === null) delete next.weightConfig;
		else next.weightConfig = delta.weightConfig;
	}
	if (delta.assets !== undefined) {
		if (delta.assets === null) delete next.assets;
		else next.assets = delta.assets;
	}
	if (delta.pinSequence !== undefined) {
		if (delta.pinSequence === null) delete next.pinSequence;
		else next.pinSequence = delta.pinSequence;
	}

	return next;
}

/**
 * Whether `delta` describes a step out of *this* graph.
 *
 * Two tabs on the same graph already race on the draft, and the loser's tail
 * describes a graph the draft no longer holds. Applying such a delta throws
 * nothing — filters and splices are happy to do the wrong thing — so the rebuild
 * asks first, and treats "does not apply" as drop-the-tail rather than as an
 * error, exactly as an opened file starts with no history at all.
 */
export function deltaApplies(graph: MultigraphData, delta: GraphDelta): boolean {
	const nodeIds = new Set(graph.nodes.map((node) => node.id));
	const edgeIds = new Set(graph.edges.map((edge) => edge.id));
	return (
		delta.nodes.removed.every((id) => nodeIds.has(id)) &&
		delta.nodes.changed.every((node) => nodeIds.has(node.id)) &&
		delta.nodes.added.every(({ element }) => !nodeIds.has(element.id)) &&
		delta.edges.removed.every((id) => edgeIds.has(id)) &&
		delta.edges.changed.every((edge) => edgeIds.has(edge.id)) &&
		delta.edges.added.every(({ element }) => !edgeIds.has(element.id))
	);
}

/** True when a delta describes no change at all — every layout-only commit. */
export function isEmptyDelta(delta: GraphDelta): boolean {
	return (
		delta.nodes.added.length === 0 &&
		delta.nodes.removed.length === 0 &&
		delta.nodes.changed.length === 0 &&
		delta.edges.added.length === 0 &&
		delta.edges.removed.length === 0 &&
		delta.edges.changed.length === 0 &&
		delta.tagColorConfig === undefined &&
		delta.tagPhysicsConfig === undefined &&
		delta.weightConfig === undefined &&
		delta.assets === undefined &&
		delta.pinSequence === undefined
	);
}

function elementDelta<TElement extends { id: string }>(
	from: readonly TElement[],
	to: readonly TElement[]
): ElementDelta<TElement> {
	const fromById = new Map(from.map((element) => [element.id, element]));
	const toIds = new Set(to.map((element) => element.id));

	const added: Array<{ index: number; element: TElement }> = [];
	const changed: TElement[] = [];
	to.forEach((element, index) => {
		const previous = fromById.get(element.id);
		if (previous === undefined) added.push({ index, element });
		else if (previous !== element) changed.push(element);
	});

	return {
		added,
		removed: from.filter((element) => !toIds.has(element.id)).map((element) => element.id),
		changed
	};
}

/**
 * Rebuild the target collection: drop what went, swap what changed, and splice
 * what arrived back at the index it occupied.
 *
 * Splicing rather than appending is what preserves order. Every mutation in
 * `graph.ts` maps, filters or appends, so elements common to both collections
 * keep their relative order — put the arrivals back at their recorded indices,
 * in ascending order, and the result is the target's order exactly.
 */
function applyElementDelta<TElement extends { id: string }>(
	current: readonly TElement[],
	delta: ElementDelta<TElement>
): TElement[] {
	const removed = new Set(delta.removed);
	const changedById = new Map(delta.changed.map((element) => [element.id, element]));
	const next = current
		.filter((element) => !removed.has(element.id))
		.map((element) => changedById.get(element.id) ?? element);

	for (const { index, element } of [...delta.added].sort(
		(left, right) => left.index - right.index
	)) {
		next.splice(Math.min(index, next.length), 0, element);
	}

	return next;
}

/** Positions `source` records for the nodes `other` no longer has. */
function positionsOnlyIn(source: MultigraphData, other: MultigraphData): Record<string, Point> {
	const otherIds = new Set(other.nodes.map((node) => node.id));
	const positions: Record<string, Point> = {};
	for (const node of source.nodes) {
		if (otherIds.has(node.id)) continue;
		const position = source.posByNodeId[node.id];
		if (position !== undefined) positions[node.id] = position;
	}
	return positions;
}
