<script module lang="ts">
	import type { Snippet } from 'svelte';
	import type { FocusLevel } from './lib/focusRuntime.svelte';
	import type { FrameGeometry } from './lib/frameGeometry';

	/** Fixed logical base sizes for a level's two content layers. */
	export type LayerBaseSize = {
		compactPx: number;
		detailsWidthPx: number;
		detailsHeightPx: number;
	};

	/** Frame args, plus the level so the consumer can style per subject. */
	export type StackFrameArgs = {
		level: FocusLevel;
		borderRadiusPx: number;
		borderWidthPx: number;
		content: Snippet;
	};
</script>

<script lang="ts">
	import DeepZoomLayer, { type FrameSnippetArgs } from './DeepZoomLayer.svelte';
	import ZoomWorld, { type DescendInput } from './ZoomWorld.svelte';
	import { pinScrollToOrigin } from './lib/pinScroll';

	let {
		levels = [],
		reduceMotion = false,
		entryGestureIdleMs = 0,
		entryGestureMaxMs = 0,
		geometryForLevel,
		baseSizeForLevel,
		frame,
		compact,
		details,
		onAscend,
		onDescend
	}: {
		levels?: FocusLevel[];
		reduceMotion?: boolean;
		entryGestureIdleMs?: number;
		entryGestureMaxMs?: number;
		geometryForLevel: (level: FocusLevel) => FrameGeometry;
		baseSizeForLevel: (level: FocusLevel) => LayerBaseSize;
		frame?: Snippet<[StackFrameArgs]>;
		compact?: Snippet<[FocusLevel]>;
		details?: Snippet<[FocusLevel]>;
		onAscend?: (level: FocusLevel, delta: number) => void;
		/** Bold zoom-in over an image in the active world descends into it. */
		onDescend?: (input: DescendInput) => void;
	} = $props();

	// Single focus input surface: the active (top) level owns wheel input once it
	// is committed or exiting. This one fullscreen element sits BEHIND the frame
	// layers but above the stage, so it captures only the wheels the shrinking
	// exit-scrub frame no longer covers and forwards them to the active level's
	// world (the frame's own `ZoomWorld` still handles wheels over it — never
	// both, since only the topmost element under the cursor gets the event).
	// Pointer drag/pinch stays inside `ZoomWorld`; the surface handles wheel only.
	let activeWorld = $state<ZoomWorld | null>(null);
	const activeLevel = $derived(levels.length > 0 ? levels[levels.length - 1] : null);
	const activeWorldActive = $derived(
		activeLevel != null && (activeLevel.morphProgress >= 1 || activeLevel.phase === 'exiting')
	);
</script>

<div class="deep-zoom-stack" data-depth={levels.length}>
	{#each levels as level, index (level.id)}
		{@const isActive = index === levels.length - 1}
		{@const geometry = geometryForLevel(level)}
		{@const base = baseSizeForLevel(level)}
		{@const committedOrExiting = level.morphProgress >= 1 || level.phase === 'exiting'}
		{@const worldActive = isActive && committedOrExiting}

		{#snippet levelFrame(args: FrameSnippetArgs)}
			{@render frame?.({
				level,
				borderRadiusPx: args.borderRadiusPx,
				borderWidthPx: args.borderWidthPx,
				content: args.content
			})}
		{/snippet}

		{#snippet levelCompact()}
			{@render compact?.(level)}
		{/snippet}

		{#snippet levelDetails()}
			{#if worldActive}
				<ZoomWorld
					bind:this={activeWorld}
					{entryGestureIdleMs}
					{entryGestureMaxMs}
					onExitBoundary={(delta) => onAscend?.(level, delta)}
					{onDescend}
				>
					{@render details?.(level)}
				</ZoomWorld>
			{:else}
				<!-- The other clipping box on the path from the layer to the content,
				     pinned for the same reason the frame is (`lib/pinScroll.ts`). -->
				<div
					class="frozen-level"
					aria-hidden={isActive ? undefined : 'true'}
					onscroll={(event) => pinScrollToOrigin(event.currentTarget)}
				>
					{@render details?.(level)}
				</div>
			{/if}
		{/snippet}

		<DeepZoomLayer
			{geometry}
			progress={level.morphProgress}
			{reduceMotion}
			interactive={committedOrExiting}
			compactBasePx={base.compactPx}
			detailsBaseWidthPx={base.detailsWidthPx}
			detailsBaseHeightPx={base.detailsHeightPx}
			onFrameWheel={worldActive ? (event) => activeWorld?.dispatchWheel(event) : undefined}
			frame={frame ? levelFrame : undefined}
			compact={compact ? levelCompact : undefined}
			details={details ? levelDetails : undefined}
		/>
	{/each}

	<div
		class="focus-input-surface"
		class:active={activeWorldActive}
		data-focus-input-surface="true"
		aria-hidden="true"
		onwheel={(event) => activeWorld?.dispatchWheel(event)}
	></div>
</div>

<style>
	.deep-zoom-stack {
		position: fixed;
		inset: 0;
		z-index: 60;
		pointer-events: none;
	}

	.frozen-level {
		width: 100%;
		height: 100%;
		overflow: hidden;
		overflow-anchor: none;
		pointer-events: none;
	}

	/* One fullscreen wheel catcher. It has no `z-index`, so it paints BELOW the
	   positioned `.deep-zoom-layer` frames (z-index 60) but still above the
	   stage: wheels over the frame reach the frame's own world, while wheels the
	   shrinking exit-scrub frame no longer covers land here and are forwarded to
	   the active world. Inert (`pointer-events: none`) during entry so the stage
	   keeps driving the entry scrub. */
	.focus-input-surface {
		position: fixed;
		inset: 0;
		touch-action: none;
		pointer-events: none;
	}

	.focus-input-surface.active {
		pointer-events: auto;
	}
</style>
