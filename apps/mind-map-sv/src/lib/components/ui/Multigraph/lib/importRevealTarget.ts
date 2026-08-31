import type { MultigraphData } from '../../types/multigraph';
import type { NodeData } from '../../types/node';
import { buildAdjacency } from './layout';

/**
 * Node ids present in `incoming` but not in `previous`.
 *
 * The revision-adopt path fires only for external *additive* mutations, so this
 * diff names exactly what an import brought in. Order follows `incoming.nodes`,
 * which is the order the import appended them.
 */
export function arrivedNodeIds(previous: MultigraphData, incoming: MultigraphData): string[] {
	const previousIds = new Set(previous.nodes.map((node) => node.id));
	return incoming.nodes.filter((node) => !previousIds.has(node.id)).map((node) => node.id);
}

/**
 * The one node an import should be revealed by: the hub of the largest
 * newly-arrived component.
 *
 * "Hub" is read off the pins the import itself seeded. Data entering the app
 * gets one pin per pinless component — the node beacon election would pick, i.e.
 * its hub (see `withSeededComponentPins` in migrations) — so the pinned member
 * of an arrived component *is* its hub, and it is also the node the canvas is
 * guaranteed to be drawing (hop 0) once the graph is adopted.
 *
 * Ranking across the arrived components:
 *   1. largest component (most arrived nodes),
 *   2. highest pin recency (`lastPinnedSeq`),
 *   3. lowest node id — the same last-resort tie-break `beacons.ts` uses.
 *
 * Components are cut over the arrived nodes alone: an import is folded in as a
 * separate component, so an edge reaching back into the host cannot exist yet,
 * and measuring across one would let host size decide which arrival to show.
 *
 * Falls back to the first arrived node when no arrival is pinned at all — a
 * hand-written file that already carried a pin elsewhere skips the seeding pass,
 * and showing the reader *something* beats showing them nothing.
 *
 * Returns null when nothing arrived.
 */
export function importRevealTargetNodeId(
	previous: MultigraphData,
	incoming: MultigraphData
): string | null {
	const arrivedIds = new Set(arrivedNodeIds(previous, incoming));
	if (arrivedIds.size === 0) return null;

	const arrived = incoming.nodes.filter((node) => arrivedIds.has(node.id));
	// `buildAdjacency` drops any edge with an endpoint outside the node list, so
	// handing it the arrived nodes cuts the components over exactly those.
	const adjacency = buildAdjacency({ ...incoming, nodes: arrived });
	const nodeById = new Map(arrived.map((node) => [node.id, node]));

	let best: { size: number; node: NodeData } | null = null;
	const visited = new Set<string>();

	for (const startNode of arrived) {
		if (visited.has(startNode.id)) continue;

		const componentNodes: NodeData[] = [];
		const queue = [startNode.id];
		visited.add(startNode.id);

		for (let index = 0; index < queue.length; index += 1) {
			const node = nodeById.get(queue[index]);
			if (!node) continue;
			componentNodes.push(node);
			for (const neighborId of adjacency[node.id] ?? []) {
				if (visited.has(neighborId)) continue;
				visited.add(neighborId);
				queue.push(neighborId);
			}
		}

		const hub = selectHub(componentNodes);
		if (!hub) continue;
		if (best === null || outranks(componentNodes.length, hub, best.size, best.node)) {
			best = { size: componentNodes.length, node: hub };
		}
	}

	return best?.node.id ?? arrived[0].id;
}

/** The pinned member of a component, by pin recency then lowest id. Null when none is pinned. */
function selectHub(componentNodes: readonly NodeData[]): NodeData | null {
	let hub: NodeData | null = null;
	for (const node of componentNodes) {
		if (node.pinned !== true) continue;
		if (hub === null || outranksByPin(node, hub)) hub = node;
	}
	return hub;
}

function outranks(size: number, node: NodeData, bestSize: number, bestNode: NodeData): boolean {
	if (size !== bestSize) return size > bestSize;
	return outranksByPin(node, bestNode);
}

function outranksByPin(node: NodeData, best: NodeData): boolean {
	const seq = node.lastPinnedSeq ?? Number.NEGATIVE_INFINITY;
	const bestSeq = best.lastPinnedSeq ?? Number.NEGATIVE_INFINITY;
	if (seq !== bestSeq) return seq > bestSeq;
	return node.id < best.id;
}
