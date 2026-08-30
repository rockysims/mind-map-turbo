import { describe, expect, it } from 'vitest';
import type { MultigraphData } from '../../types/multigraph';
import { arrivedNodeIds, importRevealTargetNodeId } from './importRevealTarget';
import { makeGraph } from './testFixtures';

/** The host the reader was already looking at: two connected nodes, one pinned. */
function hostGraph(): MultigraphData {
	return makeGraph({
		nodes: [
			{ id: 'h0', title: 'Host 0', description: '' },
			{ id: 'h1', title: 'Host 1', description: '' }
		],
		edges: [['h0', 'h1']],
		pinned: ['h0'],
		pinHistory: { h0: 1 }
	});
}

/**
 * Fold extra nodes/edges into a host the way an additive import does: nothing
 * existing is touched, everything new is appended.
 */
function withArrivals(
	host: MultigraphData,
	arrivals: MultigraphData['nodes'],
	edges: MultigraphData['edges'] = []
): MultigraphData {
	return {
		...host,
		nodes: [...host.nodes, ...arrivals],
		edges: [...host.edges, ...edges]
	};
}

function node(
	id: string,
	overrides: Partial<MultigraphData['nodes'][number]> = {}
): MultigraphData['nodes'][number] {
	return { id, title: id, description: '', tags: [], ...overrides };
}

function edge(id: string, sourceNodeId: string, targetNodeId: string) {
	return { id, sourceNodeId, targetNodeId, tags: [] };
}

describe('arrivedNodeIds', () => {
	it('names only the nodes the incoming graph added', () => {
		const host = hostGraph();
		const incoming = withArrivals(host, [node('a0'), node('a1')]);

		expect(arrivedNodeIds(host, incoming)).toEqual(['a0', 'a1']);
	});

	it('is empty when nothing arrived', () => {
		const host = hostGraph();

		expect(arrivedNodeIds(host, host)).toEqual([]);
	});
});

describe('importRevealTargetNodeId', () => {
	it('returns null when nothing arrived', () => {
		const host = hostGraph();

		expect(importRevealTargetNodeId(host, host)).toBeNull();
	});

	it('picks the pinned hub of the one arriving component', () => {
		const host = hostGraph();
		const incoming = withArrivals(
			host,
			[node('a0'), node('a1', { pinned: true, lastPinnedSeq: 5 }), node('a2')],
			[edge('ea0', 'a0', 'a1'), edge('ea1', 'a1', 'a2')]
		);

		expect(importRevealTargetNodeId(host, incoming)).toBe('a1');
	});

	it('prefers the hub of the largest arriving component over a more recent pin', () => {
		const host = hostGraph();
		const incoming = withArrivals(
			host,
			[
				// Three nodes, pinned earlier.
				node('big0', { pinned: true, lastPinnedSeq: 2 }),
				node('big1'),
				node('big2'),
				// Two nodes, pinned later.
				node('small0', { pinned: true, lastPinnedSeq: 9 }),
				node('small1')
			],
			[edge('eb0', 'big0', 'big1'), edge('eb1', 'big1', 'big2'), edge('es0', 'small0', 'small1')]
		);

		expect(importRevealTargetNodeId(host, incoming)).toBe('big0');
	});

	it('breaks a component-size tie by pin recency', () => {
		const host = hostGraph();
		const incoming = withArrivals(
			host,
			[
				node('a0', { pinned: true, lastPinnedSeq: 3 }),
				node('a1'),
				node('b0', { pinned: true, lastPinnedSeq: 7 }),
				node('b1')
			],
			[edge('ea', 'a0', 'a1'), edge('eb', 'b0', 'b1')]
		);

		expect(importRevealTargetNodeId(host, incoming)).toBe('b0');
	});

	it('breaks a size and recency tie by lowest node id', () => {
		const host = hostGraph();
		const incoming = withArrivals(host, [
			node('zeta', { pinned: true, lastPinnedSeq: 4 }),
			node('alpha', { pinned: true, lastPinnedSeq: 4 })
		]);

		expect(importRevealTargetNodeId(host, incoming)).toBe('alpha');
	});

	it('prefers the more recently pinned member inside one component', () => {
		const host = hostGraph();
		const incoming = withArrivals(
			host,
			[
				node('a0', { pinned: true, lastPinnedSeq: 1 }),
				node('a1', { pinned: true, lastPinnedSeq: 8 })
			],
			[edge('ea', 'a0', 'a1')]
		);

		expect(importRevealTargetNodeId(host, incoming)).toBe('a1');
	});

	it('cuts components over the arrivals alone, ignoring the host they were folded beside', () => {
		// 'a0' is joined to the (larger) host component by an edge; without the
		// arrivals-only cut its component would count the host's nodes and win.
		const host = hostGraph();
		const incoming = withArrivals(
			host,
			[
				node('a0', { pinned: true, lastPinnedSeq: 9 }),
				node('b0', { pinned: true, lastPinnedSeq: 2 }),
				node('b1')
			],
			[edge('bridge', 'h0', 'a0'), edge('eb', 'b0', 'b1')]
		);

		expect(importRevealTargetNodeId(host, incoming)).toBe('b0');
	});

	it('falls back to the first arrival when no arrival is pinned', () => {
		const host = hostGraph();
		const incoming = withArrivals(host, [node('a0'), node('a1')], [edge('ea', 'a0', 'a1')]);

		expect(importRevealTargetNodeId(host, incoming)).toBe('a0');
	});

	it('ignores host pins when choosing the hub', () => {
		const host = hostGraph();
		const incoming = withArrivals(host, [node('a0'), node('a1', { pinned: true })]);

		expect(importRevealTargetNodeId(host, incoming)).toBe('a1');
	});
});
