<script lang="ts">
	import type { Point } from '../types/multigraph';
	import ActionMenuPill, { type ActionMenuItem } from './ActionMenuPill.svelte';

	let {
		position,
		selectionCount,
		canPaste,
		onPaste,
		onSelectAll,
		onClearSelection,
		onClose,
		onRetarget,
		onExplainDisabled
	}: {
		/** Client coordinates of the hold or right-click on empty canvas. */
		position: Point;
		selectionCount: number;
		/**
		 * Whether a paste is known to be available. When it is not, "Paste here"
		 * still shows, so the reader learns the action exists, but says why it
		 * cannot act instead of acting.
		 */
		canPaste: boolean;
		/** Paste at `position`; called inside the tap, so the clipboard read has its activation. */
		onPaste: () => void;
		onSelectAll: () => void;
		onClearSelection: () => void;
		onClose: () => void;
		/**
		 * Hit-test a right-click that landed on the open menu's layer — onto a
		 * node's menu, or this menu at the new point. Without it, that right-click
		 * just closes the menu.
		 */
		onRetarget?: (point: Point) => void;
		/** A tap on unavailable "Paste here" hands its reason here for the notice line. */
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
	 * Hints follow the node menu's rule: the label names the action, the native
	 * `title` says what happens, and hover-only is the same debt
	 * (`docs/debt/2026-08-30-tooltips-are-hover-only.md`).
	 */
	const items = $derived<ActionMenuItem[]>([
		{
			label: 'Paste here',
			hint: 'Put the copied nodes here',
			activate: thenClose(onPaste),
			disabledReason: canPaste ? undefined : NOTHING_TO_PASTE
		},
		{
			label: 'Select all',
			hint: 'Select every node on the canvas',
			activate: thenClose(onSelectAll)
		},
		// Only offered when there is something to clear, so the menu never shows
		// an action that would do nothing.
		...(selectionCount > 0
			? [
					{
						label: 'Clear selection',
						hint: 'Deselect every node',
						activate: thenClose(onClearSelection)
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
