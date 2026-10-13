import { describe, expect, it } from 'vitest';
import { boxOverlapsRing, ringOverlapsContent } from './ringLayers';

describe('ringOverlapsContent', () => {
	it('is false at the base width, where the ring and the content inset are one band', () => {
		expect(ringOverlapsContent(8, 8)).toBe(false);
	});

	it('is false for a ring thinner than the base', () => {
		expect(ringOverlapsContent(4, 8)).toBe(false);
	});

	it('is true for a weighted ring wider than the base', () => {
		expect(ringOverlapsContent(80, 8)).toBe(true);
		expect(ringOverlapsContent(8.5, 8)).toBe(true);
	});

	it('treats a difference within the tolerance as equal', () => {
		expect(ringOverlapsContent(8 + 1e-9, 8)).toBe(false);
		expect(ringOverlapsContent(8.005, 8)).toBe(false);
	});

	it('takes the tolerance as a parameter', () => {
		expect(ringOverlapsContent(8.005, 8, 0.001)).toBe(true);
		expect(ringOverlapsContent(9, 8, 2)).toBe(false);
	});
});

describe('boxOverlapsRing', () => {
	/** A 200 px radius node: the shipped size, base ring 8, thickest ring 80. */
	const RADIUS = 200;
	const THICK = { radiusPx: RADIUS, ringWidthPx: 80, baseWidthPx: 8 };

	/** A box of the given size centred `(dx, dy)` from the circle's centre. */
	function boxAt(dx: number, dy: number, width: number, height: number) {
		return { left: RADIUS + dx - width / 2, top: RADIUS + dy - height / 2, width, height };
	}

	it('is never true at the base width or below, however far the box reaches', () => {
		const atBase = { radiusPx: RADIUS, ringWidthPx: 8, baseWidthPx: 8 };
		expect(boxOverlapsRing(boxAt(0, 0, 380, 380), atBase)).toBe(false);
		expect(boxOverlapsRing(boxAt(0, 0, 380, 380), { ...atBase, ringWidthPx: 4 })).toBe(false);
	});

	it('is false for a small centred box well inside the inner edge of a thick ring', () => {
		// Inner edge at 120; the corner of a 100 × 40 box is at about 54.
		expect(boxOverlapsRing(boxAt(0, 0, 100, 40), THICK)).toBe(false);
	});

	it('is true once a corner of the box passes the inner edge', () => {
		// Corner at hypot(100, 70) ≈ 122 > 120, though every edge midpoint is inside.
		expect(boxOverlapsRing(boxAt(0, 0, 200, 140), THICK)).toBe(true);
		// Just inside: hypot(95, 65) ≈ 115.
		expect(boxOverlapsRing(boxAt(0, 0, 190, 130), THICK)).toBe(false);
	});

	it('is true for an off-centre row whose far side reaches the ring, and false under a thinner one', () => {
		// A badge row above the title square: 40 × 20, centred 150 above the centre.
		expect(boxOverlapsRing(boxAt(0, -150, 40, 20), THICK)).toBe(true);
		// The same row under a moderate ring (inner edge 176) stays clear of it.
		expect(boxOverlapsRing(boxAt(0, -150, 40, 20), { ...THICK, ringWidthPx: 24 })).toBe(false);
	});

	it('counts a box only up to the content clip', () => {
		// Straddling the clip (192): the part inside it lies on the ring.
		expect(boxOverlapsRing(boxAt(0, -190, 20, 20), THICK)).toBe(true);
		// Wholly beyond the clip: nothing of it is drawn, so nothing to back.
		expect(boxOverlapsRing(boxAt(0, -196, 4, 4), THICK)).toBe(false);
		// In the corner of the circle's box, outside the circle altogether.
		expect(boxOverlapsRing({ left: 0, top: 0, width: 20, height: 20 }, THICK)).toBe(false);
	});

	it('ignores an empty box', () => {
		expect(boxOverlapsRing(boxAt(0, -150, 0, 20), THICK)).toBe(false);
	});

	it('treats a non-circular border radius as a circle of radiusPx about the given centre', () => {
		// A wider-than-tall frame (the deep-zoom morph): the centre is passed in,
		// and the test is still against the circle of radiusPx around it.
		const morph = { ...THICK, centerXPx: 300, centerYPx: RADIUS };
		expect(boxOverlapsRing({ left: 250, top: 180, width: 100, height: 40 }, morph)).toBe(false);
		expect(boxOverlapsRing({ left: 150, top: 100, width: 300, height: 200 }, morph)).toBe(true);
	});

	it('takes the width tolerance as a parameter', () => {
		const barely = { radiusPx: RADIUS, ringWidthPx: 8.005, baseWidthPx: 8 };
		const reaching = { left: 0, top: RADIUS - 5, width: 2 * RADIUS, height: 10 };
		expect(boxOverlapsRing(reaching, barely)).toBe(false);
		expect(boxOverlapsRing(reaching, barely, 0.001)).toBe(true);
	});
});
