import { describe, expect, it } from 'vitest';
import {
	CURRENT_SCHEMA_VERSION,
	NEUTRAL_VIEW_STATE,
	PersistedGraphError,
	parsePersistedGraph,
	unwrapPersistedGraph,
	unwrapPersistedHistory,
	wrapPersistedGraph
} from './migrations';
import { GRAPH_HTML_READER_VERSION, parseGraphFile, serializeGraphFile } from './graphFile';
import { makeGraph } from './components/ui/Multigraph/lib/testFixtures';
import type { GraphAssetMetadata, MultigraphData } from './components/ui/types/multigraph';
import type { ConfigOverrides } from './config/configOverrides';

describe('persisted graph migrations', () => {
	it('wraps current graph data in the schema envelope', () => {
		const graph = makeGraph({ nodeCount: 2, edges: [[0, 1]] });

		expect(wrapPersistedGraph(graph)).toEqual({
			schemaVersion: CURRENT_SCHEMA_VERSION,
			data: graph
		});
	});

	it('carries sparse settings in the envelope and omits an empty map', () => {
		const graph = makeGraph({ nodeCount: 2, edges: [[0, 1]] });
		const settings = { 'multigraph.layout.scaleFalloff': 0.5 } satisfies ConfigOverrides;

		expect(wrapPersistedGraph(graph, settings)).toEqual({
			schemaVersion: CURRENT_SCHEMA_VERSION,
			data: graph,
			settings
		});
		// Absent and empty mean the same thing, so an untuned graph is byte-identical
		// to one saved before settings existed.
		expect(wrapPersistedGraph(graph, {})).not.toHaveProperty('settings');
		expect(wrapPersistedGraph(graph)).not.toHaveProperty('settings');
	});

	it('reads a current-version payload the same way with or without settings', () => {
		const data = makeGraph({ nodeCount: 2, edges: [[0, 1]], pinned: [0] });

		// No version bump and no migration path: only `data` is validated, so the
		// extra key rides along untouched.
		expect(unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data })).toEqual(data);
		expect(
			unwrapPersistedGraph({
				schemaVersion: CURRENT_SCHEMA_VERSION,
				data,
				settings: { 'multigraph.layout.scaleFalloff': 0.5 }
			})
		).toEqual(data);
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

	describe('tag physics config', () => {
		it('round-trips a graph with factors through wrap, JSON and unwrap unchanged', () => {
			const graph = makeGraph({
				nodeCount: 1,
				pinned: [0],
				tagPhysicsConfig: { nodeTags: { topic: 0.25 }, edgeTags: { rel: 2, cites: 1.414 } }
			});

			const loaded = unwrapPersistedGraph(JSON.parse(JSON.stringify(wrapPersistedGraph(graph))));

			expect(loaded).toEqual(graph);
		});

		it('loads a payload without the field with no field', () => {
			const graph = makeGraph({ nodeCount: 1, pinned: [0] });

			const loaded = unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data: graph });

			expect(loaded).not.toHaveProperty('tagPhysicsConfig');
			expect(loaded).toBe(graph);
		});

		it('drops unusable entries, clamps out-of-range ones and fills a missing namespace', () => {
			const graph = makeGraph({ nodeCount: 1, pinned: [0] });

			const loaded = unwrapPersistedGraph({
				schemaVersion: CURRENT_SCHEMA_VERSION,
				data: {
					...graph,
					tagPhysicsConfig: {
						edgeTags: { a: 9, b: -1, c: 'x', d: 1, e: 0.5, f: 0.1, g: 8, h: 0.125 }
					}
				}
			});

			// The range is [0.125, 8]: both ends load as they are, past them clamps.
			expect(loaded.tagPhysicsConfig).toEqual({
				edgeTags: { a: 8, e: 0.5, f: 0.125, g: 8, h: 0.125 },
				nodeTags: {}
			});
		});

		it('drops non-finite and zero entries, clamps a tiny one, and empties a non-record map', () => {
			const graph = makeGraph({ nodeCount: 1, pinned: [0] });

			const loaded = unwrapPersistedGraph({
				schemaVersion: CURRENT_SCHEMA_VERSION,
				data: {
					...graph,
					tagPhysicsConfig: {
						nodeTags: { zero: 0, tiny: 0.01, nan: Number.NaN, big: Number.POSITIVE_INFINITY },
						edgeTags: 'not a record'
					}
				}
			});

			expect(loaded.tagPhysicsConfig).toEqual({ nodeTags: { tiny: 0.125 }, edgeTags: {} });
		});

		it('drops a field that sanitises to nothing', () => {
			const graph = makeGraph({ nodeCount: 1, pinned: [0] });

			const loaded = unwrapPersistedGraph({
				schemaVersion: CURRENT_SCHEMA_VERSION,
				data: { ...graph, tagPhysicsConfig: { nodeTags: { a: 1 }, edgeTags: { b: -2 } } }
			});

			expect(loaded).not.toHaveProperty('tagPhysicsConfig');
		});

		it.each([['a string'], [42], [null], [['nodeTags']]])(
			'drops a non-object field (%j) and still loads the graph',
			(value) => {
				const graph = makeGraph({ nodeCount: 1, pinned: [0] });

				const loaded = unwrapPersistedGraph({
					schemaVersion: CURRENT_SCHEMA_VERSION,
					data: { ...graph, tagPhysicsConfig: value }
				});

				expect(loaded).not.toHaveProperty('tagPhysicsConfig');
				expect(loaded.nodes).toEqual(graph.nodes);
			}
		);

		it('sanitises a version 7 payload too', () => {
			const graph = makeGraph({ nodeCount: 1, pinned: [0] });

			const loaded = unwrapPersistedGraph({
				schemaVersion: 7,
				data: { ...graph, tagPhysicsConfig: { nodeTags: { a: 16 }, edgeTags: {} } }
			});

			expect(loaded.tagPhysicsConfig).toEqual({ nodeTags: { a: 8 }, edgeTags: {} });
		});

		it('needs no schema bump', () => {
			expect(CURRENT_SCHEMA_VERSION).toBe(8);
		});
	});

	describe('node sizes', () => {
		it('round-trips valid sizes, including 0, through wrap, JSON and unwrap unchanged', () => {
			const graph = makeGraph({
				nodeCount: 3,
				pinned: [0],
				sizeBytes: { 0: 0, 1: 1536, 2: 41_943_040 }
			});

			const loaded = unwrapPersistedGraph(JSON.parse(JSON.stringify(wrapPersistedGraph(graph))));

			expect(loaded).toEqual(graph);
			expect(loaded.nodes.map((node) => node.sizeBytes)).toEqual([0, 1536, 41_943_040]);
		});

		it('drops invalid sizes and keeps every other field of those nodes', () => {
			const graph = makeGraph({
				nodes: [
					{ id: 'neg', title: 'Negative', description: 'a', tags: ['file'] },
					{ id: 'str', title: 'String', description: 'b', tags: [] },
					{ id: 'nul', title: 'Null', description: 'c', tags: [] },
					{ id: 'obj', title: 'Object', description: 'd', tags: [] },
					{ id: 'ok', title: 'Valid', description: 'e', tags: [] }
				],
				pinned: ['neg'],
				pinHistory: { neg: 1 }
			});
			const stored = {
				...graph,
				nodes: graph.nodes.map((node, index) => ({
					...node,
					sizeBytes: [-1, '12', null, { bytes: 12 }, 2048][index]
				}))
			};

			const loaded = unwrapPersistedGraph(
				JSON.parse(JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION, data: stored }))
			);

			expect(loaded.nodes.slice(0, 4)).toEqual(graph.nodes.slice(0, 4));
			for (const node of loaded.nodes.slice(0, 4)) {
				expect(node).not.toHaveProperty('sizeBytes');
			}
			expect(loaded.nodes[4]).toEqual({ ...graph.nodes[4], sizeBytes: 2048 });
			expect(loaded.edges).toEqual(graph.edges);
			expect(loaded.posByNodeId).toEqual(graph.posByNodeId);
		});

		it('rebuilds only the nodes it cleans', () => {
			const graph = makeGraph({ nodeCount: 2, pinned: [0], sizeBytes: { 0: 10 } });
			const data = { ...graph, nodes: [graph.nodes[0], { ...graph.nodes[1], sizeBytes: -5 }] };

			const loaded = unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data });

			expect(loaded).not.toBe(data);
			expect(loaded.nodes[0]).toBe(data.nodes[0]);
			expect(loaded.nodes[1]).not.toHaveProperty('sizeBytes');
		});

		it.each([
			['NaN', Number.NaN],
			['Infinity', Number.POSITIVE_INFINITY],
			['-Infinity', Number.NEGATIVE_INFINITY],
			['undefined', undefined]
		])('drops a %s size handed over as an object', (_label, size) => {
			const graph = makeGraph({ nodeCount: 1, pinned: [0] });

			const loaded = unwrapPersistedGraph({
				schemaVersion: CURRENT_SCHEMA_VERSION,
				data: { ...graph, nodes: [{ ...graph.nodes[0], sizeBytes: size }] }
			});

			expect(loaded.nodes[0]).not.toHaveProperty('sizeBytes');
			expect(loaded.nodes[0]).toEqual(graph.nodes[0]);
		});

		it('returns a graph with nothing to clean by identity', () => {
			const sizeless = makeGraph({ nodeCount: 2, pinned: [0] });
			const sized = makeGraph({ nodeCount: 2, pinned: [0], sizeBytes: { 0: 0, 1: 99 } });

			expect(unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data: sizeless })).toBe(
				sizeless
			);
			expect(unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data: sized })).toBe(
				sized
			);
		});

		it('needs no schema bump', () => {
			expect(CURRENT_SCHEMA_VERSION).toBe(8);
		});
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

describe('schema 7: file attachments', () => {
	const IMAGE_ASSET: GraphAssetMetadata = {
		id: 'a1',
		kind: 'image',
		mimeType: 'image/png',
		name: 'photo.png',
		size: 12,
		createdAt: 1
	};

	const CSV_ASSET: GraphAssetMetadata = {
		id: 'f1',
		kind: 'file',
		mimeType: 'text/csv',
		name: 'readings.csv',
		size: 24,
		createdAt: 2
	};

	/** A one-node graph carrying the given blocks and asset metadata. */
	function graphWith(
		content: NonNullable<MultigraphData['nodes'][number]['content']>,
		assets: Record<string, GraphAssetMetadata>
	): MultigraphData {
		return {
			...makeGraph({
				nodes: [{ id: 'n0', title: 'Node 0', description: '', content }],
				pinned: [0],
				pinHistory: { 0: 1 }
			}),
			assets,
			pinSequence: 1
		};
	}

	it('loads a version 6 document unchanged, images still images', () => {
		const data = graphWith([{ type: 'image', assetId: 'a1', alt: 'A photo' }], { a1: IMAGE_ASSET });

		const loaded = unwrapPersistedGraph({ schemaVersion: 6, data });

		expect(loaded).toEqual(data);
		expect(loaded.nodes[0].content).toEqual([{ type: 'image', assetId: 'a1', alt: 'A photo' }]);
		expect(loaded.assets?.a1.kind).toBe('image');
	});

	it('loads a version 7 document carrying a file block', () => {
		const data = graphWith(
			[{ type: 'file', assetId: 'f1', name: 'readings.csv', caption: 'March run' }],
			{ f1: CSV_ASSET }
		);

		expect(unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data })).toEqual(data);
	});

	it('loads a node carrying an image and a file side by side', () => {
		const data = graphWith(
			[
				{ type: 'image', assetId: 'a1', alt: 'A photo' },
				{ type: 'file', assetId: 'f1', name: 'readings.csv' }
			],
			{ a1: IMAGE_ASSET, f1: CSV_ASSET }
		);

		expect(unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data })).toEqual(data);
	});

	// The kind says how the node treats the blob, not what the blob is: a PNG
	// attached through Add file is a download, not a rendered image.
	it('accepts a file asset with an image MIME type', () => {
		const pngAsFile: GraphAssetMetadata = {
			id: 'f2',
			kind: 'file',
			mimeType: 'image/png',
			name: 'diagram.png',
			size: 40,
			createdAt: 3
		};
		const data = graphWith([{ type: 'file', assetId: 'f2', name: 'diagram.png' }], {
			f2: pngAsFile
		});

		expect(unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data })).toEqual(data);
	});

	it('still rejects an image asset whose MIME type is not an image', () => {
		const data = graphWith([{ type: 'image', assetId: 'a1', alt: 'A photo' }], {
			a1: { ...IMAGE_ASSET, mimeType: 'text/csv' }
		});

		expect(() => unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data })).toThrow(
			new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload')
		);
	});

	it('rejects an asset kind outside the two the schema knows', () => {
		const data = graphWith([{ type: 'image', assetId: 'a1', alt: 'A photo' }], {
			// A newer app's kind, which this one cannot load and re-save without losing it.
			a1: { ...IMAGE_ASSET, kind: 'video' } as unknown as GraphAssetMetadata
		});

		expect(() => unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data })).toThrow(
			new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload')
		);
	});

	it('rejects a file block with no name', () => {
		const data = graphWith(
			[
				{ type: 'file', assetId: 'f1' } as unknown as {
					type: 'file';
					assetId: string;
					name: string;
				}
			],
			{ f1: CSV_ASSET }
		);

		expect(() => unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data })).toThrow(
			new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload')
		);
	});

	it('rejects a content block of an unknown type', () => {
		const data = graphWith(
			[
				{ type: 'video', assetId: 'v1' } as unknown as {
					type: 'file';
					assetId: string;
					name: string;
				}
			],
			{}
		);

		expect(() => unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data })).toThrow(
			new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload')
		);
	});

	it('refuses schema version 9 as unsupported rather than malformed', () => {
		expect(() =>
			unwrapPersistedGraph({ schemaVersion: 9, data: makeGraph({ nodeCount: 1 }) })
		).toThrow(
			new PersistedGraphError('Unsupported graph schema version: 9', 'unsupported-version')
		);
	});

	// A tail from another schema version is dropped rather than migrated; the
	// graph beside it still loads, which is the half that matters on a reload.
	it('drops a version 7 draft undo tail and loads its graph anyway', () => {
		const data = graphWith([{ type: 'file', assetId: 'f1', name: 'readings.csv' }], {
			f1: CSV_ASSET
		});
		const draft = {
			schemaVersion: 7,
			data,
			history: {
				head: {
					label: 'add file',
					primaryNodeId: 'n0',
					severedBeaconPreference: [],
					createdAt: 100
				},
				entries: []
			}
		};

		expect(unwrapPersistedHistory(draft)).toBeNull();
		expect(unwrapPersistedGraph(draft)).toEqual(data);
	});

	it('drops a version 6 draft undo tail and loads its graph anyway', () => {
		const data = graphWith([{ type: 'image', assetId: 'a1', alt: 'A photo' }], { a1: IMAGE_ASSET });
		const draft = {
			schemaVersion: 6,
			data,
			history: {
				head: {
					label: 'add image',
					primaryNodeId: 'n0',
					severedBeaconPreference: [],
					createdAt: 100
				},
				entries: []
			}
		};

		expect(unwrapPersistedHistory(draft)).toBeNull();
		expect(unwrapPersistedGraph(draft)).toEqual(data);
	});

	it('keeps a current-version draft undo tail', () => {
		const data = graphWith([{ type: 'file', assetId: 'f1', name: 'readings.csv' }], {
			f1: CSV_ASSET
		});
		const head = {
			label: 'add file',
			primaryNodeId: 'n0',
			severedBeaconPreference: [],
			createdAt: 100
		};

		expect(
			unwrapPersistedHistory({
				schemaVersion: CURRENT_SCHEMA_VERSION,
				data,
				history: { head, entries: [] }
			})
		).toEqual({ head, entries: [] });
	});
});

describe('schema 8: the ai add-on', () => {
	const PLOT_ASSET: GraphAssetMetadata = {
		id: 'p1',
		kind: 'image',
		mimeType: 'image/png',
		name: 'plot.png',
		size: 40,
		createdAt: 3
	};

	/** A finished run with every optional field filled in. */
	const FULL_RUN = {
		id: 'run-1',
		startedAt: 1_700_000_000_000,
		finishedAt: 1_700_000_030_000,
		status: 'done',
		mode: 'analyse',
		model: 'claude-opus-5',
		runtime: '0.27.7',
		inputs: [{ nodeId: 'src', assetId: 'f1', label: 'baseline' }, { nodeId: 'note' }],
		summary: 'Plotted channel 2 for both files.',
		outputs: [{ name: 'plot.png', assetId: 'p1', mimeType: 'image/png' }],
		usage: { inputTokens: 1200, outputTokens: 340 },
		toolCalls: 2,
		error: undefined
	};

	/** A one-node graph whose node carries `addons`, plus the given asset metadata. */
	function graphWithAddons(
		addons: unknown,
		assets: Record<string, GraphAssetMetadata> = {}
	): unknown {
		const base = makeGraph({
			nodes: [{ id: 'n0', title: 'Analysis', description: '' }],
			pinned: [0],
			pinHistory: { 0: 1 }
		});
		return {
			...base,
			nodes: [{ ...base.nodes[0], addons }],
			assets,
			pinSequence: 1
		};
	}

	it('loads a version 7 document unchanged', () => {
		const data = graphWithAddons({ task: { done: true, doneAt: 5 } });

		expect(unwrapPersistedGraph({ schemaVersion: 7, data })).toEqual(data);
	});

	it('loads a node carrying a fully populated ai add-on', () => {
		const data = graphWithAddons(
			{
				ai: {
					prompt: 'plot channel 2 against time',
					model: 'claude-opus-5',
					script: 'import pandas as pd\n',
					runs: [FULL_RUN],
					promoted: { 'plot.png': 'n1' }
				}
			},
			{ p1: PLOT_ASSET }
		);

		expect(unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data })).toEqual(data);
	});

	it('loads an ai add-on that has never run', () => {
		const data = graphWithAddons({ ai: { prompt: '', runs: [], promoted: {} } });

		expect(unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data })).toEqual(data);
	});

	it('loads an ai add-on beside a task one', () => {
		const data = graphWithAddons({
			task: { done: false },
			ai: { prompt: 'plot it', runs: [], promoted: {} }
		});

		expect(unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data })).toEqual(data);
	});

	// A run is never persisted as running, so a file saying one is describes a
	// state this app cannot resume or draw.
	it('refuses a persisted run whose status is running', () => {
		const data = graphWithAddons({
			ai: { prompt: '', runs: [{ ...FULL_RUN, status: 'running' }], promoted: {} }
		});

		expect(() => unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data })).toThrow(
			new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload')
		);
	});

	it('refuses a run whose status is a word it does not know', () => {
		const data = graphWithAddons({
			ai: { prompt: '', runs: [{ ...FULL_RUN, status: 'finished' }], promoted: {} }
		});

		expect(() => unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data })).toThrow(
			new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload')
		);
	});

	it('refuses a run whose mode is not one of the three', () => {
		const data = graphWithAddons({
			ai: { prompt: '', runs: [{ ...FULL_RUN, mode: 'chat' }], promoted: {} }
		});

		expect(() => unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data })).toThrow(
			new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload')
		);
	});

	it('refuses a run with no runtime recorded', () => {
		const withoutRuntime = { ...FULL_RUN, runtime: undefined };
		const data = graphWithAddons({
			ai: { prompt: '', runs: [withoutRuntime], promoted: {} }
		});

		expect(() => unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data })).toThrow(
			new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload')
		);
	});

	it('refuses a malformed output entry', () => {
		const data = graphWithAddons({
			ai: {
				prompt: '',
				runs: [{ ...FULL_RUN, outputs: [{ name: 'plot.png', assetId: 'p1' }] }],
				promoted: {}
			}
		});

		expect(() => unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data })).toThrow(
			new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload')
		);
	});

	it('refuses usage that is not a pair of numbers', () => {
		const data = graphWithAddons({
			ai: {
				prompt: '',
				runs: [{ ...FULL_RUN, usage: { inputTokens: 1, outputTokens: 'lots' } }],
				promoted: {}
			}
		});

		expect(() => unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data })).toThrow(
			new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload')
		);
	});

	it('refuses a promoted binding that is not a node id string', () => {
		const data = graphWithAddons({
			ai: { prompt: '', runs: [], promoted: { 'plot.png': { nodeId: 'n1' } } }
		});

		expect(() => unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data })).toThrow(
			new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload')
		);
	});

	it('refuses runs that is not an array', () => {
		const data = graphWithAddons({ ai: { prompt: '', runs: {}, promoted: {} } });

		expect(() => unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data })).toThrow(
			new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload')
		);
	});

	it('refuses an ai add-on with no prompt field at all', () => {
		const data = graphWithAddons({ ai: { runs: [], promoted: {} } });

		expect(() => unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data })).toThrow(
			new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload')
		);
	});

	// `results` is a new optional field on an existing record, which is the whole
	// reason neither CURRENT_SCHEMA_VERSION nor GRAPH_HTML_READER_VERSION moves
	// for milestone 15: a milestone 14 build reads a document carrying it.
	describe('a run’s recorded results', () => {
		const RESULTS = [
			{ symbol: 'R_{th}', value: '12.3', unit: 'K/W' },
			{ symbol: 'n', value: '41000' }
		];

		it('loads a v8 payload whose runs carry no results at all', () => {
			const data = graphWithAddons(
				{ ai: { prompt: 'plot it', runs: [FULL_RUN], promoted: {} } },
				{ p1: PLOT_ASSET }
			);

			expect(unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data })).toEqual(data);
		});

		it('loads a run carrying results, with and without units', () => {
			const data = graphWithAddons(
				{
					ai: {
						prompt: 'plot it',
						runs: [{ ...FULL_RUN, results: RESULTS }],
						promoted: {}
					}
				},
				{ p1: PLOT_ASSET }
			);

			expect(unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data })).toEqual(data);
		});

		it('loads a run whose results list is empty', () => {
			const data = graphWithAddons(
				{ ai: { prompt: '', runs: [{ ...FULL_RUN, results: [] }], promoted: {} } },
				{ p1: PLOT_ASSET }
			);

			expect(unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data })).toEqual(data);
		});

		it('round trips through the graph file byte for byte', () => {
			const data = graphWithAddons(
				{
					ai: {
						prompt: 'plot it',
						runs: [{ ...FULL_RUN, results: RESULTS }],
						promoted: {}
					}
				},
				{ p1: PLOT_ASSET }
				// `graphWithAddons` is typed `unknown` so the malformed cases above can
				// hand it nonsense; this one is well-formed and the file writer needs
				// the real type.
			) as MultigraphData;
			const doc = { data, viewState: NEUTRAL_VIEW_STATE };

			const written = serializeGraphFile(doc);
			const read = parseGraphFile(written);

			expect(read.data).toEqual(data);
			expect(serializeGraphFile({ ...doc, data: read.data })).toBe(written);
		});

		it('refuses a run whose results is not an array', () => {
			const data = graphWithAddons({
				ai: { prompt: '', runs: [{ ...FULL_RUN, results: {} }], promoted: {} }
			});

			expect(() => unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data })).toThrow(
				new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload')
			);
		});

		it('refuses a result whose value is a number rather than the printed string', () => {
			const data = graphWithAddons({
				ai: {
					prompt: '',
					runs: [{ ...FULL_RUN, results: [{ symbol: 'R', value: 12.3 }] }],
					promoted: {}
				}
			});

			expect(() => unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data })).toThrow(
				new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload')
			);
		});

		it('refuses a result with no symbol', () => {
			const data = graphWithAddons({
				ai: {
					prompt: '',
					runs: [{ ...FULL_RUN, results: [{ value: '1' }] }],
					promoted: {}
				}
			});

			expect(() => unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data })).toThrow(
				new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload')
			);
		});

		it('refuses a result whose unit is not a string', () => {
			const data = graphWithAddons({
				ai: {
					prompt: '',
					runs: [{ ...FULL_RUN, results: [{ symbol: 'R', value: '1', unit: 7 }] }],
					promoted: {}
				}
			});

			expect(() => unwrapPersistedGraph({ schemaVersion: CURRENT_SCHEMA_VERSION, data })).toThrow(
				new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload')
			);
		});
	});
});

// The versions milestone 15 leaves alone. A new optional field on an existing
// record is loadable by a milestone 14 build, so bumping either number would
// route those readers to their own embedded shell for no reason.
describe('schema and reader versions after milestone 15', () => {
	it('stays at schema 8 and reader 4', () => {
		expect(CURRENT_SCHEMA_VERSION).toBe(8);
		expect(GRAPH_HTML_READER_VERSION).toBe(4);
	});
});
