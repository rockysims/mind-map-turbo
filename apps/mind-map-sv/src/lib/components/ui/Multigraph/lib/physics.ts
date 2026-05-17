import type { Point } from '../../types/multigraph';

const OVERLAP_EPSILON = 0.001;

export interface EdgeDistanceSettings {
	edgeGapMinPx: number;
	edgeGapMaxPx: number;
	edgeSpringStrength: number;
}

export interface EdgeEndpointIds {
	sourceNodeId: string;
	targetNodeId: string;
}

export function relaxGraphPhysics(
	positions: Record<string, Point>,
	radii: Record<string, number>,
	edges: EdgeEndpointIds[],
	paddingPx: number,
	edgeDistanceSettings: EdgeDistanceSettings,
	iterations = 1,
	anchoredIds: Set<string> = new Set()
): Record<string, Point> {
	let relaxed = positions;

	for (let index = 0; index < iterations; index += 1) {
		const withRelaxedEdges = relaxEdgeDistancesStep(
			relaxed,
			radii,
			edges,
			edgeDistanceSettings,
			anchoredIds
		);
		const next = relaxOverlapsStep(withRelaxedEdges, radii, paddingPx, anchoredIds);
		if (next === relaxed) return relaxed;
		relaxed = next;
	}

	return relaxed;
}

export function relaxEdgeDistancesStep(
	positions: Record<string, Point>,
	radii: Record<string, number>,
	edges: EdgeEndpointIds[],
	settings: EdgeDistanceSettings,
	anchoredIds: Set<string> = new Set()
): Record<string, Point> {
	const minGap = Math.min(settings.edgeGapMinPx, settings.edgeGapMaxPx);
	const maxGap = Math.max(settings.edgeGapMinPx, settings.edgeGapMaxPx);
	const springStrength = clamp(settings.edgeSpringStrength, 0, 1);
	if (springStrength === 0) return positions;

	const nextPositions = clonePositions(positions);
	let moved = false;

	for (const edge of edges) {
		const sourceId = edge.sourceNodeId;
		const targetId = edge.targetNodeId;
		const source = nextPositions[sourceId];
		const target = nextPositions[targetId];
		const sourceRadius = radii[sourceId];
		const targetRadius = radii[targetId];
		if (!source || !target || sourceRadius === undefined || targetRadius === undefined) continue;

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

		nextPositions[sourceId] = {
			x: source.x + direction.x * adjustment * sourceShare,
			y: source.y + direction.y * adjustment * sourceShare
		};
		nextPositions[targetId] = {
			x: target.x - direction.x * adjustment * targetShare,
			y: target.y - direction.y * adjustment * targetShare
		};
		moved = true;
	}

	return moved ? nextPositions : positions;
}

export function relaxOverlaps(
	positions: Record<string, Point>,
	radii: Record<string, number>,
	paddingPx: number,
	iterations = 1,
	anchoredIds: Set<string> = new Set()
): Record<string, Point> {
	let relaxed = positions;

	for (let index = 0; index < iterations; index += 1) {
		const next = relaxOverlapsStep(relaxed, radii, paddingPx, anchoredIds);
		if (next === relaxed) return relaxed;
		relaxed = next;
	}

	return relaxed;
}

export function relaxOverlapsStep(
	positions: Record<string, Point>,
	radii: Record<string, number>,
	paddingPx: number,
	anchoredIds: Set<string> = new Set()
): Record<string, Point> {
	const nextPositions = clonePositions(positions);
	const nodeIds = Object.keys(positions).filter((nodeId) => radii[nodeId] !== undefined);
	let moved = false;

	for (let sourceIndex = 0; sourceIndex < nodeIds.length; sourceIndex += 1) {
		for (let targetIndex = sourceIndex + 1; targetIndex < nodeIds.length; targetIndex += 1) {
			const sourceId = nodeIds[sourceIndex];
			const targetId = nodeIds[targetIndex];
			const source = nextPositions[sourceId];
			const target = nextPositions[targetId];
			const minDistance = radii[sourceId] + radii[targetId] + paddingPx;
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

function clonePositions(positions: Record<string, Point>): Record<string, Point> {
	return Object.fromEntries(
		Object.entries(positions).map(([nodeId, point]) => [nodeId, { ...point }])
	);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function zeroDistanceDirection(sourceId: string, targetId: string): Point {
	return sourceId < targetId ? { x: 1, y: 0 } : { x: -1, y: 0 };
}
