import type { MultigraphData } from '../../types/multigraph';
import type { LayoutSettings } from './layoutSettings';
import { withDefaultLayoutSettings } from './layoutSettings';

export function hopsFromPinned(data: MultigraphData): Record<string, number> {
	const hops = Object.fromEntries(data.nodes.map((node) => [node.id, Infinity]));
	const adjacency = buildAdjacency(data);
	const queue: string[] = [];

	for (const node of data.nodes) {
		if (node.pinned) {
			hops[node.id] = 0;
			queue.push(node.id);
		}
	}

	for (let index = 0; index < queue.length; index += 1) {
		const nodeId = queue[index];
		const nextHop = hops[nodeId] + 1;

		for (const neighborId of adjacency[nodeId] ?? []) {
			if (nextHop < hops[neighborId]) {
				hops[neighborId] = nextHop;
				queue.push(neighborId);
			}
		}
	}

	return hops;
}

export function scaleByHops(
	hops: Record<string, number>,
	settings: Partial<LayoutSettings> = {}
): Record<string, number> {
	const resolvedSettings = withDefaultLayoutSettings(settings);

	return Object.fromEntries(
		Object.entries(hops).map(([nodeId, hopCount]) => [
			nodeId,
			Number.isFinite(hopCount)
				? Math.max(resolvedSettings.minScale, resolvedSettings.scaleFalloff ** hopCount)
				: resolvedSettings.minScale
		])
	);
}

export function radiusOf(
	scales: Record<string, number>,
	settings: Partial<LayoutSettings>,
	nodeId: string
): number {
	const resolvedSettings = withDefaultLayoutSettings(settings);
	return resolvedSettings.baseRadius * (scales[nodeId] ?? resolvedSettings.minScale);
}

function buildAdjacency(data: MultigraphData): Record<string, string[]> {
	const adjacency = Object.fromEntries(data.nodes.map((node) => [node.id, [] as string[]]));

	for (const edge of data.edges) {
		if (!adjacency[edge.sourceNodeId] || !adjacency[edge.targetNodeId]) continue;
		adjacency[edge.sourceNodeId].push(edge.targetNodeId);
		adjacency[edge.targetNodeId].push(edge.sourceNodeId);
	}

	return adjacency;
}
