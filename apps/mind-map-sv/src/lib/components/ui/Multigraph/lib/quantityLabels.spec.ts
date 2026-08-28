import { describe, expect, it } from 'vitest';
import { edgeAngleDegrees, formatQuantityLabel, shouldRevealQuantityLabel } from './quantityLabels';

describe('edgeAngleDegrees', () => {
	it('is zero for a rightward edge', () => {
		expect(edgeAngleDegrees({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe(0);
	});

	it('is a right angle for a downward edge', () => {
		expect(edgeAngleDegrees({ x: 0, y: 0 }, { x: 0, y: 10 })).toBe(90);
	});

	it('is a straight angle for a leftward edge', () => {
		expect(edgeAngleDegrees({ x: 0, y: 0 }, { x: -10, y: 0 })).toBe(180);
	});

	it('is negative for an upward edge', () => {
		expect(edgeAngleDegrees({ x: 0, y: 0 }, { x: 0, y: -10 })).toBe(-90);
	});

	it('is zero for a degenerate zero-length edge', () => {
		expect(edgeAngleDegrees({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
	});
});

describe('shouldRevealQuantityLabel', () => {
	const options = { minStageScale: 0.8, minOnScreenLengthPx: 90 };

	it('hides a label below the zoom threshold', () => {
		expect(shouldRevealQuantityLabel(400, 0.5, options)).toBe(false);
	});

	it('shows a long edge at sufficient zoom', () => {
		expect(shouldRevealQuantityLabel(400, 1, options)).toBe(true);
	});

	it('hides a short edge even at high zoom', () => {
		expect(shouldRevealQuantityLabel(40, 1, options)).toBe(false);
	});

	it('shows a short edge once zoom makes it long enough on screen', () => {
		expect(shouldRevealQuantityLabel(40, 3, options)).toBe(true);
	});

	it('shows at exactly the zoom threshold', () => {
		expect(shouldRevealQuantityLabel(400, 0.8, options)).toBe(true);
	});

	it('shows at exactly the on-screen length threshold', () => {
		expect(shouldRevealQuantityLabel(90, 1, options)).toBe(true);
	});

	it('hides just below the on-screen length threshold', () => {
		expect(shouldRevealQuantityLabel(89, 1, options)).toBe(false);
	});

	it('hides a zero-length edge', () => {
		expect(shouldRevealQuantityLabel(0, 4, options)).toBe(false);
	});

	it.each([
		[NaN, 1],
		[400, NaN],
		[Infinity, NaN]
	])('hides for a degenerate measurement (%s, %s)', (length, scale) => {
		expect(shouldRevealQuantityLabel(length, scale, options)).toBe(false);
	});

	it('applies defaults when no options are given', () => {
		expect(shouldRevealQuantityLabel(400, 1)).toBe(true);
		expect(shouldRevealQuantityLabel(400, 0.1)).toBe(false);
	});
});

describe('formatQuantityLabel', () => {
	it('returns nothing for no quantities', () => {
		expect(formatQuantityLabel([])).toBe('');
	});

	it('names a single quantity', () => {
		expect(formatQuantityLabel(['g'])).toBe('g');
	});

	it('names several quantities', () => {
		expect(formatQuantityLabel(['g', 'm'])).toBe('g, m');
	});

	it('names exactly the maximum without a count', () => {
		expect(formatQuantityLabel(['a', 'b', 'c'], 3)).toBe('a, b, c');
	});

	it('counts the overflow beyond the maximum', () => {
		expect(formatQuantityLabel(['a', 'b', 'c', 'd', 'e'], 3)).toBe('a, b, c +2');
	});

	it('honours a smaller maximum', () => {
		expect(formatQuantityLabel(['a', 'b', 'c'], 1)).toBe('a +2');
	});

	it('collapses to a bare count when nothing may be named', () => {
		expect(formatQuantityLabel(['a', 'b'], 0)).toBe('2');
	});

	it('keeps subscripted labels intact', () => {
		expect(formatQuantityLabel(['v_0', 'a'])).toBe('v_0, a');
	});
});
