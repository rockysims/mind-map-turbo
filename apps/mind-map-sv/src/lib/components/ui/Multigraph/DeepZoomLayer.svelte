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
	import { pinScrollToOrigin } from './lib/pinScroll';
	import type { FrameGeometry } from './lib/frameGeometry';

	let {
		geometry,
		progress = 1,
		reduceMotion = false,
		interactive: interactiveProp = undefined,
		compactBasePx = 0,
		detailsBaseWidthPx = 0,
		detailsBaseHeightPx = 0,
		onFrameWheel,
		frame,
		compact,
		details
	}: {
		/**
		 * The fully-computed morphed frame, produced by the CONSUMER (via
		 * `frameGeometry` / `interpolateMorph`). The layer does NOT interpolate
		 * again — passing this avoids the double-interpolation bug.
		 */
		geometry: FrameGeometry;
		progress?: number;
		reduceMotion?: boolean;
		/**
		 * Optional override for whether the surface intercepts pointer events.
		 * When omitted the layer is interactive only once committed (progress ≥ 1);
		 * the node consumer sets this true during the exit scrub so the wrapped
		 * `ZoomWorld` keeps receiving the wheel/pinch that drives the morph down.
		 */
		interactive?: boolean;
		/** Fixed logical base size of the square compact layer. */
		compactBasePx?: number;
		/** Fixed logical base size of the details layer (laid out at fill size). */
		detailsBaseWidthPx?: number;
		detailsBaseHeightPx?: number;
		/** Wheel fallback for frame chrome that wraps, but is not inside, ZoomWorld. */
		onFrameWheel?: (event: WheelEvent) => void;
		/** Draws the single bordered box; defaults to a plain bordered box. */
		frame?: Snippet<[FrameSnippetArgs]>;
		/** Content-layer snippets, rendered once at their base size and scaled. */
		compact?: Snippet;
		details?: Snippet;
	} = $props();

	const effectiveProgress = $derived(reduceMotion ? Math.round(progress) : progress);

	const geo = $derived<FrameGeometry>(geometry);
	const borderWidthPx = $derived(geo.borderWidthPx ?? 0);

	// pointer-events: none while morphing so the underlying stage keeps getting
	// wheel/pinch input driving the scrub; interactive only once committed —
	// unless the consumer overrides (exit scrub feeds the wrapped ZoomWorld).
	const interactive = $derived(interactiveProp ?? effectiveProgress >= 1);

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
	<!-- `onscroll` because this box clips and must never be anywhere but its
	     origin: see `lib/pinScroll.ts` for the blank frame that taught us an
	     `overflow: hidden` box is still scrollable from script and from focus. -->
	<div
		class="deep-zoom-default-frame"
		style={`border-radius: ${args.borderRadiusPx}px; border-width: ${args.borderWidthPx}px;`}
		onscroll={(event) => pinScrollToOrigin(event.currentTarget)}
	>
		{@render args.content()}
	</div>
{/snippet}

<div
	class="deep-zoom-layer"
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
	onwheel={(event) => onFrameWheel?.(event)}
>
	{#if frame}
		{@render frame({ borderRadiusPx: geo.borderRadiusPx, borderWidthPx, content: contentLayers })}
	{:else}
		{@render defaultFrame({
			borderRadiusPx: geo.borderRadiusPx,
			borderWidthPx,
			content: contentLayers
		})}
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
	.deep-zoom-layer[data-morph-interactive='false'] {
		pointer-events: none;
	}

	.deep-zoom-default-frame {
		position: absolute;
		inset: 0;
		box-sizing: border-box;
		border-style: solid;
		border-color: #334155;
		background: #ffffff;
		overflow: hidden;
		/* Nothing here may move the box, the browser's scroll anchoring least of
		   all — the content layers are absolutely positioned and transform-scaled,
		   which is exactly the geometry anchoring reasons badly about. */
		overflow-anchor: none;
	}

	.deep-zoom-content-layer {
		position: absolute;
		/* Content layers are laid out at the frame's OUTER (border-box) size —
		   compactBasePx/detailsBaseWidthPx mirror the in-stage node's full
		   diameter, border included — but they mount inside the bordered frame
		   element, whose (0, 0) is the INNER padding-box corner, inset by the
		   live border width. Without this offset the scaled layer's visual
		   center drifts border-width px down-right of the frame's true center
		   (and the node's on-screen title), growing as the border scales up. */
		top: calc(-1 * var(--deep-zoom-border-width, 0px));
		left: calc(-1 * var(--deep-zoom-border-width, 0px));
		transform-origin: top left;
		will-change: transform, opacity;
	}
</style>
