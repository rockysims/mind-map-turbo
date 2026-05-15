import type { Point } from '../../types/multigraph';

const OVERLAP_EPSILON = 0.001;

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

function zeroDistanceDirection(sourceId: string, targetId: string): Point {
	return sourceId < targetId ? { x: 1, y: 0 } : { x: -1, y: 0 };
}
