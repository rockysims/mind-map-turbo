import { describe, expect, it } from 'vitest';
import {
	centeredFitForRect,
	clampRectForEntrySteering,
	clampRectToCoverViewport,
	entryProgress,
	exitProgress,
	exitProgressAfterCenteredFit,
	inscribeScaleForCircle,
	inscribeScaleForRect,
	inscribedContactForCircle,
	inscribedContactForRect
} from './zoomBoundary';

const viewport = { width: 320, height: 240 };

describe('zoom boundary contact detection', () => {
	it('detects centered rects inscribed on either axis with the OR rule', () => {
		const horizontal = inscribedContactForRect(
			{ left: 0, top: 30, width: 320, height: 180 },
			viewport
		);
		const vertical = inscribedContactForRect(
			{ left: 40, top: 0, width: 240, height: 240 },
			viewport
		);

		expect(horizontal.x.inscribed).toBe(true);
		expect(horizontal.y.inscribed).toBe(false);
		expect(horizontal.inscribed).toBe(true);
		expect(vertical.x.inscribed).toBe(false);
		expect(vertical.y.inscribed).toBe(true);
		expect(vertical.inscribed).toBe(true);
	});

	it('uses the near-touch margin for opposite contacts', () => {
		const contact = inscribedContactForRect(
			{ left: 6, top: 40, width: 308, height: 100 },
			viewport,
			8
		);

		expect(contact.x.start).toBe(true);
		expect(contact.x.end).toBe(true);
		expect(contact.inscribed).toBe(true);
	});

	it('does not treat a one-sided touch as inscribed', () => {
		const contact = inscribedContactForRect(
			{ left: 0, top: 60, width: 180, height: 120 },
			viewport
		);

		expect(contact.x.start).toBe(true);
		expect(contact.x.end).toBe(false);
		expect(contact.inscribed).toBe(false);
	});

	it('detects circle contact through its bounding rect', () => {
		const contact = inscribedContactForCircle(
			{ center: { x: 160, y: 120 }, radius: 120 },
			viewport
		);

		expect(contact.y.inscribed).toBe(true);
		expect(contact.inscribed).toBe(true);
	});
});

describe('zoom boundary inscribe scales', () => {
	it('computes the first scale where a rect touches both sides of one axis', () => {
		expect(inscribeScaleForRect({ width: 100, height: 50 }, viewport)).toBeCloseTo(3.2);
		expect(inscribeScaleForRect({ width: 80, height: 120 }, viewport)).toBeCloseTo(2);
	});

	it('computes circle inscribe scale from diameter', () => {
		expect(inscribeScaleForCircle(40, viewport)).toBe(3);
	});
});

describe('zoom boundary pan clamps', () => {
	it('steers entry by holding a side that has reached the viewport', () => {
		const clamped = clampRectForEntrySteering(
			{ left: -18, top: 55, width: 160, height: 120 },
			viewport
		);

		expect(clamped.dx).toBe(18);
		expect(clamped.rect.left).toBe(0);
		expect(clamped.rect.top).toBe(55);
	});

	it('steers the opposite side symmetrically', () => {
		const clamped = clampRectForEntrySteering(
			{ left: 190, top: 55, width: 150, height: 120 },
			viewport
		);

		expect(clamped.dx).toBe(-20);
		expect(clamped.rect.left + clamped.rect.width).toBe(320);
	});

	it('cover-clamps large content so the viewport stays covered', () => {
		const clamped = clampRectToCoverViewport(
			{ left: 40, top: -30, width: 420, height: 320 },
			viewport
		);

		expect(clamped.rect.left).toBe(0);
		expect(clamped.rect.left + clamped.rect.width).toBeGreaterThanOrEqual(viewport.width);
		expect(clamped.rect.top).toBe(-30);
	});

	it('recenters monotonically as content shrinks to fit', () => {
		const large = clampRectToCoverViewport(
			{ left: 30, top: 10, width: 400, height: 260 },
			viewport
		);
		const fit = clampRectToCoverViewport({ left: 30, top: 10, width: 280, height: 200 }, viewport);

		expect(large.rect.left).toBe(0);
		expect(fit.rect.left).toBe(20);
		expect(fit.rect.top).toBe(20);
	});
});

describe('scale-derived boundary progress', () => {
	it('ramps entry progress from the pre-inscribe zone start to inscribe', () => {
		expect(entryProgress(7.8, 10, 0.2)).toBe(0);
		expect(entryProgress(9, 10, 0.2)).toBe(0.5);
		expect(entryProgress(10, 10, 0.2)).toBe(1);
	});

	it('is reversible and supports a large single-step jump to commit', () => {
		expect(entryProgress(10.5, 10, 0.2)).toBe(1);
		expect(entryProgress(8.4, 10, 0.2)).toBeCloseTo(0.2);
	});

	it('ramps exit progress symmetrically below fit', () => {
		expect(exitProgress(1, 1, 0.2)).toBe(1);
		expect(exitProgress(0.9, 1, 0.2)).toBeCloseTo(0.5);
		expect(exitProgress(0.8, 1, 0.2)).toBe(0);
	});

	it('distinguishes centered fit from merely fitting', () => {
		expect(centeredFitForRect({ left: 10, top: 20, width: 300, height: 200 }, viewport, 0)).toEqual(
			{ fits: true, centered: true, centeredFit: true }
		);
		expect(centeredFitForRect({ left: 0, top: 0, width: 300, height: 200 }, viewport, 0)).toEqual({
			fits: true,
			centered: false,
			centeredFit: false
		});
		expect(
			centeredFitForRect({ left: -20, top: -10, width: 360, height: 260 }, viewport, 0)
		).toEqual({ fits: false, centered: true, centeredFit: false });
	});

	it('holds exit progress until cover clamp has recentered to fit', () => {
		expect(exitProgressAfterCenteredFit(0.8, 1, false, 0.2)).toBe(1);
		expect(exitProgressAfterCenteredFit(0.8, 1, true, 0.2)).toBe(0);
	});
});
