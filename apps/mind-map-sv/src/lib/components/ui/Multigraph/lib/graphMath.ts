/**
 * Pure zoom/pan math. No DOM or state — easy to unit test.
 */

export const DEFAULT_MIN_SCALE = 0.25;
export const DEFAULT_MAX_SCALE = 4;
export const DEFAULT_ZOOM_SENSITIVITY = 0.002;

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
 */
export function scaleFromWheelDelta(
	currentScale: number,
	deltaY: number,
	sensitivity: number = DEFAULT_ZOOM_SENSITIVITY,
	min: number = DEFAULT_MIN_SCALE,
	max: number = DEFAULT_MAX_SCALE
): number {
	const factor = 1 - deltaY * sensitivity;
	return clampScale(currentScale * factor, min, max);
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
