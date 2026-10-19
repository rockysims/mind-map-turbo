<script lang="ts">
	import type { Point } from '../types/multigraph';
	import ActionMenuPill, { type ActionMenuItem } from './ActionMenuPill.svelte';

	let {
		position,
		selectionCount,
		canPaste,
		onPaste,
		onCopy,
		onCutEdges,
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
		/** Arm the cut: a dashed line from `position` that deletes the edges it is drawn across. */
		onCutEdges: () => void;
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
	 * "Paste" and "Copy N", per the owner's ruling
	 * (`docs/ui-decisions/2026-10-19--copy--the-background-menu-offers-paste-and-copy-n-only.md`):
	 * selecting all and clearing are left to Cmd/Ctrl+A, a click on empty
	 * canvas and Escape, and "Paste" needs no "here", since it lands where the
	 * menu opened. "Cut edges" follows them, by the later ruling that arms the
	 * cut from this menu and nowhere else
	 * (`docs/ui-decisions/2026-10-19--pointer--cut-edges-is-armed-from-the-background-menu.md`).
	 * Like Paste it is always offered: what it would cut depends on where the
	 * line is drawn, which nothing knows until it is.
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
			: []),
		{
			label: 'Cut edges',
			hint: 'Drag a line across the edges to delete, then click or lift to cut',
			activate: thenClose(onCutEdges)
		}
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
