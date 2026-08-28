import { describe, expect, it } from 'vitest';
import { hopsFromPinned } from './layout';
import { beaconNodeIds, withBeaconHops } from './beacons';
import {
	edgeVisibilityForPinnedNeighborhood,
	graphWithVisibleNodes,
	pinnedNodeIds,
	visibleNodeIdsForPinnedNeighborhood,
	withRevealedNeighborHops
} from './boundedVisibility';
import { makeGraph } from './testFixtures';

describe('boundedVisibility', () => {
	it('shows exactly the beacon of a pinless component under beacon-effective hops', () => {
		const graph = makeGraph({
			nodeCount: 4,
			edges: [
				[0, 1],
				[1, 2]
			],
			pinHistory: { 1: 5 }
		});

		const hops = withBeaconHops(hopsFromPinned(graph), beaconNodeIds(graph));

		expect(visibleNodeIdsForPinnedNeighborhood(graph, hops, { displayedLayers: 1 })).toEqual(
			new Set(['n1', 'n3'])
		);
	});

	it('shows nodes within displayedLayers hops of one pinned node', () => {
		const graph = makeGraph({
			nodeCount: 5,
			pinned: [0],
			edges: [
				[0, 1],
				[1, 2],
				[2, 3]
			]
		});

		expect([
			...visibleNodeIdsForPinnedNeighborhood(graph, hopsFromPinned(graph), { displayedLayers: 2 })
		]).toEqual(['n0', 'n1', 'n2']);
	});

	it('unions overlapping neighborhoods for multiple pinned nodes', () => {
		const graph = makeGraph({
			nodeCount: 7,
			pinned: [0, 4],
			edges: [
				[0, 1],
				[1, 2],
				[2, 3],
				[3, 4],
				[4, 5]
			]
		});

		expect([
			...visibleNodeIdsForPinnedNeighborhood(graph, hopsFromPinned(graph), { displayedLayers: 1 })
		]).toEqual(['n0', 'n1', 'n3', 'n4', 'n5']);
	});

	describe('withRevealedNeighborHops', () => {
		// n0 pinned, a chain out to n3, and n4/n5 in a component of their own.
		const graph = makeGraph({
			nodeCount: 6,
			pinned: [0],
			edges: [
				[0, 1],
				[1, 2],
				[2, 3],
				[4, 5]
			]
		});
		const baseHops = () => hopsFromPinned(graph);
		const visible = (hops: Record<string, number>, displayedLayers = 2) => [
			...visibleNodeIdsForPinnedNeighborhood(graph, hops, { displayedLayers })
		];

		it('brings a hidden endpoint into view one layer out from its anchor', () => {
			const hops = withRevealedNeighborHops(
				baseHops(),
				[{ sourceNodeId: 'n0', targetNodeId: 'n4' }],
				{ displayedLayers: 2 }
			);

			expect(hops.n4).toBe(1);
			expect(visible(hops)).toContain('n4');
		});

		it('does not drag the revealed node\u2019s own neighbors along', () => {
			// The whole point of the rule: n4 appears, n5 does not, so one equation
			// cannot open up a cluster the author never connected.
			const hops = withRevealedNeighborHops(
				baseHops(),
				[{ sourceNodeId: 'n0', targetNodeId: 'n4' }],
				{ displayedLayers: 2 }
			);

			expect(hops.n5).toBe(Infinity);
			expect(visible(hops)).not.toContain('n5');
		});

		it('does not let a revealed node anchor another reveal', () => {
			// Measured against the hops passed in, so n4 being revealed in this same
			// pass cannot make n5 visible through a second dataflow edge.
			const hops = withRevealedNeighborHops(
				baseHops(),
				[
					{ sourceNodeId: 'n0', targetNodeId: 'n4' },
					{ sourceNodeId: 'n4', targetNodeId: 'n5' }
				],
				{ displayedLayers: 2 }
			);

			expect(hops.n5).toBe(Infinity);
		});

		it('reveals in either direction', () => {
			const hops = withRevealedNeighborHops(
				baseHops(),
				[{ sourceNodeId: 'n4', targetNodeId: 'n0' }],
				{ displayedLayers: 2 }
			);

			expect(hops.n4).toBe(1);
		});

		it('takes the closest anchor when several reveal the same node', () => {
			const hops = withRevealedNeighborHops(
				baseHops(),
				[
					{ sourceNodeId: 'n2', targetNodeId: 'n4' },
					{ sourceNodeId: 'n0', targetNodeId: 'n4' }
				],
				{ displayedLayers: 2 }
			);

			expect(hops.n4).toBe(1);
		});

		it('caps the revealed hop so a node hanging off the last layer still shows', () => {
			// n2 sits on the outermost visible layer; n4 would land at 3 and be
			// filtered straight back out.
			const hops = withRevealedNeighborHops(
				baseHops(),
				[{ sourceNodeId: 'n2', targetNodeId: 'n4' }],
				{ displayedLayers: 2 }
			);

			expect(hops.n4).toBe(2);
			expect(visible(hops)).toContain('n4');
		});

		it('leaves an edge between two hidden nodes alone', () => {
			const hops = withRevealedNeighborHops(
				baseHops(),
				[{ sourceNodeId: 'n4', targetNodeId: 'n5' }],
				{ displayedLayers: 2 }
			);

			expect(hops.n4).toBe(Infinity);
			expect(hops.n5).toBe(Infinity);
		});

		it('returns the same object when nothing is revealed', () => {
			const hops = baseHops();

			expect(withRevealedNeighborHops(hops, [], { displayedLayers: 2 })).toBe(hops);
		});

		it('ignores an edge naming a node the graph does not have', () => {
			const hops = baseHops();

			expect(
				withRevealedNeighborHops(hops, [{ sourceNodeId: 'n0', targetNodeId: 'gone' }], {
					displayedLayers: 2
				})
			).toBe(hops);
		});
	});

	it('shows only the beacon of a severed component next to a pinned neighborhood', () => {
		const graph = makeGraph({
			nodeCount: 5,
			pinned: [0],
			edges: [
				[0, 1],
				[2, 3],
				[3, 4]
			],
			pinHistory: { 3: 2 }
		});

		const hops = withBeaconHops(hopsFromPinned(graph), beaconNodeIds(graph));

		expect([...visibleNodeIdsForPinnedNeighborhood(graph, hops, { displayedLayers: 3 })]).toEqual([
			'n0',
			'n1',
			'n3'
		]);
	});

	it('classifies every beacon edge as a boundary half-edge', () => {
		const graph = makeGraph({
			nodeCount: 4,
			pinned: [0],
			edges: [
				[1, 2],
				[2, 3]
			],
			pinHistory: { 2: 1 }
		});

		const hops = withBeaconHops(hopsFromPinned(graph), beaconNodeIds(graph));

		expect(
			edgeVisibilityForPinnedNeighborhood(graph, hops, { displayedLayers: 3 }).map(
				(visibility) => visibility.kind
			)
		).toEqual(['boundary', 'boundary']);
	});

	it('returns a graph with only visible nodes and edges between visible endpoints', () => {
		const graph = makeGraph({
			nodeCount: 4,
			edges: [
				[0, 1],
				[1, 2],
				[2, 3],
				[0, 3]
			]
		});

		const visibleGraph = graphWithVisibleNodes(graph, new Set(['n0', 'n1', 'n3']));

		expect(visibleGraph.nodes.map((node) => node.id)).toEqual(['n0', 'n1', 'n3']);
		expect(visibleGraph.edges.map((edge) => edge.id)).toEqual(['e0', 'e3']);
	});

	it('returns pinned node ids', () => {
		const graph = makeGraph({ nodeCount: 4, pinned: [1, 3] });

		expect([...pinnedNodeIds(graph)]).toEqual(['n1', 'n3']);
	});

	it('returns an empty set when no nodes are pinned', () => {
		const graph = makeGraph({ nodeCount: 3 });

		expect(pinnedNodeIds(graph)).toEqual(new Set());
	});

	it('classifies visible-visible edges as full visible edges', () => {
		const graph = makeGraph({
			nodeCount: 3,
			pinned: [0, 2],
			edges: [
				[0, 1],
				[1, 2]
			]
		});

		expect(
			edgeVisibilityForPinnedNeighborhood(graph, hopsFromPinned(graph), { displayedLayers: 1 }).map(
				(edge) => edge.kind
			)
		).toEqual(['visible', 'visible']);
	});

	it('adds boundary metadata for one-visible one-hidden edges', () => {
		const graph = makeGraph({
			nodeCount: 4,
			pinned: [0],
			edges: [
				[0, 1],
				[1, 2],
				[2, 3]
			]
		});

		const edgeVisibility = edgeVisibilityForPinnedNeighborhood(graph, hopsFromPinned(graph), {
			displayedLayers: 1,
			boundaryFadeRatio: 0.25
		});

		expect(edgeVisibility[0]).toMatchObject({ kind: 'visible' });
		expect(edgeVisibility[1]).toEqual({
			kind: 'boundary',
			edge: graph.edges[1],
			visibleNodeId: 'n1',
			hiddenNodeId: 'n2',
			visibleEndpoint: 'source',
			hiddenEndpoint: 'target',
			fadeRatio: 0.25
		});
		expect(edgeVisibility[2]).toMatchObject({ kind: 'hidden' });
	});
});
