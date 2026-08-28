import { describe, expect, it } from 'vitest';
import { quantityChips, shouldShowQuantityChips } from './quantityChips';

const DIAMETER = 300;
const options = { minOnScreenDiameterPx: 180 };

describe('shouldShowQuantityChips', () => {
	it('shows a full-size node at default zoom', () => {
		expect(shouldShowQuantityChips(DIAMETER, 1, 1, options)).toBe(true);
	});

	it('hides a node shrunk by hop distance', () => {
		// Three hops out at the default falloff leaves the node far too small.
		expect(shouldShowQuantityChips(DIAMETER, 0.343, 1, options)).toBe(false);
	});

	it('shows a distant node once the user zooms in far enough', () => {
		expect(shouldShowQuantityChips(DIAMETER, 0.343, 2, options)).toBe(true);
	});

	it('hides a full-size node when the whole graph is zoomed out', () => {
		expect(shouldShowQuantityChips(DIAMETER, 1, 0.4, options)).toBe(false);
	});

	it('shows at exactly the threshold', () => {
		expect(shouldShowQuantityChips(DIAMETER, 0.6, 1, options)).toBe(true);
	});

	it('hides just below the threshold', () => {
		expect(shouldShowQuantityChips(DIAMETER, 0.59, 1, options)).toBe(false);
	});

	it('hides a node with zero scale', () => {
		expect(shouldShowQuantityChips(DIAMETER, 0, 1, options)).toBe(false);
	});

	it.each([
		['NaN scale', NaN, 1],
		['NaN zoom', 1, NaN],
		['infinite zoom against zero size', 0, Infinity]
	])('hides for a degenerate measurement: %s', (_label, nodeScale, stageScale) => {
		expect(shouldShowQuantityChips(DIAMETER, nodeScale, stageScale, options)).toBe(false);
	});

	it('applies a default threshold when none is given', () => {
		expect(shouldShowQuantityChips(DIAMETER, 1, 1)).toBe(true);
		expect(shouldShowQuantityChips(DIAMETER, 0.1, 1)).toBe(false);
	});
});

describe('quantityChips', () => {
	it('returns nothing for a node defining nothing', () => {
		expect(quantityChips([])).toEqual({ labels: [], overflowCount: 0 });
	});

	it('names every quantity when they fit', () => {
		expect(quantityChips(['g', 'm'])).toEqual({ labels: ['g', 'm'], overflowCount: 0 });
	});

	it('names exactly the maximum without overflow', () => {
		expect(quantityChips(['a', 'b', 'c'], { maxVisible: 3 })).toEqual({
			labels: ['a', 'b', 'c'],
			overflowCount: 0
		});
	});

	it('counts the overflow beyond the maximum', () => {
		expect(quantityChips(['a', 'b', 'c', 'd', 'e'], { maxVisible: 3 })).toEqual({
			labels: ['a', 'b', 'c'],
			overflowCount: 2
		});
	});

	it('collapses everything to a count when nothing may be named', () => {
		expect(quantityChips(['a', 'b'], { maxVisible: 0 })).toEqual({
			labels: [],
			overflowCount: 2
		});
	});

	it('keeps subscripted labels intact', () => {
		expect(quantityChips(['v_0']).labels).toEqual(['v_0']);
	});
});
