<script lang="ts">
	import type { Snippet } from 'svelte';
	import { pinScrollToOrigin } from '../Multigraph/lib/pinScroll';
	import { ringOverlapsContent } from './lib/ringLayers';

	let {
		diameterPx,
		borderRadiusPx,
		borderWidthPx,
		baseBorderWidthPx,
		pinned = false,
		hasTagBorder = false,
		tagBorderBackground = 'transparent',
		detailsMode = false,
		spotlight = false,
		spotlightColor = 'transparent',
		surfaceBackground,
		children
	}: {
		diameterPx: number;
		borderRadiusPx: number;
		/** The ring as drawn: the node border width times its border-weight factor. */
		borderWidthPx: number;
		/**
		 * How far the content is inset from the outer edge: the graph's own node
		 * border width (`multigraph.nodeBorderWidthPx`), so a weighted ring grows
		 * inward under the content instead of squeezing it. Omitted, the content
		 * sits inside the ring exactly as wide as it is drawn.
		 */
		baseBorderWidthPx?: number;
		pinned?: boolean;
		hasTagBorder?: boolean;
		tagBorderBackground?: string;
		detailsMode?: boolean;
		spotlight?: boolean;
		spotlightColor?: string;
		surfaceBackground?: string;
		children?: Snippet;
	} = $props();

	const contentInsetPx = $derived(baseBorderWidthPx ?? borderWidthPx);
	/** The content reaches over the ring's inner part, so it gets its backdrop. */
	const ringOverBase = $derived(ringOverlapsContent(borderWidthPx, contentInsetPx));
</script>

<!--
	Three layers, bottom to top, so a thick ring never squeezes the content and
	never hides under it:

	1. The fill — `.circle`'s own background, across the whole circle. A picture
	   or other dynamic background belongs here (as `.circle`'s background, or a
	   first child before `.ring`), so it fills the circle beneath the ring.
	2. `.ring` — the border, drawn inward from the outer edge at `borderWidthPx`.
	3. `.content` — the title, badges and chips, inset by `baseBorderWidthPx`
	   whatever the ring is, so its size never changes. Over a ring wider than
	   that it overlaps the ring's inner part, and `data-ring-over-base` gives
	   it a backdrop (`NodeCompactContent`).

	`onscroll` puts each clipping box straight back: neither is ever a scroller,
	in the stage or as deep zoom's frame, but `overflow: hidden` only stops the
	*reader* scrolling — script and focus still can, and in the frame that took
	the whole surface off screen. Unconditional rather than only in
	`detailsMode`, because the answer to "were you scrolled?" is the same "no"
	either way and a branch here would only be a second thing to get wrong. See
	`Multigraph/lib/pinScroll.ts`.
-->
<div
	class="circle"
	onscroll={(event) => pinScrollToOrigin(event.currentTarget)}
	data-pinned={pinned ? 'true' : undefined}
	data-tag-border={hasTagBorder ? 'true' : undefined}
	data-details-mode={detailsMode ? 'true' : undefined}
	data-spotlight={spotlight ? 'true' : undefined}
	data-ring-over-base={ringOverBase ? 'true' : undefined}
	style="--node-diameter: {diameterPx}px; --node-border-radius: {borderRadiusPx}px; --node-border-width: {borderWidthPx}px; --node-base-border-width: {contentInsetPx}px; --node-tag-border: {tagBorderBackground}; --node-spotlight-color: {spotlightColor};{surfaceBackground
		? ` --node-surface-background: ${surfaceBackground};`
		: ''}"
>
	<div class="ring" aria-hidden="true"></div>
	<div class="content" onscroll={(event) => pinScrollToOrigin(event.currentTarget)}>
		{@render children?.()}
	</div>
</div>

<style>
	.circle {
		position: relative;
		/* The ring and content stack against each other, not against the stage. */
		isolation: isolate;
		width: var(--node-diameter);
		height: var(--node-diameter);
		box-sizing: border-box;
		border-radius: var(--node-border-radius);
		/* Layer 1, the fill. A background image would be added here. */
		background: var(--node-surface-background, #ccc);
		overflow: hidden;
		/* Clipping, not scrolling — so scroll anchoring has no business here. */
		overflow-anchor: none;
	}

	/* Layer 2, the ring: drawn inward from the outer edge, transparent inside so
	   the fill (and any future background) shows through it. */
	.ring {
		position: absolute;
		inset: 0;
		z-index: 0;
		box-sizing: border-box;
		border-radius: var(--node-border-radius);
		border: var(--node-border-width) solid #aaaaaa;
		pointer-events: none;
	}

	/* Layer 3, the content: always the interior at the base width, above the
	   ring. Clipped to that interior's circle, which is where the ring's own
	   padding box used to clip it, so at the base width nothing moves. */
	.content {
		position: absolute;
		inset: var(--node-base-border-width);
		z-index: 1;
		display: grid;
		place-items: center;
		border-radius: max(0px, calc(var(--node-border-radius) - var(--node-base-border-width)));
		overflow: hidden;
		overflow-anchor: none;
	}

	/* Pinning changes the colour and adds a halo; the width stays the node's own. */
	.circle[data-pinned='true'] {
		box-shadow: 0 0 0 2px #ffffff;
	}

	.circle[data-pinned='true'] > .ring {
		border-color: #555555;
	}

	/* The conic tag gradient fills the ring only: painted across the border box,
	   then masked down to the band between the border box and the padding box. */
	.circle[data-tag-border='true'] > .ring {
		border-color: transparent;
		background: var(--node-tag-border) border-box;
		mask:
			linear-gradient(#000 0 0) padding-box,
			linear-gradient(#000 0 0) border-box;
		mask-composite: exclude;
	}

	.circle[data-spotlight='true'] {
		box-shadow:
			0 0 0 4px color-mix(in srgb, var(--node-spotlight-color) 55%, transparent),
			0 0 20px color-mix(in srgb, var(--node-spotlight-color) 62%, transparent);
	}

	.circle[data-details-mode='true'] {
		width: 100%;
		height: 100%;
		/* The frame only clips; panning/zooming oversized details content is the
		   wrapped ZoomWorld's job. A scroll container here (the old dialog model,
		   when .circle lived inside the world) would swallow wheel input meant
		   for zoom now that the frame wraps the world. */
		overflow: hidden;
		box-shadow: 0 24px 80px rgb(15 23 42 / 22%);
	}

	.circle[data-details-mode='true'] > .content {
		justify-content: stretch;
		align-items: stretch;
	}
</style>
