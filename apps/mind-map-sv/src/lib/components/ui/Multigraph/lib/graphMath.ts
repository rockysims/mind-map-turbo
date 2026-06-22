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
