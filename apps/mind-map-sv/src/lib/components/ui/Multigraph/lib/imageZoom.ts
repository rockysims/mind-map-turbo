import { APP_CONFIG } from '$lib/appConfig';
import type { Point } from '../../types/multigraph';

export interface ImageZoomState {
	panX: number;
	panY: number;
	scale: number;
}

export interface ImageZoomBounds {
	viewportWidth: number;
	viewportHeight: number;
	naturalWidth: number;
	naturalHeight: number;
	minScale?: number;
	maxScale?: number;
}

export function imageFitScale(bounds: ImageZoomBounds): number {
	return Math.min(
		bounds.viewportWidth / bounds.naturalWidth,
		bounds.viewportHeight / bounds.naturalHeight,
		1
	);
}

export function imageZoomLimits(bounds: ImageZoomBounds): { minScale: number; maxScale: number } {
	const fit = imageFitScale(bounds);
	const minScale = bounds.minScale ?? fit * APP_CONFIG.multigraph.focus.imageZoomMinScale;
	const maxScale = Math.max(
		minScale,
		bounds.maxScale ?? fit * APP_CONFIG.multigraph.focus.imageZoomMaxScale
	);
	return { minScale, maxScale };
}

export function clampImageZoomState(
	state: ImageZoomState,
	bounds: ImageZoomBounds
): ImageZoomState {
	const limits = imageZoomLimits(bounds);
	const scale = Math.min(limits.maxScale, Math.max(limits.minScale, state.scale));
	const halfWidth = (bounds.naturalWidth * scale) / 2;
	const halfHeight = (bounds.naturalHeight * scale) / 2;
	const maxPanX = Math.max(0, halfWidth - bounds.viewportWidth / 2);
	const maxPanY = Math.max(0, halfHeight - bounds.viewportHeight / 2);
	return {
		scale,
		panX: clamp(state.panX, -maxPanX, maxPanX),
		panY: clamp(state.panY, -maxPanY, maxPanY)
	};
}

export function zoomImageAtPoint(
	state: ImageZoomState,
	nextScale: number,
	focalPoint: Point,
	viewportCenter: Point,
	bounds: ImageZoomBounds
): ImageZoomState {
	const imageX = (focalPoint.x - viewportCenter.x - state.panX) / state.scale;
	const imageY = (focalPoint.y - viewportCenter.y - state.panY) / state.scale;
	return clampImageZoomState(
		{
			scale: nextScale,
			panX: focalPoint.x - viewportCenter.x - imageX * nextScale,
			panY: focalPoint.y - viewportCenter.y - imageY * nextScale
		},
		bounds
	);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
