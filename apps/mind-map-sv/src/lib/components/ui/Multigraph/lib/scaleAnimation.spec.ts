import { describe, expect, it } from 'vitest';
import { togglePinned } from './graph';
import { deriveGraphLayout } from './graphLayout';
import { makeGraph } from './testFixtures';
import {
	activeScaleAnimationNodeIds,
	animatedScalesAt,
	createScaleAnimations,
	hasActiveScaleAnimations,
	interpolateScale,
	pruneFinishedScaleAnimations
} from './scaleAnimation';

const pinningLayoutSettings = {
	scaleFalloff: 0.5,
	minScale: 0.2,
	relaxIterations: 0
} as const;

describe('scaleAnimation', () => {
	it('creates animations when a node is pinned', () => {
		const graph = makeGraph({
			nodeCount: 3,
			edges: [
				[0, 1],
				[1, 2]
			]
		});
		const currentLayout = deriveGraphLayout(graph, { settings: pinningLayoutSettings });
		const pinnedLayout = deriveGraphLayout(togglePinned(graph, 'n0'), {
			settings: pinningLayoutSettings
		});

		expect(
			createScaleAnimations(currentLayout.scaleByNodeId, pinnedLayout.scaleByNodeId, 100, 120)
		).toMatchObject({
			n0: { fromScale: 0.2, toScale: 1, durationMs: 120 },
			n1: { fromScale: 0.2, toScale: 0.5, durationMs: 120 },
			n2: { fromScale: 0.2, toScale: 0.25, durationMs: 120 }
		});
	});

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

	it('lists node ids whose scale animation is still in progress', () => {
		const animations = {
			n0: { fromScale: 1, toScale: 0.2, startedAtMs: 100, durationMs: 200 },
			n1: { fromScale: 0.2, toScale: 0.5, startedAtMs: 100, durationMs: 400 }
		};

		expect(activeScaleAnimationNodeIds(animations, 150)).toEqual(['n0', 'n1']);
		expect(activeScaleAnimationNodeIds(animations, 350)).toEqual(['n1']);
		expect(activeScaleAnimationNodeIds(animations, 500)).toEqual([]);
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
