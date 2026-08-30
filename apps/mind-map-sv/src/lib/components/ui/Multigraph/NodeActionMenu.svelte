<script lang="ts">
	import type { NodeData } from '../types/node';
	import type { Point } from '../types/multigraph';
	import { mathPlainText } from '../MathText/lib/mathPlainText';

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
	 * Where focus sat before the menu took it. Captured while the component is
	 * created — i.e. before the open effect focuses the first item — and kept
	 * across re-targets so the whole menu session restores to one place.
	 */
	const focusBeforeOpen =
		typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);

	let menuRef = $state<HTMLElement | null>(null);
	/** Roving-tabindex cursor: only this item is in the tab order. */
	let activeIndex = $state(0);
	let lastFocusedOpenKey = $state('');
	// Not reactive on purpose: `bind:this` writes here, but nothing renders from it.
	const itemRefs: Array<HTMLButtonElement | null> = [];

	const items = $derived([
		{ label: 'Add node/edge', activate: onAddNodeEdge },
		// Sits next to Add node/edge because it is the same drag, aimed the other
		// way: one grows the graph from this node, the other folds it away.
		{ label: 'Merge', activate: onMergeNode },
		{ label: node.pinned ? 'Unpin' : 'Pin', activate: onTogglePinned },
		{ label: 'Focus', activate: onFocus },
		{ label: 'Edit', activate: onEdit },
		{ label: 'Delete', activate: onDelete }
	]);
	/** Changes on open and on every re-target onto another node/point. */
	const openKey = $derived(`${node.id}:${position.x}:${position.y}`);

	// Opening (or re-targeting) moves focus into the menu, per the WAI-ARIA menu
	// pattern — without it the keydown handler below never fires.
	$effect(() => {
		if (openKey === lastFocusedOpenKey) return;
		lastFocusedOpenKey = openKey;
		activeIndex = 0;
		itemRefs[0]?.focus();
	});

	/**
	 * Every close path (Escape, item activation, dismiss, re-target onto empty
	 * background) tears the component down, so restoring here covers them all.
	 * Focus that has already moved somewhere outside the menu — an edit sheet
	 * claiming its input, say — is left alone.
	 */
	$effect(() => {
		return () => {
			if (typeof document === 'undefined') return;
			const active = document.activeElement;
			const movedElsewhere =
				active !== null && active !== document.body && menuRef?.contains(active) !== true;
			if (movedElsewhere) return;
			if (!focusBeforeOpen || !focusBeforeOpen.isConnected) return;
			if (focusBeforeOpen === document.body) return;
			focusBeforeOpen.focus();
		};
	});

	function focusItem(index: number) {
		const count = items.length;
		const next = ((index % count) + count) % count;
		activeIndex = next;
		itemRefs[next]?.focus();
	}

	function handleKeydown(event: KeyboardEvent) {
		switch (event.key) {
			case 'Escape':
				event.preventDefault();
				onClose();
				return;
			// Horizontal pill, but the vertical arrows are accepted too so the menu
			// answers to whichever pair the user reaches for.
			case 'ArrowRight':
			case 'ArrowDown':
				event.preventDefault();
				focusItem(activeIndex + 1);
				return;
			case 'ArrowLeft':
			case 'ArrowUp':
				event.preventDefault();
				focusItem(activeIndex - 1);
				return;
			case 'Home':
				event.preventDefault();
				focusItem(0);
				return;
			case 'End':
				event.preventDefault();
				focusItem(items.length - 1);
		}
	}

	/**
	 * The layer covers the viewport, so while the menu is open every right-click
	 * lands here instead of on the stage: never leak the native menu, and hand the
	 * point back for hit-testing rather than stranding the menu on the old node.
	 */
	function handleContextMenu(event: MouseEvent) {
		event.preventDefault();
		onRetarget({ x: event.clientX, y: event.clientY });
	}
</script>

<div
	class="menu-layer"
	role="presentation"
	onpointercancel={onClose}
	oncontextmenu={handleContextMenu}
>
	<!-- Pointer-only escape hatch: Escape and the re-target handler already give
	     keyboard and right-click users the same way out, so it stays out of the
	     tab order and out of the accessibility tree. -->
	<button class="menu-dismiss" type="button" tabindex="-1" aria-hidden="true" onclick={onClose}
	></button>
	<div
		bind:this={menuRef}
		class="node-action-menu"
		role="menu"
		aria-label={`Actions for ${mathPlainText(node.title)}`}
		style={`left: ${position.x}px; top: ${position.y}px;`}
		tabindex="-1"
		onkeydown={handleKeydown}
	>
		{#each items as item, index (index)}
			<button
				bind:this={itemRefs[index]}
				type="button"
				role="menuitem"
				tabindex={index === activeIndex ? 0 : -1}
				onfocus={() => (activeIndex = index)}
				onclick={item.activate}
			>
				{item.label}
			</button>
		{/each}
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
