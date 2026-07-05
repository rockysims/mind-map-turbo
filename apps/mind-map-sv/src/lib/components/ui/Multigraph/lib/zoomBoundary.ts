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
	marginPx = APP_CONFIG.multigraph.focus.boundaryNearTouchMarginPx
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
	marginPx = APP_CONFIG.multigraph.focus.boundaryNearTouchMarginPx
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
