<script lang="ts">
	import type { NodeData } from '../types/node';
	import type { Point } from '../types/multigraph';
	import { mathPlainText } from '../MathText/lib/mathPlainText';
	import ActionMenuPill, { type ActionMenuItem } from './ActionMenuPill.svelte';

	let {
		node,
		position,
		onAddNodeEdge,
		onMergeNode,
		onTogglePinned,
		onFocus,
		onEdit,
		onDelete,
		onClose,
		onRetarget
	}: {
		node: NodeData;
		position: Point;
		onAddNodeEdge: () => void;
		/** Arm the merge gesture: drag this node onto the one that should survive. */
		onMergeNode: () => void;
		onTogglePinned: () => void;
		onFocus: () => void;
		onEdit: () => void;
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
		{
			label: node.pinned ? 'Unpin' : 'Pin',
			hint: node.pinned
				? 'Release this anchor'
				: 'Anchor the node here; nearby nodes stay large and visible',
			activate: onTogglePinned
		},
		{ label: 'Focus', hint: 'Zoom in to this node and read its details', activate: onFocus },
		{ label: 'Edit', hint: 'Change the title, description, tags, etc.', activate: onEdit },
		{
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
