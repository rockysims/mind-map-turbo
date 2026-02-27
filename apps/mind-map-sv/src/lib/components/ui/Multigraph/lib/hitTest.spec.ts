import { describe, it, expect } from 'vitest';
import { isPointInCircle, pointerDistance } from './hitTest';

describe('hitTest', () => {
	describe('isPointInCircle', () => {
		it('returns true when point is inside', () => {
			expect(isPointInCircle(0, 0, 0, 0, 10)).toBe(true);
			expect(isPointInCircle(5, 0, 0, 0, 10)).toBe(true);
			expect(isPointInCircle(0, -5, 0, 0, 10)).toBe(true);
		});
		it('returns true when point is on the boundary', () => {
			expect(isPointInCircle(10, 0, 0, 0, 10)).toBe(true);
		});
		it('returns false when point is outside', () => {
			expect(isPointInCircle(11, 0, 0, 0, 10)).toBe(false);
			expect(isPointInCircle(0, 0, 100, 100, 10)).toBe(false);
		});
	});

	describe('pointerDistance', () => {
		it('returns 0 for same point', () => {
			expect(pointerDistance(1, 2, 1, 2)).toBe(0);
		});
		it('returns correct distance', () => {
			expect(pointerDistance(0, 0, 3, 4)).toBe(5);
		});
	});
});
