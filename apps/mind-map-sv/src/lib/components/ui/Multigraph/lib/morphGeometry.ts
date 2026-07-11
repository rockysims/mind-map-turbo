import { APP_CONFIG } from '$lib/appConfig';
import type { Rect } from './zoomBoundary';

export interface MorphGeometry {
	x: number;
	y: number;
	width: number;
	height: number;
	borderRadiusPx: number;
}

export interface MorphGeometryOptions {
	ease?: (progress: number) => number;
	sourceRadiusPx?: number;
	targetRadiusPx?: number;
}

export function interpolateMorph(
	source: Rect,
	fill: Rect,
	progress: number,
	options: MorphGeometryOptions = {}
): MorphGeometry {
	const easedProgress = clamp01(options.ease?.(clamp01(progress)) ?? progress);
	const sourceRadiusPx = options.sourceRadiusPx ?? Math.min(source.width, source.height) / 2;
	const targetRadiusPx =
		options.targetRadiusPx ?? APP_CONFIG.multigraph.focus.detailsCornerRadiusPx;

	return {
		x: lerp(source.left, fill.left, easedProgress),
		y: lerp(source.top, fill.top, easedProgress),
		width: lerp(source.width, fill.width, easedProgress),
		height: lerp(source.height, fill.height, easedProgress),
		borderRadiusPx: lerp(sourceRadiusPx, targetRadiusPx, easedProgress)
	};
}

function lerp(from: number, to: number, progress: number): number {
	return from + (to - from) * progress;
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}
