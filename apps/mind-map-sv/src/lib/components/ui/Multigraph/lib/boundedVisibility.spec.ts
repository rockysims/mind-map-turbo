import { describe, expect, it } from 'vitest';
import { hopsFromPinned } from './layout';
import { beaconNodeIds, withBeaconHops } from './beacons';
import {
	edgeVisibilityForPinnedNeighborhood,
	graphWithVisibleNodes,
	pinnedNodeIds,
	visibleNodeIdsForPinnedNeighborhood
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
