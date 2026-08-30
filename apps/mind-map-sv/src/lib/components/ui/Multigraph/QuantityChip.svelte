<script lang="ts">
	/**
	 * One quantity, drawn as a chip — and the gestures that reach what it offers.
	 *
	 * Two surfaces render these and they must be the same object to the eye: the
	 * designation columns, where a chip is what the node takes in or gives out,
	 * and a peek card's drill line, where a chip is a definer's own quantity. The
	 * drill line borrows the columns' visual language deliberately — the reader
	 * has already learned that a pill with an italic letter is a quantity — so the
	 * markup and its scoped CSS live here rather than being copied.
	 *
	 * The gestures live here for the same reason, and it is the stronger one. A
	 * chip answers a secondary question — where is this defined, what uses it,
	 * write it into my text — and the way to ask is a hold, a right-click, or
	 * Shift+Enter. Those three used to be recognized by the columns alone, which
	 * left the drill chips opening on a plain click: the reader who had just
	 * learned to right-click a quantity had to left-click the next one, on a
	 * surface the right-click had opened. Two chips that look identical cannot
	 * take different gestures, so the recognizer belongs to the chip.
	 *
	 * The suppression flag is per chip rather than per surface, which the shared
	 * recognizer gets for free: a hold's trailing click can only be swallowed by
	 * the chip that was held, so a flag left armed by a press that wandered off
	 * can never silently eat some other chip's click.
	 *
	 * The identifying attributes come in through `attributes` rather than as named
	 * props: the two call sites label their chips for entirely different
	 * selectors (`data-designation-*` versus `data-peek-drill`), and inventing a
	 * union of both here would put each surface's vocabulary in the other's way.
	 */

	import {
		beginChipPress,
		isChipLongPress,
		trackChipPress,
		CHIP_PEEK_LONG_PRESS_MS,
		type ChipPress
	} from './lib/chipPress';

	let {
		label,
		stale = false,
		suggestion = false,
		peeking = false,
		interactive = false,
		marker,
		attributes,
		onclick,
		onsecondary,
		holdMs = CHIP_PEEK_LONG_PRESS_MS
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
		/** The primary action — a tap. A chip may have none, and many do not. */
		onclick?: (event: MouseEvent) => void;
		/**
		 * The secondary action, reached by a hold, a right-click, or Shift+Enter,
		 * and handed this chip's own element to anchor anything it opens. Absent
		 * means the chip has no second question, and a right-click on it gets the
		 * browser's own menu as usual.
		 */
		onsecondary?: (anchor: HTMLElement) => void;
		/** How long the hold is. Surfaces that ask different things may want different waits. */
		holdMs?: number;
	} = $props();

	/** The rendered button, so a hold answers with an anchor after `currentTarget` is gone. */
	let button = $state<HTMLButtonElement | null>(null);
	/** The press in flight, or null between gestures. */
	let press: ChipPress | null = null;
	let holdTimer: ReturnType<typeof setTimeout> | null = null;
	/**
	 * Whether this chip's next click must be swallowed because its hold already
	 * answered. Only the click clears it — clearing it on `pointerup` is the
	 * classic bug, since the click has not happened yet when the pointer lifts.
	 */
	let suppressClick = false;

	function answer() {
		if (button !== null) onsecondary?.(button);
	}

	/**
	 * The gesture is over — by a lift, a cancel, a fresh press, or the component
	 * going away — so the timer is. The suppression flag deliberately survives:
	 * the click it exists to swallow has not happened yet.
	 */
	function endPress() {
		if (holdTimer !== null) clearTimeout(holdTimer);
		holdTimer = null;
		press = null;
	}

	function handlePointerDown(event: PointerEvent) {
		if (onsecondary === undefined) return;
		// A fresh press ends whatever came before it, whichever button it is on:
		// the click a previous hold was suppressing has either arrived or was lost
		// with a pointer that wandered off before lifting, and carrying the flag
		// into the next gesture is how a later tap silently does nothing. Cleared
		// before the button check for exactly that reason — a right-click's own
		// pointerdown has to clear it too.
		endPress();
		suppressClick = false;
		// Secondary buttons have their own meaning, and `contextmenu` covers the
		// right one; a hold is the primary button held down.
		if (event.button !== 0) return;
		// The key a press is tagged with only has to tell this chip's presses apart
		// from nothing at all — a press can no longer begin on a different chip.
		press = beginChipPress(label, { x: event.clientX, y: event.clientY }, performance.now());
		holdTimer = setTimeout(() => {
			holdTimer = null;
			if (!isChipLongPress(press, performance.now(), { key: label, minDuration: holdMs })) return;
			press = null;
			// Set before the callback: answering can move focus — opening a card, or
			// putting the caret in the field just written to — and the trailing click
			// is still on its way regardless.
			suppressClick = true;
			answer();
		}, holdMs);
	}

	function handlePointerMove(event: PointerEvent) {
		if (press === null) return;
		press = trackChipPress(press, { x: event.clientX, y: event.clientY });
	}

	function handleClick(event: MouseEvent) {
		if (suppressClick) {
			suppressClick = false;
			return;
		}
		onclick?.(event);
	}

	function handleContextMenu(event: MouseEvent) {
		if (onsecondary === undefined) return;
		// The focus overlay is a sibling of the stage with no pointer handlers, so
		// nothing else is going to stop the browser's own menu covering the answer.
		event.preventDefault();
		// Android synthesizes a contextmenu from a touch long-press. The hold has
		// already answered — opening a card, or writing the symbol — and answering
		// twice would toggle the card shut or insert the symbol a second time.
		if (suppressClick) return;
		endPress();
		answer();
	}

	/**
	 * Shift+Enter always reaches the secondary action, matching the hold. Plain
	 * Enter and Space belong to the primary one where there is a primary one — and
	 * where there is not, they answer too, because a focusable button that ignores
	 * its own activation keys is broken however consistent its pointer gestures
	 * are.
	 *
	 * Nothing is bound to the ContextMenu key on purpose: browsers that have one
	 * fire a real `contextmenu` on the focused element, which is already handled,
	 * and handling both would answer twice.
	 */
	function handleKeyDown(event: KeyboardEvent) {
		if (onsecondary === undefined) return;
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		const shiftEnter = event.key === 'Enter' && event.shiftKey;
		const activation = (event.key === 'Enter' || event.key === ' ') && !event.shiftKey;
		if (!shiftEnter && !(activation && onclick === undefined)) return;
		// Or the browser activates the button as well, and the chip answers twice.
		event.preventDefault();
		answer();
	}

	$effect(() => () => endPress());
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
		bind:this={button}
		type="button"
		class="chip"
		class:suggestion
		class:stale
		class:peeking
		{...attributes}
		onclick={handleClick}
		oncontextmenu={handleContextMenu}
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={endPress}
		onpointercancel={endPress}
		onpointerleave={endPress}
		onkeydown={handleKeyDown}
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
		/*
		 * A hold on a chip is a question, not a text selection: without this, holding
		 * one on touch starts a selection drag and on desktop paints the label blue.
		 * `touch-action` is deliberately left alone — wheel and pinch have to keep
		 * reaching the ZoomWorld underneath, and a scroll canceling the hold is the
		 * right outcome.
		 */
		user-select: none;
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
