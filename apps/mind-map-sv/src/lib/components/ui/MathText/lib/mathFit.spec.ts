import { describe, expect, it } from 'vitest';
import { fitScale } from './mathFit';

describe('fitScale', () => {
	it('leaves an equation narrower than its container unscaled', () => {
		expect(fitScale(400, 200)).toBe(1);
	});

	it('leaves an exactly fitting equation unscaled', () => {
		expect(fitScale(300, 300)).toBe(1);
	});

	it('shrinks an equation wider than its container', () => {
		expect(fitScale(200, 400)).toBe(0.5);
	});

	it('never enlarges, so short equations keep their typeset size', () => {
		expect(fitScale(1000, 10)).toBe(1);
	});

	it.each([
		['zero available width', 0, 400],
		['zero natural width', 400, 0],
		['negative available width', -100, 400],
		['negative natural width', 400, -100]
	])('returns 1 for %s rather than collapsing the equation', (_case, available, natural) => {
		expect(fitScale(available, natural)).toBe(1);
	});

	it.each([
		['NaN available width', Number.NaN, 400],
		['NaN natural width', 400, Number.NaN],
		['infinite natural width', 400, Number.POSITIVE_INFINITY]
	])('returns 1 for %s', (_case, available, natural) => {
		expect(fitScale(available, natural)).toBe(1);
	});
});
