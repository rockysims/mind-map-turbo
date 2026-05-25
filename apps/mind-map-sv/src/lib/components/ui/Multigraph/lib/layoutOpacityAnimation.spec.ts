import { describe, expect, it } from 'vitest';
import {
	activeLayoutOpacityAnimationNodeIds,
	animatedOpacitiesAt,
	createLayoutOpacityAnimations,
	hasActiveLayoutOpacityAnimations,
	interpolateOpacity,
	pruneFinishedLayoutOpacityAnimations
} from './layoutOpacityAnimation';

describe('layoutOpacityAnimation', () => {
	it('creates animations when opacity targets change', () => {
		expect(createLayoutOpacityAnimations({ n0: 1, n1: 1 }, { n0: 0.5, n1: 1 }, 100, 200)).toEqual({
			n0: {
				fromOpacity: 1,
				toOpacity: 0.5,
				startedAtMs: 100,
				durationMs: 200
			}
		});
	});

	it('creates reveal animations from dim to full opacity', () => {
		expect(createLayoutOpacityAnimations({ n0: 0.5, n1: 0.5 }, { n0: 1, n1: 1 }, 100, 200)).toEqual(
			{
				n0: {
					fromOpacity: 0.5,
					toOpacity: 1,
					startedAtMs: 100,
					durationMs: 200
				},
				n1: {
					fromOpacity: 0.5,
					toOpacity: 1,
					startedAtMs: 100,
					durationMs: 200
				}
			}
		);
	});

	it('interpolates opacity with an eased midpoint', () => {
		expect(
			interpolateOpacity({ fromOpacity: 1, toOpacity: 0.5, startedAtMs: 100, durationMs: 200 }, 200)
		).toBeCloseTo(0.75);
	});

	it('resolves zero-duration animations to the final opacity', () => {
		expect(
			animatedOpacitiesAt(
				{ n0: { fromOpacity: 1, toOpacity: 0.5, startedAtMs: 100, durationMs: 0 } },
				100
			)
		).toEqual({ n0: 0.5 });
	});

	it('lists node ids whose opacity animation is still in progress', () => {
		const animations = {
			n0: { fromOpacity: 1, toOpacity: 0.5, startedAtMs: 100, durationMs: 200 },
			n1: { fromOpacity: 0.5, toOpacity: 1, startedAtMs: 100, durationMs: 400 }
		};

		expect(activeLayoutOpacityAnimationNodeIds(animations, 150)).toEqual(['n0', 'n1']);
		expect(activeLayoutOpacityAnimationNodeIds(animations, 350)).toEqual(['n1']);
		expect(activeLayoutOpacityAnimationNodeIds(animations, 500)).toEqual([]);
	});

	it('reports and prunes finished animations', () => {
		const animations = {
			n0: { fromOpacity: 1, toOpacity: 0.5, startedAtMs: 100, durationMs: 200 },
			n1: { fromOpacity: 0.5, toOpacity: 1, startedAtMs: 100, durationMs: 400 }
		};

		expect(hasActiveLayoutOpacityAnimations(animations, 500)).toBe(false);
		expect(pruneFinishedLayoutOpacityAnimations(animations, 500)).toEqual({});
		expect(hasActiveLayoutOpacityAnimations(animations, 250)).toBe(true);
		expect(pruneFinishedLayoutOpacityAnimations(animations, 350)).toEqual({
			n1: animations.n1
		});
	});
});
