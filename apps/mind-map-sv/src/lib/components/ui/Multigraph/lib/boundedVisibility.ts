import type { EdgeData } from '../../types/edge';
import type { MultigraphData } from '../../types/multigraph';

export const DEFAULT_DISPLAYED_LAYERS = 10;
export const DEFAULT_BOUNDARY_FADE_RATIO = 0.5;

export type EdgeVisibility =
	| {
			kind: 'visible';
			edge: EdgeData;
	  }
	| {
			kind: 'boundary';
			edge: EdgeData;
			visibleNodeId: string;
			hiddenNodeId: string;
			visibleEndpoint: 'source' | 'target';
			hiddenEndpoint: 'source' | 'target';
			fadeRatio: number;
	  }
	| {
			kind: 'hidden';
			edge: EdgeData;
	  };

export interface PinnedNeighborhoodVisibilityOptions {
	displayedLayers?: number;
	fallbackAnchorNodeId?: string | null;
	boundaryFadeRatio?: number;
}

export function visibleNodeIdsForPinnedNeighborhood(
	data: MultigraphData,
	pinnedHopsByNodeId: Record<string, number>,
	options: PinnedNeighborhoodVisibilityOptions = {}
): Set<string> {
	const displayedLayers = normalizeDisplayedLayers(options.displayedLayers);
	const sourceHops = hasPinnedNodes(data)
		? pinnedHopsByNodeId
		: hopsFromFallbackAnchor(data, options.fallbackAnchorNodeId);

	return new Set(
		data.nodes
			.filter((node) => {
				const hopCount = sourceHops[node.id];
				return Number.isFinite(hopCount) && hopCount <= displayedLayers;
			})
			.map((node) => node.id)
	);
}

export function edgeVisibilityForPinnedNeighborhood(
	data: MultigraphData,
	pinnedHopsByNodeId: Record<string, number>,
	options: PinnedNeighborhoodVisibilityOptions = {}
): EdgeVisibility[] {
	const visibleNodeIds = visibleNodeIdsForPinnedNeighborhood(data, pinnedHopsByNodeId, options);
	const fadeRatio = normalizeBoundaryFadeRatio(options.boundaryFadeRatio);

	return data.edges.map((edge) => {
		const sourceVisible = visibleNodeIds.has(edge.sourceNodeId);
		const targetVisible = visibleNodeIds.has(edge.targetNodeId);

		if (sourceVisible && targetVisible) return { kind: 'visible', edge };
		if (!sourceVisible && !targetVisible) return { kind: 'hidden', edge };

		return {
			kind: 'boundary',
			edge,
			visibleNodeId: sourceVisible ? edge.sourceNodeId : edge.targetNodeId,
			hiddenNodeId: sourceVisible ? edge.targetNodeId : edge.sourceNodeId,
			visibleEndpoint: sourceVisible ? 'source' : 'target',
			hiddenEndpoint: sourceVisible ? 'target' : 'source',
			fadeRatio
		};
	});
}

export function graphWithVisibleNodes(
	data: MultigraphData,
	nodeIds: ReadonlySet<string>
): MultigraphData {
	return {
		...data,
		nodes: data.nodes.filter((node) => nodeIds.has(node.id)),
		edges: data.edges.filter(
			(edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId)
		)
	};
}

export function pinnedNodeIds(data: MultigraphData): Set<string> {
	return new Set(data.nodes.filter((node) => node.pinned).map((node) => node.id));
}

function hasPinnedNodes(data: MultigraphData): boolean {
	return data.nodes.some((node) => node.pinned === true);
}

function hopsFromFallbackAnchor(
	data: MultigraphData,
	fallbackAnchorNodeId: string | null | undefined
): Record<string, number> {
	const nodeIds = data.nodes.map((node) => node.id);
	const hops = Object.fromEntries(nodeIds.map((nodeId) => [nodeId, Infinity]));
	if (!fallbackAnchorNodeId || !(fallbackAnchorNodeId in hops)) return hops;

	const adjacency = adjacencyByNodeId(data);
	const queue = [fallbackAnchorNodeId];
	hops[fallbackAnchorNodeId] = 0;

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

function adjacencyByNodeId(data: MultigraphData): Record<string, string[]> {
	const adjacency = Object.fromEntries(data.nodes.map((node) => [node.id, [] as string[]]));

	for (const edge of data.edges) {
		if (adjacency[edge.sourceNodeId] && adjacency[edge.targetNodeId]) {
			adjacency[edge.sourceNodeId].push(edge.targetNodeId);
			adjacency[edge.targetNodeId].push(edge.sourceNodeId);
		}
	}

	return adjacency;
}

function normalizeDisplayedLayers(displayedLayers = DEFAULT_DISPLAYED_LAYERS): number {
	return Math.max(0, Math.floor(displayedLayers));
}

function normalizeBoundaryFadeRatio(boundaryFadeRatio = DEFAULT_BOUNDARY_FADE_RATIO): number {
	return Math.min(1, Math.max(0, boundaryFadeRatio));
}
