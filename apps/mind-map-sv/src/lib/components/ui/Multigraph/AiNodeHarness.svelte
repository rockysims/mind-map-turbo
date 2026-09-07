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
	 * same two rules `ZoomWorld` applies — `startsOnInteractiveContent` for the
	 * press, and `yieldsToNestedScroll` (imported, since it is a shared module
	 * rather than a private detail) for the wheel.
	 */
	import { untrack } from 'svelte';
	import AiNodeContent from './AiNodeContent.svelte';
	import { collectAiInputs } from './lib/aiInputs';
	import { promoteAiOutput, setAiPrompt } from './lib/aiNode';
	import { IDLE_RUN_STATE, type AiRunState } from './lib/aiWorkbenchView';
	import { nestedScrollChain, nestedWheelDecision } from './lib/nestedScrollTarget';
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
		hasKey = true,
		frameHeightPx = 0
	}: {
		baseGraph: MultigraphData;
		nodeId: string;
		digests?: Record<string, FileDigest>;
		assetStore?: GraphAssetStore | null;
		assetScope?: string;
		runState?: AiRunState;
		hasKey?: boolean;
		/**
		 * The focus frame's height, which the real surface gets from
		 * `NodeDetailsLayer`'s definite body row. Zero leaves the stage
		 * unbounded, which is what every story that is not about scrolling wants.
		 */
		frameHeightPx?: number;
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
	/** Wheels the world took and did nothing with, at an end of the scroller. */
	let stageSwallows = $state(0);
	/** Presses the world would have turned into a pan, which a control's must not. */
	let stagePanStarts = $state(0);
	/** The world's root, for the walk from a wheel's target up to it. */
	let stage = $state<HTMLElement | null>(null);

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

	/** When a wheel was last handed to the scroller, for the exit pause. */
	let lastNestedScrollAt = 0;

	/**
	 * `ZoomWorld`'s other rule, imported rather than copied because it is a
	 * shared module: a wheel inside a marked scroller that can still move belongs
	 * to that scroller, and at either end the world takes it back — to zoom only
	 * where zooming is what the gesture meant. Nothing on this surface is a
	 * descendable image, and the real rule reads that off the DOM under the
	 * cursor, which a harness has no business faking.
	 */
	function decideWheel(event: WheelEvent): void {
		const decision = nestedWheelDecision({
			chain: nestedScrollChain(event.target, stage),
			deltaY: event.deltaY,
			msSinceLastNestedScroll: Date.now() - lastNestedScrollAt,
			descendableImageUnderCursor: false
		});
		if (decision === 'scroll') lastNestedScrollAt = Date.now();
		else if (decision === 'swallow') stageSwallows += 1;
		else stageWheels += 1;
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
