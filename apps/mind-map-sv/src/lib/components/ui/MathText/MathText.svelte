<script lang="ts">
	import { fitScale } from './lib/mathFit';
	import { renderMath } from './lib/mathRender';
	import { splitMathSegments } from './lib/mathSegments';

	let {
		text = '',
		classList = [],
		singleLine = false
	}: {
		text?: string;
		classList?: string[];
		/**
		 * Render display math inline instead of as a block. A title is one line and
		 * is measured by a container that resizes it, and the block path installs a
		 * ResizeObserver that would fight that measurement.
		 */
		singleLine?: boolean;
	} = $props();

	const segments = $derived(
		singleLine
			? splitMathSegments(text).map((segment) =>
					segment.kind === 'display-math' ? { ...segment, kind: 'inline-math' as const } : segment
				)
			: splitMathSegments(text)
	);

	/**
	 * Scale a display equation down to its column width. Transforms do not affect
	 * layout, so the wrapper's height is set from the scaled height too — otherwise
	 * a shrunken equation would leave the gap of its original size behind it.
	 */
	function fitDisplayMath(node: HTMLElement) {
		let lastWidth = -1;

		function apply() {
			const container = node.parentElement;
			if (!container) return;
			const available = container.clientWidth;
			const scale = fitScale(available, node.scrollWidth);
			node.style.transform = scale < 1 ? `scale(${scale})` : '';
			container.style.height = scale < 1 ? `${node.scrollHeight * scale}px` : '';
		}

		apply();

		// Width is the only input that matters; ignoring other resizes stops the
		// height we set above from feeding back into another measurement.
		const observer = new ResizeObserver((entries) => {
			const width = entries[0]?.contentRect.width ?? -1;
			if (width === lastWidth) return;
			lastWidth = width;
			apply();
		});
		if (node.parentElement) observer.observe(node.parentElement);

		return {
			destroy: () => observer.disconnect()
		};
	}
</script>

<!--
	The only thing interpolated below is Temml's own output. mathRender pins
	trust:false and caps expansion, and its spec covers script, href, url, and
	includegraphics payloads, so this markup cannot carry executable content or a
	fetchable URL. Descriptions must never reach {@html} by any other route.
-->
<!-- eslint-disable svelte/no-at-html-tags -->
<!--
	Written as one line on purpose: whitespace between segments would render as
	spaces the author never typed. AddsNoStrayWhitespaceBetweenAdjacentSegments
	guards this.
-->
<!-- prettier-ignore -->
<span class={['math-text', ...classList]} data-math-text>{#each segments as segment, index (`${index}:${segment.source}`)}{#if segment.kind === 'text'}<span class="segment-text" data-segment="text">{segment.content}</span>{:else if segment.kind === 'inline-math'}{@const rendered = renderMath(segment.content, { displayMode: false })}<span class="segment-inline" data-segment="inline-math" data-math-error={!rendered.ok}>{@html rendered.markup}</span>{:else}{@const rendered = renderMath(segment.content, { displayMode: true })}<span class="segment-display" data-segment="display-math" data-math-error={!rendered.ok}><span class="segment-display-inner" use:fitDisplayMath>{@html rendered.markup}</span></span>{/if}{/each}</span>

<style>
	.math-text {
		display: inline;
	}

	.segment-text {
		white-space: pre-wrap;
	}

	.segment-inline {
		white-space: normal;
	}

	.segment-display {
		display: block;
		/* The scaled equation fits, but its untransformed layout box still spans the
		   natural width, which would otherwise push the column wider. */
		overflow: hidden;
	}

	.segment-display-inner {
		display: inline-block;
		transform-origin: left top;
	}
</style>
