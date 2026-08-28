import { describe, expect, it } from 'vitest';
import { BEACON_HOP, beaconNodeIds, withBeaconHops } from './beacons';
import { hopsFromPinned } from './layout';
import { graphWithVisibleNodes } from './boundedVisibility';
import { makeGraph } from './testFixtures';

describe('beaconNodeIds', () => {
	it('returns no beacons for components containing a pinned node', () => {
		const graph = makeGraph({
			nodeCount: 3,
			edges: [
				[0, 1],
				[1, 2]
			],
			pinned: [0]
		});

		expect(beaconNodeIds(graph)).toEqual(new Set());
	});

	it('counts components on the authored edges alone', () => {
		// n0 alone and n1—n2 are two components on the author's own edges, and stay
		// two however many equations tie them together. Merging them would leave the
		// second cluster represented only by whatever the derived budget reveals —
		// a whole cluster mostly vanishing because someone wrote an equation.
		const graph = makeGraph({ nodeCount: 3, edges: [[1, 2]] });

		expect(beaconNodeIds(graph).size).toBe(2);
	});

	it('returns one beacon per pinless component', () => {
		const graph = makeGraph({
			nodeCount: 5,
			edges: [
				[0, 1],
				[2, 3]
			],
			pinned: [0]
		});

		const beacons = beaconNodeIds(graph);

		expect(beacons.size).toBe(2);
		expect([...beacons].some((id) => ['n2', 'n3'].includes(id))).toBe(true);
		expect(beacons.has('n4')).toBe(true);
	});

	it('prefers the node with the highest pin recency', () => {
		const graph = makeGraph({
			nodeCount: 3,
			edges: [
				[0, 1],
				[1, 2]
			],
			pinHistory: { 0: 2, 2: 5 }
		});

		expect(beaconNodeIds(graph)).toEqual(new Set(['n2']));
	});

	it('pin recency outranks the preferred-node hint', () => {
		const graph = makeGraph({ nodeCount: 2, edges: [[0, 1]], pinHistory: { 0: 1 } });

		expect(beaconNodeIds(graph, { preferredNodeIds: ['n1'] })).toEqual(new Set(['n0']));
	});

	it('uses the preferred-node hint when the component has no pin history', () => {
		const graph = makeGraph({
			nodeCount: 3,
			edges: [
				[0, 1],
				[1, 2]
			]
		});

		expect(beaconNodeIds(graph, { preferredNodeIds: ['n1', 'n0'] })).toEqual(new Set(['n1']));
	});

	it('ignores preferred ids that are absent or sit in pinned components', () => {
		const graph = makeGraph({
			nodeCount: 4,
			edges: [
				[0, 1],
				[2, 3]
			],
			pinned: [0]
		});

		const beacons = beaconNodeIds(graph, { preferredNodeIds: ['missing', 'n1', 'n3'] });

		expect(beacons).toEqual(new Set(['n3']));
	});

	it('falls back to highest degree with lowest-id tie-break', () => {
		// n1 has degree 2 (n0, n2); parallel edges to n0 do not inflate it past a Set.
		const star = makeGraph({
			nodeCount: 3,
			edges: [
				[0, 1],
				[1, 0],
				[1, 2]
			]
		});
		expect(beaconNodeIds(star)).toEqual(new Set(['n1']));

		// Equal degrees: lowest node id wins.
		const pair = makeGraph({ nodeCount: 2, edges: [[0, 1]] });
		expect(beaconNodeIds(pair)).toEqual(new Set(['n0']));
	});

	it('is idempotent when re-applied to the visible subgraph', () => {
		const graph = makeGraph({
			nodeCount: 6,
			edges: [
				[0, 1],
				[1, 2],
				[3, 4],
				[4, 5]
			],
			pinned: [0],
			pinHistory: { 4: 3 }
		});

		const beacons = beaconNodeIds(graph);
		const visibleIds = new Set(['n0', 'n1', 'n2', ...beacons]);
		const visibleGraph = graphWithVisibleNodes(graph, visibleIds);

		expect(beaconNodeIds(visibleGraph)).toEqual(beacons);
	});

	it('handles an empty graph', () => {
		expect(beaconNodeIds(makeGraph())).toEqual(new Set());
	});
});

describe('withBeaconHops', () => {
	it('overrides beacon hops to BEACON_HOP and leaves neighbors at Infinity', () => {
		const graph = makeGraph({
			nodeCount: 4,
			edges: [
				[0, 1],
				[2, 3]
			],
			pinned: [0],
			pinHistory: { 2: 1 }
		});

		const hops = withBeaconHops(hopsFromPinned(graph), beaconNodeIds(graph));

		expect(hops).toEqual({ n0: 0, n1: 1, n2: BEACON_HOP, n3: Infinity });
	});

	it('returns the original hops when there are no beacons', () => {
		const graph = makeGraph({ nodeCount: 2, edges: [[0, 1]], pinned: [0] });
		const hops = hopsFromPinned(graph);

		expect(withBeaconHops(hops, new Set())).toBe(hops);
	});
});
