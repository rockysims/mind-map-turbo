<script lang="ts">
	import type { Snippet } from 'svelte';
	import MathText from '../MathText/MathText.svelte';
	import { mathPlainText } from '../MathText/lib/mathPlainText';

	let {
		title,
		detailsTitleId,
		detailsMode = false,
		children
	}: {
		title: string;
		detailsTitleId?: string;
		detailsMode?: boolean;
		children?: Snippet;
	} = $props();

	/**
	 * This heading names the focus dialog, so its accessible name is stated
	 * explicitly rather than left to how a given screen reader chooses to walk the
	 * MathML inside it. The projection is what a person would say out loud.
	 */
	const spokenTitle = $derived(mathPlainText(title));
</script>

<article
	class="details"
	data-details-mode={detailsMode ? 'true' : undefined}
	aria-hidden={!detailsMode ? 'true' : undefined}
>
	<header>
		<h1 id={detailsTitleId} class="details-title" aria-label={spokenTitle}>
			<MathText text={title} singleLine />
		</h1>
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
		/* The title, then everything else. `minmax(0, 1fr)` with `height: 100%` is
		   what gives the body a *definite* height rather than a content-driven
		   one, so a body that wants to be a scroll container (the AI workbench)
		   can say `max-height: 100%` and land exactly on the frame. Content that
		   does not — the details view — overflows the row and is clipped by the
		   frame, which is what it already did when the article grew past it. */
		grid-template-rows: auto minmax(0, 1fr);
		align-content: start;
		gap: 1rem;
		width: 100%;
		height: 100%;
		min-height: 100%;
		padding: clamp(1.25rem, 4vw, 3rem);
		box-sizing: border-box;
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
		/*
		 * A column flex box rather than a grid, for one reason: a grid item's
		 * percentage height resolves against its grid *area*, and an auto row's
		 * area is sized by the item it holds, so `max-height: 100%` on the content
		 * is only as definite as the browser chooses to make it. A flex item's
		 * percentage resolves against this box, whose height the row above makes
		 * definite, and that is stated rather than hoped for. (Once `ZoomWorld`
		 * bound its subject to the frame, Chromium bounded the workbench through
		 * the grid form too — but nothing in the spec promises that, and this app
		 * ships to three engines.) One child either way, so it is the same box in
		 * the same place.
		 */
		display: flex;
		flex-direction: column;
		/* So this box can be shorter than the content inside it; without it the
		   grid item's automatic minimum size pushes the row back out to content
		   height and the definite height above is a fiction. */
		min-height: 0;
		gap: 1rem;
		color: #334155;
		font-size: 1.125rem;
		line-height: 1.65;
	}
</style>
