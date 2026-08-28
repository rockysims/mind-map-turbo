import type { MultigraphData } from '../../types/multigraph';
import { DEFAULT_DISPLAYED_LAYERS } from './boundedVisibility';
import type { LayoutSettings } from './layoutSettings';
import { withDefaultLayoutSettings } from './layoutSettings';
import type { EdgeEndpointIds } from './physics';

export function hopsFromPinned(
	data: MultigraphData,
	extraEdges: readonly EdgeEndpointIds[] = []
): Record<string, number> {
	return hopsFromOrigins(data, pinnedOrigins(data), extraEdges);
}

function pinnedOrigins(data: MultigraphData): Record<string, number> {
	return Object.fromEntries(data.nodes.filter((node) => node.pinned).map((node) => [node.id, 0]));
}

/**
 * Distance to the nearest origin, where origins may start at different hops.
 * The relax-and-requeue loop settles that correctly: a node reached early from
 * a distant origin is revisited when a nearer one gets to it.
 */
function hopsFromOrigins(
	data: MultigraphData,
	origins: Record<string, number>,
	extraEdges: readonly EdgeEndpointIds[]
): Record<string, number> {
	const hops = Object.fromEntries(data.nodes.map((node) => [node.id, Infinity]));
	const adjacency = buildAdjacency(data, extraEdges);
	const queue: string[] = [];

	for (const [nodeId, hop] of Object.entries(origins)) {
		if (!(nodeId in hops) || hop >= hops[nodeId]) continue;
		hops[nodeId] = hop;
		queue.push(nodeId);
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

export function shortestPathHopsByNodeId(
	data: MultigraphData
): Record<string, Record<string, number>> {
	const adjacency = buildAdjacency(data);
	const nodeIds = data.nodes.map(({ id }) => id);

	return Object.fromEntries(
		nodeIds.map((nodeId) => [nodeId, hopsFromSource(nodeId, adjacency, nodeIds)])
	);
}

export interface HopsThroughEdgesOptions {
	displayedLayers?: number;
	/**
	 * Where measuring starts, as node id to starting hop. Defaults to the pinned
	 * nodes at zero.
	 *
	 * Callers override this because a pin is not the only thing that can anchor
	 * a view: with nothing pinned at all there is no origin, and every node
	 * would keep whatever hop it came in with.
	 */
	origins?: Record<string, number>;
}

/**
 * Re-measures each node's distance from an origin with `extraEdges`
 * counting as steps, keeping `hops` wherever they reach nothing. Currently the
 * dataflow layer, so that a node a written equation links to your pin reads as
 * near as one you drew an edge to, and a node behind it reads as one further.
 *
 * Deliberately separate from the hops that decide visibility. Sizing by these
 * says only "this is how far away it is"; letting them into the visible set
 * would open up a whole neighborhood off one equation. Nothing here can put a
 * node on screen or take it off: values are capped at `displayedLayers`, and a
 * node the extra edges do not reach keeps the hop it arrived with.
 *
 * A larger result replaces a smaller one, which is the point rather than an
 * oversight. A beacon sits at a flat hop that stands in for "no path to a pin
 * exists"; once one does exist, the real distance is the better answer even
 * when it is further out.
 */
export function withHopsThroughEdges(
	data: MultigraphData,
	hops: Record<string, number>,
	extraEdges: readonly EdgeEndpointIds[],
	options: HopsThroughEdgesOptions = {}
): Record<string, number> {
	if (extraEdges.length === 0) return hops;

	const displayedLayers = Math.max(
		0,
		Math.floor(options.displayedLayers ?? DEFAULT_DISPLAYED_LAYERS)
	);
	const distances = hopsFromOrigins(data, options.origins ?? pinnedOrigins(data), extraEdges);
	let next: Record<string, number> | null = null;

	for (const [nodeId, distance] of Object.entries(distances)) {
		if (!Number.isFinite(distance)) continue;
		const hop = Math.min(distance, displayedLayers);
		if (hops[nodeId] === hop) continue;
		next ??= { ...hops };
		next[nodeId] = hop;
	}

	// Identity when nothing moved, so a derived chain built on this does not
	// invalidate every frame for a graph whose equations change nothing.
	return next ?? hops;
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

function hopsFromSource(
	sourceId: string,
	adjacency: Record<string, string[]>,
	nodeIds: string[]
): Record<string, number> {
	const hops = Object.fromEntries(nodeIds.map((nodeId) => [nodeId, Infinity]));
	const queue = [sourceId];
	hops[sourceId] = 0;

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

export function buildAdjacency(
	data: MultigraphData,
	extraEdges: readonly EdgeEndpointIds[] = []
): Record<string, string[]> {
	const adjacency = Object.fromEntries(data.nodes.map((node) => [node.id, [] as string[]]));

	for (const edge of extraEdges.length === 0 ? data.edges : [...data.edges, ...extraEdges]) {
		if (!adjacency[edge.sourceNodeId] || !adjacency[edge.targetNodeId]) continue;
		adjacency[edge.sourceNodeId].push(edge.targetNodeId);
		adjacency[edge.targetNodeId].push(edge.sourceNodeId);
	}

	return adjacency;
}
