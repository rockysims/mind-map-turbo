import { describe, it, expect } from 'vitest';
import {
	clampScale,
	scaleFromWheelDelta,
	distance,
	pinchScaleFactor,
	DEFAULT_MIN_SCALE,
	DEFAULT_MAX_SCALE
} from './graphMath';

describe('graphMath', () => {
	describe('clampScale', () => {
		it('clamps to min when below', () => {
			expect(clampScale(0.1)).toBe(DEFAULT_MIN_SCALE);
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
