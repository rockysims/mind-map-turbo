import type { EdgeData } from '../../types/edge';
import type { MultigraphData } from '../../types/multigraph';
import type { NodeData } from '../../types/node';
import { buildAdjacency } from './layout';

/**
 * Beacons keep pinless connected components reachable: instead of the whole
 * component disappearing from the pinned-neighborhood visibility rule, exactly
 * one node per pinless component stays visible, rendered as if it were
 * BEACON_HOP hops from a pinned node. Its edges lead to hidden nodes, so they
 * render as the usual fading boundary half-edges — except a self-loop, whose
 * endpoints are both the (visible) beacon, so it classifies as a full visible
 * edge. Self-loops cannot be drawn in the UI but can arrive in externally
 * written JSON; they render at zero length, so the difference is invisible.
 */
export const BEACON_HOP = 1;

interface BeaconOptions {
	/**
	 * Session-transient hint (e.g. the endpoints of a just-removed edge),
	 * consulted only when a pinless component has no pin history at all.
	 * Array order is preference order.
	 */
	preferredNodeIds?: readonly string[];
}

/**
 * Picks one beacon node per **authored** connected component that contains no
 * pinned node.
 *
 * Deliberately blind to derived edges: two clusters an equation ties together
 * each keep their own anchor, so a cluster cannot mostly vanish — represented
 * only by whatever the derived budget reveals — because someone wrote an
 * equation about one of its nodes.
 *
 * Selection priority within such a component:
 *   1. highest pin recency (`lastPinnedSeq`),
 *   2. the first `preferredNodeIds` entry inside the component,
 *   3. highest distinct-neighbor degree, tie-broken by lowest node id.
 *
 * An edge-less node is its own component, so it is always its own beacon and
 * therefore always visible.
 *
 * Results are memoized (see `beaconCache`), so the returned set is shared and
 * must not be mutated.
 */
export function beaconNodeIds(
	data: MultigraphData,
	options: BeaconOptions = {}
): ReadonlySet<string> {
	const preferredNodeIds = options.preferredNodeIds;
	const cached = beaconCache.find(
		(entry) =>
			entry.nodes === data.nodes &&
			entry.edges === data.edges &&
			entry.preferredNodeIds === preferredNodeIds
	);
	if (cached) return cached.beaconIds;

	const beaconIds = computeBeaconNodeIds(data, preferredNodeIds);
	beaconCache.unshift({
		nodes: data.nodes,
		edges: data.edges,
		preferredNodeIds,
		beaconIds
	});
	beaconCache.length = Math.min(beaconCache.length, BEACON_CACHE_LIMIT);

	return beaconIds;
}

function computeBeaconNodeIds(
	data: MultigraphData,
	preferredNodeIds: readonly string[] | undefined
): ReadonlySet<string> {
	const adjacency = buildAdjacency(data);
	const degreeByNodeId = distinctDegrees(adjacency);
	const nodeById = new Map(data.nodes.map((node) => [node.id, node]));
	const preferenceRank = new Map((preferredNodeIds ?? []).map((nodeId, index) => [nodeId, index]));
	const beacons = new Set<string>();
	const visited = new Set<string>();

	for (const startNode of data.nodes) {
		if (visited.has(startNode.id)) continue;

		const componentNodes: NodeData[] = [];
		const queue = [startNode.id];
		visited.add(startNode.id);
		let hasPinned = false;

		for (let index = 0; index < queue.length; index += 1) {
			const node = nodeById.get(queue[index]);
			if (!node) continue;
			componentNodes.push(node);
			if (node.pinned) hasPinned = true;

			for (const neighborId of adjacency[node.id] ?? []) {
				if (!visited.has(neighborId)) {
					visited.add(neighborId);
					queue.push(neighborId);
				}
			}
		}

		if (hasPinned) continue;

		beacons.add(selectBeacon(componentNodes, degreeByNodeId, preferenceRank));
	}

	return beacons;
}

/**
 * Returns hops with each beacon overridden to BEACON_HOP. Deliberately no BFS
 * from beacons: their neighbors stay at Infinity, so only the beacon itself
 * passes the displayed-layers visibility filter.
 */
export function withBeaconHops(
	hops: Record<string, number>,
	beaconIds: ReadonlySet<string>
): Record<string, number> {
	if (beaconIds.size === 0) return hops;

	const nextHops = { ...hops };
	for (const beaconId of beaconIds) {
		if (beaconId in nextHops) nextHops[beaconId] = BEACON_HOP;
	}
	return nextHops;
}

function selectBeacon(
	componentNodes: NodeData[],
	degreeByNodeId: ReadonlyMap<string, number>,
	preferenceRank: ReadonlyMap<string, number>
): string {
	const byRecency = componentNodes.filter((node) => node.lastPinnedSeq !== undefined);
	if (byRecency.length > 0) {
		return byRecency.reduce((best, node) =>
			(node.lastPinnedSeq ?? 0) > (best.lastPinnedSeq ?? 0) ? node : best
		).id;
	}

	const preferred = componentNodes
		.filter((node) => preferenceRank.has(node.id))
		.sort((a, b) => (preferenceRank.get(a.id) ?? 0) - (preferenceRank.get(b.id) ?? 0));
	if (preferred.length > 0) return preferred[0].id;

	return componentNodes.reduce((best, node) => {
		const nodeDegree = degreeByNodeId.get(node.id) ?? 0;
		const bestDegree = degreeByNodeId.get(best.id) ?? 0;
		if (nodeDegree !== bestDegree) return nodeDegree > bestDegree ? node : best;
		return node.id < best.id ? node : best;
	}).id;
}

/**
 * Distinct-neighbor degree for every node, in O(V + E). Parallel edges collapse
 * to one; a self-loop lists the node as its own neighbor and so counts as 1.
 */
function distinctDegrees(adjacency: Record<string, string[]>): ReadonlyMap<string, number> {
	const degreeByNodeId = new Map<string, number>();
	const neighbors = new Set<string>();

	for (const [nodeId, neighborIds] of Object.entries(adjacency)) {
		neighbors.clear();
		for (const neighborId of neighborIds) neighbors.add(neighborId);
		degreeByNodeId.set(nodeId, neighbors.size);
	}

	return degreeByNodeId;
}

interface BeaconCacheEntry {
	nodes: readonly NodeData[];
	edges: readonly EdgeData[];
	preferredNodeIds: readonly string[] | undefined;
	beaconIds: ReadonlySet<string>;
}

/**
 * Beacon selection is pure in (nodes, edges, preferredNodeIds) and runs several
 * times per animation frame on the same inputs (layout-runtime step, layout
 * options, and the component's derived beacon set), so results are memoized on
 * those references. Graph mutations always rebuild the nodes/edges arrays, so
 * reference identity is a sound key; the few entries cover one frame's calls.
 */
const BEACON_CACHE_LIMIT = 4;
const beaconCache: BeaconCacheEntry[] = [];
