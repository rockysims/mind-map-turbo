import { APP_CONFIG } from '$lib/appConfig';
import type { Point } from '../../types/multigraph';
import type { NodeData } from '../../types/node';
import { graphPointToClientPoint, type StageRect } from './stageCoordinates';

export interface ViewTransform {
	panX: number;
	panY: number;
	scale: number;
}

export interface NodeFocusCandidate {
	node: NodeData;
	position: Point;
	radius: number;
	zIndex?: number;
}

export interface ScreenCircle {
	nodeId: string;
	center: Point;
	radius: number;
}

export interface OvershootState {
	progress: number;
	lastInputAt: number | null;
	lastCommitAt: number | null;
	committed: boolean;
}

export interface OvershootOptions {
	commitThreshold?: number;
	decayHalfLifeMs?: number;
	hysteresisMs?: number;
}

export const DEFAULT_OVERSHOOT_OPTIONS = {
	commitThreshold: APP_CONFIG.multigraph.focus.overshootCommitThreshold,
	decayHalfLifeMs: APP_CONFIG.multigraph.focus.overshootDecayHalfLifeMs,
	hysteresisMs: APP_CONFIG.multigraph.focus.overshootHysteresisMs
};

export const EMPTY_OVERSHOOT_STATE: OvershootState = {
	progress: 0,
	lastInputAt: null,
	lastCommitAt: null,
	committed: false
};

export function nodeScreenCircle(
	nodeId: string,
	position: Point,
	radius: number,
	stageRect: StageRect,
	view: ViewTransform
): ScreenCircle {
	return {
		nodeId,
		center: graphPointToClientPoint(
			position,
			stageRect,
			{ x: view.panX, y: view.panY },
			view.scale
		),
		radius: radius * view.scale
	};
}

export function focalNodeForPoint(
	candidates: readonly NodeFocusCandidate[],
	focalPoint: Point,
	stageRect: StageRect,
	view: ViewTransform,
	options: { coverageRatio?: number } = {}
): NodeFocusCandidate | null {
	const coverageRatio =
		options.coverageRatio ?? APP_CONFIG.multigraph.focus.eligibilityCoverageRatio;
	const hits = candidates.filter((candidate) => {
		const circle = nodeScreenCircle(
			candidate.node.id,
			candidate.position,
			candidate.radius,
			stageRect,
			view
		);
		return distance(circle.center, focalPoint) <= circle.radius * coverageRatio;
	});
	if (hits.length === 0) return null;
	return hits.toSorted((left, right) => (right.zIndex ?? 0) - (left.zIndex ?? 0))[0] ?? null;
}

export function overshootInput(
	state: OvershootState,
	blockedZoomFactor: number,
	nowMs: number,
	options: OvershootOptions = {}
): OvershootState {
	const resolved = { ...DEFAULT_OVERSHOOT_OPTIONS, ...options };
	if (state.lastCommitAt !== null && nowMs - state.lastCommitAt < resolved.hysteresisMs) {
		return { ...state, committed: false, lastInputAt: nowMs };
	}

	const decayed = decayOvershoot(state, nowMs, resolved);
	const progress = Math.min(1, decayed.progress + Math.max(0, Math.abs(blockedZoomFactor)));
	const committed = progress >= resolved.commitThreshold;
	return {
		progress: committed ? 1 : progress,
		lastInputAt: nowMs,
		lastCommitAt: committed ? nowMs : state.lastCommitAt,
		committed
	};
}

export function decayOvershoot(
	state: OvershootState,
	nowMs: number,
	options: OvershootOptions = {}
): OvershootState {
	const resolved = { ...DEFAULT_OVERSHOOT_OPTIONS, ...options };
	if (state.lastInputAt === null || state.progress <= 0) return { ...state, committed: false };
	const elapsed = Math.max(0, nowMs - state.lastInputAt);
	const decayFactor = 0.5 ** (elapsed / resolved.decayHalfLifeMs);
	const progress = state.progress * decayFactor;
	return {
		...state,
		progress: progress < 0.001 ? 0 : progress,
		committed: false
	};
}

export function resetOvershootAfterCommit(nowMs: number): OvershootState {
	return {
		progress: 0,
		lastInputAt: nowMs,
		lastCommitAt: nowMs,
		committed: false
	};
}

function distance(left: Point, right: Point): number {
	return Math.hypot(left.x - right.x, left.y - right.y);
}
