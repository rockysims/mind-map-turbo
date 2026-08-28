<script lang="ts">
	/**
	 * The two columns a node's quantities live in: what it takes in on the left,
	 * what it produces on the right.
	 *
	 * Tap never means two things on one surface. In `edit` mode a chip cycles its
	 * assignment and nothing here navigates; in `view` mode nothing here mutates
	 * and an input chip opens its definition. That mirrors the app's existing split
	 * between the edit sheet and the focus overlay, so a tap on the canvas can
	 * never quietly rewrite the graph.
	 *
	 * Suggestions render as ghosts in the column they would land in, so accepting
	 * one looks like confirming what is already drawn rather than filing it
	 * somewhere new.
	 */
	import type { QuantitySymbol } from '../MathText/lib/mathSymbols';
	import type { DesignationChip, DesignationView } from './lib/quantityDesignations';

	let {
		mode,
		view,
		onCycle,
		onPeek,
		peekKey = null
	}: {
		mode: 'edit' | 'view';
		view: DesignationView;
		/** Edit mode only: advance this quantity around the assignment cycle. */
		onCycle?: (symbol: QuantitySymbol, suggestedRole?: 'input' | 'output') => void;
		/** View mode only: show where this input is defined, anchored to its chip. */
		onPeek?: (key: string, anchor: HTMLElement) => void;
		/** The input whose peek card is open, so its chip can read as pressed. */
		peekKey?: string | null;
	} = $props();

	/**
	 * A suggestion with no opinion lands on the left. An unclassified symbol is one
	 * the node mentions without defining, which is what an input is.
	 */
	const inputColumn = $derived([
		...view.inputs,
		...view.suggestions.filter((chip) => chip.suggestedRole !== 'output')
	]);
	const outputColumn = $derived([
		...view.outputs,
		...view.suggestions.filter((chip) => chip.suggestedRole === 'output')
	]);
	const isEmpty = $derived(inputColumn.length === 0 && outputColumn.length === 0);
	const hasSuggestions = $derived(view.suggestions.length > 0);

	function isInteractive(chip: DesignationChip): boolean {
		if (mode === 'edit') return onCycle !== undefined;
		return chip.role === 'input' && onPeek !== undefined;
	}

	function chipTitle(chip: DesignationChip): string {
		if (mode === 'edit') {
			// The cycle enters at the suggested role, so the next stop depends on
			// where the parser put this quantity, not on a fixed order.
			const first = chip.suggestedRole ?? 'input';
			const second = first === 'input' ? 'output' : 'input';
			if (chip.role === 'suggestion') return `Confirm ${chip.symbol.label} as an ${first}`;
			if (chip.role === first) return `Make ${chip.symbol.label} an ${second}`;
			return `Unassign ${chip.symbol.label}`;
		}
		if (chip.role === 'input') return `Show where ${chip.symbol.label} is defined`;
		return chip.symbol.label;
	}

	function activate(chip: DesignationChip, event: MouseEvent) {
		if (mode === 'edit') {
			onCycle?.(chip.symbol, chip.suggestedRole);
			return;
		}
		if (chip.role !== 'input') return;
		onPeek?.(chip.symbol.key, event.currentTarget as HTMLElement);
	}
</script>

{#snippet chipContent(chip: DesignationChip)}
	<span class="label">{chip.symbol.label}</span>
	{#if chip.stale}
		<span class="stale-mark" aria-hidden="true">!</span>
	{/if}
{/snippet}

{#snippet chipList(chips: DesignationChip[], columnLabel: string)}
	<ul aria-label={columnLabel}>
		{#each chips as chip (chip.symbol.key)}
			<li>
				{#if isInteractive(chip)}
					<button
						type="button"
						class="chip"
						class:suggestion={chip.role === 'suggestion'}
						class:stale={chip.stale}
						class:peeking={mode === 'view' && peekKey === chip.symbol.key}
						data-designation-role={chip.role}
						data-designation-stale={chip.stale ? 'true' : undefined}
						data-designation-key={chip.symbol.key}
						aria-pressed={mode === 'view' && chip.role === 'input'
							? peekKey === chip.symbol.key
							: undefined}
						title={chipTitle(chip)}
						onclick={(event) => activate(chip, event)}
					>
						{@render chipContent(chip)}
					</button>
				{:else}
					<span
						class="chip inert"
						class:suggestion={chip.role === 'suggestion'}
						class:stale={chip.stale}
						data-designation-role={chip.role}
						data-designation-stale={chip.stale ? 'true' : undefined}
						data-designation-key={chip.symbol.key}
						title={chipTitle(chip)}
					>
						{@render chipContent(chip)}
					</span>
				{/if}
			</li>
		{/each}
		{#if chips.length === 0}
			<li class="empty-column">None</li>
		{/if}
	</ul>
{/snippet}

<section
	class="designations"
	aria-label="Quantity inputs and outputs"
	data-designation-chips={mode}
>
	<div class="columns">
		<div class="column">
			<h4>Inputs</h4>
			{@render chipList(inputColumn, 'Input quantities')}
		</div>
		<div class="column">
			<h4>Outputs</h4>
			{@render chipList(outputColumn, 'Output quantities')}
		</div>
	</div>

	{#if isEmpty}
		<p class="hint">No quantities yet. Write an equation to get suggestions.</p>
	{:else if mode === 'edit'}
		<p class="hint">Tap a quantity to cycle it: unassigned, input, output.</p>
	{:else if hasSuggestions}
		<p class="hint" data-designation-edit-hint>Suggested quantities are confirmed while editing.</p>
	{/if}
</section>

<style>
	.designations {
		display: grid;
		gap: 0.5rem;
	}

	.columns {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	.column {
		display: grid;
		align-content: start;
		gap: 0.4rem;
		border: 1px solid #e2e8f0;
		border-radius: 0.875rem;
		padding: 0.625rem;
		background: #f8fafc;
	}

	h4 {
		margin: 0;
		color: #475569;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	ul {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
	}

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

	.empty-column,
	.hint {
		margin: 0;
		color: #94a3b8;
		font-size: 0.8rem;
	}
</style>
