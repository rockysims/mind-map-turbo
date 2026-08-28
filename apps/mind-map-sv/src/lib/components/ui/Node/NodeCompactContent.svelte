<script lang="ts">
	import SquareText from '$lib/components/ui/SquareText/SquareText.svelte';

	let titleInputRef = $state<HTMLInputElement | null>(null);

	const {
		title,
		isTitleEditing = false,
		diameterPx,
		fontSizePx,
		detailsMode = false,
		quantityLabels = [],
		quantityOverflowCount = 0,
		onTitleCommit
	} = $props<{
		title: string;
		isTitleEditing?: boolean;
		diameterPx: number;
		fontSizePx: number;
		detailsMode?: boolean;
		/** Quantities this node defines. Empty unless the node is large enough to read. */
		quantityLabels?: string[];
		/** Quantities beyond those named, or zero when they all fit. */
		quantityOverflowCount?: number;
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
	{#if quantityLabels.length > 0 || quantityOverflowCount > 0}
		<!--
			Sits in the circular band below the inscribed square, which is otherwise
			unclaimed, so the auto-fitting title keeps all of its space.
		-->
		<div class="quantities" data-node-quantities>
			{#each quantityLabels as label (label)}
				<span class="quantity-chip">{label}</span>
			{/each}
			{#if quantityOverflowCount > 0}
				<span class="quantity-chip overflow">+{quantityOverflowCount}</span>
			{/if}
		</div>
	{/if}
</div>

<style>
	.compact-layer {
		grid-area: 1 / 1;
		position: relative;
		will-change: opacity;
	}

	.quantities {
		position: absolute;
		top: 100%;
		left: 50%;
		display: flex;
		gap: 0.25em;
		justify-content: center;
		/* The chord this far down the circle is narrower than the square above it. */
		max-width: calc(var(--node-diameter) * 0.55);
		transform: translateX(-50%);
		overflow: hidden;
		/*
		 * Hit testing is geometric against the node circle, so a chip that swallowed
		 * pointer events would look like a dead zone that refuses to start a drag.
		 */
		pointer-events: none;
	}

	.quantity-chip {
		padding: 0 0.3em;
		border-radius: 0.25em;
		background: rgba(15, 23, 42, 0.08);
		font-size: calc(var(--node-text-font-size) * 0.75);
		font-style: italic;
		line-height: 1.4;
		white-space: nowrap;
	}

	.quantity-chip.overflow {
		font-style: normal;
		opacity: 0.7;
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
