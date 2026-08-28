import type { MultigraphData, Point } from '../../types/multigraph';
import { radiusOf, scaleByHops, shortestPathHopsByNodeId } from './layout';
import type { LayoutSettings } from './layoutSettings';
import { withDefaultLayoutSettings } from './layoutSettings';
import { relaxGraphPhysics } from './physics';
import { normalizeRigidMotion } from './rigidMotion';

const CENTERED_POSITION: Point = { x: 0, y: 0 };
const MAX_SETTLE_RELAX_ITERATIONS = 500;
const SETTLE_ITERATIONS_PER_NODE = 5;

export interface NodeLayout {
	nodeId: string;
	hops: number;
	scale: number;
	radius: number;
	position: Point;
	anchored: boolean;
}

export interface GraphLayout {
	hopsByNodeId: Record<string, number>;
	scaleByNodeId: Record<string, number>;
	radiusByNodeId: Record<string, number>;
	posByNodeId: Record<string, Point>;
	nodes: NodeLayout[];
}

export interface GraphLayoutOptions {
	settings?: Partial<LayoutSettings>;
	activeDragNodeId?: string | null;
	/** Keep these nodes fixed during relaxation while their scale animates (e.g. after unpin). */
	scaleAnchoredNodeIds?: readonly string[];
	/**
	 * Every node's distance, as the one bounded hop map (`computeBoundedHops`).
	 * Required, and never recomputed here: `data` is usually the visible subgraph,
	 * where a beacon or a node an equation revealed has no edges at all and a
	 * fresh BFS would size it as if it were unreachable. Sizing and visibility are
	 * the same number, measured once by whoever owns the whole graph.
	 *
	 * May cover nodes outside `data`; the extras are ignored.
	 */
	hopsByNodeId: Record<string, number>;
	relaxIterations?: number;
	scaleByNodeId?: Record<string, number>;
	participatingNodeIds?: ReadonlySet<string>;
	mobilityByNodeId?: Record<string, number>;
}

export interface GraphRelaxationStep {
	data: MultigraphData;
	maxPositionDelta: number;
}

export function deriveGraphLayout(data: MultigraphData, options: GraphLayoutOptions): GraphLayout {
	const settings = withDefaultLayoutSettings(options.settings);
	const hopsByNodeId = hopsForNodes(data, options.hopsByNodeId);
	const targetScaleByNodeId = scaleByHops(hopsByNodeId, settings);
	const scaleByNodeId = {
		...targetScaleByNodeId,
		...options.scaleByNodeId
	};
	const radiusByNodeId = Object.fromEntries(
		data.nodes.map((node) => [node.id, radiusOf(scaleByNodeId, settings, node.id)])
	);
	const basePositions = positionsForNodes(data);
	const anchoredIds = anchoredNodeIds(data, options);
	const iterations = options.relaxIterations ?? settings.relaxIterations;
	// Pairwise node-to-node hops for repulsion, a different question from the hop
	// map above: that one says how far each node is from where reading starts,
	// this one how far every node is from every other. Reads `data.edges`, which
	// is every edge of the composed layout graph — a derived edge makes its
	// endpoints neighbors here exactly as it does for the spring, instead of
	// leaving them infinitely far apart and pushing at full strength against
	// their own pull.
	const shortestPathHops = shortestPathHopsByNodeId(data);
	const posByNodeId =
		iterations > 0
			? relaxGraphPhysics(
					basePositions,
					radiusByNodeId,
					[...data.edges],
					settings,
					iterations,
					anchoredIds,
					shortestPathHops,
					options.participatingNodeIds,
					options.mobilityByNodeId
				)
			: basePositions;

	return {
		hopsByNodeId,
		scaleByNodeId,
		radiusByNodeId,
		posByNodeId,
		nodes: data.nodes.map((node) => ({
			nodeId: node.id,
			hops: hopsByNodeId[node.id],
			scale: scaleByNodeId[node.id],
			radius: radiusByNodeId[node.id],
			position: posByNodeId[node.id],
			anchored: anchoredIds.has(node.id)
		}))
	};
}

export function relaxGraphPositions(
	data: MultigraphData,
	options: GraphLayoutOptions
): Record<string, Point> {
	return deriveGraphLayout(data, options).posByNodeId;
}

export function withRelaxedGraphPositions(
	data: MultigraphData,
	options: GraphLayoutOptions
): MultigraphData {
	return {
		...data,
		posByNodeId: relaxGraphPositions(data, options)
	};
}

export function relaxGraphPositionsStep(
	data: MultigraphData,
	options: GraphLayoutOptions
): GraphRelaxationStep {
	const settings = withDefaultLayoutSettings(options.settings);
	const nextPositions = relaxGraphPositions(data, options);
	const shouldNormalize =
		!options.activeDragNodeId &&
		(settings.normalizeRelaxationTranslation || settings.normalizeRelaxationRotation);
	const correctedPositions = shouldNormalize
		? normalizeRigidMotion(
				data.posByNodeId,
				nextPositions,
				participatingNodeIds(data, options),
				anchoredNodeIds(data, options),
				settings
			)
		: nextPositions;

	return {
		data: {
			...data,
			posByNodeId: correctedPositions
		},
		maxPositionDelta: maxPositionDelta(
			data.posByNodeId,
			correctedPositions,
			options.participatingNodeIds
		)
	};
}

export function withSettledGraphPositions(
	data: MultigraphData,
	options: GraphLayoutOptions
): MultigraphData {
	const settings = withDefaultLayoutSettings(options.settings);

	return withRelaxedGraphPositions(data, {
		...options,
		relaxIterations: Math.min(
			MAX_SETTLE_RELAX_ITERATIONS,
			Math.max(
				options.relaxIterations ?? settings.relaxIterations,
				data.nodes.length * SETTLE_ITERATIONS_PER_NODE
			)
		)
	});
}

function positionsForNodes(data: MultigraphData): Record<string, Point> {
	return Object.fromEntries(
		data.nodes.map((node) => [node.id, { ...(data.posByNodeId[node.id] ?? CENTERED_POSITION) }])
	);
}

function anchoredNodeIds(data: MultigraphData, options: GraphLayoutOptions): Set<string> {
	const anchoredIds = new Set(data.nodes.filter((node) => node.pinned).map((node) => node.id));
	if (options.activeDragNodeId) anchoredIds.add(options.activeDragNodeId);
	for (const nodeId of options.scaleAnchoredNodeIds ?? []) {
		anchoredIds.add(nodeId);
	}
	return anchoredIds;
}

/**
 * Narrows the hop map to this graph's nodes. A node the map has never heard of
 * is infinitely far, which is what an unreachable node has always meant.
 */
function hopsForNodes(
	data: MultigraphData,
	hopsByNodeId: Record<string, number>
): Record<string, number> {
	return Object.fromEntries(data.nodes.map((node) => [node.id, hopsByNodeId[node.id] ?? Infinity]));
}

function participatingNodeIds(
	data: MultigraphData,
	options: GraphLayoutOptions
): ReadonlySet<string> {
	return options.participatingNodeIds ?? new Set(data.nodes.map((node) => node.id));
}

function maxPositionDelta(
	previousPositions: Record<string, Point>,
	nextPositions: Record<string, Point>,
	participatingNodeIds?: ReadonlySet<string>
): number {
	const nodeIds = participatingNodeIds ?? Object.keys(nextPositions);

	return [...nodeIds].reduce((maxDelta, nodeId) => {
		const nextPosition = nextPositions[nodeId] ?? CENTERED_POSITION;
		const previousPosition = previousPositions[nodeId] ?? CENTERED_POSITION;
		const delta = Math.hypot(
			nextPosition.x - previousPosition.x,
			nextPosition.y - previousPosition.y
		);
		return Math.max(maxDelta, delta);
	}, 0);
}
