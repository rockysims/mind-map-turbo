<script lang="ts">
	import SquareText from '$lib/components/ui/SquareText/SquareText.svelte';

	let titleInputRef = $state<HTMLInputElement | null>(null);

	const {
		title,
		isTitleEditing = false,
		diameterPx,
		fontSizePx,
		detailsMode = false,
		onTitleCommit
	} = $props<{
		title: string;
		isTitleEditing?: boolean;
		diameterPx: number;
		fontSizePx: number;
		detailsMode?: boolean;
		onTitleCommit?: (title: string) => void;
	}>();

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
	class="compact-layer"
	data-details-mode={detailsMode ? 'true' : undefined}
	aria-hidden={detailsMode ? 'true' : undefined}
	style="--node-diameter: {diameterPx}px; --node-text-font-size: {fontSizePx}px;"
>
	<div class="square">
		{#if isTitleEditing}
			<input
				bind:this={titleInputRef}
				class="title-input"
				type="text"
				value={title}
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
			<SquareText classList={['title']} text={title} />
		{/if}
	</div>
</div>

<style>
	.compact-layer {
		grid-area: 1 / 1;
		will-change: opacity;
	}

	.compact-layer[data-details-mode='true'] {
		pointer-events: none;
	}

	.square {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		text-align: center;
		width: calc(var(--node-diameter) / sqrt(2));
		height: calc(var(--node-diameter) / sqrt(2));
	}

	.compact-layer :global(.title) {
		font-weight: bold;
		font-size: var(--node-text-font-size);
		padding-bottom: 15px;
		text-align: center;
	}

	.title-input {
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
