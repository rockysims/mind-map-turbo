<script lang="ts">
	import type { NodeData } from '../types/node';
	import type { Point } from '../types/multigraph';

	let {
		node,
		position,
		onTogglePinned,
		onEdit,
		onDelete,
		onClose
	}: {
		node: NodeData;
		position: Point;
		onTogglePinned: () => void;
		onEdit: () => void;
		onDelete: () => void;
		onClose: () => void;
	} = $props();

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') onClose();
	}
</script>

<div class="menu-layer" role="presentation" onpointercancel={onClose}>
	<button class="menu-dismiss" type="button" aria-label="Close node actions" onclick={onClose}
	></button>
	<div
		class="node-action-menu"
		role="menu"
		aria-label={`Actions for ${node.title}`}
		style={`left: ${position.x}px; top: ${position.y}px;`}
		tabindex="-1"
		onkeydown={handleKeydown}
	>
		<button type="button" role="menuitem" onclick={onTogglePinned}>
			{node.pinned ? 'Unpin' : 'Pin'}
		</button>
		<button type="button" role="menuitem" onclick={onEdit}>Edit</button>
		<button type="button" role="menuitem" onclick={onDelete}>Delete</button>
	</div>
</div>

<style>
	.menu-layer {
		position: absolute;
		inset: 0;
		z-index: 20;
	}

	.menu-dismiss {
		position: absolute;
		inset: 0;
		border: 0;
		background: transparent;
		touch-action: none;
	}

	.node-action-menu {
		position: fixed;
		display: flex;
		gap: 0.375rem;
		padding: 0.5rem;
		border: 1px solid #d4d4d4;
		border-radius: 999px;
		background: #ffffff;
		box-shadow: 0 8px 24px rgb(0 0 0 / 18%);
		transform: translate(-50%, calc(-100% - 12px));
		touch-action: none;
	}

	.node-action-menu button {
		border: 0;
		border-radius: 999px;
		padding: 0.5rem 0.75rem;
		background: #f1f5f9;
		color: #0f172a;
		font: inherit;
	}
</style>
