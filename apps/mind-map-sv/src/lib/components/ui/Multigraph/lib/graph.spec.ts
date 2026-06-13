import { describe, expect, it } from 'vitest';
import {
	addEdge,
	addNode,
	commitInlineTitleSyntax,
	deleteTagEverywhere,
	findExistingEdge,
	moveNode,
	neighborsOf,
	NEW_NODE_TITLE,
	normalizeNodeTitle,
	removeEdge,
	removeNode,
	setTagColor,
	togglePinned,
	updateEdge,
	updateNodeContent
} from './graph';
import { makeGraph } from './testFixtures';

describe('graph mutations', () => {
	describe('addNode', () => {
		it('adds a node with the next available generated id', () => {
			const graph = makeGraph({
				nodes: [
					{ id: 'n0', title: 'Node 0', description: '', tags: [] },
					{ id: 'n2', title: 'Node 2', description: '', tags: [] }
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
				tags: ['topic'],
				pinned: true,
				position: { x: 10, y: 20 }
			});

			expect(next.nodes.at(-1)).toEqual({
				id: 'custom-node',
				title: 'Custom',
				description: 'Provided by persistence',
				tags: ['topic'],
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
				tags: [],
				directed: false
			});
		});

		it('skips generated id collisions', () => {
			const graph = {
				...makeGraph({ nodeCount: 2 }),
				edges: [
					{ id: 'e0', sourceNodeId: 'n0', targetNodeId: 'n1', tags: [] },
					{ id: 'e2', sourceNodeId: 'n1', targetNodeId: 'n0', tags: [] }
				]
			};

			const next = addEdge(graph, 'n0', 'n1');

			expect(next.edges.at(-1)?.id).toBe('e1');
		});

		it('preserves explicit edge ids, tags, and direction', () => {
			const graph = makeGraph({ nodeCount: 2 });

			const next = addEdge(graph, 'n0', 'n1', {
				id: 'external-edge',
				tags: ['rel'],
				directed: true
			});

			expect(next.edges.at(-1)).toEqual({
				id: 'external-edge',
				sourceNodeId: 'n0',
				targetNodeId: 'n1',
				tags: ['rel'],
				directed: true
			});
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
				description: 'Edited description',
				tags: []
			});
			expect(graph.nodes[1]).toEqual({
				id: 'n1',
				title: 'Node 1',
				description: 'Description for node 1',
				tags: []
			});
		});

		it('updates node tags without changing the node title', () => {
			const graph = makeGraph({ nodeCount: 1 });

			const next = updateNodeContent(graph, 'n0', {
				title: graph.nodes[0].title,
				description: graph.nodes[0].description,
				tags: ['abc']
			});

			expect(next.nodes[0]).toMatchObject({ title: 'Node 0', tags: ['abc'] });
		});

		it('is a no-op for missing node ids', () => {
			const graph = makeGraph({ nodeCount: 1 });

			expect(updateNodeContent(graph, 'missing', { title: 'Nope', description: 'Nope' })).toBe(
				graph
			);
		});
	});

	describe('updateEdge', () => {
		it('updates edge fields without mutating the original graph', () => {
			const graph = makeGraph({ nodeCount: 2, edges: [[0, 1]] });

			const next = updateEdge(graph, 'e0', {
				tags: ['rel'],
				directed: true,
				sourceNodeId: 'n1',
				targetNodeId: 'n0'
			});

			expect(next).not.toBe(graph);
			expect(next.edges).not.toBe(graph.edges);
			expect(next.edges[0]).toMatchObject({
				sourceNodeId: 'n1',
				targetNodeId: 'n0',
				tags: ['rel'],
				directed: true
			});
			expect(graph.edges[0]).toMatchObject({
				sourceNodeId: 'n0',
				targetNodeId: 'n1',
				tags: [],
				directed: false
			});
		});

		it('preserves unrelated edges', () => {
			const graph = makeGraph({
				nodeCount: 3,
				edges: [
					[0, 1],
					[1, 2]
				]
			});

			const next = updateEdge(graph, 'e0', { tags: ['rel'] });

			expect(next.edges[1]).toBe(graph.edges[1]);
		});

		it('is a no-op for unknown edge ids', () => {
			const graph = makeGraph({ nodeCount: 2, edges: [[0, 1]] });

			expect(updateEdge(graph, 'missing', { tags: ['rel'] })).toBe(graph);
		});
	});

	describe('tag color config', () => {
		it('sets node tag colors without mutating the original graph', () => {
			const graph = makeGraph({
				nodeCount: 1,
				tagColorConfig: { nodeTags: { old: '#111111' }, edgeTags: {} }
			});

			const next = setTagColor(graph, 'nodeTags', 'topic', '#abcdef');

			expect(next).not.toBe(graph);
			expect(next.tagColorConfig.nodeTags).toEqual({ old: '#111111', topic: '#abcdef' });
			expect(graph.tagColorConfig.nodeTags).toEqual({ old: '#111111' });
		});

		it('sets edge tag colors without mutating the original graph', () => {
			const graph = makeGraph({ nodeCount: 2, edges: [{ source: 0, target: 1, tags: ['rel'] }] });

			const next = setTagColor(graph, 'edgeTags', 'rel', '#123456');

			expect(next.tagColorConfig.edgeTags).toEqual({ rel: '#123456' });
			expect(graph.tagColorConfig.edgeTags).toEqual({});
		});

		it('deletes a node tag from config and every node', () => {
			const graph = makeGraph({
				nodes: [
					{ id: 'n0', title: 'Node 0', description: '', tags: ['topic', 'keep'] },
					{ id: 'n1', title: 'Node 1', description: '', tags: ['topic'] }
				],
				tagColorConfig: { nodeTags: { topic: '#abcdef' }, edgeTags: {} }
			});

			const next = deleteTagEverywhere(graph, 'nodeTags', 'topic');

			expect(next.nodes.map((node) => node.tags)).toEqual([['keep'], []]);
			expect(next.tagColorConfig.nodeTags).toEqual({});
			expect(graph.nodes[0].tags).toEqual(['topic', 'keep']);
		});

		it('deletes an edge tag from config and every edge', () => {
			const graph = makeGraph({
				nodeCount: 3,
				edges: [
					{ source: 0, target: 1, tags: ['rel', 'keep'] },
					{ source: 1, target: 2, tags: ['rel'] }
				],
				tagColorConfig: { nodeTags: {}, edgeTags: { rel: '#abcdef' } }
			});

			const next = deleteTagEverywhere(graph, 'edgeTags', 'rel');

			expect(next.edges.map((edge) => edge.tags)).toEqual([['keep'], []]);
			expect(next.tagColorConfig.edgeTags).toEqual({});
			expect(graph.edges[0].tags).toEqual(['rel', 'keep']);
		});
	});

	describe('commitInlineTitleSyntax', () => {
		it('commits parent-to-child direction, tags, and display title to a connected node', () => {
			const graph = makeGraph({ nodeCount: 2, edges: [[0, 1]] });

			const next = commitInlineTitleSyntax(graph, 'n1', '>:abc ;rel Displayed title', 'e0');

			expect(next.nodes[1]).toMatchObject({ title: 'Displayed title', tags: ['abc'] });
			expect(next.edges[0]).toMatchObject({
				sourceNodeId: 'n0',
				targetNodeId: 'n1',
				tags: ['rel'],
				directed: true
			});
		});

		it('commits child-to-parent direction to a connected node', () => {
			const graph = makeGraph({ nodeCount: 2, edges: [[0, 1]] });

			const next = commitInlineTitleSyntax(graph, 'n1', '< Child points back', 'e0');

			expect(next.edges[0]).toMatchObject({
				sourceNodeId: 'n1',
				targetNodeId: 'n0',
				directed: true
			});
		});

		it('commits compact edge and node tags without leaking syntax into the title', () => {
			const graph = makeGraph({ nodeCount: 2, edges: [[0, 1]] });

			const next = commitInlineTitleSyntax(graph, 'n1', '<;e:n Test', 'e0');

			expect(next.nodes[1]).toMatchObject({ title: 'Test', tags: ['n'] });
			expect(next.edges[0]).toMatchObject({
				sourceNodeId: 'n1',
				targetNodeId: 'n0',
				tags: ['e'],
				directed: true
			});
		});

		it('keeps a connected edge undirected when no marker is present', () => {
			const graph = makeGraph({ nodeCount: 2, edges: [[0, 1]] });

			const next = commitInlineTitleSyntax(graph, 'n1', ':node ;rel Plain title', 'e0');

			expect(next.nodes[1]).toMatchObject({ title: 'Plain title', tags: ['node'] });
			expect(next.edges[0]).toMatchObject({ tags: ['rel'], directed: false });
		});

		it('ignores direction and edge tags for standalone node creation', () => {
			const graph = makeGraph({ nodeCount: 1 });

			const next = commitInlineTitleSyntax(graph, 'n0', '>:node ;rel Standalone title');

			expect(next.nodes[0]).toMatchObject({ title: 'Standalone title', tags: ['node'] });
			expect(next.edges).toEqual([]);
		});

		it('is a no-op when the node id is missing', () => {
			const graph = makeGraph({ nodeCount: 2, edges: [[0, 1]] });

			expect(commitInlineTitleSyntax(graph, 'missing', '>:node ;rel Missing', 'e0')).toBe(graph);
		});

		it('does not mutate a created edge that is not incident to the node', () => {
			const graph = makeGraph({
				nodeCount: 3,
				edges: [
					[0, 1],
					[1, 2]
				]
			});

			const next = commitInlineTitleSyntax(graph, 'n2', '>:node ;rel Node title', 'e0');

			expect(next.nodes[2]).toMatchObject({ title: 'Node title', tags: ['node'] });
			expect(next.edges[0]).toEqual(graph.edges[0]);
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
