import { APP_CONFIG } from '$lib/appConfig';
import type { Point } from '../../types/multigraph';

export interface ViewportSize {
	width: number;
	height: number;
}

export interface Rect {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface Circle {
	center: Point;
	radius: number;
}

export interface AxisContact {
	start: boolean;
	end: boolean;
	inscribed: boolean;
}

export interface InscribedContact {
	x: AxisContact;
	y: AxisContact;
	inscribed: boolean;
}

export interface ClampResult {
	rect: Rect;
	dx: number;
	dy: number;
}

export interface CenteredFitResult {
	fits: boolean;
	centered: boolean;
	centeredFit: boolean;
}

export function rectRight(rect: Rect): number {
	return rect.left + rect.width;
}

export function rectBottom(rect: Rect): number {
	return rect.top + rect.height;
}

export function circleToRect(circle: Circle): Rect {
	return {
		left: circle.center.x - circle.radius,
		top: circle.center.y - circle.radius,
		width: circle.radius * 2,
		height: circle.radius * 2
	};
}

export function inscribedContactForRect(
	rect: Rect,
	viewport: ViewportSize,
	marginPx: number = APP_CONFIG.multigraph.focus.boundaryNearTouchMarginPx
): InscribedContact {
	const x = axisContact(rect.left, rectRight(rect), viewport.width, marginPx);
	const y = axisContact(rect.top, rectBottom(rect), viewport.height, marginPx);
	return {
		x,
		y,
		inscribed: x.inscribed || y.inscribed
	};
}

export function inscribedContactForCircle(
	circle: Circle,
	viewport: ViewportSize,
	marginPx: number = APP_CONFIG.multigraph.focus.boundaryNearTouchMarginPx
): InscribedContact {
	return inscribedContactForRect(circleToRect(circle), viewport, marginPx);
}

export function inscribeScaleForRect(
	subject: Pick<Rect, 'width' | 'height'>,
	viewport: ViewportSize
): number {
	if (subject.width <= 0 || subject.height <= 0) return 1;
	return Math.min(viewport.width / subject.width, viewport.height / subject.height);
}

export function inscribeScaleForCircle(radius: number, viewport: ViewportSize): number {
	return inscribeScaleForRect({ width: radius * 2, height: radius * 2 }, viewport);
}

export function clampRectForEntrySteering(
	rect: Rect,
	viewport: ViewportSize,
	marginPx = 0
): ClampResult {
	const dx = entryAxisDelta(rect.left, rectRight(rect), viewport.width, marginPx);
	const dy = entryAxisDelta(rect.top, rectBottom(rect), viewport.height, marginPx);
	return {
		rect: translateRect(rect, dx, dy),
		dx,
		dy
	};
}

export function clampRectToCoverViewport(
	rect: Rect,
	viewport: ViewportSize,
	marginPx = 0
): ClampResult {
	const dx = coverAxisDelta(rect.left, rectRight(rect), viewport.width, marginPx);
	const dy = coverAxisDelta(rect.top, rectBottom(rect), viewport.height, marginPx);
	return {
		rect: translateRect(rect, dx, dy),
		dx,
		dy
	};
}

export function entryProgress(
	scale: number,
	inscribeScale: number,
	zoneFraction: number = APP_CONFIG.multigraph.focus.preInscribeZoneFraction
): number {
	if (inscribeScale <= 0) return 0;
	const zoneStart = inscribeScale * (1 - clamp01(zoneFraction));
	if (inscribeScale <= zoneStart) return scale >= inscribeScale ? 1 : 0;
	return clamp01((scale - zoneStart) / (inscribeScale - zoneStart));
}

export function exitProgress(
	scale: number,
	fitScale: number,
	zoneFraction: number = APP_CONFIG.multigraph.focus.subFitExitZoneFraction
): number {
	if (fitScale <= 0) return 0;
	const zoneEnd = fitScale * (1 - clamp01(zoneFraction));
	if (fitScale <= zoneEnd) return scale >= fitScale ? 1 : 0;
	return clamp01((scale - zoneEnd) / (fitScale - zoneEnd));
}

export function centeredFitForRect(
	rect: Rect,
	viewport: ViewportSize,
	marginPx: number = APP_CONFIG.multigraph.focus.boundaryNearTouchMarginPx
): CenteredFitResult {
	const fits =
		rect.width <= viewport.width + marginPx * 2 && rect.height <= viewport.height + marginPx * 2;
	const centerX = rect.left + rect.width / 2;
	const centerY = rect.top + rect.height / 2;
	const centered =
		Math.abs(centerX - viewport.width / 2) <= marginPx &&
		Math.abs(centerY - viewport.height / 2) <= marginPx;
	return {
		fits,
		centered,
		centeredFit: fits && centered
	};
}

export function exitProgressAfterCenteredFit(
	scale: number,
	fitScale: number,
	isCenteredFit: boolean,
	zoneFraction: number = APP_CONFIG.multigraph.focus.subFitExitZoneFraction
): number {
	return isCenteredFit ? exitProgress(scale, fitScale, zoneFraction) : 1;
}

export function borderRadiusForProgress(
	sizePx: number,
	progress: number,
	options: {
		fromRadiusPx?: number;
		toRadiusPx?: number;
	} = {}
): number {
	const fromRadiusPx = options.fromRadiusPx ?? sizePx / 2;
	const toRadiusPx = options.toRadiusPx ?? APP_CONFIG.multigraph.focus.detailsCornerRadiusPx;
	return lerp(fromRadiusPx, toRadiusPx, clamp01(progress));
}

function axisContact(
	start: number,
	end: number,
	viewportSize: number,
	marginPx: number
): AxisContact {
	const touchesStart = Math.abs(start) <= marginPx;
	const touchesEnd = Math.abs(end - viewportSize) <= marginPx;
	return {
		start: touchesStart,
		end: touchesEnd,
		inscribed: touchesStart && touchesEnd
	};
}

function entryAxisDelta(
	start: number,
	end: number,
	viewportSize: number,
	marginPx: number
): number {
	const min = marginPx;
	const max = viewportSize - marginPx;
	const size = end - start;
	if (size > max - min) return centerAxisDelta(start, end, viewportSize);
	if (start < min) return min - start;
	if (end > max) return max - end;
	return 0;
}

function coverAxisDelta(
	start: number,
	end: number,
	viewportSize: number,
	marginPx: number
): number {
	const min = marginPx;
	const max = viewportSize - marginPx;
	const size = end - start;
	if (size <= max - min) return centerAxisDelta(start, end, viewportSize);

	const minStart = max - size;
	const maxStart = min;
	const clampedStart = clamp(start, minStart, maxStart);
	return clampedStart - start;
}

function centerAxisDelta(start: number, end: number, viewportSize: number): number {
	return viewportSize / 2 - (start + end) / 2;
}

function translateRect(rect: Rect, dx: number, dy: number): Rect {
	return {
		...rect,
		left: rect.left + dx,
		top: rect.top + dy
	};
}

function lerp(from: number, to: number, progress: number): number {
	return from + (to - from) * progress;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
	return clamp(value, 0, 1);
}
