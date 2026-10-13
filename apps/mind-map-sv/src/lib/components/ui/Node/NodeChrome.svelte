<script lang="ts">
	import type { Snippet } from 'svelte';
	import { pinScrollToOrigin } from '../Multigraph/lib/pinScroll';
	import { boxOverlapsRing, ringOverlapsContent } from './lib/ringLayers';

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

	let circleEl = $state<HTMLDivElement | null>(null);

	/**
	 * The readable parts of the content that get a backdrop where they sit on
	 * the ring: the title's words (their own box, not the fitted square) and the
	 * badge and chip rows, as `NodeCompactContent` draws them.
	 */
	const BACKDROP_TARGETS =
		'.title > .squareTextBody, [data-node-addon-badges], [data-node-quantities]';
	const OVER_RING = 'data-over-ring';

	/**
	 * Mark each backdrop target whose box actually overlaps the ring with
	 * `data-over-ring`, and clear it from the rest; `NodeCompactContent` fades
	 * the backdrop in and out on that attribute.
	 *
	 * Boxes come from `getBoundingClientRect`, relative to the circle's and
	 * divided by the circle's own on-screen scale (its rect width over its
	 * layout width). That is transform-safe both ways the content is scaled:
	 * the stage's zoom transforms the whole circle (divided out), and the
	 * deep-zoom frame scales the compact layer inside an unscaled circle (kept,
	 * since the layer is drawn at that size in the circle). Offsets from
	 * `offsetLeft` would see neither.
	 */
	function markBackdrops(circle: HTMLElement, ringWidthPx: number, baseWidthPx: number) {
		const circleRect = circle.getBoundingClientRect();
		const layoutWidth = circle.offsetWidth;
		const layoutHeight = circle.offsetHeight;
		const scale = layoutWidth > 0 ? circleRect.width / layoutWidth : 0;
		const geometry = {
			radiusPx: Math.min(layoutWidth, layoutHeight) / 2,
			ringWidthPx,
			baseWidthPx,
			centerXPx: layoutWidth / 2,
			centerYPx: layoutHeight / 2
		};
		for (const target of circle.querySelectorAll<HTMLElement>(BACKDROP_TARGETS)) {
			const rect = target.getBoundingClientRect();
			const over =
				scale > 0 &&
				boxOverlapsRing(
					{
						left: (rect.left - circleRect.left) / scale,
						top: (rect.top - circleRect.top) / scale,
						width: rect.width / scale,
						height: rect.height / scale
					},
					geometry
				);
			if (over) target.setAttribute(OVER_RING, 'true');
			else target.removeAttribute(OVER_RING);
		}
	}

	/**
	 * Re-measured when the ring, the inset or the node's size changes (this
	 * effect), when a target or the circle is resized (`ResizeObserver`: a
	 * retitle re-fits the words), and when a target appears or goes (a
	 * `MutationObserver` on the content's children: a badge row added, the
	 * title swapped for its input). None of it runs while the ring is at the
	 * base, which is every node with no weight: the guard clears any flags left
	 * from a thicker ring and stops there, so a plain node does no work at all.
	 */
	$effect(() => {
		const circle = circleEl;
		const ringWidthPx = borderWidthPx;
		const baseWidthPx = contentInsetPx;
		// Tracked so a resize or morph re-measures; the values are read from layout.
		void diameterPx;
		void borderRadiusPx;
		if (!circle) return;
		if (!ringOverlapsContent(ringWidthPx, baseWidthPx)) {
			for (const marked of circle.querySelectorAll(`[${OVER_RING}]`)) {
				marked.removeAttribute(OVER_RING);
			}
			return;
		}

		const resizes = new ResizeObserver(() => markBackdrops(circle, ringWidthPx, baseWidthPx));
		const observeTargets = () => {
			resizes.disconnect();
			resizes.observe(circle);
			for (const target of circle.querySelectorAll(BACKDROP_TARGETS)) resizes.observe(target);
		};
		const mutations = new MutationObserver(() => {
			observeTargets();
			markBackdrops(circle, ringWidthPx, baseWidthPx);
		});
		observeTargets();
		mutations.observe(circle, { childList: true, subtree: true });
		markBackdrops(circle, ringWidthPx, baseWidthPx);

		return () => {
			resizes.disconnect();
			mutations.disconnect();
		};
	});
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
	   that it may overlap the ring's inner part; each title, badge row or chip
	   row that does is marked `data-over-ring`, and fades in a backdrop
	   (`NodeCompactContent`).

	`onscroll` puts each clipping box straight back: neither is ever a scroller,
	in the stage or as deep zoom's frame, but `overflow: hidden` only stops the
	*reader* scrolling — script and focus still can, and in the frame that took
	the whole surface off screen. Unconditional rather than only in
	`detailsMode`, because the answer to "were you scrolled?" is the same "no"
	either way and a branch here would only be a second thing to get wrong. See
	`Multigraph/lib/pinScroll.ts`.
-->
<div
	bind:this={circleEl}
	class="circle"
	onscroll={(event) => pinScrollToOrigin(event.currentTarget)}
	data-pinned={pinned ? 'true' : undefined}
	data-tag-border={hasTagBorder ? 'true' : undefined}
	data-details-mode={detailsMode ? 'true' : undefined}
	data-spotlight={spotlight ? 'true' : undefined}
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
