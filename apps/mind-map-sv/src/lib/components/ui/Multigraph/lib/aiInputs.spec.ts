import { describe, expect, it } from 'vitest';
import { collectAiInputs, groupAiInputs, type AiInput } from './aiInputs';
import { makeGraph } from './testFixtures';
import type { GraphAssetMetadata, MultigraphData } from '../../types/multigraph';
import type { AiAddon, AiRun, AiRunOutput, AiRunStatus, NodeContentBlock } from '../../types/node';

function asset(id: string, over: Partial<GraphAssetMetadata> = {}): GraphAssetMetadata {
	return {
		id,
		kind: 'file',
		mimeType: 'text/csv',
		name: `${id}.csv`,
		size: 1024,
		createdAt: 0,
		...over
	};
}

function fileBlock(assetId: string, name: string): NodeContentBlock {
	return { type: 'file', assetId, name };
}

function withAssets(graph: MultigraphData, assets: GraphAssetMetadata[]): MultigraphData {
	return { ...graph, assets: Object.fromEntries(assets.map((entry) => [entry.id, entry])) };
}

function runOutput(name: string, assetId = `a-${name}`): AiRunOutput {
	return { name, assetId, mimeType: name.endsWith('.png') ? 'image/png' : 'text/csv' };
}

function run(id: string, status: AiRunStatus, outputs: AiRunOutput[]): AiRun {
	return {
		id,
		startedAt: 0,
		status,
		mode: 'analyse',
		runtime: '0.27.7',
		inputs: [],
		summary: '',
		outputs,
		toolCalls: 1
	};
}

function aiAddon(runs: AiRun[]): AiAddon {
	return { prompt: 'Clean it up.', runs, promoted: {} };
}

/** The output assets a run's records point at, as the graph would carry them. */
function outputAssets(outputs: AiRunOutput[]): GraphAssetMetadata[] {
	return outputs.map((output) => ({
		id: output.assetId,
		kind: output.mimeType.startsWith('image/') ? 'image' : 'file',
		mimeType: output.mimeType,
		name: output.name,
		size: 4096,
		createdAt: 0
	}));
}

/**
 * `ai` with one AI neighbour joined by `edge`, whose runs are `runs`.
 *
 * The neighbour also carries an attachment, because the order that matters is
 * attachments *then* outputs within one node.
 */
function graphWithAiNeighbour(
	runs: AiRun[],
	edge: { source: string; target: string; directed: boolean; tags?: string[] }
): MultigraphData {
	const outputs = runs.flatMap((entry) => entry.outputs);
	return withAssets(
		makeGraph({
			nodes: [
				{ id: 'ai', title: '!ai Compare', description: '' },
				{
					id: 'parent',
					title: 'Sweep A',
					description: 'the first pass',
					content: [fileBlock('a-raw', 'raw.csv')],
					addons: { ai: aiAddon(runs) }
				}
			],
			edges: [{ id: 'e', tags: [], ...edge }]
		}),
		[asset('a-raw'), ...outputAssets(outputs)]
	);
}

const INCOMING = { source: 'parent', target: 'ai', directed: true };

/**
 * `ai` is the AI node; `up` feeds it over a directed edge, `side` over an
 * undirected one, and `down` hangs off a directed edge leaving the AI node —
 * the shape a promoted output has.
 */
function baseGraph(): MultigraphData {
	return withAssets(
		makeGraph({
			nodes: [
				{
					id: 'ai',
					title: 'Plot the runs',
					description: 'prompt lives in the add-on',
					content: [fileBlock('a-own-1', 'own-first.csv'), fileBlock('a-own-2', 'own-second.csv')]
				},
				{
					id: 'up',
					title: 'Bench run 1',
					description: 'first sweep',
					content: [fileBlock('a-up', 'sweep1.csv')]
				},
				{ id: 'side', title: 'Bench run 2', description: 'second sweep' },
				{ id: 'down', title: 'figure-1.png', description: 'promoted output' }
			],
			edges: [
				{ id: 'e-up', source: 'up', target: 'ai', directed: true, tags: ['baseline'] },
				{ id: 'e-side', source: 'ai', target: 'side', directed: false },
				{ id: 'e-down', source: 'ai', target: 'down', directed: true, tags: ['output'] }
			]
		}),
		[asset('a-own-1'), asset('a-own-2'), asset('a-up')]
	);
}

describe('collectAiInputs', () => {
	it('returns only the node’s own attachments when it has no edges', () => {
		const graph = withAssets(
			makeGraph({
				nodes: [
					{
						id: 'ai',
						title: 'Alone',
						description: '',
						content: [fileBlock('a1', 'one.csv'), fileBlock('a2', 'two.csv')]
					}
				]
			}),
			[asset('a1', { size: 10 }), asset('a2', { size: 20 })]
		);

		expect(collectAiInputs(graph, 'ai')).toEqual<AiInput[]>([
			{
				kind: 'file',
				nodeId: 'ai',
				assetId: 'a1',
				name: 'one.csv',
				mimeType: 'text/csv',
				size: 10,
				origin: 'attachment'
			},
			{
				kind: 'file',
				nodeId: 'ai',
				assetId: 'a2',
				name: 'two.csv',
				mimeType: 'text/csv',
				size: 20,
				origin: 'attachment'
			}
		]);
	});

	it('collects own attachments, then incoming and undirected neighbours, skipping outgoing', () => {
		expect(collectAiInputs(baseGraph(), 'ai')).toEqual<AiInput[]>([
			{
				kind: 'file',
				nodeId: 'ai',
				assetId: 'a-own-1',
				name: 'own-first.csv',
				mimeType: 'text/csv',
				size: 1024,
				origin: 'attachment'
			},
			{
				kind: 'file',
				nodeId: 'ai',
				assetId: 'a-own-2',
				name: 'own-second.csv',
				mimeType: 'text/csv',
				size: 1024,
				origin: 'attachment'
			},
			{
				kind: 'text',
				nodeId: 'up',
				title: 'Bench run 1',
				description: 'first sweep',
				label: 'baseline'
			},
			{
				kind: 'file',
				nodeId: 'up',
				assetId: 'a-up',
				name: 'sweep1.csv',
				mimeType: 'text/csv',
				size: 1024,
				label: 'baseline',
				origin: 'attachment'
			},
			{ kind: 'text', nodeId: 'side', title: 'Bench run 2', description: 'second sweep' }
		]);
	});

	it('excludes a promoted output node even when it carries an attachment', () => {
		const graph = baseGraph();
		const promoted = withAssets(
			{
				...graph,
				nodes: graph.nodes.map((node) =>
					node.id === 'down' ? { ...node, content: [fileBlock('a-down', 'figure-1.png')] } : node
				)
			},
			[asset('a-own-1'), asset('a-own-2'), asset('a-up'), asset('a-down')]
		);

		expect(collectAiInputs(promoted, 'ai').map((input) => input.nodeId)).toEqual([
			'ai',
			'ai',
			'up',
			'up',
			'side'
		]);
	});

	it('gives an undirected edge with no tags no label', () => {
		const inputs = collectAiInputs(baseGraph(), 'ai');
		const side = inputs.find((input) => input.nodeId === 'side');

		expect(side).toEqual<AiInput>({
			kind: 'text',
			nodeId: 'side',
			title: 'Bench run 2',
			description: 'second sweep'
		});
	});

	it('takes the first tag of an edge as the label', () => {
		const graph = makeGraph({
			nodes: [
				{ id: 'ai', title: 'AI', description: '' },
				{ id: 'src', title: 'Source', description: 'text' }
			],
			edges: [
				{ id: 'e', source: 'src', target: 'ai', directed: true, tags: ['baseline', 'ignored'] }
			]
		});

		expect(collectAiInputs(graph, 'ai')).toEqual<AiInput[]>([
			{ kind: 'text', nodeId: 'src', title: 'Source', description: 'text', label: 'baseline' }
		]);
	});

	it('lists a neighbour joined by two edges once, with the labels merged', () => {
		const graph = makeGraph({
			nodes: [
				{ id: 'ai', title: 'AI', description: '' },
				{ id: 'src', title: 'Source', description: 'text' }
			],
			edges: [
				{ id: 'e1', source: 'src', target: 'ai', directed: true, tags: ['baseline'] },
				{ id: 'e2', source: 'src', target: 'ai', directed: false, tags: ['control'] }
			]
		});

		expect(collectAiInputs(graph, 'ai')).toEqual<AiInput[]>([
			{
				kind: 'text',
				nodeId: 'src',
				title: 'Source',
				description: 'text',
				label: 'baseline, control'
			}
		]);
	});

	it('keeps the order when an unrelated edge is inserted ahead of the others', () => {
		const graph = baseGraph();
		const before = collectAiInputs(graph, 'ai');
		const withUnrelated: MultigraphData = {
			...graph,
			edges: [
				{
					id: 'e-unrelated',
					sourceNodeId: 'side',
					targetNodeId: 'down',
					tags: [],
					directed: false
				},
				...graph.edges
			]
		};

		expect(collectAiInputs(withUnrelated, 'ai')).toEqual(before);
	});

	it('keeps the order when unrelated nodes are reordered around the neighbours', () => {
		const graph = baseGraph();
		const before = collectAiInputs(graph, 'ai');
		const spectators = makeGraph({
			nodes: [
				{ id: 'x', title: 'Unrelated X', description: '' },
				{ id: 'y', title: 'Unrelated Y', description: '' }
			]
		}).nodes;
		const reordered: MultigraphData = {
			...graph,
			nodes: [spectators[1], ...graph.nodes, spectators[0]]
		};

		expect(collectAiInputs(reordered, 'ai')).toEqual(before);
	});

	it('orders neighbours by node order rather than edge order', () => {
		const graph = makeGraph({
			nodes: [
				{ id: 'ai', title: 'AI', description: '' },
				{ id: 'first', title: 'First', description: '' },
				{ id: 'second', title: 'Second', description: '' }
			],
			edges: [
				{ id: 'e-second', source: 'second', target: 'ai', directed: true, tags: [] },
				{ id: 'e-first', source: 'first', target: 'ai', directed: true, tags: [] }
			]
		});

		expect(collectAiInputs(graph, 'ai').map((input) => input.nodeId)).toEqual(['first', 'second']);
	});

	it('names an image by its asset name, falling back to the alt text', () => {
		const graph = withAssets(
			makeGraph({
				nodes: [
					{
						id: 'ai',
						title: 'AI',
						description: '',
						content: [
							{ type: 'image', assetId: 'img-named', alt: 'alt for the named one' },
							{ type: 'image', assetId: 'img-unnamed', alt: 'scope trace' }
						]
					}
				]
			}),
			[
				asset('img-named', { kind: 'image', mimeType: 'image/png', name: 'trace.png', size: 5 }),
				asset('img-unnamed', { kind: 'image', mimeType: 'image/png', name: undefined, size: 7 })
			]
		);

		expect(
			collectAiInputs(graph, 'ai').map((input) => input.kind === 'file' && input.name)
		).toEqual(['trace.png', 'scope trace']);
	});

	it('skips a content block whose asset metadata is missing, and an unknown node', () => {
		const graph = withAssets(
			makeGraph({
				nodes: [
					{
						id: 'ai',
						title: 'AI',
						description: '',
						content: [fileBlock('present', 'here.csv'), fileBlock('gone', 'missing.csv')]
					}
				]
			}),
			[asset('present')]
		);

		expect(collectAiInputs(graph, 'ai').map((input) => input.nodeId)).toEqual(['ai']);
		expect(collectAiInputs(graph, 'nope')).toEqual([]);
	});
});

describe('collectAiInputs: a neighbour’s run outputs', () => {
	it('takes the latest done run’s outputs, after that neighbour’s attachments', () => {
		const graph = graphWithAiNeighbour(
			[
				run('r1', 'done', [runOutput('old.csv')]),
				run('r2', 'done', [runOutput('clean.csv'), runOutput('drift.png')])
			],
			{ ...INCOMING, tags: ['baseline'] }
		);

		expect(collectAiInputs(graph, 'ai')).toEqual<AiInput[]>([
			{
				kind: 'text',
				nodeId: 'parent',
				title: 'Sweep A',
				description: 'the first pass',
				label: 'baseline'
			},
			{
				kind: 'file',
				nodeId: 'parent',
				assetId: 'a-raw',
				name: 'raw.csv',
				mimeType: 'text/csv',
				size: 1024,
				label: 'baseline',
				origin: 'attachment'
			},
			{
				kind: 'file',
				nodeId: 'parent',
				assetId: 'a-clean.csv',
				name: 'clean.csv',
				mimeType: 'text/csv',
				size: 4096,
				label: 'baseline',
				origin: 'run-output'
			},
			{
				kind: 'file',
				nodeId: 'parent',
				assetId: 'a-drift.png',
				name: 'drift.png',
				mimeType: 'image/png',
				size: 4096,
				label: 'baseline',
				origin: 'run-output'
			}
		]);
	});

	it('takes nothing from a neighbour whose only run was cancelled', () => {
		const graph = graphWithAiNeighbour(
			[run('r1', 'cancelled', [runOutput('clean.csv')])],
			INCOMING
		);

		expect(collectAiInputs(graph, 'ai').filter(isRunOutput)).toEqual([]);
	});

	it('takes the outputs of an AI neighbour joined by an undirected edge', () => {
		const graph = graphWithAiNeighbour([run('r1', 'done', [runOutput('clean.csv')])], {
			source: 'ai',
			target: 'parent',
			directed: false
		});

		expect(collectAiInputs(graph, 'ai').filter(isRunOutput).map(nameOf)).toEqual(['clean.csv']);
	});

	it('takes nothing from an outgoing AI neighbour, so a run cannot feed itself', () => {
		const graph = graphWithAiNeighbour([run('r1', 'done', [runOutput('clean.csv')])], {
			source: 'ai',
			target: 'parent',
			directed: true
		});

		expect(collectAiInputs(graph, 'ai')).toEqual([]);
	});

	it('never collects the node’s own outputs — self is not a neighbour', () => {
		const outputs = [runOutput('mine.csv')];
		const graph = withAssets(
			makeGraph({
				nodes: [
					{
						id: 'ai',
						title: '!ai Alone',
						description: '',
						addons: { ai: aiAddon([run('r1', 'done', outputs)]) }
					}
				],
				// A self-loop is not a neighbour either.
				edges: [{ id: 'e', source: 'ai', target: 'ai', directed: false, tags: [] }]
			}),
			outputAssets(outputs)
		);

		expect(collectAiInputs(graph, 'ai')).toEqual([]);
	});

	it('skips an output whose asset has gone, and a neighbour with no add-on at all', () => {
		const graph = graphWithAiNeighbour([run('r1', 'done', [runOutput('clean.csv')])], INCOMING);
		const evicted: MultigraphData = {
			...graph,
			assets: { 'a-raw': graph.assets?.['a-raw'] as GraphAssetMetadata }
		};

		expect(collectAiInputs(evicted, 'ai').filter(isRunOutput)).toEqual([]);
		expect(collectAiInputs(baseGraph(), 'ai').filter(isRunOutput)).toEqual([]);
	});
});

describe('collectAiInputs: the names the runtime will use', () => {
	/** Two AI parents, each producing a `plot.png`, plus one same-named attachment. */
	function twoParents(): MultigraphData {
		const first = [runOutput('plot.png', 'a-plot-1')];
		const second = [runOutput('plot.png', 'a-plot-2')];
		return withAssets(
			makeGraph({
				nodes: [
					{
						id: 'ai',
						title: '!ai Compare',
						description: '',
						content: [fileBlock('a-own', 'plot.png')]
					},
					{
						id: 'first',
						title: 'Sweep A',
						description: '',
						addons: { ai: aiAddon([run('r1', 'done', first)]) }
					},
					{
						id: 'second',
						title: 'Sweep B',
						description: '',
						addons: { ai: aiAddon([run('r2', 'done', second)]) }
					}
				],
				edges: [
					{ id: 'e1', source: 'first', target: 'ai', directed: true, tags: [] },
					{ id: 'e2', source: 'second', target: 'ai', directed: true, tags: [] }
				]
			}),
			[asset('a-own', { mimeType: 'image/png' }), ...outputAssets([...first, ...second])]
		);
	}

	it('gives two neighbours’ same-named outputs, and a same-named attachment, distinct names', () => {
		expect(collectAiInputs(twoParents(), 'ai').filter(isFile).map(nameOf)).toEqual([
			'plot.png',
			'plot-2.png',
			'plot-3.png'
		]);
	});

	it('is stable across repeated calls and across an unrelated graph edit', () => {
		const graph = twoParents();
		const before = collectAiInputs(graph, 'ai');

		expect(collectAiInputs(graph, 'ai')).toEqual(before);

		const edited: MultigraphData = {
			...graph,
			nodes: [
				...graph.nodes,
				{ id: 'bystander', title: 'Notes', description: 'unrelated', tags: [] }
			],
			posByNodeId: { ...graph.posByNodeId, bystander: { x: 5, y: 5 } }
		};
		expect(collectAiInputs(edited, 'ai')).toEqual(before);
	});

	it('sanitises a stored name that carries a path or stray whitespace', () => {
		const graph = withAssets(
			makeGraph({
				nodes: [
					{
						id: 'ai',
						title: '!ai',
						description: '',
						content: [fileBlock('a1', 'bench/2026-09/sweep.csv'), fileBlock('a2', '  ref.csv ')]
					}
				]
			}),
			[asset('a1'), asset('a2')]
		);

		expect(collectAiInputs(graph, 'ai').filter(isFile).map(nameOf)).toEqual([
			'sweep.csv',
			'ref.csv'
		]);
	});

	it('gives one asset reaching the node twice the one name it is written under', () => {
		// A promoted figure joined back by an incoming edge is the same bytes as
		// the run output it came from, and the executor writes it once.
		const outputs = [runOutput('drift.png')];
		const graph = withAssets(
			makeGraph({
				nodes: [
					{ id: 'ai', title: '!ai', description: '' },
					{
						id: 'parent',
						title: 'Sweep A',
						description: '',
						addons: { ai: aiAddon([run('r1', 'done', outputs)]) }
					},
					{
						id: 'figure',
						title: 'drift.png',
						description: '',
						content: [fileBlock('a-drift.png', 'drift.png')]
					}
				],
				edges: [
					{ id: 'e1', source: 'parent', target: 'ai', directed: true, tags: [] },
					{ id: 'e2', source: 'figure', target: 'ai', directed: true, tags: [] }
				]
			}),
			outputAssets(outputs)
		);

		expect(collectAiInputs(graph, 'ai').filter(isFile).map(nameOf)).toEqual([
			'drift.png',
			'drift.png'
		]);
	});
});

function isFile(input: AiInput): input is Extract<AiInput, { kind: 'file' }> {
	return input.kind === 'file';
}

function isRunOutput(input: AiInput): input is Extract<AiInput, { kind: 'file' }> {
	return input.kind === 'file' && input.origin === 'run-output';
}

function nameOf(input: Extract<AiInput, { kind: 'file' }>): string {
	return input.name;
}

describe('groupAiInputs', () => {
	it('puts each file under the node it hangs off, this node first', () => {
		const groups = groupAiInputs(collectAiInputs(baseGraph(), 'ai'), 'ai');

		expect(groups.map((group) => [group.nodeId, group.files.map((file) => file.name)])).toEqual([
			['ai', ['own-first.csv', 'own-second.csv']],
			['up', ['sweep1.csv']],
			['side', []]
		]);
		// The node the reader is looking at is the one they can attach to, and it
		// is named by the surface rather than by its own title.
		expect(groups[0].self).toBe(true);
		expect(groups[0].title).toBe('');
		expect(groups[1].self).toBe(false);
	});

	it('carries the neighbour’s title, description and edge label onto its header', () => {
		const groups = groupAiInputs(collectAiInputs(baseGraph(), 'ai'), 'ai');

		expect(groups[1]).toMatchObject({
			nodeId: 'up',
			title: 'Bench run 1',
			description: 'first sweep',
			label: 'baseline'
		});
		// An untagged edge gives no role, so there is no chip to draw.
		expect(groups[2].label).toBeUndefined();
	});

	// A node with nothing attached is exactly the node that needs Add file, so
	// its group is there before any input is.
	it('always opens with this node’s group, even with no inputs at all', () => {
		expect(groupAiInputs([], 'ai')).toEqual([
			{ nodeId: 'ai', self: true, title: '', description: '', files: [], outputs: [] }
		]);
	});

	it('groups a file whose node has no text input of its own', () => {
		const orphan: AiInput = {
			kind: 'file',
			nodeId: 'ghost',
			assetId: 'a1',
			name: 'one.csv',
			mimeType: 'text/csv',
			size: 12,
			origin: 'attachment'
		};

		// Collected inputs never look like this — a neighbour's text always comes
		// first — but this takes a list rather than a graph, and a file it was
		// handed must not vanish.
		expect(groupAiInputs([orphan], 'ai')[1]).toMatchObject({
			nodeId: 'ghost',
			title: 'ghost',
			files: [orphan],
			outputs: []
		});
	});

	it('routes a run output into the neighbour’s outputs, never its files', () => {
		const graph = graphWithAiNeighbour(
			[run('r1', 'done', [runOutput('clean.csv'), runOutput('drift.png')])],
			{ ...INCOMING, tags: ['baseline'] }
		);
		const groups = groupAiInputs(collectAiInputs(graph, 'ai'), 'ai');

		expect(
			groups.map((group) => [
				group.nodeId,
				group.files.map((file) => file.name),
				group.outputs.map((file) => file.name)
			])
		).toEqual([
			['ai', [], []],
			['parent', ['raw.csv'], ['clean.csv', 'drift.png']]
		]);
		// The label comes off the edge for an output exactly as for an attachment.
		expect(groups[1].outputs.every((file) => file.label === 'baseline')).toBe(true);
	});

	it('routes an orphan run output into outputs when it opens its own group', () => {
		const orphan: AiInput = {
			kind: 'file',
			nodeId: 'ghost',
			assetId: 'a1',
			name: 'plot.png',
			mimeType: 'image/png',
			size: 12,
			origin: 'run-output'
		};

		expect(groupAiInputs([orphan], 'ai')[1]).toMatchObject({
			nodeId: 'ghost',
			files: [],
			outputs: [orphan]
		});
	});
});
