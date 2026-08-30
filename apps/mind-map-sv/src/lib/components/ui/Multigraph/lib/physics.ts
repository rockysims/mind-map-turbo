import type { Point } from '../../types/multigraph';

const OVERLAP_EPSILON = 0.001;

interface EdgeDistanceSettings {
	edgeGapMinRadiusFactor: number;
	edgeGapMaxRadiusFactor: number;
	edgeSpringStrength: number;
}

interface HopRepulsionSettings {
	hopRepulsionStrength: number;
	hopRepulsionMinHops: number;
	hopRepulsionMaxHops: number;
	hopRepulsionMaxExtraGapRadiusFactor: number;
}

type GraphPhysicsSettings = EdgeDistanceSettings & HopRepulsionSettings;

export interface EdgeEndpointIds {
	sourceNodeId: string;
	targetNodeId: string;
	/**
	 * Scales this edge's share of the spring, relative to `edgeSpringStrength`.
	 * Defaults to 1, so an edge that says nothing pulls exactly as it always has.
	 *
	 * Physics deliberately does not know what makes an edge weaker or stronger. It
	 * is handed a number, which keeps the dataflow layer's existence out of the
	 * force law.
	 */
	springFactor?: number;
}

function nodeMobility(
	nodeId: string,
	anchoredIds: Set<string>,
	mobilityByNodeId?: Record<string, number>
): number {
	if (anchoredIds.has(nodeId)) return 0;
	return mobilityByNodeId?.[nodeId] ?? 1;
}

export function displacementShares(
	sourceId: string,
	targetId: string,
	anchoredIds: Set<string>,
	mobilityByNodeId?: Record<string, number>
): { sourceShare: number; targetShare: number } | null {
	const sourceMobility = nodeMobility(sourceId, anchoredIds, mobilityByNodeId);
	const targetMobility = nodeMobility(targetId, anchoredIds, mobilityByNodeId);
	if (sourceMobility === 0 && targetMobility === 0) return null;
	if (sourceMobility === 0) return { sourceShare: 0, targetShare: 1 };
	if (targetMobility === 0) return { sourceShare: 1, targetShare: 0 };

	const totalMobility = sourceMobility + targetMobility;
	return {
		sourceShare: sourceMobility / totalMobility,
		targetShare: targetMobility / totalMobility
	};
}

export function relaxGraphPhysics(
	positions: Record<string, Point>,
	radii: Record<string, number>,
	edges: EdgeEndpointIds[],
	settings: GraphPhysicsSettings,
	iterations = 1,
	anchoredIds: Set<string> = new Set(),
	shortestPathHops: Record<string, Record<string, number>> = {},
	participatingNodeIds?: ReadonlySet<string>,
	mobilityByNodeId?: Record<string, number>
): Record<string, Point> {
	let relaxed = positions;

	for (let index = 0; index < iterations; index += 1) {
		const withRelaxedEdges = relaxEdgeDistancesStep(
			relaxed,
			radii,
			edges,
			settings,
			anchoredIds,
			participatingNodeIds,
			mobilityByNodeId
		);
		const withRepelledHops = relaxHopRepulsionStep(
			withRelaxedEdges,
			radii,
			shortestPathHops,
			settings,
			anchoredIds,
			participatingNodeIds,
			mobilityByNodeId
		);
		const next = relaxOverlapsStep(
			withRepelledHops,
			radii,
			anchoredIds,
			participatingNodeIds,
			mobilityByNodeId
		);
		if (next === relaxed) return relaxed;
		relaxed = next;
	}

	return relaxOverlaps(
		relaxed,
		radii,
		iterations,
		anchoredIds,
		participatingNodeIds,
		mobilityByNodeId
	);
}

export function relaxHopRepulsionStep(
	positions: Record<string, Point>,
	radii: Record<string, number>,
	shortestPathHops: Record<string, Record<string, number>>,
	settings: HopRepulsionSettings,
	anchoredIds: Set<string> = new Set(),
	participatingNodeIds?: ReadonlySet<string>,
	mobilityByNodeId?: Record<string, number>
): Record<string, Point> {
	const strength = clamp(settings.hopRepulsionStrength, 0, 1);
	const maxExtraGapFactor = Math.max(0, settings.hopRepulsionMaxExtraGapRadiusFactor);
	if (strength === 0 || maxExtraGapFactor === 0) return positions;

	const minHops = Math.max(1, Math.floor(settings.hopRepulsionMinHops));
	const maxHops = Math.max(minHops, Math.floor(settings.hopRepulsionMaxHops));
	const nextPositions = clonePositions(positions);
	const nodeIds = Object.keys(positions).filter((nodeId) => radii[nodeId] !== undefined);
	let moved = false;

	for (let sourceIndex = 0; sourceIndex < nodeIds.length; sourceIndex += 1) {
		for (let targetIndex = sourceIndex + 1; targetIndex < nodeIds.length; targetIndex += 1) {
			const sourceId = nodeIds[sourceIndex];
			const targetId = nodeIds[targetIndex];
			if (!pairParticipates(sourceId, targetId, participatingNodeIds)) continue;
			const hops = shortestPathHops[sourceId]?.[targetId] ?? shortestPathHops[targetId]?.[sourceId];
			const progress = hopRepulsionProgress(hops, minHops, maxHops);
			if (progress === 0) continue;

			const source = nextPositions[sourceId];
			const target = nextPositions[targetId];
			const sourceRadius = radii[sourceId];
			const targetRadius = radii[targetId];
			const radiusSum = sourceRadius + targetRadius;
			const preferredDistance = radiusSum + radiusSum * maxExtraGapFactor * progress;
			const shares = displacementShares(sourceId, targetId, anchoredIds, mobilityByNodeId);
			if (shares === null) continue;

			const dx = target.x - source.x;
			const dy = target.y - source.y;
			const distance = Math.hypot(dx, dy);
			const deficit = preferredDistance - distance;
			if (deficit <= OVERLAP_EPSILON) continue;

			const direction =
				distance > 0
					? { x: dx / distance, y: dy / distance }
					: zeroDistanceDirection(sourceId, targetId);
			const { sourceShare, targetShare } = shares;
			const adjustment = deficit * strength;

			nextPositions[sourceId] = {
				x: source.x - direction.x * adjustment * sourceShare,
				y: source.y - direction.y * adjustment * sourceShare
			};
			nextPositions[targetId] = {
				x: target.x + direction.x * adjustment * targetShare,
				y: target.y + direction.y * adjustment * targetShare
			};
			moved = true;
		}
	}

	return moved ? nextPositions : positions;
}

export function neighborDegreeByNodeId(edges: EdgeEndpointIds[]): Record<string, number> {
	const neighborsByNodeId = new Map<string, Set<string>>();

	for (const { sourceNodeId, targetNodeId } of edges) {
		if (!neighborsByNodeId.has(sourceNodeId)) {
			neighborsByNodeId.set(sourceNodeId, new Set());
		}
		if (!neighborsByNodeId.has(targetNodeId)) {
			neighborsByNodeId.set(targetNodeId, new Set());
		}
		neighborsByNodeId.get(sourceNodeId)?.add(targetNodeId);
		neighborsByNodeId.get(targetNodeId)?.add(sourceNodeId);
	}

	return Object.fromEntries(
		[...neighborsByNodeId.entries()].map(([nodeId, neighbors]) => [nodeId, neighbors.size])
	);
}

/**
 * An edge with no stated factor pulls at full strength, which is what every edge
 * did before factors existed. A negative factor would invert the spring into a
 * force that pushes harder the further apart two nodes get, so it reads as zero.
 */
function springFactorOf(edge: EdgeEndpointIds): number {
	const factor = edge.springFactor ?? 1;
	return Number.isFinite(factor) && factor > 0 ? factor : 0;
}

export function relaxEdgeDistancesStep(
	positions: Record<string, Point>,
	radii: Record<string, number>,
	edges: EdgeEndpointIds[],
	settings: EdgeDistanceSettings,
	anchoredIds: Set<string> = new Set(),
	participatingNodeIds?: ReadonlySet<string>,
	mobilityByNodeId?: Record<string, number>
): Record<string, Point> {
	const minGapFactor = Math.min(settings.edgeGapMinRadiusFactor, settings.edgeGapMaxRadiusFactor);
	const maxGapFactor = Math.max(settings.edgeGapMinRadiusFactor, settings.edgeGapMaxRadiusFactor);
	const springStrength = clamp(settings.edgeSpringStrength, 0, 1);
	if (springStrength === 0) return positions;

	// Dropped before degree is counted, not skipped inside the loop. Degree divides
	// each node's displacement, so an edge that exerts no force would still weaken
	// every other edge on its endpoints — a silent way to turn a factor of 0 into a
	// change in how the rest of the graph behaves.
	const forcefulEdges = edges.filter((edge) => springFactorOf(edge) > 0);

	const neighborDegree = neighborDegreeByNodeId(forcefulEdges);
	const displacementByNodeId: Record<string, Point> = {};
	let moved = false;

	for (const edge of forcefulEdges) {
		const sourceId = edge.sourceNodeId;
		const targetId = edge.targetNodeId;
		if (!pairParticipates(sourceId, targetId, participatingNodeIds)) continue;
		const source = positions[sourceId];
		const target = positions[targetId];
		const sourceRadius = radii[sourceId];
		const targetRadius = radii[targetId];
		if (!source || !target || sourceRadius === undefined || targetRadius === undefined) continue;

		const radiusSum = sourceRadius + targetRadius;
		const minGap = radiusSum * minGapFactor;
		const maxGap = radiusSum * maxGapFactor;
		const shares = displacementShares(sourceId, targetId, anchoredIds, mobilityByNodeId);
		if (shares === null) continue;

		const dx = target.x - source.x;
		const dy = target.y - source.y;
		const distance = Math.hypot(dx, dy);
		const gap = distance - sourceRadius - targetRadius;
		// Clamped like `springStrength` itself, and for the same reason: a step
		// larger than the whole gap overshoots the target and oscillates instead of
		// settling, so a factor above 1 must not put the product back past the cap
		// the base strength was clamped to.
		const edgeStrength = clamp(springStrength * springFactorOf(edge), 0, 1);
		const adjustment =
			gap > maxGap
				? (gap - maxGap) * edgeStrength
				: gap < minGap
					? (gap - minGap) * edgeStrength
					: 0;
		if (Math.abs(adjustment) <= OVERLAP_EPSILON) continue;

		const direction =
			distance > 0
				? { x: dx / distance, y: dy / distance }
				: zeroDistanceDirection(sourceId, targetId);
		const { sourceShare, targetShare } = shares;

		addDisplacement(displacementByNodeId, sourceId, {
			x: direction.x * adjustment * sourceShare,
			y: direction.y * adjustment * sourceShare
		});
		addDisplacement(displacementByNodeId, targetId, {
			x: -direction.x * adjustment * targetShare,
			y: -direction.y * adjustment * targetShare
		});
		moved = true;
	}

	if (!moved) return positions;

	const nextPositions = clonePositions(positions);

	for (const [nodeId, displacement] of Object.entries(displacementByNodeId)) {
		const degree = neighborDegree[nodeId] ?? 0;
		if (
			degree === 0 ||
			anchoredIds.has(nodeId) ||
			!nodeParticipates(nodeId, participatingNodeIds)
		) {
			continue;
		}

		const position = positions[nodeId];
		if (!position) continue;

		nextPositions[nodeId] = {
			x: position.x + displacement.x / degree,
			y: position.y + displacement.y / degree
		};
	}

	return nextPositions;
}

export function relaxOverlaps(
	positions: Record<string, Point>,
	radii: Record<string, number>,
	iterations = 1,
	anchoredIds: Set<string> = new Set(),
	participatingNodeIds?: ReadonlySet<string>,
	mobilityByNodeId?: Record<string, number>
): Record<string, Point> {
	let relaxed = positions;

	for (let index = 0; index < iterations; index += 1) {
		const next = relaxOverlapsStep(
			relaxed,
			radii,
			anchoredIds,
			participatingNodeIds,
			mobilityByNodeId
		);
		if (next === relaxed) return relaxed;
		relaxed = next;
	}

	return relaxed;
}

export function relaxOverlapsStep(
	positions: Record<string, Point>,
	radii: Record<string, number>,
	anchoredIds: Set<string> = new Set(),
	participatingNodeIds?: ReadonlySet<string>,
	mobilityByNodeId?: Record<string, number>
): Record<string, Point> {
	const nextPositions = clonePositions(positions);
	const nodeIds = Object.keys(positions).filter((nodeId) => radii[nodeId] !== undefined);
	let moved = false;

	for (let sourceIndex = 0; sourceIndex < nodeIds.length; sourceIndex += 1) {
		for (let targetIndex = sourceIndex + 1; targetIndex < nodeIds.length; targetIndex += 1) {
			const sourceId = nodeIds[sourceIndex];
			const targetId = nodeIds[targetIndex];
			if (!pairParticipates(sourceId, targetId, participatingNodeIds)) continue;
			const source = nextPositions[sourceId];
			const target = nextPositions[targetId];
			const minDistance = radii[sourceId] + radii[targetId];
			const dx = target.x - source.x;
			const dy = target.y - source.y;
			const distance = Math.hypot(dx, dy);
			const overlap = minDistance - distance;

			if (overlap <= OVERLAP_EPSILON) continue;

			const shares = displacementShares(sourceId, targetId, anchoredIds, mobilityByNodeId);
			if (shares === null) continue;

			const direction =
				distance > 0
					? { x: dx / distance, y: dy / distance }
					: zeroDistanceDirection(sourceId, targetId);
			const { sourceShare, targetShare } = shares;

			nextPositions[sourceId] = {
				x: source.x - direction.x * overlap * sourceShare,
				y: source.y - direction.y * overlap * sourceShare
			};
			nextPositions[targetId] = {
				x: target.x + direction.x * overlap * targetShare,
				y: target.y + direction.y * overlap * targetShare
			};
			moved = true;
		}
	}

	return moved ? nextPositions : positions;
}

function addDisplacement(
	displacementByNodeId: Record<string, Point>,
	nodeId: string,
	delta: Point
): void {
	const current = displacementByNodeId[nodeId] ?? { x: 0, y: 0 };
	displacementByNodeId[nodeId] = {
		x: current.x + delta.x,
		y: current.y + delta.y
	};
}

function clonePositions(positions: Record<string, Point>): Record<string, Point> {
	return Object.fromEntries(
		Object.entries(positions).map(([nodeId, point]) => [nodeId, { ...point }])
	);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function hopRepulsionProgress(hops: number | undefined, minHops: number, maxHops: number): number {
	if (hops === undefined || hops < minHops) return 0;
	const clampedHops = Number.isFinite(hops) ? Math.min(hops, maxHops) : maxHops;
	return (clampedHops - minHops + 1) / (maxHops - minHops + 1);
}

function nodeParticipates(nodeId: string, participatingNodeIds?: ReadonlySet<string>): boolean {
	return !participatingNodeIds || participatingNodeIds.has(nodeId);
}

function pairParticipates(
	sourceId: string,
	targetId: string,
	participatingNodeIds?: ReadonlySet<string>
): boolean {
	if (!participatingNodeIds) return true;

	const sourceParticipates = participatingNodeIds.has(sourceId);
	const targetParticipates = participatingNodeIds.has(targetId);
	return sourceParticipates && targetParticipates;
}

function zeroDistanceDirection(sourceId: string, targetId: string): Point {
	return sourceId < targetId ? { x: 1, y: 0 } : { x: -1, y: 0 };
}
