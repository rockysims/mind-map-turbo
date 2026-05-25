import type { Point } from '../../types/multigraph';

const OVERLAP_EPSILON = 0.001;

export interface EdgeDistanceSettings {
	edgeGapMinRadiusFactor: number;
	edgeGapMaxRadiusFactor: number;
	edgeSpringStrength: number;
}

export interface HopRepulsionSettings {
	hopRepulsionStrength: number;
	hopRepulsionMinHops: number;
	hopRepulsionMaxHops: number;
	hopRepulsionMaxExtraGapRadiusFactor: number;
}

export type GraphPhysicsSettings = EdgeDistanceSettings & HopRepulsionSettings;

export interface EdgeEndpointIds {
	sourceNodeId: string;
	targetNodeId: string;
}

export function relaxGraphPhysics(
	positions: Record<string, Point>,
	radii: Record<string, number>,
	edges: EdgeEndpointIds[],
	settings: GraphPhysicsSettings,
	iterations = 1,
	anchoredIds: Set<string> = new Set(),
	shortestPathHops: Record<string, Record<string, number>> = {},
	participatingNodeIds?: ReadonlySet<string>
): Record<string, Point> {
	let relaxed = positions;

	for (let index = 0; index < iterations; index += 1) {
		const withRelaxedEdges = relaxEdgeDistancesStep(
			relaxed,
			radii,
			edges,
			settings,
			anchoredIds,
			participatingNodeIds
		);
		const withRepelledHops = relaxHopRepulsionStep(
			withRelaxedEdges,
			radii,
			shortestPathHops,
			settings,
			anchoredIds,
			participatingNodeIds
		);
		const next = relaxOverlapsStep(withRepelledHops, radii, anchoredIds, participatingNodeIds);
		if (next === relaxed) return relaxed;
		relaxed = next;
	}

	return relaxOverlaps(relaxed, radii, iterations, anchoredIds, participatingNodeIds);
}

export function relaxHopRepulsionStep(
	positions: Record<string, Point>,
	radii: Record<string, number>,
	shortestPathHops: Record<string, Record<string, number>>,
	settings: HopRepulsionSettings,
	anchoredIds: Set<string> = new Set(),
	participatingNodeIds?: ReadonlySet<string>
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
			const sourceAnchored = anchoredIds.has(sourceId);
			const targetAnchored = anchoredIds.has(targetId);
			if (sourceAnchored && targetAnchored) continue;

			const dx = target.x - source.x;
			const dy = target.y - source.y;
			const distance = Math.hypot(dx, dy);
			const deficit = preferredDistance - distance;
			if (deficit <= OVERLAP_EPSILON) continue;

			const direction =
				distance > 0
					? { x: dx / distance, y: dy / distance }
					: zeroDistanceDirection(sourceId, targetId);
			const sourceShare = sourceAnchored ? 0 : targetAnchored ? 1 : 0.5;
			const targetShare = targetAnchored ? 0 : sourceAnchored ? 1 : 0.5;
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

export function relaxEdgeDistancesStep(
	positions: Record<string, Point>,
	radii: Record<string, number>,
	edges: EdgeEndpointIds[],
	settings: EdgeDistanceSettings,
	anchoredIds: Set<string> = new Set(),
	participatingNodeIds?: ReadonlySet<string>
): Record<string, Point> {
	const minGapFactor = Math.min(settings.edgeGapMinRadiusFactor, settings.edgeGapMaxRadiusFactor);
	const maxGapFactor = Math.max(settings.edgeGapMinRadiusFactor, settings.edgeGapMaxRadiusFactor);
	const springStrength = clamp(settings.edgeSpringStrength, 0, 1);
	if (springStrength === 0) return positions;

	const neighborDegree = neighborDegreeByNodeId(edges);
	const displacementByNodeId: Record<string, Point> = {};
	let moved = false;

	for (const edge of edges) {
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
		const sourceAnchored = anchoredIds.has(sourceId);
		const targetAnchored = anchoredIds.has(targetId);
		if (sourceAnchored && targetAnchored) continue;

		const dx = target.x - source.x;
		const dy = target.y - source.y;
		const distance = Math.hypot(dx, dy);
		const gap = distance - sourceRadius - targetRadius;
		const adjustment =
			gap > maxGap
				? (gap - maxGap) * springStrength
				: gap < minGap
					? (gap - minGap) * springStrength
					: 0;
		if (Math.abs(adjustment) <= OVERLAP_EPSILON) continue;

		const direction =
			distance > 0
				? { x: dx / distance, y: dy / distance }
				: zeroDistanceDirection(sourceId, targetId);
		const sourceShare = sourceAnchored ? 0 : targetAnchored ? 1 : 0.5;
		const targetShare = targetAnchored ? 0 : sourceAnchored ? 1 : 0.5;

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
	participatingNodeIds?: ReadonlySet<string>
): Record<string, Point> {
	let relaxed = positions;

	for (let index = 0; index < iterations; index += 1) {
		const next = relaxOverlapsStep(relaxed, radii, anchoredIds, participatingNodeIds);
		if (next === relaxed) return relaxed;
		relaxed = next;
	}

	return relaxed;
}

export function relaxOverlapsStep(
	positions: Record<string, Point>,
	radii: Record<string, number>,
	anchoredIds: Set<string> = new Set(),
	participatingNodeIds?: ReadonlySet<string>
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

			const sourceAnchored = anchoredIds.has(sourceId);
			const targetAnchored = anchoredIds.has(targetId);
			if (sourceAnchored && targetAnchored) continue;

			const direction =
				distance > 0
					? { x: dx / distance, y: dy / distance }
					: zeroDistanceDirection(sourceId, targetId);
			const sourceShare = sourceAnchored ? 0 : targetAnchored ? 1 : 0.5;
			const targetShare = targetAnchored ? 0 : sourceAnchored ? 1 : 0.5;

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
	return (
		nodeParticipates(sourceId, participatingNodeIds) &&
		nodeParticipates(targetId, participatingNodeIds)
	);
}

function zeroDistanceDirection(sourceId: string, targetId: string): Point {
	return sourceId < targetId ? { x: 1, y: 0 } : { x: -1, y: 0 };
}
