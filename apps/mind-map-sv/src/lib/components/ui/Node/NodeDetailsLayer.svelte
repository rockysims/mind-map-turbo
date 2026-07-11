<script lang="ts">
	import type { Snippet } from 'svelte';

	const {
		title,
		detailsTitleId,
		detailsMode = false,
		opacity = 0,
		children
	} = $props<{
		title: string;
		detailsTitleId?: string;
		detailsMode?: boolean;
		opacity?: number;
		children?: Snippet;
	}>();
</script>

<article
	class="details"
	data-details-mode={detailsMode ? 'true' : undefined}
	aria-hidden={!detailsMode ? 'true' : undefined}
	style="--node-details-opacity: {opacity};"
>
	<header>
		<h1 id={detailsTitleId} class="details-title">{title}</h1>
	</header>
	{#if children}
		<div class="details-body">
			{@render children()}
		</div>
	{/if}
</article>

<style>
	.details {
		grid-area: 1 / 1;
		will-change: opacity;
		display: grid;
		align-content: start;
		gap: 1rem;
		width: 100%;
		min-height: 100%;
		padding: clamp(1.25rem, 4vw, 3rem);
		box-sizing: border-box;
		opacity: var(--node-details-opacity);
		/* No pointer-events override: the morph surface (DeepZoomLayer) owns
		   interactivity. An explicit `auto` here would punch through the
		   layer's pointer-events:none during the entry scrub and swallow the
		   wheel input that drives the morph. Interactivity is inherited once
		   the layer is interactive. */
	}

	.details-title {
		margin: 0;
		color: #111827;
		font-size: clamp(2rem, 8vw, 4rem);
		line-height: 1.05;
	}

	.details-body {
		display: grid;
		gap: 1rem;
		color: #334155;
		font-size: 1.125rem;
		line-height: 1.65;
	}
</style>
