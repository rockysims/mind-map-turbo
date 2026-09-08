/**
 * The run loop, driven by the fake client and the fake executor.
 *
 * Everything the controller talks to is an interface, so nothing here needs a
 * browser, a key or a network: the fakes answer instantly and record what they
 * were asked, and the assertions are about the graph that got committed and the
 * state the workbench would have drawn.
 */

import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { APP_CONFIG } from '$lib/appConfig';
import type { AiRequest, AiTurn } from '$lib/ai/aiClient';
import { createFakeAiClient } from '$lib/ai/fakeClient';
import { createFakeExecutor } from '$lib/ai/fakeExecutor';
import { PyExecutorError, type ExecutionResult } from '$lib/ai/pyExecutor';
import { defaultAiSettings, type AiSettings } from '$lib/ai/aiSettings';
import type { MeasuredFileDigest } from '$lib/ai/probeScript';
import { MemoryGraphAssetStore } from '$lib/assets/assetStore';
import type { GraphAssetStore } from '$lib/assets/assetStore';
import type { MultigraphData } from '../../types/multigraph';
import type { AiAddon, AiRun } from '../../types/node';
import { promoteAiOutput } from './aiNode';
import { collectAiInputs } from './aiInputs';
import { inputChangesForAddon } from './aiWorkbenchView';
import {
	AI_RUN_COMMIT_LABEL,
	createAiRunController,
	type AiRunController
} from './aiRunController.svelte';
import { makeGraph } from './testFixtures';

const SCOPE = 'run-spec';
const CSV_ASSET_ID = 'csv-asset';
const CSV_TEXT = 't,ch2\n0,1\n1,2\n';

/** A graph with one `!ai` node and one neighbour carrying a CSV that feeds it. */
function baseGraph(addon: Partial<AiAddon> = {}): MultigraphData {
	return {
		...makeGraph({
			nodes: [
				{
					id: 'ai',
					title: 'Analysis',
					description: '',
					addons: { ai: { prompt: 'Plot channel 2.', runs: [], promoted: {}, ...addon } }
				},
				{
					id: 'data',
					title: 'Sweep',
					description: 'Taken at 21 °C.',
					content: [{ type: 'file', assetId: CSV_ASSET_ID, name: 'sweep.csv' }]
				}
			],
			edges: [{ source: 'data', target: 'ai', directed: true, tags: ['baseline'] }]
		}),
		assets: {
			[CSV_ASSET_ID]: {
				id: CSV_ASSET_ID,
				kind: 'file',
				mimeType: 'text/csv',
				name: 'sweep.csv',
				size: CSV_TEXT.length,
				createdAt: 1
			}
		}
	};
}

const GHOST_ASSET_ID = 'ghost-asset';

/**
 * The same graph with a second file attached whose blob is not in the store —
 * the mixed case, where one file has a digest and the other cannot.
 */
function graphWithAGhostFile(): MultigraphData {
	const graph = baseGraph();
	return {
		...graph,
		nodes: graph.nodes.map((node) =>
			node.id === 'data'
				? {
						...node,
						content: [
							...(node.content ?? []),
							{ type: 'file', assetId: GHOST_ASSET_ID, name: 'ghost.csv' }
						]
					}
				: node
		),
		assets: {
			...graph.assets,
			[GHOST_ASSET_ID]: {
				id: GHOST_ASSET_ID,
				kind: 'file',
				mimeType: 'text/csv',
				name: 'ghost.csv',
				size: 99,
				createdAt: 2
			}
		}
	};
}

async function storeWithCsv(): Promise<GraphAssetStore> {
	const store = new MemoryGraphAssetStore();
	await store.put({
		scope: SCOPE,
		assetId: CSV_ASSET_ID,
		blob: new Blob([CSV_TEXT], { type: 'text/csv' }),
		mimeType: 'text/csv',
		name: 'sweep.csv',
		size: CSV_TEXT.length,
		updatedAt: 1
	});
	return store;
}

/** An assistant turn that asks for one script run. */
function toolTurn(script: string, id = 'tool-1'): AiTurn {
	const block: Anthropic.ToolUseBlock = {
		type: 'tool_use',
		id,
		name: 'run_analysis',
		caller: { type: 'direct' },
		input: { script }
	};
	return {
		content: [{ type: 'text', text: 'Writing the script.', citations: null }, block],
		stopReason: 'tool_use',
		usage: { inputTokens: 100, outputTokens: 20 },
		model: 'claude-opus-5'
	};
}

/** An assistant turn that finishes with a summary. */
function endTurn(summary: string): AiTurn {
	return {
		content: [{ type: 'text', text: summary, citations: null }],
		stopReason: 'end_turn',
		usage: { inputTokens: 200, outputTokens: 40 },
		model: 'claude-opus-5'
	};
}

/** What a stored script that no longer matches its data prints. */
const FAILING_TRACEBACK =
	'Traceback (most recent call last):\n  File "analysis.py", line 3\nKeyError: \'ch2\'';

/** The prompt half of a request: the first user message, which is always text. */
function userText(request: AiRequest): string {
	const content = request.messages[0]?.content;
	return typeof content === 'string' ? content : '';
}

function pngResult(name: string, exitCode = 0): ExecutionResult {
	return {
		exitCode,
		stdout: 'wrote a figure\n',
		stderr: '',
		durationMs: 12,
		outputs: [{ name, mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3, 4]) }]
	};
}

interface HarnessOptions {
	graph?: MultigraphData;
	turns?: AiTurn[];
	script?: (code: string) => ExecutionResult | Promise<ExecutionResult>;
	settings?: Partial<AiSettings>;
	/** `null` for the no-key case. */
	withClient?: boolean;
	store?: GraphAssetStore | null;
	/** Make `executor.load` reject, as it does with no network to fetch Pyodide from. */
	loadFails?: boolean;
	/**
	 * What the probe answers, named as the executor wrote each file. Defaults to
	 * the one CSV `baseGraph` attaches.
	 */
	digests?: MeasuredFileDigest[];
}

/** The controller with fakes underneath and every commit remembered. */
async function harness(options: HarnessOptions = {}) {
	const commits: { graph: MultigraphData; label: string }[] = [];
	let graph = options.graph ?? baseGraph();
	const client = createFakeAiClient(options.turns ?? [endTurn('Nothing to do.')]);
	const executor = createFakeExecutor(
		options.script ?? (() => pngResult('plot.png')),
		options.digests ?? [
			{ name: 'sweep.csv', size: CSV_TEXT.length, kind: 'table', columns: ['t', 'ch2'], rows: 2 }
		]
	);
	// Replaced rather than parameterised: the fake's whole job is to load, and
	// the one case that needs it not to is this one.
	if (options.loadFails === true) {
		executor.load = async () => {
			throw new PyExecutorError('load-failed', 'The Python runtime could not be loaded.');
		};
	}
	const store = options.store === undefined ? await storeWithCsv() : options.store;
	const settings: AiSettings = { ...defaultAiSettings(), ...options.settings };

	let nextId = 0;
	const controller = createAiRunController({
		client: () => (options.withClient === false ? null : client),
		executor: () => executor,
		assetStore: () => store,
		assetScope: () => SCOPE,
		graph: () => graph,
		commit: (next, label) => {
			graph = next;
			commits.push({ graph: next, label });
		},
		settings: () => settings,
		now: () => 1_700_000_000_000,
		randomId: () => `id-${(nextId += 1)}`
	});

	return {
		controller,
		client,
		executor,
		store,
		commits,
		get graph() {
			return graph;
		},
		runs(): AiRun[] {
			return graph.nodes.find((node) => node.id === 'ai')?.addons?.ai?.runs ?? [];
		},
		addon(): AiAddon | undefined {
			return graph.nodes.find((node) => node.id === 'ai')?.addons?.ai;
		}
	};
}

/**
 * Wait for something a run in flight will do. The runs that never settle are
 * exactly the cases worth testing, so nothing here may await the run itself.
 */
async function until(predicate: () => boolean, what: string): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
	throw new Error(`timed out waiting for ${what}`);
}

describe('createAiRunController', () => {
	it('commits exactly one run for a success path with two tool calls', async () => {
		const scripts: string[] = [];
		const h = await harness({
			turns: [
				toolTurn('print("first")', 'tool-1'),
				toolTurn('print("second")', 'tool-2'),
				endTurn('Channel 2 drifts upward.')
			],
			script: (code) => {
				scripts.push(code);
				// The first attempt fails; the second is the one the node keeps.
				return scripts.length === 1
					? { exitCode: 1, stdout: '', stderr: 'Traceback', durationMs: 3, outputs: [] }
					: pngResult('plot.png');
			}
		});

		const outcome = await h.controller.run('ai', 'analyse');

		expect(outcome).toBe('done');
		expect(scripts).toEqual(['print("first")', 'print("second")']);
		expect(h.commits.map((commit) => commit.label)).toEqual([
			AI_RUN_COMMIT_LABEL,
			AI_RUN_COMMIT_LABEL
		]);

		const runs = h.runs();
		expect(runs).toHaveLength(1);
		expect(runs[0]).toMatchObject({
			status: 'done',
			mode: 'analyse',
			model: 'claude-opus-5',
			prompt: 'Plot channel 2.',
			summary: 'Channel 2 drifts upward.',
			toolCalls: 2,
			runtime: APP_CONFIG.ai.runtime.version,
			usage: { inputTokens: 400, outputTokens: 80 }
		});
		// One entry per input the request carried: the neighbour's text and its
		// file. The file's name as well as its id, because that is what the next
		// run compares against to say whether the stored script is still current.
		expect(runs[0].inputs).toEqual([
			{ nodeId: 'data', label: 'baseline' },
			{ nodeId: 'data', assetId: CSV_ASSET_ID, name: 'sweep.csv', label: 'baseline' }
		]);
	});

	it('stores each output as an asset with metadata and keeps the last working script', async () => {
		const h = await harness({
			turns: [toolTurn('print("ok")'), endTurn('Done.')],
			script: () => ({
				exitCode: 0,
				stdout: '',
				stderr: '',
				durationMs: 5,
				outputs: [
					{ name: 'plot.png', mimeType: 'image/png', bytes: new Uint8Array([9, 9]) },
					{ name: 'clean.csv', mimeType: 'text/csv', bytes: new Uint8Array([44, 44, 44]) }
				]
			})
		});

		await h.controller.run('ai', 'analyse');

		const addon = h.addon();
		expect(addon?.script).toBe('print("ok")');
		const outputs = addon?.runs[0].outputs ?? [];
		expect(outputs).toEqual([
			{ name: 'plot.png', assetId: 'id-2', mimeType: 'image/png' },
			{ name: 'clean.csv', assetId: 'id-3', mimeType: 'text/csv' }
		]);
		expect(h.graph.assets?.['id-2']).toMatchObject({ kind: 'image', mimeType: 'image/png' });
		expect(h.graph.assets?.['id-3']).toMatchObject({ kind: 'file', name: 'clean.csv', size: 3 });

		const stored = await h.store?.get(SCOPE, 'id-2');
		expect(stored?.ok).toBe(true);
	});

	it('points a promoted node at the figure the next run drew under the same name', async () => {
		const earlier: AiRun = {
			id: 'run-0',
			startedAt: 1,
			finishedAt: 2,
			status: 'done',
			mode: 'analyse',
			runtime: APP_CONFIG.ai.runtime.version,
			inputs: [],
			summary: '',
			outputs: [{ name: 'plot.png', assetId: 'old-plot', mimeType: 'image/png' }],
			toolCalls: 0
		};
		const h = await harness({
			graph: promoteAiOutput(baseGraph({ runs: [earlier] }), 'ai', 'plot.png', {
				position: { x: 0, y: 120 },
				nodeId: 'promoted'
			}),
			turns: [toolTurn('print("redraw")'), endTurn('Redrew it.')],
			script: () => pngResult('plot.png')
		});

		await h.controller.run('ai', 'analyse');

		// One commit, so one undo: the run, its script and the promoted node's new
		// figure land together.
		const promoted = h.graph.nodes.find((node) => node.id === 'promoted');
		expect(promoted?.content).toEqual([{ type: 'image', assetId: 'id-2', alt: 'plot.png' }]);
		expect(h.addon()?.promoted).toEqual({ 'plot.png': 'promoted' });
	});

	it('returns needs-key without committing anything when there is no client', async () => {
		const h = await harness({ withClient: false });

		expect(await h.controller.run('ai', 'analyse')).toBe('needs-key');
		expect(h.commits).toEqual([]);
		expect(h.runs()).toEqual([]);
	});

	it('makes no client call in re-run mode and records a run with no model', async () => {
		const h = await harness({
			graph: baseGraph({ script: 'print("stored")' }),
			script: () => pngResult('plot.png')
		});

		const outcome = await h.controller.run('ai', 'rerun');

		expect(outcome).toBe('done');
		expect(h.client.requests).toEqual([]);
		expect(h.executor.runs.map((call) => call.script)).toEqual(['print("stored")']);

		const run = h.runs()[0];
		expect(run.mode).toBe('rerun');
		expect(run.model).toBeUndefined();
		expect(run.usage).toBeUndefined();
		expect(run.outputs).toHaveLength(1);
	});

	it('keeps a failed re-run’s traceback on the state, where Fix with AI reads it', async () => {
		const h = await harness({
			graph: baseGraph({ script: 'print(frame["ch2"])' }),
			script: () => ({
				exitCode: 1,
				stdout: '',
				stderr: FAILING_TRACEBACK,
				durationMs: 4,
				outputs: []
			})
		});

		expect(await h.controller.run('ai', 'rerun')).toBe('error');

		const state = h.controller.stateFor('ai');
		expect(state.phase).toBe('error');
		expect(state.traceback).toBe(FAILING_TRACEBACK);
		// The sentence stays a sentence; the traceback is the evidence beside it.
		expect(state.error).toBe('The stored script failed with exit code 1.');
		// And the step shows what the script printed, which for a failure is stderr.
		expect(state.steps).toEqual([{ stdoutTail: FAILING_TRACEBACK, exitCode: 1 }]);
	});

	it('sends one refine request carrying that traceback when the fix is asked for', async () => {
		const h = await harness({
			graph: baseGraph({ script: 'print(frame["ch2"])' }),
			turns: [endTurn('Fixed the column name.')],
			script: () => ({
				exitCode: 1,
				stdout: '',
				stderr: FAILING_TRACEBACK,
				durationMs: 4,
				outputs: []
			})
		});
		await h.controller.run('ai', 'rerun');

		expect(await h.controller.runFix('ai')).toBe('done');

		expect(h.client.requests).toHaveLength(1);
		const text = userText(h.client.requests[0]);
		expect(text).toContain(FAILING_TRACEBACK);
		expect(text).toContain('print(frame["ch2"])');

		// Recorded as what it is: an edit to the stored script.
		const fix = h.runs()[1];
		expect(fix.mode).toBe('refine');
		expect(fix.model).toBe('claude-opus-5');
	});

	it('runs a plain refine when the fix is asked for with no traceback in hand', async () => {
		const h = await harness({
			graph: baseGraph({ script: 'print("stored")' }),
			turns: [endTurn('Nothing to fix.')]
		});

		expect(await h.controller.runFix('ai')).toBe('done');

		expect(userText(h.client.requests[0])).not.toContain('failed');
		expect(h.runs()[0].mode).toBe('refine');
	});

	it('tells a refine which files have moved since the stored script was written', async () => {
		// The digests say what is attached now; this says which of them the script
		// has never seen, which is the part it cannot work out by reading itself.
		const previous: AiRun = {
			id: 'r1',
			startedAt: 1,
			finishedAt: 2,
			status: 'done',
			mode: 'analyse',
			prompt: 'Plot channel 2.',
			runtime: APP_CONFIG.ai.runtime.version,
			inputs: [{ nodeId: 'data', assetId: 'gone-asset', name: 'old.csv' }],
			summary: 'Plotted.',
			outputs: [],
			toolCalls: 0
		};
		const h = await harness({
			graph: baseGraph({ script: 'print("stored")', runs: [previous] }),
			turns: [endTurn('Updated for the new file.')]
		});

		expect(await h.controller.run('ai', 'refine')).toBe('done');

		expect(userText(h.client.requests[0])).toContain(
			'Since this script was written these files were added: sweep.csv; removed: old.csv. ' +
				'Update the script to use the current files.'
		);
	});

	it('records a cancelled run with no outputs when the run is cancelled mid-script', async () => {
		const h = await harness({
			turns: [toolTurn('print("slow")'), endTurn('never reached')],
			// Never settles on its own: the cancel is what ends it.
			script: () => new Promise<ExecutionResult>(() => {})
		});

		const running = h.controller.run('ai', 'analyse');
		await until(() => h.executor.runs.length === 1, 'the script to start');
		h.controller.cancel('ai');

		expect(await running).toBe('cancelled');
		const runs = h.runs();
		expect(runs).toHaveLength(1);
		expect(runs[0].status).toBe('cancelled');
		expect(runs[0].outputs).toEqual([]);
		expect(h.addon()?.script).toBeUndefined();
		expect(h.controller.stateFor('ai').phase).toBe('idle');
	});

	it('records an error run when the client fails', async () => {
		const h = await harness({ turns: [] });

		const outcome = await h.controller.run('ai', 'analyse');

		expect(outcome).toBe('error');
		const runs = h.runs();
		expect(runs).toHaveLength(1);
		expect(runs[0].status).toBe('error');
		expect(runs[0].error).toContain('scripted with 0 turns');
		expect(h.controller.stateFor('ai').phase).toBe('error');
	});

	it('ends the loop at the tool-call cap with what ran', async () => {
		const cap = APP_CONFIG.ai.maxToolCalls;
		// One more tool call than the cap allows: only the cap can stop this run.
		const capped = await harness({
			turns: Array.from({ length: cap + 1 }, (_, index) => toolTurn('print(1)', `tool-${index}`)),
			script: () => pngResult('plot.png')
		});

		const outcome = await capped.controller.run('ai', 'analyse');

		expect(outcome).toBe('error');
		expect(capped.executor.runs).toHaveLength(cap);
		const run = capped.runs()[0];
		expect(run.toolCalls).toBe(cap);
		expect(run.error).toBe(
			`Stopped after ${cap} executions without a finished analysis: ` +
				'the last said: wrote a figure.'
		);
		// What ran is kept: the figures and the script that drew them.
		expect(run.outputs).toHaveLength(1);
		expect(capped.addon()?.script).toBe('print(1)');
	});

	it('counts the errors and the timeouts in the message it stops at the cap with', async () => {
		const cap = APP_CONFIG.ai.maxToolCalls;
		let execution = 0;
		const capped = await harness({
			turns: Array.from({ length: cap + 1 }, (_, index) => toolTurn('print(1)', `tool-${index}`)),
			script: () => {
				execution += 1;
				// The last one runs away; every one before it raises.
				if (execution === cap) {
					throw new PyExecutorError('timeout', 'The script ran longer than 300000 ms.');
				}
				return {
					exitCode: 1,
					stdout: '',
					stderr: "KeyError: 'ch2'\n",
					durationMs: 4,
					outputs: []
				};
			}
		});

		expect(await capped.controller.run('ai', 'analyse')).toBe('error');
		// A timeout is an execution the run survived, not the end of it.
		expect(capped.executor.runs).toHaveLength(cap);
		expect(capped.runs()[0].error).toBe(
			`Stopped after ${cap} executions without a finished analysis: ` +
				`${cap - 1} ended in an error, 1 timed out, the last said: ` +
				'The script was stopped after 300000 ms and nothing it printed was kept. ' +
				'Do less in one execution, or work on a sample of the data.'
		);
		// The workbench reads the same sentence off the state.
		expect(capped.controller.stateFor('ai').error).toBe(capped.runs()[0].error);
	});

	it('carries on past a script that ran out of time, telling Claude that it did', async () => {
		let execution = 0;
		const h = await harness({
			turns: [toolTurn('print(1)', 'tool-0'), toolTurn('print(2)', 'tool-1'), endTurn('Done.')],
			script: () => {
				execution += 1;
				if (execution === 1) {
					throw new PyExecutorError('timeout', 'The script ran longer than 300000 ms.');
				}
				return pngResult('plot.png');
			}
		});

		expect(await h.controller.run('ai', 'analyse')).toBe('done');
		expect(h.executor.runs).toHaveLength(2);
		// The timeout went back as the first execution's result, in words.
		expect(JSON.stringify(h.client.requests[1].messages)).toContain('was stopped after 300000 ms');
		expect(h.runs()[0].outputs).toHaveLength(1);
	});

	it('records a refusal as an error run flagged as a refusal', async () => {
		const refusal: AiTurn = {
			content: [],
			stopReason: 'refusal',
			stopDetails: { type: 'refusal', category: 'general_harms', explanation: 'Not this one.' },
			usage: { inputTokens: 10, outputTokens: 0 },
			model: 'claude-opus-5'
		};
		const h = await harness({ turns: [refusal] });

		expect(await h.controller.run('ai', 'analyse')).toBe('error');
		expect(h.runs()[0].error).toBe('Not this one.');
		expect(h.controller.stateFor('ai').refusal).toBe(true);
	});

	it('leaves exactly one interrupted run in the graph while a run never finishes', async () => {
		const h = await harness({
			turns: [toolTurn('print("forever")')],
			script: () => new Promise<ExecutionResult>(() => {})
		});

		void h.controller.run('ai', 'analyse');
		await until(() => h.executor.runs.length === 1, 'the script to start');

		const runs = h.runs();
		expect(runs).toHaveLength(1);
		expect(runs[0]).toMatchObject({
			status: 'interrupted',
			summary: '',
			outputs: [],
			toolCalls: 0
		});
		expect(runs[0].finishedAt).toBeUndefined();
		expect(h.commits).toHaveLength(1);
		expect(h.commits[0].label).toBe(AI_RUN_COMMIT_LABEL);
	});

	it('refuses a second run on a node that already has one in flight', async () => {
		const h = await harness({
			turns: [toolTurn('print("forever")')],
			script: () => new Promise<ExecutionResult>(() => {})
		});

		void h.controller.run('ai', 'analyse');
		await until(() => h.executor.runs.length === 1, 'the script to start');

		expect(await h.controller.run('ai', 'analyse')).toBe('busy');
		expect(h.commits).toHaveLength(1);
	});

	it('sends no image blocks when sendPlots is off', async () => {
		const h = await harness({
			turns: [toolTurn('print("plot")'), endTurn('Done.')],
			script: () => pngResult('plot.png'),
			settings: { sendPlots: false }
		});

		await h.controller.run('ai', 'analyse');

		const second = h.client.requests[1];
		const blocks = second.messages.flatMap((message) =>
			typeof message.content === 'string' ? [] : message.content
		);
		const toolResults = blocks.filter((block) => block.type === 'tool_result');
		expect(toolResults).toHaveLength(1);
		const content = toolResults[0].content;
		expect(Array.isArray(content) && content.every((part) => part.type === 'text')).toBe(true);
	});

	it('sends the rendered plot back when sendPlots is on', async () => {
		const h = await harness({
			turns: [toolTurn('print("plot")'), endTurn('Done.')],
			script: () => pngResult('plot.png')
		});

		await h.controller.run('ai', 'analyse');

		const blocks = h.client.requests[1].messages.flatMap((message) =>
			typeof message.content === 'string' ? [] : message.content
		);
		const toolResult = blocks.find((block) => block.type === 'tool_result');
		const content = toolResult?.content;
		expect(Array.isArray(content) && content.some((part) => part.type === 'image')).toBe(true);
	});

	it('tombstones the output assets a run evicted out of history', async () => {
		const store = await storeWithCsv();
		await store.put({
			scope: SCOPE,
			assetId: 'old-plot',
			blob: new Blob([new Uint8Array([7])], { type: 'image/png' }),
			mimeType: 'image/png',
			size: 1,
			updatedAt: 1
		});
		const oldRuns: AiRun[] = Array.from({ length: APP_CONFIG.ai.historyLength }, (_, index) => ({
			id: `old-${index}`,
			startedAt: index,
			finishedAt: index,
			status: 'done',
			mode: 'analyse',
			runtime: '0.27.7',
			inputs: [],
			summary: '',
			outputs: index === 0 ? [{ name: 'p.png', assetId: 'old-plot', mimeType: 'image/png' }] : [],
			toolCalls: 0
		}));
		const h = await harness({
			graph: baseGraph({ runs: oldRuns }),
			turns: [endTurn('Nothing to plot.')],
			store
		});

		await h.controller.run('ai', 'analyse');

		expect(h.runs().map((run) => run.id)).not.toContain('old-0');
		const evicted = await store.get(SCOPE, 'old-plot');
		expect(evicted.ok && evicted.value.trashedAt !== undefined).toBe(true);
	});

	it('digests the node inputs and reports them by asset id', async () => {
		const h = await harness();

		await h.controller.digest('ai');

		expect(h.executor.digests).toHaveLength(1);
		expect(h.executor.digests[0].previewRows).toBe(APP_CONFIG.ai.previewRows);
		expect(h.controller.digestsFor('ai')[CSV_ASSET_ID]).toMatchObject({ name: 'sweep.csv' });
		// Idempotent at the same depth: a second call measures nothing again.
		await h.controller.digest('ai');
		expect(h.executor.digests).toHaveLength(1);
	});

	/*
	 * The bug this closes: one input whose blob the store cannot hand over left
	 * `digest` with nothing to measure, so it cached nothing, so every file row
	 * read "digesting…" for ever. A file that cannot be read is an answer, and
	 * the cache is where the workbench reads answers from.
	 */
	it('answers for a file whose blob the store does not hold, rather than measuring for ever', async () => {
		const h = await harness({ store: new MemoryGraphAssetStore() });

		await h.controller.digest('ai');

		expect(h.executor.digests).toHaveLength(0);
		expect(h.controller.digestsFor('ai')[CSV_ASSET_ID]).toEqual({
			name: 'sweep.csv',
			size: CSV_TEXT.length,
			kind: 'unavailable',
			reason: 'blob'
		});
	});

	it('digests the files it can read and says why the others have none', async () => {
		const h = await harness({ graph: graphWithAGhostFile() });

		await h.controller.digest('ai');

		expect(h.executor.digests[0].files.map((file) => file.name)).toEqual(['sweep.csv']);
		expect(h.controller.digestsFor('ai')[CSV_ASSET_ID]).toMatchObject({
			name: 'sweep.csv',
			kind: 'table'
		});
		expect(h.controller.digestsFor('ai')[GHOST_ASSET_ID]).toMatchObject({
			kind: 'unavailable',
			reason: 'blob'
		});

		// And it is a settled answer: a second pass measures nothing again.
		await h.controller.digest('ai');
		expect(h.executor.digests).toHaveLength(1);
	});

	it('says the runtime is what is unavailable when the executor cannot load', async () => {
		const h = await harness({ loadFails: true });

		await h.controller.digest('ai');

		expect(h.controller.digestsFor('ai')[CSV_ASSET_ID]).toMatchObject({
			name: 'sweep.csv',
			kind: 'unavailable',
			reason: 'runtime'
		});
		// And the failure is on the run state, where the workbench draws it once
		// rather than on every file row as a mystery.
		const state = h.controller.stateFor('ai');
		expect(state.phase).toBe('error');
		expect(state.error).toContain('Python runtime');
	});

	it('re-measures on a run when a file that was unavailable has arrived since', async () => {
		const store = new MemoryGraphAssetStore();
		const h = await harness({ store });

		await h.controller.digest('ai');
		expect(h.controller.digestsFor('ai')[CSV_ASSET_ID]).toMatchObject({ kind: 'unavailable' });

		await store.put({
			scope: SCOPE,
			assetId: CSV_ASSET_ID,
			blob: new Blob([CSV_TEXT], { type: 'text/csv' }),
			mimeType: 'text/csv',
			name: 'sweep.csv',
			size: CSV_TEXT.length,
			updatedAt: 2
		});
		await h.controller.run('ai', 'analyse');

		expect(h.executor.digests).toHaveLength(1);
		expect(h.controller.digestsFor('ai')[CSV_ASSET_ID]).toMatchObject({ kind: 'table' });
	});

	it('reports an idle state for a node that has never run', async () => {
		const h = await harness();

		expect(h.controller.stateFor('other')).toEqual({
			phase: 'idle',
			text: '',
			thinking: '',
			steps: []
		});
		expect(h.controller.digestsFor('other')).toEqual({});
	});

	it('streams text and each execution step into the run state', async () => {
		// Bound after construction: the script callback needs the controller the
		// harness is still building.
		let live: AiRunController | null = null;
		const seen: string[] = [];
		const h = await harness({
			turns: [toolTurn('print("one")'), endTurn('All done.')],
			script: async () => {
				if (live !== null) seen.push(live.stateFor('ai').phase);
				return pngResult('plot.png');
			}
		});
		live = h.controller;

		await h.controller.run('ai', 'analyse');

		expect(seen).toEqual(['running']);
		const state = h.controller.stateFor('ai');
		expect(state.phase).toBe('done');
		expect(state.text).toContain('All done.');
		expect(state.steps).toEqual([{ stdoutTail: 'wrote a figure', exitCode: 0 }]);
	});
});

/**
 * Two inputs called `plot.png`: a neighbour's run output, and an attachment.
 *
 * The one thing this milestone can get quietly wrong is a name decided twice.
 * Four places have to say the same string — the file the executor writes, the
 * digest row the workbench draws, the filename the request lists, and the name
 * the run record keeps — and a disagreement between any two of them is silent:
 * the model is told about a file that is not there, or a measurement lands on
 * the wrong asset, or the next run claims a file it has always had is new.
 */
describe('createAiRunController: two inputs of the same name', () => {
	const PARENT_OUTPUT_ASSET_ID = 'parent-plot';
	const ATTACHED_ASSET_ID = 'attached-plot';
	const PNG_BYTES = new Uint8Array([137, 80, 78, 71]);

	function collidingGraph(): MultigraphData {
		return {
			...makeGraph({
				nodes: [
					{
						id: 'ai',
						title: 'Compare',
						description: '',
						addons: { ai: { prompt: 'Compare the two.', runs: [], promoted: {} } }
					},
					{
						id: 'parent',
						title: 'Sweep A',
						description: '',
						addons: {
							ai: {
								prompt: 'Plot it.',
								runs: [
									{
										id: 'parent-run',
										startedAt: 1,
										finishedAt: 2,
										status: 'done',
										mode: 'analyse',
										runtime: APP_CONFIG.ai.runtime.version,
										inputs: [],
										summary: 'Plotted.',
										outputs: [
											{
												name: 'plot.png',
												assetId: PARENT_OUTPUT_ASSET_ID,
												mimeType: 'image/png'
											}
										],
										toolCalls: 1
									}
								],
								promoted: {}
							}
						}
					},
					{
						id: 'bench',
						title: 'Bench',
						description: '',
						content: [{ type: 'file', assetId: ATTACHED_ASSET_ID, name: 'plot.png' }]
					}
				],
				edges: [
					{ source: 'parent', target: 'ai', directed: true, tags: [] },
					{ source: 'bench', target: 'ai', directed: true, tags: [] }
				]
			}),
			assets: {
				[PARENT_OUTPUT_ASSET_ID]: {
					id: PARENT_OUTPUT_ASSET_ID,
					kind: 'image',
					mimeType: 'image/png',
					name: 'plot.png',
					size: PNG_BYTES.length,
					createdAt: 1
				},
				[ATTACHED_ASSET_ID]: {
					id: ATTACHED_ASSET_ID,
					kind: 'image',
					mimeType: 'image/png',
					name: 'plot.png',
					size: PNG_BYTES.length,
					createdAt: 2
				}
			}
		};
	}

	async function storeWithBothPngs(): Promise<GraphAssetStore> {
		const store = new MemoryGraphAssetStore();
		for (const assetId of [PARENT_OUTPUT_ASSET_ID, ATTACHED_ASSET_ID]) {
			await store.put({
				scope: SCOPE,
				assetId,
				blob: new Blob([PNG_BYTES], { type: 'image/png' }),
				mimeType: 'image/png',
				name: 'plot.png',
				size: PNG_BYTES.length,
				updatedAt: 1
			});
		}
		return store;
	}

	/**
	 * The probe answers under the names the executor wrote, which is what the
	 * real one does (`os.path.basename` of the path it was handed).
	 */
	function digestsForWrittenFiles(): MeasuredFileDigest[] {
		return [
			{ name: 'plot.png', size: PNG_BYTES.length, kind: 'other' },
			{ name: 'plot-2.png', size: PNG_BYTES.length, kind: 'other' }
		];
	}

	async function collidingHarness() {
		return harness({
			graph: collidingGraph(),
			store: await storeWithBothPngs(),
			turns: [toolTurn('print("ok")'), endTurn('Both plotted.')],
			digests: digestsForWrittenFiles()
		});
	}

	it('says the same two names in /work, in the digests, in the request and on the record', async () => {
		const h = await collidingHarness();

		expect(await h.controller.run('ai', 'analyse')).toBe('done');

		// 1. What the executor wrote. The parent's output comes first because the
		// parent comes first in `graph.nodes`.
		expect(h.executor.runs[0].files.map((file) => file.name)).toEqual(['plot.png', 'plot-2.png']);

		// 2. The digest rows the workbench draws, per asset. Without a
		// collection-wide name both would land on the first asset id.
		const digests = h.controller.digestsFor('ai');
		expect(digests[PARENT_OUTPUT_ASSET_ID]?.name).toBe('plot.png');
		expect(digests[ATTACHED_ASSET_ID]?.name).toBe('plot-2.png');

		// 3. The filenames the request lists as openable.
		const system = h.client.requests[0].system;
		expect(system).toContain('- plot.png');
		expect(system).toContain('- plot-2.png');
		// And the produced one is named as produced.
		expect(userText(h.client.requests[0])).toContain('output of "Sweep A"');

		// 4. The names the run record keeps, which is what the next run reads back.
		expect(h.runs()[0].inputs.filter((input) => input.assetId !== undefined)).toEqual([
			{ nodeId: 'parent', assetId: PARENT_OUTPUT_ASSET_ID, name: 'plot.png' },
			{ nodeId: 'bench', assetId: ATTACHED_ASSET_ID, name: 'plot-2.png' }
		]);
	});

	it('reports nothing changed since that run while nothing has', async () => {
		const h = await collidingHarness();
		await h.controller.run('ai', 'analyse');

		const addon = h.addon();
		if (addon === undefined) throw new Error('the ai node should carry its add-on');
		expect(inputChangesForAddon(addon, collectAiInputs(h.graph, 'ai'))).toEqual({
			added: [],
			removed: [],
			replaced: []
		});
	});
});
