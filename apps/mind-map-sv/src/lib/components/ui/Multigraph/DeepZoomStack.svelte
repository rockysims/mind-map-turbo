<script lang="ts">
	import type { Snippet } from 'svelte';
	import DeepZoomLayer from './DeepZoomLayer.svelte';
	import ZoomWorld from './ZoomWorld.svelte';
	import type { FocusLevel } from './lib/focusRuntime.svelte';
	import type { ZoomWorldState } from './lib/zoomWorldController';

	let {
		levels = [],
		reduceMotion = false,
		entryGestureIdleMs = 0,
		entryGestureMaxMs = 0,
		renderLevel,
		onAscend,
		onWorldStateChange
	}: {
		levels?: FocusLevel[];
		reduceMotion?: boolean;
		entryGestureIdleMs?: number;
		entryGestureMaxMs?: number;
		renderLevel?: Snippet<[FocusLevel]>;
		onAscend?: (level: FocusLevel, delta: number) => void;
		onWorldStateChange?: (level: FocusLevel, state: ZoomWorldState) => void;
	} = $props();
</script>

<div class="deep-zoom-stack" data-depth={levels.length}>
	{#each levels as level, index (level.id)}
		{@const isActive = index === levels.length - 1}
		<DeepZoomLayer
			sourceRect={level.sourceRect}
			fillRect={level.fillRect}
			progress={level.morphProgress}
			{reduceMotion}
		>
			{#if isActive}
				<ZoomWorld
					{entryGestureIdleMs}
					{entryGestureMaxMs}
					onExitBoundary={(delta) => onAscend?.(level, delta)}
					onStateChange={(state) => onWorldStateChange?.(level, state)}
				>
					{#if renderLevel}
						{@render renderLevel(level)}
					{/if}
				</ZoomWorld>
			{:else}
				<div class="frozen-level" aria-hidden="true">
					{#if renderLevel}
						{@render renderLevel(level)}
					{/if}
				</div>
			{/if}
		</DeepZoomLayer>
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
