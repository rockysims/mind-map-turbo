import { describe, it, expect } from 'vitest';
import {
	clampScale,
	scaleFromWheelDelta,
	distance,
	pinchScaleFactor,
	DEFAULT_MIN_SCALE,
	DEFAULT_MAX_SCALE,
	fitGraphBoundsInView,
	wheelDeltaForZoomFactor,
	wheelDeltaPixels,
	zoomViewTransformAtPoint
} from './graphMath';

describe('graphMath', () => {
	describe('clampScale', () => {
		it('clamps to min when below', () => {
			expect(clampScale(0.01)).toBe(DEFAULT_MIN_SCALE);
			expect(clampScale(0, 0.25, 4)).toBe(0.25);
		});
		it('clamps to max when above', () => {
			expect(clampScale(10)).toBe(DEFAULT_MAX_SCALE);
			expect(clampScale(5, 0.25, 4)).toBe(4);
		});
		it('returns value when within range', () => {
			expect(clampScale(1)).toBe(1);
			expect(clampScale(2, 0.25, 4)).toBe(2);
		});
	});

	describe('scaleFromWheelDelta', () => {
		it('zooms out when deltaY is positive', () => {
			const next = scaleFromWheelDelta(1, 100);
			expect(next).toBeLessThan(1);
		});
		it('zooms in when deltaY is negative', () => {
			const next = scaleFromWheelDelta(1, -100);
			expect(next).toBeGreaterThan(1);
		});
		it('respects min/max', () => {
			const nextOut = scaleFromWheelDelta(0.25, 1e6);
			expect(nextOut).toBe(DEFAULT_MIN_SCALE);
			const nextIn = scaleFromWheelDelta(4, -1e6);
			expect(nextIn).toBe(DEFAULT_MAX_SCALE);
		});
		it('returns to the starting scale when a zoom in is undone by the same zoom out', () => {
			// The reason the factor is exponential: rocking the wheel back and forth
			// must not shrink the canvas a few percent per round trip.
			const zoomedIn = scaleFromWheelDelta(1, -100, undefined, 0, Infinity);
			const roundTrip = scaleFromWheelDelta(zoomedIn, 100, undefined, 0, Infinity);
			expect(roundTrip).toBeCloseTo(1, 12);
		});
		it('stays positive past the delta where the old linear factor crossed zero', () => {
			// `1 - deltaY * 0.002` reaches zero at 500 and goes negative beyond it.
			expect(scaleFromWheelDelta(1, 1000, undefined, 0, Infinity)).toBeGreaterThan(0);
		});
	});

	describe('wheelDeltaForZoomFactor', () => {
		it('inverts scaleFromWheelDelta exactly', () => {
			for (const factor of [0.5, 2, 7, 13]) {
				const delta = wheelDeltaForZoomFactor(factor);
				expect(scaleFromWheelDelta(1, delta, undefined, 0, Infinity)).toBe(factor);
			}
		});
		it('asks to zoom out with a positive delta and in with a negative one', () => {
			expect(wheelDeltaForZoomFactor(0.5)).toBeGreaterThan(0);
			expect(wheelDeltaForZoomFactor(2)).toBeLessThan(0);
			// `toBeCloseTo` rather than `toBe`: `-Math.log(1)` is negative zero, which
			// is a fine wheel delta and a failing `Object.is` comparison.
			expect(wheelDeltaForZoomFactor(1)).toBeCloseTo(0, 12);
		});
		it('honours a non-default sensitivity', () => {
			const delta = wheelDeltaForZoomFactor(4, 0.004);
			expect(scaleFromWheelDelta(1, delta, 0.004, 0, Infinity)).toBeCloseTo(4, 12);
		});
	});

	describe('wheelDeltaPixels', () => {
		it('passes pixel deltas straight through', () => {
			expect(wheelDeltaPixels({ deltaY: 120, deltaMode: 0 })).toBe(120);
		});
		it('defaults to pixels when the mode is absent', () => {
			expect(wheelDeltaPixels({ deltaY: -53 })).toBe(-53);
		});
		it('converts line deltas, as Firefox reports a mouse wheel', () => {
			expect(wheelDeltaPixels({ deltaY: 3, deltaMode: 1 })).toBe(48);
		});
		it('converts page deltas against the viewport height', () => {
			expect(wheelDeltaPixels({ deltaY: -1, deltaMode: 2 }, 900)).toBe(-900);
		});
	});

	describe('zoomViewTransformAtPoint', () => {
		it('keeps the graph point under the focal client point fixed', () => {
			const current = { panX: 25, panY: -10, scale: 1.25 };
			const stageCenter = { x: 300, y: 200 };
			const focalClientPoint = { x: 420, y: 260 };
			const nextScale = 2;
			const graphPointBefore = {
				x: (focalClientPoint.x - stageCenter.x - current.panX) / current.scale,
				y: (focalClientPoint.y - stageCenter.y - current.panY) / current.scale
			};

			const next = zoomViewTransformAtPoint(current, nextScale, focalClientPoint, stageCenter);
			const graphPointAfter = {
				x: (focalClientPoint.x - stageCenter.x - next.panX) / next.scale,
				y: (focalClientPoint.y - stageCenter.y - next.panY) / next.scale
			};

			expect(next.scale).toBe(nextScale);
			expect(graphPointAfter.x).toBeCloseTo(graphPointBefore.x);
			expect(graphPointAfter.y).toBeCloseTo(graphPointBefore.y);
		});
	});

	describe('fitGraphBoundsInView', () => {
		it('centers graph bounds and chooses a fitting scale', () => {
			const next = fitGraphBoundsInView(
				{ minX: -100, minY: -50, maxX: 300, maxY: 150 },
				{ width: 1000, height: 800 },
				{ paddingPx: 100, minScale: 0.1, maxScale: 4 }
			);

			expect(next.scale).toBe(2);
			expect(next.panX).toBe(-200);
			expect(next.panY).toBe(-100);
		});

		it('clamps the fitting scale', () => {
			expect(
				fitGraphBoundsInView(
					{ minX: -1, minY: -1, maxX: 1, maxY: 1 },
					{ width: 1000, height: 800 },
					{ maxScale: 3 }
				).scale
			).toBe(3);
		});
	});

	describe('distance', () => {
		it('returns 0 for same point', () => {
			expect(distance(0, 0, 0, 0)).toBe(0);
		});
		it('returns correct distance', () => {
			expect(distance(0, 0, 3, 4)).toBe(5);
		});
	});

	describe('pinchScaleFactor', () => {
		it('returns 2 when distance doubles', () => {
			expect(pinchScaleFactor(100, 200)).toBe(2);
		});
		it('returns 0.5 when distance halves', () => {
			expect(pinchScaleFactor(200, 100)).toBe(0.5);
		});
		it('returns 1 when distance unchanged', () => {
			expect(pinchScaleFactor(100, 100)).toBe(1);
		});
	});
});
