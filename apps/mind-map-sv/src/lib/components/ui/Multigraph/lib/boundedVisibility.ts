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
	boundaryFadeRatio?: number;
}

export function visibleNodeIdsForPinnedNeighborhood(
	data: MultigraphData,
	hopsByNodeId: Record<string, number>,
	options: PinnedNeighborhoodVisibilityOptions = {}
): Set<string> {
	const displayedLayers = normalizeDisplayedLayers(options.displayedLayers);

	return new Set(
		data.nodes
			.filter((node) => {
				const hopCount = hopsByNodeId[node.id];
				return Number.isFinite(hopCount) && hopCount <= displayedLayers;
			})
			.map((node) => node.id)
	);
}

export function edgeVisibilityForPinnedNeighborhood(
	data: MultigraphData,
	hopsByNodeId: Record<string, number>,
	options: PinnedNeighborhoodVisibilityOptions = {}
): EdgeVisibility[] {
	const visibleNodeIds = visibleNodeIdsForPinnedNeighborhood(data, hopsByNodeId, options);
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

function normalizeDisplayedLayers(displayedLayers = DEFAULT_DISPLAYED_LAYERS): number {
	return Math.max(0, Math.floor(displayedLayers));
}

function normalizeBoundaryFadeRatio(boundaryFadeRatio = DEFAULT_BOUNDARY_FADE_RATIO): number {
	return Math.min(1, Math.max(0, boundaryFadeRatio));
}
