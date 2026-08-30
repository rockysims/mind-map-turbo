/**
 * The camera move that makes an arriving component visible without taking the
 * reader's own work off the screen.
 *
 * Pure: no DOM, no state, no time source of its own. `Stage` owns pan/zoom, so
 * everything here is expressed in the same terms its `viewStateRequest` accepts.
 */

import type { Point } from '../../types/multigraph';
import { clampScale, DEFAULT_MAX_SCALE, DEFAULT_MIN_SCALE } from './graphMath';
import { easeInOut } from './elementTransitions';

/** Pan/zoom exactly as `Stage` holds it. */
export interface CameraViewState {
	panX: number;
	panY: number;
	scale: number;
}

export interface StageSize {
	width: number;
	height: number;
}

/** A world-space (graph-coordinate) axis-aligned rectangle. */
export interface WorldRect {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export interface RevealCircle {
	center: Point;
	radius: number;
}

interface MinimalRevealViewInput {
	/** World rect the reader can see right now (see `viewportWorldRect`). */
	viewport: WorldRect;
	/** The circle that has to become visible. */
	target: RevealCircle;
	stage: StageSize;
	/** Comfortable world-space breathing room around the target circle. */
	margin?: number;
	minScale?: number;
	maxScale?: number;
}

/**
 * The world rect a view state shows on a stage of this size.
 *
 * Mirrors `stageCoordinates`: a world point lands at
 * `stageCenter + pan + world * scale`, so the visible half-extent is
 * `stage.width / (2 * scale)` around the world point `-panX / scale`.
 */
export function viewportWorldRect(view: CameraViewState, stage: StageSize): WorldRect {
	const scale = Math.max(view.scale, EPSILON);
	const halfWidth = stage.width / (2 * scale);
	const halfHeight = stage.height / (2 * scale);
	const centerX = -view.panX / scale;
	const centerY = -view.panY / scale;

	return {
		minX: centerX - halfWidth,
		minY: centerY - halfHeight,
		maxX: centerX + halfWidth,
		maxY: centerY + halfHeight
	};
}

/** True when `inner` lies wholly within `outer` (touching edges count as inside). */
export function rectContainsRect(outer: WorldRect, inner: WorldRect): boolean {
	return (
		inner.minX >= outer.minX &&
		inner.maxX <= outer.maxX &&
		inner.minY >= outer.minY &&
		inner.maxY <= outer.maxY
	);
}

/**
 * The smallest camera change that makes `target` visible while keeping
 * everything the reader can see right now visible too.
 *
 * Frames the union of the current viewport and the target's padded rect: the
 * scale is the largest one that still fits that union and never exceeds the
 * current scale (zooming *in* could push the reader's own work off screen), and
 * the pan is the current viewport centre moved the least distance that still
 * contains the union.
 *
 * Returns null when the target is already comfortably on screen — the reveal is
 * then a no-op rather than a nudge.
 *
 * When the union cannot fit even at `minScale`, the union is centred instead:
 * "as much of both as the zoom floor allows" is the only honest answer left.
 */
export function minimalRevealView(input: MinimalRevealViewInput): CameraViewState | null {
	const { viewport, target, stage } = input;
	const minScale = input.minScale ?? DEFAULT_MIN_SCALE;
	const maxScale = input.maxScale ?? DEFAULT_MAX_SCALE;
	const margin = Math.max(0, input.margin ?? 0);
	const padded = Math.max(0, target.radius) + margin;
	const targetRect: WorldRect = {
		minX: target.center.x - padded,
		minY: target.center.y - padded,
		maxX: target.center.x + padded,
		maxY: target.center.y + padded
	};

	if (rectContainsRect(viewport, targetRect)) return null;

	const union: WorldRect = {
		minX: Math.min(viewport.minX, targetRect.minX),
		minY: Math.min(viewport.minY, targetRect.minY),
		maxX: Math.max(viewport.maxX, targetRect.maxX),
		maxY: Math.max(viewport.maxY, targetRect.maxY)
	};

	// Recovered from the rect rather than taken as a second input, so the
	// viewport and the scale can never describe two different cameras.
	const currentScale = stage.width / Math.max(viewport.maxX - viewport.minX, EPSILON);
	const fitScale = Math.min(
		stage.width / Math.max(union.maxX - union.minX, EPSILON),
		stage.height / Math.max(union.maxY - union.minY, EPSILON)
	);
	const scale = clampScale(Math.min(currentScale, fitScale), minScale, maxScale);

	const halfWidth = stage.width / (2 * scale);
	const halfHeight = stage.height / (2 * scale);
	const centerX = containingCenter(
		(viewport.minX + viewport.maxX) / 2,
		union.minX,
		union.maxX,
		halfWidth
	);
	const centerY = containingCenter(
		(viewport.minY + viewport.maxY) / 2,
		union.minY,
		union.maxY,
		halfHeight
	);

	return { panX: -centerX * scale, panY: -centerY * scale, scale };
}

/**
 * A time-boxed travel between two cameras, in the shape the other animations
 * here use.
 *
 * Cheap to rebuild: the import reveal re-aims `to` every frame at an arrival the
 * layout is still moving, keeping `from` and `startedAtMs` fixed so the easing
 * stays one continuous flight rather than restarting under the reader.
 */
interface CameraTween {
	from: CameraViewState;
	to: CameraViewState;
	startedAtMs: number;
	durationMs: number;
}

/**
 * The camera partway through a tween.
 *
 * Interpolates the world point at the screen centre rather than `pan` directly:
 * pan is a screen-space offset scaled by the zoom, so lerping it while the zoom
 * changes swings the view out and back. The centre is what the reader watches
 * travel, so that is what moves at a constant eased rate.
 */
export function cameraViewAt(tween: CameraTween, nowMs: number): CameraViewState {
	const progress = easeInOut(tweenProgress(tween, nowMs));
	const scale = lerp(tween.from.scale, tween.to.scale, progress);
	const centerX = lerp(worldCenterX(tween.from), worldCenterX(tween.to), progress);
	const centerY = lerp(worldCenterY(tween.from), worldCenterY(tween.to), progress);

	return { panX: -centerX * scale, panY: -centerY * scale, scale };
}

/**
 * A reveal in flight, as the frame loop needs to see it.
 *
 * `viewport` is frozen at the reader's departing view for the whole pursuit.
 * That is what makes re-aiming safe: the goal moves only because the target
 * moved, never because the camera has already travelled — otherwise each frame's
 * zoom-out would widen the rect the next frame promises to keep, and the reveal
 * would walk away on its own.
 */
export interface RevealPursuit {
	/** The camera the reader had when the arrival was adopted. */
	from: CameraViewState;
	viewport: WorldRect;
	stage: StageSize;
	startedAtMs: number;
	/** Flight time. Also the earliest the pursuit may declare itself finished. */
	durationMs: number;
	/** Wall-clock time after which the pursuit gives up regardless. */
	deadlineMs: number;
	/** Breathing room around the target, as a fraction of its own radius. */
	marginRadiusFactor: number;
	minScale?: number;
	maxScale?: number;
	/** Reduced motion: no per-frame camera, just the one landing correction. */
	instant?: boolean;
}

interface RevealPursuitInput {
	pursuit: RevealPursuit;
	/** Where the arrival is drawn right now. */
	target: RevealCircle;
	/** Where it was on the previous frame, for deciding whether it has come to rest. */
	previousTarget: RevealCircle;
	nowMs: number;
	/** Per-frame movement at or below which the arrival counts as settled. */
	restEpsilon: number;
}

interface RevealPursuitStep {
	/** The camera to apply this frame. Null means leave the camera alone. */
	view: CameraViewState | null;
	/** Where the camera belongs once the chase is over. Null when no reveal is owed. */
	goal: CameraViewState | null;
	/** True when the pursuit should stop after applying `goal`. */
	done: boolean;
}

/**
 * One frame of a reveal that chases a still-settling arrival.
 *
 * Committing an import does not finish the layout — radii are still growing and
 * the seam forces are still pushing the new component clear — so a camera aimed
 * once at the position read just after the commit lands where the node used to
 * be. Re-framing every frame against the frozen departing viewport fixes that
 * without restarting the easing: `from` and `startedAtMs` hold still while only
 * `to` is refreshed.
 *
 * A null goal means the arrival is already inside the rect the reader had, so
 * nothing is owed and nothing is applied — writing the departing camera back
 * every frame would fight a reader who started panning during the flight.
 */
export function revealPursuitStep(input: RevealPursuitInput): RevealPursuitStep {
	const { pursuit, target, previousTarget, nowMs, restEpsilon } = input;
	const goal = minimalRevealView({
		viewport: pursuit.viewport,
		target,
		stage: pursuit.stage,
		margin: target.radius * pursuit.marginRadiusFactor,
		minScale: pursuit.minScale,
		maxScale: pursuit.maxScale
	});
	const view =
		pursuit.instant === true || goal === null
			? null
			: cameraViewAt(
					{
						from: pursuit.from,
						to: goal,
						startedAtMs: pursuit.startedAtMs,
						durationMs: pursuit.durationMs
					},
					nowMs
				);
	const drift = Math.max(
		Math.abs(target.center.x - previousTarget.center.x),
		Math.abs(target.center.y - previousTarget.center.y),
		Math.abs(target.radius - previousTarget.radius)
	);
	const flightOver = nowMs - pursuit.startedAtMs >= pursuit.durationMs;
	const done = nowMs >= pursuit.deadlineMs || (flightOver && drift <= restEpsilon);

	return { view, goal, done };
}

const EPSILON = 1e-9;

function worldCenterX(view: CameraViewState): number {
	return -view.panX / Math.max(view.scale, EPSILON);
}

function worldCenterY(view: CameraViewState): number {
	return -view.panY / Math.max(view.scale, EPSILON);
}

function tweenProgress(tween: CameraTween, nowMs: number): number {
	if (tween.durationMs <= 0) return 1;
	return Math.min(1, Math.max(0, (nowMs - tween.startedAtMs) / tween.durationMs));
}

function lerp(from: number, to: number, progress: number): number {
	return from + (to - from) * progress;
}

/**
 * The viewport centre nearest `current` whose half-extent still spans
 * `[min, max]`. When the span is wider than the viewport there is no such
 * centre, so the span is centred instead.
 */
function containingCenter(current: number, min: number, max: number, half: number): number {
	const lowest = max - half;
	const highest = min + half;
	if (lowest > highest) return (min + max) / 2;
	return Math.min(Math.max(current, lowest), highest);
}
