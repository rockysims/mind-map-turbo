import type { EdgeData } from '../../types/edge';
import type { MultigraphData } from '../../types/multigraph';
import type { EdgeEndpointIds } from './physics';

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

/**
 * Pulls the far endpoint of an off-topology edge into view, one layer out from
 * the node it hangs off.
 *
 * Dataflow edges do not shorten hop distance, so a node that only an equation
 * connects to your pinned node fails the visibility rule and its arrow renders
 * as a stub trailing off into nothing. Drawing an arrow to somewhere the reader
 * cannot go is worse than drawing no arrow.
 *
 * Deliberately no BFS, exactly as with beacons: every reveal is measured against
 * the hops passed in, so a node revealed here cannot anchor another reveal and
 * one equation can never cascade a whole cluster into view. The hop is capped at
 * `displayedLayers` so a node hanging off the outermost layer still lands inside
 * it rather than being computed into view and then filtered back out.
 */
export function withRevealedNeighborHops(
	hops: Record<string, number>,
	edges: readonly EdgeEndpointIds[],
	options: PinnedNeighborhoodVisibilityOptions = {}
): Record<string, number> {
	const displayedLayers = normalizeDisplayedLayers(options.displayedLayers);
	const isVisible = (nodeId: string): boolean => {
		const hopCount = hops[nodeId];
		return hopCount !== undefined && Number.isFinite(hopCount) && hopCount <= displayedLayers;
	};

	let revealed: Record<string, number> | null = null;

	for (const edge of edges) {
		const sourceVisible = isVisible(edge.sourceNodeId);
		const targetVisible = isVisible(edge.targetNodeId);
		// Both visible, nothing to do. Both hidden, nothing to hang the reveal off.
		if (sourceVisible === targetVisible) continue;

		const anchorId = sourceVisible ? edge.sourceNodeId : edge.targetNodeId;
		const hiddenId = sourceVisible ? edge.targetNodeId : edge.sourceNodeId;
		if (!(hiddenId in hops)) continue;

		const hop = Math.min(hops[anchorId] + 1, displayedLayers);
		revealed ??= {};
		revealed[hiddenId] = Math.min(revealed[hiddenId] ?? Number.POSITIVE_INFINITY, hop);
	}

	// Identity when nothing was revealed: this feeds a derived chain that would
	// otherwise invalidate on every frame for graphs with no math in them.
	if (revealed === null) return hops;
	return { ...hops, ...revealed };
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
