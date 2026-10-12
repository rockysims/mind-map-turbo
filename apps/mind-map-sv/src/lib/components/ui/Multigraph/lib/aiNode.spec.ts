import { describe, expect, it } from 'vitest';
import {
	AI_RUN_STATUSES,
	aiResultMath,
	createFollowUpNode,
	inheritedScript,
	isAiRunStatus,
	isSubmittableFollowUpPrompt,
	markInterruptedRuns,
	promoteAiOutput,
	recordAiRun,
	refreshPromotedOutputs,
	replaceAiRun,
	setAiModel,
	setAiPrompt,
	setAiScript
} from './aiNode';
import { collectAiInputs } from './aiInputs';
import { removeNode, setNodePinned } from './graph';
import { makeGraph } from './testFixtures';
import type { GraphAssetMetadata, MultigraphData, Point } from '../../types/multigraph';
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

describe('setAiModel', () => {
	it('pins the node to the chosen model', () => {
		const graph = setAiModel(graphWithAi(), 'ai', 'claude-sonnet-5');

		expect(aiAddon(graph).model).toBe('claude-sonnet-5');
	});

	it('clears the pin, so the node follows the app-wide choice again', () => {
		const before = graphWithAi({ model: 'claude-sonnet-5' });
		const after = setAiModel(before, 'ai', undefined);

		// Absent, not `undefined`: the add-on round-trips through JSON, where only
		// the absent field survives unchanged.
		expect('model' in aiAddon(after)).toBe(false);
	});

	it('returns the same graph object when the pin is unchanged', () => {
		const before = graphWithAi({ model: 'claude-opus-5' });

		expect(setAiModel(before, 'ai', 'claude-opus-5')).toBe(before);
	});

	it('returns the same graph object when an unpinned node is cleared', () => {
		const before = graphWithAi();

		expect(setAiModel(before, 'ai', undefined)).toBe(before);
	});

	it('returns the same graph object for a node without the add-on', () => {
		const before = makeGraph({ nodeCount: 1 });

		expect(setAiModel(before, 'n0', 'claude-sonnet-5')).toBe(before);
	});

	it('does not mutate the graph it was handed', () => {
		const before = graphWithAi({ model: 'claude-opus-5' });
		setAiModel(before, 'ai', 'claude-sonnet-5');

		expect(aiAddon(before).model).toBe('claude-opus-5');
	});

	it('leaves the prompt, script, runs and promoted bindings alone', () => {
		const before = graphWithAi({
			prompt: 'plot it',
			script: 'print(1)',
			runs: [makeRun({ id: 'r1' })],
			promoted: { 'plot.png': 'promoted' }
		});
		const after = setAiModel(before, 'ai', 'claude-sonnet-5');

		expect(aiAddon(after).prompt).toBe('plot it');
		expect(aiAddon(after).script).toBe('print(1)');
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

	/*
	 * The two halves of "the reader deleted the promoted node" meeting: the
	 * deletion takes the binding with it, and the next press is an ordinary
	 * promote onto a new node rather than a no-op onto a node that is gone.
	 */
	it('promotes onto a fresh node after the promoted node was removed from the graph', () => {
		const promoted = promoteAiOutput(promotableGraph(), 'ai', 'plot.png', {
			position: AT,
			nodeId: 'first'
		});

		const deleted = removeNode(promoted, 'first');
		expect(aiAddon(deleted).promoted).toEqual({});
		expect(deleted.edges).toHaveLength(0);

		const again = promoteAiOutput(deleted, 'ai', 'plot.png', { position: AT, nodeId: 'second' });
		expect(aiAddon(again).promoted).toEqual({ 'plot.png': 'second' });
		expect(contentOf(again, 'second')).toEqual([{ type: 'image', assetId: 'a1', alt: 'plot.png' }]);
		expect(again.edges).toHaveLength(1);
		expect(again.edges[0]).toMatchObject({ sourceNodeId: 'ai', targetNodeId: 'second' });
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

describe('isSubmittableFollowUpPrompt', () => {
	it('accepts a prompt with a question in it', () => {
		expect(isSubmittableFollowUpPrompt('now fit a line')).toBe(true);
	});

	it('refuses an empty prompt', () => {
		expect(isSubmittableFollowUpPrompt('')).toBe(false);
	});

	it('refuses a prompt of nothing but whitespace, which is the one a stray press sends', () => {
		expect(isSubmittableFollowUpPrompt('  \n\t ')).toBe(false);
	});
});

describe('createFollowUpNode', () => {
	const POSITION: Point = { x: 120, y: -40 };
	const PROMPT = 'now fit a line to the cleaned data';

	/** A lone `!ai` parent, at whatever the case needs it to be. */
	function parentGraph(addon: Partial<AiAddon> = {}): MultigraphData {
		return makeGraph({
			nodes: [
				{
					id: 'ai',
					title: '!ai Analysis',
					description: '',
					addons: { ai: { prompt: 'clean the sweeps', runs: [], promoted: {}, ...addon } }
				}
			]
		});
	}

	function nodeOf(graph: MultigraphData, nodeId: string): NodeData {
		const node = graph.nodes.find((candidate) => candidate.id === nodeId);
		if (node === undefined) throw new Error(`expected the graph to hold a node ${nodeId}`);
		return node;
	}

	/** The one call, for the cases that expect a child, with the child resolved. */
	function followUp(
		data: MultigraphData,
		options: { prompt?: string; position?: Point; nodeId?: string } = {}
	): { graph: MultigraphData; child: NodeData } {
		const result = createFollowUpNode(data, 'ai', {
			prompt: options.prompt ?? PROMPT,
			position: options.position ?? POSITION,
			...(options.nodeId === undefined ? {} : { nodeId: options.nodeId })
		});
		if (result.nodeId === undefined) throw new Error('expected a follow-up node to be created');
		return { graph: result.graph, child: nodeOf(result.graph, result.nodeId) };
	}

	it('gives the child the add-on at its registry default, with the composed prompt in it', () => {
		expect(followUp(parentGraph()).child.addons?.ai).toEqual({
			prompt: PROMPT,
			runs: [],
			promoted: {}
		});
	});

	it('titles the child so the marker survives a rename and the canvas has a word to draw', () => {
		const { child } = followUp(parentGraph());

		expect(child.title).toBe('!ai Follow-up');
		expect(child.description).toBe('');
	});

	it('stores the prompt trimmed', () => {
		expect(followUp(parentGraph(), { prompt: `\n  ${PROMPT}  \n` }).child.addons?.ai?.prompt).toBe(
			PROMPT
		);
	});

	it('places the child where the caller said, because placement is the caller’s', () => {
		const { graph, child } = followUp(parentGraph());

		expect(graph.posByNodeId[child.id]).toEqual(POSITION);
	});

	it('joins the two with one directed, untagged edge from the parent', () => {
		const { graph, child } = followUp(parentGraph());

		expect(graph.edges).toEqual([
			{
				id: expect.any(String),
				sourceNodeId: 'ai',
				targetNodeId: child.id,
				tags: [],
				directed: true
			}
		]);
	});

	it('takes the id the caller named', () => {
		expect(followUp(parentGraph(), { nodeId: 'child' }).child.id).toBe('child');
	});

	it('generates an id rather than colliding when the named one is taken', () => {
		expect(followUp(parentGraph(), { nodeId: 'ai' }).child.id).not.toBe('ai');
	});

	it('leaves the parent’s own add-on data untouched', () => {
		const before = parentGraph({ script: 'print(1)' });

		expect(nodeOf(followUp(before).graph, 'ai').addons?.ai).toEqual(
			nodeOf(before, 'ai').addons?.ai
		);
	});

	it('makes a second child on a second call — two questions are two nodes', () => {
		const first = followUp(parentGraph());
		const second = followUp(first.graph);

		expect(second.child.id).not.toBe(first.child.id);
		expect(second.graph.nodes).toHaveLength(3);
		expect(second.graph.edges).toHaveLength(2);
	});

	it('returns the same graph object for an unknown parent', () => {
		const before = parentGraph();
		const result = createFollowUpNode(before, 'nope', { prompt: PROMPT, position: POSITION });

		expect(result.graph).toBe(before);
		expect(result.nodeId).toBeUndefined();
	});

	it('returns the same graph object for a parent without the add-on', () => {
		const before = makeGraph({ nodeCount: 1 });
		const result = createFollowUpNode(before, 'n0', { prompt: PROMPT, position: POSITION });

		expect(result.graph).toBe(before);
		expect(result.nodeId).toBeUndefined();
	});

	it('returns the same graph object for an empty prompt, so the rule holds at the mutation', () => {
		const before = parentGraph();
		const result = createFollowUpNode(before, 'ai', { prompt: '', position: POSITION });

		expect(result.graph).toBe(before);
		expect(result.nodeId).toBeUndefined();
	});

	it('returns the same graph object for a prompt of nothing but whitespace', () => {
		const before = parentGraph();
		const result = createFollowUpNode(before, 'ai', { prompt: ' \n\t ', position: POSITION });

		expect(result.graph).toBe(before);
		expect(result.nodeId).toBeUndefined();
	});

	it('does not mutate the graph it was handed', () => {
		const before = parentGraph();
		followUp(before);

		expect(before.nodes).toHaveLength(1);
		expect(before.edges).toEqual([]);
	});

	describe('the pin transfer', () => {
		it('moves the pin off the parent and onto the child, in the one returned graph', () => {
			const { graph, child } = followUp(setNodePinned(parentGraph(), 'ai', true));

			expect(nodeOf(graph, 'ai').pinned).toBe(false);
			expect(child.pinned).toBe(true);
		});

		it('stamps the child last, so the beacon follows the reader rather than the unpinned parent', () => {
			const { graph, child } = followUp(setNodePinned(parentGraph(), 'ai', true));
			const parentSeq = nodeOf(graph, 'ai').lastPinnedSeq ?? 0;

			expect(child.lastPinnedSeq ?? 0).toBeGreaterThan(parentSeq);
			expect(graph.pinSequence).toBe(child.lastPinnedSeq);
		});

		it('leaves the child unpinned and the pin counter untouched when the parent was not pinned', () => {
			const before = parentGraph();
			const { graph, child } = followUp(before);

			expect(child.pinned).toBeUndefined();
			expect(child.lastPinnedSeq).toBeUndefined();
			expect(nodeOf(graph, 'ai').lastPinnedSeq).toBe(nodeOf(before, 'ai').lastPinnedSeq);
			expect(graph.pinSequence).toBe(before.pinSequence);
		});

		it('transfers exactly one pin from a parent pinned, unpinned and pinned again', () => {
			const pinnedTwiceOver = setNodePinned(
				setNodePinned(setNodePinned(parentGraph(), 'ai', true), 'ai', false),
				'ai',
				true
			);
			const { graph, child } = followUp(pinnedTwiceOver);

			expect(graph.nodes.filter((node) => node.pinned === true).map((node) => node.id)).toEqual([
				child.id
			]);
			expect(child.lastPinnedSeq ?? 0).toBeGreaterThan(nodeOf(graph, 'ai').lastPinnedSeq ?? 0);
		});
	});

	it('makes the child an outgoing neighbour, so it never feeds the run that spawned it', () => {
		const { graph, child } = followUp(parentGraph());

		expect(collectAiInputs(graph, 'ai')).toEqual([]);
		expect(collectAiInputs(graph, child.id).map((input) => input.nodeId)).toEqual(['ai']);
	});
});

describe('inheritedScript', () => {
	/** How a case joins its parents to the child, when the default will not do. */
	type ChainEdge = { source: string; target: string; directed: boolean };

	/** A `child` node, its parents, and whatever edges the case is about. */
	function chain(
		parents: Array<{ id: string; script?: string; ai?: boolean }>,
		edges?: ChainEdge[]
	): MultigraphData {
		return makeGraph({
			nodes: [
				...parents.map((parent) => ({
					id: parent.id,
					title: parent.id,
					description: '',
					...(parent.ai === false
						? {}
						: {
								addons: {
									ai: {
										prompt: '',
										runs: [],
										promoted: {},
										...(parent.script === undefined ? {} : { script: parent.script })
									}
								}
							})
				})),
				{
					id: 'child',
					title: '!ai Follow-up',
					description: '',
					addons: { ai: { prompt: 'and now?', runs: [], promoted: {} } }
				}
			],
			edges:
				edges ?? parents.map((parent) => ({ source: parent.id, target: 'child', directed: true }))
		});
	}

	it('has nothing to inherit for a node with no parent at all', () => {
		expect(inheritedScript(chain([]), 'child')).toBeUndefined();
	});

	it('has nothing to inherit from a parent that is not an ai node', () => {
		expect(inheritedScript(chain([{ id: 'notes', ai: false }]), 'child')).toBeUndefined();
	});

	it('has nothing to inherit from an ai parent that has not written a script yet', () => {
		expect(inheritedScript(chain([{ id: 'parent' }]), 'child')).toBeUndefined();
	});

	it('inherits the direct parent’s stored analysis.py', () => {
		expect(inheritedScript(chain([{ id: 'parent', script: 'print(1)' }]), 'child')).toBe(
			'print(1)'
		);
	});

	it('resolves two ai parents in graph.nodes order, not edge order', () => {
		const parents = [
			{ id: 'first', script: 'print(1)' },
			{ id: 'second', script: 'print(2)' }
		];

		expect(inheritedScript(chain(parents), 'child')).toBe('print(1)');
		expect(inheritedScript(chain([...parents].reverse()), 'child')).toBe('print(2)');
	});

	it('passes over a parent with no script for one that has it', () => {
		const graph = chain([{ id: 'first' }, { id: 'second', script: 'print(2)' }]);

		expect(inheritedScript(graph, 'child')).toBe('print(2)');
	});

	it('does not reach past the direct parent to a grandparent’s script', () => {
		const graph = makeGraph({
			nodes: [
				{
					id: 'grandparent',
					title: 'g',
					description: '',
					addons: { ai: { prompt: '', runs: [], promoted: {}, script: 'print(1)' } }
				},
				{
					id: 'parent',
					title: 'p',
					description: '',
					addons: { ai: { prompt: '', runs: [], promoted: {} } }
				},
				{
					id: 'child',
					title: 'c',
					description: '',
					addons: { ai: { prompt: '', runs: [], promoted: {} } }
				}
			],
			edges: [
				{ source: 'grandparent', target: 'parent', directed: true },
				{ source: 'parent', target: 'child', directed: true }
			]
		});

		expect(inheritedScript(graph, 'child')).toBeUndefined();
	});

	/*
	 * `aiInputs.ts` keeps its adjacency predicate private, so `inheritedScript`
	 * restates the rule until T04 exports the one copy. This is the guard against
	 * the two drifting in the meantime: a neighbour that contributes files is
	 * exactly a neighbour that contributes a script.
	 */
	describe('is the rule collectAiInputs uses, over all four edge orientations', () => {
		const ORIENTATIONS = [
			{ name: 'an edge pointing at the node', source: 'parent', directed: true, feeds: true },
			{ name: 'an edge pointing away from it', source: 'child', directed: true, feeds: false },
			{ name: 'an undirected edge', source: 'parent', directed: false, feeds: true },
			{
				name: 'an undirected edge drawn the other way round',
				source: 'child',
				directed: false,
				feeds: true
			}
		];

		for (const orientation of ORIENTATIONS) {
			it(`${orientation.name} ${orientation.feeds ? 'contributes' : 'contributes nothing'}`, () => {
				const graph = chain(
					[{ id: 'parent', script: 'print(1)' }],
					[
						{
							source: orientation.source,
							target: orientation.source === 'parent' ? 'child' : 'parent',
							directed: orientation.directed
						}
					]
				);
				const feedsInputs = collectAiInputs(graph, 'child').some(
					(input) => input.nodeId === 'parent'
				);

				expect(feedsInputs).toBe(orientation.feeds);
				expect(inheritedScript(graph, 'child') !== undefined).toBe(orientation.feeds);
			});
		}
	});
});

// The bridge to the dataflow layer: a run that printed a `RESULT` line makes its
// node a definer of that quantity. The strings are `renderResultTex`'s, so what
// the workbench draws and what the quantity index parses are one string.
describe('aiResultMath', () => {
	function nodeWithRuns(runs: AiRun[]): NodeData {
		return {
			id: 'ai',
			title: 'Analysis',
			description: '',
			tags: [],
			addons: { ai: { prompt: '', runs, promoted: {} } }
		};
	}

	it('reports nothing for a node with no add-on', () => {
		expect(aiResultMath({ id: 'plain', title: 'Notes', description: '', tags: [] })).toEqual([]);
	});

	it('reports nothing for an ai node that has never run', () => {
		expect(aiResultMath(nodeWithRuns([]))).toEqual([]);
	});

	it('reports nothing when the latest run errored', () => {
		expect(
			aiResultMath(nodeWithRuns([makeRun({ id: 'r1', status: 'error', results: [] })]))
		).toEqual([]);
	});

	it('reports nothing for a done run that printed no RESULT line', () => {
		expect(aiResultMath(nodeWithRuns([makeRun({ id: 'r1' })]))).toEqual([]);
	});

	it('renders every result of the latest done run, in order', () => {
		const run = makeRun({
			id: 'r1',
			results: [
				{ symbol: 'R_{th}', value: '12.3', unit: 'K/W' },
				{ symbol: '\\tau', value: '0.8' }
			]
		});
		expect(aiResultMath(nodeWithRuns([run]))).toEqual([
			'R_{th} = 12.3\\ \\text{K/W}',
			'\\tau = 0.8'
		]);
	});

	// The latest *done* run, matching `refreshPromotedOutputs`: a re-run that
	// timed out reported nothing, and must not take the last good answer's
	// arrows off the canvas with it.
	it('reaches past a later errored run to the last done one', () => {
		const graph = [
			makeRun({ id: 'r1', results: [{ symbol: 'g', value: '9.8' }] }),
			makeRun({ id: 'r2', status: 'error' })
		];
		expect(aiResultMath(nodeWithRuns(graph))).toEqual(['g = 9.8']);
	});

	it('prefers the newer done run when both reported', () => {
		expect(
			aiResultMath(
				nodeWithRuns([
					makeRun({ id: 'r1', results: [{ symbol: 'g', value: '9.8' }] }),
					makeRun({ id: 'r2', results: [{ symbol: 'g', value: '9.81' }] })
				])
			)
		).toEqual(['g = 9.81']);
	});

	// Identity, not just emptiness: the dataflow layer skips wrapping a node whose
	// answer is this array, and that skip is what keeps a drag from allocating a
	// graph's worth of objects per frame.
	it('hands every empty answer the same array', () => {
		expect(aiResultMath(nodeWithRuns([]))).toBe(
			aiResultMath({ id: 'plain', title: 'Notes', description: '', tags: [] })
		);
	});
});
