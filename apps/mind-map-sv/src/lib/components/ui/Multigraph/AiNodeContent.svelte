<script lang="ts">
	/**
	 * The `!ai` node's workbench: the focus-content variant that sits beside
	 * `NodeDetailsContent` and is chosen when the focused node carries the add-on.
	 *
	 * Top to bottom it is one working order: the prompt, how to run it and the
	 * press that does, what the run is doing right now, what came back, what
	 * will be sent, the script that produced it, and what it cost. The controls
	 * lead because a surface with several input files is taller than the frame,
	 * and a Run button below the fold is a Run button nobody finds. Nothing here
	 * talks to the network, the graph or the Python runtime — every act is a
	 * callback, and every state the run pipeline can be in arrives as
	 * `runState`, so this file is drawable from a story with fixed data.
	 *
	 * ## Why this one *is* a scroll container
	 *
	 * Focus mode's reader scrolls by zooming: a wheel over the surface reaches
	 * `ZoomWorld` underneath and moves the world, exactly as it does over
	 * `NodeDetailsContent`, whose story still pins that nothing in *its* subtree
	 * may become scrollable. A workbench is taller than a details view — several
	 * inputs, a live run and its outputs — and the world's pan clamp puts
	 * below-frame content out of reach, so the whole surface is one scroller
	 * bounded by the frame instead. `ZoomWorld` reads the `data-zoom-scroll`
	 * marker on this root and hands the wheel over while there is somewhere left
	 * to scroll; at the ends it takes the wheel back and does nothing with it —
	 * the one exception being a plot in the output grid under the cursor, which a
	 * zoom-in opens. The wheel never leaves focus from in here; Close does (see
	 * `lib/nestedScrollTarget.ts`).
	 * Exactly one scroller, on the root: the prompt
	 * field still grows to its text and every `<pre>` still wraps, so no inner
	 * box competes for the same gesture. Pointer presses need no handling
	 * either: `ZoomWorld` already declines to start a pan on a press that lands
	 * on a control (see `startsOnInteractiveContent`), which is what makes the
	 * textarea's caret and every button here work. Escape belongs to the focus
	 * layer, so nothing here listens for it.
	 */
	import { untrack } from 'svelte';
	import { APP_CONFIG } from '$lib/appConfig';
	import type { GraphAssetStore } from '$lib/assets/assetStore';
	import { renderDigest, type DigestUnavailableReason, type FileDigest } from '$lib/ai/probeScript';
	import { prefersReducedMotion } from '$lib/reducedMotion';
	import type { GraphAssetMetadata } from '../types/multigraph';
	import type { AiAddon, AiRunMode, AiRunOutput, NodeData } from '../types/node';
	import { groupAiInputs, type AiFileInput, type AiInput, type AiInputGroup } from './lib/aiInputs';
	import {
		defaultRunMode,
		digestDisclosureLabel,
		inputChangesForAddon,
		inputChangesNote,
		latestDoneRun,
		prosePreviewLine,
		runMetadataLine,
		staleOutputNames,
		IDLE_RUN_STATE,
		type AiRunState
	} from './lib/aiWorkbenchView';
	import { attachmentSizeWarning } from './lib/attachmentSizeWarning';
	import { formatByteSize } from './lib/byteSize';

	/** What a node without the add-on reads as, so this never renders half a surface. */
	const EMPTY_AI: AiAddon = { prompt: '', runs: [], promoted: {} };

	const NO_INPUTS: AiInput[] = [];
	const NO_DIGESTS: Record<string, FileDigest> = {};

	/** Why Change and Run are out of reach, said once and shown twice. */
	const NO_SCRIPT_REASON = 'No stored script yet — write one first.';

	/**
	 * What Replace is for, in the terms that make it worth having: the block keeps
	 * the name, so the stored script goes on opening it and a Run reads the new
	 * bytes without a model call.
	 */
	const REPLACE_HINT = 'Replace this file with a new one under the same name, so a Run re-reads it';

	/**
	 * The three modes, in the order they become available to a node: write a
	 * script, change it, run it again.
	 *
	 * `label` names the mode on the switch; `run` names the *act* on the button
	 * beside it, because the switch is a choice and the button is what happens.
	 * `running` is that same act in flight, so the one button that runs three
	 * different things still says which one is out — a bare spinner cannot.
	 * The names are verbs in the reader's own words — Write, Change, Run —
	 * rather than the persisted `AiRunMode` values (`analyse`, `refine`,
	 * `rerun`), which stay as they are in every stored run.
	 */
	const MODES: { mode: AiRunMode; label: string; run: string; running: string; hint: string }[] = [
		{
			mode: 'analyse',
			label: 'Write',
			run: 'Write & run',
			running: 'Writing…',
			hint: 'Claude writes a new script from the prompt and runs it'
		},
		{
			mode: 'refine',
			label: 'Change',
			run: 'Change & run',
			running: 'Changing…',
			hint: 'Claude changes the stored script to match the prompt and runs it'
		},
		{
			mode: 'rerun',
			label: 'Run',
			run: 'Run',
			running: 'Running…',
			// It names the trap rather than the saving: Run calls no model, and every
			// attached file reaches the script on every run — but a script that opens
			// fixed filenames never looks at a new one, and nothing about that answer
			// looks wrong. Two earlier wordings said this in terms the reader does not
			// have: "read only if the script reads by pattern" was the script's own
			// vocabulary, and "scans its folder" named a folder nobody had been shown.
			// What is left is the only distinction that matters to the reader, put as
			// two scripts they can imagine.
			hint:
				'Runs the stored script again on the current files. A script that opens files by name ' +
				"won't notice a new one; a script that reads every attached file will."
		}
	];

	let {
		node,
		inputs = NO_INPUTS,
		digests = NO_DIGESTS,
		previewRows = APP_CONFIG.ai.previewRows,
		assets = {},
		assetStore = null,
		assetScope = '',
		runState = IDLE_RUN_STATE,
		hasKey = false,
		model = APP_CONFIG.ai.defaultModel,
		titleForNodeId = (nodeId: string) => nodeId,
		nodeExists = () => true,
		confirmAttachment = (message: string) => window.confirm(message),
		warnBytesPerFile = APP_CONFIG.multigraph.attachments.warnBytesPerFile,
		onPromptChange,
		onRun,
		onCancel,
		onPromote,
		onFix,
		onOpenSettings,
		onJumpToNode,
		onAddFile,
		onReplaceFile,
		onRemoveFile
	}: {
		/** The focused node. Its `addons.ai` is what this whole surface draws. */
		node: NodeData;
		/** What a run would send, already collected by `collectAiInputs`. */
		inputs?: AiInput[];
		/**
		 * The digest of each input file, keyed by asset id. A file with no entry
		 * is still being measured, which is a state the reader sees rather than a
		 * gap: the digest is what leaves the machine, so its absence is the one
		 * reason not to press Run yet.
		 */
		digests?: Record<string, FileDigest>;
		/**
		 * The reader's preview-row setting, so the digest on screen is the digest
		 * the request will carry. Defaults to the configured depth for a caller
		 * that has no settings in hand.
		 */
		previewRows?: number;
		assets?: Record<string, GraphAssetMetadata>;
		assetStore?: GraphAssetStore | null;
		assetScope?: string;
		/** The run in flight, or `IDLE_RUN_STATE`. Never persisted (see `AiRunState`). */
		runState?: AiRunState;
		/** Whether a key is in hand. Without one, Run is replaced by the way to get one. */
		hasKey?: boolean;
		/**
		 * The model a run would call, named on the connection line so the reader
		 * can see that Connect took — the sheet closing behind them is not, on its
		 * own, evidence of anything. Defaults to the configured model for a caller
		 * with no settings in hand.
		 */
		model?: string;
		/** Names the node a promoted output lives in. Identity for a caller with no graph. */
		titleForNodeId?: (nodeId: string) => string;
		/**
		 * Whether a node id still names a node on the map.
		 *
		 * A binding is `outputName → nodeId`, and the reader can delete that node.
		 * Until this was asked, a binding alone counted as promoted: the row hid
		 * the Promote icon and offered a jump to nothing. So "promoted" is a
		 * question about the graph, not about the add-on, and this is how a caller
		 * with a graph answers it. The default is for a caller that has none —
		 * every binding it is handed is one it invented.
		 */
		nodeExists?: (nodeId: string) => boolean;
		/** The prompt, committed on blur or Cmd+Enter rather than on every keystroke. */
		onPromptChange?: (prompt: string) => void;
		onRun?: (mode: AiRunMode) => void;
		onCancel?: () => void;
		/** Give one output a node of its own, bound by its name. */
		onPromote?: (outputName: string) => void;
		/**
		 * Start a refine run against the traceback on screen. Offered only when
		 * `runState.traceback` is there to send.
		 */
		onFix?: () => void;
		/** Open the key sheet — the only thing offered when there is no key. */
		onOpenSettings?: () => void;
		/** Leave for a promoted node without pinning it, as the details view does. */
		onJumpToNode?: (nodeId: string) => void;
		/**
		 * Attach one picked file to this node. The MIME type decides what block it
		 * becomes, exactly as the edit sheet's two upload buttons decide nothing —
		 * so the workbench offers one button and a PNG picked through it is still
		 * an image.
		 */
		onAddFile?: (nodeId: string, file: File) => Promise<'added' | 'store-failed'>;
		/**
		 * Swap the bytes behind one attachment, keeping the name the script opens.
		 * Offered on a neighbour's files as well as this node's: it is one graph,
		 * and undo covers the edit either way.
		 */
		onReplaceFile?: (
			nodeId: string,
			assetId: string,
			file: File
		) => Promise<'added' | 'store-failed'>;
		/** Take one attachment off its node. Undo is the safety net, so no confirm. */
		onRemoveFile?: (nodeId: string, assetId: string) => void;
		/**
		 * Asks before attaching a file over the per-file size threshold — the same
		 * question the edit sheet asks, because it is the same cost. Injectable so
		 * a story can answer it.
		 */
		confirmAttachment?: (message: string) => boolean;
		/** File size over which `confirmAttachment` is asked. A test pins it. */
		warnBytesPerFile?: number;
	} = $props();

	const ai = $derived(node.addons?.ai ?? EMPTY_AI);
	const hasScript = $derived((ai.script ?? '') !== '');
	const latestRun = $derived(latestDoneRun(ai));
	const metadataLine = $derived(latestRun === undefined ? '' : runMetadataLine(latestRun));
	const staleNames = $derived(staleOutputNames(ai, nodeExists));
	/**
	 * What the files have done since the stored script was written, and the note
	 * that says so. Empty for a node with no script to be out of date.
	 */
	const inputChanges = $derived(inputChangesForAddon(ai, inputs));
	const inputsChangedNote = $derived(inputChangesNote(inputChanges));
	const reduceMotion = $derived(prefersReducedMotion());
	/**
	 * The inputs as the reader reads them: this node first, then each neighbour,
	 * with the files under the node they hang off — which is the node an Add, a
	 * Replace or a Remove on that group acts on.
	 */
	const groups = $derived(groupAiInputs(inputs, node.id));
	/** What the last Add, Replace or Remove did, for a reader who cannot see a file dialog. */
	let attachmentStatus = $state('');

	const busy = $derived(runState.phase === 'running' || runState.phase === 'loading-runtime');

	/**
	 * The prompt as the reader has it, which is not the prompt the graph has
	 * until a commit. Seeded once and re-seeded only when the graph's own prompt
	 * moves underneath — an undo, or another surface editing the same node — so
	 * typing is never fought by a re-render.
	 */
	let promptDraft = $state(untrack(() => (node.addons?.ai ?? EMPTY_AI).prompt));
	let lastSeenPrompt = $state(untrack(() => (node.addons?.ai ?? EMPTY_AI).prompt));
	let promptField = $state<HTMLTextAreaElement | null>(null);
	/**
	 * The mode the reader picked, or `null` for "whatever the node currently
	 * calls for". Cleared on every prompt commit, because a commit is exactly the
	 * event that changes the answer.
	 */
	let modeOverride = $state<AiRunMode | null>(null);
	/** One object URL per output blob, revoked when the run or the node changes. */
	let assetUrls = $state<Record<string, string>>({});

	const fallbackMode = $derived(defaultRunMode(ai, inputs));
	/**
	 * The reader's pick, or what the node calls for. A pick that needs the stored
	 * script falls back once the script goes — an undo can take it away while the
	 * switch is sitting on Change, and running a Write in Change's clothing
	 * would be worse than moving the highlight.
	 */
	const mode = $derived<AiRunMode>(
		modeOverride === null || (modeOverride !== 'analyse' && !hasScript)
			? fallbackMode
			: modeOverride
	);

	/** The selected row of `MODES`; `analyse` is the one every node always has. */
	const selectedMode = $derived(MODES.find((option) => option.mode === mode) ?? MODES[0]);

	/**
	 * The status line is about a press the reader made on *this* node. Focus can
	 * move to another `!ai` node without this component being rebuilt, and
	 * "ambient.csv attached." sitting over a node it was never attached to is a
	 * lie that costs nothing to avoid.
	 */
	$effect(() => {
		void node.id;
		untrack(() => (attachmentStatus = ''));
	});

	$effect(() => {
		const current = ai.prompt;
		if (current === untrack(() => lastSeenPrompt)) return;
		lastSeenPrompt = current;
		promptDraft = current;
	});

	/**
	 * Grow the field to its text instead of scrolling it. `auto` first, so the
	 * measured `scrollHeight` is the content's height rather than the height the
	 * field already had — without it a field only ever grows.
	 */
	$effect(() => {
		const field = promptField;
		if (field === null) return;
		// Read so the effect re-runs on every keystroke; the write below is what
		// the measurement is for.
		void promptDraft;
		field.style.height = 'auto';
		field.style.height = `${field.scrollHeight}px`;
	});

	const outputs = $derived<AiRunOutput[]>(latestRun?.outputs ?? []);
	const imageOutputs = $derived(outputs.filter((output) => output.mimeType.startsWith('image/')));
	const fileOutputs = $derived(outputs.filter((output) => !output.mimeType.startsWith('image/')));

	/**
	 * Object URLs for the outputs on screen, built up front for the same reason
	 * `NodeDetailsContent` builds them up front: Open is an `<a href>`, and a
	 * blob fetched from IndexedDB behind the tap would put an `await` between the
	 * press and the navigation, which is the gap mobile Safari's popup blocker
	 * and a `file://` page both refuse.
	 */
	$effect(() => {
		let cancelled = false;
		const urlsToRevoke: string[] = [];
		const wanted = outputs.map((output) => output.assetId);
		const store = assetStore;
		const scope = assetScope;

		async function loadOutputs(): Promise<void> {
			if (store === null || scope === '') return;
			const loaded: Record<string, string> = {};
			for (const assetId of wanted) {
				const asset = await store.get(scope, assetId);
				if (!asset.ok) continue;
				const url = URL.createObjectURL(asset.value.blob);
				urlsToRevoke.push(url);
				loaded[assetId] = url;
			}
			if (!cancelled) assetUrls = loaded;
		}

		void loadOutputs();
		return () => {
			cancelled = true;
			for (const url of urlsToRevoke) URL.revokeObjectURL(url);
		};
	});

	function commitPrompt(): void {
		if (promptDraft === ai.prompt) return;
		lastSeenPrompt = promptDraft;
		modeOverride = null;
		onPromptChange?.(promptDraft);
	}

	/**
	 * Cmd+Enter commits without leaving the field, so a reader can settle the
	 * prompt and press Run without a round trip through blur. Ctrl+Enter too:
	 * the same keystroke on the other platform.
	 */
	function handlePromptKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
		event.preventDefault();
		commitPrompt();
	}

	/** A stable key per file row: the same asset can be attached twice over. */
	function fileKey(input: AiFileInput, index: number): string {
		return `${index}:${input.nodeId}:${input.assetId}`;
	}

	/** How the accessible name of a row action names the node it acts on. */
	function groupName(group: AiInputGroup): string {
		return group.self ? 'this node' : group.title;
	}

	/**
	 * The picked file, and the input it came from with its value already cleared
	 * — so picking the same file twice in a row fires `change` the second time,
	 * and so the reader's filename is not left sitting in a control that has
	 * already acted on it.
	 */
	function takePickedFile(event: Event): File | undefined {
		// Svelte types `currentTarget` broadly; this handler is only ever attached
		// to a file input.
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		return file;
	}

	/**
	 * The size question, asked once for Add and Replace alike. A cancelled answer
	 * is reported rather than swallowed: the reader pressed something and nothing
	 * happened, which needs a sentence.
	 */
	function allowedBySize(file: File): boolean {
		if (file.size <= warnBytesPerFile) return true;
		if (confirmAttachment(attachmentSizeWarning(file))) return true;
		attachmentStatus = 'Attachment cancelled.';
		return false;
	}

	async function addPickedFile(event: Event): Promise<void> {
		const file = takePickedFile(event);
		if (file === undefined || onAddFile === undefined) return;
		attachmentStatus = '';
		if (!allowedBySize(file)) return;
		const result = await onAddFile(node.id, file);
		attachmentStatus = result === 'added' ? `${file.name} attached.` : 'Unable to store that file.';
	}

	async function replacePickedFile(event: Event, target: AiFileInput): Promise<void> {
		const file = takePickedFile(event);
		if (file === undefined || onReplaceFile === undefined) return;
		attachmentStatus = '';
		if (!allowedBySize(file)) return;
		const result = await onReplaceFile(target.nodeId, target.assetId, file);
		attachmentStatus =
			result === 'added'
				? `${target.name} replaced. The script still opens that name.`
				: 'Unable to store that file.';
	}

	function removeFile(input: AiFileInput): void {
		attachmentStatus = '';
		onRemoveFile?.(input.nodeId, input.assetId);
	}

	/**
	 * The shape of a table, for the input's one line: `3 columns, 10000 rows`.
	 * Empty for anything the probe could not read as a table, whose row then
	 * reads as name and size — which is all there is to say about it.
	 */
	function digestShape(digest: FileDigest): string {
		if (digest.kind !== 'table') return '';
		const parts: string[] = [];
		const columns = digest.columns?.length ?? 0;
		if (columns > 0) parts.push(`${columns} ${columns === 1 ? 'column' : 'columns'}`);
		if (digest.rows !== undefined) {
			parts.push(`${digest.rows} ${digest.rows === 1 ? 'row' : 'rows'}`);
		}
		return parts.join(', ');
	}

	/**
	 * Why a file has no digest, in the reader's terms.
	 *
	 * Two different facts, and the difference is what to do about them: bytes
	 * this browser does not hold are a syncing problem, and a runtime that did
	 * not load is a network one that took every file with it.
	 */
	function digestUnavailableText(reason: DigestUnavailableReason): string {
		return reason === 'runtime' ? 'Python runtime unavailable' : 'Unavailable in this browser';
	}

	function runtimeProgressText(): string {
		const progress = runState.runtimeProgress;
		if (progress === undefined) return 'Loading the Python runtime.';
		const loaded = formatByteSize(progress.loadedBytes);
		return progress.totalBytes === undefined
			? `Loading the Python runtime — ${loaded} so far.`
			: `Loading the Python runtime — ${loaded} of ${formatByteSize(progress.totalBytes)}.`;
	}

	function stepStatusText(exitCode: number | null): string {
		if (exitCode === null) return 'running';
		return exitCode === 0 ? 'finished' : `failed, exit ${exitCode}`;
	}

	/**
	 * The response on screen: what is streaming while a run is live, and the
	 * stored summary of the last completed run once nothing is.
	 */
	const streamedText = $derived(runState.phase === 'idle' ? '' : runState.text);
	const storedSummary = $derived(
		runState.phase === 'idle' && runState.error === undefined ? (latestRun?.summary ?? '') : ''
	);
	const showLive = $derived(
		runState.phase !== 'idle' || runState.error !== undefined || runState.steps.length > 0
	);

	/**
	 * Whether there is a run to say anything about. A node that has never run has
	 * none, and an empty disclosure titled "What Claude did" is a promise about a
	 * thing that has not happened — but a run in flight that has not spoken yet
	 * does have one, and its summary line is where "Running…" belongs.
	 */
	const showProse = $derived(showLive || storedSummary.trim() !== '');
	const prosePreview = $derived(prosePreviewLine(runState, storedSummary));
</script>

{#snippet outputActions(output: AiRunOutput)}
	<!--
		The binding, and then the question the binding cannot answer: the reader may
		have deleted the node it names. A binding to a node that is gone is not a
		promotion, so the row offers Promote again — pressing it makes a fresh node
		and rebinds, which is what `promoteAiOutput` does with a dangling binding.
	-->
	{@const boundNodeId = ai.promoted[output.name]}
	{@const promotedNodeId =
		boundNodeId !== undefined && nodeExists(boundNodeId) ? boundNodeId : undefined}
	<div class="output-actions">
		{#if promotedNodeId === undefined}
			<!--
				An icon, because the row is already a name, a picture and an action, and
				"Promote" was a word the reader had to translate. The glyph points out
				of the row and onto the map, which is where the press sends the output;
				the `aria-label` says it in words for anyone not reading glyphs, and the
				`title` says what it will do. Hover-only, which is the debt in
				`docs/debt/2026-08-30-tooltips-are-hover-only.md` — this surface has no
				tooltip component to borrow.
			-->
			<button
				type="button"
				class="promote"
				data-ai-promote={output.name}
				aria-label="Give this output its own node"
				title="Gives this output its own node on the map, linked to this one and refreshed each time this node runs."
				onclick={() => onPromote?.(output.name)}
			>
				<span aria-hidden="true">⤴</span>
			</button>
		{:else}
			<span class="promoted-note">In</span>
			<button
				type="button"
				class="jump"
				data-ai-jump={promotedNodeId}
				onclick={() => onJumpToNode?.(promotedNodeId)}
			>
				{titleForNodeId(promotedNodeId)}
			</button>
		{/if}
	</div>
{/snippet}

<!--
	`data-zoom-scroll` is the whole of the arrangement with `ZoomWorld`: it yields
	the wheel to this box while the box can still move, and takes it back at
	either end. See the note at the top of the script.
-->
<div
	class="focus-content ai-workbench"
	data-ai-workbench
	data-zoom-scroll
	data-focus-zoom-scale="1"
>
	<section class="prompt-section">
		<label class="section-label" for="ai-prompt-{node.id}">Prompt</label>
		<textarea
			id="ai-prompt-{node.id}"
			class="prompt"
			data-ai-prompt
			rows="3"
			bind:this={promptField}
			bind:value={promptDraft}
			placeholder="Plot channel 2 against time for each file on shared axes."
			onblur={commitPrompt}
			onkeydown={handlePromptKeydown}
		></textarea>
	</section>

	<section class="run-section" data-ai-run-controls>
		{#if inputsChangedNote !== ''}
			<!--
				Above the switch, because it is about the choice the switch is for: Run
				would send the stored script at files it was never written to open, and
				nothing about that failure looks like a failure.
			-->
			<p class="inputs-changed" data-ai-inputs-changed>{inputsChangedNote}</p>
		{/if}
		<!--
			A labelled switch rather than three bare buttons. Without the label and
			the filled selection the row read as three actions, so pressing one
			looked like an action that did nothing — the mode is a choice, and the
			button beside it is the act.
		-->
		<div class="mode-block">
			<span class="section-label" id="ai-mode-label-{node.id}">Mode</span>
			<div class="modes" role="group" aria-labelledby="ai-mode-label-{node.id}">
				{#each MODES as option (option.mode)}
					<!-- Both of the other modes work *from* the stored script, so both are
					     out of reach until a run has written one. -->
					{@const disabled = option.mode !== 'analyse' && !hasScript}
					<button
						type="button"
						class="mode"
						data-ai-mode={option.mode}
						aria-pressed={mode === option.mode}
						{disabled}
						title={disabled ? NO_SCRIPT_REASON : option.hint}
						onclick={() => (modeOverride = option.mode)}
					>
						{option.label}
					</button>
				{/each}
			</div>
			<!-- What the selected mode will do, under the switch that selected it. -->
			<p class="mode-hint" data-ai-mode-hint>{selectedMode.hint}</p>
		</div>

		{#if !hasScript}
			<!-- The disabled buttons carry the reason as a tooltip, and a disabled
			     button does not reliably show one — so the reason is also on the
			     screen, where a reader who cannot hover will find it. -->
			<p class="mode-note" data-ai-mode-note>{NO_SCRIPT_REASON}</p>
		{/if}

		<div class="run-actions">
			{#if hasKey}
				<!-- The button names the act of the selected mode, so the switch and the
				     press agree about what is going to happen. -->
				<button
					type="button"
					class="primary"
					data-ai-run
					disabled={busy}
					onclick={() => onRun?.(mode)}
				>
					{#if busy}
						<span class="dot" class:reduced-motion={reduceMotion} aria-hidden="true"
						></span>{selectedMode.running}
					{:else}
						{selectedMode.run}
					{/if}
				</button>
			{:else}
				<!-- The milestone's one-screen key flow, reached from the workbench: no
				     key means there is nothing to press Run for, so the button says
				     what actually has to happen first. -->
				<button type="button" class="primary" data-ai-connect onclick={() => onOpenSettings?.()}>
					Connect to Claude
				</button>
			{/if}
			<button
				type="button"
				class="cancel"
				data-ai-cancel
				disabled={!busy}
				onclick={() => onCancel?.()}
			>
				Cancel
			</button>
		</div>

		<!--
			Whether the key took, said here rather than left to the toolbar's fill.
			Connect closes the sheet, and a sheet closing is not evidence of
			anything; naming the model is.
		-->
		<p class="connection" data-ai-connection={hasKey ? 'connected' : 'disconnected'}>
			<span class="status-dot" class:on={hasKey} aria-hidden="true"></span>
			{hasKey ? `Connected · ${model}` : 'Not connected'}
		</p>
	</section>

	{#if showProse}
		<!--
			Claude's own words, folded away.
			The reader came for the plots and the script; the prose is what they check
			once and then scroll past, and open by default it pushed everything that
			followed below the fold. The summary line is what keeps it honest — the
			first sentence is the answer often enough to save the click, and while a
			run is live it says what is happening instead. What stays outside is what
			a reader acts on: the execution rows, the errors and the traceback.
		-->
		<details class="prose-panel" data-ai-prose>
			<summary>
				<span class="prose-title">What Claude did</span>
				<span class="prose-preview" data-ai-prose-preview>{prosePreview}</span>
			</summary>
			<div class="prose-body">
				{#if streamedText.trim() !== ''}
					<p class="response" data-ai-stream-text>{streamedText}</p>
				{/if}

				{#if storedSummary.trim() !== ''}
					<p class="response" data-ai-summary>{storedSummary}</p>
				{/if}

				{#if runState.thinking.trim() !== ''}
					<!-- Folded once more inside the fold: a thinking summary is about how
					     the answer was reached, which is a further question than the
					     answer itself. -->
					<details class="thinking" data-ai-thinking>
						<summary>Thinking</summary>
						<p data-ai-thinking-text>{runState.thinking}</p>
					</details>
				{/if}

				{#if streamedText.trim() === '' && storedSummary.trim() === '' && runState.thinking.trim() === ''}
					<p class="empty" data-ai-prose-empty>Nothing said yet.</p>
				{/if}
			</div>
		</details>
	{/if}

	{#if showLive}
		<section class="live-section" data-ai-live data-ai-phase={runState.phase}>
			{#if runState.phase === 'loading-runtime'}
				<p class="runtime" data-ai-runtime-progress aria-live="polite">
					{runtimeProgressText()}
					<span class="runtime-note">Tens of megabytes, once per browser — cached after that.</span>
				</p>
			{/if}

			{#if runState.phase === 'running'}
				<p class="running" class:reduced-motion={reduceMotion} data-ai-running aria-live="polite">
					<span class="dot" aria-hidden="true"></span>Running
				</p>
			{/if}

			{#if runState.steps.length > 0}
				<ol class="steps" data-ai-steps>
					{#each runState.steps as step, index (index)}
						<li
							data-ai-step={index + 1}
							data-ai-step-exit-code={step.exitCode === null ? 'running' : `${step.exitCode}`}
						>
							<p class="step-head">
								<strong>analysis.py</strong>
								<span data-ai-step-status>{stepStatusText(step.exitCode)}</span>
							</p>
							<pre class="stdout" data-ai-step-stdout>{step.stdoutTail}</pre>
						</li>
					{/each}
				</ol>
			{/if}

			{#if runState.error !== undefined}
				<!-- Refusals and failures land in the same place the response would,
				     which is the milestone's rule; the flag is what separates "Claude
				     declined" from "something broke" without parsing the sentence. -->
				<div
					class="error"
					class:refusal={runState.refusal === true}
					data-ai-error
					data-ai-refusal={runState.refusal === true ? 'true' : 'false'}
					role="alert"
				>
					<p>
						<strong
							>{runState.refusal === true
								? 'Claude declined this request.'
								: 'The run failed.'}</strong
						>
						<span data-ai-error-text>{runState.error}</span>
					</p>
					{#if runState.traceback !== undefined}
						<!-- A re-run calls no model, so nothing has explained this failure
						     to the reader: the traceback is the whole of what is known,
						     and the button hands exactly it to a refine run. -->
						<pre class="stdout" data-ai-traceback>{runState.traceback}</pre>
						<div class="fix-actions">
							<button type="button" data-ai-fix disabled={busy} onclick={() => onFix?.()}>
								Fix with AI
							</button>
						</div>
					{/if}
				</div>
			{/if}
		</section>
	{/if}

	{#if outputs.length > 0}
		<section class="outputs-section" data-ai-outputs>
			<h3 class="section-label">Outputs</h3>
			{#if busy}
				<!--
					These are the *last* run's outputs, and a run is in flight: a plot that
					looks current is the one way this surface can lie. Faded and captioned
					rather than hidden, because the reader is often comparing the new
					answer against exactly this one — and because a grid that vanishes on
					every Run makes the surface jump.
				-->
				<p class="stale-caption" data-ai-outputs-stale-while-running>from the last run</p>
			{/if}
			<div
				class="outputs-body"
				class:while-running={busy}
				class:reduced-motion={reduceMotion}
				data-ai-outputs-body
			>
				{#if imageOutputs.length > 0}
					<!-- The same grid and the same `data-asset-id` the details view draws,
				     which is the whole reason nested zoom works here for free. -->
					<div class="image-grid" aria-label="Run outputs">
						{#each imageOutputs as output (output.assetId)}
							{@const asset = assets[output.assetId]}
							<!-- The name leads, because it is the binding a promoted node is made
						     by and the filename the script has to keep stable between runs.
						     It is also where `<figcaption>` is allowed to sit given the
						     actions row below the frame. -->
							<figure data-ai-output={output.name}>
								<figcaption>{output.name}</figcaption>
								{#if assetUrls[output.assetId]}
									<div class="image-frame" role="presentation">
										<img
											class="focus-image"
											data-asset-id={output.assetId}
											src={assetUrls[output.assetId]}
											alt={output.name}
										/>
									</div>
								{:else}
									<div class="missing-image" role="img" aria-label={output.name}>
										{asset?.name ?? output.name}
									</div>
								{/if}
								{@render outputActions(output)}
							</figure>
						{/each}
					</div>
				{/if}

				{#if fileOutputs.length > 0}
					<ul class="file-list" aria-label="Run output files">
						{#each fileOutputs as output (output.assetId)}
							{@const url = assetUrls[output.assetId]}
							{@const asset = assets[output.assetId]}
							<li data-ai-output={output.name} data-file-asset-id={output.assetId}>
								<div class="file-meta">
									<strong data-file-name>{output.name}</strong>
									<span data-file-type>{output.mimeType}</span>
									<!-- The size comes off the registered metadata rather than the run
								     record, which stores only what binds a promoted node. -->
									<span data-file-size>{formatByteSize(asset?.size ?? 0)}</span>
								</div>
								{#if url}
									<!-- An anchor, for the reason `NodeDetailsContent` gives: the URL is
								     already in hand, so the tap is a navigation the reader made. -->
									<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
									<a class="file-open" data-file-open href={url} target="_blank" rel="noopener"
										>Open</a
									>
								{:else}
									<span class="file-unavailable" data-file-unavailable>Unavailable</span>
								{/if}
								{@render outputActions(output)}
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</section>
	{/if}

	{#if staleNames.length > 0}
		<!-- A promoted figure the latest run stopped drawing keeps its image on the
		     node and says so here. It is not in the grid above by construction —
		     the grid is the latest run's outputs, and these are exactly the names
		     that run did not produce. -->
		<section class="stale-section" data-ai-stale-outputs>
			<h3 class="section-label">Not produced by the last run</h3>
			<ul>
				{#each staleNames as name (name)}
					{@const promotedNodeId = ai.promoted[name]}
					<li data-ai-stale-output={name}>
						<strong>{name}</strong>
						<span class="stale-mark" data-ai-stale>stale</span>
						{#if promotedNodeId !== undefined}
							<span class="promoted-note">In</span>
							<button
								type="button"
								class="jump"
								data-ai-jump={promotedNodeId}
								onclick={() => onJumpToNode?.(promotedNodeId)}
							>
								{titleForNodeId(promotedNodeId)}
							</button>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<!--
		Below the controls and the answer, because it is the part a reader checks
		rather than the part they act on.

		Grouped by the node each file hangs off, this node first. Flat, it was one
		list of names with no way to tell whose file was whose — and the node is
		exactly what an Add, a Replace or a Remove acts on, so the group header is
		where those actions can sit and mean something. A neighbour's title and
		description *are* its input, so the header is that input rather than a row
		above it; only this node's own header is not an input at all, which is why
		it carries no `data-ai-input`.
	-->
	<section class="inputs-section" data-ai-inputs>
		<h3 class="section-label">Inputs</h3>
		<!--
			The one thing about attaching a file that surprises people: the bytes are
			copied into the graph when the file is attached, so editing the original
			on disk changes nothing here and a re-run reads the same numbers it read
			last time. Said once, under the heading, and quietly — it is a fact about
			the list rather than a warning about anything the reader just did — and it
			names the way out on the same line, because Replace is already on every
			row and nobody was reading it as "bring in the new version".
		-->
		<p class="inputs-note" data-ai-inputs-note>
			Attached files are copies. To bring in an edited file, use Replace on its row.
		</p>
		{#if attachmentStatus !== ''}
			<!-- A file dialog is a thing the reader cannot see the result of, and a
			     cancelled or failed one leaves the list looking exactly as it did. -->
			<p class="attachment-status" data-ai-attachment-status aria-live="polite">
				{attachmentStatus}
			</p>
		{/if}
		{#each groups as group (group.nodeId)}
			<section
				class="input-group"
				data-ai-input-group={group.nodeId}
				data-ai-input-group-kind={group.self ? 'self' : 'neighbour'}
			>
				{#if group.self}
					<div class="group-head" data-ai-input-group-head>
						<strong data-ai-input-group-name>This node</strong>
						<div class="group-actions">
							<!-- One button, not the sheet's two: the file's own type decides
							     what it becomes, so an image picked here is still an image. -->
							<label
								class="add-file"
								title="Attaches a file to this node, so the next run reads it."
							>
								Add file
								<input
									type="file"
									data-ai-add-file
									aria-label="Add a file to this node"
									onchange={addPickedFile}
								/>
							</label>
						</div>
					</div>
					{#if inputs.length === 0}
						<p class="empty" data-ai-inputs-empty>
							Nothing attached yet. Attach files here, or connect a node that has some.
						</p>
					{/if}
				{:else}
					<div
						class="group-head"
						data-ai-input
						data-ai-input-kind="text"
						data-ai-input-node={group.nodeId}
						data-ai-input-group-head
					>
						<strong data-ai-input-name>{group.title}</strong>
						{#if group.label}
							<span class="label-chip" data-ai-input-label>{group.label}</span>
						{/if}
						<div class="group-actions">
							<!-- The way to the node whose files these are, for a reader who
							     wants to see it rather than take this surface's word. -->
							<button
								type="button"
								class="jump"
								data-ai-input-jump={group.nodeId}
								title="Opens this node, without pinning it."
								onclick={() => onJumpToNode?.(group.nodeId)}
							>
								Open
							</button>
						</div>
					</div>
					{#if group.description.trim() !== ''}
						<p class="input-description" data-ai-input-description>{group.description}</p>
					{/if}
				{/if}

				{#if group.files.length > 0}
					<ul class="group-files">
						{#each group.files as input, index (fileKey(input, index))}
							{@const digest = digests[input.assetId]}
							<li
								data-ai-input
								data-ai-input-kind="file"
								data-ai-input-node={input.nodeId}
								data-ai-input-asset-id={input.assetId}
							>
								<div class="input-top">
									<div class="input-head" data-ai-digest-summary>
										<strong data-ai-input-name>{input.name}</strong>
										<span class="input-size" data-ai-input-size>{formatByteSize(input.size)}</span>
										{#if digest && digestShape(digest) !== ''}
											<span class="input-shape" data-ai-input-shape>{digestShape(digest)}</span>
										{/if}
									</div>
									<!--
										Two icons, and the meaning lives in the accessible name rather
										than the tooltip: `title` is hover-only, which is the standing
										debt in `docs/debt/2026-08-30-tooltips-are-hover-only.md`, so a
										phone reader would otherwise get a glyph and nothing else.
									-->
									<div class="row-actions">
										<label class="row-action" title={REPLACE_HINT}>
											<span aria-hidden="true">⇄</span>
											<input
												type="file"
												data-ai-replace-file={input.assetId}
												aria-label="Replace {input.name} with a new file under the same name"
												onchange={(event) => replacePickedFile(event, input)}
											/>
										</label>
										<button
											type="button"
											class="row-action"
											data-ai-remove-file={input.assetId}
											aria-label="Remove {input.name} from {groupName(group)}"
											title="Removes this file. Undo puts it back."
											onclick={() => removeFile(input)}
										>
											<span aria-hidden="true">✕</span>
										</button>
									</div>
								</div>
								{#if digest}
									{#if digest.kind === 'table'}
										<!-- Exactly what the request will carry about this file, rendered
										     through the same function that builds it, so the promise the
										     settings sheet makes is checkable on screen — by a reader who
										     asks for it, rather than at everyone all the time. -->
										<details class="digest-panel">
											<summary>{digestDisclosureLabel(previewRows, digest)}</summary>
											<pre class="digest" data-ai-digest>{renderDigest(digest, previewRows)}</pre>
										</details>
									{:else if digest.kind === 'unavailable'}
										<!-- Nothing was measured and nothing is coming: the name and the
										     size above are the whole of what is known, and this says why
										     there is no disclosure under them. Not an error block — the
										     other files are fine, and this one is a fact about this row. -->
										<p class="unavailable" data-ai-digest-unavailable={digest.reason}>
											{digestUnavailableText(digest.reason)}
										</p>
									{/if}
								{:else}
									<p class="pending" data-ai-digest-pending>digesting…</p>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/each}
	</section>

	{#if hasScript}
		<details class="script-panel" data-ai-script>
			<summary>analysis.py</summary>
			<pre class="script" data-ai-script-source>{ai.script}</pre>
		</details>
	{/if}

	{#if metadataLine !== ''}
		<p class="metadata" data-ai-metadata>{metadataLine}</p>
	{/if}
</div>

<style>
	/*
	 * The details view's own shell, repeated rather than shared: both are
	 * focus-content variants and both want the same reading measure, and Svelte
	 * scopes styles per component so there is nothing to import.
	 */
	.focus-content {
		display: grid;
		align-content: start;
		gap: 1rem;
		color: #334155;
		font-size: 1.125rem;
		line-height: 1.65;
	}

	/*
	 * The one scroll container on this surface, bounded by the focus frame.
	 * `100%` resolves because `NodeDetailsLayer` gives the body a definite
	 * height; a caller that does not (a story) leaves it unbounded, which is the
	 * old behaviour rather than a broken one. `hidden auto` rather than
	 * `overflow-y: auto` alone: a single `visible` axis computes to `auto`, and a
	 * horizontal scrollbar is not wanted — every `<pre>` here wraps.
	 * `overscroll-behavior: contain` keeps the end of this scroll from becoming
	 * the page's, and `touch-action: pan-y` reopens the one gesture `ZoomWorld`'s
	 * `touch-action: none` would otherwise take from a finger.
	 */
	.ai-workbench {
		box-sizing: border-box;
		max-height: 100%;
		overflow: hidden auto;
		overscroll-behavior: contain;
		touch-action: pan-y;
	}

	p,
	figure,
	h3 {
		margin: 0;
	}

	ul,
	ol {
		display: grid;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.section-label {
		display: block;
		color: #475569;
		font-size: 0.8125rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.prompt-section,
	.inputs-section,
	.run-section,
	.live-section,
	.outputs-section,
	.stale-section {
		display: grid;
		gap: 0.5rem;
	}

	/*
	 * `overflow: hidden` with a height written by the autosize effect: the field
	 * grows to its text so it never becomes the scroll container this surface
	 * must not have. `hidden` rather than `auto` for the same reason.
	 */
	.prompt {
		box-sizing: border-box;
		width: 100%;
		min-height: 5rem;
		overflow: hidden;
		resize: none;
		border: 1px solid #cbd5e1;
		border-radius: 0.5rem;
		padding: 0.625rem 0.75rem;
		background: #ffffff;
		color: #0f172a;
		font: inherit;
		font-size: 1.0625rem;
		line-height: 1.5;
	}

	.inputs-section li {
		display: grid;
		gap: 0.35rem;
		padding: 0.6rem 0.75rem;
		border: 1px solid #cbd5e1;
		border-radius: 0.5rem;
		background: #f8fafc;
		font-size: 0.95rem;
	}

	/* A group is its header and the files under it; the gap between groups is
	   wider than the one inside a group, which is the whole of what makes the
	   files read as belonging to the node above them. */
	.input-group {
		display: grid;
		gap: 0.35rem;
	}

	.input-group + .input-group {
		margin-top: 0.75rem;
	}

	.group-head {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.group-actions {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-left: auto;
	}

	/* Indented under the header, which is the other half of the grouping: a rule
	   down the left says "these hang off that" without a box around each group. */
	.group-files {
		margin-left: 0.75rem;
		padding-left: 0.75rem;
		border-left: 2px solid #e2e8f0;
	}

	.input-top {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.input-head {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.5rem;
		flex: 1 1 auto;
		min-width: 0;
	}

	.row-actions {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		margin-left: auto;
	}

	/*
	 * The same square target Promote uses, for the same reason: a glyph in a
	 * press big enough for a thumb. The label is a button in everything but
	 * element — it holds the file input that opens the picker.
	 */
	.row-action {
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		padding: 0;
		border: 1px solid #cbd5e1;
		border-radius: 0.4rem;
		background: #f8fafc;
		color: #334155;
		font-size: 1rem;
		line-height: 1;
		cursor: pointer;
	}

	.add-file {
		border: 1px solid #cbd5e1;
		border-radius: 0.4rem;
		padding: 0.35rem 0.75rem;
		background: #f8fafc;
		color: #334155;
		font-size: 0.95rem;
		cursor: pointer;
	}

	/*
	 * The file inputs themselves are off-screen rather than `display: none`: a
	 * hidden input is not focusable, and the label's press is the only way in for
	 * a mouse. `overflow: hidden` and not `auto` — this surface admits exactly
	 * one scroller.
	 */
	.row-action input,
	.add-file input {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}

	.attachment-status {
		color: #475569;
		font-size: 0.875rem;
	}

	.label-chip {
		border-radius: 999px;
		padding: 0.05rem 0.5rem;
		background: #e2e8f0;
		color: #334155;
		font-size: 0.8125rem;
	}

	.input-size,
	.input-shape,
	.pending,
	.unavailable,
	.input-description {
		color: #64748b;
		font-size: 0.875rem;
	}

	/*
	 * Only the pending line is italic: it is the one that is still going to
	 * change. An unavailable row is an answer, so it reads like the rest of them.
	 */
	.pending {
		font-style: italic;
	}

	/*
	 * Wrapped rather than scrolled, so a wide digest costs height instead of a
	 * horizontal scrollbar inside a surface whose reader scrolls by zooming.
	 */
	.digest,
	.stdout,
	.script {
		margin: 0;
		border-radius: 0.35rem;
		padding: 0.5rem 0.6rem;
		background: #0f172a;
		color: #e2e8f0;
		font-family: ui-monospace, 'SF Mono', 'Menlo', monospace;
		font-size: 0.8125rem;
		line-height: 1.45;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.digest {
		background: #eef2f7;
		color: #334155;
	}

	.empty {
		color: #64748b;
		font-size: 0.95rem;
	}

	.mode-block {
		display: grid;
		gap: 0.35rem;
		justify-items: start;
	}

	/*
	 * A segmented control: one bordered strip with hairlines between the
	 * segments, so it reads as a choice of three rather than as three buttons
	 * that each do something.
	 */
	.modes {
		display: flex;
		flex-wrap: wrap;
		border: 1px solid #cbd5e1;
		border-radius: 0.5rem;
		overflow: hidden;
		background: #ffffff;
	}

	.modes .mode {
		border: 0;
		border-radius: 0;
		background: #ffffff;
	}

	.modes .mode + .mode {
		border-left: 1px solid #cbd5e1;
	}

	.digest-panel summary {
		color: #475569;
		font-size: 0.8125rem;
		cursor: pointer;
	}

	.digest-panel .digest {
		margin-top: 0.35rem;
	}

	button {
		border: 1px solid #cbd5e1;
		border-radius: 0.4rem;
		background: #f8fafc;
		color: #334155;
		padding: 0.35rem 0.75rem;
		font: inherit;
		font-size: 0.95rem;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.mode[aria-pressed='true'] {
		border-color: #0f172a;
		background: #0f172a;
		color: #ffffff;
	}

	.run-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	button.primary {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		border-color: #1d4ed8;
		background: #1d4ed8;
		color: #ffffff;
		min-height: 2.5rem;
		padding: 0.4rem 1.25rem;
		font-size: 1rem;
	}

	/* The running dot rides on a filled button, so it borrows the label's colour
	   rather than the blue it uses on the pale live section. */
	button.primary .dot {
		background: currentcolor;
	}

	/* `.inputs-note` is quiet rather than the amber `.inputs-changed` block:
	   nothing has gone wrong, this is how attachments have always worked. */
	.mode-hint,
	.mode-note,
	.inputs-note {
		color: #64748b;
		font-size: 0.875rem;
	}

	.connection {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		color: #475569;
		font-size: 0.875rem;
	}

	/* Grey until a key is in hand, green once one is: the same two states the
	   toolbar's glyph carries, so the two agree at a glance. */
	.status-dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 999px;
		background: #94a3b8;
	}

	.status-dot.on {
		background: #16a34a;
	}

	.runtime,
	.running {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.4rem;
		color: #475569;
		font-size: 0.925rem;
	}

	.runtime-note {
		color: #94a3b8;
		font-size: 0.8125rem;
	}

	.dot {
		align-self: center;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 999px;
		background: #1d4ed8;
		animation: pulse 1.2s ease-in-out infinite;
	}

	/* Both halves of the rule: the media query for a browser that answers it, the
	   class for the runtime check the rest of the app uses. The class sits on the
	   line in the live section and on the dot itself inside the run button, which
	   has no such line to carry it. */
	.running.reduced-motion .dot,
	.dot.reduced-motion {
		animation: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.dot {
			animation: none;
		}
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}

		50% {
			opacity: 0.3;
		}
	}

	/*
	 * The closed line reads as one sentence: a bold title and then what was said,
	 * clipped at the width of the surface rather than wrapping to three lines.
	 */
	.prose-panel summary {
		cursor: pointer;
	}

	.prose-title {
		color: #475569;
		font-size: 0.925rem;
		font-weight: 600;
	}

	/*
	 * Inline-block rather than a flex child: `<summary>` draws its disclosure
	 * marker only while it lays out as a list item, and a flex summary loses the
	 * one glyph that says it opens.
	 */
	.prose-preview {
		display: inline-block;
		max-width: 100%;
		margin-left: 0.5rem;
		overflow: hidden;
		color: #64748b;
		font-size: 0.925rem;
		text-overflow: ellipsis;
		white-space: nowrap;
		vertical-align: bottom;
	}

	.prose-body {
		display: grid;
		gap: 0.5rem;
		padding-top: 0.5rem;
	}

	/*
	 * The last run's outputs, while a new one is in flight. Faded rather than
	 * removed, with the caption above saying which run they came from — a plot
	 * that looks current while another is being drawn is the one lie this surface
	 * could tell.
	 */
	.outputs-body {
		display: grid;
		gap: 0.75rem;
		transition: opacity 150ms ease;
	}

	.outputs-body.while-running {
		opacity: 0.45;
	}

	.outputs-body.reduced-motion {
		transition: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.outputs-body {
			transition: none;
		}
	}

	.stale-caption {
		color: #64748b;
		font-size: 0.8125rem;
	}

	.thinking summary {
		color: #475569;
		font-size: 0.925rem;
		cursor: pointer;
	}

	.thinking p {
		padding-top: 0.35rem;
		color: #64748b;
		font-size: 0.925rem;
		white-space: pre-wrap;
	}

	.response {
		white-space: pre-wrap;
	}

	.steps li {
		display: grid;
		gap: 0.35rem;
		padding: 0.5rem 0.6rem;
		border-left: 3px solid #cbd5e1;
	}

	.steps li[data-ai-step-exit-code='running'] {
		border-left-color: #1d4ed8;
	}

	/* Anything but a clean exit is amber: a traceback is the state the reader has
	   to act on, and it is also the one the next refine run carries. */
	.steps li:not([data-ai-step-exit-code='0']):not([data-ai-step-exit-code='running']) {
		border-left-color: #f59e0b;
	}

	.step-head {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		font-size: 0.875rem;
	}

	.step-head span {
		color: #64748b;
	}

	.error {
		display: grid;
		gap: 0.45rem;
		justify-items: start;
		padding: 0.6rem 0.75rem;
		border-left: 3px solid #ef4444;
		background: #fef2f2;
		font-size: 0.95rem;
		white-space: pre-wrap;
	}

	/* The sentence keeps the two rows it had before the traceback joined it: what
	   happened, then what was said about it. */
	.error p {
		display: grid;
		gap: 0.2rem;
	}

	.error .stdout {
		justify-self: stretch;
	}

	/* The one action inside a failure, on its own row so it is not read as part
	   of the traceback above it. */
	.fix-actions button {
		border-color: #b91c1c;
		background: #ffffff;
		color: #b91c1c;
	}

	/* A refusal is an answer, not a failure, so it takes the informational edge
	   the details view gives its "nobody has said so yet" states. */
	.error.refusal {
		border-left-color: #94a3b8;
		background: #f1f5f9;
	}

	.image-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: 1rem;
	}

	figure {
		display: grid;
		gap: 0.5rem;
	}

	.image-frame,
	.missing-image {
		aspect-ratio: 4 / 3;
		width: 100%;
		border: 1px solid #cbd5e1;
		border-radius: 0.5rem;
		background: #f8fafc;
		overflow: hidden;
	}

	img {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.missing-image {
		display: grid;
		place-items: center;
		color: #64748b;
	}

	figcaption {
		color: #475569;
		font-size: 0.925rem;
	}

	.file-list li,
	.stale-section li {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem 0.75rem;
		padding: 0.6rem 0.75rem;
		border: 1px solid #cbd5e1;
		border-radius: 0.5rem;
		background: #f8fafc;
		font-size: 0.95rem;
	}

	.file-meta {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.5rem;
		flex: 1 1 12rem;
		min-width: 0;
	}

	.file-meta span {
		color: #64748b;
		font-size: 0.875rem;
	}

	.file-open {
		border: 1px solid #94a3b8;
		border-radius: 0.35rem;
		background: #e2e8f0;
		color: #0f172a;
		padding: 0.4rem 0.9rem;
		font-size: 0.95rem;
		text-decoration: none;
	}

	.file-unavailable {
		color: #64748b;
		font-size: 0.875rem;
		font-style: italic;
	}

	.output-actions {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-left: auto;
	}

	/*
	 * A square target rather than a word: the same 2.25rem either way, so the
	 * glyph sits in a press big enough for a thumb.
	 */
	button.promote {
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		padding: 0;
		font-size: 1.05rem;
		line-height: 1;
	}

	.promoted-note {
		color: #64748b;
		font-size: 0.875rem;
	}

	/*
	 * Amber, like the stale mark: both say the same kind of thing — what is on
	 * screen and what the data says have come apart.
	 */
	.inputs-changed {
		border-left: 3px solid #f59e0b;
		border-radius: 0.35rem;
		padding: 0.4rem 0.6rem;
		background: #fffbeb;
		color: #92400e;
		font-size: 0.875rem;
	}

	.stale-mark {
		border-radius: 999px;
		padding: 0.05rem 0.5rem;
		background: #fef3c7;
		color: #92400e;
		font-size: 0.8125rem;
		font-weight: 600;
	}

	.script-panel summary {
		color: #475569;
		font-size: 0.925rem;
		font-weight: 600;
		cursor: pointer;
	}

	.script-panel .script {
		margin-top: 0.4rem;
	}

	.metadata {
		color: #64748b;
		font-size: 0.875rem;
	}
</style>
