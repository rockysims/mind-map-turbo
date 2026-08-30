import { APP_CONFIG } from '$lib/appConfig';
import type { Point } from '../../types/multigraph';
import { zoomViewTransformAtPoint, type ViewTransform } from './graphMath';
import {
	circleToRect,
	clampRectForEntrySteering,
	inscribeScaleForCircle,
	rectBottom,
	rectRight,
	type Rect,
	type ViewportSize
} from './zoomBoundary';

type FocusEntryBoundaryPhase = 'free' | 'steering' | 'boundary';
export type FocusEntrySteeringAxis = 'horizontal' | 'vertical';
export type FocusEntrySteeringSide = 'start' | 'end';

export interface FocusEntryBoundaryCandidate {
	nodeId: string;
	position: Point;
	radius: number;
}

export interface FocusEntrySteeringState {
	nodeId: string;
	axis: FocusEntrySteeringAxis;
	side: FocusEntrySteeringSide;
	startScale: number;
}

interface FocusEntryBoundaryStep {
	view: ViewTransform;
	projectedRect: Rect;
	boundaryScale: number;
	phase: FocusEntryBoundaryPhase;
	progressDelta: number;
	steeringState: FocusEntrySteeringState | null;
}

interface FocusEntryBoundaryInput {
	currentView: ViewTransform;
	requestedScale: number;
	focalPoint: Point;
	viewport: ViewportSize;
	candidate: FocusEntryBoundaryCandidate;
	steeringState?: FocusEntrySteeringState | null;
	zoneFraction?: number;
	marginPx?: number;
}

export function solveFocusEntryBoundary({
	currentView,
	requestedScale,
	focalPoint,
	viewport,
	candidate,
	steeringState = null,
	zoneFraction = APP_CONFIG.multigraph.focus.preInscribeZoneFraction,
	marginPx = APP_CONFIG.multigraph.focus.boundaryNearTouchMarginPx
}: FocusEntryBoundaryInput): FocusEntryBoundaryStep {
	const boundaryScale = inscribeScaleForCircle(candidate.radius, viewport);
	const nextScale = requestedScale >= boundaryScale ? boundaryScale : requestedScale;
	const viewportCenter = { x: viewport.width / 2, y: viewport.height / 2 };
	const rawView = zoomViewTransformAtPoint(currentView, nextScale, focalPoint, viewportCenter);
	const rawRect = projectedCandidateRect(candidate, rawView, viewport);

	if (requestedScale >= boundaryScale) {
		const centered = steerViewToCenteredRect(rawView, rawRect, viewport);
		return {
			view: centered.view,
			projectedRect: centered.rect,
			boundaryScale,
			phase: 'boundary',
			progressDelta: boundaryProgressDelta(requestedScale, boundaryScale, zoneFraction),
			steeringState: null
		};
	}

	const steered = steerViewForOneSidedEntry(
		rawView,
		rawRect,
		viewport,
		candidate,
		boundaryScale,
		steeringState,
		marginPx
	);
	return {
		view: steered.view,
		projectedRect: steered.rect,
		boundaryScale,
		phase: steered.changed ? 'steering' : 'free',
		progressDelta: 0,
		steeringState: steered.steeringState
	};
}

export function projectedCandidateRect(
	candidate: Pick<FocusEntryBoundaryCandidate, 'position' | 'radius'>,
	view: ViewTransform,
	viewport: ViewportSize
): Rect {
	return circleToRect({
		center: {
			x: viewport.width / 2 + view.panX + candidate.position.x * view.scale,
			y: viewport.height / 2 + view.panY + candidate.position.y * view.scale
		},
		radius: candidate.radius * view.scale
	});
}

export function boundaryProgressDelta(
	requestedScale: number,
	lockedScale: number,
	zoneFraction: number = APP_CONFIG.multigraph.focus.preInscribeZoneFraction
): number {
	if (lockedScale <= 0) return 0;
	const zoneScale = lockedScale * clamp01(zoneFraction);
	if (zoneScale <= 0) return requestedScale > lockedScale ? 1 : 0;
	return clamp01((requestedScale - lockedScale) / zoneScale);
}

export function boundaryReleaseDelta(
	requestedScale: number,
	lockedScale: number,
	zoneFraction: number = APP_CONFIG.multigraph.focus.preInscribeZoneFraction
): number {
	if (lockedScale <= 0) return 0;
	const zoneScale = lockedScale * clamp01(zoneFraction);
	if (zoneScale <= 0) return requestedScale < lockedScale ? 1 : 0;
	return clamp01((lockedScale - requestedScale) / zoneScale);
}

export function entrySteeringProgress(
	scale: number,
	startScale: number,
	boundaryScale: number
): number {
	if (boundaryScale <= startScale) return scale >= boundaryScale ? 1 : 0;
	return clamp01((scale - startScale) / (boundaryScale - startScale));
}

function steerViewForOneSidedEntry(
	view: ViewTransform,
	rect: Rect,
	viewport: ViewportSize,
	candidate: FocusEntryBoundaryCandidate,
	boundaryScale: number,
	steeringState: FocusEntrySteeringState | null,
	marginPx: number
): {
	view: ViewTransform;
	rect: Rect;
	changed: boolean;
	steeringState: FocusEntrySteeringState | null;
} {
	const horizontalContact = rect.left <= marginPx || rectRight(rect) >= viewport.width - marginPx;
	const verticalContact = rect.top <= marginPx || rectBottom(rect) >= viewport.height - marginPx;
	const contact = oneSidedContact(rect, viewport, horizontalContact, verticalContact, marginPx);
	const activeContact =
		steeringState?.nodeId === candidate.nodeId
			? { axis: steeringState.axis, side: steeringState.side }
			: contact;
	const nextSteeringState = activeContact
		? steeringState?.nodeId === candidate.nodeId && steeringState.axis === activeContact.axis
			? steeringState
			: {
					nodeId: candidate.nodeId,
					axis: activeContact.axis,
					side: activeContact.side,
					startScale: view.scale
				}
		: null;
	const centerProgress = nextSteeringState
		? entrySteeringProgress(view.scale, nextSteeringState.startScale, boundaryScale)
		: 1;

	if (!nextSteeringState) {
		const clamped = clampRectForEntrySteering(rect, viewport);
		return {
			view: translateView(view, clamped.dx, clamped.dy),
			rect: clamped.rect,
			changed: Math.abs(clamped.dx) > 0.001 || Math.abs(clamped.dy) > 0.001,
			steeringState: null
		};
	}

	const contactDelta = firstContactSideDelta(rect, viewport, nextSteeringState);
	const contactRect = translateRect(rect, contactDelta.dx, contactDelta.dy);
	const centerDx = axisCenterDelta(contactRect.left, rectRight(contactRect), viewport.width);
	const centerDy = axisCenterDelta(contactRect.top, rectBottom(contactRect), viewport.height);
	const progressiveDx = centerDx * centerProgress;
	const progressiveDy = centerDy * centerProgress;
	const dx = contactDelta.dx + progressiveDx;
	const dy = contactDelta.dy + progressiveDy;
	const nextRect = translateRect(contactRect, progressiveDx, progressiveDy);

	return {
		view: translateView(view, dx, dy),
		rect: nextRect,
		changed: Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001,
		steeringState: nextSteeringState
	};
}

function oneSidedContact(
	rect: Rect,
	viewport: ViewportSize,
	horizontalContact: boolean,
	verticalContact: boolean,
	marginPx: number
): Pick<FocusEntrySteeringState, 'axis' | 'side'> | null {
	if (horizontalContact && !verticalContact) {
		const side = contactSide(rect.left, rectRight(rect), viewport.width, marginPx);
		return side ? { axis: 'horizontal', side } : null;
	}
	if (verticalContact && !horizontalContact) {
		const side = contactSide(rect.top, rectBottom(rect), viewport.height, marginPx);
		return side ? { axis: 'vertical', side } : null;
	}
	return null;
}

function contactSide(
	start: number,
	end: number,
	viewportSize: number,
	marginPx: number
): FocusEntrySteeringSide | null {
	const touchesStart = start <= marginPx;
	const touchesEnd = end >= viewportSize - marginPx;
	if (touchesStart === touchesEnd) return null;
	return touchesStart ? 'start' : 'end';
}

function firstContactSideDelta(
	rect: Rect,
	viewport: ViewportSize,
	steeringState: Pick<FocusEntrySteeringState, 'axis' | 'side'>
): { dx: number; dy: number } {
	if (steeringState.axis === 'horizontal') {
		return {
			dx: steeringState.side === 'start' ? -rect.left : viewport.width - rectRight(rect),
			dy: 0
		};
	}
	return {
		dx: 0,
		dy: steeringState.side === 'start' ? -rect.top : viewport.height - rectBottom(rect)
	};
}

function steerViewToCenteredRect(
	view: ViewTransform,
	rect: Rect,
	viewport: ViewportSize
): { view: ViewTransform; rect: Rect } {
	const clamped = clampRectForEntrySteering(rect, viewport);
	const centerDx = axisCenterDelta(clamped.rect.left, rectRight(clamped.rect), viewport.width);
	const centerDy = axisCenterDelta(clamped.rect.top, rectBottom(clamped.rect), viewport.height);
	const dx = clamped.dx + centerDx;
	const dy = clamped.dy + centerDy;

	return {
		view: translateView(view, dx, dy),
		rect: translateRect(clamped.rect, centerDx, centerDy)
	};
}

function translateView(view: ViewTransform, dx: number, dy: number): ViewTransform {
	return {
		...view,
		panX: view.panX + dx,
		panY: view.panY + dy
	};
}

function translateRect(rect: Rect, dx: number, dy: number): Rect {
	return {
		...rect,
		left: rect.left + dx,
		top: rect.top + dy
	};
}

function axisCenterDelta(start: number, end: number, viewportSize: number): number {
	return viewportSize / 2 - (start + end) / 2;
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}
