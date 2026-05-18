import { describe, expect, it } from 'vitest';
import {
	animatedScalesAt,
	createScaleAnimations,
	hasActiveScaleAnimations,
	interpolateScale,
	pruneFinishedScaleAnimations
} from './scaleAnimation';

describe('scaleAnimation', () => {
	it('creates animations only for scales that change', () => {
		expect(createScaleAnimations({ n0: 1, n1: 0.5 }, { n0: 1, n1: 0.25 }, 100, 180)).toEqual({
			n1: {
				fromScale: 0.5,
				toScale: 0.25,
				startedAtMs: 100,
				durationMs: 180
			}
		});
	});

	it('interpolates scale with an eased midpoint', () => {
		expect(
			interpolateScale({ fromScale: 0.2, toScale: 1, startedAtMs: 100, durationMs: 200 }, 200)
		).toBeCloseTo(0.6);
	});

	it('resolves zero-duration animations to the final scale', () => {
		expect(
			animatedScalesAt({ n0: { fromScale: 0.2, toScale: 1, startedAtMs: 100, durationMs: 0 } }, 100)
		).toEqual({ n0: 1 });
	});

	it('reports and prunes finished animations', () => {
		const animations = {
			n0: { fromScale: 0.2, toScale: 1, startedAtMs: 100, durationMs: 200 },
			n1: { fromScale: 1, toScale: 0.5, startedAtMs: 100, durationMs: 400 }
		};

		expect(hasActiveScaleAnimations(animations, 500)).toBe(false);
		expect(pruneFinishedScaleAnimations(animations, 500)).toEqual({});
		expect(hasActiveScaleAnimations(animations, 250)).toBe(true);
		expect(pruneFinishedScaleAnimations(animations, 350)).toEqual({
			n1: animations.n1
		});
	});
});
