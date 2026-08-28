import { describe, expect, it } from 'vitest';
import {
	hopsFromPinned,
	radiusOf,
	scaleByHops,
	shortestPathHopsByNodeId,
	withHopsThroughEdges
} from './layout';
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

	describe('shortestPathHopsByNodeId', () => {
		it('computes pairwise shortest paths across the graph', () => {
			const graph = makeGraph({
				nodeCount: 5,
				edges: [
					[0, 1],
					[1, 2],
					[0, 3],
					[3, 2]
				]
			});

			expect(shortestPathHopsByNodeId(graph)).toEqual({
				n0: { n0: 0, n1: 1, n2: 2, n3: 1, n4: Infinity },
				n1: { n0: 1, n1: 0, n2: 1, n3: 2, n4: Infinity },
				n2: { n0: 2, n1: 1, n2: 0, n3: 1, n4: Infinity },
				n3: { n0: 1, n1: 2, n2: 1, n3: 0, n4: Infinity },
				n4: { n0: Infinity, n1: Infinity, n2: Infinity, n3: Infinity, n4: 0 }
			});
		});
	});

	describe('withHopsThroughEdges', () => {
		// n0 pinned, joined to nothing; n1—n2 authored off on their own. A dataflow
		// edge n0→n1 is the only thing tying the two together.
		const detached = makeGraph({ nodeCount: 3, pinned: [0], edges: [[1, 2]] });
		const dataflow = [{ sourceNodeId: 'n0', targetNodeId: 'n1' }];

		it('measures a node the extra edges reach', () => {
			const hops = withHopsThroughEdges(detached, { n0: 0, n1: 1, n2: 1 }, dataflow);

			expect(hops.n1).toBe(1);
		});

		it('pushes a node behind a reached one out by a hop', () => {
			// n2 comes in at the flat hop a beacon gets, which stands in for "no path
			// to a pin". There is a path now, and it runs through n1, so n2 is two
			// steps out and should read as smaller than n1 rather than its equal.
			const hops = withHopsThroughEdges(detached, { n0: 0, n1: 1, n2: 1 }, dataflow);

			expect(hops.n2).toBe(2);
		});

		it('leaves a node the extra edges never reach at the hop it came with', () => {
			const isolated = makeGraph({ nodeCount: 3, pinned: [0], edges: [] });

			expect(withHopsThroughEdges(isolated, { n0: 0, n1: 1, n2: 1 }, dataflow).n2).toBe(1);
		});

		it('caps at the displayed layers so a distant node stays on screen', () => {
			// Sized down to the outermost visible ring rather than off the canvas: a
			// beacon exists to keep its cluster reachable.
			const chain = makeGraph({
				nodeCount: 4,
				pinned: [0],
				edges: [
					[1, 2],
					[2, 3]
				]
			});

			expect(
				withHopsThroughEdges(chain, { n0: 0, n1: 1, n2: 1, n3: 1 }, dataflow, {
					displayedLayers: 2
				}).n3
			).toBe(2);
		});

		it('returns the same object when the extra edges change nothing', () => {
			const hops = { n0: 0, n1: 1, n2: 1 };

			expect(withHopsThroughEdges(detached, hops, [])).toBe(hops);
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
