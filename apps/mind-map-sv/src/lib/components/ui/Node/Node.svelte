<script lang="ts">
	import {
		NODE_BORDER_WIDTH,
		NODE_RADIUS,
		NODE_TEXT_FONT_SIZE,
		PINNED_NODE_BORDER_WIDTH
	} from '$lib/constants';
	import SquareText from '$lib/components/ui/SquareText/SquareText.svelte';
	import type { NodeData } from '$lib/components/ui/types/node';
	import type { TagColorSegment } from '$lib/components/ui/Multigraph/lib/tagColors';

	let descriptionRef = $state<HTMLElement | null>(null);
	let titleInputRef = $state<HTMLInputElement | null>(null);

	const {
		nodeData = {
			id: 'id_fallback',
			title: 'title_fallback',
			description: 'description_fallback',
			tags: []
		},
		isOpen = false,
		isTitleEditing = false,
		borderSegments = [],
		onTitleCommit
	} = $props<{
		nodeData: NodeData;
		isOpen: boolean;
		isTitleEditing?: boolean;
		borderSegments?: TagColorSegment[];
		onTitleCommit?: (title: string) => void;
	}>();

	const borderBackground = $derived(
		borderSegments.length === 0 ? 'transparent' : borderGradient(borderSegments)
	);

	function borderGradient(segments: TagColorSegment[]): string {
		return `conic-gradient(${segments
			.map((segment) => `${segment.color} ${segment.startTurn}turn ${segment.endTurn}turn`)
			.join(', ')})`;
	}

	function updateVerticalScrollClass() {
		if (!descriptionRef) return;
		const hasVerticalScrollbar = descriptionRef.scrollHeight > descriptionRef.clientHeight;
		if (hasVerticalScrollbar) {
			descriptionRef.classList.add('vScroll');
		} else {
			descriptionRef.classList.remove('vScroll');
		}
	}

	$effect(() => {
		if (!isOpen) return;
		updateVerticalScrollClass();
	});

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
	class:open={isOpen}
	data-node-id={nodeData.id}
	data-pinned={nodeData.pinned ? 'true' : undefined}
	data-tag-border={borderSegments.length > 0 ? 'true' : undefined}
	style="--node-diameter: {NODE_RADIUS *
		2}px; --node-tag-border: {borderBackground}; --node-text-font-size: {NODE_TEXT_FONT_SIZE}px; --node-border-width: {NODE_BORDER_WIDTH}px; --pinned-node-border-width: {PINNED_NODE_BORDER_WIDTH}px;"
>
	<div class="circle">
		<!-- closed -->
		{#if !isOpen}
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

		<!-- open -->
		{#if isOpen}
			<div class="square">
				<div class="title">
					{nodeData.title}
				</div>
				<div class="descriptionContainer">
					<div class="description vScroll" bind:this={descriptionRef}>
						{nodeData.description}
					</div>
				</div>
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
		border-radius: var(--node-diameter);
		border: var(--node-border-width) solid #aaaaaa;
		background: #ccc;
	}

	.node[data-pinned='true'] .circle {
		border-width: var(--pinned-node-border-width);
		border-color: #555555;
		box-shadow: 0 0 0 2px #ffffff;
	}

	.node[data-tag-border='true'] .circle {
		border-color: transparent;
		background:
			linear-gradient(#ccc, #ccc) padding-box,
			var(--node-tag-border) border-box;
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

	.node .description {
		display: none;
	}

	.node.open :global(.title) {
		overflow: clip;
		text-wrap-mode: nowrap;
		text-overflow: ellipsis;
		width: 100%;
		padding: 0 8px 8px 8px;
	}

	.node.open .descriptionContainer {
		width: 100%;
		max-height: 80%;
		border-radius: 5px;
		overflow: hidden;
	}

	.node.open .description {
		display: flex;
		width: 100%;
		max-height: 100%;
		font-size: var(--node-text-font-size);
		padding: 0 8px;
		overflow-y: auto;
		text-align: center;
	}

	.node.open .square > * {
		box-sizing: border-box;
	}

	/* vScroll is added at runtime when description has vertical scrollbar */
	.node.open .description.vScroll {
		text-align: left;
		border-radius: 3px;
		box-shadow: 0px 0px 2px 0px #aaaaaa;
		background-color: #dddddd;
	}
</style>
