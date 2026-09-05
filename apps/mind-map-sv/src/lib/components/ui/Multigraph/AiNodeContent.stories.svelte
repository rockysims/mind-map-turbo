<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, userEvent, waitFor } from 'storybook/test';
	import AiNodeContent from './AiNodeContent.svelte';
	import AiNodeHarness from './AiNodeHarness.svelte';
	import { collectAiInputs } from './lib/aiInputs';
	import { IDLE_RUN_STATE, type AiRunState } from './lib/aiWorkbenchView';
	import { makeGraph } from './lib/testFixtures';
	import { MemoryGraphAssetStore } from '$lib/assets/assetStore';
	import type { FileDigest } from '$lib/ai/probeScript';
	import type { GraphAssetMetadata, MultigraphData } from '../types/multigraph';
	import type { AiAddon, AiRun, AiRunOutput, NodeData } from '../types/node';

	const RUNTIME = '0.27.7';
	const STARTED = 1_700_000_000_000;
	const PROMPT = 'Plot channel 2 against time for each file on shared axes.';
	const REFINED_PROMPT = `${PROMPT} Log scale on y.`;

	const CSV_ASSET: GraphAssetMetadata = {
		id: 'asset-csv',
		kind: 'file',
		mimeType: 'text/csv',
		name: 'measurements.csv',
		size: 2048,
		createdAt: 1
	};

	/** Exactly what the request would carry about that file, and no more. */
	const CSV_DIGEST: FileDigest = {
		name: 'measurements.csv',
		size: 2048,
		kind: 'table',
		columns: ['time', 'ch1', 'ch2'],
		dtypes: ['float64', 'float64', 'float64'],
		rows: 10_000,
		head: [
			['0.0', '1.1', '2.2'],
			['0.1', '1.2', '2.3']
		]
	};

	const OUTPUT_ASSETS: Record<string, GraphAssetMetadata> = {
		'asset-fig-1': {
			id: 'asset-fig-1',
			kind: 'image',
			mimeType: 'image/png',
			name: 'channel2.png',
			size: 4096,
			createdAt: 2
		},
		'asset-fig-2': {
			id: 'asset-fig-2',
			kind: 'image',
			mimeType: 'image/png',
			name: 'residuals.png',
			size: 3072,
			createdAt: 2
		},
		'asset-clean': {
			id: 'asset-clean',
			kind: 'file',
			mimeType: 'text/csv',
			name: 'cleaned.csv',
			size: 512,
			createdAt: 2
		}
	};

	const DONE_OUTPUTS: AiRunOutput[] = [
		{ name: 'channel2.png', assetId: 'asset-fig-1', mimeType: 'image/png' },
		{ name: 'residuals.png', assetId: 'asset-fig-2', mimeType: 'image/png' },
		{ name: 'cleaned.csv', assetId: 'asset-clean', mimeType: 'text/csv' }
	];

	const SCRIPT =
		'import pandas as pd\n\nframe = pd.read_csv("measurements.csv")\nprint(frame.shape)\n';

	/** What the stored script prints when the data it was written for has moved on. */
	const FAILED_TRACEBACK =
		'Traceback (most recent call last):\n  File "analysis.py", line 4\nKeyError: \'ch2\'';

	function makeRun(patch: Partial<AiRun> & Pick<AiRun, 'id'>): AiRun {
		return {
			startedAt: STARTED,
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

	const DONE_RUN: AiRun = makeRun({
		id: 'run-1',
		prompt: PROMPT,
		model: 'claude-opus-5',
		finishedAt: STARTED + 48_000,
		usage: { inputTokens: 11_000, outputTokens: 1300 },
		toolCalls: 3,
		summary: 'Both files plotted on shared axes; channel 2 drifts after the third minute.',
		outputs: DONE_OUTPUTS
	});

	/**
	 * The graph behind every story: an `!ai` node, and a bench node joined by a
	 * tagged incoming edge so the inputs list has both a text entry and a file.
	 */
	function aiGraph(addon: Partial<AiAddon> = {}, extraNodes: NodeData[] = []): MultigraphData {
		return {
			...makeGraph({
				nodes: [
					{
						id: 'ai',
						title: 'Channel plots !ai',
						description: '',
						addons: { ai: { prompt: PROMPT, runs: [], promoted: {}, ...addon } }
					},
					{
						id: 'bench',
						title: 'Bench run 3',
						description: 'Rig at 20 °C, sampled at 1 kHz.',
						content: [{ type: 'file', assetId: 'asset-csv', name: 'measurements.csv' }]
					},
					...extraNodes
				],
				edges: [{ source: 'bench', target: 'ai', directed: true, tags: ['baseline'] }]
			}),
			assets: { 'asset-csv': CSV_ASSET, ...OUTPUT_ASSETS }
		};
	}

	const IDLE_GRAPH = aiGraph();
	const IDLE_NODE = nodeOf(IDLE_GRAPH);
	const INPUTS = collectAiInputs(IDLE_GRAPH, 'ai');
	const DIGESTS: Record<string, FileDigest> = { 'asset-csv': CSV_DIGEST };

	function nodeOf(graph: MultigraphData): NodeData {
		const node = graph.nodes.find((candidate) => candidate.id === 'ai');
		if (node === undefined) throw new Error('no ai node in the fixture');
		return node;
	}

	/** The blobs behind the output metadata, so the grid and the Open link resolve. */
	function outputStore(): MemoryGraphAssetStore {
		const store = new MemoryGraphAssetStore();
		for (const [assetId, meta] of Object.entries(OUTPUT_ASSETS)) {
			void store.put({
				scope: 'story',
				assetId,
				blob: new Blob(['fixture'], { type: meta.mimeType }),
				mimeType: meta.mimeType,
				name: meta.name ?? assetId,
				size: meta.size,
				updatedAt: 2
			});
		}
		return store;
	}

	function runState(patch: Partial<AiRunState>): AiRunState {
		return { ...IDLE_RUN_STATE, ...patch };
	}

	function workbench(canvasElement: HTMLElement): HTMLElement {
		const found = canvasElement.querySelector('[data-ai-workbench]');
		if (!(found instanceof HTMLElement)) throw new Error('no workbench');
		return found;
	}

	function required(canvasElement: HTMLElement, selector: string): HTMLElement {
		const found = canvasElement.querySelector(selector);
		if (!(found instanceof HTMLElement)) throw new Error(`no ${selector}`);
		return found;
	}

	function harnessState(canvasElement: HTMLElement): HTMLElement {
		return required(canvasElement, '[data-ai-harness]');
	}

	function text(canvasElement: HTMLElement, selector: string): string {
		return canvasElement.querySelector(selector)?.textContent?.trim() ?? '';
	}

	type RunSpy = { mock: { calls: Array<[string]> } };

	function spyFor(callback: unknown): RunSpy {
		return callback as RunSpy;
	}

	const { Story } = defineMeta({
		title: 'Components/Multigraph/AiNodeContent',
		component: AiNodeContent,
		tags: [],
		args: {
			node: IDLE_NODE,
			inputs: INPUTS,
			digests: DIGESTS,
			hasKey: true,
			runState: IDLE_RUN_STATE
		}
	});
</script>

<Story
	name="IdleWithItsInputsAndNothingRunYet"
	play={async ({ canvasElement }) => {
		const content = workbench(canvasElement);

		const prompt = required(canvasElement, '[data-ai-prompt]');
		expect(prompt).toBeInstanceOf(HTMLTextAreaElement);
		expect((prompt as HTMLTextAreaElement).value).toBe(PROMPT);

		// The bench node's text, then its file: what `collectAiInputs` orders and
		// what the request will carry, in the same order.
		const rows = content.querySelectorAll('[data-ai-input]');
		expect(rows).toHaveLength(2);
		expect(rows[0]).toHaveAttribute('data-ai-input-kind', 'text');
		expect(rows[1]).toHaveAttribute('data-ai-input-kind', 'file');
		// The edge's tag is the input's role, with no UI of its own.
		expect(text(canvasElement, '[data-ai-input-label]')).toBe('baseline');

		// The digest, rendered by the same function that renders it into the
		// request — the milestone's "no surprises before Run".
		const digest = text(canvasElement, '[data-ai-digest]');
		expect(digest).toContain('measurements.csv — 2 KB');
		expect(digest).toContain('3 columns: time (float64), ch1 (float64), ch2 (float64)');
		expect(digest).toContain('10000 rows');
		expect(digest).toContain('First 2 rows:');
		expect(content.querySelector('[data-ai-digest-pending]')).toBeNull();

		// Nothing has run, so a fresh analysis is the only thing on offer.
		expect(required(canvasElement, '[data-ai-mode="analyse"]')).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		expect(required(canvasElement, '[data-ai-mode="rerun"]')).toBeDisabled();
		expect(required(canvasElement, '[data-ai-cancel]')).toBeDisabled();
		expect(content.querySelector('[data-ai-script]')).toBeNull();
		expect(content.querySelector('[data-ai-metadata]')).toBeNull();
		expect(content.querySelector('[data-ai-live]')).toBeNull();
	}}
/>

<Story
	name="AFileStillBeingMeasuredSaysSo"
	args={{ digests: {} }}
	play={async ({ canvasElement }) => {
		// The digest is what leaves the machine, so until it exists there is
		// nothing to promise the reader about this file.
		expect(required(canvasElement, '[data-ai-digest-pending]').textContent?.trim()).toBe(
			'digesting…'
		);
		expect(canvasElement.querySelector('[data-ai-digest]')).toBeNull();
	}}
/>

<Story
	name="TheRuntimeSaysHowMuchOfItselfHasArrived"
	args={{
		runState: runState({
			phase: 'loading-runtime',
			runtimeProgress: { loadedBytes: 12 * 1024 * 1024, totalBytes: 61 * 1024 * 1024 }
		})
	}}
	play={async ({ canvasElement }) => {
		const line = required(canvasElement, '[data-ai-runtime-progress]');
		expect(line.textContent).toContain('12 MB of 61 MB');
		expect(line.textContent).toContain('once per browser');

		// Loading the runtime is part of the run, so Cancel is live and Run is not.
		expect(required(canvasElement, '[data-ai-run]')).toBeDisabled();
		expect(required(canvasElement, '[data-ai-cancel]')).toBeEnabled();
		expect(required(canvasElement, '[data-ai-live]')).toHaveAttribute(
			'data-ai-phase',
			'loading-runtime'
		);
	}}
/>

<Story
	name="RunningStreamsTheReplyAndEveryScriptItRan"
	args={{
		runState: runState({
			phase: 'running',
			text: 'Reading both files and plotting channel 2 on shared axes.',
			thinking: 'The second file has a different sample rate, so resample first.',
			steps: [
				{ stdoutTail: 'Traceback: KeyError: ch2', exitCode: 1 },
				{ stdoutTail: 'Wrote outputs/channel2.png', exitCode: null }
			]
		})
	}}
	play={async ({ canvasElement }) => {
		expect(text(canvasElement, '[data-ai-stream-text]')).toContain('plotting channel 2');

		// A summary, not the raw thinking, and folded away by default.
		const thinking = required(canvasElement, '[data-ai-thinking]');
		expect(thinking).toBeInstanceOf(HTMLDetailsElement);
		expect((thinking as HTMLDetailsElement).open).toBe(false);
		expect(text(canvasElement, '[data-ai-thinking-text]')).toContain('different sample rate');

		const steps = canvasElement.querySelectorAll('[data-ai-step]');
		expect(steps).toHaveLength(2);
		expect(steps[0]).toHaveAttribute('data-ai-step-exit-code', '1');
		expect(steps[0].querySelector('[data-ai-step-stdout]')?.textContent).toContain('KeyError');
		// A step with no exit code yet is the one still running.
		expect(steps[1]).toHaveAttribute('data-ai-step-exit-code', 'running');
		expect(steps[1].querySelector('[data-ai-step-status]')?.textContent?.trim()).toBe('running');

		// The three rules for a long run: streamed from the first token, a visible
		// Cancel, and Run out of reach while one is in flight.
		expect(required(canvasElement, '[data-ai-cancel]')).toBeEnabled();
		expect(required(canvasElement, '[data-ai-run]')).toBeDisabled();
	}}
/>

<Story
	name="CancelIsThePressThatStopsARun"
	args={{
		onCancel: fn(),
		runState: runState({ phase: 'running', text: 'Working.' })
	}}
	play={async ({ canvasElement, args }) => {
		await userEvent.click(required(canvasElement, '[data-ai-cancel]'));
		expect(spyFor(args.onCancel).mock.calls).toHaveLength(1);
	}}
/>

<Story
	name="ADoneRunShowsItsPlotsItsFilesItsScriptAndWhatItCost"
	play={async ({ canvasElement }) => {
		const content = workbench(canvasElement);

		// The stored summary stands in for the stream once nothing is running.
		expect(text(canvasElement, '[data-ai-summary]')).toContain('shared axes');

		// Two plots in the same grid the details view uses, each carrying the
		// `data-asset-id` nested zoom descends on.
		const images = await waitFor(() => {
			const found = content.querySelectorAll('.image-grid img.focus-image');
			expect(found).toHaveLength(2);
			return found;
		});
		expect(images[0]).toHaveAttribute('data-asset-id', 'asset-fig-1');
		expect(images[1]).toHaveAttribute('data-asset-id', 'asset-fig-2');
		expect((images[0] as HTMLImageElement).src.startsWith('blob:')).toBe(true);

		// And the CSV as a file row with a way to open it.
		const row = required(canvasElement, '[data-ai-output="cleaned.csv"]');
		expect(text(row, '[data-file-name]')).toBe('cleaned.csv');
		expect(text(row, '[data-file-type]')).toBe('text/csv');
		expect(text(row, '[data-file-size]')).toBe('512 B');
		const open = await waitFor(() => {
			const found = row.querySelector('[data-file-open]');
			expect(found).toBeInstanceOf(HTMLAnchorElement);
			return found as HTMLAnchorElement;
		});
		expect(open.href.startsWith('blob:')).toBe(true);
		expect(open.target).toBe('_blank');

		// The script is the artifact, one disclosure away.
		const script = required(canvasElement, '[data-ai-script]');
		expect((script as HTMLDetailsElement).open).toBe(false);
		expect(text(canvasElement, '[data-ai-script-source]')).toContain('pd.read_csv');

		expect(text(canvasElement, '[data-ai-metadata]')).toBe(
			'claude-opus-5 · 48 s · 12.3k tokens · 3 tool calls'
		);

		// The prompt still matches the run that wrote the script, so the cheap mode
		// is the default and every output offers a node of its own.
		expect(required(canvasElement, '[data-ai-mode="rerun"]')).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		expect(content.querySelectorAll('[data-ai-promote]')).toHaveLength(3);
		expect(content.querySelector('[data-ai-stale-outputs]')).toBeNull();
	}}
>
	{#snippet template()}
		<AiNodeHarness
			baseGraph={aiGraph({ script: SCRIPT, runs: [DONE_RUN] })}
			nodeId="ai"
			digests={DIGESTS}
			assetStore={outputStore()}
			assetScope="story"
		/>
	{/snippet}
</Story>

<Story
	name="PromotingAnOutputAndJumpingToWhereItLanded"
	play={async ({ canvasElement }) => {
		await userEvent.click(required(canvasElement, '[data-ai-promote="channel2.png"]'));
		expect(harnessState(canvasElement)).toHaveAttribute('data-last-promote', 'channel2.png');

		// The press lands on the graph, so the row answers it: Promote is gone and
		// the node it made is named, titled by the filename it was promoted under.
		const justPromoted = required(canvasElement, '[data-ai-output="channel2.png"]');
		await waitFor(() => {
			expect(justPromoted.querySelector('[data-ai-promote]')).toBeNull();
			expect(justPromoted.querySelector('[data-ai-jump]')?.textContent?.trim()).toBe(
				'channel2.png'
			);
		});

		// An output already promoted names its node instead of offering again.
		const promoted = required(canvasElement, '[data-ai-output="residuals.png"]');
		expect(promoted.querySelector('[data-ai-promote]')).toBeNull();
		const jump = required(promoted, '[data-ai-jump="fig-node"]');
		expect(jump.textContent?.trim()).toBe('Residuals');

		await userEvent.click(jump);
		expect(harnessState(canvasElement)).toHaveAttribute('data-last-jump', 'fig-node');
	}}
>
	{#snippet template()}
		<AiNodeHarness
			baseGraph={aiGraph(
				{ script: SCRIPT, runs: [DONE_RUN], promoted: { 'residuals.png': 'fig-node' } },
				[{ id: 'fig-node', title: 'Residuals', description: '', tags: [] }]
			)}
			nodeId="ai"
			digests={DIGESTS}
			assetStore={outputStore()}
			assetScope="story"
		/>
	{/snippet}
</Story>

<Story
	name="APromotedOutputTheLastRunStoppedDrawingIsMarkedStale"
	play={async ({ canvasElement }) => {
		const stale = required(canvasElement, '[data-ai-stale-output="drift.png"]');
		expect(text(stale, '[data-ai-stale]')).toBe('stale');
		expect(text(stale, '[data-ai-jump="drift-node"]')).toBe('Drift');

		// The promoted node keeps its figure; nothing pretends the run produced it.
		expect(workbench(canvasElement).querySelector('[data-ai-output="drift.png"]')).toBeNull();
	}}
>
	{#snippet template()}
		<AiNodeHarness
			baseGraph={aiGraph(
				{ script: SCRIPT, runs: [DONE_RUN], promoted: { 'drift.png': 'drift-node' } },
				[{ id: 'drift-node', title: 'Drift', description: '', tags: [] }]
			)}
			nodeId="ai"
			digests={DIGESTS}
			assetStore={outputStore()}
			assetScope="story"
		/>
	{/snippet}
</Story>

<Story
	name="AFailedRunSaysSoWhereTheAnswerWouldBe"
	args={{
		runState: runState({
			phase: 'error',
			error: 'Rate limited. Wait a minute and run again.'
		})
	}}
	play={async ({ canvasElement }) => {
		const error = required(canvasElement, '[data-ai-error]');
		expect(error).toHaveAttribute('data-ai-refusal', 'false');
		expect(error).toHaveAttribute('role', 'alert');
		expect(error.textContent).toContain('The run failed.');
		expect(text(canvasElement, '[data-ai-error-text]')).toBe(
			'Rate limited. Wait a minute and run again.'
		);

		// The run is over, so Run is back and Cancel is not.
		expect(required(canvasElement, '[data-ai-run]')).toBeEnabled();
		expect(required(canvasElement, '[data-ai-cancel]')).toBeDisabled();
	}}
/>

<Story
	name="ARefusalReadsAsAnAnswerRatherThanABreakage"
	args={{
		runState: runState({
			phase: 'error',
			refusal: true,
			error: 'I can’t help with identifying people from these images.'
		})
	}}
	play={async ({ canvasElement }) => {
		const error = required(canvasElement, '[data-ai-error]');
		// A dedicated flag rather than a prefix on the sentence: the copy above it
		// changes, and nothing has to parse the model's words to decide that.
		expect(error).toHaveAttribute('data-ai-refusal', 'true');
		expect(error.textContent).toContain('Claude declined this request.');
		expect(error.textContent).not.toContain('The run failed.');
		expect(getComputedStyle(error).borderLeftColor).toBe('rgb(148, 163, 184)');
	}}
/>

<Story
	name="WithoutAKeyRunIsReplacedByTheWayToGetOne"
	args={{ hasKey: false, onOpenSettings: fn() }}
	play={async ({ canvasElement, args }) => {
		expect(workbench(canvasElement).querySelector('[data-ai-run]')).toBeNull();
		expect(text(canvasElement, '[data-ai-no-key]')).toContain('stays in this browser');

		await userEvent.click(required(canvasElement, '[data-ai-connect]'));
		expect(spyFor(args.onOpenSettings).mock.calls).toHaveLength(1);
	}}
/>

<!--
	Both of the cheap modes work *from* the stored script, so a node that has
	never run has neither, and says why rather than leaving two dead buttons.
-->
<Story
	name="WithoutAStoredScriptRefineAndReRunSayWhyTheyAreOutOfReach"
	play={async ({ canvasElement }) => {
		const refine = required(canvasElement, '[data-ai-mode="refine"]');
		expect(refine).toBeDisabled();
		expect(refine).toHaveAttribute('title', 'No stored script yet — run an analysis first.');
		expect(required(canvasElement, '[data-ai-mode="rerun"]')).toBeDisabled();

		// A disabled button's tooltip is not reliably reachable, so the reason is
		// on the screen too.
		expect(text(canvasElement, '[data-ai-mode-note]')).toBe(
			'No stored script yet — run an analysis first.'
		);

		// Pressing one anyway changes nothing: the switch stays where the node is.
		await userEvent.click(refine);
		expect(required(canvasElement, '[data-ai-mode="analyse"]')).toHaveAttribute(
			'aria-pressed',
			'true'
		);
	}}
/>

<Story
	name="WithAStoredScriptAndAnUnchangedPromptTheDefaultIsTheFreeMode"
	play={async ({ canvasElement }) => {
		// The prompt is exactly the one that produced the script, so the only
		// reason to run is new data — and that needs no model at all.
		expect(required(canvasElement, '[data-ai-mode="rerun"]')).toBeEnabled();
		expect(required(canvasElement, '[data-ai-mode="rerun"]')).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		expect(required(canvasElement, '[data-ai-mode="refine"]')).toBeEnabled();
		expect(workbench(canvasElement).querySelector('[data-ai-mode-note]')).toBeNull();
	}}
>
	{#snippet template()}
		<AiNodeHarness
			baseGraph={aiGraph({ script: SCRIPT, runs: [DONE_RUN] })}
			nodeId="ai"
			digests={DIGESTS}
		/>
	{/snippet}
</Story>

<!--
	A re-run calls no model, so when its script fails nobody has explained the
	failure: the traceback is the whole of what is known, and the one action is
	to hand it back to Claude.
-->
<Story
	name="AFailedReRunShowsTheTracebackAndOffersToFixIt"
	play={async ({ canvasElement }) => {
		expect(text(canvasElement, '[data-ai-traceback]')).toContain("KeyError: 'ch2'");
		expect(text(canvasElement, '[data-ai-error-text]')).toContain('exit code 1');

		await userEvent.click(required(canvasElement, '[data-ai-fix]'));
		expect(harnessState(canvasElement)).toHaveAttribute('data-fixes', '1');
	}}
>
	{#snippet template()}
		<AiNodeHarness
			baseGraph={aiGraph({ script: SCRIPT, runs: [DONE_RUN] })}
			nodeId="ai"
			digests={DIGESTS}
			runState={runState({
				phase: 'error',
				error: 'The stored script failed with exit code 1.',
				traceback: FAILED_TRACEBACK,
				steps: [{ stdoutTail: FAILED_TRACEBACK, exitCode: 1 }]
			})}
		/>
	{/snippet}
</Story>

<!-- An ordinary failure has no traceback to hand back, so there is nothing to fix. -->
<Story
	name="AFailureWithNoTracebackOffersNoFix"
	args={{
		runState: runState({ phase: 'error', error: 'Rate limited. Wait a minute and run again.' })
	}}
	play={async ({ canvasElement }) => {
		expect(workbench(canvasElement).querySelector('[data-ai-fix]')).toBeNull();
		expect(workbench(canvasElement).querySelector('[data-ai-traceback]')).toBeNull();
	}}
/>

<Story
	name="EditingThePromptTurnsReRunIntoRefine"
	play={async ({ canvasElement }) => {
		// The stored script came from this exact prompt, so nothing needs a model.
		expect(required(canvasElement, '[data-ai-mode="rerun"]')).toHaveAttribute(
			'aria-pressed',
			'true'
		);

		const prompt = required(canvasElement, '[data-ai-prompt]') as HTMLTextAreaElement;
		await userEvent.clear(prompt);
		await userEvent.type(prompt, REFINED_PROMPT);
		// Not committed yet: a keystroke is not an edit to the graph.
		expect(harnessState(canvasElement)).toHaveAttribute('data-last-prompt', '');

		await userEvent.tab();
		await waitFor(() =>
			expect(harnessState(canvasElement)).toHaveAttribute('data-last-prompt', REFINED_PROMPT)
		);
		// The script no longer matches the prompt, so editing it is what Run means.
		await waitFor(() =>
			expect(required(canvasElement, '[data-ai-mode="refine"]')).toHaveAttribute(
				'aria-pressed',
				'true'
			)
		);
	}}
>
	{#snippet template()}
		<AiNodeHarness
			baseGraph={aiGraph({ script: SCRIPT, runs: [DONE_RUN] })}
			nodeId="ai"
			digests={DIGESTS}
		/>
	{/snippet}
</Story>

<Story
	name="CmdEnterCommitsThePromptWithoutLeavingTheField"
	play={async ({ canvasElement }) => {
		const prompt = required(canvasElement, '[data-ai-prompt]') as HTMLTextAreaElement;
		await userEvent.clear(prompt);
		await userEvent.type(prompt, 'Just the drift.');
		await userEvent.keyboard('{Meta>}{Enter}{/Meta}');

		await waitFor(() =>
			expect(harnessState(canvasElement)).toHaveAttribute('data-last-prompt', 'Just the drift.')
		);
		// Still in the field: the reader was settling the prompt, not leaving it.
		expect(document.activeElement).toBe(prompt);
	}}
>
	{#snippet template()}
		<AiNodeHarness baseGraph={aiGraph()} nodeId="ai" digests={DIGESTS} />
	{/snippet}
</Story>

<Story
	name="RunReportsTheModeTheSwitchIsOn"
	args={{ onRun: fn() }}
	play={async ({ canvasElement, args }) => {
		await userEvent.click(required(canvasElement, '[data-ai-run]'));
		expect(spyFor(args.onRun).mock.calls[0][0]).toBe('analyse');
	}}
/>

<Story
	name="TheSurfaceLeavesTheZoomWorldItsGestures"
	play={async ({ canvasElement }) => {
		const content = workbench(canvasElement);

		// Focus mode has no scrollbars: a wheel is how the reader moves the world,
		// so nothing in this subtree may quietly become a scroll container. The
		// prompt field grows to its text instead.
		for (const element of [content, ...content.querySelectorAll('*')]) {
			const { overflowX, overflowY } = getComputedStyle(element);
			expect([overflowX, overflowY]).not.toContain('scroll');
			expect([overflowX, overflowY]).not.toContain('auto');
		}

		const state = harnessState(canvasElement);
		content.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 }));
		await waitFor(() => expect(state).toHaveAttribute('data-stage-wheels', '1'));

		// A press on a control belongs to the control, not to a world pan — the
		// rule `ZoomWorld` applies, checked here against every control this
		// surface adds.
		for (const selector of ['[data-ai-prompt]', '[data-ai-run]', '[data-ai-mode="analyse"]']) {
			required(canvasElement, selector).dispatchEvent(
				new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 })
			);
		}
		expect(state).toHaveAttribute('data-stage-pan-starts', '0');

		// And the surface's own background still pans, which is what makes the
		// count above mean something.
		content.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2 }));
		await waitFor(() => expect(state).toHaveAttribute('data-stage-pan-starts', '1'));
	}}
>
	{#snippet template()}
		<AiNodeHarness
			baseGraph={aiGraph({ script: SCRIPT, runs: [DONE_RUN] })}
			nodeId="ai"
			digests={DIGESTS}
		/>
	{/snippet}
</Story>
