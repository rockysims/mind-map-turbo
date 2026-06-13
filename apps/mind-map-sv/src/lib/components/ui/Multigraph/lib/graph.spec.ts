import { describe, expect, it } from 'vitest';
import {
	addEdge,
	addNode,
	findExistingEdge,
	moveNode,
	neighborsOf,
	NEW_NODE_TITLE,
	normalizeNodeTitle,
	removeEdge,
	removeNode,
	togglePinned,
	updateNodeContent
} from './graph';
import { makeGraph } from './testFixtures';

describe('graph mutations', () => {
	describe('addNode', () => {
		it('adds a node with the next available generated id', () => {
			const graph = makeGraph({
				nodes: [
					{ id: 'n0', title: 'Node 0', description: '' },
					{ id: 'n2', title: 'Node 2', description: '' }
				]
			});

			const next = addNode(graph);

			expect(next.nodes.at(-1)).toMatchObject({ id: 'n1', title: 'New Node' });
			expect(next.posByNodeId.n1).toEqual({ x: 0, y: 0 });
		});

		it('preserves explicit node ids and positions', () => {
			const graph = makeGraph({ nodeCount: 1 });

			const next = addNode(graph, {
				id: 'custom-node',
				title: 'Custom',
				description: 'Provided by persistence',
				pinned: true,
				position: { x: 10, y: 20 }
			});

			expect(next.nodes.at(-1)).toEqual({
				id: 'custom-node',
				title: 'Custom',
				description: 'Provided by persistence',
				pinned: true
			});
			expect(next.posByNodeId['custom-node']).toEqual({ x: 10, y: 20 });
		});
	});

	describe('removeNode', () => {
		it('removes the node, its position, and incident edges', () => {
			const graph = makeGraph({
				nodeCount: 3,
				edges: [
					[0, 1],
					[1, 2],
					[2, 0]
				]
			});

			const next = removeNode(graph, 'n1');

			expect(next.nodes.map((node) => node.id)).toEqual(['n0', 'n2']);
			expect(next.edges).toHaveLength(1);
			expect(next.edges[0]).toMatchObject({ sourceNodeId: 'n2', targetNodeId: 'n0' });
			expect(next.posByNodeId).toEqual({ n0: { x: 0, y: 0 }, n2: { x: 0, y: 0 } });
		});

		it('is a no-op for missing node ids', () => {
			const graph = makeGraph({ nodeCount: 1 });

			expect(removeNode(graph, 'missing')).toBe(graph);
		});
	});

	describe('addEdge', () => {
		it('adds an edge with the next available generated id', () => {
			const graph = makeGraph({
				nodeCount: 2,
				edges: [['n0', 'n1']]
			});

			const next = addEdge(graph, 'n1', 'n0');

			expect(next.edges.at(-1)).toEqual({
				id: 'e1',
				sourceNodeId: 'n1',
				targetNodeId: 'n0',
				color: '#888'
			});
		});

		it('skips generated id collisions', () => {
			const graph = {
				...makeGraph({ nodeCount: 2 }),
				edges: [
					{ id: 'e0', sourceNodeId: 'n0', targetNodeId: 'n1', color: '#888' },
					{ id: 'e2', sourceNodeId: 'n1', targetNodeId: 'n0', color: '#888' }
				]
			};

			const next = addEdge(graph, 'n0', 'n1');

			expect(next.edges.at(-1)?.id).toBe('e1');
		});

		it('preserves explicit edge ids and color', () => {
			const graph = makeGraph({ nodeCount: 2 });

			const next = addEdge(graph, 'n0', 'n1', { id: 'external-edge', color: '#f00' });

			expect(next.edges.at(-1)).toEqual({
				id: 'external-edge',
				sourceNodeId: 'n0',
				targetNodeId: 'n1',
				color: '#f00'
			});
		});

		it('accepts color as the fourth argument', () => {
			const graph = makeGraph({ nodeCount: 2 });

			const next = addEdge(graph, 'n0', 'n1', '#0f0');

			expect(next.edges.at(-1)?.color).toBe('#0f0');
		});

		it('is a no-op when either endpoint is missing', () => {
			const graph = makeGraph({ nodeCount: 1 });

			expect(addEdge(graph, 'n0', 'missing')).toBe(graph);
			expect(addEdge(graph, 'missing', 'n0')).toBe(graph);
		});
	});

	describe('removeEdge', () => {
		it('removes an existing edge', () => {
			const graph = makeGraph({ nodeCount: 2, edges: [[0, 1]] });

			const next = removeEdge(graph, 'e0');

			expect(next.edges).toEqual([]);
		});

		it('is a no-op for missing edge ids', () => {
			const graph = makeGraph({ nodeCount: 2, edges: [[0, 1]] });

			expect(removeEdge(graph, 'missing')).toBe(graph);
		});
	});

	describe('togglePinned', () => {
		it('flips the pinned flag and is its own inverse', () => {
			const graph = makeGraph({ nodeCount: 1 });

			const pinned = togglePinned(graph, 'n0');
			const unpinned = togglePinned(pinned, 'n0');

			expect(pinned.nodes[0].pinned).toBe(true);
			expect(unpinned.nodes[0].pinned).toBe(false);
			expect(graph.nodes[0].pinned).toBeUndefined();
		});

		it('is a no-op for missing node ids', () => {
			const graph = makeGraph({ nodeCount: 1 });

			expect(togglePinned(graph, 'missing')).toBe(graph);
		});
	});

	describe('updateNodeContent', () => {
		it('updates title and description without mutating the original graph', () => {
			const graph = makeGraph({ nodeCount: 2 });

			const next = updateNodeContent(graph, 'n1', {
				title: 'Edited title',
				description: 'Edited description'
			});

			expect(next).not.toBe(graph);
			expect(next.nodes).not.toBe(graph.nodes);
			expect(next.nodes[1]).toEqual({
				id: 'n1',
				title: 'Edited title',
				description: 'Edited description'
			});
			expect(graph.nodes[1]).toEqual({
				id: 'n1',
				title: 'Node 1',
				description: 'Description for node 1'
			});
		});

		it('is a no-op for missing node ids', () => {
			const graph = makeGraph({ nodeCount: 1 });

			expect(updateNodeContent(graph, 'missing', { title: 'Nope', description: 'Nope' })).toBe(
				graph
			);
		});
	});

	describe('moveNode', () => {
		it('returns new graph and position maps without mutating the original graph', () => {
			const graph = makeGraph({ nodeCount: 1 });

			const next = moveNode(graph, 'n0', { x: 10, y: 20 });

			expect(next).not.toBe(graph);
			expect(next.posByNodeId).not.toBe(graph.posByNodeId);
			expect(next.posByNodeId.n0).toEqual({ x: 10, y: 20 });
			expect(graph.posByNodeId.n0).toEqual({ x: 0, y: 0 });
		});

		it('is a no-op for missing node ids', () => {
			const graph = makeGraph({ nodeCount: 1 });

			expect(moveNode(graph, 'missing', { x: 10, y: 20 })).toBe(graph);
		});
	});

	describe('neighborsOf', () => {
		it('returns adjacent nodes for incoming and outgoing edges', () => {
			const graph = makeGraph({
				nodeCount: 4,
				edges: [
					[0, 1],
					[2, 0],
					[3, 2]
				]
			});

			expect(neighborsOf(graph, 'n0').map((node) => node.id)).toEqual(['n1', 'n2']);
		});
	});

	describe('findExistingEdge', () => {
		it('finds an edge by same-order endpoints', () => {
			const graph = makeGraph({ nodeCount: 2, edges: [[0, 1]] });

			const found = findExistingEdge(graph, 'n0', 'n1');

			expect(found).toMatchObject({ sourceNodeId: 'n0', targetNodeId: 'n1' });
		});

		it('finds an edge by reversed endpoints (undirected matching)', () => {
			const graph = makeGraph({ nodeCount: 2, edges: [[0, 1]] });

			const found = findExistingEdge(graph, 'n1', 'n0');

			expect(found).toMatchObject({ sourceNodeId: 'n0', targetNodeId: 'n1' });
		});

		it('returns undefined when source endpoint is missing from the graph', () => {
			const graph = makeGraph({ nodeCount: 2, edges: [[0, 1]] });

			expect(findExistingEdge(graph, 'missing', 'n1')).toBeUndefined();
		});

		it('returns undefined when target endpoint is missing from the graph', () => {
			const graph = makeGraph({ nodeCount: 2, edges: [[0, 1]] });

			expect(findExistingEdge(graph, 'n0', 'missing')).toBeUndefined();
		});

		it('returns undefined when no edge connects the given nodes', () => {
			const graph = makeGraph({ nodeCount: 3, edges: [[0, 1]] });

			expect(findExistingEdge(graph, 'n0', 'n2')).toBeUndefined();
			expect(findExistingEdge(graph, 'n2', 'n0')).toBeUndefined();
		});
	});

	describe('removeEdge immutability', () => {
		it('returns the same reference when the edge id is missing', () => {
			const graph = makeGraph({ nodeCount: 2, edges: [[0, 1]] });

			expect(removeEdge(graph, 'missing')).toBe(graph);
		});
	});

	describe('normalizeNodeTitle', () => {
		it('returns the trimmed title when non-empty', () => {
			expect(normalizeNodeTitle('  My Node  ')).toBe('My Node');
		});

		it(`returns "${NEW_NODE_TITLE}" for an empty string`, () => {
			expect(normalizeNodeTitle('')).toBe(NEW_NODE_TITLE);
		});

		it(`returns "${NEW_NODE_TITLE}" for a whitespace-only string`, () => {
			expect(normalizeNodeTitle('   ')).toBe(NEW_NODE_TITLE);
		});

		it('does not mutate the original graph when used via updateNodeContent', () => {
			const graph = makeGraph({ nodeCount: 1 });
			const originalTitle = graph.nodes[0].title;

			const next = updateNodeContent(graph, 'n0', { title: '', description: '' });

			expect(next.nodes[0].title).toBe(NEW_NODE_TITLE);
			expect(graph.nodes[0].title).toBe(originalTitle);
		});
	});
});
