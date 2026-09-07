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
	import type {
		AiAddon,
		AiRun,
		AiRunInput,
		AiRunOutput,
		NodeContentBlock,
		NodeData
	} from '../types/node';

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

	/**
	 * The fixture graph's inputs as a finished run records them: the bench node's
	 * text, then its CSV, both labelled by the edge's tag. Recorded rather than
	 * left empty because a run that sent nothing and a node that now has a file
	 * is exactly the "the data moved" case, and every story but that one is about
	 * something else.
	 */
	const RUN_INPUTS: AiRunInput[] = [
		{ nodeId: 'bench', label: 'baseline' },
		{ nodeId: 'bench', assetId: 'asset-csv', name: 'measurements.csv', label: 'baseline' }
	];

	const DONE_RUN: AiRun = makeRun({
		id: 'run-1',
		inputs: RUN_INPUTS,
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

	/** A file attached to the AI node itself, so its own group has a row. */
	const OWN_ASSET: GraphAssetMetadata = {
		id: 'asset-own',
		kind: 'file',
		mimeType: 'text/csv',
		name: 'notes.csv',
		size: 256,
		createdAt: 1
	};

	/** The fixture graph with a file on the `!ai` node as well as on the bench. */
	function graphWithOwnFile(addon: Partial<AiAddon> = {}): MultigraphData {
		const graph = aiGraph(addon);
		const content: NodeContentBlock[] = [{ type: 'file', assetId: 'asset-own', name: 'notes.csv' }];
		return {
			...graph,
			nodes: graph.nodes.map((node) => (node.id === 'ai' ? { ...node, content } : node)),
			assets: { ...graph.assets, 'asset-own': OWN_ASSET }
		};
	}

	/** What the reader picks out of the file dialog. */
	function pickedFile(name: string): File {
		return new File(['time,ch2\n0.0,1.0\n'], name, { type: 'text/csv' });
	}

	/** A second file, attached after the run that wrote the script. */
	const EXTRA_ASSET: GraphAssetMetadata = {
		id: 'asset-extra',
		kind: 'file',
		mimeType: 'text/csv',
		name: 'ambient.csv',
		size: 1024,
		createdAt: 3
	};

	/** The same filename over new bytes: a fresh export of the same measurement. */
	const REPLACEMENT_ASSET: GraphAssetMetadata = {
		id: 'asset-csv-v2',
		kind: 'file',
		mimeType: 'text/csv',
		name: 'measurements.csv',
		size: 3072,
		createdAt: 3
	};

	/**
	 * The fixture graph as it stands after the reader swapped the CSV and
	 * attached another one — the state the stored script is quietly out of date
	 * with, because it opens the names it was written for.
	 */
	function graphWithMovedFiles(): MultigraphData {
		const graph = aiGraph({ script: SCRIPT, runs: [DONE_RUN] });
		const content: NodeContentBlock[] = [
			{ type: 'file', assetId: 'asset-csv-v2', name: 'measurements.csv' },
			{ type: 'file', assetId: 'asset-extra', name: 'ambient.csv' }
		];
		return {
			...graph,
			nodes: graph.nodes.map((node) => (node.id === 'bench' ? { ...node, content } : node)),
			assets: { ...graph.assets, 'asset-csv-v2': REPLACEMENT_ASSET, 'asset-extra': EXTRA_ASSET }
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

	function text(canvasElement: Element, selector: string): string {
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

<script lang="ts">
	/**
	 * Claude's reply as it arrives, advanced from a `play` — so the closed prose
	 * line can be watched moving rather than described. `args` are fixed for the
	 * life of a render, and a ticker is exactly a thing that changes.
	 */
	let streamedReply = $state('Reading both');
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

		// One line per file: what it is, how big, and the shape of the table. The
		// rows themselves are a disclosure away (see the collapsed-digest story).
		const summary = text(rows[1], '[data-ai-digest-summary]');
		expect(summary).toContain('measurements.csv');
		expect(summary).toContain('2 KB');
		expect(summary).toContain('3 columns, 10000 rows');
		expect(content.querySelector('[data-ai-digest-pending]')).toBeNull();

		// Nothing has run, so writing a script is the only thing on offer — and the
		// button beside the switch names that act rather than saying "Run".
		expect(required(canvasElement, '[data-ai-mode="analyse"]')).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		expect(text(canvasElement, '[data-ai-mode="analyse"]')).toBe('Write');
		expect(text(canvasElement, '[data-ai-run]')).toBe('Write & run');
		expect(required(canvasElement, '[data-ai-mode="rerun"]')).toBeDisabled();
		expect(required(canvasElement, '[data-ai-cancel]')).toBeDisabled();

		// The controls come before the inputs, so a node with several files still
		// opens on the prompt and the press that runs it.
		expect(
			required(canvasElement, '[data-ai-run-controls]').compareDocumentPosition(
				required(canvasElement, '[data-ai-inputs]')
			) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
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
	play={async ({ canvasElement }) => {
		// Reset rather than assumed: the stream is instance state, so a replay of
		// this story starts where the reader's run does.
		streamedReply = 'Reading both';
		await waitFor(() => expect(text(canvasElement, '[data-ai-stream-text]')).toBe('Reading both'));

		// The closed prose line is a status ticker while a run is in flight. Before
		// any sentence has ended it is the fragment, so the line moves from the
		// first token rather than sitting empty while Claude types.
		expect(text(canvasElement, '[data-ai-prose-preview]')).toBe('Reading both');

		streamedReply = 'Reading both files and plotting channel 2 on shared axes.';
		await waitFor(() =>
			expect(text(canvasElement, '[data-ai-prose-preview]')).toBe(
				'Reading both files and plotting channel 2 on shared axes.'
			)
		);
		expect(text(canvasElement, '[data-ai-stream-text]')).toContain('plotting channel 2');

		// And it keeps moving: the newest finished sentence, not the first one. A
		// line frozen on "Reading both files." for the next forty seconds is what a
		// reader watching a long run reads as nothing happening.
		streamedReply =
			'Reading both files and plotting channel 2 on shared axes. ' +
			'The second file samples faster, so resampling it first.';
		await waitFor(() =>
			expect(text(canvasElement, '[data-ai-prose-preview]')).toBe(
				'The second file samples faster, so resampling it first.'
			)
		);

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
>
	{#snippet template()}
		<AiNodeContent
			node={IDLE_NODE}
			inputs={INPUTS}
			digests={DIGESTS}
			hasKey
			runState={runState({
				phase: 'running',
				text: streamedReply,
				thinking: 'The second file has a different sample rate, so resample first.',
				steps: [
					{ stdoutTail: 'Traceback: KeyError: ch2', exitCode: 1 },
					{ stdoutTail: 'Wrote outputs/channel2.png', exitCode: null }
				]
			})}
		/>
	{/snippet}
</Story>

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

		// Nothing is running, so the outputs are the current answer: full opacity,
		// and no caption saying they came from somewhere else.
		expect(getComputedStyle(required(canvasElement, '[data-ai-outputs-body]')).opacity).toBe('1');
		expect(content.querySelector('[data-ai-outputs-stale-while-running]')).toBeNull();

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

<!--
	Promote is an icon: the row already carries a name, a picture and a link, and
	the word was one the reader had to translate. The label and the tooltip are
	what carry the meaning now — the tooltip on hover only, which is the standing
	debt in `docs/debt/2026-08-30-tooltips-are-hover-only.md`.
-->
<Story
	name="PromotingAnOutputAndJumpingToWhereItLanded"
	play={async ({ canvasElement }) => {
		const promote = required(canvasElement, '[data-ai-promote="channel2.png"]');
		expect(promote).toHaveAttribute('aria-label', 'Give this output its own node');
		expect(promote).toHaveAttribute(
			'title',
			'Gives this output its own node on the map, linked to this one and refreshed each time this node runs.'
		);
		// A glyph pointing out of the row and onto the map, and no prose beside it.
		expect(promote.textContent?.trim()).toBe('⤴');

		await userEvent.click(promote);
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

<!--
	The reader promoted an output and then deleted the node it made. The binding
	is gone with the node (`removeNode`), but a graph that predates that fix — or
	a workbench looking at one mid-undo — can still hold one, so the surface
	decides "promoted" by asking whether the node is there rather than by the
	binding alone. Otherwise the row hides Promote and offers a jump to nothing.
-->
<Story
	name="AnOutputBoundToANodeThatIsGoneOffersPromoteAgain"
	play={async ({ canvasElement }) => {
		const row = required(canvasElement, '[data-ai-output="residuals.png"]');
		expect(row.querySelector('[data-ai-jump]')).toBeNull();

		// A stale name whose node is gone is not stale either — there is nothing
		// left on the map to be out of date.
		expect(workbench(canvasElement).querySelector('[data-ai-stale-outputs]')).toBeNull();

		const promote = required(row, '[data-ai-promote="residuals.png"]');
		await userEvent.click(promote);
		expect(harnessState(canvasElement)).toHaveAttribute('data-last-promote', 'residuals.png');

		// The real `promoteAiOutput` ran on the harness's graph: a fresh node,
		// titled by the filename, and the row names it.
		await waitFor(() => {
			expect(row.querySelector('[data-ai-promote]')).toBeNull();
			expect(row.querySelector('[data-ai-jump]')?.textContent?.trim()).toBe('residuals.png');
		});
	}}
>
	{#snippet template()}
		<AiNodeHarness
			baseGraph={aiGraph({
				script: SCRIPT,
				runs: [DONE_RUN],
				promoted: { 'residuals.png': 'deleted-node', 'drift.png': 'deleted-too' }
			})}
			nodeId="ai"
			digests={DIGESTS}
			assetStore={outputStore()}
			assetScope="story"
		/>
	{/snippet}
</Story>

<!--
	A document whose blob was never hydrated into this browser: there is nothing
	to put in front of the probe and nothing is coming, so the row says so once
	rather than measuring for ever. Name and size are still known, from the
	graph's asset metadata.
-->
<Story
	name="AFileWhoseBytesAreNotInThisBrowserSaysSoInsteadOfMeasuring"
	args={{
		digests: {
			'asset-csv': {
				name: 'measurements.csv',
				size: 2048,
				kind: 'unavailable',
				reason: 'blob'
			} satisfies FileDigest
		}
	}}
	play={async ({ canvasElement }) => {
		const row = required(canvasElement, '[data-ai-input-kind="file"]');
		expect(text(row, '[data-ai-digest-unavailable]')).toBe('Unavailable in this browser');
		expect(required(row, '[data-ai-digest-unavailable]')).toHaveAttribute(
			'data-ai-digest-unavailable',
			'blob'
		);

		// Nothing to disclose and no shape to state — and, crucially, not the
		// pending line: the row is not waiting for anything.
		expect(row.querySelector('details')).toBeNull();
		expect(row.querySelector('[data-ai-input-shape]')).toBeNull();
		expect(row.querySelector('[data-ai-digest-pending]')).toBeNull();
		expect(text(row, '[data-ai-digest-summary]')).toContain('measurements.csv');
		expect(text(row, '[data-ai-digest-summary]')).toContain('2 KB');
	}}
/>

<!-- The runtime is one failure that takes every file with it, so every row says
     that reason rather than each one claiming to be measuring. -->
<Story
	name="AFileMeasuredByARuntimeThatNeverLoadedNamesTheRuntime"
	args={{
		digests: {
			'asset-csv': {
				name: 'measurements.csv',
				size: 2048,
				kind: 'unavailable',
				reason: 'runtime'
			} satisfies FileDigest
		}
	}}
	play={async ({ canvasElement }) => {
		const row = required(canvasElement, '[data-ai-input-kind="file"]');
		expect(text(row, '[data-ai-digest-unavailable]')).toBe('Python runtime unavailable');
		expect(row.querySelector('[data-ai-digest-pending]')).toBeNull();
	}}
/>

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

		// The state, not a warning about it: the same line that names the model
		// once a key is in hand says there is none.
		const connection = required(canvasElement, '[data-ai-connection]');
		expect(connection).toHaveAttribute('data-ai-connection', 'disconnected');
		expect(connection.textContent?.trim()).toBe('Not connected');

		await userEvent.click(required(canvasElement, '[data-ai-connect]'));
		expect(spyFor(args.onOpenSettings).mock.calls).toHaveLength(1);
	}}
/>

<!--
	The sheet closes behind a Connect, so the workbench is where the reader finds
	out whether it took — and the model is the part that makes it an answer
	rather than a claim.
-->
<Story
	name="AConnectedWorkbenchNamesTheModelItWouldCall"
	args={{ hasKey: true, model: 'claude-sonnet-5' }}
	play={async ({ canvasElement }) => {
		const connection = required(canvasElement, '[data-ai-connection]');
		expect(connection).toHaveAttribute('data-ai-connection', 'connected');
		expect(connection.textContent?.trim()).toBe('Connected · claude-sonnet-5');
		// Green, and the same green the toolbar's dot uses.
		const dot = connection.querySelector('span');
		expect(dot).not.toBeNull();
		expect(getComputedStyle(dot as Element).backgroundColor).toBe('rgb(22, 163, 74)');
	}}
/>

<!--
	Three modes read as three actions until the switch says it is one. The label
	and the filled selection are what make "Write" a choice; the button beside
	it is what makes pressing something do a visible thing. The names are verbs
	the reader already owns — Write, Change, Run — while the stored `AiRunMode`
	values behind them (`analyse`, `refine`, `rerun`) never move.
-->
<Story
	name="TheModeSwitchIsLabelledAndTheButtonNamesWhatItWillRun"
	play={async ({ canvasElement }) => {
		expect(text(canvasElement, '[data-ai-mode="analyse"]')).toBe('Write');
		expect(text(canvasElement, '[data-ai-mode="refine"]')).toBe('Change');
		expect(text(canvasElement, '[data-ai-mode="rerun"]')).toBe('Run');

		// Run's hint names the trap rather than the saving, in terms the reader
		// has. Reworded twice: "read only if the script reads by pattern" was the
		// script's own vocabulary, and "scans its folder" named a folder this app
		// has never shown anyone. What is left is two scripts a reader can picture.
		expect(text(canvasElement, '[data-ai-mode-hint]')).toBe(
			'Runs the stored script again on the current files. A script that opens files by name ' +
				"won't notice a new one; a script that reads every attached file will."
		);
		expect(text(canvasElement, '[data-ai-run]')).toBe('Run');

		const analyse = required(canvasElement, '[data-ai-mode="analyse"]');
		const rerun = required(canvasElement, '[data-ai-mode="rerun"]');
		// The selection is filled, the rest are not — a difference a glance reads.
		expect(getComputedStyle(rerun).backgroundColor).toBe('rgb(15, 23, 42)');
		expect(getComputedStyle(analyse).backgroundColor).toBe('rgb(255, 255, 255)');

		await userEvent.click(analyse);
		await waitFor(() => expect(analyse).toHaveAttribute('aria-pressed', 'true'));
		expect(rerun).toHaveAttribute('aria-pressed', 'false');
		expect(text(canvasElement, '[data-ai-run]')).toBe('Write & run');
		expect(text(canvasElement, '[data-ai-mode-hint]')).toBe(
			'Claude writes a new script from the prompt and runs it'
		);

		await userEvent.click(required(canvasElement, '[data-ai-mode="refine"]'));
		await waitFor(() => expect(text(canvasElement, '[data-ai-run]')).toBe('Change & run'));
		expect(text(canvasElement, '[data-ai-mode-hint]')).toBe(
			'Claude changes the stored script to match the prompt and runs it'
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
	name="ARunInFlightSaysSoOnTheButtonThatStartedIt"
	args={{
		node: nodeOf(aiGraph({ script: SCRIPT, runs: [DONE_RUN] })),
		runState: runState({ phase: 'running', text: 'Working.' })
	}}
	play={async ({ canvasElement }) => {
		const run = required(canvasElement, '[data-ai-run]');
		expect(run).toBeDisabled();
		expect(run.querySelector('.dot')).not.toBeNull();
		// The way out of a run stays live while the way into one does not.
		expect(required(canvasElement, '[data-ai-cancel]')).toBeEnabled();

		// The same button runs three different things, so a dot alone cannot say
		// which one is out: in flight it names the act of the mode that started it,
		// in the same verb the switch used to choose it.
		await userEvent.click(required(canvasElement, '[data-ai-mode="analyse"]'));
		await waitFor(() => expect(text(canvasElement, '[data-ai-run]')).toBe('Writing…'));

		await userEvent.click(required(canvasElement, '[data-ai-mode="refine"]'));
		await waitFor(() => expect(text(canvasElement, '[data-ai-run]')).toBe('Changing…'));

		await userEvent.click(required(canvasElement, '[data-ai-mode="rerun"]'));
		await waitFor(() => expect(text(canvasElement, '[data-ai-run]')).toBe('Running…'));
	}}
/>

<!--
	The digest is what leaves the machine, so it stays inspectable — but a CSV's
	rows are not what the reader came to the workbench to read, and open by
	default they pushed the Run button off the screen.
-->
<Story
	name="TheDigestIsCollapsedButOneDisclosureAway"
	play={async ({ canvasElement }) => {
		const content = workbench(canvasElement);
		const panel = required(content, '[data-ai-input-kind="file"] details');
		expect(panel).toBeInstanceOf(HTMLDetailsElement);
		expect((panel as HTMLDetailsElement).open).toBe(false);
		// The summary names the depth the settings sheet promised.
		expect(panel.querySelector('summary')?.textContent?.trim()).toBe(
			'What Claude will see (5 rows)'
		);

		await userEvent.click(panel.querySelector('summary') as HTMLElement);
		await waitFor(() => expect((panel as HTMLDetailsElement).open).toBe(true));

		// And behind it, the same text the request carries, unchanged.
		const digest = text(canvasElement, '[data-ai-digest]');
		expect(digest).toContain('measurements.csv — 2 KB');
		expect(digest).toContain('3 columns: time (float64), ch1 (float64), ch2 (float64)');
		expect(digest).toContain('10000 rows');
		expect(digest).toContain('First 2 rows:');
	}}
/>

<Story
	name="ASchemaOnlySettingSaysSoOnTheDisclosure"
	args={{ previewRows: 0 }}
	play={async ({ canvasElement }) => {
		expect(
			required(canvasElement, '[data-ai-input-kind="file"] details summary').textContent?.trim()
		).toBe('What Claude will see (schema only)');
		// The promise is kept in the text too: no rows, however many the probe took.
		expect(text(canvasElement, '[data-ai-digest]')).not.toContain('First');
	}}
/>

<!-- Nothing to preview and no shape to state: a file pandas could not read is
     its name and its size, and the row says only that. -->
<Story
	name="AFileTheProbeCouldNotReadIsJustItsNameAndSize"
	args={{
		digests: { 'asset-csv': { name: 'measurements.csv', size: 2048, kind: 'other' } }
	}}
	play={async ({ canvasElement }) => {
		const row = required(canvasElement, '[data-ai-input-kind="file"]');
		expect(row.querySelector('details')).toBeNull();
		expect(row.querySelector('[data-ai-input-shape]')).toBeNull();
		expect(text(row, '[data-ai-digest-summary]')).toContain('2 KB');
	}}
/>

<!--
	Both of the cheap modes work *from* the stored script, so a node that has
	never run has neither, and says why rather than leaving two dead buttons.
-->
<Story
	name="WithoutAStoredScriptChangeAndRunSayWhyTheyAreOutOfReach"
	play={async ({ canvasElement }) => {
		const refine = required(canvasElement, '[data-ai-mode="refine"]');
		expect(refine).toBeDisabled();
		expect(refine).toHaveAttribute('title', 'No stored script yet — write one first.');
		expect(required(canvasElement, '[data-ai-mode="rerun"]')).toBeDisabled();

		// A disabled button's tooltip is not reliably reachable, so the reason is
		// on the screen too.
		expect(text(canvasElement, '[data-ai-mode-note]')).toBe(
			'No stored script yet — write one first.'
		);

		// Pressing one anyway changes nothing: the switch stays where the node is.
		await userEvent.click(refine);
		expect(required(canvasElement, '[data-ai-mode="analyse"]')).toHaveAttribute(
			'aria-pressed',
			'true'
		);
	}}
/>

<!--
	The failure this note exists for: Run does gather the current files, but the
	stored script opens the names it was written for — so a file added since then
	is written into the sandbox and never read, and nothing about the answer looks
	wrong. The note names what moved, and the switch starts on Change.
-->
<Story
	name="FilesChangedSinceTheScriptWasWrittenAskForChange"
	play={async ({ canvasElement }) => {
		expect(text(canvasElement, '[data-ai-inputs-changed]')).toBe(
			'Files changed since the script was written: added ambient.csv, replaced measurements.csv. ' +
				'Run uses the stored script as it is; choose Change so Claude updates it.'
		);

		// The prompt has not moved an inch, and the mode is still Change: the
		// script, not the question, is what is out of date.
		expect(required(canvasElement, '[data-ai-mode="refine"]')).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		expect(text(canvasElement, '[data-ai-run]')).toBe('Change & run');

		// Above the switch it is about, so it is read before the choice is made.
		expect(
			required(canvasElement, '[data-ai-inputs-changed]').compareDocumentPosition(
				required(canvasElement, '[data-ai-mode="refine"]')
			) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
	}}
>
	{#snippet template()}
		<AiNodeHarness baseGraph={graphWithMovedFiles()} nodeId="ai" digests={DIGESTS} />
	{/snippet}
</Story>

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
		// The files are the ones the run recorded, so there is nothing to warn about.
		expect(workbench(canvasElement).querySelector('[data-ai-inputs-changed]')).toBeNull();
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
	name="EditingThePromptTurnsRunIntoChange"
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
		// The script no longer matches the prompt, so changing it is what a run means.
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

		// One scroller, and it is the root: the surface is taller than the frame,
		// so it scrolls rather than stranding its controls below the pan clamp.
		expect(content).toHaveAttribute('data-zoom-scroll');
		expect(getComputedStyle(content).overflowY).toBe('auto');
		expect(content.scrollHeight).toBeGreaterThan(content.clientHeight);

		// And nothing inside it is a second one — an inner scrollbar would put a
		// dead zone in the middle of the surface. The prompt grows to its text and
		// every `<pre>` wraps.
		for (const element of content.querySelectorAll('*')) {
			const { overflowX, overflowY } = getComputedStyle(element);
			expect([overflowX, overflowY]).not.toContain('scroll');
			expect([overflowX, overflowY]).not.toContain('auto');
		}

		const state = harnessState(canvasElement);

		// While the scroller has room, the wheel is the browser's and the world
		// never hears it.
		content.scrollTop = 0;
		content.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 }));
		expect(state).toHaveAttribute('data-stage-wheels', '0');

		// At the top there is nowhere to scroll up, and magnifying a page of
		// controls is not what that gesture meant: the world takes the wheel and
		// does nothing with it. (Over a descendable image it would descend, which
		// this surface has none of.)
		content.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }));
		await waitFor(() => expect(state).toHaveAttribute('data-stage-swallows', '1'));
		expect(state).toHaveAttribute('data-stage-wheels', '0');

		// At the bottom there is nowhere left to scroll either — and the wheel does
		// not become an exit: once inside a scrollable surface, Close is what
		// leaves. However many arrive, the world takes them and does nothing.
		content.scrollTop = content.scrollHeight;
		for (let repeat = 0; repeat < 4; repeat += 1) {
			content.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 }));
		}
		await waitFor(() => expect(state).toHaveAttribute('data-stage-swallows', '5'));
		expect(state).toHaveAttribute('data-stage-wheels', '0');

		// Still room upward from the bottom, so that direction stays the scroller's.
		content.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }));
		expect(state).toHaveAttribute('data-stage-wheels', '0');
		expect(state).toHaveAttribute('data-stage-swallows', '5');

		// A press on a control belongs to the control, not to a world pan — the
		// rule `ZoomWorld` applies, checked here against every control this
		// surface adds. The disclosure's summary is on the list because a captured
		// press would swallow its click and leave it unopenable in deep zoom.
		for (const selector of [
			'[data-ai-prompt]',
			'[data-ai-run]',
			'[data-ai-mode="analyse"]',
			'[data-ai-input-kind="file"] details summary',
			'[data-ai-script] summary'
		]) {
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
			frameHeightPx={240}
		/>
	{/snippet}
</Story>

<!--
	Flat, the inputs list was one run of names with no way to tell whose file was
	whose — and the node is exactly what an Add, a Replace or a Remove acts on. So
	files sit indented under the node they hang off: this node first, then each
	neighbour, whose own header *is* its text input rather than a row above one.
-->
<Story
	name="InputsAreGroupedUnderTheNodeEachFileHangsOff"
	play={async ({ canvasElement }) => {
		const groups = workbench(canvasElement).querySelectorAll('[data-ai-input-group]');
		expect([...groups].map((group) => group.getAttribute('data-ai-input-group'))).toEqual([
			'ai',
			'bench'
		]);

		// The one thing about this list that surprises people, said under the
		// heading and before the first group: the bytes were copied at attach time,
		// so a file edited on disk since then is not what the next run will read.
		// The reader who hit this had edited a CSV and pressed Run twice.
		const note = required(canvasElement, '[data-ai-inputs-note]');
		expect(note.textContent?.trim()).toBe(
			'Attached files are copies. To bring in an edited file, use Replace on its row.'
		);
		expect(note.compareDocumentPosition(groups[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

		// This node leads, named for where the reader is standing rather than by
		// its own title, and it is the group that offers Add file.
		const own = required(canvasElement, '[data-ai-input-group="ai"]');
		expect(own).toHaveAttribute('data-ai-input-group-kind', 'self');
		expect(text(own, '[data-ai-input-group-name]')).toBe('This node');
		expect(own.querySelector('[data-ai-add-file]')).not.toBeNull();
		expect(text(own, '[data-ai-input-name]')).toBe('notes.csv');

		// The neighbour's header is its text input: the title, the edge's role, and
		// the description the request carries — no separate row for any of it.
		const bench = required(canvasElement, '[data-ai-input-group="bench"]');
		expect(bench).toHaveAttribute('data-ai-input-group-kind', 'neighbour');
		const head = required(bench, '[data-ai-input-group-head]');
		expect(head).toHaveAttribute('data-ai-input-kind', 'text');
		expect(text(head, '[data-ai-input-name]')).toBe('Bench run 3');
		expect(text(head, '[data-ai-input-label]')).toBe('baseline');
		expect(text(bench, '[data-ai-input-description]')).toContain('20 °C');

		// And its file is under it, indented by the rule that makes the grouping
		// visible rather than merely true of the DOM.
		const files = required(bench, 'ul');
		expect(getComputedStyle(files).borderLeftWidth).toBe('2px');
		const row = required(files, '[data-ai-input-kind="file"]');
		expect(row).toHaveAttribute('data-ai-input-node', 'bench');
		expect(text(row, '[data-ai-input-name]')).toBe('measurements.csv');
		// The chip is the group's, said once: repeating it on every file was noise.
		expect(row.querySelector('[data-ai-input-label]')).toBeNull();

		// The header is also the way to the node itself, for a reader who would
		// rather look than take this surface's word.
		await userEvent.click(required(bench, '[data-ai-input-jump="bench"]'));
		expect(harnessState(canvasElement)).toHaveAttribute('data-last-jump', 'bench');
	}}
>
	{#snippet template()}
		<AiNodeHarness baseGraph={graphWithOwnFile()} nodeId="ai" digests={DIGESTS} />
	{/snippet}
</Story>

<!--
	Attaching a file used to mean leaving the workbench for the edit sheet, which
	is two screens away from the Run button that needs the file. The harness
	applies the same `addNodeContentBlock` the app commits, so the row the reader
	gets here is the row the graph gained.
-->
<Story
	name="AddingAFileToThisNodePutsARowUnderIt"
	play={async ({ canvasElement }) => {
		const own = required(canvasElement, '[data-ai-input-group="ai"]');
		expect(own.querySelectorAll('[data-ai-input-kind="file"]')).toHaveLength(0);

		const picker = required(own, '[data-ai-add-file]');
		// Hover-only tooltips are the standing debt, so the meaning is in the name.
		expect(picker).toHaveAttribute('aria-label', 'Add a file to this node');
		await userEvent.upload(picker as HTMLInputElement, pickedFile('ambient.csv'));

		await waitFor(() => {
			const row = required(own, '[data-ai-input-kind="file"]');
			expect(text(row, '[data-ai-input-name]')).toBe('ambient.csv');
		});
		expect(harnessState(canvasElement)).toHaveAttribute('data-last-add', 'ai:ambient.csv');
		// The reader cannot see the result of a file dialog, so the surface says it.
		expect(text(canvasElement, '[data-ai-attachment-status]')).toBe('ambient.csv attached.');
	}}
>
	{#snippet template()}
		<AiNodeHarness baseGraph={aiGraph()} nodeId="ai" digests={DIGESTS} />
	{/snippet}
</Story>

<!--
	Replace is the whole point of the cheap mode: new bytes under the name the
	stored script opens, so a Run reads them without a model call. The block keeps
	its name and only its asset id moves, which is also what makes the note say
	"replaced" rather than one file gone and another arrived.
-->
<Story
	name="ReplacingAFileKeepsTheNameTheScriptOpens"
	play={async ({ canvasElement }) => {
		const content = workbench(canvasElement);
		// The files are the ones the run recorded, so there is nothing to say yet.
		expect(content.querySelector('[data-ai-inputs-changed]')).toBeNull();

		const row = required(canvasElement, '[data-ai-input-asset-id="asset-csv"]');
		const replace = required(row, '[data-ai-replace-file="asset-csv"]');
		expect(replace).toHaveAttribute(
			'aria-label',
			'Replace measurements.csv with a new file under the same name'
		);
		expect(required(row, 'label.row-action')).toHaveAttribute(
			'title',
			'Replace this file with a new one under the same name, so a Run re-reads it'
		);

		await userEvent.upload(replace as HTMLInputElement, pickedFile('measurements-v2.csv'));

		// The name the script opens survives; the bytes behind it are new.
		const replaced = await waitFor(() =>
			required(canvasElement, '[data-ai-input-asset-id="asset-picked-1"]')
		);
		expect(text(replaced, '[data-ai-input-name]')).toBe('measurements.csv');
		expect(content.querySelector('[data-ai-input-asset-id="asset-csv"]')).toBeNull();
		expect(harnessState(canvasElement)).toHaveAttribute(
			'data-last-replace',
			'bench:asset-csv:measurements-v2.csv'
		);

		// And the note says the one thing a replacement means: run it.
		expect(text(canvasElement, '[data-ai-inputs-changed]')).toBe(
			'measurements.csv was replaced since the last run. ' +
				'Run re-runs the script on the new data; Change lets Claude adjust it.'
		);

		// The switch agrees with the note. It used to flip to Change on any file
		// change at all, so the reader who had just swapped one export for another
		// was pushed at a model call that could only rewrite the script it had —
		// and Run, which they picked instead, was the thing that worked.
		expect(required(canvasElement, '[data-ai-mode="rerun"]')).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		expect(text(canvasElement, '[data-ai-run]')).toBe('Run');
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

<!-- No confirm on the way off: milestone 12 made undo the safety net for the
     destructive edits, and this is one of them. -->
<Story
	name="RemovingAFileDropsItsRow"
	play={async ({ canvasElement }) => {
		const remove = required(canvasElement, '[data-ai-remove-file="asset-csv"]');
		expect(remove).toHaveAttribute('aria-label', 'Remove measurements.csv from Bench run 3');

		await userEvent.click(remove);

		await waitFor(() =>
			expect(
				workbench(canvasElement).querySelector('[data-ai-input-asset-id="asset-csv"]')
			).toBeNull()
		);
		expect(harnessState(canvasElement)).toHaveAttribute('data-last-remove', 'bench:asset-csv');
		// The neighbour is still an input — its title and description are sent.
		expect(required(canvasElement, '[data-ai-input-group="bench"]')).not.toBeNull();
	}}
>
	{#snippet template()}
		<AiNodeHarness baseGraph={aiGraph()} nodeId="ai" digests={DIGESTS} />
	{/snippet}
</Story>

<!-- The reader picked a file and nothing happened, because they said no to the
     size question. That needs a sentence, or the button reads as broken. -->
<Story
	name="DecliningTheSizeQuestionSaysSoRatherThanNothing"
	play={async ({ canvasElement }) => {
		const own = required(canvasElement, '[data-ai-input-group="ai"]');
		await userEvent.upload(
			required(own, '[data-ai-add-file]') as HTMLInputElement,
			pickedFile('huge.csv')
		);

		await waitFor(() =>
			expect(text(canvasElement, '[data-ai-attachment-status]')).toBe('Attachment cancelled.')
		);
		expect(own.querySelector('[data-ai-input-kind="file"]')).toBeNull();
		expect(harnessState(canvasElement)).toHaveAttribute('data-last-add', '');
	}}
>
	{#snippet template()}
		<AiNodeHarness
			baseGraph={aiGraph()}
			nodeId="ai"
			digests={DIGESTS}
			warnBytesPerFile={4}
			confirmAttachment={() => false}
		/>
	{/snippet}
</Story>

<!--
	The plots on screen belong to the *last* run while a new one is in flight, and
	a figure that looks current is the one lie this surface can tell. Faded and
	captioned rather than removed: the reader is usually comparing the new answer
	against exactly this one.
-->
<Story
	name="TheLastRunsOutputsFadeWhileANewOneIsInFlight"
	play={async ({ canvasElement }) => {
		expect(text(canvasElement, '[data-ai-outputs-stale-while-running]')).toBe('from the last run');
		const body = required(canvasElement, '[data-ai-outputs-body]');
		expect(getComputedStyle(body).opacity).toBe('0.45');
	}}
>
	{#snippet template()}
		<AiNodeHarness
			baseGraph={aiGraph({ script: SCRIPT, runs: [DONE_RUN] })}
			nodeId="ai"
			digests={DIGESTS}
			assetStore={outputStore()}
			assetScope="story"
			runState={runState({ phase: 'running', text: 'Re-reading the files.' })}
		/>
	{/snippet}
</Story>

<!--
	Claude's prose is what a reader checks once and scrolls past; open by default
	it pushed the plots and the script below the fold. The summary line is what
	keeps folding it honest — the first sentence is the answer often enough to
	save the click.
-->
<Story
	name="ClaudesProseIsOneLineUntilItIsAskedFor"
	play={async ({ canvasElement }) => {
		const prose = required(canvasElement, '[data-ai-prose]');
		expect(prose).toBeInstanceOf(HTMLDetailsElement);
		expect((prose as HTMLDetailsElement).open).toBe(false);
		expect(text(prose, '[data-ai-prose-preview]')).toBe(
			'Both files plotted on shared axes; channel 2 drifts after the third minute.'
		);

		await userEvent.click(required(prose, 'summary'));
		await waitFor(() => expect((prose as HTMLDetailsElement).open).toBe(true));
		expect(text(prose, '[data-ai-summary]')).toContain('shared axes');

		// What a reader acts on stays outside the fold: the script rows, and the
		// errors and tracebacks that come with them.
		expect(prose.querySelector('[data-ai-steps]')).toBeNull();
		expect(required(canvasElement, '[data-ai-steps]')).not.toBeNull();
	}}
>
	{#snippet template()}
		<AiNodeHarness
			baseGraph={aiGraph({ script: SCRIPT, runs: [DONE_RUN] })}
			nodeId="ai"
			digests={DIGESTS}
			runState={runState({ steps: [{ stdoutTail: 'Wrote channel2.png', exitCode: 0 }] })}
		/>
	{/snippet}
</Story>

<!--
	The preview depth is a ceiling, not a promise about this file: "(5 rows)" over
	a two-row CSV claimed three rows that do not exist.
-->
<Story
	name="AFileShorterThanThePreviewSaysAllOfIt"
	args={{
		digests: {
			'asset-csv': {
				name: 'measurements.csv',
				size: 2048,
				kind: 'table',
				columns: ['time', 'ch2'],
				dtypes: ['float64', 'float64'],
				rows: 2,
				head: [
					['0.0', '1.1'],
					['0.1', '1.2']
				]
			} satisfies FileDigest
		}
	}}
	play={async ({ canvasElement }) => {
		expect(
			required(canvasElement, '[data-ai-input-kind="file"] details summary').textContent?.trim()
		).toBe('What Claude will see (all 2 rows)');
	}}
/>
