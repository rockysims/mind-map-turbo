<script lang="ts">
	/**
	 * The two columns a node's quantities live in: what it takes in on the left,
	 * what it produces on the right.
	 *
	 * Tap decides, hold does the other thing. A tap cycles the quantity's
	 * assignment on both surfaces — the edit sheet and the details view — because a
	 * chip that means one thing in one place and something else in another is two
	 * controls wearing the same clothes. A hold on any pointer, a right-click, or
	 * Shift+Enter reaches each surface's secondary action instead: in `view` the
	 * peek card, because an output's definition is as fair a question as an
	 * input's; in `edit` writing the symbol into the text at the caret, because the
	 * chip is the only place its exact spelling is already known.
	 *
	 * The recognizer lives in the chip rather than here. Which action a hold
	 * reaches is the surface's business, but *what counts as a hold* — and the
	 * flag that stops the trailing click from also cycling — must not differ
	 * between two chips that look identical, and a peek card's drill chips look
	 * exactly like these.
	 *
	 * That a tap here rewrites the graph is deliberate and was not always true.
	 * The cycle is reversible in at most two taps by construction, which is what
	 * makes committing on the tap safe without an undo to fall back on.
	 *
	 * Suggestions render as ghosts in the column they would land in, so accepting
	 * one looks like confirming what is already drawn rather than filing it
	 * somewhere new.
	 */
	import { APP_CONFIG } from '$lib/appConfig';
	import type { QuantitySymbol } from '../MathText/lib/mathSymbols';
	import QuantityChip from './QuantityChip.svelte';
	import type { DesignationChip, DesignationView } from './lib/quantityDesignations';
	import type { PeekDirection } from './lib/peekCascade';

	/** Shared so a surface with no peek at all allocates nothing per render. */
	const EMPTY_PEEK_KEYS: ReadonlySet<string> = new Set();

	let {
		mode,
		view,
		onCycle,
		onPeek,
		onInsert,
		peekKeys = EMPTY_PEEK_KEYS,
		peekHoldMs = APP_CONFIG.multigraph.dataflow.chipPeekLongPressMs,
		insertHoldMs = APP_CONFIG.multigraph.dataflow.chipInsertLongPressMs
	}: {
		mode: 'edit' | 'view';
		view: DesignationView;
		/** Advance this quantity around the assignment cycle — what a tap does. */
		onCycle?: (symbol: QuantitySymbol, suggestedRole?: 'input' | 'output') => void;
		/**
		 * View mode only: answer this quantity, anchored to its chip. The direction
		 * comes from the column the chip sits in rather than from its confirmed
		 * role — a ghost in the outputs asks the downstream question, and reading
		 * the role instead would change what the card means at the moment it is
		 * confirmed, which is the one moment the reader is looking at it.
		 */
		onPeek?: (key: string, anchor: HTMLElement, direction: PeekDirection) => void;
		/** Edit mode only: write this quantity into the text the author is editing. */
		onInsert?: (symbol: QuantitySymbol) => void;
		/**
		 * Every quantity with a card open, so a chip reads as pressed while any of
		 * its cards is. A set rather than one key: several are open at once, and a
		 * quantity confirmed both ways has a card per column.
		 */
		peekKeys?: ReadonlySet<string>;
		/**
		 * How long a hold has to last, in each mode. Props rather than reads of
		 * `APP_CONFIG`, because a per-graph setting only reaches the chips if the
		 * parent hands it over — a value captured here would be the shipped default
		 * forever. The defaults are the shipped constants, so a story or a spec that
		 * passes nothing still gets the gesture it was written against.
		 */
		peekHoldMs?: number;
		insertHoldMs?: number;
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

	const canPeek = $derived(mode === 'view' && onPeek !== undefined);
	const canInsert = $derived(mode === 'edit' && onInsert !== undefined);
	/** Whether this surface has anything for a hold, a right-click, or Shift+Enter to reach. */
	const hasSecondaryAction = $derived(canPeek || canInsert);
	/**
	 * Its own tunable rather than the peek's. The two answer different questions —
	 * one opens a card to read, the other writes a character into a field — and a
	 * reader who finds one hold too slow has no reason to want the other changed.
	 */
	const holdMs = $derived(canInsert ? insertHoldMs : peekHoldMs);

	/** The subtree the columns live in, for the focus scan and its activeElement guard. */
	let section = $state<HTMLElement | null>(null);
	/** The quantity a cycle just moved, to be refocused once its column re-renders. */
	let refocusKey = $state<string | null>(null);

	/**
	 * Which chip it is no longer decides: every chip answers in view mode, because
	 * an output's definers are exactly where a disagreement about that quantity
	 * shows up, and a ghost is as fair a thing to ask about as a confirmed input.
	 */
	const chipsAreInteractive = $derived(onCycle !== undefined || hasSecondaryAction);

	/** What the next tap on this chip would do, in the cycle's own terms. */
	function cycleTitle(chip: DesignationChip): string {
		// The cycle enters at the suggested role, so the next stop depends on
		// where the parser put this quantity, not on a fixed order.
		const first = chip.suggestedRole ?? 'input';
		const second = first === 'input' ? 'output' : 'input';
		if (chip.role === 'suggestion') return `Label ${chip.symbol.label} as an ${first}`;
		if (chip.role === first) return `Make ${chip.symbol.label} an ${second}`;
		return `Unassign ${chip.symbol.label}`;
	}

	/**
	 * Both gestures, named. A chip that now does two things has to say so, or the
	 * hold is a secret and the tap is a surprise.
	 */
	function chipTitle(chip: DesignationChip): string {
		const parts: string[] = [];
		if (onCycle) parts.push(cycleTitle(chip));
		const secondary = canPeek
			? ['see where', 'is defined']
			: canInsert
				? ['write', 'into the text']
				: null;
		if (secondary !== null) {
			const [verb, tail] = secondary;
			parts.push(
				parts.length === 0
					? `Hold or right-click to ${verb} ${chip.symbol.label} ${tail}`
					: `hold or right-click to ${verb} it ${tail}`
			);
		}
		return parts.length === 0 ? chip.symbol.label : parts.join(' — ');
	}

	/**
	 * A tap on a chip. The chip itself swallows the click that trails a hold, so
	 * anything arriving here is a real tap.
	 */
	function activate(chip: DesignationChip) {
		const key = chip.symbol.key;
		if (onCycle === undefined) return;
		// Cycling can move the chip between the two `{#each}` blocks, which destroys
		// and recreates it — so focus has to be put back by key. Whether it was in
		// these columns at all is only knowable here: once the old chip is gone,
		// what it held has already fallen back to the body.
		if (focusIsInColumns()) refocusKey = key;
		onCycle(chip.symbol, chip.suggestedRole);
	}

	function focusIsInColumns(): boolean {
		const host = section;
		const active = document.activeElement;
		return host !== null && active instanceof Node && host.contains(active);
	}

	/**
	 * The secondary action for this surface: read where a quantity is defined, or
	 * write it into the text. Which gesture reached it is the chip's business; all
	 * this decides is what the answer is.
	 */
	function performSecondary(chip: DesignationChip, anchor: HTMLElement, direction: PeekDirection) {
		if (canPeek) {
			onPeek?.(chip.symbol.key, anchor, direction);
			return;
		}
		if (canInsert) onInsert?.(chip.symbol);
	}

	/**
	 * Put the keyboard back on the chip it was on, wherever the cycle has moved it.
	 *
	 * Runs after the columns have re-derived, and only for a cycle that started
	 * with focus in here — a reader elsewhere on the page must not be dragged into
	 * the columns by a mutation they did not make with the keyboard.
	 *
	 * The chip is found by reading the attribute rather than by selector: a
	 * subscripted key embeds a NUL, and `CSS.escape` replaces it with U+FFFD
	 * rather than escaping it, so the raw key is not usable in a selector.
	 */
	$effect(() => {
		const key = refocusKey;
		if (key === null) return;
		refocusKey = null;
		const host = section;
		if (host === null) return;
		for (const candidate of host.querySelectorAll('[data-designation-key]')) {
			if (candidate.getAttribute('data-designation-key') !== key) continue;
			if (candidate instanceof HTMLElement) candidate.focus();
			return;
		}
	});

	/** How this column labels a chip: what it is, and what its gestures would do. */
	function chipAttributes(chip: DesignationChip): Record<string, string | undefined> {
		return {
			'data-designation-role': chip.role,
			'data-designation-stale': chip.stale ? 'true' : undefined,
			'data-designation-key': chip.symbol.key,
			// No `aria-pressed` anywhere now: a three-state cycle button is not a
			// toggle, and `aria-expanded` would be a second lie. The peeked chip is
			// marked below for styling and tests; the card's own role and label are
			// what carry the semantics to assistive tech.
			'data-designation-peeking':
				mode === 'view' && peekKeys.has(chip.symbol.key) ? 'true' : undefined,
			title: chipTitle(chip)
		};
	}
</script>

{#snippet chipList(chips: DesignationChip[], columnLabel: string, direction: PeekDirection)}
	<ul aria-label={columnLabel}>
		{#each chips as chip (chip.symbol.key)}
			<li>
				<QuantityChip
					label={chip.symbol.label}
					stale={chip.stale}
					suggestion={chip.role === 'suggestion'}
					peeking={mode === 'view' && peekKeys.has(chip.symbol.key)}
					interactive={chipsAreInteractive}
					attributes={chipAttributes(chip)}
					{holdMs}
					onclick={() => activate(chip)}
					onsecondary={hasSecondaryAction
						? (anchor) => performSecondary(chip, anchor, direction)
						: undefined}
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
	bind:this={section}
>
	<div class="columns">
		<div class="column">
			<h4>Inputs</h4>
			{@render chipList(inputColumn, 'Input quantities', 'upstream')}
		</div>
		<div class="column">
			<h4>Outputs</h4>
			{@render chipList(outputColumn, 'Output quantities', 'downstream')}
		</div>
	</div>

	{#if isEmpty}
		<p class="hint">No quantities yet. Write an equation to get suggestions.</p>
	{:else if canInsert}
		<p class="hint">
			Tap a quantity to cycle it: unassigned, input, output. Hold, right-click, or press Shift+Enter
			to write it into the text at the cursor.
		</p>
	{:else if mode === 'edit'}
		<p class="hint">Tap a quantity to cycle it: unassigned, input, output.</p>
	{:else if canPeek}
		<!--
			Whenever there is a chip to hold, not only when one of them is a ghost.
			Gated on `hasSuggestions` this said nothing on the ordinary node whose
			quantities are all confirmed — which is most of them once a graph is a
			few edits old — leaving the hold gesture with no announcement anywhere on
			the surface that offers it.
		-->
		<p class="hint">Tap to cycle a quantity; hold or right-click to see where it is defined.</p>
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
		color: #64748b;
		font-size: 0.8rem;
	}
</style>
