import { describe, it, expect } from 'vitest';
import {
	assignNodeGroups,
	makeClusteredRandomEdges,
	makeGraph,
	makeRandomEdges
} from './testFixtures';

describe('makeGraph', () => {
	it('produces an empty graph by default', () => {
		const g = makeGraph();
		expect(g.nodes).toEqual([]);
		expect(g.edges).toEqual([]);
		expect(g.posByNodeId).toEqual({});
	});

	it('generates nodes by count with default ids and titles', () => {
		const g = makeGraph({ nodeCount: 3 });
		expect(g.nodes).toHaveLength(3);
		expect(g.nodes.map((n) => n.id)).toEqual(['n0', 'n1', 'n2']);
		expect(g.nodes[0].title).toBe('Node 0');
	});

	it('creates edges from index pairs and assigns ids', () => {
		const g = makeGraph({
			nodeCount: 3,
			edges: [
				[0, 1],
				[1, 2]
			]
		});
		expect(g.edges).toHaveLength(2);
		expect(g.edges[0]).toMatchObject({ id: 'e0', sourceNodeId: 'n0', targetNodeId: 'n1' });
		expect(g.edges[1]).toMatchObject({ id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2' });
	});

	it('accepts edges by node id strings', () => {
		const g = makeGraph({ nodeCount: 2, edges: [['n0', 'n1']] });
		expect(g.edges[0]).toMatchObject({ sourceNodeId: 'n0', targetNodeId: 'n1' });
	});

	it('defaults positions to (0, 0) for every node', () => {
		const g = makeGraph({ nodeCount: 2 });
		expect(g.posByNodeId).toEqual({ n0: { x: 0, y: 0 }, n1: { x: 0, y: 0 } });
	});

	it('respects an explicit posByNodeId override', () => {
		const g = makeGraph({
			nodeCount: 2,
			posByNodeId: { n0: { x: 10, y: 20 } }
		});
		expect(g.posByNodeId).toEqual({ n0: { x: 10, y: 20 } });
	});

	it('marks generated nodes pinned by index', () => {
		const g = makeGraph({ nodeCount: 2, pinned: [0] });
		expect(g.nodes.map((node) => node.pinned)).toEqual([true, undefined]);
	});

	it('marks generated nodes pinned by id', () => {
		const g = makeGraph({ nodeCount: 2, pinned: ['n1'] });
		expect(g.nodes.map((node) => node.pinned)).toEqual([undefined, true]);
	});
});

describe('makeRandomEdges', () => {
	it('returns the same edges for the same seed', () => {
		const first = makeRandomEdges({ nodeCount: 100, edgeCount: 300, seed: 42 });
		const second = makeRandomEdges({ nodeCount: 100, edgeCount: 300, seed: 42 });
		expect(second).toEqual(first);
	});

	it('returns different edges for different seeds', () => {
		const first = makeRandomEdges({ nodeCount: 100, edgeCount: 300, seed: 42 });
		const second = makeRandomEdges({ nodeCount: 100, edgeCount: 300, seed: 99 });
		expect(second).not.toEqual(first);
	});

	it('generates unique non-self edges', () => {
		const edges = makeRandomEdges({ nodeCount: 100, edgeCount: 300, seed: 42 });
		expect(edges).toHaveLength(300);
		const seen = new Set<string>();
		for (const [source, target] of edges) {
			expect(source).not.toBe(target);
			const key = `${source},${target}`;
			expect(seen.has(key)).toBe(false);
			seen.add(key);
		}
	});
});

describe('assignNodeGroups', () => {
	it('returns the same groups for the same seed', () => {
		const first = assignNodeGroups({ nodeCount: 100, groupCount: 8, seed: 42 });
		const second = assignNodeGroups({ nodeCount: 100, groupCount: 8, seed: 42 });
		expect(second).toEqual(first);
	});

	it('assigns every node to a valid group index', () => {
		const groups = assignNodeGroups({ nodeCount: 100, groupCount: 8, seed: 42 });
		expect(groups).toHaveLength(100);
		for (const group of groups) {
			expect(group).toBeGreaterThanOrEqual(0);
			expect(group).toBeLessThan(8);
		}
	});
});

describe('makeClusteredRandomEdges', () => {
	const nodeCount = 100;
	const edgeCount = 300;
	const groupCount = 8;
	const crossGroupFraction = 0.05;
	const seed = 42;

	function crossGroupCount(edges: Array<[number, number]>, groupByNode: number[]): number {
		return edges.filter(([source, target]) => groupByNode[source] !== groupByNode[target]).length;
	}

	function isConnected(nodeCount: number, edges: Array<[number, number]>): boolean {
		const parent = Array.from({ length: nodeCount }, (_, index) => index);

		function find(index: number): number {
			if (parent[index] !== index) parent[index] = find(parent[index]);
			return parent[index];
		}

		function unite(left: number, right: number): void {
			const leftRoot = find(left);
			const rightRoot = find(right);
			if (leftRoot !== rightRoot) parent[leftRoot] = rightRoot;
		}

		for (const [source, target] of edges) unite(source, target);

		const root = find(0);
		for (let index = 1; index < nodeCount; index += 1) {
			if (find(index) !== root) return false;
		}
		return true;
	}

	it('returns the same edges for the same seed', () => {
		const first = makeClusteredRandomEdges({
			nodeCount,
			edgeCount,
			groupCount,
			crossGroupFraction,
			seed
		});
		const second = makeClusteredRandomEdges({
			nodeCount,
			edgeCount,
			groupCount,
			crossGroupFraction,
			seed
		});
		expect(second).toEqual(first);
	});

	it('generates unique non-self edges with the requested cross-group fraction', () => {
		const edges = makeClusteredRandomEdges({
			nodeCount,
			edgeCount,
			groupCount,
			crossGroupFraction,
			seed
		});
		const groupByNode = assignNodeGroups({ nodeCount, groupCount, seed });

		expect(edges).toHaveLength(edgeCount);
		const seen = new Set<string>();
		for (const [source, target] of edges) {
			expect(source).not.toBe(target);
			const key = `${source},${target}`;
			expect(seen.has(key)).toBe(false);
			seen.add(key);
		}

		expect(crossGroupCount(edges, groupByNode)).toBe(Math.round(edgeCount * crossGroupFraction));
	});

	it('produces one connected component', () => {
		const edges = makeClusteredRandomEdges({
			nodeCount,
			edgeCount,
			groupCount,
			crossGroupFraction,
			seed
		});

		expect(isConnected(nodeCount, edges)).toBe(true);
	});

	it('keeps most edges within the same group', () => {
		const edges = makeClusteredRandomEdges({
			nodeCount,
			edgeCount,
			groupCount,
			crossGroupFraction,
			seed
		});
		const groupByNode = assignNodeGroups({ nodeCount, groupCount, seed });
		const cross = crossGroupCount(edges, groupByNode);

		expect(cross / edgeCount).toBeLessThanOrEqual(crossGroupFraction + 0.01);
		expect((edgeCount - cross) / edgeCount).toBeGreaterThanOrEqual(1 - crossGroupFraction - 0.01);
	});
});
