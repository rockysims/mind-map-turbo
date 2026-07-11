import { APP_CONFIG } from '$lib/appConfig';
import type { Point } from '../../types/multigraph';
import { scaleFromWheelDelta } from './graphMath';
import {
	centeredFitForRect,
	clampRectToCoverViewport,
	entryProgress,
	exitProgress,
	type Rect,
	type ViewportSize
} from './zoomBoundary';

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
	entryInscribeScale?: number;
	entryZoneFraction?: number;
	exitZoneFraction?: number;
	/**
	 * Zone above `maxScale` used to report descend pressure, symmetric to
	 * `exitZoneFraction` below `minScale`. A single bold wheel-in that requests a
	 * scale at/above `maxScale * (1 + entryBoundaryZoneFraction)` yields a full
	 * `entryBoundaryDelta` of 1; a gentle press reports a proportional fraction.
	 */
	entryBoundaryZoneFraction?: number;
}

export interface ZoomWorldStep {
	state: ZoomWorldState;
	exitBoundaryDelta: number;
	/**
	 * Fraction of zoom-in pressure applied while already clamped at `maxScale`
	 * (0 when not blocked at max, > 0 when a zoom-in is blocked at max, 0 for any
	 * zoom-out). Symmetric to `exitBoundaryDelta`; the world accumulates it to
	 * trigger a descend into a nested subject.
	 */
	entryBoundaryDelta: number;
	entryProgress: number;
	exitProgress: number;
	boundary: 'descend' | 'ascend' | null;
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
	const exitZoneFraction =
		bounds.exitZoneFraction ?? APP_CONFIG.multigraph.focus.subFitExitZoneFraction;
	const requestedScale = scaleFromWheelDelta(
		state.scale,
		deltaY,
		bounds.wheelSensitivity ?? APP_CONFIG.multigraph.focus.worldWheelSensitivity,
		Number.NEGATIVE_INFINITY,
		Number.POSITIVE_INFINITY
	);

	if (deltaY > 0 && requestedScale < limits.minScale) {
		const fitState = clampZoomWorldState({ ...state, scale: limits.minScale }, bounds);
		const centeredFit = centeredFitForRect(worldRectForState(fitState, bounds), bounds).centeredFit;
		const exitScale = centeredFit
			? clamp(requestedScale, limits.minScale * (1 - exitZoneFraction), limits.minScale)
			: limits.minScale;
		const progress = centeredFit ? exitProgress(exitScale, limits.minScale, exitZoneFraction) : 1;
		return {
			state: fitState,
			exitBoundaryDelta: 1 - progress,
			entryBoundaryDelta: 0,
			entryProgress: 0,
			exitProgress: progress,
			boundary: progress <= 0 ? 'ascend' : null
		};
	}

	const stateAfterZoom = zoomWorldAtPoint(state, requestedScale, focalPoint, bounds);
	const inscribeScale = bounds.entryInscribeScale;
	const progress =
		deltaY < 0 && inscribeScale !== undefined
			? entryProgress(
					stateAfterZoom.scale,
					inscribeScale,
					bounds.entryZoneFraction ?? APP_CONFIG.multigraph.focus.preInscribeZoneFraction
				)
			: 0;

	// Descend pressure: a zoom-in whose requested scale overshoots `maxScale`
	// reports the fraction of that overshoot within the entry-boundary zone,
	// mirroring how the exit branch reports zoom-out pressure past `minScale`.
	const entryBoundaryDelta = descendBoundaryDelta(deltaY, requestedScale, limits.maxScale, bounds);

	return {
		state: stateAfterZoom,
		exitBoundaryDelta: 0,
		entryBoundaryDelta,
		entryProgress: progress,
		exitProgress: 1,
		boundary:
			inscribeScale !== undefined && deltaY < 0 && state.scale < inscribeScale && progress >= 1
				? 'descend'
				: null
	};
}

function descendBoundaryDelta(
	deltaY: number,
	requestedScale: number,
	maxScale: number,
	bounds: ZoomWorldBounds
): number {
	if (deltaY >= 0 || requestedScale <= maxScale) return 0;
	const zoneFraction = Math.max(
		0,
		bounds.entryBoundaryZoneFraction ?? APP_CONFIG.multigraph.focus.preInscribeZoneFraction
	);
	const zoneEnd = maxScale * (1 + zoneFraction);
	if (zoneEnd <= maxScale) return 1;
	const pressed = clamp(requestedScale, maxScale, zoneEnd);
	return clamp((pressed - maxScale) / (zoneEnd - maxScale), 0, 1);
}

export interface PinchZoomWorldStep {
	state: ZoomWorldState;
	entryProgress: number;
	boundary: 'descend' | null;
}

export function pinchZoomWorldStep(
	state: ZoomWorldState,
	startScale: number,
	distanceRatio: number,
	focalPoint: Point,
	bounds: ZoomWorldBounds
): PinchZoomWorldStep {
	const next = pinchZoomWorld(state, startScale, distanceRatio, focalPoint, bounds);
	const inscribeScale = bounds.entryInscribeScale;
	const progress =
		inscribeScale === undefined
			? 0
			: entryProgress(
					next.scale,
					inscribeScale,
					bounds.entryZoneFraction ?? APP_CONFIG.multigraph.focus.preInscribeZoneFraction
				);
	return {
		state: next,
		entryProgress: progress,
		boundary:
			inscribeScale !== undefined &&
			distanceRatio > 1 &&
			state.scale < inscribeScale &&
			progress >= 1
				? 'descend'
				: null
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
	const fitScale =
		bounds.subjectWidth > 0 && bounds.subjectHeight > 0
			? Math.min(bounds.width / bounds.subjectWidth, bounds.height / bounds.subjectHeight, 1)
			: 1;
	const minScale = bounds.minScale ?? fitScale;
	const maxScale = Math.max(minScale, bounds.maxScale ?? APP_CONFIG.multigraph.focus.worldMaxScale);
	return { minScale, maxScale };
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
