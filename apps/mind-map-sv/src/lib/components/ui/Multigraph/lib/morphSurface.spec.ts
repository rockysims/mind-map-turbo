import { describe, expect, it } from 'vitest';
import { contentLayerScale, crossfadeOpacity } from './morphSurface';

describe('contentLayerScale', () => {
	it('returns 1 when the frame matches the base size', () => {
		expect(contentLayerScale(80, 80)).toBe(1);
	});

	it('scales down when the frame is smaller than the base', () => {
		expect(contentLayerScale(40, 80)).toBe(0.5);
	});

	it('scales up when the frame is larger than the base', () => {
		expect(contentLayerScale(420, 80)).toBe(5.25);
	});

	it('collapses to 0 for a non-positive base instead of dividing by zero', () => {
		expect(contentLayerScale(420, 0)).toBe(0);
		expect(contentLayerScale(420, -10)).toBe(0);
	});
});

describe('crossfadeOpacity', () => {
	it('shows only the compact layer at progress 0', () => {
		expect(crossfadeOpacity(0)).toEqual({ compact: 1, details: 0 });
	});

	it('shows only the details layer at progress 1', () => {
		expect(crossfadeOpacity(1)).toEqual({ compact: 0, details: 1 });
	});

	it('crosses the two layers over at the midpoint (opacities sum to 1)', () => {
		const mid = crossfadeOpacity(0.5);
		expect(mid).toEqual({ compact: 0.5, details: 0.5 });
		expect(mid.compact + mid.details).toBe(1);
	});

	it('clamps out-of-range progress to the end states', () => {
		expect(crossfadeOpacity(-1)).toEqual({ compact: 1, details: 0 });
		expect(crossfadeOpacity(2)).toEqual({ compact: 0, details: 1 });
	});
});
