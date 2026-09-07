<script lang="ts">
	import SquareText from '$lib/components/ui/SquareText/SquareText.svelte';
	import type { AddonBadge } from './lib/addonBadges';

	let titleInputRef = $state<HTMLInputElement | null>(null);

	let {
		title,
		isTitleEditing = false,
		titleCaretAt,
		diameterPx,
		fontSizePx,
		detailsMode = false,
		quantityLabels = [],
		quantityOverflowCount = 0,
		badges = [],
		taskDone = false,
		onTitleCommit
	}: {
		title: string;
		isTitleEditing?: boolean;
		/**
		 * Where to leave the caret when the title input opens, instead of selecting
		 * the whole title. Set when the caller seeded the text and the author is
		 * meant to continue it rather than replace it — a Define node arrives as
		 * `$k = $` with the caret just before the closing `$`, ready for the
		 * right-hand side. Omitted everywhere else, so select-all stays the default:
		 * a title the author never asked for is one they usually want to overwrite.
		 */
		titleCaretAt?: number;
		diameterPx: number;
		fontSizePx: number;
		detailsMode?: boolean;
		/** Quantities this node defines. Empty unless the node is large enough to read. */
		quantityLabels?: string[];
		/** Quantities beyond those named, or zero when they all fit. */
		quantityOverflowCount?: number;
		/** Add-on and attachment glyphs, decided by `lib/addonBadges.ts`. */
		badges?: readonly AddonBadge[];
		/** Mutes the title. Redundant with the task badge, and deliberately so:
		 * the badge says which state, the muting says it at a glance. */
		taskDone?: boolean;
		onTitleCommit?: (title: string) => void;
	} = $props();

	$effect(() => {
		if (!isTitleEditing || !titleInputRef) return;
		const el = titleInputRef;
		const caretAt = titleCaretAt;
		requestAnimationFrame(() => {
			el.focus();
			if (caretAt === undefined) {
				el.select();
				return;
			}
			// Clamp rather than trust: the caller computed the offset against the
			// title it seeded, and the input's value is the only authority on what
			// is actually there.
			const offset = Math.max(0, Math.min(caretAt, el.value.length));
			el.setSelectionRange(offset, offset);
		});
	});
</script>

<div
	class="compact-layer"
	data-details-mode={detailsMode ? 'true' : undefined}
	data-task-done={taskDone ? 'true' : undefined}
	aria-hidden={detailsMode ? 'true' : undefined}
	style="--node-diameter: {diameterPx}px; --node-text-font-size: {fontSizePx}px;"
>
	{#if badges.length > 0}
		<!--
			The band above the inscribed square, mirroring the quantity chips in the
			band below it: both are unclaimed by the auto-fitting title, and putting
			the badges opposite the chips is what keeps two glyphs and three chips
			from ever meeting.
		-->
		<div class="addon-badges" data-node-addon-badges>
			{#each badges as badge (badge.kind)}
				<span
					class="addon-badge"
					data-addon-badge={badge.kind}
					role="img"
					aria-label={badge.label}
					title={badge.label}
					>{badge.glyph}{#if badge.count !== undefined}<span class="badge-count">{badge.count}</span
						>{/if}</span
				>
			{/each}
		</div>
	{/if}
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

	/*
	 * Sized off the node's own font size like everything else inside it, so a
	 * badge shrinks and grows with the node rather than becoming a fleck at
	 * distance or a placard up close.
	 */
	.addon-badges {
		position: absolute;
		bottom: 100%;
		left: 50%;
		display: flex;
		gap: 0.2em;
		justify-content: center;
		/* The chord this far up the circle is narrower than the square below it. */
		max-width: calc(var(--node-diameter) * 0.55);
		transform: translateX(-50%);
		font-size: calc(var(--node-text-font-size) * 0.9);
		line-height: 1.2;
		overflow: hidden;
		/*
		 * Display only, by the milestone's decision: done is toggled in the details
		 * view, never by a canvas tap. Hit testing is geometric against the node
		 * circle, so a badge that swallowed pointer events would be a dead zone
		 * where a drag refuses to start.
		 */
		pointer-events: none;
	}

	/* Tabular-ish and a shade smaller, so the number reads as a count on the
	   glyph rather than as a second glyph. */
	.badge-count {
		font-size: 0.8em;
		font-weight: bold;
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

	/*
	 * The same slate the details view uses for text that is present but no longer
	 * the point, against the node's own light surface. Colour alone rather than a
	 * strike-through: the milestone says a done task renders muted and nothing
	 * else changes about it, and the checked badge carries the state for anyone
	 * the contrast shift passes by.
	 */
	.compact-layer[data-task-done='true'] :global(.title) {
		color: #64748b;
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
