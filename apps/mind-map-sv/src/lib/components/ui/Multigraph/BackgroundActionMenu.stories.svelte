<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { flushSync, mount, unmount, type ComponentProps } from 'svelte';
	import { expect, fn, within } from 'storybook/test';
	import BackgroundActionMenu from './BackgroundActionMenu.svelte';

	/** Mid-screen on the phone viewport, well clear of every edge. */
	const CENTRE = { x: 195, y: 400 };

	const { Story } = defineMeta({
		title: 'Components/Multigraph/BackgroundActionMenu',
		component: BackgroundActionMenu,
		tags: [],
		args: {
			position: CENTRE,
			selectionCount: 0,
			pasteCount: null,
			onSelect: fn(),
			onPaste: fn(),
			onCopy: fn(),
			onCutEdges: fn(),
			onClose: fn()
		},
		parameters: {
			viewport: {
				defaultViewport: 'phone'
			}
		}
	});

	/** The checklist floor for anything a finger has to hit. */
	const TOUCH_TARGET_PX = 44;
	/** The pill's bottom edge floats this far above the press it answers. */
	const ANCHOR_GAP_PX = 12;

	type MenuProps = ComponentProps<typeof BackgroundActionMenu>;

	function item(root: HTMLElement, name: string): HTMLElement {
		return within(root).getByRole('menuitem', { name });
	}

	function itemNames(root: HTMLElement): string[] {
		return within(root)
			.getAllByRole('menuitem')
			.map((element) => element.textContent?.trim() ?? '');
	}

	function activeElementText(): string {
		return document.activeElement?.textContent?.trim() ?? '';
	}

	function dispatchKeydown(target: Element | null, key: string): KeyboardEvent {
		if (!target) throw new Error(`No target to receive ${key}`);
		const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
		target.dispatchEvent(event);
		return event;
	}

	function dispatchContextMenuAt(clientX: number, clientY: number): MouseEvent {
		const target = document.elementFromPoint(clientX, clientY);
		if (!target) throw new Error(`No element at (${clientX}, ${clientY})`);
		const event = new MouseEvent('contextmenu', {
			clientX,
			clientY,
			bubbles: true,
			cancelable: true
		});
		target.dispatchEvent(event);
		return event;
	}

	/** Two frames: long enough for the pill's ResizeObserver to have measured it. */
	function waitForLayout(): Promise<void> {
		return new Promise((resolve) => {
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
		});
	}

	/**
	 * Open the menu the way the page does — mounted while something else holds
	 * focus — with its own typed spies, so a story can see what had focus before
	 * and what each callback was called with, in order. `close` is the page's
	 * half of a close: it removes the menu, which is what restores focus.
	 */
	function openMenu(host: HTMLElement, props: Partial<MenuProps> = {}) {
		const spies = {
			onSelect: fn(),
			onPaste: fn(),
			onCopy: fn(),
			onCutEdges: fn(),
			onClose: fn()
		};
		const instance = mount(BackgroundActionMenu, {
			target: host,
			props: { position: CENTRE, selectionCount: 0, pasteCount: null, ...spies, ...props }
		});
		flushSync();
		let open = true;
		return {
			spies,
			close() {
				if (!open) return;
				open = false;
				unmount(instance);
				flushSync();
			}
		};
	}

	function beforeButton(root: HTMLElement): HTMLElement {
		return within(root).getByRole('button', { name: 'Before' });
	}
</script>

<Story
	name="OpensWithFocusOnTheFirstItem"
	args={{ selectionCount: 3, pasteCount: 5 }}
	play={async ({ canvasElement }) => {
		const menu = within(canvasElement).getByRole('menu', { name: 'Canvas actions' });
		expect(menu).toBeInTheDocument();
		expect(itemNames(canvasElement)).toEqual(['Select more', 'Paste (5)', 'Copy (3)', 'Cut edges']);

		// Focus moves in on open, or the menu's own keys would never fire.
		expect(document.activeElement).toBe(item(canvasElement, 'Select more'));
		// Roving tabindex: only the active item is a tab stop.
		expect(item(canvasElement, 'Select more')).toHaveAttribute('tabindex', '0');
		expect(item(canvasElement, 'Paste (5)')).toHaveAttribute('tabindex', '-1');
		expect(item(canvasElement, 'Copy (3)')).toHaveAttribute('tabindex', '-1');
		expect(item(canvasElement, 'Cut edges')).toHaveAttribute('tabindex', '-1');

		// Every item explains itself beyond its label, and the label still names it.
		// Select's hint names the drag, as the cut's does.
		expect(item(canvasElement, 'Select more')).toHaveAccessibleDescription(
			'Drag a box over the nodes to select, then click or lift'
		);
		expect(item(canvasElement, 'Paste (5)')).toHaveAttribute('title', 'Put the copied nodes here');
		expect(item(canvasElement, 'Paste (5)')).toHaveAccessibleDescription(
			'Put the copied nodes here'
		);
		expect(item(canvasElement, 'Copy (3)')).toHaveAttribute(
			'title',
			'Copy the selected nodes and the edges between them'
		);
		// The cut's hint names the drag, which the two-word label cannot.
		expect(item(canvasElement, 'Cut edges')).toHaveAccessibleDescription(
			'Drag a line across the edges to delete, then click or lift to cut'
		);
		expect(item(canvasElement, 'Paste (5)')).not.toHaveAttribute('aria-disabled');
	}}
/>

<Story
	name="ArrowsMoveBetweenItemsAndWrap"
	args={{ selectionCount: 2 }}
	play={async ({ canvasElement }) => {
		expect(activeElementText()).toBe('Select more');

		// Horizontal pill, but the vertical arrows work too, as on the node menu.
		dispatchKeydown(document.activeElement, 'ArrowRight');
		expect(activeElementText()).toBe('Paste');
		dispatchKeydown(document.activeElement, 'ArrowUp');
		expect(activeElementText()).toBe('Select more');
		dispatchKeydown(document.activeElement, 'ArrowDown');
		expect(activeElementText()).toBe('Paste');

		dispatchKeydown(document.activeElement, 'ArrowRight');
		expect(activeElementText()).toBe('Copy (2)');
		dispatchKeydown(document.activeElement, 'ArrowRight');
		expect(activeElementText()).toBe('Cut edges');

		// Wraps forwards off the last item onto the first, and backwards round again.
		const forwards = dispatchKeydown(document.activeElement, 'ArrowRight');
		expect(forwards.defaultPrevented).toBe(true);
		expect(activeElementText()).toBe('Select more');
		const backwards = dispatchKeydown(document.activeElement, 'ArrowLeft');
		expect(backwards.defaultPrevented).toBe(true);
		expect(activeElementText()).toBe('Cut edges');

		dispatchKeydown(document.activeElement, 'Home');
		expect(activeElementText()).toBe('Select more');
		dispatchKeydown(document.activeElement, 'End');
		expect(activeElementText()).toBe('Cut edges');
		dispatchKeydown(document.activeElement, 'Home');
		expect(activeElementText()).toBe('Select more');

		flushSync();
		expect(item(canvasElement, 'Select more')).toHaveAttribute('tabindex', '0');
		expect(item(canvasElement, 'Paste')).toHaveAttribute('tabindex', '-1');
	}}
/>

<Story
	name="EscapeClosesAndRestoresFocus"
	play={async ({ canvasElement }) => {
		const before = beforeButton(canvasElement);
		before.focus();
		const menu = openMenu(canvasElement);
		try {
			expect(document.activeElement).toBe(
				within(canvasElement).getByRole('menuitem', { name: 'Select' })
			);

			const event = dispatchKeydown(document.activeElement, 'Escape');
			expect(event.defaultPrevented).toBe(true);
			expect(menu.spies.onClose).toHaveBeenCalledOnce();
			expect(menu.spies.onSelect).not.toHaveBeenCalled();

			// The page answers onClose by removing the menu, and focus goes back.
			menu.close();
			expect(within(canvasElement).queryByRole('menu')).not.toBeInTheDocument();
			expect(document.activeElement).toBe(before);
		} finally {
			menu.close();
		}
	}}
>
	{#snippet template()}
		<button type="button">Before</button>
	{/snippet}
</Story>

<Story
	name="TabClosesAndRestoresFocus"
	play={async ({ canvasElement }) => {
		const before = beforeButton(canvasElement);
		before.focus();
		const menu = openMenu(canvasElement, { selectionCount: 2 });
		try {
			dispatchKeydown(document.activeElement, 'ArrowRight');
			dispatchKeydown(document.activeElement, 'ArrowRight');
			expect(activeElementText()).toBe('Copy (2)');

			// Roving tabindex would otherwise let the browser tab clean out of the
			// page with the menu layer still up: Tab must close the menu itself.
			const event = dispatchKeydown(document.activeElement, 'Tab');
			expect(event.defaultPrevented).toBe(true);
			expect(menu.spies.onClose).toHaveBeenCalledOnce();
			expect(menu.spies.onCopy).not.toHaveBeenCalled();

			menu.close();
			expect(document.activeElement).toBe(before);
		} finally {
			menu.close();
		}
	}}
>
	{#snippet template()}
		<button type="button">Before</button>
	{/snippet}
</Story>

<Story
	name="OffersCopyNOnlyWhenMoreThanOneNodeIsSelected"
	play={async ({ canvasElement }) => {
		// None or one selected: no Copy, only Select, Paste and Cut edges. Select
		// all and Clear selection are never here; their keys and the background
		// click keep those jobs.
		for (const [selectionCount, select] of [
			[0, 'Select'],
			[1, 'Select more']
		] as const) {
			const menu = openMenu(canvasElement, { selectionCount });
			try {
				expect(itemNames(canvasElement), String(selectionCount)).toEqual([
					select,
					'Paste',
					'Cut edges'
				]);
				expect(
					within(canvasElement).queryByRole('menuitem', { name: /^Copy/ })
				).not.toBeInTheDocument();
			} finally {
				menu.close();
			}
		}

		// Two or more: "Copy (N)", with the count in its name as well as its
		// label, between Paste and Cut edges.
		for (const selectionCount of [2, 7]) {
			const menu = openMenu(canvasElement, { selectionCount });
			try {
				const name = `Copy (${selectionCount})`;
				expect(itemNames(canvasElement)).toEqual(['Select more', 'Paste', name, 'Cut edges']);
				const copy = item(canvasElement, name);
				expect(copy).toHaveAccessibleName(name);
				expect(copy).toHaveAccessibleDescription(
					'Copy the selected nodes and the edges between them'
				);
				expect(copy).not.toHaveAttribute('aria-disabled');
				expect(within(canvasElement).getByRole('menu')).toHaveAccessibleName('Canvas actions');
			} finally {
				menu.close();
			}
		}
	}}
>
	{#snippet template()}
		<div></div>
	{/snippet}
</Story>

<Story
	name="SelectComesFirstAndReadsSelectMoreWhileAnythingIsSelected"
	play={async ({ canvasElement }) => {
		// "Select" replaces the selection, "Select more" adds to it; either way it
		// is the first item, the one a touch reader reaches for, and it is always
		// offered.
		for (const [selectionCount, name] of [
			[0, 'Select'],
			[1, 'Select more'],
			[5, 'Select more']
		] as const) {
			const menu = openMenu(canvasElement, { selectionCount });
			try {
				expect(itemNames(canvasElement)[0], String(selectionCount)).toBe(name);
				const select = item(canvasElement, name);
				expect(select).toHaveAccessibleName(name);
				expect(select).toHaveAttribute(
					'title',
					'Drag a box over the nodes to select, then click or lift'
				);
				expect(select).not.toHaveAttribute('aria-disabled');
				expect(document.activeElement).toBe(select);

				// It arms the box inside the tap, while the menu's point is still there
				// to read, and then the menu closes.
				select.click();
				expect(menu.spies.onSelect).toHaveBeenCalledOnce();
				expect(menu.spies.onClose).toHaveBeenCalledOnce();
				expect(menu.spies.onSelect.mock.invocationCallOrder[0]).toBeLessThan(
					menu.spies.onClose.mock.invocationCallOrder[0]
				);
			} finally {
				menu.close();
			}
		}
	}}
>
	{#snippet template()}
		<div></div>
	{/snippet}
</Story>

<Story
	name="EachItemRunsItsActionAndThenCloses"
	play={async ({ canvasElement }) => {
		// One fresh menu per item, as the page opens one per hold.
		const cases = [
			{ name: 'Select more', spy: 'onSelect' },
			{ name: 'Paste', spy: 'onPaste' },
			{ name: 'Copy (2)', spy: 'onCopy' },
			{ name: 'Cut edges', spy: 'onCutEdges' }
		] as const;
		for (const { name, spy } of cases) {
			const menu = openMenu(canvasElement, { selectionCount: 2 });
			try {
				within(canvasElement).getByRole('menuitem', { name }).click();

				const action = menu.spies[spy];
				expect(action).toHaveBeenCalledOnce();
				expect(menu.spies.onClose).toHaveBeenCalledOnce();
				// The action runs first, inside the tap — which is what lets Paste read
				// the clipboard and Copy write it, and Select and Cut edges read the
				// menu's point before the menu is gone — and the close follows it.
				expect(action.mock.invocationCallOrder[0]).toBeLessThan(
					menu.spies.onClose.mock.invocationCallOrder[0]
				);
				const others = Object.entries(menu.spies).filter(
					([key]) => key !== spy && key !== 'onClose'
				);
				for (const [, other] of others) expect(other).not.toHaveBeenCalled();
			} finally {
				menu.close();
			}
		}
	}}
>
	{#snippet template()}
		<div></div>
	{/snippet}
</Story>

<Story
	name="PasteNamesTheClipboardsCountAndStaysOfferedWhenThereIsNone"
	play={async ({ canvasElement }) => {
		// A count names what a paste would bring, in its name as well as its label.
		for (const pasteCount of [1, 3, 24]) {
			const menu = openMenu(canvasElement, { pasteCount, selectionCount: 2 });
			try {
				const name = `Paste (${pasteCount})`;
				expect(itemNames(canvasElement)).toEqual(['Select more', name, 'Copy (2)', 'Cut edges']);
				const paste = item(canvasElement, name);
				expect(paste).toHaveAccessibleName(name);
				expect(paste).toHaveAccessibleDescription('Put the copied nodes here');
				expect(paste).not.toHaveAttribute('aria-disabled');
			} finally {
				menu.close();
			}
		}

		// No readable count: a bare "Paste", still offered, because a tap can read a
		// clipboard the page could not — and the tap goes to the page, which says
		// why when there is still nothing there.
		const menu = openMenu(canvasElement, { pasteCount: null, selectionCount: 2 });
		try {
			expect(itemNames(canvasElement)).toEqual(['Select more', 'Paste', 'Copy (2)', 'Cut edges']);
			const paste = item(canvasElement, 'Paste');
			expect(paste).not.toHaveAttribute('aria-disabled');
			expect(paste).toHaveAttribute('title', 'Put the copied nodes here');
			paste.click();
			expect(menu.spies.onPaste).toHaveBeenCalledOnce();
			expect(menu.spies.onClose).toHaveBeenCalledOnce();
		} finally {
			menu.close();
		}
	}}
>
	{#snippet template()}
		<div></div>
	{/snippet}
</Story>

<Story
	name="EveryItemMeetsTheTouchFloorOnAPhone"
	args={{ selectionCount: 12, pasteCount: 24 }}
	play={async ({ canvasElement }) => {
		// The phone viewport from the meta's parameters, not the runner's default.
		expect(window.innerWidth).toBe(390);
		const items = within(canvasElement).getAllByRole('menuitem');
		expect(items).toHaveLength(4);
		for (const element of items) {
			expect(element.getBoundingClientRect().height).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
		}
		// Four items with two-digit counts may wrap onto a second row, and no
		// further; either way the pill stays inside the phone's width.
		const rows = new Set(items.map((element) => Math.round(element.getBoundingClientRect().top)));
		expect(rows.size).toBeLessThanOrEqual(2);
		await waitForLayout();
		const pill = within(canvasElement).getByRole('menu').getBoundingClientRect();
		expect(pill.left).toBeGreaterThanOrEqual(0);
		expect(pill.right).toBeLessThanOrEqual(window.innerWidth);
	}}
/>

<Story
	name="SitsAboveThePressAndStaysInsideTheViewport"
	play={async ({ canvasElement }) => {
		const viewportWidth = window.innerWidth;
		const presses = [
			{ label: 'centre', point: CENTRE },
			{ label: 'left edge', point: { x: 4, y: 400 } },
			{ label: 'right edge', point: { x: viewportWidth - 4, y: 400 } },
			{ label: 'top edge', point: { x: 195, y: 20 } }
		];
		for (const { label, point } of presses) {
			const menu = openMenu(canvasElement, { position: point, selectionCount: 2 });
			try {
				await waitForLayout();
				const pill = within(canvasElement).getByRole('menu').getBoundingClientRect();

				expect(pill.left, label).toBeGreaterThanOrEqual(0);
				expect(pill.right, label).toBeLessThanOrEqual(viewportWidth);
				expect(pill.top, label).toBeGreaterThanOrEqual(0);
				expect(pill.bottom, label).toBeLessThanOrEqual(window.innerHeight);

				if (label === 'centre') {
					// Away from the edges it sits where the node menu would: centred
					// on the press, floating just above it.
					expect(pill.left + pill.width / 2).toBeCloseTo(point.x, 0);
					expect(pill.bottom).toBeCloseTo(point.y - ANCHOR_GAP_PX, 0);
				}
				if (label === 'top edge') {
					// No room above, so it drops below the press instead.
					expect(pill.top).toBeCloseTo(point.y + ANCHOR_GAP_PX, 0);
				}

				// Every item is actually the topmost thing under its own centre.
				for (const element of within(canvasElement).getAllByRole('menuitem')) {
					const rect = element.getBoundingClientRect();
					const hit = document.elementFromPoint(
						rect.left + rect.width / 2,
						rect.top + rect.height / 2
					);
					expect(hit, `${label}: ${element.textContent}`).toBe(element);
				}
			} finally {
				menu.close();
			}
		}
	}}
>
	{#snippet template()}
		<div></div>
	{/snippet}
</Story>

<Story
	name="RightClickWhileOpenRetargetsOrCloses"
	play={async ({ canvasElement }) => {
		const onRetarget = fn<(point: { x: number; y: number }) => void>();
		const retargeting = openMenu(canvasElement, { onRetarget });
		try {
			// The layer swallows the right-click: no native menu, and the point goes
			// back to the page to hit-test, as the node menu's does.
			const event = dispatchContextMenuAt(40, 700);
			expect(event.defaultPrevented).toBe(true);
			expect(onRetarget).toHaveBeenCalledOnce();
			expect(onRetarget).toHaveBeenCalledWith({ x: 40, y: 700 });
			expect(retargeting.spies.onClose).not.toHaveBeenCalled();
		} finally {
			retargeting.close();
		}

		// With nothing to re-target onto, the right-click just closes the menu.
		const plain = openMenu(canvasElement);
		try {
			const event = dispatchContextMenuAt(40, 700);
			expect(event.defaultPrevented).toBe(true);
			expect(plain.spies.onClose).toHaveBeenCalledOnce();
		} finally {
			plain.close();
		}
	}}
>
	{#snippet template()}
		<div></div>
	{/snippet}
</Story>
