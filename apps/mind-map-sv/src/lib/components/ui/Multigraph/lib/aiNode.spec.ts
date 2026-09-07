import { describe, expect, it } from 'vitest';
import {
	AI_RUN_STATUSES,
	isAiRunStatus,
	markInterruptedRuns,
	promoteAiOutput,
	recordAiRun,
	refreshPromotedOutputs,
	replaceAiRun,
	setAiPrompt,
	setAiScript
} from './aiNode';
import { makeGraph } from './testFixtures';
import type { GraphAssetMetadata, MultigraphData } from '../../types/multigraph';
import type { AiAddon, AiRun, AiRunOutput, NodeContentBlock, NodeData } from '../../types/node';

const RUNTIME = '0.27.7';

function makeRun(patch: Partial<AiRun> & Pick<AiRun, 'id'>): AiRun {
	return {
		startedAt: 1_700_000_000_000,
		status: 'done',
		mode: 'analyse',
		runtime: RUNTIME,
		inputs: [],
		summary: '',
		outputs: [],
		toolCalls: 0,
		...patch
	};
}

function makeOutput(name: string, assetId: string, mimeType = 'image/png'): AiRunOutput {
	return { name, assetId, mimeType };
}

function imageAsset(id: string): GraphAssetMetadata {
	return { id, kind: 'image', mimeType: 'image/png', size: 10, createdAt: 1 };
}

/** A graph whose `ai` node carries the add-on, plus whatever other nodes a case needs. */
function graphWithAi(
	addon: Partial<AiAddon> = {},
	others: Array<Omit<NodeData, 'tags' | 'description'> & { description?: string }> = []
): MultigraphData {
	return makeGraph({
		nodes: [
			{
				id: 'ai',
				title: 'Analysis',
				description: '',
				addons: { ai: { prompt: '', runs: [], promoted: {}, ...addon } }
			},
			...others.map((node) => ({ description: '', ...node }))
		]
	});
}

function aiAddon(graph: MultigraphData): AiAddon {
	const addon = graph.nodes.find((node) => node.id === 'ai')?.addons?.ai;
	if (addon === undefined) throw new Error('expected the ai node to carry the add-on');
	return addon;
}

function contentOf(graph: MultigraphData, nodeId: string): NodeContentBlock[] {
	return graph.nodes.find((node) => node.id === nodeId)?.content ?? [];
}

describe('isAiRunStatus', () => {
	it('accepts each of the four terminal statuses', () => {
		expect(AI_RUN_STATUSES.every(isAiRunStatus)).toBe(true);
	});

	it('rejects running, which is UI state and never a stored status', () => {
		expect(isAiRunStatus('running')).toBe(false);
	});

	it('rejects a non-string', () => {
		expect(isAiRunStatus(undefined)).toBe(false);
		expect(isAiRunStatus(3)).toBe(false);
	});
});

describe('setAiPrompt', () => {
	it('replaces the saved prompt', () => {
		const graph = setAiPrompt(graphWithAi(), 'ai', 'plot channel 2 against time');

		expect(aiAddon(graph).prompt).toBe('plot channel 2 against time');
	});

	it('returns the same graph object when the text is unchanged', () => {
		const before = graphWithAi({ prompt: 'plot it' });

		expect(setAiPrompt(before, 'ai', 'plot it')).toBe(before);
	});

	it('returns the same graph object for a node without the add-on', () => {
		const before = makeGraph({ nodeCount: 1 });

		expect(setAiPrompt(before, 'n0', 'plot it')).toBe(before);
	});

	it('returns the same graph object for an unknown node', () => {
		const before = graphWithAi();

		expect(setAiPrompt(before, 'missing', 'plot it')).toBe(before);
	});

	it('does not mutate the graph it was handed', () => {
		const before = graphWithAi({ prompt: 'first' });
		setAiPrompt(before, 'ai', 'second');

		expect(aiAddon(before).prompt).toBe('first');
	});

	it('leaves the runs and promoted bindings the node already had', () => {
		const before = graphWithAi({
			runs: [makeRun({ id: 'r1' })],
			promoted: { 'plot.png': 'promoted' }
		});
		const after = setAiPrompt(before, 'ai', 'plot it');

		expect(aiAddon(after).runs).toBe(aiAddon(before).runs);
		expect(aiAddon(after).promoted).toEqual({ 'plot.png': 'promoted' });
	});
});

describe('setAiScript', () => {
	it('stores the script the run produced', () => {
		const graph = setAiScript(graphWithAi(), 'ai', 'import pandas as pd\n');

		expect(aiAddon(graph).script).toBe('import pandas as pd\n');
	});

	it('returns the same graph object when the script is byte-identical', () => {
		const before = graphWithAi({ script: 'print(1)' });

		expect(setAiScript(before, 'ai', 'print(1)')).toBe(before);
	});

	it('returns the same graph object for a node without the add-on', () => {
		const before = makeGraph({ nodeCount: 1 });

		expect(setAiScript(before, 'n0', 'print(1)')).toBe(before);
	});

	it('does not mutate the graph it was handed', () => {
		const before = graphWithAi({ script: 'print(1)' });
		setAiScript(before, 'ai', 'print(2)');

		expect(aiAddon(before).script).toBe('print(1)');
	});
});

describe('recordAiRun', () => {
	it('appends the run, newest last', () => {
		const before = graphWithAi({ runs: [makeRun({ id: 'r1' })] });
		const { graph } = recordAiRun(before, 'ai', makeRun({ id: 'r2' }), 3);

		expect(aiAddon(graph).runs.map((run) => run.id)).toEqual(['r1', 'r2']);
	});

	it('evicts the oldest runs beyond the history length', () => {
		const before = graphWithAi({ runs: [makeRun({ id: 'r1' }), makeRun({ id: 'r2' })] });
		const { graph } = recordAiRun(before, 'ai', makeRun({ id: 'r3' }), 2);

		expect(aiAddon(graph).runs.map((run) => run.id)).toEqual(['r2', 'r3']);
	});

	it('truncates the summary to the configured length, with no ellipsis', () => {
		const { graph } = recordAiRun(
			graphWithAi(),
			'ai',
			makeRun({ id: 'r1', summary: 'x'.repeat(50) }),
			3,
			10
		);

		expect(aiAddon(graph).runs[0].summary).toBe('x'.repeat(10));
	});

	it('leaves a summary shorter than the cap alone', () => {
		const { graph } = recordAiRun(
			graphWithAi(),
			'ai',
			makeRun({ id: 'r1', summary: 'short' }),
			3,
			10
		);

		expect(aiAddon(graph).runs[0].summary).toBe('short');
	});

	it('returns the evicted run’s outputs when nothing else references them', () => {
		const before = graphWithAi({
			runs: [makeRun({ id: 'r1', outputs: [makeOutput('plot.png', 'a1')] })]
		});
		const { evictedAssetIds } = recordAiRun(before, 'ai', makeRun({ id: 'r2' }), 1);

		expect(evictedAssetIds).toEqual(['a1']);
	});

	it('keeps an evicted output that a promoted node’s content block still shows', () => {
		const before = graphWithAi(
			{
				runs: [makeRun({ id: 'r1', outputs: [makeOutput('plot.png', 'a1')] })],
				promoted: { 'plot.png': 'promoted' }
			},
			[
				{
					id: 'promoted',
					title: 'plot.png',
					content: [{ type: 'image', assetId: 'a1', alt: 'plot.png' }]
				}
			]
		);
		const { evictedAssetIds } = recordAiRun(before, 'ai', makeRun({ id: 'r2' }), 1);

		expect(evictedAssetIds).toEqual([]);
	});

	it('keeps an evicted output that any other node attached as a file', () => {
		const before = graphWithAi(
			{ runs: [makeRun({ id: 'r1', outputs: [makeOutput('clean.csv', 'a1', 'text/csv')] })] },
			[
				{
					id: 'other',
					title: 'Cleaned',
					content: [{ type: 'file', assetId: 'a1', name: 'clean.csv' }]
				}
			]
		);
		const { evictedAssetIds } = recordAiRun(before, 'ai', makeRun({ id: 'r2' }), 1);

		expect(evictedAssetIds).toEqual([]);
	});

	it('keeps an evicted output a surviving run produced under the same asset id', () => {
		const before = graphWithAi({
			runs: [
				makeRun({ id: 'r1', outputs: [makeOutput('plot.png', 'a1')] }),
				makeRun({ id: 'r2', outputs: [makeOutput('plot.png', 'a1')] })
			]
		});
		const { evictedAssetIds } = recordAiRun(before, 'ai', makeRun({ id: 'r3' }), 2);

		expect(evictedAssetIds).toEqual([]);
	});

	it('reports only the unreachable half when an evicted run wrote two outputs', () => {
		const before = graphWithAi(
			{
				runs: [
					makeRun({
						id: 'r1',
						outputs: [makeOutput('plot.png', 'kept'), makeOutput('table.csv', 'gone', 'text/csv')]
					})
				],
				promoted: { 'plot.png': 'promoted' }
			},
			[
				{
					id: 'promoted',
					title: 'plot.png',
					content: [{ type: 'image', assetId: 'kept', alt: 'plot.png' }]
				}
			]
		);
		const { evictedAssetIds } = recordAiRun(before, 'ai', makeRun({ id: 'r2' }), 1);

		expect(evictedAssetIds).toEqual(['gone']);
	});

	it('drops asset metadata for what it evicted, and only for that', () => {
		const before: MultigraphData = {
			...graphWithAi({
				runs: [
					makeRun({
						id: 'r1',
						outputs: [makeOutput('plot.png', 'gone'), makeOutput('kept.png', 'kept')]
					})
				],
				promoted: { 'kept.png': 'promoted' }
			}),
			assets: { gone: imageAsset('gone'), kept: imageAsset('kept') }
		};
		const withPromoted: MultigraphData = {
			...before,
			nodes: [
				...before.nodes,
				{
					id: 'promoted',
					title: 'kept.png',
					description: '',
					tags: [],
					content: [{ type: 'image', assetId: 'kept', alt: 'kept.png' }]
				}
			]
		};

		const { graph } = recordAiRun(withPromoted, 'ai', makeRun({ id: 'r2' }), 1);

		expect(Object.keys(graph.assets ?? {})).toEqual(['kept']);
	});

	it('evicts the run it was just handed when the history length is zero', () => {
		const { graph, evictedAssetIds } = recordAiRun(
			graphWithAi(),
			'ai',
			makeRun({ id: 'r1', outputs: [makeOutput('plot.png', 'a1')] }),
			0
		);

		expect(aiAddon(graph).runs).toEqual([]);
		expect(evictedAssetIds).toEqual(['a1']);
	});

	it('leaves a node without the add-on alone and evicts nothing', () => {
		const before = makeGraph({ nodeCount: 1 });
		const { graph, evictedAssetIds } = recordAiRun(before, 'n0', makeRun({ id: 'r1' }), 3);

		expect(graph).toBe(before);
		expect(evictedAssetIds).toEqual([]);
	});

	it('does not mutate the graph it was handed', () => {
		const before = graphWithAi({ runs: [makeRun({ id: 'r1' })] });
		recordAiRun(before, 'ai', makeRun({ id: 'r2' }), 1);

		expect(aiAddon(before).runs.map((run) => run.id)).toEqual(['r1']);
	});
});

describe('replaceAiRun', () => {
	it('swaps the placeholder for the finished record in place, leaving one entry', () => {
		const before = graphWithAi({
			runs: [makeRun({ id: 'old' }), makeRun({ id: 'live', status: 'interrupted' })]
		});

		const after = replaceAiRun(
			before,
			'ai',
			makeRun({
				id: 'live',
				status: 'done',
				summary: 'Two channels, both drifting.',
				outputs: [makeOutput('drift.png', 'a1')],
				toolCalls: 2
			}),
			[imageAsset('a1')]
		);

		const runs = aiAddon(after).runs;
		expect(runs.map((run) => run.id)).toEqual(['old', 'live']);
		expect(runs[1]).toMatchObject({
			status: 'done',
			summary: 'Two channels, both drifting.',
			toolCalls: 2
		});
		expect(after.assets?.a1).toEqual(imageAsset('a1'));
	});

	it('leaves a graph whose history no longer holds the run untouched', () => {
		const before = graphWithAi({ runs: [makeRun({ id: 'old' })] });

		const after = replaceAiRun(before, 'ai', makeRun({ id: 'gone', status: 'done' }), [
			imageAsset('a1')
		]);

		expect(after).toBe(before);
	});

	it('truncates the summary the way recordAiRun does', () => {
		const before = graphWithAi({ runs: [makeRun({ id: 'live', status: 'interrupted' })] });

		const after = replaceAiRun(
			before,
			'ai',
			makeRun({ id: 'live', status: 'done', summary: 'x'.repeat(50) }),
			[],
			10
		);

		expect(aiAddon(after).runs[0].summary).toBe('x'.repeat(10));
	});

	it('does not mutate the graph it was handed', () => {
		const before = graphWithAi({ runs: [makeRun({ id: 'live', status: 'interrupted' })] });

		replaceAiRun(before, 'ai', makeRun({ id: 'live', status: 'done', summary: 'done' }));

		expect(aiAddon(before).runs[0].status).toBe('interrupted');
	});

	it('leaves a node without the add-on alone', () => {
		const before = makeGraph({ nodes: [{ id: 'plain', title: 'Plain', description: '' }] });

		expect(replaceAiRun(before, 'plain', makeRun({ id: 'live' }))).toBe(before);
	});
});

describe('markInterruptedRuns', () => {
	// The type says a run's status is one of the four; this is a run that got
	// into memory without going through the type, which is the case the function
	// exists for. The persisted validator refuses the same record outright.
	const runningRun = {
		...makeRun({ id: 'r1' }),
		status: 'running'
	} as unknown as AiRun;

	it('turns a non-terminal status into interrupted', () => {
		const graph = markInterruptedRuns(graphWithAi({ runs: [runningRun] }));

		expect(aiAddon(graph).runs[0].status).toBe('interrupted');
	});

	it('keeps everything else about the run', () => {
		const graph = markInterruptedRuns(
			graphWithAi({ runs: [{ ...runningRun, summary: 'halfway', toolCalls: 2 }] })
		);

		expect(aiAddon(graph).runs[0]).toEqual({
			...runningRun,
			status: 'interrupted',
			summary: 'halfway',
			toolCalls: 2
		});
	});

	it('returns the same graph object when every run is already terminal', () => {
		const before = graphWithAi({
			runs: [makeRun({ id: 'r1' }), makeRun({ id: 'r2', status: 'cancelled' })]
		});

		expect(markInterruptedRuns(before)).toBe(before);
	});

	it('returns the same graph object for a graph with no ai node at all', () => {
		const before = makeGraph({ nodeCount: 2 });

		expect(markInterruptedRuns(before)).toBe(before);
	});

	it('does not mutate the graph it was handed', () => {
		const before = graphWithAi({ runs: [runningRun] });
		markInterruptedRuns(before);

		expect(aiAddon(before).runs[0].status).toBe('running');
	});
});

describe('promoteAiOutput', () => {
	const AT = { x: 120, y: -40 };

	/** An AI node whose latest done run produced one PNG and one CSV. */
	function promotableGraph(promoted: Record<string, string> = {}): MultigraphData {
		return graphWithAi({
			runs: [
				makeRun({
					id: 'r1',
					outputs: [makeOutput('plot.png', 'a1'), makeOutput('table.csv', 'a2', 'text/csv')]
				})
			],
			promoted
		});
	}

	function nodeOf(graph: MultigraphData, nodeId: string): NodeData {
		const node = graph.nodes.find((candidate) => candidate.id === nodeId);
		if (node === undefined) throw new Error(`no node ${nodeId}`);
		return node;
	}

	it('creates a node titled by the output, holding its asset, at the given position', () => {
		const graph = promoteAiOutput(promotableGraph(), 'ai', 'plot.png', {
			position: AT,
			nodeId: 'promoted'
		});

		expect(nodeOf(graph, 'promoted').title).toBe('plot.png');
		expect(contentOf(graph, 'promoted')).toEqual([
			{ type: 'image', assetId: 'a1', alt: 'plot.png' }
		]);
		expect(graph.posByNodeId.promoted).toEqual(AT);
	});

	it('joins it to the AI node with a directed edge pointing away from the AI node', () => {
		const graph = promoteAiOutput(promotableGraph(), 'ai', 'plot.png', {
			position: AT,
			nodeId: 'promoted'
		});

		expect(graph.edges).toHaveLength(1);
		expect(graph.edges[0]).toMatchObject({
			sourceNodeId: 'ai',
			targetNodeId: 'promoted',
			directed: true,
			tags: []
		});
	});

	it('records the binding under the output name', () => {
		const graph = promoteAiOutput(promotableGraph(), 'ai', 'plot.png', {
			position: AT,
			nodeId: 'promoted'
		});

		expect(aiAddon(graph).promoted).toEqual({ 'plot.png': 'promoted' });
	});

	it('writes a file block when the output is not an image', () => {
		const graph = promoteAiOutput(promotableGraph(), 'ai', 'table.csv', {
			position: AT,
			nodeId: 'promoted'
		});

		expect(contentOf(graph, 'promoted')).toEqual([
			{ type: 'file', assetId: 'a2', name: 'table.csv' }
		]);
	});

	it('is idempotent per output name while the promoted node exists', () => {
		const once = promoteAiOutput(promotableGraph(), 'ai', 'plot.png', { position: AT });

		expect(promoteAiOutput(once, 'ai', 'plot.png', { position: { x: 900, y: 900 } })).toBe(once);
	});

	it('promotes the name again when its promoted node was deleted', () => {
		const before = promotableGraph({ 'plot.png': 'gone-node' });
		const graph = promoteAiOutput(before, 'ai', 'plot.png', { position: AT, nodeId: 'fresh' });

		expect(aiAddon(graph).promoted).toEqual({ 'plot.png': 'fresh' });
		expect(contentOf(graph, 'fresh')).toEqual([{ type: 'image', assetId: 'a1', alt: 'plot.png' }]);
	});

	it('returns the same graph when the latest done run did not produce that name', () => {
		const before = promotableGraph();

		expect(promoteAiOutput(before, 'ai', 'drift.png', { position: AT })).toBe(before);
	});

	it('reads the latest done run rather than a cancelled attempt after it', () => {
		const before = graphWithAi({
			runs: [
				makeRun({ id: 'r1', outputs: [makeOutput('plot.png', 'a1')] }),
				makeRun({ id: 'r2', status: 'cancelled', outputs: [] })
			]
		});

		expect(contentOf(promoteAiOutput(before, 'ai', 'plot.png', { position: AT }), 'n0')).toEqual([
			{ type: 'image', assetId: 'a1', alt: 'plot.png' }
		]);
	});

	it('names the new node itself when the caller’s id is already taken', () => {
		const graph = promoteAiOutput(promotableGraph(), 'ai', 'plot.png', {
			position: AT,
			nodeId: 'ai'
		});

		expect(aiAddon(graph).promoted).toEqual({ 'plot.png': 'n0' });
		expect(graph.nodes.map((node) => node.id)).toEqual(['ai', 'n0']);
	});

	it('returns the same graph object for a node without the add-on', () => {
		const before = makeGraph({ nodeCount: 1 });

		expect(promoteAiOutput(before, 'n0', 'plot.png', { position: AT })).toBe(before);
	});

	it('does not mutate the graph it was handed', () => {
		const before = promotableGraph();
		promoteAiOutput(before, 'ai', 'plot.png', { position: AT });

		expect(before.nodes).toHaveLength(1);
		expect(before.edges).toEqual([]);
		expect(aiAddon(before).promoted).toEqual({});
	});

	it('leaves the promoted node ready for the next run to refresh in place', () => {
		const promoted = promoteAiOutput(promotableGraph(), 'ai', 'plot.png', {
			position: AT,
			nodeId: 'promoted'
		});
		const ai = aiAddon(promoted);
		const withNewRun: MultigraphData = {
			...promoted,
			nodes: promoted.nodes.map((node) =>
				node.id === 'ai'
					? {
							...node,
							addons: {
								...node.addons,
								ai: {
									...ai,
									runs: [...ai.runs, makeRun({ id: 'r2', outputs: [makeOutput('plot.png', 'a9')] })]
								}
							}
						}
					: node
			)
		};

		const { graph, staleOutputNames } = refreshPromotedOutputs(withNewRun, 'ai');

		expect(staleOutputNames).toEqual([]);
		expect(contentOf(graph, 'promoted')).toEqual([
			{ type: 'image', assetId: 'a9', alt: 'plot.png' }
		]);
	});
});

describe('refreshPromotedOutputs', () => {
	/**
	 * An AI node whose latest run produced `plot.png` as `a2`, bound to a promoted
	 * node still showing `a1` from the run before.
	 */
	function twoRunGraph(latest: AiRunOutput = makeOutput('plot.png', 'a2')): MultigraphData {
		return graphWithAi(
			{
				runs: [
					makeRun({ id: 'r1', outputs: [makeOutput('plot.png', 'a1')] }),
					makeRun({ id: 'r2', outputs: [latest] })
				],
				promoted: { 'plot.png': 'promoted' }
			},
			[
				{
					id: 'promoted',
					title: 'plot.png',
					content: [{ type: 'image', assetId: 'a1', alt: 'plot.png' }]
				}
			]
		);
	}

	it('judges staleness by the latest done run, not a cancelled one after it', () => {
		const graph = twoRunGraph();
		const aiNode = graph.nodes.find((node) => node.id === 'ai');
		const ai = aiNode?.addons?.ai;
		if (ai === undefined) throw new Error('fixture has no ai add-on');
		const withCancelled: MultigraphData = {
			...graph,
			nodes: graph.nodes.map((node) =>
				node.id === 'ai'
					? {
							...node,
							addons: {
								...node.addons,
								ai: {
									...ai,
									runs: [...ai.runs, makeRun({ id: 'r3', status: 'cancelled', outputs: [] })]
								}
							}
						}
					: node
			)
		};

		const { graph: refreshed, staleOutputNames } = refreshPromotedOutputs(withCancelled, 'ai');

		expect(staleOutputNames).toEqual([]);
		expect(contentOf(refreshed, 'promoted')).toEqual([
			{ type: 'image', assetId: 'a2', alt: 'plot.png' }
		]);
	});

	it('swaps the promoted node’s image for the one the latest run produced', () => {
		const { graph, staleOutputNames } = refreshPromotedOutputs(twoRunGraph(), 'ai');

		expect(contentOf(graph, 'promoted')).toEqual([
			{ type: 'image', assetId: 'a2', alt: 'plot.png' }
		]);
		expect(staleOutputNames).toEqual([]);
	});

	it('writes a file block when the output is not an image', () => {
		const graph = refreshPromotedOutputs(
			twoRunGraph(makeOutput('plot.png', 'a2', 'text/csv')),
			'ai'
		).graph;

		expect(contentOf(graph, 'promoted')).toEqual([
			{ type: 'file', assetId: 'a2', name: 'plot.png' }
		]);
	});

	it('keeps a caption the reader wrote on the promoted block', () => {
		const before = twoRunGraph();
		const withCaption: MultigraphData = {
			...before,
			nodes: before.nodes.map((node) =>
				node.id === 'promoted'
					? {
							...node,
							content: [{ type: 'image', assetId: 'a1', alt: 'plot.png', caption: 'March' }]
						}
					: node
			)
		};

		expect(contentOf(refreshPromotedOutputs(withCaption, 'ai').graph, 'promoted')).toEqual([
			{ type: 'image', assetId: 'a2', alt: 'plot.png', caption: 'March' }
		]);
	});

	it('leaves the promoted node alone and reports the name stale when the run did not produce it', () => {
		const before = graphWithAi(
			{
				runs: [
					makeRun({ id: 'r1', outputs: [makeOutput('plot.png', 'a1')] }),
					makeRun({ id: 'r2', outputs: [makeOutput('other.png', 'a9')] })
				],
				promoted: { 'plot.png': 'promoted' }
			},
			[
				{
					id: 'promoted',
					title: 'plot.png',
					content: [{ type: 'image', assetId: 'a1', alt: 'plot.png' }]
				}
			]
		);
		const { graph, staleOutputNames } = refreshPromotedOutputs(before, 'ai');

		expect(staleOutputNames).toEqual(['plot.png']);
		expect(contentOf(graph, 'promoted')).toEqual([
			{ type: 'image', assetId: 'a1', alt: 'plot.png' }
		]);
		expect(graph).toBe(before);
	});

	it('calls every binding stale when the node has no runs yet', () => {
		const before = graphWithAi({ promoted: { 'plot.png': 'promoted' } }, [
			{ id: 'promoted', title: 'plot.png' }
		]);

		expect(refreshPromotedOutputs(before, 'ai').staleOutputNames).toEqual(['plot.png']);
	});

	it('drops a binding whose promoted node was deleted', () => {
		const before = graphWithAi({
			runs: [makeRun({ id: 'r1', outputs: [makeOutput('plot.png', 'a1')] })],
			promoted: { 'plot.png': 'gone-node' }
		});
		const { graph, staleOutputNames } = refreshPromotedOutputs(before, 'ai');

		expect(aiAddon(graph).promoted).toEqual({});
		expect(staleOutputNames).toEqual([]);
	});

	it('keeps the surviving bindings when it drops a dead one', () => {
		const before = graphWithAi(
			{
				runs: [
					makeRun({
						id: 'r1',
						outputs: [makeOutput('plot.png', 'a1'), makeOutput('table.csv', 'a2', 'text/csv')]
					})
				],
				promoted: { 'plot.png': 'promoted', 'table.csv': 'gone-node' }
			},
			[
				{
					id: 'promoted',
					title: 'plot.png',
					content: [{ type: 'image', assetId: 'a1', alt: 'plot.png' }]
				}
			]
		);

		expect(aiAddon(refreshPromotedOutputs(before, 'ai').graph).promoted).toEqual({
			'plot.png': 'promoted'
		});
	});

	it('changes nothing the second time, so a re-commit is not an edit', () => {
		const once = refreshPromotedOutputs(twoRunGraph(), 'ai').graph;

		expect(refreshPromotedOutputs(once, 'ai').graph).toBe(once);
	});

	it('returns the same graph object when there is nothing bound', () => {
		const before = graphWithAi({ runs: [makeRun({ id: 'r1' })] });
		const { graph, staleOutputNames } = refreshPromotedOutputs(before, 'ai');

		expect(graph).toBe(before);
		expect(staleOutputNames).toEqual([]);
	});

	it('leaves a promoted node the reader emptied alone rather than pushing a block back', () => {
		const before = twoRunGraph();
		const emptied: MultigraphData = {
			...before,
			nodes: before.nodes.map((node) => (node.id === 'promoted' ? { ...node, content: [] } : node))
		};
		const { graph } = refreshPromotedOutputs(emptied, 'ai');

		expect(contentOf(graph, 'promoted')).toEqual([]);
		expect(graph).toBe(emptied);
	});

	it('touches only the block that holds an output of this name', () => {
		const before = twoRunGraph();
		const withExtras: MultigraphData = {
			...before,
			nodes: before.nodes.map((node) =>
				node.id === 'promoted'
					? {
							...node,
							content: [
								{ type: 'file', assetId: 'notes', name: 'notes.txt' },
								{ type: 'image', assetId: 'a1', alt: 'plot.png' }
							]
						}
					: node
			)
		};

		expect(contentOf(refreshPromotedOutputs(withExtras, 'ai').graph, 'promoted')).toEqual([
			{ type: 'file', assetId: 'notes', name: 'notes.txt' },
			{ type: 'image', assetId: 'a2', alt: 'plot.png' }
		]);
	});

	it('returns the same graph object for a node without the add-on', () => {
		const before = makeGraph({ nodeCount: 1 });
		const { graph, staleOutputNames } = refreshPromotedOutputs(before, 'n0');

		expect(graph).toBe(before);
		expect(staleOutputNames).toEqual([]);
	});

	it('does not mutate the graph it was handed', () => {
		const before = twoRunGraph();
		refreshPromotedOutputs(before, 'ai');

		expect(contentOf(before, 'promoted')).toEqual([
			{ type: 'image', assetId: 'a1', alt: 'plot.png' }
		]);
	});
});
