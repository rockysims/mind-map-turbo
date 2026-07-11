<script lang="ts">
	import DeepZoomLayer, { type FrameSnippetArgs } from './DeepZoomLayer.svelte';
	import { interpolateMorph } from './lib/morphGeometry';
	import type { FrameGeometry } from './lib/frameGeometry';

	let { reduceMotion = false } = $props();

	const source = { left: 200, top: 200, width: 100, height: 100 };
	const fill = { left: 60, top: 120, width: 440, height: 320 };
	const compactBasePx = 100;
	const detailsBaseWidthPx = 440;
	const detailsBaseHeightPx = 320;

	let progress = $state(0);

	const effectiveProgress = $derived(reduceMotion ? Math.round(progress) : progress);
	// The harness plays the CONSUMER role: it computes the morphed geometry once
	// and passes it in, so DeepZoomLayer never interpolates a second time.
	const geometry = $derived.by((): FrameGeometry => {
		const m = interpolateMorph(source, fill, effectiveProgress, {
			sourceBorderWidthPx: 2,
			targetBorderWidthPx: 14
		});
		return {
			x: m.x,
			y: m.y,
			width: m.width,
			height: m.height,
			borderRadiusPx: m.borderRadiusPx,
			borderWidthPx: m.borderWidthPx ?? 0
		};
	});

	function onScrub(event: Event) {
		progress = Number((event.currentTarget as HTMLInputElement).value);
	}
</script>

<div class="dzl-harness" data-reduce-motion={reduceMotion ? 'true' : 'false'}>
	<div class="beneath" data-beneath="true"></div>
	<div class="controls">
		<input
			class="scrub"
			data-scrub="progress"
			type="range"
			min="0"
			max="1"
			step="0.01"
			value={progress}
			oninput={onScrub}
			aria-label="morph progress"
		/>
	</div>

	{#snippet frame({ borderRadiusPx, borderWidthPx, content }: FrameSnippetArgs)}
		<div
			class="dzl-frame"
			style={`border-radius: ${borderRadiusPx}px; border-width: ${borderWidthPx}px;`}
		>
			{@render content()}
		</div>
	{/snippet}

	{#snippet compact()}
		<div class="dzl-compact" data-compact-content="true"><span>compact</span></div>
	{/snippet}

	{#snippet details()}
		<div class="dzl-details" data-details-content="true"><p>details</p></div>
	{/snippet}

	<DeepZoomLayer
		{geometry}
		{progress}
		{reduceMotion}
		{compactBasePx}
		{detailsBaseWidthPx}
		{detailsBaseHeightPx}
		{frame}
		{compact}
		{details}
	/>
</div>

<style>
	.dzl-harness {
		position: relative;
		width: 640px;
		height: 520px;
		background: #eef2ff;
	}

	.beneath {
		position: fixed;
		inset: 0;
		z-index: 1;
		background: transparent;
	}

	.controls {
		position: fixed;
		top: 0;
		left: 0;
		z-index: 100;
		padding: 0.25rem;
	}

	.dzl-frame {
		position: absolute;
		inset: 0;
		box-sizing: border-box;
		border-style: solid;
		border-color: #334155;
		background: #ffffff;
		overflow: hidden;
	}

	.dzl-compact,
	.dzl-details {
		display: grid;
		place-items: center;
		width: 100%;
		height: 100%;
		color: #0f172a;
	}

	.dzl-details {
		background: #dbeafe;
	}
</style>
