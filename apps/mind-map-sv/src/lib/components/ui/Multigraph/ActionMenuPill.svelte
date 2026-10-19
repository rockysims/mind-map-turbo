<script lang="ts" module>
	/** One button in an action pill. */
	export type ActionMenuItem = {
		label: string;
		/**
		 * What the label cannot say, shown as the button's native `title` — which
		 * the browser also exposes as its accessible description, so the label
		 * still names it.
		 */
		hint: string;
		activate: () => void;
		/**
		 * Set when the item cannot act right now. It still renders and still takes
		 * focus and a tap (`aria-disabled`, never `disabled`), its `title` says
		 * this instead of the hint, and activating it never calls `activate`.
		 */
		disabledReason?: string;
	};
</script>

<script lang="ts">
	import type { Point } from '../types/multigraph';

	let {
		items,
		label,
		position,
		targetKey = '',
		onClose,
		onRetarget,
		onExplainDisabled
	}: {
		items: readonly ActionMenuItem[];
		/** The menu's accessible name. */
		label: string;
		/** Client coordinates of the press the menu answers; the pill floats above it. */
		position: Point;
		/**
		 * What the menu acts on — a node id, say. A change here or in `position`
		 * is a re-target: the first item takes focus again.
		 */
		targetKey?: string;
		onClose: () => void;
		/**
		 * Hit-test a right-click that landed on the open menu's layer. Without it
		 * the right-click just closes the menu.
		 */
		onRetarget?: (point: Point) => void;
		/**
		 * Activating a disabled item hands its reason here, so the page can put it
		 * in the status notice: `title` is hover-only and never reaches touch.
		 */
		onExplainDisabled?: (reason: string) => void;
	} = $props();

	/** Keep this far from every viewport edge when the pill has to be moved. */
	const VIEWPORT_MARGIN_PX = 8;
	/** The pill's bottom edge floats this far above the press point. */
	const ANCHOR_GAP_PX = 12;

	/**
	 * Where focus sat before the menu took it. Captured while the component is
	 * created — i.e. before the open effect focuses the first item — and kept
	 * across re-targets so the whole menu session restores to one place.
	 */
	const focusBeforeOpen = focusableActiveElement();

	function focusableActiveElement(): HTMLElement | SVGElement | null {
		if (typeof document === 'undefined') return null;
		const active = document.activeElement;
		return active instanceof HTMLElement || active instanceof SVGElement ? active : null;
	}

	let menuRef = $state<HTMLElement | null>(null);
	/** Roving-tabindex cursor: only this item is in the tab order. */
	let activeIndex = $state(0);
	let lastFocusedOpenKey = $state('');
	// Reactive because `bind:this` writes into it: Svelte's dev-mode binding
	// check reads the bound property back and warns `binding_property_non_reactive`
	// when that read registers no dependency, which a plain array never does — and
	// it warned on every open. A `$state` array is one proxy and the same writes.
	const itemRefs = $state<Array<HTMLButtonElement | null>>([]);

	/** Changes on open and on every re-target onto another node/point. */
	const openKey = $derived(`${targetKey}:${position.x}:${position.y}`);
	/**
	 * The list can shrink while the menu is open (an item that only shows for a
	 * selection, say); keep the tab stop on an item that still exists.
	 */
	const rovingIndex = $derived(Math.min(activeIndex, items.length - 1));

	// Opening (or re-targeting) moves focus into the menu, per the WAI-ARIA menu
	// pattern — without it the keydown handler below never fires.
	$effect(() => {
		if (openKey === lastFocusedOpenKey) return;
		lastFocusedOpenKey = openKey;
		activeIndex = 0;
		itemRefs[0]?.focus();
	});

	/**
	 * The pill's laid-out size, measured rather than guessed: its width follows
	 * its labels and how many items it has, and both can change while it is open.
	 * Read once on mount and then by a ResizeObserver, as the toolbar measures
	 * its own row. `offsetWidth`/`offsetHeight` are the layout box, which the
	 * nudge's transform never changes, so placing the pill cannot re-trigger this.
	 */
	let menuSize = $state<{ width: number; height: number } | null>(null);

	$effect(() => {
		const menu = menuRef;
		if (menu === null) return;
		const measure = () => {
			menuSize = { width: menu.offsetWidth, height: menu.offsetHeight };
		};
		measure();
		if (typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver(measure);
		observer.observe(menu);
		return () => observer.disconnect();
	});

	/**
	 * A press near an edge would otherwise push half the pill off-screen, and
	 * one near the top would float it above the viewport. Slide it sideways
	 * until it fits, and drop it below the press when there is no room above.
	 * A pill wider than the viewport cannot fit, so it centres on the viewport
	 * and overflows both sides evenly rather than one side entirely.
	 */
	function nudgeIntoViewport(anchor: Point, size: { width: number; height: number }): Point {
		if (typeof window === 'undefined') return { x: 0, y: 0 };
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;
		const margin = VIEWPORT_MARGIN_PX;

		const naturalLeft = anchor.x - size.width / 2;
		const left =
			size.width > viewportWidth - 2 * margin
				? (viewportWidth - size.width) / 2
				: Math.min(Math.max(naturalLeft, margin), viewportWidth - margin - size.width);

		const naturalTop = anchor.y - ANCHOR_GAP_PX - size.height;
		const preferredTop = naturalTop >= margin ? naturalTop : anchor.y + ANCHOR_GAP_PX;
		const top = Math.max(margin, Math.min(preferredTop, viewportHeight - margin - size.height));

		return { x: left - naturalLeft, y: top - naturalTop };
	}

	/** Zero whenever the pill already fits, so it sits exactly where it always did. */
	const nudge = $derived(
		menuSize === null ? { x: 0, y: 0 } : nudgeIntoViewport(position, menuSize)
	);

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

	function activateItem(item: ActionMenuItem) {
		if (item.disabledReason !== undefined) {
			onExplainDisabled?.(item.disabledReason);
			return;
		}
		item.activate();
	}

	function handleKeydown(event: KeyboardEvent) {
		switch (event.key) {
			case 'Escape':
				event.preventDefault();
				onClose();
				return;
			// Roving tabindex leaves the other items out of the tab order, so an
			// unhandled Tab walks straight past the menu — out of the page and into
			// the browser chrome, with this viewport-covering layer still up. Per the
			// menu pattern Tab leaves the menu: close it and let the teardown effect
			// put focus back where it was, so the tab sequence resumes from there.
			case 'Tab':
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
	 * point back for hit-testing rather than stranding the menu where it was.
	 */
	function handleContextMenu(event: MouseEvent) {
		event.preventDefault();
		if (!onRetarget) {
			onClose();
			return;
		}
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
		class="action-menu"
		role="menu"
		aria-label={label}
		style={`--menu-x: ${position.x}px; --menu-y: ${position.y}px; --menu-gap: ${ANCHOR_GAP_PX}px; --menu-nudge-x: ${nudge.x}px; --menu-nudge-y: ${nudge.y}px;`}
		tabindex="-1"
		onkeydown={handleKeydown}
	>
		{#each items as item, index (index)}
			<button
				bind:this={itemRefs[index]}
				type="button"
				role="menuitem"
				tabindex={index === rovingIndex ? 0 : -1}
				aria-disabled={item.disabledReason !== undefined ? 'true' : undefined}
				onfocus={() => (activeIndex = index)}
				onclick={() => activateItem(item)}
				title={item.disabledReason ?? item.hint}
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

	/*
	 * Anchored at the viewport origin and placed by the transform alone, so the
	 * width the browser lays the pill out at never depends on where it opened:
	 * with `left` set to the press point, a press near the right edge left too
	 * little room and squeezed every label onto two lines.
	 */
	.action-menu {
		position: fixed;
		left: 0;
		top: 0;
		display: flex;
		gap: 0.375rem;
		padding: 0.5rem;
		border: 1px solid #d4d4d4;
		border-radius: 999px;
		background: #ffffff;
		box-shadow: 0 8px 24px rgb(0 0 0 / 18%);
		transform: translate(
			calc(var(--menu-x) - 50% + var(--menu-nudge-x, 0px)),
			calc(var(--menu-y) - 100% - var(--menu-gap) + var(--menu-nudge-y, 0px))
		);
		touch-action: none;
	}

	.action-menu button {
		/* The 44px touch floor: one line of text plus this padding fell 4px short. */
		min-height: 2.75rem;
		border: 0;
		border-radius: 999px;
		padding: 0.5rem 0.75rem;
		background: #f1f5f9;
		color: #0f172a;
		font: inherit;
	}

	/*
	 * Unavailable reads as an outline rather than a filled chip. The grey is
	 * #64748b on the pill's white, about 4.8:1 — disabled text is exempt from the
	 * contrast floor, but the label still has to be read to be understood.
	 */
	.action-menu button[aria-disabled='true'] {
		background: transparent;
		box-shadow: inset 0 0 0 1px #e2e8f0;
		color: #64748b;
		cursor: default;
	}
</style>
