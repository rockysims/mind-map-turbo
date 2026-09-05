import { describe, expect, it } from 'vitest';
import {
	CURRENT_SCHEMA_VERSION,
	PersistedGraphError,
	parsePersistedGraph,
	unwrapPersistedGraph,
	wrapPersistedGraph
} from './migrations';
import { makeGraph } from './components/ui/Multigraph/lib/testFixtures';

describe('persisted graph migrations', () => {
	it('wraps current graph data in the schema envelope', () => {
		const graph = makeGraph({ nodeCount: 2, edges: [[0, 1]] });

		expect(wrapPersistedGraph(graph)).toEqual({
			schemaVersion: CURRENT_SCHEMA_VERSION,
			data: graph
		});
	});

	it('reads version 1 payloads', () => {
		const graph = {
			nodes: [{ id: 'n0', title: 'Node 0', description: 'Description for node 0' }],
			edges: [],
			posByNodeId: { n0: { x: 0, y: 0 } }
		};

		expect(unwrapPersistedGraph({ schemaVersion: 1, data: graph })).toEqual({
			// Pre-v5 files carry no pins, so load-time seeding pins the component hub.
			nodes: [{ ...graph.nodes[0], tags: [], content: [], pinned: true, lastPinnedSeq: 1 }],
			edges: [],
			posByNodeId: graph.posByNodeId,
			tagColorConfig: { nodeTags: {}, edgeTags: {} },
			assets: {},
			pinSequence: 1
		});
	});

	it('migrates version 1 edges to empty tags and undirected', () => {
		const graph = {
			nodes: [
				{ id: 'n0', title: 'Node 0', description: 'Description for node 0' },
				{ id: 'n1', title: 'Node 1', description: 'Description for node 1' }
			],
			edges: [{ id: 'e0', sourceNodeId: 'n0', targetNodeId: 'n1', color: '#888' }],
			posByNodeId: { n0: { x: 0, y: 0 }, n1: { x: 0, y: 0 } }
		};

		expect(unwrapPersistedGraph({ schemaVersion: 1, data: graph }).edges[0]).toEqual({
			id: 'e0',
			sourceNodeId: 'n0',
			targetNodeId: 'n1',
			tags: [],
			directed: false
		});
	});

	it('migrates version 2 payloads to empty tag config and drops edge colors', () => {
		const graph = {
			nodes: [{ id: 'n0', title: 'Node 0', description: 'Description for node 0', tags: ['abc'] }],
			edges: [
				{
					id: 'e0',
					sourceNodeId: 'n0',
					targetNodeId: 'n0',
					color: '#f00',
					tags: ['rel'],
					directed: false
				}
			],
			posByNodeId: { n0: { x: 0, y: 0 } }
		};

		expect(unwrapPersistedGraph({ schemaVersion: 2, data: graph })).toEqual({
			nodes: graph.nodes.map((node) => ({
				...node,
				content: [],
				pinned: true,
				lastPinnedSeq: 1
			})),
			edges: [
				{
					id: 'e0',
					sourceNodeId: 'n0',
					targetNodeId: 'n0',
					tags: ['rel'],
					directed: false
				}
			],
			posByNodeId: graph.posByNodeId,
			tagColorConfig: { nodeTags: {}, edgeTags: {} },
			assets: {},
			pinSequence: 1
		});
	});

	it('migrates version 4 payloads by seeding pin history for pinned nodes', () => {
		const graph = makeGraph({ nodeCount: 3, pinned: [2, 0] });

		const migrated = unwrapPersistedGraph({ schemaVersion: 4, data: graph });

		expect(migrated.pinSequence).toBe(2);
		expect(migrated.nodes.map((node) => node.lastPinnedSeq)).toEqual([1, undefined, 2]);
	});

	it('returns version 5 payloads untouched', () => {
		const graph = makeGraph({ nodeCount: 2, pinned: [0] });
		const nodes = graph.nodes.map((node, index) =>
			index === 0 ? { ...node, lastPinnedSeq: 7 } : node
		);
		const data = { ...graph, nodes, pinSequence: 7 };

		expect(unwrapPersistedGraph({ schemaVersion: 5, data })).toEqual(data);
	});

	it('round-trips current-version quantity designations', () => {
		const graph = makeGraph({ nodeCount: 2, pinned: [0], edges: [[0, 1]] });
		const nodes = graph.nodes.map((node, index) =>
			index === 0
				? { ...node, outputs: [{ base: 'v', subscript: '0' }] }
				: {
						...node,
						inputs: [
							{ base: 'v', subscript: '0' },
							{ base: 'α', subscript: null }
						]
					}
		);
		const data = { ...graph, nodes, pinSequence: 1 };

		expect(unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data })).toEqual(data);
	});

	it('rejects current-version nodes with malformed designations', () => {
		const graph = makeGraph({ nodeCount: 1, pinned: [0] });

		for (const inputs of [[{ base: 'v', subscript: 3 }], [{ subscript: null }], 'v', [null]]) {
			expect(() =>
				unwrapPersistedGraph({
					schemaVersion: CURRENT_SCHEMA_VERSION,
					data: { ...graph, nodes: [{ ...graph.nodes[0], inputs }] }
				})
			).toThrow(new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload'));
		}
	});

	it('rejects current-version nodes with malformed lastPinnedSeq', () => {
		const graph = makeGraph({ nodeCount: 1 });

		expect(() =>
			unwrapPersistedGraph({
				schemaVersion: CURRENT_SCHEMA_VERSION,
				data: { ...graph, nodes: [{ ...graph.nodes[0], lastPinnedSeq: 'first' }] }
			})
		).toThrow(new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload'));
	});

	it('rejects current-version graphs with malformed pinSequence', () => {
		const graph = makeGraph({ nodeCount: 1 });

		expect(() =>
			unwrapPersistedGraph({
				schemaVersion: CURRENT_SCHEMA_VERSION,
				data: { ...graph, pinSequence: Infinity }
			})
		).toThrow(new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload'));
	});

	it('parses serialized version 1 payloads', () => {
		const graph = makeGraph({ nodeCount: 1, pinned: [0] });

		expect(parsePersistedGraph(JSON.stringify(wrapPersistedGraph(graph)))).toEqual(graph);
	});

	it('pins each pinless component hub when a loaded graph has no pins at all', () => {
		// n1 is the hub of the first component (degree 2); n3/n4 tie at degree 1,
		// so the lowest id wins; n5 is isolated and is its own component.
		const graph = makeGraph({
			nodeCount: 6,
			edges: [
				[0, 1],
				[1, 2],
				[3, 4]
			]
		});

		const loaded = unwrapPersistedGraph({ schemaVersion: 4, data: graph });

		expect(loaded.nodes.filter((node) => node.pinned).map((node) => node.id)).toEqual([
			'n1',
			'n3',
			'n5'
		]);
		expect(loaded.pinSequence).toBe(3);
	});

	it('leaves a loaded graph untouched when any node is already pinned', () => {
		const graph = makeGraph({
			nodeCount: 4,
			pinned: [0],
			edges: [
				[0, 1],
				[2, 3]
			],
			pinHistory: { 0: 1 }
		});

		const loaded = unwrapPersistedGraph({
			schemaVersion: CURRENT_SCHEMA_VERSION,
			data: { ...graph, pinSequence: 1 }
		});

		expect(loaded.nodes.filter((node) => node.pinned).map((node) => node.id)).toEqual(['n0']);
		expect(loaded.pinSequence).toBe(1);
	});

	it('loads a graph containing a self-loop written by another program', () => {
		// Self-loops cannot be created in the UI, but externally written JSON may
		// contain them; loading must tolerate (not reject) them.
		const graph = makeGraph({
			nodeCount: 2,
			pinned: [0],
			edges: [
				[0, 1],
				[1, 1]
			]
		});

		const loaded = unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data: graph });

		expect(loaded.edges.map((edge) => [edge.sourceNodeId, edge.targetNodeId])).toEqual([
			['n0', 'n1'],
			['n1', 'n1']
		]);
	});

	it('rejects malformed graph payloads with a typed error', () => {
		expect(() => unwrapPersistedGraph({ schemaVersion: 1, data: { nodes: [] } })).toThrow(
			new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload')
		);
	});

	it('rejects unsupported schema versions with a typed error', () => {
		expect(() =>
			unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION + 1, data: makeGraph() })
		).toThrow(
			new PersistedGraphError(
				`Unsupported graph schema version: ${CURRENT_SCHEMA_VERSION + 1}`,
				'unsupported-version'
			)
		);
	});

	it('rejects current-version nodes with malformed tags', () => {
		const graph = makeGraph({ nodeCount: 1 });

		expect(() =>
			unwrapPersistedGraph({
				schemaVersion: CURRENT_SCHEMA_VERSION,
				data: { ...graph, nodes: [{ ...graph.nodes[0], tags: 'abc' }] }
			})
		).toThrow(new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload'));
	});

	it('rejects current-version edges with malformed tags', () => {
		const graph = makeGraph({ nodeCount: 2, edges: [[0, 1]] });

		expect(() =>
			unwrapPersistedGraph({
				schemaVersion: CURRENT_SCHEMA_VERSION,
				data: { ...graph, edges: [{ ...graph.edges[0], tags: [1] }] }
			})
		).toThrow(new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload'));
	});

	it('rejects current-version edges with malformed directed values', () => {
		const graph = makeGraph({ nodeCount: 2, edges: [[0, 1]] });

		expect(() =>
			unwrapPersistedGraph({
				schemaVersion: CURRENT_SCHEMA_VERSION,
				data: { ...graph, edges: [{ ...graph.edges[0], directed: 'yes' }] }
			})
		).toThrow(new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload'));
	});

	it('rejects current-version graphs with malformed tag color config', () => {
		const graph = makeGraph({ nodeCount: 1 });

		expect(() =>
			unwrapPersistedGraph({
				schemaVersion: CURRENT_SCHEMA_VERSION,
				data: { ...graph, tagColorConfig: { nodeTags: { abc: 123 }, edgeTags: {} } }
			})
		).toThrow(new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload'));
	});

	it('reads a current-version node carrying add-ons', () => {
		const graph = makeGraph({ nodeCount: 1, pinned: [0] });
		const nodes = [
			{ ...graph.nodes[0], addons: { task: { done: true, doneAt: 1_700_000_000_000 } } }
		];

		expect(
			unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data: { ...graph, nodes } })
				.nodes[0].addons
		).toEqual({ task: { done: true, doneAt: 1_700_000_000_000 } });
	});

	it('rejects an add-on name that is not in the registry', () => {
		const graph = makeGraph({ nodeCount: 1 });

		expect(() =>
			unwrapPersistedGraph({
				schemaVersion: CURRENT_SCHEMA_VERSION,
				data: { ...graph, nodes: [{ ...graph.nodes[0], addons: { nonsense: {} } }] }
			})
		).toThrow(new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload'));
	});

	it('rejects a registered add-on with malformed data', () => {
		const graph = makeGraph({ nodeCount: 1 });

		expect(() =>
			unwrapPersistedGraph({
				schemaVersion: CURRENT_SCHEMA_VERSION,
				data: { ...graph, nodes: [{ ...graph.nodes[0], addons: { task: { done: 'yes' } } }] }
			})
		).toThrow(new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload'));
	});

	it('rejects a task add-on with a non-finite doneAt', () => {
		const graph = makeGraph({ nodeCount: 1 });

		expect(() =>
			unwrapPersistedGraph({
				schemaVersion: CURRENT_SCHEMA_VERSION,
				data: {
					...graph,
					nodes: [{ ...graph.nodes[0], addons: { task: { done: true, doneAt: 'today' } } }]
				}
			})
		).toThrow(new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload'));
	});

	it('rejects malformed JSON with a typed error', () => {
		expect(() => parsePersistedGraph('{ nope')).toThrow(
			new PersistedGraphError('Persisted graph JSON is malformed.', 'malformed-payload')
		);
	});
});
