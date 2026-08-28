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
	import QuantityChip from './QuantityChip.svelte';
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

	/** How this column labels a chip: what it is, and what its tap would do. */
	function chipAttributes(chip: DesignationChip): Record<string, string | undefined> {
		const pressed =
			mode === 'view' && chip.role === 'input'
				? peekKey === chip.symbol.key
					? 'true'
					: 'false'
				: undefined;
		return {
			'data-designation-role': chip.role,
			'data-designation-stale': chip.stale ? 'true' : undefined,
			'data-designation-key': chip.symbol.key,
			'aria-pressed': pressed,
			title: chipTitle(chip)
		};
	}
</script>

{#snippet chipList(chips: DesignationChip[], columnLabel: string)}
	<ul aria-label={columnLabel}>
		{#each chips as chip (chip.symbol.key)}
			<li>
				<QuantityChip
					label={chip.symbol.label}
					stale={chip.stale}
					suggestion={chip.role === 'suggestion'}
					peeking={mode === 'view' && peekKey === chip.symbol.key}
					interactive={isInteractive(chip)}
					attributes={chipAttributes(chip)}
					onclick={(event) => activate(chip, event)}
				/>
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

	/*
	 * The chip's own rules live in `QuantityChip.svelte`: scoped styles do not
	 * cross a component boundary, and the peek card's drill line renders the same
	 * component.
	 */

	.empty-column,
	.hint {
		margin: 0;
		color: #94a3b8;
		font-size: 0.8rem;
	}
</style>
