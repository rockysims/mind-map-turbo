import type { EdgeData } from '../../types/edge';
import type { MultigraphData } from '../../types/multigraph';
import { withBeaconHops } from './beacons';
import { hopsFromPinned } from './layout';
import type { EdgeEndpointIds } from './physics';

export const DEFAULT_DISPLAYED_LAYERS = 10;
export const DEFAULT_DATAFLOW_DISPLAYED_LAYERS = 1;
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
 * Downgrade every derived edge sitting at the visibility boundary to hidden, so
 * a derived edge is drawn only when both of its endpoints are on screen.
 *
 * An authored half-edge fading off the boundary is an invitation: the reader can
 * follow it by pinning what it hangs off. A derived one is not. The node it
 * points at is out there because the derived budget stopped short, and no amount
 * of revealing fixes it — a chained equation (`v → h1 → h3` with one layer of
 * derived budget) reveals `h1` and leaves `h3` exactly as far out of reach as it
 * was. An arrow toward somewhere the reader cannot go is worse than no arrow, so
 * this draws none. The out-of-view diagnostic stays the affordance for finding a
 * definer that is off screen.
 *
 * Takes a predicate rather than importing the dataflow layer: this module
 * answers "who is on screen", and which edges an equation implied is not its
 * question.
 */
export function withDerivedBoundaryEdgesHidden(
	visibilities: EdgeVisibility[],
	isDerivedEdge: (edgeId: string) => boolean
): EdgeVisibility[] {
	let next: EdgeVisibility[] | null = null;

	for (let index = 0; index < visibilities.length; index += 1) {
		const visibility = visibilities[index];
		if (visibility.kind !== 'boundary' || !isDerivedEdge(visibility.edge.id)) continue;
		next ??= [...visibilities];
		next[index] = { kind: 'hidden', edge: visibility.edge };
	}

	// Identity when no derived edge is at the boundary, which is the common case:
	// this feeds a derived chain that re-runs on every frame of a drag.
	return next ?? visibilities;
}

export interface BoundedHopsOptions {
	/** Authored-step budget: how many layers of drawn edges a path may spend. */
	displayedLayers?: number;
	/**
	 * Derived-step budget: how many further layers a path may spend on dataflow
	 * edges once it has crossed one. This is the only way a derived edge differs
	 * from an authored one — it has its own, smaller budget.
	 */
	dataflowDisplayedLayers?: number;
}

/**
 * The hop map everything reads: visibility, node scale, the reveal wave, and
 * physics distance all come from this one number per node.
 *
 * A node is reached by a path in the form **authored steps, then derived
 * steps**: authored edges spend `displayedLayers` from a pinned node (hop 0) or
 * a beacon (`BEACON_HOP`), and crossing a derived edge spends whatever authored
 * budget is left, after which only further derived steps may follow, at most
 * `dataflowDisplayedLayers` of them.
 *
 * That grammar is the point. "One equation cannot drag a cluster into view" is
 * a consequence of it rather than an invariant something has to defend: a node
 * first reached across a derived edge is never seeded back into authored
 * expansion, so its drawn neighbors stay exactly as hidden as they were.
 */
export function computeBoundedHops(
	data: MultigraphData,
	derivedEdges: readonly EdgeEndpointIds[],
	beaconIds: ReadonlySet<string> = new Set(),
	options: BoundedHopsOptions = {}
): Record<string, number> {
	return withDerivedHops(withBeaconHops(hopsFromPinned(data), beaconIds), derivedEdges, options);
}

/**
 * The derived phase of `computeBoundedHops`: a multi-source BFS over the
 * derived edges alone, seeded from every node the authored phase left inside
 * `displayedLayers` and running at most `dataflowDisplayedLayers` steps.
 *
 * Derived edges are undirected steps here, exactly as the authored BFS ignores
 * the direction an author drew. Each step offers its seed's hop plus the number
 * of steps taken, capped at `displayedLayers` so a node hanging off the
 * outermost layer lands inside it instead of being computed into view and then
 * filtered back out. Only smaller values win, so a derived edge between two
 * already-visible nodes sizes the farther one nearer and never changes who is
 * on screen.
 */
export function withDerivedHops(
	hops: Record<string, number>,
	derivedEdges: readonly EdgeEndpointIds[],
	options: BoundedHopsOptions = {}
): Record<string, number> {
	const displayedLayers = normalizeDisplayedLayers(options.displayedLayers);
	const derivedLayers = normalizeDisplayedLayers(
		options.dataflowDisplayedLayers ?? DEFAULT_DATAFLOW_DISPLAYED_LAYERS
	);
	if (derivedLayers === 0 || derivedEdges.length === 0) return hops;

	const adjacency = derivedAdjacency(hops, derivedEdges);
	if (adjacency.size === 0) return hops;

	// Level `step` holds, per node, the lowest hop of any seed exactly that many
	// derived steps away. Everything on one level took the same number of steps,
	// so the nearest seed is the best offer, and one pass per level bounds the
	// whole phase by the budget rather than by the size of the dataflow layer.
	let seedHopsAtStep = seedHopsWithinLayers(hops, displayedLayers);
	let next: Record<string, number> | null = null;

	for (let step = 1; step <= derivedLayers; step += 1) {
		const nextSeedHops = new Map<string, number>();

		for (const [nodeId, seedHop] of seedHopsAtStep) {
			for (const neighborId of adjacency.get(nodeId) ?? []) {
				const best = nextSeedHops.get(neighborId);
				if (best === undefined || seedHop < best) nextSeedHops.set(neighborId, seedHop);
			}
		}
		if (nextSeedHops.size === 0) break;

		for (const [nodeId, seedHop] of nextSeedHops) {
			const candidate = Math.min(seedHop + step, displayedLayers);
			if (candidate >= (next ?? hops)[nodeId]) continue;
			next ??= { ...hops };
			next[nodeId] = candidate;
		}

		seedHopsAtStep = nextSeedHops;
	}

	// Identity when nothing moved: this feeds a derived chain that would
	// otherwise invalidate on every frame for a graph whose equations say
	// nothing new about distance.
	return next ?? hops;
}

function seedHopsWithinLayers(
	hops: Record<string, number>,
	displayedLayers: number
): Map<string, number> {
	const seeds = new Map<string, number>();

	for (const [nodeId, hop] of Object.entries(hops)) {
		if (Number.isFinite(hop) && hop <= displayedLayers) seeds.set(nodeId, hop);
	}

	return seeds;
}

function derivedAdjacency(
	hops: Record<string, number>,
	derivedEdges: readonly EdgeEndpointIds[]
): Map<string, string[]> {
	const adjacency = new Map<string, string[]>();
	const link = (fromId: string, toId: string): void => {
		const neighbors = adjacency.get(fromId);
		if (neighbors === undefined) adjacency.set(fromId, [toId]);
		else neighbors.push(toId);
	};

	for (const edge of derivedEdges) {
		// An id the hop map has never heard of is nothing we can measure to.
		if (!(edge.sourceNodeId in hops) || !(edge.targetNodeId in hops)) continue;
		link(edge.sourceNodeId, edge.targetNodeId);
		link(edge.targetNodeId, edge.sourceNodeId);
	}

	return adjacency;
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

/**
 * The one graph the layout runs over: the visible nodes, the authored edges
 * between them, and the derived edges between them.
 *
 * There is exactly one of these calls per consumer for a reason. A derived edge
 * that pulled through a side channel while the graph's shape said the pair was
 * unreachable had the hop repulsion pushing at full strength against its own
 * spring — the pair standing off at a distance neither force asked for. Joining
 * the layout graph makes one edge one answer: spring force, degree counting,
 * edge-gap constraints, and the pairwise shortest paths repulsion reads all see
 * the same set.
 *
 * Derived edges reaching off screen are dropped: an off-screen node has no
 * position or radius for physics to use, and an edge to it would still count
 * toward its neighbor's degree, weakening every pull that node does feel.
 *
 * This graph is for placing nodes and never for keeping. Callers merge the
 * positions back into the authored graph, so a derived edge cannot reach
 * mutations, duplicate detection, or persistence.
 */
export function composeVisibleLayoutGraph(
	data: MultigraphData,
	nodeIds: ReadonlySet<string>,
	derivedEdges: readonly EdgeData[] = []
): MultigraphData {
	const visible = graphWithVisibleNodes(data, nodeIds);
	const visibleDerivedEdges = derivedEdges.filter(
		(edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId)
	);
	if (visibleDerivedEdges.length === 0) return visible;

	return { ...visible, edges: [...visible.edges, ...visibleDerivedEdges] };
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
