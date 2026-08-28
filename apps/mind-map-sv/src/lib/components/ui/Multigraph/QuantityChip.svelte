<script lang="ts">
	/**
	 * One quantity, drawn as a chip.
	 *
	 * Two surfaces render these and they must be the same object to the eye: the
	 * designation columns, where a chip is what the node takes in or gives out,
	 * and a peek card's drill line, where a chip is a definer's own input. The
	 * drill line borrows the columns' visual language deliberately — the reader
	 * has already learned that a pill with an italic letter is a quantity — so the
	 * markup and its scoped CSS live here rather than being copied.
	 *
	 * The identifying attributes come in through `attributes` rather than as named
	 * props: the two call sites label their chips for entirely different
	 * selectors (`data-designation-*` versus `data-peek-drill`), and inventing a
	 * union of both here would put each surface's vocabulary in the other's way.
	 */

	let {
		label,
		stale = false,
		suggestion = false,
		peeking = false,
		interactive = false,
		marker,
		attributes,
		onclick
	}: {
		/** Human-readable quantity name, e.g. `v` or `v_0`. */
		label: string;
		/** Confirmed, but the node's text no longer mentions it. */
		stale?: boolean;
		/** Parsed but unconfirmed — drawn as a ghost. */
		suggestion?: boolean;
		/** This chip's card is open. */
		peeking?: boolean;
		/** Renders a button rather than an inert span. */
		interactive?: boolean;
		/** A glyph after the label, e.g. the loop marker on a chip that repeats. */
		marker?: string;
		/** Whatever identifies this chip to its surface: data attributes, aria, title. */
		attributes?: Record<string, string | undefined>;
		onclick?: (event: MouseEvent) => void;
	} = $props();
</script>

{#snippet chipContent()}
	<span class="label">{label}</span>
	{#if stale}
		<span class="stale-mark" aria-hidden="true">!</span>
	{/if}
	{#if marker}
		<span class="marker" aria-hidden="true">{marker}</span>
	{/if}
{/snippet}

{#if interactive}
	<button
		type="button"
		class="chip"
		class:suggestion
		class:stale
		class:peeking
		{...attributes}
		{onclick}
	>
		{@render chipContent()}
	</button>
{:else}
	<span class="chip inert" class:suggestion class:stale {...attributes}>
		{@render chipContent()}
	</span>
{/if}

<style>
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		min-height: 2rem;
		border: 1px solid #cbd5e1;
		border-radius: 999px;
		padding: 0.2rem 0.6rem;
		background: #ffffff;
		color: #0f172a;
		font: inherit;
		font-size: 0.9rem;
	}

	button.chip {
		cursor: pointer;
	}

	.label {
		font-style: italic;
		font-weight: 600;
	}

	/*
	 * A ghost reads as an offer rather than a fact: the same shape as a confirmed
	 * chip so its column placement is legible, drawn faintly so the eye does not
	 * count it among what the node actually does.
	 */
	.chip.suggestion {
		border-style: dotted;
		background: transparent;
		color: #475569;
		opacity: 0.65;
	}

	/*
	 * Still a real designation — it draws its edge — so it keeps the solid fill of
	 * a confirmed chip and takes a warning tint instead of fading out.
	 */
	.chip.stale {
		border-style: dashed;
		border-color: #f59e0b;
		background: #fffbeb;
		color: #92400e;
		opacity: 1;
	}

	.stale-mark {
		font-weight: 700;
	}

	.chip.peeking {
		border-color: #0f172a;
		background: #e2e8f0;
	}

	.chip.inert {
		cursor: default;
	}

	.marker {
		color: #64748b;
	}
</style>
