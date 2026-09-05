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
import type { AiTurn } from '$lib/ai/aiClient';
import { createFakeAiClient } from '$lib/ai/fakeClient';
import { createFakeExecutor } from '$lib/ai/fakeExecutor';
import type { ExecutionResult } from '$lib/ai/pyExecutor';
import { defaultAiSettings, type AiSettings } from '$lib/ai/aiSettings';
import { MemoryGraphAssetStore } from '$lib/assets/assetStore';
import type { GraphAssetStore } from '$lib/assets/assetStore';
import type { MultigraphData } from '../../types/multigraph';
import type { AiAddon, AiRun } from '../../types/node';
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
}

/** The controller with fakes underneath and every commit remembered. */
async function harness(options: HarnessOptions = {}) {
	const commits: { graph: MultigraphData; label: string }[] = [];
	let graph = options.graph ?? baseGraph();
	const client = createFakeAiClient(options.turns ?? [endTurn('Nothing to do.')]);
	const executor = createFakeExecutor(options.script ?? (() => pngResult('plot.png')), [
		{ name: 'sweep.csv', size: CSV_TEXT.length, kind: 'table', columns: ['t', 'ch2'], rows: 2 }
	]);
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
		// One entry per input the request carried: the neighbour's text and its file.
		expect(runs[0].inputs).toEqual([
			{ nodeId: 'data', label: 'baseline' },
			{ nodeId: 'data', assetId: CSV_ASSET_ID, label: 'baseline' }
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
		expect(run.error).toContain(`${cap} script runs`);
		// What ran is kept: the figures and the script that drew them.
		expect(run.outputs).toHaveLength(1);
		expect(capped.addon()?.script).toBe('print(1)');
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
