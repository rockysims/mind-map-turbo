import { describe, expect, it } from 'vitest';
import { hopsFromPinned, radiusOf, scaleByHops } from './layout';
import { makeGraph } from './testFixtures';

describe('layout', () => {
	describe('hopsFromPinned', () => {
		it('computes hop distance from a single pinned source', () => {
			const graph = makeGraph({
				nodeCount: 4,
				pinned: [0],
				edges: [
					[0, 1],
					[1, 2]
				]
			});

			expect(hopsFromPinned(graph)).toEqual({
				n0: 0,
				n1: 1,
				n2: 2,
				n3: Infinity
			});
		});

		it('uses the shortest distance from multiple pinned sources', () => {
			const graph = makeGraph({
				nodeCount: 5,
				pinned: [0, 4],
				edges: [
					[0, 1],
					[1, 2],
					[2, 3],
					[3, 4]
				]
			});

			expect(hopsFromPinned(graph)).toEqual({
				n0: 0,
				n1: 1,
				n2: 2,
				n3: 1,
				n4: 0
			});
		});

		it('handles cycles without revisiting longer paths', () => {
			const graph = makeGraph({
				nodeCount: 4,
				pinned: [0],
				edges: [
					[0, 1],
					[1, 2],
					[2, 0],
					[2, 3]
				]
			});

			expect(hopsFromPinned(graph)).toMatchObject({
				n0: 0,
				n1: 1,
				n2: 1,
				n3: 2
			});
		});

		it('treats every node as unreachable when nothing is pinned', () => {
			const graph = makeGraph({ nodeCount: 2, edges: [[0, 1]] });

			expect(hopsFromPinned(graph)).toEqual({
				n0: Infinity,
				n1: Infinity
			});
		});
	});

	describe('scaleByHops', () => {
		it('applies falloff per hop with a minimum scale floor', () => {
			expect(scaleByHops({ n0: 0, n1: 1, n2: 4 }, { scaleFalloff: 0.5, minScale: 0.2 })).toEqual({
				n0: 1,
				n1: 0.5,
				n2: 0.2
			});
		});

		it('resolves unreachable nodes to the minimum scale', () => {
			expect(scaleByHops({ n0: Infinity }, { minScale: 0.15 })).toEqual({ n0: 0.15 });
		});
	});

	describe('radiusOf', () => {
		it('derives radius from base radius and node scale', () => {
			expect(radiusOf({ n0: 0.5 }, { baseRadius: 100 }, 'n0')).toBe(50);
		});

		it('uses minScale for missing node ids', () => {
			expect(radiusOf({}, { baseRadius: 100, minScale: 0.25 }, 'missing')).toBe(25);
		});
	});
});
