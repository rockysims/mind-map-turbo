import { describe, expect, it } from 'vitest';
import type { EdgeData } from '../../types/edge';
import {
	TAG_PHYSICS_MAX_FACTOR,
	TAG_PHYSICS_MIN_FACTOR,
	clampTagPhysicsFactor,
	elementFactor,
	factorForSliderPosition,
	formatTagPhysicsFactor,
	repulsionFactorByNodeId,
	sliderPositionForFactor,
	withTagGapFactors
} from './tagPhysics';

function edge(id: string, tags: string[], extra: Partial<EdgeData> = {}): EdgeData {
	return { id, sourceNodeId: `${id}-s`, targetNodeId: `${id}-t`, tags, ...extra };
}

describe('tagPhysics', () => {
	describe('range', () => {
		// The floor is the default: below ×1 an edge length is contested by hop-1
		// repulsion and a node spacing cannot pull, since repulsion only pushes.
		it('spans ×1 to ×8', () => {
			expect(TAG_PHYSICS_MIN_FACTOR).toBe(1);
			expect(TAG_PHYSICS_MAX_FACTOR).toBe(8);
		});
	});

	describe('clampTagPhysicsFactor', () => {
		it('clamps into the stored range', () => {
			expect(clampTagPhysicsFactor(9)).toBe(8);
			expect(clampTagPhysicsFactor(0.1)).toBe(1);
			expect(clampTagPhysicsFactor(0.5)).toBe(1);
			expect(clampTagPhysicsFactor(1.4)).toBe(1.4);
		});

		it('takes the bounds as parameters', () => {
			expect(clampTagPhysicsFactor(9, 0.5, 2)).toBe(2);
			expect(clampTagPhysicsFactor(0.1, 0.5, 2)).toBe(0.5);
		});
	});

	describe('elementFactor', () => {
		// The product would give 0.72, below both: two "slightly shorter" tags would
		// make an edge much shorter than either asked for.
		it('lands strictly between two configured factors rather than multiplying them', () => {
			const factor = elementFactor(['a', 'b'], { a: 0.9, b: 0.8 });

			expect(factor).toBeGreaterThan(0.8);
			expect(factor).toBeLessThan(0.9);
			expect(factor).toBeCloseTo(Math.sqrt(0.9 * 0.8), 12);
		});

		it('cancels factors that are reciprocal', () => {
			expect(elementFactor(['a', 'b'], { a: 2, b: 0.5 })).toBe(1);
		});

		it('ignores tags that have no factor', () => {
			expect(elementFactor(['a', 'untuned'], { a: 2 })).toBe(2);
		});

		it('returns the shared value exactly when every configured tag agrees', () => {
			expect(elementFactor(['a', 'b'], { a: 1.4, b: 1.4 })).toBe(1.4);
			expect(elementFactor(['a'], { a: 0.71 })).toBe(0.71);
		});

		it('is 1 for an element with no tags', () => {
			expect(elementFactor([], { a: 2 })).toBe(1);
		});

		it('is 1 when none of the tags is configured', () => {
			expect(elementFactor(['x', 'y'], { a: 2 })).toBe(1);
			expect(elementFactor(['x'], undefined)).toBe(1);
		});

		it('ignores stored values that are not finite and positive', () => {
			expect(elementFactor(['a'], { a: Number.NaN })).toBe(1);
			expect(elementFactor(['a', 'b'], { a: 0, b: 2 })).toBe(2);
			expect(elementFactor(['a', 'b'], { a: -1, b: Number.POSITIVE_INFINITY })).toBe(1);
		});

		it('counts a repeated tag once', () => {
			expect(elementFactor(['a', 'a', 'b'], { a: 2, b: 0.5 })).toBe(1);
		});

		it('does not mistake inherited object keys for configured tags', () => {
			expect(elementFactor(['constructor', 'toString'], { a: 2 })).toBe(1);
		});
	});

	describe('withTagGapFactors', () => {
		const edges = [edge('e1', ['rel']), edge('e2', ['other'])];

		it('returns its input by reference when there is no config', () => {
			expect(withTagGapFactors(edges, undefined)).toBe(edges);
		});

		it('returns its input by reference when the edge config is empty', () => {
			expect(withTagGapFactors(edges, { nodeTags: { topic: 2 }, edgeTags: {} })).toBe(edges);
		});

		it('returns its input by reference when no edge carries a configured tag', () => {
			expect(withTagGapFactors(edges, { nodeTags: {}, edgeTags: { unused: 2 } })).toBe(edges);
		});

		it('stamps a factor only on edges whose factor differs from 1', () => {
			const weighed = withTagGapFactors(edges, { nodeTags: {}, edgeTags: { rel: 2 } });

			expect(weighed).not.toBe(edges);
			expect(weighed[0]).toEqual({ ...edges[0], gapFactor: 2 });
			// Untouched by reference, and never given `gapFactor: 1`.
			expect(weighed[1]).toBe(edges[1]);
			expect(weighed[1]).not.toHaveProperty('gapFactor');
		});

		it('never writes gapFactor: 1 when an edge’s tags cancel out', () => {
			const cancelling = [edge('e1', ['long', 'short'])];
			const weighed = withTagGapFactors(cancelling, {
				nodeTags: {},
				edgeTags: { long: 2, short: 0.5 }
			});

			expect(weighed).toBe(cancelling);
			expect(weighed[0]).not.toHaveProperty('gapFactor');
		});

		it('keeps springFactor and every other field', () => {
			const derived = [edge('e1', ['rel'], { directed: true, springFactor: 0.3 })];

			expect(withTagGapFactors(derived, { nodeTags: {}, edgeTags: { rel: 0.5 } })).toEqual([
				{ ...derived[0], gapFactor: 0.5 }
			]);
		});

		it('does not mutate the input', () => {
			const input = [edge('e1', ['rel'])];
			withTagGapFactors(input, { nodeTags: {}, edgeTags: { rel: 2 } });

			expect(input[0]).not.toHaveProperty('gapFactor');
		});
	});

	describe('repulsionFactorByNodeId', () => {
		const nodes = [
			{ id: 'a', tags: ['far'] },
			{ id: 'b', tags: [] },
			{ id: 'c', tags: ['far', 'near'] }
		];

		it('is undefined with no config', () => {
			expect(repulsionFactorByNodeId(nodes, undefined)).toBeUndefined();
		});

		it('is undefined when the node config is empty', () => {
			expect(repulsionFactorByNodeId(nodes, { nodeTags: {}, edgeTags: { rel: 2 } })).toBe(
				undefined
			);
		});

		it('lists only nodes whose factor differs from 1', () => {
			expect(
				repulsionFactorByNodeId(nodes, { nodeTags: { far: 4, near: 0.25 }, edgeTags: {} })
			).toEqual({ a: 4 });
			expect(repulsionFactorByNodeId(nodes, { nodeTags: { far: 4 }, edgeTags: {} })).toEqual({
				a: 4,
				c: 4
			});
		});
	});

	describe('slider mapping', () => {
		// Every position the native input can produce: min 0, max 3, step 0.05.
		const stepPositions = Array.from({ length: 61 }, (_, index) => index / 20);

		it('puts ×1 at the left end and ×8 at the right end', () => {
			expect(factorForSliderPosition(0)).toBe(1);
			expect(factorForSliderPosition(1)).toBe(2);
			expect(factorForSliderPosition(2)).toBe(4);
			expect(factorForSliderPosition(3)).toBe(8);
		});

		it('round-trips the slider ends', () => {
			expect(sliderPositionForFactor(factorForSliderPosition(0))).toBe(0);
			expect(sliderPositionForFactor(factorForSliderPosition(3))).toBe(3);
		});

		it('rounds a stored factor to three decimals', () => {
			expect(factorForSliderPosition(0.5)).toBe(1.414);
			expect(factorForSliderPosition(1.5)).toBe(2.828);
		});

		it('clamps a position past the slider ends into range', () => {
			expect(factorForSliderPosition(4)).toBe(8);
			expect(factorForSliderPosition(-0.5)).toBe(1);
			expect(factorForSliderPosition(-4)).toBe(1);
		});

		it('round-trips every step position', () => {
			for (const position of stepPositions) {
				expect(sliderPositionForFactor(factorForSliderPosition(position))).toBe(position);
			}
		});

		it('snaps an off-step factor to the nearest step', () => {
			expect(sliderPositionForFactor(1.4)).toBe(0.5);
			expect(sliderPositionForFactor(1.01)).toBe(0);
		});

		it('clamps a factor past the range to the slider ends', () => {
			expect(sliderPositionForFactor(9)).toBe(3);
			expect(sliderPositionForFactor(0.5)).toBe(0);
			expect(sliderPositionForFactor(0.1)).toBe(0);
		});

		it('reads a factor that is not finite and positive as the left end', () => {
			expect(sliderPositionForFactor(0)).toBe(0);
			expect(sliderPositionForFactor(-1)).toBe(0);
			expect(sliderPositionForFactor(Number.NaN)).toBe(0);
		});
	});

	describe('formatTagPhysicsFactor', () => {
		it('shows two significant figures after a multiplication sign', () => {
			expect(formatTagPhysicsFactor(1)).toBe('×1.0');
			expect(formatTagPhysicsFactor(1.414)).toBe('×1.4');
			expect(formatTagPhysicsFactor(1.035)).toBe('×1.0');
			expect(formatTagPhysicsFactor(2.828)).toBe('×2.8');
			expect(formatTagPhysicsFactor(4)).toBe('×4.0');
			expect(formatTagPhysicsFactor(8)).toBe('×8.0');
		});
	});
});
