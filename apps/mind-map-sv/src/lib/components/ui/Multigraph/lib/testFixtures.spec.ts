import { describe, it, expect } from 'vitest';
import { makeGraph } from './testFixtures';

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
});
