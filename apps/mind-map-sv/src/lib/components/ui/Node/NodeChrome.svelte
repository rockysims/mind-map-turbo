<script lang="ts">
	import type { Snippet } from 'svelte';

	const {
		diameterPx,
		borderRadiusPx,
		borderWidthPx,
		pinnedBorderWidthPx,
		pinned = false,
		hasTagBorder = false,
		tagBorderBackground = 'transparent',
		detailsMode = false,
		spotlight = false,
		spotlightColor = 'transparent',
		surfaceBackground,
		children
	} = $props<{
		diameterPx: number;
		borderRadiusPx: number;
		borderWidthPx: number;
		pinnedBorderWidthPx: number;
		pinned?: boolean;
		hasTagBorder?: boolean;
		tagBorderBackground?: string;
		detailsMode?: boolean;
		spotlight?: boolean;
		spotlightColor?: string;
		surfaceBackground?: string;
		children?: Snippet;
	}>();
</script>

<div
	class="circle"
	data-pinned={pinned ? 'true' : undefined}
	data-tag-border={hasTagBorder ? 'true' : undefined}
	data-details-mode={detailsMode ? 'true' : undefined}
	data-spotlight={spotlight ? 'true' : undefined}
	style="--node-diameter: {diameterPx}px; --node-border-radius: {borderRadiusPx}px; --node-border-width: {borderWidthPx}px; --pinned-node-border-width: {pinnedBorderWidthPx}px; --node-tag-border: {tagBorderBackground}; --node-spotlight-color: {spotlightColor};{surfaceBackground
		? ` --node-surface-background: ${surfaceBackground};`
		: ''}"
>
	{@render children?.()}
</div>

<style>
	.circle {
		display: grid;
		place-items: center;
		width: var(--node-diameter);
		height: var(--node-diameter);
		box-sizing: border-box;
		border-radius: var(--node-border-radius);
		border: var(--node-border-width) solid #aaaaaa;
		background: var(--node-surface-background, #ccc);
		overflow: hidden;
	}

	.circle[data-pinned='true'] {
		border-width: var(--pinned-node-border-width);
		border-color: #555555;
		box-shadow: 0 0 0 2px #ffffff;
	}

	.circle[data-tag-border='true'] {
		border-color: transparent;
		background:
			linear-gradient(var(--node-surface-background, #ccc), var(--node-surface-background, #ccc))
				padding-box,
			var(--node-tag-border) border-box;
	}

	.circle[data-spotlight='true'] {
		box-shadow:
			0 0 0 4px color-mix(in srgb, var(--node-spotlight-color) 55%, transparent),
			0 0 20px color-mix(in srgb, var(--node-spotlight-color) 62%, transparent);
	}

	.circle[data-details-mode='true'] {
		justify-content: stretch;
		align-items: stretch;
		width: 100%;
		height: 100%;
		/* The frame only clips; panning/zooming oversized details content is the
		   wrapped ZoomWorld's job. A scroll container here (the old dialog model,
		   when .circle lived inside the world) would swallow wheel input meant
		   for zoom now that the frame wraps the world. */
		overflow: hidden;
		box-shadow: 0 24px 80px rgb(15 23 42 / 22%);
	}
</style>
