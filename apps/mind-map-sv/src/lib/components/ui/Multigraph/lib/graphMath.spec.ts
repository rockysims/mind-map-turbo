import { describe, it, expect } from 'vitest';
import {
	clampScale,
	scaleFromWheelDelta,
	distance,
	pinchScaleFactor,
	DEFAULT_MIN_SCALE,
	DEFAULT_MAX_SCALE,
	fitGraphBoundsInView,
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
