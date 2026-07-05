import { describe, expect, it, vi } from 'vitest';
import { prefersReducedMotion, REDUCED_MOTION_MEDIA_QUERY } from './reducedMotion';

describe('prefersReducedMotion', () => {
	it('returns false when matchMedia is unavailable', () => {
		expect(prefersReducedMotion()).toBe(false);
	});

	it('reads the reduce media query when available', () => {
		const originalWindow = globalThis.window;
		vi.stubGlobal('window', {
			matchMedia: (query: string) => ({
				matches: query === '(prefers-reduced-motion: reduce)'
			})
		});

		expect(prefersReducedMotion()).toBe(true);
		expect(REDUCED_MOTION_MEDIA_QUERY).toContain('prefers-reduced-motion');
		vi.stubGlobal('window', originalWindow);
	});
});
