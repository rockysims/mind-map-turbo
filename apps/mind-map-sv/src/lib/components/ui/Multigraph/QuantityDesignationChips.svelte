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
	 * One recognizer serves both. Which action a hold reaches is the surface's
	 * business, but *what counts as a hold* — and the flag that stops the trailing
	 * click from also cycling — must not differ between two chips that look
	 * identical.
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
	import { beginChipPress, isChipLongPress, trackChipPress, type ChipPress } from './lib/chipPress';
	import type { DesignationChip, DesignationView } from './lib/quantityDesignations';

	const PEEK_HOLD_MS = APP_CONFIG.multigraph.dataflow.chipPeekLongPressMs;
	const INSERT_HOLD_MS = APP_CONFIG.multigraph.dataflow.chipInsertLongPressMs;

	let {
		mode,
		view,
		onCycle,
		onPeek,
		onInsert,
		peekKey = null
	}: {
		mode: 'edit' | 'view';
		view: DesignationView;
		/** Advance this quantity around the assignment cycle — what a tap does. */
		onCycle?: (symbol: QuantitySymbol, suggestedRole?: 'input' | 'output') => void;
		/** View mode only: show where this quantity is defined, anchored to its chip. */
		onPeek?: (key: string, anchor: HTMLElement) => void;
		/** Edit mode only: write this quantity into the text the author is editing. */
		onInsert?: (symbol: QuantitySymbol) => void;
		/** The quantity whose peek card is open, so its chip can be marked. */
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

	const canPeek = $derived(mode === 'view' && onPeek !== undefined);
	const canInsert = $derived(mode === 'edit' && onInsert !== undefined);
	/** Whether this surface has anything for a hold, a right-click, or Shift+Enter to reach. */
	const hasSecondaryAction = $derived(canPeek || canInsert);
	/**
	 * Its own tunable rather than the peek's. The two answer different questions —
	 * one opens a card to read, the other writes a character into a field — and a
	 * reader who finds one hold too slow has no reason to want the other changed.
	 */
	const holdMs = $derived(canInsert ? INSERT_HOLD_MS : PEEK_HOLD_MS);

	/** The subtree the columns live in, for the focus scan and its activeElement guard. */
	let section = $state<HTMLElement | null>(null);
	/** The press in flight, or null between gestures. */
	let press: ChipPress | null = null;
	let peekTimer: ReturnType<typeof setTimeout> | null = null;
	/**
	 * The chip whose trailing click must be swallowed because its hold already
	 * answered. Only the click clears it — clearing it in `pointerup` is the
	 * classic bug, since the click has not happened yet when the pointer lifts.
	 */
	let suppressClickForKey: string | null = null;
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
	 * A click on a chip. Deliberately not `pointerup`: the whole point of the
	 * suppression below is that a real DOM click still arrives after a hold, and
	 * the only place to swallow it is where it lands.
	 */
	function activate(chip: DesignationChip) {
		const key = chip.symbol.key;
		if (suppressClickForKey === key) {
			suppressClickForKey = null;
			return;
		}
		suppressClickForKey = null;
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
	 * write it into the text. Every path — hold, right-click, Shift+Enter — comes
	 * through here so the three cannot drift apart.
	 */
	function performSecondary(chip: DesignationChip, anchor: HTMLElement) {
		if (canPeek) {
			onPeek?.(chip.symbol.key, anchor);
			return;
		}
		if (canInsert) onInsert?.(chip.symbol);
	}

	function beginSecondaryPress(chip: DesignationChip, event: PointerEvent) {
		if (!hasSecondaryAction) return;
		// A fresh press ends whatever came before it, whichever button it is on:
		// the click a previous hold was suppressing has either arrived or was lost
		// with a pointer that wandered off the chip before lifting, and carrying
		// the flag into the next gesture is how a later press silently does
		// nothing. Cleared before the button check for exactly that reason — a
		// right-click's own pointerdown has to clear it too.
		endSecondaryPress();
		suppressClickForKey = null;
		// Secondary buttons have their own meaning, and `contextmenu` covers the
		// right one; a hold is the primary button held down.
		if (event.button !== 0) return;
		// `currentTarget` during dispatch is the chip this handler is bound to; TS
		// only knows it as an EventTarget.
		const anchor = event.currentTarget as HTMLElement;
		const key = chip.symbol.key;
		press = beginChipPress(key, { x: event.clientX, y: event.clientY }, performance.now());
		peekTimer = setTimeout(() => {
			peekTimer = null;
			if (!isChipLongPress(press, performance.now(), { key })) return;
			press = null;
			// Set before the callback: answering can move focus — opening a card, or
			// putting the caret in the field just written to — and the trailing click
			// is still on its way regardless.
			suppressClickForKey = key;
			performSecondary(chip, anchor);
		}, holdMs);
	}

	function trackSecondaryPress(event: PointerEvent) {
		if (press === null) return;
		press = trackChipPress(press, { x: event.clientX, y: event.clientY });
	}

	/**
	 * The gesture is over — by a lift, a cancel, a fresh press, or the component
	 * going away — so the timer is. The suppression flag deliberately survives:
	 * the click it exists to swallow has not happened yet.
	 */
	function endSecondaryPress() {
		if (peekTimer !== null) clearTimeout(peekTimer);
		peekTimer = null;
		press = null;
	}

	function secondaryFromContextMenu(chip: DesignationChip, event: MouseEvent) {
		if (!hasSecondaryAction) return;
		// The focus overlay is a sibling of the stage with no pointer handlers, so
		// nothing else is going to stop the browser's own menu covering the answer.
		event.preventDefault();
		// Android synthesizes a contextmenu from a touch long-press. The hold has
		// already answered — opening a card, or writing the symbol — and answering
		// twice would toggle the card shut or insert the symbol a second time.
		// Scoped to this chip's own key: a suppression belonging to some other chip
		// says nothing about this one, and reading it as "a hold just answered" made
		// one stale flag silently swallow the right-click on every chip.
		if (suppressClickForKey === chip.symbol.key) return;
		endSecondaryPress();
		performSecondary(chip, event.currentTarget as HTMLElement);
	}

	/**
	 * Shift+Enter does what a hold does. Plain Enter cycles, as a click does.
	 * Nothing is bound to the ContextMenu key on purpose: browsers that have one
	 * fire a real `contextmenu` on the focused element, which is already handled,
	 * and handling both would answer twice.
	 */
	function secondaryFromKeyboard(chip: DesignationChip, event: KeyboardEvent) {
		if (!hasSecondaryAction) return;
		if (event.key !== 'Enter' || !event.shiftKey) return;
		// Or the browser activates the button as well, and the chip answers and cycles.
		event.preventDefault();
		performSecondary(chip, event.currentTarget as HTMLElement);
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

	$effect(() => () => endSecondaryPress());

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
				mode === 'view' && peekKey === chip.symbol.key ? 'true' : undefined,
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
					interactive={chipsAreInteractive}
					attributes={chipAttributes(chip)}
					onclick={() => activate(chip)}
					oncontextmenu={hasSecondaryAction
						? (event) => secondaryFromContextMenu(chip, event)
						: undefined}
					onpointerdown={hasSecondaryAction
						? (event) => beginSecondaryPress(chip, event)
						: undefined}
					onpointermove={hasSecondaryAction ? trackSecondaryPress : undefined}
					onpointerup={hasSecondaryAction ? endSecondaryPress : undefined}
					onpointercancel={hasSecondaryAction ? endSecondaryPress : undefined}
					onpointerleave={hasSecondaryAction ? endSecondaryPress : undefined}
					onkeydown={hasSecondaryAction ? (event) => secondaryFromKeyboard(chip, event) : undefined}
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
			{@render chipList(inputColumn, 'Input quantities')}
		</div>
		<div class="column">
			<h4>Outputs</h4>
			{@render chipList(outputColumn, 'Output quantities')}
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
	{:else if hasSuggestions}
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
		color: #94a3b8;
		font-size: 0.8rem;
	}
</style>
