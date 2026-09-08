<script lang="ts">
	/**
	 * The workbench over one graph, so a story can watch an edit made in it land
	 * on the node and change what the surface offers next.
	 *
	 * Three things the component deliberately does not own live here, exactly as
	 * `Multigraph.svelte` will own them (T08): the graph the prompt is committed
	 * to, the inputs collected from it, and a stand-in for the zoom world
	 * underneath. That last one is what makes "the reader's gestures still belong
	 * to the surface" assertable: this harness counts the wheels that reach the
	 * stage and the presses that would have started a world pan, applying the
	 * same two rules `ZoomWorld` applies — both imported, since both are shared
	 * modules: `startsOnInteractiveContent` for the press and
	 * `nestedWheelDecision` for the wheel.
	 */
	import { untrack } from 'svelte';
	import AiNodeContent from './AiNodeContent.svelte';
	import { collectAiInputs } from './lib/aiInputs';
	import { promoteAiOutput, setAiModel, setAiPrompt } from './lib/aiNode';
	import {
		addNodeContentBlock,
		removeNodeContentBlock,
		replaceNodeContentBlockAsset
	} from './lib/graph';
	import { IDLE_RUN_STATE, resolveAiModel, type AiRunState } from './lib/aiWorkbenchView';
	import { startsOnInteractiveContent } from './lib/interactiveContent';
	import { nestedScrollChain, nestedWheelDecision } from './lib/nestedScrollTarget';
	import { APP_CONFIG } from '$lib/appConfig';
	import type { GraphAssetStore } from '$lib/assets/assetStore';
	import type { FileDigest } from '$lib/ai/probeScript';
	import type { GraphAssetMetadata, MultigraphData } from '../types/multigraph';
	import type { AiRunMode, NodeContentBlock } from '../types/node';

	let {
		baseGraph,
		nodeId,
		digests = {},
		assetStore = null,
		assetScope = '',
		runState = IDLE_RUN_STATE,
		hasKey = true,
		appModel = APP_CONFIG.ai.defaultModel,
		frameHeightPx = 0,
		confirmAttachment = () => true,
		warnBytesPerFile = APP_CONFIG.multigraph.attachments.warnBytesPerFile
	}: {
		baseGraph: MultigraphData;
		nodeId: string;
		digests?: Record<string, FileDigest>;
		assetStore?: GraphAssetStore | null;
		assetScope?: string;
		runState?: AiRunState;
		hasKey?: boolean;
		/** The app-wide model a node with no pin of its own follows. */
		appModel?: string;
		/**
		 * The focus frame's height, which the real surface gets from
		 * `NodeDetailsLayer`'s definite body row. Zero leaves the stage
		 * unbounded, which is what every story that is not about scrolling wants.
		 */
		frameHeightPx?: number;
		/** The size question, answered yes by default so a story need not think about it. */
		confirmAttachment?: (message: string) => boolean;
		warnBytesPerFile?: number;
	} = $props();

	// Seeded once and owned from then on, as `NodeDetailsHarness` does it: the
	// story states a starting graph and every later value is committed here.
	let graph = $state(untrack(() => baseGraph));
	let lastPrompt = $state('');
	/** The model last picked on the connection line, as the surface reported it. */
	let lastModel = $state('');
	let lastRunMode = $state('');
	let cancels = $state(0);
	let lastPromote = $state('');
	let lastJump = $state('');
	let fixes = $state(0);
	let settingsOpens = $state(0);
	/** `nodeId:name` of the last file attached here, as the surface reported it. */
	let lastAdd = $state('');
	/** `nodeId:oldAssetId:name` of the last replacement. */
	let lastReplace = $state('');
	/** `nodeId:assetId` of the last removal. */
	let lastRemove = $state('');
	/** Asset ids for files added or replaced in a story, so they are predictable. */
	let storedFiles = $state(0);
	/** Wheels that reached the stage — the zoom world's whole input in focus mode. */
	let stageWheels = $state(0);
	/** Wheels the world took and did nothing with, at an end of the scroller. */
	let stageSwallows = $state(0);
	/** Presses the world would have turned into a pan, which a control's must not. */
	let stagePanStarts = $state(0);
	/** The world's root, for the walk from a wheel's target up to it. */
	let stage = $state<HTMLElement | null>(null);

	const node = $derived(graph.nodes.find((candidate) => candidate.id === nodeId));
	/** What `Multigraph` resolves for the same node: its pin, or the app's choice. */
	const model = $derived(resolveAiModel(node?.addons?.ai, appModel));
	const inputs = $derived(collectAiInputs(graph, nodeId));

	/**
	 * `ZoomWorld`'s rule: a press that starts on a control — or on a disclosure —
	 * belongs to it, and everything else starts a pan.
	 */
	function wouldStartPan(event: PointerEvent): boolean {
		return !startsOnInteractiveContent(event.target);
	}

	/**
	 * `ZoomWorld`'s other rule: a wheel inside a marked scroller that can still
	 * move belongs to that scroller, and at either end the world takes it back and
	 * does nothing with it. Nothing on this surface is a descendable image, and
	 * the real rule reads that off the DOM under the cursor, which a harness has
	 * no business faking.
	 */
	function decideWheel(event: WheelEvent): void {
		const decision = nestedWheelDecision({
			chain: nestedScrollChain(event.target, stage),
			deltaY: event.deltaY,
			descendableImageUnderCursor: false
		});
		if (decision === 'swallow') stageSwallows += 1;
		else if (decision === 'zoom') stageWheels += 1;
	}

	/**
	 * Attachment edits, applied to the harness's own graph through the same pure
	 * mutations `Multigraph` commits — so a story watches the input list answer
	 * the press it made rather than a spy that was called.
	 *
	 * The one thing missing is the asset store: a story has a `File` and a graph,
	 * and the blob write is what `Multigraph` owns. Ids are sequential rather
	 * than random so a story can name the row that just appeared.
	 */
	function nextAssetId(): string {
		storedFiles += 1;
		return `asset-picked-${storedFiles}`;
	}

	function assetFor(assetId: string, file: File): GraphAssetMetadata {
		return {
			id: assetId,
			kind: file.type.startsWith('image/') ? 'image' : 'file',
			mimeType: file.type,
			name: file.name,
			size: file.size,
			createdAt: 3
		};
	}

	async function addFile(targetNodeId: string, file: File): Promise<'added' | 'store-failed'> {
		const assetId = nextAssetId();
		const block: NodeContentBlock = file.type.startsWith('image/')
			? { type: 'image', assetId, alt: file.name }
			: { type: 'file', assetId, name: file.name };
		graph = addNodeContentBlock(graph, targetNodeId, block, assetFor(assetId, file));
		lastAdd = `${targetNodeId}:${file.name}`;
		return 'added';
	}

	async function replaceFile(
		targetNodeId: string,
		assetId: string,
		file: File
	): Promise<'added' | 'store-failed'> {
		const newAssetId = nextAssetId();
		const result = replaceNodeContentBlockAsset(
			graph,
			targetNodeId,
			assetId,
			newAssetId,
			assetFor(newAssetId, file)
		);
		if (result.graph === graph) return 'store-failed';
		graph = result.graph;
		lastReplace = `${targetNodeId}:${assetId}:${file.name}`;
		return 'added';
	}

	function removeFile(targetNodeId: string, assetId: string): void {
		graph = removeNodeContentBlock(graph, targetNodeId, assetId).graph;
		lastRemove = `${targetNodeId}:${assetId}`;
	}
</script>

{#if node}
	<div
		data-ai-harness
		data-last-prompt={lastPrompt}
		data-last-model={lastModel}
		data-node-model={node.addons?.ai?.model ?? ''}
		data-last-run-mode={lastRunMode}
		data-cancels={cancels}
		data-last-promote={lastPromote}
		data-last-jump={lastJump}
		data-fixes={fixes}
		data-settings-opens={settingsOpens}
		data-last-add={lastAdd}
		data-last-replace={lastReplace}
		data-last-remove={lastRemove}
		data-stage-wheels={stageWheels}
		data-stage-swallows={stageSwallows}
		data-stage-pan-starts={stagePanStarts}
	></div>
	<!-- The zoom world's stand-in. `role="presentation"` for the same reason the
	     real one carries it: it is an input surface, not a control. -->
	<div
		bind:this={stage}
		class="stage"
		data-ai-stage
		role="presentation"
		style={frameHeightPx > 0 ? `height: ${frameHeightPx}px` : undefined}
		onwheel={(event) => decideWheel(event)}
		onpointerdown={(event) => {
			if (wouldStartPan(event)) stagePanStarts += 1;
		}}
	>
		<AiNodeContent
			{node}
			{inputs}
			{digests}
			{assetStore}
			{assetScope}
			{runState}
			{hasKey}
			{model}
			{confirmAttachment}
			{warnBytesPerFile}
			assets={graph.assets ?? {}}
			titleForNodeId={(id) => graph.nodes.find((candidate) => candidate.id === id)?.title ?? id}
			nodeExists={(id) => graph.nodes.some((candidate) => candidate.id === id)}
			onPromptChange={(prompt) => {
				graph = setAiPrompt(graph, nodeId, prompt);
				lastPrompt = prompt;
			}}
			onModelChange={(chosen) => {
				graph = setAiModel(graph, nodeId, chosen);
				lastModel = chosen;
			}}
			onRun={(mode: AiRunMode) => (lastRunMode = mode)}
			onCancel={() => (cancels += 1)}
			onPromote={(outputName) => {
				// The real mutation, as `Multigraph` commits it, so a story can watch
				// the output row answer the press it made. The position is arbitrary
				// here: the harness has no layout, and nothing on this surface draws
				// one.
				graph = promoteAiOutput(graph, nodeId, outputName, { position: { x: 0, y: 120 } });
				lastPromote = outputName;
			}}
			onAddFile={addFile}
			onReplaceFile={replaceFile}
			onRemoveFile={removeFile}
			onFix={() => (fixes += 1)}
			onOpenSettings={() => (settingsOpens += 1)}
			onJumpToNode={(target) => (lastJump = target)}
		/>
	</div>
{/if}

<style>
	.stage {
		display: block;
	}
</style>
