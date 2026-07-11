<script module lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * The single bordered box the consumer draws. The layer hands it the morphed
	 * corner radius + border width and a `content` snippet (the crossfading
	 * compact/details layers) to render INSIDE the one border element. There is
	 * exactly one frame per level — the content crossfades within it, the border
	 * is never double-drawn.
	 */
	export type FrameSnippetArgs = {
		borderRadiusPx: number;
		borderWidthPx: number;
		content: Snippet;
	};
</script>

<script lang="ts">
	import { contentLayerScale, crossfadeOpacity } from './lib/morphSurface';
	import { interpolateMorph } from './lib/morphGeometry';
	import type { FrameGeometry } from './lib/frameGeometry';
	import type { Rect } from './lib/zoomBoundary';

	let {
		geometry,
		sourceRect,
		fillRect,
		progress = 1,
		reduceMotion = false,
		compactBasePx = 0,
		detailsBaseWidthPx = 0,
		detailsBaseHeightPx = 0,
		frame,
		compact,
		details,
		children
	}: {
		/**
		 * The fully-computed morphed frame, produced by the CONSUMER (via
		 * `frameGeometry` / `interpolateMorph`). The layer does NOT interpolate
		 * again — passing this avoids the double-interpolation bug.
		 */
		geometry?: FrameGeometry;
		/** Legacy inputs (single-`children` consumers): the layer interpolates. */
		sourceRect?: Rect;
		fillRect?: Rect;
		progress?: number;
		reduceMotion?: boolean;
		/** Fixed logical base size of the square compact layer. */
		compactBasePx?: number;
		/** Fixed logical base size of the details layer (laid out at fill size). */
		detailsBaseWidthPx?: number;
		detailsBaseHeightPx?: number;
		/** Draws the single bordered box; defaults to a plain bordered box. */
		frame?: Snippet<[FrameSnippetArgs]>;
		/** Content-layer snippets, rendered once at their base size and scaled. */
		compact?: Snippet;
		details?: Snippet;
		/** Legacy single content slot (no crossfade); rendered borderless. */
		children?: Snippet;
	} = $props();

	const effectiveProgress = $derived(reduceMotion ? Math.round(progress) : progress);
	const useContentLayers = $derived(Boolean(compact || details));

	// Geometry is authored by the consumer; only fall back to interpolating here
	// for legacy single-`children` consumers that still pass source/fill rects.
	const geo = $derived<FrameGeometry>(
		geometry ??
			(sourceRect && fillRect
				? {
						...interpolateMorph(sourceRect, fillRect, effectiveProgress),
						borderWidthPx: 0
					}
				: { x: 0, y: 0, width: 0, height: 0, borderRadiusPx: 0, borderWidthPx: 0 })
	);
	const borderWidthPx = $derived(geo.borderWidthPx ?? 0);

	// pointer-events: none while morphing so the underlying stage keeps getting
	// wheel/pinch input driving the scrub; interactive only once committed.
	const interactive = $derived(!useContentLayers || effectiveProgress >= 1);

	const compactScale = $derived(contentLayerScale(geo.width, compactBasePx));
	const detailsScale = $derived(contentLayerScale(geo.width, detailsBaseWidthPx));
	const opacity = $derived(crossfadeOpacity(effectiveProgress));

	// Lazy-mount the details layer on first nonzero progress; keep it mounted.
	let detailsMounted = $state(false);
	$effect(() => {
		if (effectiveProgress > 0) detailsMounted = true;
	});

	const layerStyle = $derived(
		`left: ${geo.x}px; top: ${geo.y}px; width: ${geo.width}px; height: ${geo.height}px;` +
			` --deep-zoom-border-radius: ${geo.borderRadiusPx}px; --deep-zoom-border-width: ${borderWidthPx}px;`
	);
</script>

{#snippet contentLayers()}
	<div
		class="deep-zoom-content-layer deep-zoom-compact-layer"
		data-morph-layer="compact"
		data-layer-base-width={compactBasePx}
		data-layer-base-height={compactBasePx}
		data-layer-scale={compactScale}
		data-layer-opacity={opacity.compact}
		style={`width: ${compactBasePx}px; height: ${compactBasePx}px; transform: scale(${compactScale}); opacity: ${opacity.compact};`}
	>
		{@render compact?.()}
	</div>
	{#if detailsMounted}
		<div
			class="deep-zoom-content-layer deep-zoom-details-layer"
			data-morph-layer="details"
			data-layer-base-width={detailsBaseWidthPx}
			data-layer-base-height={detailsBaseHeightPx}
			data-layer-scale={detailsScale}
			data-layer-opacity={opacity.details}
			style={`width: ${detailsBaseWidthPx}px; height: ${detailsBaseHeightPx}px; transform: scale(${detailsScale}); opacity: ${opacity.details};`}
		>
			{@render details?.()}
		</div>
	{/if}
{/snippet}

{#snippet defaultFrame(args: FrameSnippetArgs)}
	<div
		class="deep-zoom-default-frame"
		style={`border-radius: ${args.borderRadiusPx}px; border-width: ${args.borderWidthPx}px;`}
	>
		{@render args.content()}
	</div>
{/snippet}

<div
	class="deep-zoom-layer"
	class:content-mode={useContentLayers}
	style={layerStyle}
	data-morph-surface="true"
	data-morph-progress={effectiveProgress}
	data-morph-x={geo.x}
	data-morph-y={geo.y}
	data-morph-width={geo.width}
	data-morph-height={geo.height}
	data-morph-radius={geo.borderRadiusPx}
	data-morph-border-width={borderWidthPx}
	data-morph-interactive={interactive ? 'true' : 'false'}
	data-source-x={sourceRect?.left}
	data-source-y={sourceRect?.top}
	data-source-width={sourceRect?.width}
	data-source-height={sourceRect?.height}
	data-fill-x={fillRect?.left}
	data-fill-y={fillRect?.top}
	data-fill-width={fillRect?.width}
	data-fill-height={fillRect?.height}
>
	{#if useContentLayers}
		{#if frame}
			{@render frame({ borderRadiusPx: geo.borderRadiusPx, borderWidthPx, content: contentLayers })}
		{:else}
			{@render defaultFrame({
				borderRadiusPx: geo.borderRadiusPx,
				borderWidthPx,
				content: contentLayers
			})}
		{/if}
	{:else}
		<div class="deep-zoom-layer-subject">
			{#if children}
				{@render children()}
			{/if}
		</div>
	{/if}
</div>

<style>
	.deep-zoom-layer {
		position: fixed;
		z-index: 60;
		overflow: visible;
		pointer-events: auto;
		touch-action: none;
	}

	/* While morphing, let wheel/pinch fall through to the stage beneath. */
	.deep-zoom-layer.content-mode[data-morph-interactive='false'] {
		pointer-events: none;
	}

	.deep-zoom-layer-subject {
		position: absolute;
		inset: 0;
		overflow: visible;
	}

	.deep-zoom-default-frame {
		position: absolute;
		inset: 0;
		box-sizing: border-box;
		border-style: solid;
		border-color: #334155;
		background: #ffffff;
		overflow: hidden;
	}

	.deep-zoom-content-layer {
		position: absolute;
		top: 0;
		left: 0;
		transform-origin: top left;
		will-change: transform, opacity;
	}
</style>
