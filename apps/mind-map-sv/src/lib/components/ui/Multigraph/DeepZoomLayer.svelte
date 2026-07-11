<script lang="ts">
	import type { Snippet } from 'svelte';
	import { interpolateMorph } from './lib/morphGeometry';
	import type { Rect } from './lib/zoomBoundary';

	let {
		sourceRect,
		fillRect,
		progress = 1,
		reduceMotion = false,
		children
	}: {
		sourceRect: Rect;
		fillRect: Rect;
		progress?: number;
		reduceMotion?: boolean;
		children?: Snippet;
	} = $props();

	const effectiveProgress = $derived(reduceMotion ? Math.round(progress) : progress);
	const geometry = $derived(interpolateMorph(sourceRect, fillRect, effectiveProgress));
	const layerStyle = $derived(
		`left: ${geometry.x}px; top: ${geometry.y}px; width: ${geometry.width}px; height: ${geometry.height}px; --deep-zoom-border-radius: ${geometry.borderRadiusPx}px;`
	);
</script>

<div
	class="deep-zoom-layer"
	style={layerStyle}
	data-morph-progress={effectiveProgress}
	data-morph-x={geometry.x}
	data-morph-y={geometry.y}
	data-morph-width={geometry.width}
	data-morph-height={geometry.height}
	data-morph-radius={geometry.borderRadiusPx}
	data-source-x={sourceRect.left}
	data-source-y={sourceRect.top}
	data-source-width={sourceRect.width}
	data-source-height={sourceRect.height}
	data-fill-x={fillRect.left}
	data-fill-y={fillRect.top}
	data-fill-width={fillRect.width}
	data-fill-height={fillRect.height}
>
	<div class="deep-zoom-layer-subject">
		{#if children}
			{@render children()}
		{/if}
	</div>
</div>

<style>
	.deep-zoom-layer {
		position: fixed;
		z-index: 60;
		overflow: visible;
		pointer-events: auto;
		touch-action: none;
	}

	.deep-zoom-layer-subject {
		position: absolute;
		inset: 0;
		overflow: visible;
	}
</style>
