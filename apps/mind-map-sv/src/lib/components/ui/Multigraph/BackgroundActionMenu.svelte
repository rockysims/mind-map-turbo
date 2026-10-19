<script lang="ts">
	import type { Point } from '../types/multigraph';
	import ActionMenuPill, { type ActionMenuItem } from './ActionMenuPill.svelte';

	let {
		position,
		selectionCount,
		canPaste,
		onPaste,
		onCopy,
		onClose,
		onRetarget,
		onExplainDisabled
	}: {
		/** Client coordinates of the hold or right-click on empty canvas. */
		position: Point;
		/** How many nodes are selected; above one, the menu offers to copy them. */
		selectionCount: number;
		/**
		 * Whether a paste is known to be available. When it is not, "Paste" still
		 * shows, so the reader learns the action exists, but says why it cannot
		 * act instead of acting.
		 */
		canPaste: boolean;
		/** Paste at `position`; called inside the tap, so the clipboard read has its activation. */
		onPaste: () => void;
		/** Copy the selection; called inside the tap, so the clipboard write has its activation. */
		onCopy: () => void;
		onClose: () => void;
		/**
		 * Hit-test a right-click that landed on the open menu's layer — onto a
		 * node's menu, or this menu at the new point. Without it, that right-click
		 * just closes the menu.
		 */
		onRetarget?: (point: Point) => void;
		/** A tap on unavailable "Paste" hands its reason here for the notice line. */
		onExplainDisabled?: (reason: string) => void;
	} = $props();

	/** Short enough to sit in the notice line as well as the hover title. */
	const NOTHING_TO_PASTE = 'Nothing copied yet';

	/**
	 * Unlike the node menu, every item here is a plain action with nothing left
	 * to do afterwards, so the menu closes itself once the action has run.
	 */
	function thenClose(action: () => void): () => void {
		return () => {
			action();
			onClose();
		};
	}

	/**
	 * Two items at most, per the owner's ruling
	 * (`docs/ui-decisions/2026-10-19--copy--the-background-menu-offers-paste-and-copy-n-only.md`):
	 * selecting all and clearing are left to Cmd/Ctrl+A, a click on empty
	 * canvas and Escape, and "Paste" needs no "here", since it lands where the
	 * menu opened.
	 *
	 * Hints follow the node menu's rule: the label names the action, the native
	 * `title` says what happens, and hover-only is the same debt
	 * (`docs/debt/2026-08-30-tooltips-are-hover-only.md`).
	 */
	const items = $derived<ActionMenuItem[]>([
		{
			label: 'Paste',
			hint: 'Put the copied nodes here',
			activate: thenClose(onPaste),
			disabledReason: canPaste ? undefined : NOTHING_TO_PASTE
		},
		// Only above one, as the ruling has it; a single selected node's own menu
		// has Copy.
		...(selectionCount > 1
			? [
					{
						label: `Copy ${selectionCount}`,
						hint: 'Copy the selected nodes and the edges between them',
						activate: thenClose(onCopy)
					}
				]
			: [])
	]);
</script>

<ActionMenuPill
	{items}
	label="Canvas actions"
	{position}
	{onClose}
	{onRetarget}
	{onExplainDisabled}
/>
