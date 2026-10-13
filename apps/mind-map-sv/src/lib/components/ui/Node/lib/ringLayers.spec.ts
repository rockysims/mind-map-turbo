import { describe, expect, it } from 'vitest';
import { ringOverlapsContent } from './ringLayers';

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
