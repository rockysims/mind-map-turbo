import { APP_CONFIG } from '$lib/appConfig';
import type { Point } from '../../types/multigraph';
import { scaleFromWheelDelta } from './graphMath';
import { clampRectToCoverViewport, type Rect, type ViewportSize } from './zoomBoundary';

export interface ZoomWorldState {
	panX: number;
	panY: number;
	scale: number;
}

export interface ZoomWorldBounds extends ViewportSize {
	subjectWidth: number;
	subjectHeight: number;
	minScale?: number;
	maxScale?: number;
	wheelSensitivity?: number;
	exitDeltaScale?: number;
}

export interface ZoomWorldStep {
	state: ZoomWorldState;
	exitBoundaryDelta: number;
}

export function worldRectForState(state: ZoomWorldState, bounds: ZoomWorldBounds): Rect {
	const width = bounds.subjectWidth * state.scale;
	const height = bounds.subjectHeight * state.scale;
	return {
		left: bounds.width / 2 + state.panX - width / 2,
		top: bounds.height / 2 + state.panY - height / 2,
		width,
		height
	};
}

export function clampZoomWorldState(
	state: ZoomWorldState,
	bounds: ZoomWorldBounds
): ZoomWorldState {
	const rect = worldRectForState(state, bounds);
	const clamped = clampRectToCoverViewport(rect, bounds);
	return {
		...state,
		panX: state.panX + clamped.dx,
		panY: state.panY + clamped.dy
	};
}

export function zoomWorldAtPoint(
	state: ZoomWorldState,
	nextScale: number,
	focalPoint: Point,
	bounds: ZoomWorldBounds
): ZoomWorldState {
	const limits = zoomWorldScaleLimits(bounds);
	const scale = clamp(nextScale, limits.minScale, limits.maxScale);
	const viewportCenter = { x: bounds.width / 2, y: bounds.height / 2 };
	const worldX = (focalPoint.x - viewportCenter.x - state.panX) / state.scale;
	const worldY = (focalPoint.y - viewportCenter.y - state.panY) / state.scale;
	return clampZoomWorldState(
		{
			scale,
			panX: focalPoint.x - viewportCenter.x - worldX * scale,
			panY: focalPoint.y - viewportCenter.y - worldY * scale
		},
		bounds
	);
}

export function wheelZoomWorld(
	state: ZoomWorldState,
	deltaY: number,
	focalPoint: Point,
	bounds: ZoomWorldBounds
): ZoomWorldStep {
	const limits = zoomWorldScaleLimits(bounds);
	const requestedScale = scaleFromWheelDelta(
		state.scale,
		deltaY,
		bounds.wheelSensitivity ?? APP_CONFIG.multigraph.focus.worldWheelSensitivity,
		Number.NEGATIVE_INFINITY,
		Number.POSITIVE_INFINITY
	);

	if (deltaY > 0 && state.scale <= limits.minScale + 0.001 && requestedScale < limits.minScale) {
		return {
			state: { panX: 0, panY: 0, scale: limits.minScale },
			exitBoundaryDelta: Math.min(
				1,
				Math.abs(deltaY) /
					(bounds.exitDeltaScale ?? APP_CONFIG.multigraph.focus.exitOvershootDeltaScale)
			)
		};
	}

	return {
		state: zoomWorldAtPoint(state, requestedScale, focalPoint, bounds),
		exitBoundaryDelta: 0
	};
}

export function pinchZoomWorld(
	state: ZoomWorldState,
	startScale: number,
	distanceRatio: number,
	focalPoint: Point,
	bounds: ZoomWorldBounds
): ZoomWorldState {
	return zoomWorldAtPoint(state, startScale * distanceRatio, focalPoint, bounds);
}

export function zoomWorldScaleLimits(bounds: ZoomWorldBounds): {
	minScale: number;
	maxScale: number;
} {
	const minScale = bounds.minScale ?? 1;
	const maxScale = Math.max(
		minScale,
		bounds.maxScale ?? APP_CONFIG.multigraph.focus.imageZoomMaxScale
	);
	return { minScale, maxScale };
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
