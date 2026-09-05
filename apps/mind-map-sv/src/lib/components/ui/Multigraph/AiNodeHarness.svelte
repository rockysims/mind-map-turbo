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
	 * same rule `ZoomWorld.startsOnInteractiveContent` applies.
	 */
	import { untrack } from 'svelte';
	import AiNodeContent from './AiNodeContent.svelte';
	import { collectAiInputs } from './lib/aiInputs';
	import { promoteAiOutput, setAiPrompt } from './lib/aiNode';
	import { IDLE_RUN_STATE, type AiRunState } from './lib/aiWorkbenchView';
	import type { GraphAssetStore } from '$lib/assets/assetStore';
	import type { FileDigest } from '$lib/ai/probeScript';
	import type { MultigraphData } from '../types/multigraph';
	import type { AiRunMode } from '../types/node';

	let {
		baseGraph,
		nodeId,
		digests = {},
		assetStore = null,
		assetScope = '',
		runState = IDLE_RUN_STATE,
		hasKey = true
	}: {
		baseGraph: MultigraphData;
		nodeId: string;
		digests?: Record<string, FileDigest>;
		assetStore?: GraphAssetStore | null;
		assetScope?: string;
		runState?: AiRunState;
		hasKey?: boolean;
	} = $props();

	// Seeded once and owned from then on, as `NodeDetailsHarness` does it: the
	// story states a starting graph and every later value is committed here.
	let graph = $state(untrack(() => baseGraph));
	let lastPrompt = $state('');
	let lastRunMode = $state('');
	let cancels = $state(0);
	let lastPromote = $state('');
	let lastJump = $state('');
	let fixes = $state(0);
	let settingsOpens = $state(0);
	/** Wheels that reached the stage — the zoom world's whole input in focus mode. */
	let stageWheels = $state(0);
	/** Presses the world would have turned into a pan, which a control's must not. */
	let stagePanStarts = $state(0);

	const node = $derived(graph.nodes.find((candidate) => candidate.id === nodeId));
	const inputs = $derived(collectAiInputs(graph, nodeId));

	/**
	 * `ZoomWorld`'s rule, copied rather than imported because it is a private
	 * detail of that component: a press that starts on a control belongs to the
	 * control, and everything else starts a pan.
	 */
	function wouldStartPan(event: PointerEvent): boolean {
		return !(
			event.target instanceof Element &&
			event.target.closest('button, a, input, textarea, select, [contenteditable]') !== null
		);
	}
</script>

{#if node}
	<div
		data-ai-harness
		data-last-prompt={lastPrompt}
		data-last-run-mode={lastRunMode}
		data-cancels={cancels}
		data-last-promote={lastPromote}
		data-last-jump={lastJump}
		data-fixes={fixes}
		data-settings-opens={settingsOpens}
		data-stage-wheels={stageWheels}
		data-stage-pan-starts={stagePanStarts}
	></div>
	<!-- The zoom world's stand-in. `role="presentation"` for the same reason the
	     real one carries it: it is an input surface, not a control. -->
	<div
		class="stage"
		data-ai-stage
		role="presentation"
		onwheel={() => (stageWheels += 1)}
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
			assets={graph.assets ?? {}}
			titleForNodeId={(id) => graph.nodes.find((candidate) => candidate.id === id)?.title ?? id}
			onPromptChange={(prompt) => {
				graph = setAiPrompt(graph, nodeId, prompt);
				lastPrompt = prompt;
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
