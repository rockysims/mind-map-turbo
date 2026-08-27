import type { MultigraphData } from '../../types/multigraph';
import type { NodeData } from '../../types/node';
import { buildAdjacency } from './layout';

/**
 * Beacons keep pinless connected components reachable: instead of the whole
 * component disappearing from the pinned-neighborhood visibility rule, exactly
 * one node per pinless component stays visible, rendered as if it were
 * BEACON_HOP hops from a pinned node. Its edges all lead to hidden nodes, so
 * they render as the usual fading boundary half-edges.
 */
export const BEACON_HOP = 1;

export interface BeaconOptions {
	/**
	 * Session-transient hint (e.g. the endpoints of a just-removed edge),
	 * consulted only when a pinless component has no pin history at all.
	 * Array order is preference order.
	 */
	preferredNodeIds?: readonly string[];
}

/**
 * Picks one beacon node per connected component that contains no pinned node.
 * Selection priority within such a component:
 *   1. highest pin recency (`lastPinnedSeq`),
 *   2. the first `preferredNodeIds` entry inside the component,
 *   3. highest distinct-neighbor degree, tie-broken by lowest node id.
 *
 * Applied to an already-visible subgraph this is idempotent: each beacon is
 * the sole (pinless) member of its component there and picks itself, and every
 * other visible component contains a pinned node.
 */
export function beaconNodeIds(data: MultigraphData, options: BeaconOptions = {}): Set<string> {
	const adjacency = buildAdjacency(data);
	const nodeById = new Map(data.nodes.map((node) => [node.id, node]));
	const preferenceRank = new Map(
		(options.preferredNodeIds ?? []).map((nodeId, index) => [nodeId, index])
	);
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

		beacons.add(selectBeacon(componentNodes, adjacency, preferenceRank));
	}

	return beacons;
}

/** Layout hop overrides (see GraphLayoutOptions) mapping each beacon to BEACON_HOP. */
export function beaconHopOverrides(beaconIds: ReadonlySet<string>): Record<string, number> {
	return Object.fromEntries([...beaconIds].map((beaconId) => [beaconId, BEACON_HOP]));
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
	adjacency: Record<string, string[]>,
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

	const degreeOf = (node: NodeData): number => new Set(adjacency[node.id] ?? []).size;
	return componentNodes.reduce((best, node) => {
		const nodeDegree = degreeOf(node);
		const bestDegree = degreeOf(best);
		if (nodeDegree !== bestDegree) return nodeDegree > bestDegree ? node : best;
		return node.id < best.id ? node : best;
	}).id;
}
