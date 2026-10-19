<script lang="ts">
	import type { NodeData } from '../types/node';
	import type { Point } from '../types/multigraph';
	import { mathPlainText } from '../MathText/lib/mathPlainText';
	import ActionMenuPill, { type ActionMenuItem } from './ActionMenuPill.svelte';

	let {
		node,
		selected,
		groupSize = 1,
		position,
		onAddNodeEdge,
		onMergeNode,
		onToggleSelected,
		onCopy,
		onTogglePinned,
		onFocus,
		onEdit,
		onDelete,
		onClose,
		onRetarget
	}: {
		node: NodeData;
		/** Whether `node` is in the canvas selection, which decides Select or Deselect. */
		selected: boolean;
		/**
		 * How many nodes Copy and Delete act on: the selection's size when `node`
		 * is in it, else 1 for `node` alone.
		 */
		groupSize?: number;
		position: Point;
		onAddNodeEdge: () => void;
		/** Arm the merge gesture: drag this node onto the one that should survive. */
		onMergeNode: () => void;
		/** Add this node to the selection, or take it out. */
		onToggleSelected: () => void;
		/** Copy the `groupSize` nodes this menu acts on. */
		onCopy: () => void;
		onTogglePinned: () => void;
		onFocus: () => void;
		onEdit: () => void;
		/** Delete the `groupSize` nodes this menu acts on. */
		onDelete: () => void;
		onClose: () => void;
		/** Re-open the menu on the node under `point`, or close if there is none. */
		onRetarget: (point: Point) => void;
	} = $props();

	/**
	 * Labels stay one or two words; the `hint` carries what they cannot say.
	 * Native `title`, so the browser exposes it as each button's accessible
	 * description and the label still names it — hover only, which is logged as
	 * debt in `docs/debt/2026-08-30-tooltips-are-hover-only.md`.
	 *
	 * The two gesture items describe what to do next, because activating them
	 * arms a drag rather than changing anything; the rest describe what happens.
	 *
	 * Activation only calls the callback; each of the page's handlers closes the
	 * menu itself, as it did before the pill was shared.
	 */
	const items = $derived<ActionMenuItem[]>([
		{
			label: 'Add node/edge',
			hint: 'Drag to empty space to add a node, or onto another node to connect',
			activate: onAddNodeEdge
		},
		// Sits next to Add node/edge because it is the same drag, aimed the other
		// way: one grows the graph from this node, the other folds it away.
		{
			label: 'Merge',
			hint: 'Drag onto the node this one should merge into; the other node survives',
			activate: onMergeNode
		},
		// The only way to add one node at a time, and the only way at all on touch
		// short of a box: a plain tap on a node is the first half of a double-click,
		// so it cannot also select. The hint names the box, which is the faster
		// route for several and is otherwise drawn nowhere.
		{
			label: selected ? 'Deselect' : 'Select',
			hint: selected
				? 'Remove this node from the selection'
				: 'Add this node to the selection; double-click-drag on empty canvas to box several',
			activate: onToggleSelected
		},
		// Beside Select because it acts on what Select builds. The label stays
		// one word, since a copy changes nothing on the canvas; the hint says
		// whether it takes the selection or this node alone.
		{
			label: 'Copy',
			hint:
				groupSize > 1
					? 'Copy the selected nodes and the edges between them'
					: 'Copy this node to paste elsewhere',
			activate: onCopy
		},
		{
			label: node.pinned ? 'Unpin' : 'Pin',
			hint: node.pinned
				? 'Release this anchor'
				: 'Anchor the node here; nearby nodes stay large and visible',
			activate: onTogglePinned
		},
		{ label: 'Focus', hint: 'Zoom in to this node and read its details', activate: onFocus },
		{ label: 'Edit', hint: 'Change the title, description, tags, etc.', activate: onEdit },
		// The count is in the label, not only the hint, because a delete that
		// takes more than the node under the finger has to say so where a touch
		// reader can see it (the hint is hover-only).
		groupSize > 1
			? {
					label: `Delete ${groupSize} nodes`,
					hint: 'Remove every selected node and every edge attached to them',
					activate: onDelete
				}
			: {
					label: 'Delete',
					hint: 'Remove this node and every edge attached to it',
					activate: onDelete
				}
	]);
</script>

<!-- The node id rides along as the target key, so a re-target onto another node
     re-focuses the first item even if it lands on the same point. -->
<ActionMenuPill
	{items}
	label={`Actions for ${mathPlainText(node.title)}`}
	{position}
	targetKey={node.id}
	{onClose}
	{onRetarget}
/>
