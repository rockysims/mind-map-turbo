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
	import ZoomWorld from './ZoomWorld.svelte';
	import { interpolateMorph } from './lib/morphGeometry';
	import type { ZoomWorldState } from './lib/zoomWorldController';

	// Generic default: interpolate the level's stored source→fill rects. The
	// node consumer (T04) overrides this with a live frameGeometry derivation.
	const defaultGeometryForLevel = (level: FocusLevel): FrameGeometry => {
		const morph = interpolateMorph(level.sourceRect, level.fillRect, level.morphProgress, {
			sourceBorderWidthPx: level.borderWidthPx,
			targetBorderWidthPx: level.borderWidthPx
		});
		return {
			x: morph.x,
			y: morph.y,
			width: morph.width,
			height: morph.height,
			borderRadiusPx: morph.borderRadiusPx,
			borderWidthPx: morph.borderWidthPx ?? level.borderWidthPx ?? 0
		};
	};

	// The compact layer's base is the level's logical source diameter; the
	// details layer is laid out at the fill size so it sits at scale 1 at
	// progress 1 (where ZoomWorld — not the frame — owns the scale).
	const defaultBaseSizeForLevel = (level: FocusLevel): LayerBaseSize => ({
		compactPx: Math.min(level.sourceRect.width, level.sourceRect.height) || level.fillRect.width,
		detailsWidthPx: level.fillRect.width,
		detailsHeightPx: level.fillRect.height
	});

	let {
		levels = [],
		reduceMotion = false,
		entryGestureIdleMs = 0,
		entryGestureMaxMs = 0,
		geometryForLevel = defaultGeometryForLevel,
		baseSizeForLevel = defaultBaseSizeForLevel,
		frame,
		compact,
		details,
		onAscend,
		onWorldStateChange
	}: {
		levels?: FocusLevel[];
		reduceMotion?: boolean;
		entryGestureIdleMs?: number;
		entryGestureMaxMs?: number;
		geometryForLevel?: (level: FocusLevel) => FrameGeometry;
		baseSizeForLevel?: (level: FocusLevel) => LayerBaseSize;
		frame?: Snippet<[StackFrameArgs]>;
		compact?: Snippet<[FocusLevel]>;
		details?: Snippet<[FocusLevel]>;
		onAscend?: (level: FocusLevel, delta: number) => void;
		onWorldStateChange?: (level: FocusLevel, state: ZoomWorldState) => void;
	} = $props();
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
					{entryGestureIdleMs}
					{entryGestureMaxMs}
					exitBoundarySync={level.phase === 'exiting'
						? Math.min(1, Math.max(0, 1 - level.morphProgress))
						: 0}
					onExitBoundary={(delta) => onAscend?.(level, delta)}
					onStateChange={(state) => onWorldStateChange?.(level, state)}
				>
					{@render details?.(level)}
				</ZoomWorld>
			{:else}
				<div class="frozen-level" aria-hidden={isActive ? undefined : 'true'}>
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
			frame={frame ? levelFrame : undefined}
			compact={compact ? levelCompact : undefined}
			details={details ? levelDetails : undefined}
		/>
	{/each}
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
		pointer-events: none;
	}
</style>
