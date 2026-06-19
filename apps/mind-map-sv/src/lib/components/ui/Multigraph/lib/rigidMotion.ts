import type { Point } from '../../types/multigraph';

export interface RigidMotionSettings {
	normalizeRelaxationTranslation?: boolean;
	normalizeRelaxationRotation?: boolean;
	maxRelaxationRotationPerFrameRad?: number;
}

const DEFAULT_MAX_RELAXATION_ROTATION_PER_FRAME_RAD = Math.PI / 4;
const CENTERED_POSITION: Point = { x: 0, y: 0 };

export function normalizeRigidMotion(
	before: Record<string, Point>,
	after: Record<string, Point>,
	participatingNodeIds: Iterable<string>,
	anchoredNodeIds: ReadonlySet<string>,
	settings: RigidMotionSettings = {}
): Record<string, Point> {
	const nextPositions = clonePositions(after);
	const participatingIds = [...participatingNodeIds].filter(
		(nodeId) => before[nodeId] && after[nodeId]
	);
	const participatingAnchorIds = participatingIds.filter((nodeId) => anchoredNodeIds.has(nodeId));

	if (participatingAnchorIds.length >= 2) return nextPositions;

	const movableIds = participatingIds.filter((nodeId) => !anchoredNodeIds.has(nodeId));
	if (movableIds.length === 0) return nextPositions;

	const normalizeTranslation = settings.normalizeRelaxationTranslation ?? true;
	const normalizeRotation = settings.normalizeRelaxationRotation ?? true;

	if (participatingAnchorIds.length === 0) {
		return normalizeUnanchoredMotion(before, nextPositions, movableIds, {
			normalizeRelaxationTranslation: normalizeTranslation,
			normalizeRelaxationRotation: normalizeRotation,
			maxRelaxationRotationPerFrameRad:
				settings.maxRelaxationRotationPerFrameRad ?? DEFAULT_MAX_RELAXATION_ROTATION_PER_FRAME_RAD
		});
	}

	if (!normalizeRotation || movableIds.length < 2) return nextPositions;

	const anchorId = participatingAnchorIds[0];
	const beforeReference = before[anchorId] ?? CENTERED_POSITION;
	const afterReference = nextPositions[anchorId] ?? beforeReference;
	const theta = estimateRotation(
		before,
		nextPositions,
		movableIds,
		beforeReference,
		afterReference
	);
	const cap =
		settings.maxRelaxationRotationPerFrameRad ?? DEFAULT_MAX_RELAXATION_ROTATION_PER_FRAME_RAD;
	if (Math.abs(theta) > cap) return nextPositions;

	for (const nodeId of movableIds) {
		nextPositions[nodeId] = rotateAround(nextPositions[nodeId], afterReference, -theta);
	}

	return nextPositions;
}

function normalizeUnanchoredMotion(
	before: Record<string, Point>,
	after: Record<string, Point>,
	movableIds: readonly string[],
	settings: Required<RigidMotionSettings>
): Record<string, Point> {
	const beforeCentroid = centroid(before, movableIds);
	const afterCentroid = centroid(after, movableIds);
	const targetCentroid = settings.normalizeRelaxationTranslation ? beforeCentroid : afterCentroid;
	const theta =
		settings.normalizeRelaxationRotation && movableIds.length >= 2
			? estimateRotation(before, after, movableIds, beforeCentroid, afterCentroid)
			: 0;
	const shouldRotate =
		settings.normalizeRelaxationRotation &&
		movableIds.length >= 2 &&
		Math.abs(theta) <= settings.maxRelaxationRotationPerFrameRad;

	for (const nodeId of movableIds) {
		const centered = subtract(after[nodeId], afterCentroid);
		const corrected = shouldRotate ? rotateVector(centered, -theta) : centered;
		after[nodeId] = add(targetCentroid, corrected);
	}

	return after;
}

function clonePositions(positions: Record<string, Point>): Record<string, Point> {
	return Object.fromEntries(
		Object.entries(positions).map(([nodeId, position]) => [nodeId, { ...position }])
	);
}

function centroid(positions: Record<string, Point>, nodeIds: readonly string[]): Point {
	const total = nodeIds.reduce(
		(sum, nodeId) => ({
			x: sum.x + positions[nodeId].x,
			y: sum.y + positions[nodeId].y
		}),
		{ x: 0, y: 0 }
	);

	return {
		x: total.x / nodeIds.length,
		y: total.y / nodeIds.length
	};
}

function estimateRotation(
	before: Record<string, Point>,
	after: Record<string, Point>,
	nodeIds: readonly string[],
	beforeReference: Point,
	afterReference: Point
): number {
	let crossSum = 0;
	let dotSum = 0;

	for (const nodeId of nodeIds) {
		const p = subtract(before[nodeId], beforeReference);
		const q = subtract(after[nodeId], afterReference);
		crossSum += p.x * q.y - p.y * q.x;
		dotSum += p.x * q.x + p.y * q.y;
	}

	return Math.atan2(crossSum, dotSum);
}

function rotateAround(point: Point, reference: Point, angleRad: number): Point {
	return add(reference, rotateVector(subtract(point, reference), angleRad));
}

function rotateVector(point: Point, angleRad: number): Point {
	const cos = Math.cos(angleRad);
	const sin = Math.sin(angleRad);

	return {
		x: point.x * cos - point.y * sin,
		y: point.x * sin + point.y * cos
	};
}

function add(a: Point, b: Point): Point {
	return {
		x: a.x + b.x,
		y: a.y + b.y
	};
}

function subtract(a: Point, b: Point): Point {
	return {
		x: a.x - b.x,
		y: a.y - b.y
	};
}
