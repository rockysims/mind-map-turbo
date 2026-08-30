/**
 * Pure zoom/pan math. No DOM or state — easy to unit test.
 */

import { APP_CONFIG } from '../../../../appConfig';
import type { Point } from '../../types/multigraph';

export const DEFAULT_MIN_SCALE = APP_CONFIG.multigraph.zoom.minScale;
export const DEFAULT_MAX_SCALE = APP_CONFIG.multigraph.zoom.maxScale;
export const DEFAULT_ZOOM_SENSITIVITY = 0.002;

export interface ViewTransform {
	panX: number;
	panY: number;
	scale: number;
}

export interface GraphBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export function clampScale(
	scale: number,
	min: number = DEFAULT_MIN_SCALE,
	max: number = DEFAULT_MAX_SCALE
): number {
	return Math.min(Math.max(scale, min), max);
}

/**
 * Compute new scale from wheel deltaY (e.g. from WheelEvent).
 * Positive deltaY = zoom out, negative = zoom in.
 *
 * Exponential, because zoom is multiplicative. Under the linear
 * `1 - deltaY * sensitivity` this used to be, the factor for `+d` was not the
 * reciprocal of the factor for `-d` — 0.8 out then 1.2 back in lands at 0.96 —
 * so rocking the wheel back and forth shrank the canvas about 4% per round
 * trip, measured at 0.665x after ten notches each way, until the graph was lost
 * off-screen. The linear form also crossed zero at `deltaY = 1/sensitivity`
 * (500 at the default), so one fast trackpad flick asked for a zero or negative
 * scale; `exp` cannot.
 *
 * The two agree to first order, so the sensitivity constant keeps its meaning.
 * `wheelDeltaForZoomFactor` is the exact inverse — use it rather than a magic
 * delta wherever a test needs a specific factor.
 */
export function scaleFromWheelDelta(
	currentScale: number,
	deltaY: number,
	sensitivity: number = DEFAULT_ZOOM_SENSITIVITY,
	min: number = DEFAULT_MIN_SCALE,
	max: number = DEFAULT_MAX_SCALE
): number {
	const factor = Math.exp(-deltaY * sensitivity);
	return clampScale(currentScale * factor, min, max);
}

/**
 * The wheel delta that asks to multiply the current scale by `factor`.
 *
 * The exact inverse of `scaleFromWheelDelta`'s factor, so a test can say what it
 * means — "zoom in 2x", not `-346.57` — and keep meaning it if the curve is ever
 * retuned. Stories used to hard-code deltas derived from the old linear form,
 * which is precisely why fixing that form broke them.
 */
export function wheelDeltaForZoomFactor(
	factor: number,
	sensitivity: number = DEFAULT_ZOOM_SENSITIVITY
): number {
	return -Math.log(factor) / sensitivity;
}

/** Pixels per line, for wheel events reported in `DOM_DELTA_LINE` units. */
const WHEEL_LINE_HEIGHT_PX = 16;

/**
 * A wheel event's deltaY in pixels, whatever unit the browser reported it in.
 *
 * `WheelEvent.deltaY` is only in pixels when `deltaMode` is `DOM_DELTA_PIXEL`.
 * Firefox reports a mouse wheel in *lines* (`deltaY` ≈ 3 per notch), which
 * through the zoom sensitivity above is a 0.6% step — the same notch that moves
 * a Chrome user 18%. Pages (`DOM_DELTA_PAGE`) are rarer still but cost nothing
 * to handle.
 *
 * The viewport height is a parameter rather than read from `window` so this
 * stays pure; callers that have no viewport can leave it at the default.
 */
export function wheelDeltaPixels(
	event: { deltaY: number; deltaMode?: number },
	viewportHeightPx = 800
): number {
	const DOM_DELTA_LINE = 1;
	const DOM_DELTA_PAGE = 2;
	if (event.deltaMode === DOM_DELTA_LINE) return event.deltaY * WHEEL_LINE_HEIGHT_PX;
	if (event.deltaMode === DOM_DELTA_PAGE) return event.deltaY * viewportHeightPx;
	return event.deltaY;
}

/**
 * Adjust pan while zooming so the graph point under the focal client point
 * remains under that same client point after scaling.
 */
export function zoomViewTransformAtPoint(
	current: ViewTransform,
	nextScale: number,
	focalClientPoint: Point,
	stageCenter: Point
): ViewTransform {
	const graphX = (focalClientPoint.x - stageCenter.x - current.panX) / current.scale;
	const graphY = (focalClientPoint.y - stageCenter.y - current.panY) / current.scale;

	return {
		panX: focalClientPoint.x - stageCenter.x - graphX * nextScale,
		panY: focalClientPoint.y - stageCenter.y - graphY * nextScale,
		scale: nextScale
	};
}

export function fitGraphBoundsInView(
	bounds: GraphBounds,
	viewport: { width: number; height: number },
	options: { paddingPx?: number; minScale?: number; maxScale?: number } = {}
): ViewTransform {
	const paddingPx = Math.max(0, options.paddingPx ?? 80);
	const availableWidth = Math.max(1, viewport.width - paddingPx * 2);
	const availableHeight = Math.max(1, viewport.height - paddingPx * 2);
	const boundsWidth = Math.max(1, bounds.maxX - bounds.minX);
	const boundsHeight = Math.max(1, bounds.maxY - bounds.minY);
	const scale = clampScale(
		Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight),
		options.minScale,
		options.maxScale
	);
	const centerX = (bounds.minX + bounds.maxX) / 2;
	const centerY = (bounds.minY + bounds.maxY) / 2;

	return {
		panX: -centerX * scale,
		panY: -centerY * scale,
		scale
	};
}

/** Distance between two points (e.g. two touch points). */
export function distance(x1: number, y1: number, x2: number, y2: number): number {
	return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

/**
 * Scale factor to apply when pinch distance goes from prevDistance to currDistance.
 * E.g. prevDistance 100, currDistance 200 → return 2.
 */
export function pinchScaleFactor(prevDistance: number, currDistance: number): number {
	if (prevDistance <= 0) return 1;
	return currDistance / prevDistance;
}
