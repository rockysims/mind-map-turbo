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

	it('the preferred-node hint outranks pin recency', () => {
		// n1 is where the removal was, so it beats the node the reader pinned at some
		// earlier point somewhere else in the same component.
		const graph = makeGraph({ nodeCount: 2, edges: [[0, 1]], pinHistory: { 0: 1 } });

		expect(beaconNodeIds(graph, { preferredNodeIds: ['n1'] })).toEqual(new Set(['n1']));
	});

	it('settles the preferred nodes among themselves by pin recency', () => {
		// Both endpoints of a removed edge are equally close to it, so the ordinary
		// rules pick between them — and skip n2, which the hint does not name.
		const graph = makeGraph({
			nodeCount: 3,
			edges: [
				[0, 1],
				[1, 2]
			],
			pinHistory: { 1: 2, 2: 9 }
		});

		expect(beaconNodeIds(graph, { preferredNodeIds: ['n0', 'n1'] })).toEqual(new Set(['n1']));
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

	it('makes an edge-less unpinned node its own beacon', () => {
		// Intended behaviour, not an accident: an isolated node is its own
		// component, so it always elects itself and is always visible. Nodes
		// never silently disappear just because nothing links to them.
		const graph = makeGraph({ nodeCount: 3, edges: [[0, 1]], pinned: [0] });

		expect(beaconNodeIds(graph)).toEqual(new Set(['n2']));
	});

	it('counts a self-loop as one degree, so it can decide the election', () => {
		// Self-loops cannot be created through the UI but can arrive in JSON
		// written by other programs, so selection must stay well-defined.
		// buildAdjacency lists the node as its own neighbor, so a self-loop adds
		// exactly 1 to the distinct-neighbor degree.
		const selfLoop = makeGraph({
			nodeCount: 2,
			edges: [
				[0, 1],
				[1, 1]
			]
		});
		// n1: {n0, n1} = degree 2, n0: {n1} = degree 1 (without the self-loop the
		// degrees would tie and lowest-id n0 would win).
		expect(beaconNodeIds(selfLoop)).toEqual(new Set(['n1']));

		// A lone node with only a self-loop is still its own component/beacon.
		const lonely = makeGraph({ nodeCount: 1, edges: [[0, 0]] });
		expect(beaconNodeIds(lonely)).toEqual(new Set(['n0']));
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

	it('reuses memoized results only while nodes and edges are unchanged', () => {
		const graph = makeGraph({ nodeCount: 2, edges: [[0, 1]] });

		expect(beaconNodeIds(graph)).toBe(beaconNodeIds(graph));

		// Mutations rebuild the nodes array, so the memo cannot go stale.
		const pinnedGraph = { ...graph, nodes: graph.nodes.map((node) => ({ ...node, pinned: true })) };
		expect(beaconNodeIds(pinnedGraph)).toEqual(new Set());
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
