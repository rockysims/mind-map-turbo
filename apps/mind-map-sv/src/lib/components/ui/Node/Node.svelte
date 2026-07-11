<script lang="ts">
	import type { Snippet } from 'svelte';
	import {
		NODE_BORDER_WIDTH,
		NODE_RADIUS,
		NODE_TEXT_FONT_SIZE,
		PINNED_NODE_BORDER_WIDTH
	} from '$lib/constants';
	import SquareText from '$lib/components/ui/SquareText/SquareText.svelte';
	import type { NodeData } from '$lib/components/ui/types/node';
	import type { TagColorSegment } from '$lib/components/ui/Multigraph/lib/tagColors';
	import { borderRadiusForProgress } from '$lib/components/ui/Multigraph/lib/zoomBoundary';

	let titleInputRef = $state<HTMLInputElement | null>(null);

	const {
		nodeData = {
			id: 'id_fallback',
			title: 'title_fallback',
			description: 'description_fallback',
			tags: []
		},
		isTitleEditing = false,
		borderSegments = [],
		detailsMode = false,
		detailsProgress = 0,
		detailsTitleId,
		spotlightColor,
		onTitleCommit,
		children
	} = $props<{
		nodeData: NodeData;
		isTitleEditing?: boolean;
		borderSegments?: TagColorSegment[];
		detailsMode?: boolean;
		detailsProgress?: number;
		detailsTitleId?: string;
		spotlightColor?: string;
		onTitleCommit?: (title: string) => void;
		children?: Snippet;
	}>();

	const borderBackground = $derived(
		borderSegments.length === 0 ? 'transparent' : borderGradient(borderSegments)
	);
	const clampedDetailsProgress = $derived(Math.min(1, Math.max(0, detailsProgress)));
	const borderRadiusPx = $derived(borderRadiusForProgress(NODE_RADIUS * 2, clampedDetailsProgress));

	function borderGradient(segments: TagColorSegment[]): string {
		return `conic-gradient(${segments
			.map((segment) => `${segment.color} ${segment.startTurn}turn ${segment.endTurn}turn`)
			.join(', ')})`;
	}

	$effect(() => {
		if (!isTitleEditing || !titleInputRef) return;
		const el = titleInputRef;
		requestAnimationFrame(() => {
			el.focus();
			el.select();
		});
	});
</script>

<div
	class="node"
	data-node-id={nodeData.id}
	data-pinned={nodeData.pinned ? 'true' : undefined}
	data-tag-border={borderSegments.length > 0 ? 'true' : undefined}
	data-details-mode={detailsMode ? 'true' : undefined}
	data-details-progress={clampedDetailsProgress}
	data-spotlight={spotlightColor ? 'true' : undefined}
	style="--node-diameter: {NODE_RADIUS *
		2}px; --node-border-radius: {borderRadiusPx}px; --node-tag-border: {borderBackground}; --node-text-font-size: {NODE_TEXT_FONT_SIZE}px; --node-border-width: {NODE_BORDER_WIDTH}px; --pinned-node-border-width: {PINNED_NODE_BORDER_WIDTH}px; --node-spotlight-color: {spotlightColor ??
		'transparent'};"
>
	<div class="circle">
		{#if detailsMode}
			<article class="details">
				<header>
					<h1 id={detailsTitleId} class="details-title">{nodeData.title}</h1>
				</header>
				{#if children}
					<div class="details-body">
						{@render children()}
					</div>
				{/if}
			</article>
		{:else}
			<div class="square">
				{#if isTitleEditing}
					<input
						bind:this={titleInputRef}
						class="title-input"
						type="text"
						value={nodeData.title}
						onblur={(e) => onTitleCommit?.(e.currentTarget.value)}
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								onTitleCommit?.(e.currentTarget.value);
							}
						}}
						onclick={(e) => e.stopPropagation()}
						onpointerdown={(e) => e.stopPropagation()}
					/>
				{:else}
					<SquareText classList={['title']} text={nodeData.title} />
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	.node .circle {
		display: flex;
		justify-content: center;
		align-items: center;
		width: var(--node-diameter);
		height: var(--node-diameter);
		box-sizing: border-box;
		border-radius: var(--node-border-radius);
		border: var(--node-border-width) solid #aaaaaa;
		background: var(--node-surface-background, #ccc);
		overflow: hidden;
	}

	.node[data-pinned='true'] .circle {
		border-width: var(--pinned-node-border-width);
		border-color: #555555;
		box-shadow: 0 0 0 2px #ffffff;
	}

	.node[data-tag-border='true'] .circle {
		border-color: transparent;
		background:
			linear-gradient(var(--node-surface-background, #ccc), var(--node-surface-background, #ccc))
				padding-box,
			var(--node-tag-border) border-box;
	}

	.node[data-spotlight='true'] .circle {
		box-shadow:
			0 0 0 4px color-mix(in srgb, var(--node-spotlight-color) 55%, transparent),
			0 0 20px color-mix(in srgb, var(--node-spotlight-color) 62%, transparent);
	}

	.node .square {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		text-align: center;
		width: calc(var(--node-diameter) / sqrt(2));
		height: calc(var(--node-diameter) / sqrt(2));
	}

	.node[data-details-mode='true'] {
		--node-surface-background: #ffffff;

		width: var(--node-details-width, min(calc(100vw - 2rem), 52rem));
		height: var(--node-details-height, min(calc(100vh - 2rem), 46rem));
	}

	.node[data-details-mode='true'] .circle {
		justify-content: stretch;
		align-items: stretch;
		width: 100%;
		height: 100%;
		overflow: auto;
		box-shadow: 0 24px 80px rgb(15 23 42 / 22%);
	}

	.node[data-details-mode='true'] .details {
		display: grid;
		align-content: start;
		gap: 1rem;
		width: 100%;
		min-height: 100%;
		padding: clamp(1.25rem, 4vw, 3rem);
		box-sizing: border-box;
	}

	.node[data-details-mode='true'] .details-title {
		margin: 0;
		color: #111827;
		font-size: clamp(2rem, 8vw, 4rem);
		line-height: 1.05;
	}

	.node[data-details-mode='true'] .details-body {
		display: grid;
		gap: 1rem;
		color: #334155;
		font-size: 1.125rem;
		line-height: 1.65;
	}

	.node :global(.title) {
		font-weight: bold;
		font-size: var(--node-text-font-size);
		padding-bottom: 15px;
		text-align: center;
	}

	.node .title-input {
		width: 100%;
		font-weight: bold;
		text-align: center;
		font-size: var(--node-text-font-size);
		font-family: inherit;
		border: none;
		outline: 2px solid #4a90e2;
		border-radius: 3px;
		background: rgba(255, 255, 255, 0.85);
		padding: 4px 6px;
		box-sizing: border-box;
		touch-action: none;
	}
</style>
