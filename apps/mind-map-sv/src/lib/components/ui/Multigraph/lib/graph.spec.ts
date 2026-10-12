import { describe, expect, it } from 'vitest';
import {
	addEdge,
	addNode,
	addNodeContentBlock,
	commitInlineTitleSyntax,
	commitSheetTitleSyntax,
	deleteTagEverywhere,
	duplicateEdgeIdentifier,
	findExistingEdge,
	moveNode,
	moveNodeContentBlock,
	neighborsOf,
	NEW_NODE_TITLE,
	normalizeNodeTitle,
	referencedAssetIds,
	removeEdge,
	removeNode,
	removeNodeAddon,
	removeNodeContentBlock,
	replaceNodeContentBlockAsset,
	setNodeAddon,
	setNodeDesignations,
	setNodePinned,
	setTagColor,
	setTagPhysicsFactor,
	setTaskDone,
	togglePinned,
	updateEdge,
	updateNodeContent,
	updateNodeFileContent,
	updateNodeImageContent
} from './graph';
import { makeGraph } from './testFixtures';
import type { GraphAssetMetadata } from '../../types/multigraph';
import type { NodeFileContent, NodeImageContent, TaskAddon } from '../../types/node';

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
				pinned: true,
				lastPinnedSeq: 1
			});
			expect(next.posByNodeId['custom-node']).toEqual({ x: 10, y: 20 });
		});

		it('stamps pin history on pinned nodes but not unpinned ones', () => {
			const graph = makeGraph({ nodeCount: 0 });

			const withPinned = addNode(graph, { pinned: true });
			const withUnpinned = addNode(withPinned);

			expect(withPinned.nodes[0].lastPinnedSeq).toBe(1);
			expect(withPinned.pinSequence).toBe(1);
			expect(withUnpinned.nodes[1].lastPinnedSeq).toBeUndefined();
			expect(withUnpinned.pinSequence).toBe(1);
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

		/*
		 * A promoted output whose node is deleted is not promoted any more. Left
		 * behind, the binding had the workbench hiding Promote and offering a jump
		 * to nothing; undo restores the graph, so the binding comes back with it.
		 */
		it('drops the `!ai` promoted bindings that named the removed node', () => {
			const graph = makeGraph({
				nodes: [
					{
						id: 'n0',
						title: 'Analysis',
						description: '',
						tags: [],
						addons: {
							ai: {
								prompt: '',
								runs: [],
								promoted: { 'plot.png': 'n1', 'table.csv': 'n2' }
							}
						}
					},
					{ id: 'n1', title: 'Plot', description: '', tags: [] },
					{ id: 'n2', title: 'Table', description: '', tags: [] }
				]
			});

			const next = removeNode(graph, 'n1');

			expect(next.nodes[0].addons?.ai?.promoted).toEqual({ 'table.csv': 'n2' });
		});

		it('leaves a node whose bindings named nobody removed exactly as it was', () => {
			const graph = makeGraph({
				nodes: [
					{
						id: 'n0',
						title: 'Analysis',
						description: '',
						tags: [],
						addons: { ai: { prompt: '', runs: [], promoted: { 'plot.png': 'n1' } } }
					},
					{ id: 'n1', title: 'Plot', description: '', tags: [] },
					{ id: 'n2', title: 'Spare', description: '', tags: [] }
				]
			});

			expect(removeNode(graph, 'n2').nodes[0]).toBe(graph.nodes[0]);
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

		it('stamps pin recency on both pin and unpin', () => {
			const graph = makeGraph({ nodeCount: 2 });

			const pinned = togglePinned(graph, 'n0');
			const unpinned = togglePinned(pinned, 'n0');
			const otherPinned = togglePinned(unpinned, 'n1');

			expect(pinned.nodes[0].lastPinnedSeq).toBe(1);
			expect(unpinned.nodes[0].lastPinnedSeq).toBe(2);
			expect(otherPinned.nodes[1].lastPinnedSeq).toBe(3);
			expect(otherPinned.pinSequence).toBe(3);
		});

		it('is a no-op for missing node ids', () => {
			const graph = makeGraph({ nodeCount: 1 });

			expect(togglePinned(graph, 'missing')).toBe(graph);
		});
	});

	describe('setNodePinned', () => {
		it('sets the pinned flag without toggling', () => {
			const graph = makeGraph({ nodeCount: 1, pinned: [0] });

			const unpinned = setNodePinned(graph, 'n0', false);
			const stillUnpinned = setNodePinned(unpinned, 'n0', false);
			const pinned = setNodePinned(stillUnpinned, 'n0', true);

			expect(unpinned.nodes[0].pinned).toBe(false);
			expect(stillUnpinned.nodes[0].pinned).toBe(false);
			expect(pinned.nodes[0].pinned).toBe(true);
			expect(graph.nodes[0].pinned).toBe(true);
		});

		it('does not stamp pin recency when the pin state is unchanged', () => {
			const graph = makeGraph({ nodeCount: 1, pinned: [0] });

			const unchanged = setNodePinned(graph, 'n0', true);

			expect(unchanged).toBe(graph);
		});

		it('self-heals a stale graph-level pin counter from node stamps', () => {
			const graph = makeGraph({ nodeCount: 2, pinHistory: { 1: 9 } });

			const pinned = setNodePinned({ ...graph, pinSequence: 3 }, 'n0', true);

			expect(pinned.nodes[0].lastPinnedSeq).toBe(10);
			expect(pinned.pinSequence).toBe(10);
		});

		it('is a no-op for missing node ids', () => {
			const graph = makeGraph({ nodeCount: 1 });

			expect(setNodePinned(graph, 'missing', true)).toBe(graph);
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

		it('carries designations when the save includes them and preserves them when it does not', () => {
			const graph = makeGraph({ nodeCount: 1 });

			const withIO = updateNodeContent(graph, 'n0', {
				title: 'Node 0',
				description: '$$v = at$$',
				inputs: [{ base: 'a', subscript: null }],
				outputs: [{ base: 'v', subscript: null }]
			});
			expect(withIO.nodes[0].inputs).toEqual([{ base: 'a', subscript: null }]);
			expect(withIO.nodes[0].outputs).toEqual([{ base: 'v', subscript: null }]);

			// A save that omits the fields (e.g. inline title syntax) keeps them.
			const titleOnly = updateNodeContent(withIO, 'n0', {
				title: 'Renamed',
				description: '$$v = at$$'
			});
			expect(titleOnly.nodes[0].inputs).toEqual([{ base: 'a', subscript: null }]);
			expect(titleOnly.nodes[0].outputs).toEqual([{ base: 'v', subscript: null }]);
		});

		describe('weight', () => {
			const edit = { title: 'Node 0', description: 'Description for node 0' };

			it('sets a weight on a node that had none, without touching the original', () => {
				const graph = makeGraph({ nodeCount: 2 });

				const next = updateNodeContent(graph, 'n0', { ...edit, weight: 5 });

				expect(next.nodes[0].weight).toBe(5);
				expect('weight' in graph.nodes[0]).toBe(false);
				// The other node is carried over, not copied.
				expect(next.nodes[1]).toBe(graph.nodes[1]);
			});

			it('stores 0 as a real weight', () => {
				const graph = makeGraph({ nodeCount: 1, weight: { 0: 4 } });

				expect(updateNodeContent(graph, 'n0', { ...edit, weight: 0 }).nodes[0].weight).toBe(0);
			});

			it('removes the key on null, without touching the original', () => {
				const graph = makeGraph({ nodeCount: 1, weight: { 0: 4 } });

				const next = updateNodeContent(graph, 'n0', { ...edit, weight: null });

				expect('weight' in next.nodes[0]).toBe(false);
				expect(graph.nodes[0].weight).toBe(4);
			});

			it('keeps the stored weight when the save leaves it out', () => {
				const graph = makeGraph({ nodeCount: 1, weight: { 0: 4 } });

				const next = updateNodeContent(graph, 'n0', edit);

				expect(next.nodes[0].weight).toBe(4);
				// An unchanged save still changes nothing a reader can see.
				expect(next.nodes[0]).toEqual(graph.nodes[0]);
			});

			it('returns the same graph for a missing node, weight or not', () => {
				const graph = makeGraph({ nodeCount: 1 });

				expect(updateNodeContent(graph, 'missing', { ...edit, weight: 5 })).toBe(graph);
				expect(updateNodeContent(graph, 'missing', { ...edit, weight: null })).toBe(graph);
			});
		});
	});

	describe('setNodeDesignations', () => {
		it('replaces designations, deduping by identity and preserving order', () => {
			const graph = makeGraph({ nodeCount: 1 });

			const next = setNodeDesignations(graph, 'n0', {
				inputs: [
					{ base: 'v', subscript: '0' },
					{ base: 'a', subscript: null },
					{ base: 'v', subscript: '0' }
				],
				outputs: []
			});

			expect(next.nodes[0].inputs).toEqual([
				{ base: 'v', subscript: '0' },
				{ base: 'a', subscript: null }
			]);
			expect(next.nodes[0].outputs).toEqual([]);
			expect(graph.nodes[0].inputs).toBeUndefined();
		});

		it('does not conflate a subscripted symbol with a lookalike base', () => {
			const graph = makeGraph({ nodeCount: 1 });

			// `v` subscript `0` and a base literally named `v_0` are distinct identities.
			const next = setNodeDesignations(graph, 'n0', {
				inputs: [
					{ base: 'v', subscript: '0' },
					{ base: 'v_0', subscript: null }
				],
				outputs: []
			});

			expect(next.nodes[0].inputs).toHaveLength(2);
		});

		it('is a no-op for missing node ids', () => {
			const graph = makeGraph({ nodeCount: 1 });

			expect(setNodeDesignations(graph, 'missing', { inputs: [], outputs: [] })).toBe(graph);
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

	describe('tag physics config', () => {
		it('stores a factor without mutating the original graph', () => {
			const graph = makeGraph({ nodeCount: 1 });

			const next = setTagPhysicsFactor(graph, 'edgeTags', 'rel', 2);

			expect(next.tagPhysicsConfig).toEqual({ nodeTags: {}, edgeTags: { rel: 2 } });
			expect('tagPhysicsConfig' in graph).toBe(false);
		});

		it('keeps the other namespace and the other tags when setting one', () => {
			const graph = makeGraph({
				nodeCount: 1,
				tagPhysicsConfig: { nodeTags: { topic: 1.5 }, edgeTags: { rel: 2 } }
			});

			const next = setTagPhysicsFactor(graph, 'edgeTags', 'cites', 3);

			expect(next.tagPhysicsConfig).toEqual({
				nodeTags: { topic: 1.5 },
				edgeTags: { rel: 2, cites: 3 }
			});
			expect(graph.tagPhysicsConfig?.edgeTags).toEqual({ rel: 2 });
		});

		it('removes the key when set back to 1, leaving other keys in place', () => {
			const graph = makeGraph({
				nodeCount: 1,
				tagPhysicsConfig: { nodeTags: { topic: 1.5 }, edgeTags: { rel: 2 } }
			});

			const next = setTagPhysicsFactor(graph, 'edgeTags', 'rel', 1);

			expect(next.tagPhysicsConfig).toEqual({ nodeTags: { topic: 1.5 }, edgeTags: {} });
		});

		it('removes the whole field when the last factor goes back to 1', () => {
			const graph = makeGraph({
				nodeCount: 1,
				tagPhysicsConfig: { nodeTags: {}, edgeTags: { rel: 2 } }
			});

			const next = setTagPhysicsFactor(graph, 'edgeTags', 'rel', 1);

			expect('tagPhysicsConfig' in next).toBe(false);
		});

		it('clamps a factor above the range to 8', () => {
			const graph = makeGraph({ nodeCount: 1 });

			expect(setTagPhysicsFactor(graph, 'nodeTags', 'topic', 9).tagPhysicsConfig?.nodeTags).toEqual(
				{ topic: 8 }
			);
		});

		// The floor is ×1, the default, so a factor below it clamps to 1 and
		// removes the key exactly as setting 1 does.
		it('removes the key for a factor below the ×1 floor', () => {
			const tuned = makeGraph({
				nodeCount: 1,
				tagPhysicsConfig: { nodeTags: { topic: 2 }, edgeTags: { rel: 2 } }
			});
			const untuned = makeGraph({ nodeCount: 1 });

			expect(setTagPhysicsFactor(tuned, 'nodeTags', 'topic', 0.5).tagPhysicsConfig).toEqual({
				nodeTags: {},
				edgeTags: { rel: 2 }
			});
			expect(setTagPhysicsFactor(tuned, 'nodeTags', 'topic', -3).tagPhysicsConfig).toEqual({
				nodeTags: {},
				edgeTags: { rel: 2 }
			});
			expect(setTagPhysicsFactor(untuned, 'nodeTags', 'topic', 0.01)).toBe(untuned);
		});

		it('returns the same object for a non-finite factor', () => {
			const graph = makeGraph({
				nodeCount: 1,
				tagPhysicsConfig: { nodeTags: {}, edgeTags: { rel: 2 } }
			});

			expect(setTagPhysicsFactor(graph, 'edgeTags', 'rel', NaN)).toBe(graph);
			expect(setTagPhysicsFactor(graph, 'edgeTags', 'rel', Infinity)).toBe(graph);
			expect(setTagPhysicsFactor(graph, 'edgeTags', 'rel', -Infinity)).toBe(graph);
		});

		it('returns the same object when the value does not change', () => {
			const tuned = makeGraph({
				nodeCount: 1,
				tagPhysicsConfig: { nodeTags: {}, edgeTags: { rel: 8 } }
			});
			const untuned = makeGraph({ nodeCount: 1 });

			expect(setTagPhysicsFactor(tuned, 'edgeTags', 'rel', 8)).toBe(tuned);
			// Clamps to the stored 8, so nothing changes.
			expect(setTagPhysicsFactor(tuned, 'edgeTags', 'rel', 10)).toBe(tuned);
			expect(setTagPhysicsFactor(untuned, 'edgeTags', 'rel', 1)).toBe(untuned);
		});

		it('treats a tag named like an Object.prototype key as unset', () => {
			const graph = makeGraph({ nodeCount: 1 });

			expect(setTagPhysicsFactor(graph, 'nodeTags', 'constructor', 1)).toBe(graph);
		});

		it('deleteTagEverywhere drops the factor and leaves the other namespace alone', () => {
			const graph = makeGraph({
				nodes: [{ id: 'n0', title: 'Node 0', description: '', tags: ['topic'] }],
				tagPhysicsConfig: { nodeTags: { topic: 2, keep: 3 }, edgeTags: { topic: 1.5 } }
			});

			const next = deleteTagEverywhere(graph, 'nodeTags', 'topic');

			expect(next.tagPhysicsConfig).toEqual({
				nodeTags: { keep: 3 },
				edgeTags: { topic: 1.5 }
			});
			expect(graph.tagPhysicsConfig?.nodeTags).toEqual({ topic: 2, keep: 3 });
		});

		it('deleteTagEverywhere removes the field when it held the last factor', () => {
			const graph = makeGraph({
				nodeCount: 2,
				edges: [{ source: 0, target: 1, tags: ['rel'] }],
				tagPhysicsConfig: { nodeTags: {}, edgeTags: { rel: 2 } }
			});

			const next = deleteTagEverywhere(graph, 'edgeTags', 'rel');

			expect('tagPhysicsConfig' in next).toBe(false);
			expect(next.edges[0].tags).toEqual([]);
		});

		it('deleteTagEverywhere leaves the config untouched when the tag had no factor', () => {
			const graph = makeGraph({
				nodes: [{ id: 'n0', title: 'Node 0', description: '', tags: ['topic'] }],
				tagPhysicsConfig: { nodeTags: { keep: 3 }, edgeTags: {} }
			});

			const next = deleteTagEverywhere(graph, 'nodeTags', 'topic');

			expect(next.tagPhysicsConfig).toBe(graph.tagPhysicsConfig);
		});

		it('deleteTagEverywhere adds no field to an untuned graph', () => {
			const graph = makeGraph({
				nodes: [{ id: 'n0', title: 'Node 0', description: '', tags: ['topic'] }]
			});

			expect('tagPhysicsConfig' in deleteTagEverywhere(graph, 'nodeTags', 'topic')).toBe(false);
		});
	});

	describe('commitInlineTitleSyntax', () => {
		it('commits parent-to-child direction, tags, and display title to a connected node', () => {
			const graph = makeGraph({ nodeCount: 2, edges: [[0, 1]] });

			const next = commitInlineTitleSyntax(graph, 'n1', '>#abc @rel Displayed title', 'e0');

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

			const next = commitInlineTitleSyntax(graph, 'n1', '<@e#n Test', 'e0');

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

			const next = commitInlineTitleSyntax(graph, 'n1', '#node @rel Plain title', 'e0');

			expect(next.nodes[1]).toMatchObject({ title: 'Plain title', tags: ['node'] });
			expect(next.edges[0]).toMatchObject({ tags: ['rel'], directed: false });
		});

		it('ignores direction and edge tags for standalone node creation', () => {
			const graph = makeGraph({ nodeCount: 1 });

			const next = commitInlineTitleSyntax(graph, 'n0', '>#node @rel Standalone title');

			expect(next.nodes[0]).toMatchObject({ title: 'Standalone title', tags: ['node'] });
			expect(next.edges).toEqual([]);
		});

		it('is a no-op when the node id is missing', () => {
			const graph = makeGraph({ nodeCount: 2, edges: [[0, 1]] });

			expect(commitInlineTitleSyntax(graph, 'missing', '>#node @rel Missing', 'e0')).toBe(graph);
		});

		it('creates a parsed add-on at its registry default', () => {
			const graph = makeGraph({ nodeCount: 1 });

			const next = commitInlineTitleSyntax(graph, 'n0', '!task #lab Buy filters');

			expect(next.nodes[0]).toMatchObject({
				title: 'Buy filters',
				tags: ['lab'],
				addons: { task: { done: false } }
			});
			expect(graph.nodes[0].addons).toBeUndefined();
		});

		it('leaves the data of an existing add-on alone when the marker is typed again', () => {
			const graph = makeGraph({
				nodes: [
					{
						id: 'n0',
						title: 'Buy filters',
						description: '',
						addons: { task: { done: true, doneAt: 1_700_000_000_000 } }
					}
				]
			});

			const next = commitInlineTitleSyntax(graph, 'n0', '!task Buy filters again');

			expect(next.nodes[0].addons?.task).toBe(graph.nodes[0].addons?.task);
		});

		it('keeps an add-on the title no longer mentions, since the toggle is the way off', () => {
			const graph = makeGraph({
				nodes: [
					{ id: 'n0', title: 'Buy filters', description: '', addons: { task: { done: false } } }
				]
			});

			const next = commitInlineTitleSyntax(graph, 'n0', 'Buy filters');

			expect(next.nodes[0].addons).toEqual({ task: { done: false } });
		});

		it('leaves an unregistered marker word in the title with everything after it', () => {
			const graph = makeGraph({ nodeCount: 1 });

			const next = commitInlineTitleSyntax(graph, 'n0', '!important #lab Read this');

			expect(next.nodes[0]).toMatchObject({ title: '!important #lab Read this', tags: [] });
			expect(next.nodes[0].addons).toBeUndefined();
		});

		it('does not mutate a created edge that is not incident to the node', () => {
			const graph = makeGraph({
				nodeCount: 3,
				edges: [
					[0, 1],
					[1, 2]
				]
			});

			const next = commitInlineTitleSyntax(graph, 'n2', '>#node @rel Node title', 'e0');

			expect(next.nodes[2]).toMatchObject({ title: 'Node title', tags: ['node'] });
			expect(next.edges[0]).toEqual(graph.edges[0]);
		});
	});

	describe('commitSheetTitleSyntax', () => {
		const taskNode = (addons?: { task: { done: boolean; doneAt?: number } }) =>
			makeGraph({
				nodes: [
					{
						id: 'n0',
						title: 'Old title',
						description: 'kept',
						tags: ['x'],
						...(addons ? { addons } : {})
					}
				]
			});

		it('takes the node markers out of the title and adds what they name', () => {
			const next = commitSheetTitleSyntax(taskNode(), 'n0', '#lab !task Buy filters', ['x']);

			expect(next.nodes[0]).toMatchObject({
				title: 'Buy filters',
				// Listed tags first, then what the title introduced.
				tags: ['x', 'lab'],
				addons: { task: { done: false } },
				description: 'kept'
			});
		});

		it('leaves an edge tag in the title, since the sheet has no created edge', () => {
			const next = commitSheetTitleSyntax(taskNode(), 'n0', '@bench Buy filters', ['x']);

			expect(next.nodes[0]).toMatchObject({ title: '@bench Buy filters', tags: ['x'] });
			expect(next.nodes[0].addons).toBeUndefined();
		});

		it('leaves a direction prefix in the title for the same reason', () => {
			expect(commitSheetTitleSyntax(taskNode(), 'n0', '> Title', ['x']).nodes[0].title).toBe(
				'> Title'
			);
			expect(commitSheetTitleSyntax(taskNode(), 'n0', '< Title', ['x']).nodes[0].title).toBe(
				'< Title'
			);
		});

		it('ends the marker run at an edge tag rather than reading past it', () => {
			const next = commitSheetTitleSyntax(taskNode(), 'n0', '#lab @bench !task Go', ['x']);

			expect(next.nodes[0]).toMatchObject({ title: '@bench !task Go', tags: ['x', 'lab'] });
			expect(next.nodes[0].addons).toBeUndefined();
		});

		it('leaves the data of an add-on the node already carries alone', () => {
			const graph = taskNode({ task: { done: true, doneAt: 1_700_000_000_000 } });

			const next = commitSheetTitleSyntax(graph, 'n0', '!task Buy filters', ['x']);

			expect(next.nodes[0].addons).toEqual({ task: { done: true, doneAt: 1_700_000_000_000 } });
			expect(next.nodes[0].title).toBe('Buy filters');
		});

		it('changes neither tags nor add-ons for a title with no markers', () => {
			const graph = taskNode();

			const next = commitSheetTitleSyntax(graph, 'n0', 'Buy filters', ['x']);

			expect(next.nodes[0]).toMatchObject({ title: 'Buy filters', tags: ['x'] });
			expect(next.nodes[0].addons).toBeUndefined();
		});

		it('does not repeat a tag the sheet already lists', () => {
			expect(
				commitSheetTitleSyntax(taskNode(), 'n0', '#x Buy filters', ['x']).nodes[0].tags
			).toEqual(['x']);
		});

		it('falls back to the default title when the markers were the whole field', () => {
			expect(commitSheetTitleSyntax(taskNode(), 'n0', '#lab !task', ['x']).nodes[0]).toMatchObject({
				title: NEW_NODE_TITLE,
				tags: ['x', 'lab'],
				addons: { task: { done: false } }
			});
		});

		it('does not mutate the graph it was handed', () => {
			const graph = taskNode();

			const next = commitSheetTitleSyntax(graph, 'n0', '#lab !task Buy filters', ['x']);

			expect(next).not.toBe(graph);
			expect(graph.nodes[0]).toMatchObject({ title: 'Old title', tags: ['x'] });
			expect(graph.nodes[0].addons).toBeUndefined();
		});

		it('is a no-op for missing node ids', () => {
			const graph = taskNode();

			expect(commitSheetTitleSyntax(graph, 'missing', '#lab Buy filters', ['x'])).toBe(graph);
		});
	});

	describe('setNodeAddon', () => {
		it('creates the add-on at its default without mutating the original graph', () => {
			const graph = makeGraph({ nodeCount: 2 });

			const next = setNodeAddon(graph, 'n1', 'task');

			expect(next).not.toBe(graph);
			expect(next.nodes).not.toBe(graph.nodes);
			expect(next.nodes[1].addons).toEqual({ task: { done: false } });
			expect(next.nodes[0].addons).toBeUndefined();
			expect(graph.nodes[1].addons).toBeUndefined();
		});

		it('returns the same graph object when the node already carries the add-on', () => {
			const graph = makeGraph({
				nodes: [{ id: 'n0', title: 'Task', description: '', addons: { task: { done: true } } }]
			});

			expect(setNodeAddon(graph, 'n0', 'task')).toBe(graph);
		});

		it('is a no-op for missing node ids', () => {
			const graph = makeGraph({ nodeCount: 1 });

			expect(setNodeAddon(graph, 'missing', 'task')).toBe(graph);
		});
	});

	describe('removeNodeAddon', () => {
		it('drops the addons key entirely when the last add-on goes', () => {
			const graph = makeGraph({
				nodes: [{ id: 'n0', title: 'Task', description: '', addons: { task: { done: true } } }]
			});

			const next = removeNodeAddon(graph, 'n0', 'task');

			expect(next).not.toBe(graph);
			expect(next.nodes[0]).not.toHaveProperty('addons');
			expect(graph.nodes[0].addons).toEqual({ task: { done: true } });
		});

		it('returns the same graph object when the node does not carry the add-on', () => {
			const graph = makeGraph({ nodeCount: 1 });

			expect(removeNodeAddon(graph, 'n0', 'task')).toBe(graph);
		});

		it('is a no-op for missing node ids', () => {
			const graph = makeGraph({
				nodes: [{ id: 'n0', title: 'Task', description: '', addons: { task: { done: false } } }]
			});

			expect(removeNodeAddon(graph, 'missing', 'task')).toBe(graph);
		});
	});

	describe('setTaskDone', () => {
		const taskGraph = (task: TaskAddon) =>
			makeGraph({
				nodes: [{ id: 'n0', title: 'Change filters', description: '', addons: { task } }]
			});

		it('marks a task done with the injected stamp, without mutating the original', () => {
			const graph = taskGraph({ done: false });

			const next = setTaskDone(graph, 'n0', true, 1234);

			expect(next).not.toBe(graph);
			expect(next.nodes[0].addons?.task).toEqual({ done: true, doneAt: 1234 });
			expect(graph.nodes[0].addons?.task).toEqual({ done: false });
		});

		it('stamps from the clock when no time is injected', () => {
			const before = Date.now();

			const next = setTaskDone(taskGraph({ done: false }), 'n0', true);

			const doneAt = next.nodes[0].addons?.task?.doneAt;
			expect(doneAt).toBeGreaterThanOrEqual(before);
			expect(doneAt).toBeLessThanOrEqual(Date.now());
		});

		it('clears the stamp when a done task is marked not done', () => {
			const next = setTaskDone(taskGraph({ done: true, doneAt: 999 }), 'n0', false);

			expect(next.nodes[0].addons?.task).toEqual({ done: false });
			expect(next.nodes[0].addons?.task).not.toHaveProperty('doneAt');
		});

		it('leaves the node’s other add-on data alone', () => {
			const graph = taskGraph({ done: false });

			const next = setTaskDone(graph, 'n0', true, 7);

			expect(Object.keys(next.nodes[0].addons ?? {})).toEqual(['task']);
			expect(next.nodes[0].title).toBe('Change filters');
		});

		it('returns the same graph object when the task is already in that state', () => {
			const graph = taskGraph({ done: true, doneAt: 12 });

			expect(setTaskDone(graph, 'n0', true, 99)).toBe(graph);
		});

		it('is a no-op on a node without the task add-on', () => {
			const graph = makeGraph({ nodeCount: 1 });

			expect(setTaskDone(graph, 'n0', true, 1)).toBe(graph);
		});

		it('is a no-op for missing node ids', () => {
			const graph = taskGraph({ done: false });

			expect(setTaskDone(graph, 'missing', true, 1)).toBe(graph);
		});
	});

	describe('content blocks and their assets', () => {
		const imageAsset = (id: string): GraphAssetMetadata => ({
			id,
			kind: 'image',
			mimeType: 'image/png',
			name: `${id}.png`,
			size: 12,
			createdAt: 1
		});

		const fileAsset = (id: string): GraphAssetMetadata => ({
			id,
			kind: 'file',
			mimeType: 'text/csv',
			name: `${id}.csv`,
			size: 24,
			createdAt: 2
		});

		const imageBlock = (assetId: string): NodeImageContent => ({
			type: 'image',
			assetId,
			alt: 'A photo'
		});

		const fileBlock = (assetId: string): NodeFileContent => ({
			type: 'file',
			assetId,
			name: `${assetId}.csv`
		});

		describe('addNodeContentBlock', () => {
			it('appends an image block and its asset without mutating the original graph', () => {
				const graph = makeGraph({ nodeCount: 2 });

				const next = addNodeContentBlock(graph, 'n1', imageBlock('a1'), imageAsset('a1'));

				expect(next).not.toBe(graph);
				expect(next.nodes).not.toBe(graph.nodes);
				expect(next.nodes[1].content).toEqual([imageBlock('a1')]);
				expect(next.assets).toEqual({ a1: imageAsset('a1') });
				expect(graph.nodes[1].content).toBeUndefined();
				expect(graph.assets).toBeUndefined();
			});

			it('appends a file block beside an image already on the node', () => {
				const withImage = addNodeContentBlock(
					makeGraph({ nodeCount: 1 }),
					'n0',
					imageBlock('a1'),
					imageAsset('a1')
				);

				const next = addNodeContentBlock(withImage, 'n0', fileBlock('f1'), fileAsset('f1'));

				expect(next.nodes[0].content).toEqual([imageBlock('a1'), fileBlock('f1')]);
				expect(next.assets).toEqual({ a1: imageAsset('a1'), f1: fileAsset('f1') });
				expect(withImage.nodes[0].content).toEqual([imageBlock('a1')]);
			});

			it('is a no-op for missing node ids', () => {
				const graph = makeGraph({ nodeCount: 1 });

				expect(addNodeContentBlock(graph, 'missing', fileBlock('f1'), fileAsset('f1'))).toBe(graph);
			});
		});

		describe('removeNodeContentBlock', () => {
			it('drops a file block and reports its asset as unreferenced', () => {
				const graph = addNodeContentBlock(
					makeGraph({ nodeCount: 1 }),
					'n0',
					fileBlock('f1'),
					fileAsset('f1')
				);

				const { graph: next, removedAssetIds } = removeNodeContentBlock(graph, 'n0', 'f1');

				expect(next).not.toBe(graph);
				expect(next.nodes[0].content).toEqual([]);
				expect(next.assets).toEqual({});
				expect(removedAssetIds).toEqual(['f1']);
				expect(graph.nodes[0].content).toEqual([fileBlock('f1')]);
			});

			it('drops an image block the same way', () => {
				const graph = addNodeContentBlock(
					makeGraph({ nodeCount: 1 }),
					'n0',
					imageBlock('a1'),
					imageAsset('a1')
				);

				expect(removeNodeContentBlock(graph, 'n0', 'a1')).toMatchObject({
					removedAssetIds: ['a1']
				});
			});

			// The caller tombstones what comes back, so naming an asset another node
			// still shows would delete a live blob out from under it.
			it('reports nothing removed while another node still references the asset', () => {
				const twoNodes = addNodeContentBlock(
					addNodeContentBlock(makeGraph({ nodeCount: 2 }), 'n0', fileBlock('f1'), fileAsset('f1')),
					'n1',
					fileBlock('f1'),
					fileAsset('f1')
				);

				const { graph: next, removedAssetIds } = removeNodeContentBlock(twoNodes, 'n0', 'f1');

				expect(removedAssetIds).toEqual([]);
				expect(next.assets).toEqual({ f1: fileAsset('f1') });
				expect(next.nodes[1].content).toEqual([fileBlock('f1')]);
			});

			it('leaves the other blocks on the node alone', () => {
				const graph = addNodeContentBlock(
					addNodeContentBlock(
						makeGraph({ nodeCount: 1 }),
						'n0',
						imageBlock('a1'),
						imageAsset('a1')
					),
					'n0',
					fileBlock('f1'),
					fileAsset('f1')
				);

				const { graph: next } = removeNodeContentBlock(graph, 'n0', 'f1');

				expect(next.nodes[0].content).toEqual([imageBlock('a1')]);
			});

			it('is a no-op for missing node ids', () => {
				const graph = makeGraph({ nodeCount: 1 });

				expect(removeNodeContentBlock(graph, 'missing', 'f1')).toEqual({
					graph,
					removedAssetIds: []
				});
			});
		});

		describe('replaceNodeContentBlockAsset', () => {
			const replacement = (id: string): GraphAssetMetadata => ({
				...fileAsset(id),
				name: 'picked-from-disk.csv',
				size: 4096
			});

			// The name is what the stored script opens, so a replacement that kept
			// the bytes and lost the name would break the one thing it is for.
			it('points the block at the new asset and keeps the name the script opens', () => {
				const graph = addNodeContentBlock(
					makeGraph({ nodeCount: 1 }),
					'n0',
					fileBlock('f1'),
					fileAsset('f1')
				);

				const { graph: next, removedAssetIds } = replaceNodeContentBlockAsset(
					graph,
					'n0',
					'f1',
					'f2',
					replacement('f2')
				);

				expect(next.nodes[0].content).toEqual([{ type: 'file', assetId: 'f2', name: 'f1.csv' }]);
				expect(next.assets).toEqual({ f2: replacement('f2') });
				expect(removedAssetIds).toEqual(['f1']);
				// Immutable, as every mutation here is: the old graph is what undo holds.
				expect(graph.nodes[0].content).toEqual([fileBlock('f1')]);
				expect(graph.assets).toEqual({ f1: fileAsset('f1') });
			});

			it('keeps an image block’s alt text and caption', () => {
				const graph = addNodeContentBlock(
					makeGraph({ nodeCount: 1 }),
					'n0',
					{ ...imageBlock('a1'), caption: 'Run 3' },
					imageAsset('a1')
				);

				const { graph: next } = replaceNodeContentBlockAsset(
					graph,
					'n0',
					'a1',
					'a2',
					replacement('a2')
				);

				expect(next.nodes[0].content).toEqual([
					{ type: 'image', assetId: 'a2', alt: 'A photo', caption: 'Run 3' }
				]);
			});

			// The caller tombstones what comes back, so naming an asset another node
			// still shows would take a live blob out from under it.
			it('reports nothing removed while another node still references the old asset', () => {
				const twoNodes = addNodeContentBlock(
					addNodeContentBlock(makeGraph({ nodeCount: 2 }), 'n0', fileBlock('f1'), fileAsset('f1')),
					'n1',
					fileBlock('f1'),
					fileAsset('f1')
				);

				const { graph: next, removedAssetIds } = replaceNodeContentBlockAsset(
					twoNodes,
					'n0',
					'f1',
					'f2',
					replacement('f2')
				);

				expect(removedAssetIds).toEqual([]);
				expect(next.assets).toEqual({ f1: fileAsset('f1'), f2: replacement('f2') });
				expect(next.nodes[1].content).toEqual([fileBlock('f1')]);
			});

			it('leaves the other blocks on the node alone', () => {
				const graph = addNodeContentBlock(
					addNodeContentBlock(
						makeGraph({ nodeCount: 1 }),
						'n0',
						imageBlock('a1'),
						imageAsset('a1')
					),
					'n0',
					fileBlock('f1'),
					fileAsset('f1')
				);

				const { graph: next } = replaceNodeContentBlockAsset(
					graph,
					'n0',
					'f1',
					'f2',
					replacement('f2')
				);

				expect(next.nodes[0].content).toEqual([
					imageBlock('a1'),
					{ type: 'file', assetId: 'f2', name: 'f1.csv' }
				]);
			});

			// Same object, so a replace that found nothing lands in no history entry
			// — and the caller can tell, which is how it knows to bin the blob it
			// just stored.
			it('is a no-op for a node or an asset id that names no block', () => {
				const graph = addNodeContentBlock(
					makeGraph({ nodeCount: 1 }),
					'n0',
					fileBlock('f1'),
					fileAsset('f1')
				);

				expect(
					replaceNodeContentBlockAsset(graph, 'missing', 'f1', 'f2', replacement('f2'))
				).toEqual({ graph, removedAssetIds: [] });
				expect(
					replaceNodeContentBlockAsset(graph, 'n0', 'nope', 'f2', replacement('f2')).graph
				).toBe(graph);
			});
		});

		describe('referencedAssetIds', () => {
			it('is empty for a graph with no content', () => {
				expect(referencedAssetIds(makeGraph({ nodeCount: 2 })).size).toBe(0);
			});

			it('counts an image-only node', () => {
				const graph = addNodeContentBlock(
					makeGraph({ nodeCount: 1 }),
					'n0',
					imageBlock('a1'),
					imageAsset('a1')
				);

				expect([...referencedAssetIds(graph)]).toEqual(['a1']);
			});

			it('counts a file-only node', () => {
				const graph = addNodeContentBlock(
					makeGraph({ nodeCount: 1 }),
					'n0',
					fileBlock('f1'),
					fileAsset('f1')
				);

				expect([...referencedAssetIds(graph)]).toEqual(['f1']);
			});

			it('counts both kinds across a mixed graph, deduped', () => {
				const graph = addNodeContentBlock(
					addNodeContentBlock(
						addNodeContentBlock(
							makeGraph({ nodeCount: 2 }),
							'n0',
							imageBlock('a1'),
							imageAsset('a1')
						),
						'n0',
						fileBlock('f1'),
						fileAsset('f1')
					),
					'n1',
					fileBlock('f1'),
					fileAsset('f1')
				);

				expect([...referencedAssetIds(graph)].sort()).toEqual(['a1', 'f1']);
			});

			// Nothing renders a run output as a content block, but the workbench
			// shows it straight off the run record — so the sweep and the exporter
			// have to count it or a downloaded document loses its history.
			it('counts the outputs of an ai node run', () => {
				const graph = makeGraph({
					nodes: [
						{
							id: 'n0',
							title: 'Analysis',
							description: '',
							addons: {
								ai: {
									prompt: '',
									promoted: {},
									runs: [
										{
											id: 'r1',
											startedAt: 1,
											status: 'done',
											mode: 'analyse',
											runtime: '0.27.7',
											inputs: [],
											summary: '',
											outputs: [
												{ name: 'plot.png', assetId: 'p1', mimeType: 'image/png' },
												{ name: 'clean.csv', assetId: 'p2', mimeType: 'text/csv' }
											],
											toolCalls: 1
										}
									]
								}
							}
						}
					]
				});

				expect([...referencedAssetIds(graph)].sort()).toEqual(['p1', 'p2']);
			});

			it('counts nothing extra for an ai node that has never run', () => {
				const graph = makeGraph({
					nodes: [
						{
							id: 'n0',
							title: 'Analysis',
							description: '',
							addons: { ai: { prompt: 'plot it', runs: [], promoted: {} } }
						}
					]
				});

				expect(referencedAssetIds(graph).size).toBe(0);
			});
		});

		describe('updateNodeImageContent', () => {
			it('rewrites alt and caption without mutating the original graph', () => {
				const graph = addNodeContentBlock(
					makeGraph({ nodeCount: 1 }),
					'n0',
					imageBlock('a1'),
					imageAsset('a1')
				);

				const next = updateNodeImageContent(graph, 'n0', 'a1', {
					alt: 'Changed',
					caption: 'On the bench'
				});

				expect(next).not.toBe(graph);
				expect(next.nodes[0].content).toEqual([
					{ type: 'image', assetId: 'a1', alt: 'Changed', caption: 'On the bench' }
				]);
				expect(graph.nodes[0].content).toEqual([imageBlock('a1')]);
			});

			// Alt text is an image concept; a file row's caption is T03's to edit.
			it('leaves a file block sharing the asset id untouched', () => {
				const graph = addNodeContentBlock(
					makeGraph({ nodeCount: 1 }),
					'n0',
					fileBlock('f1'),
					fileAsset('f1')
				);

				expect(
					updateNodeImageContent(graph, 'n0', 'f1', { alt: 'Changed' }).nodes[0].content
				).toEqual([fileBlock('f1')]);
			});

			it('is a no-op for missing node ids', () => {
				const graph = makeGraph({ nodeCount: 1 });

				expect(updateNodeImageContent(graph, 'missing', 'a1', { alt: 'x' })).toBe(graph);
			});
		});

		describe('updateNodeFileContent', () => {
			it('rewrites a file caption without mutating the original graph', () => {
				const graph = addNodeContentBlock(
					makeGraph({ nodeCount: 1 }),
					'n0',
					fileBlock('f1'),
					fileAsset('f1')
				);

				const next = updateNodeFileContent(graph, 'n0', 'f1', { caption: 'Bench run 3' });

				expect(next).not.toBe(graph);
				expect(next.nodes[0].content).toEqual([
					{ type: 'file', assetId: 'f1', name: 'f1.csv', caption: 'Bench run 3' }
				]);
				expect(graph.nodes[0].content).toEqual([fileBlock('f1')]);
			});

			// The mirror of updateNodeImageContent: each kind edits only its own.
			it('leaves an image block sharing the asset id untouched', () => {
				const graph = addNodeContentBlock(
					makeGraph({ nodeCount: 1 }),
					'n0',
					imageBlock('a1'),
					imageAsset('a1')
				);

				expect(
					updateNodeFileContent(graph, 'n0', 'a1', { caption: 'Changed' }).nodes[0].content
				).toEqual([imageBlock('a1')]);
			});

			it('is a no-op for missing node ids', () => {
				const graph = makeGraph({ nodeCount: 1 });

				expect(updateNodeFileContent(graph, 'missing', 'f1', { caption: 'x' })).toBe(graph);
			});
		});

		describe('moveNodeContentBlock', () => {
			it('reorders blocks of either kind without mutating the original graph', () => {
				const graph = addNodeContentBlock(
					addNodeContentBlock(
						makeGraph({ nodeCount: 1 }),
						'n0',
						imageBlock('a1'),
						imageAsset('a1')
					),
					'n0',
					fileBlock('f1'),
					fileAsset('f1')
				);

				const next = moveNodeContentBlock(graph, 'n0', 1, 0);

				expect(next).not.toBe(graph);
				expect(next.nodes[0].content).toEqual([fileBlock('f1'), imageBlock('a1')]);
				expect(graph.nodes[0].content).toEqual([imageBlock('a1'), fileBlock('f1')]);
			});

			it('is a no-op for an out-of-range index', () => {
				const graph = addNodeContentBlock(
					makeGraph({ nodeCount: 1 }),
					'n0',
					fileBlock('f1'),
					fileAsset('f1')
				);

				expect(moveNodeContentBlock(graph, 'n0', 0, 5)).toBe(graph);
			});
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

	describe('duplicateEdgeIdentifier', () => {
		it('returns source and target titles for an existing edge', () => {
			const graph = makeGraph({
				nodes: [
					{ id: 'source', title: 'Source Title', description: '', tags: [] },
					{ id: 'target', title: 'Target Title', description: '', tags: [] }
				],
				edges: [['source', 'target']]
			});

			expect(duplicateEdgeIdentifier(graph, 'e0')).toBe('Source Title -- Target Title');
		});

		it(`falls back to "${NEW_NODE_TITLE}" for empty endpoint titles`, () => {
			const graph = makeGraph({
				nodes: [
					{ id: 'source', title: '', description: '', tags: [] },
					{ id: 'target', title: '   ', description: '', tags: [] }
				],
				edges: [['source', 'target']]
			});

			expect(duplicateEdgeIdentifier(graph, 'e0')).toBe(`${NEW_NODE_TITLE} -- ${NEW_NODE_TITLE}`);
		});

		// This string is shown to someone choosing which edge to remove, so raw
		// `$E = mc^2$` would be worse than the node id it replaced.
		it('typesets math endpoint titles as readable text', () => {
			const graph = makeGraph({
				nodes: [
					{ id: 'source', title: '$E = mc^2$', description: '', tags: [] },
					{ id: 'target', title: 'Energy', description: '', tags: [] }
				],
				edges: [['source', 'target']]
			});

			expect(duplicateEdgeIdentifier(graph, 'e0')).toBe('E=mc2 -- Energy');
		});

		it('leaves a title without math exactly as written', () => {
			const graph = makeGraph({
				nodes: [
					{ id: 'source', title: 'Costs \\$5', description: '', tags: [] },
					{ id: 'target', title: 'Budget', description: '', tags: [] }
				],
				edges: [['source', 'target']]
			});

			expect(duplicateEdgeIdentifier(graph, 'e0')).toBe('Costs $5 -- Budget');
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
