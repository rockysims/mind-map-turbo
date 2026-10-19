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
			canPaste: true,
			onPaste: fn(),
			onSelectAll: fn(),
			onClearSelection: fn(),
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
			onPaste: fn(),
			onSelectAll: fn(),
			onClearSelection: fn(),
			onClose: fn()
		};
		const instance = mount(BackgroundActionMenu, {
			target: host,
			props: { position: CENTRE, selectionCount: 0, canPaste: true, ...spies, ...props }
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
	play={async ({ canvasElement }) => {
		const menu = within(canvasElement).getByRole('menu', { name: 'Canvas actions' });
		expect(menu).toBeInTheDocument();
		expect(itemNames(canvasElement)).toEqual(['Paste here', 'Select all']);

		// Focus moves in on open, or the menu's own keys would never fire.
		expect(document.activeElement).toBe(item(canvasElement, 'Paste here'));
		// Roving tabindex: only the active item is a tab stop.
		expect(item(canvasElement, 'Paste here')).toHaveAttribute('tabindex', '0');
		expect(item(canvasElement, 'Select all')).toHaveAttribute('tabindex', '-1');

		// Every item explains itself beyond its label, and the label still names it.
		expect(item(canvasElement, 'Paste here')).toHaveAttribute('title', 'Put the copied nodes here');
		expect(item(canvasElement, 'Select all')).toHaveAttribute(
			'title',
			'Select every node on the canvas'
		);
		expect(item(canvasElement, 'Paste here')).not.toHaveAttribute('aria-disabled');
	}}
/>

<Story
	name="ArrowsMoveBetweenItemsAndWrap"
	args={{ selectionCount: 2 }}
	play={async ({ canvasElement }) => {
		expect(activeElementText()).toBe('Paste here');

		// Horizontal pill, but the vertical arrows work too, as on the node menu.
		dispatchKeydown(document.activeElement, 'ArrowRight');
		expect(activeElementText()).toBe('Select all');
		dispatchKeydown(document.activeElement, 'ArrowDown');
		expect(activeElementText()).toBe('Clear selection');
		dispatchKeydown(document.activeElement, 'ArrowUp');
		expect(activeElementText()).toBe('Select all');
		dispatchKeydown(document.activeElement, 'ArrowLeft');
		expect(activeElementText()).toBe('Paste here');

		// Wraps backwards off the first item onto the last, and forwards back round.
		const wrapped = dispatchKeydown(document.activeElement, 'ArrowLeft');
		expect(wrapped.defaultPrevented).toBe(true);
		expect(activeElementText()).toBe('Clear selection');
		dispatchKeydown(document.activeElement, 'ArrowRight');
		expect(activeElementText()).toBe('Paste here');

		dispatchKeydown(document.activeElement, 'End');
		expect(activeElementText()).toBe('Clear selection');
		dispatchKeydown(document.activeElement, 'Home');
		expect(activeElementText()).toBe('Paste here');

		flushSync();
		expect(item(canvasElement, 'Paste here')).toHaveAttribute('tabindex', '0');
		expect(item(canvasElement, 'Clear selection')).toHaveAttribute('tabindex', '-1');
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
				within(canvasElement).getByRole('menuitem', { name: 'Paste here' })
			);

			const event = dispatchKeydown(document.activeElement, 'Escape');
			expect(event.defaultPrevented).toBe(true);
			expect(menu.spies.onClose).toHaveBeenCalledOnce();
			expect(menu.spies.onPaste).not.toHaveBeenCalled();

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
			expect(activeElementText()).toBe('Select all');

			// Roving tabindex would otherwise let the browser tab clean out of the
			// page with the menu layer still up: Tab must close the menu itself.
			const event = dispatchKeydown(document.activeElement, 'Tab');
			expect(event.defaultPrevented).toBe(true);
			expect(menu.spies.onClose).toHaveBeenCalledOnce();
			expect(menu.spies.onSelectAll).not.toHaveBeenCalled();

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
	name="HidesClearSelectionWithoutASelection"
	args={{ selectionCount: 0 }}
	play={async ({ canvasElement }) => {
		expect(itemNames(canvasElement)).toEqual(['Paste here', 'Select all']);
		expect(
			within(canvasElement).queryByRole('menuitem', { name: 'Clear selection' })
		).not.toBeInTheDocument();
	}}
/>

<Story
	name="OffersClearSelectionWithASelection"
	args={{ selectionCount: 2 }}
	play={async ({ canvasElement }) => {
		expect(itemNames(canvasElement)).toEqual(['Paste here', 'Select all', 'Clear selection']);
		expect(item(canvasElement, 'Clear selection')).toHaveAttribute('title', 'Deselect every node');
	}}
/>

<Story
	name="EachItemRunsItsActionAndThenCloses"
	play={async ({ canvasElement }) => {
		// One fresh menu per item, as the page opens one per hold.
		const cases = [
			{ name: 'Paste here', spy: 'onPaste' },
			{ name: 'Select all', spy: 'onSelectAll' },
			{ name: 'Clear selection', spy: 'onClearSelection' }
		] as const;
		for (const { name, spy } of cases) {
			const menu = openMenu(canvasElement, { selectionCount: 2 });
			try {
				within(canvasElement).getByRole('menuitem', { name }).click();

				const action = menu.spies[spy];
				expect(action).toHaveBeenCalledOnce();
				expect(menu.spies.onClose).toHaveBeenCalledOnce();
				// The action runs first, inside the tap — which is what lets "Paste
				// here" read the clipboard — and the close follows it.
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
	name="UnavailablePasteSaysWhyAndDoesNotPaste"
	play={async ({ canvasElement }) => {
		const onExplainDisabled = fn<(reason: string) => void>();
		const menu = openMenu(canvasElement, { canPaste: false, onExplainDisabled });
		try {
			const paste = within(canvasElement).getByRole('menuitem', { name: 'Paste here' });

			// Still there and still focusable, so the reader learns the action
			// exists; the reason replaces the hint as its description.
			expect(paste).toHaveAttribute('aria-disabled', 'true');
			expect(paste).not.toHaveAttribute('disabled');
			expect(paste).toHaveAttribute('title', 'Nothing copied yet');
			expect(paste).toHaveAccessibleDescription('Nothing copied yet');
			expect(document.activeElement).toBe(paste);

			// A tap still lands — `title` never reaches touch, so the reason goes
			// to the page for its notice line — but nothing is pasted and the menu
			// stays up for the other items.
			paste.click();
			expect(menu.spies.onPaste).not.toHaveBeenCalled();
			expect(menu.spies.onClose).not.toHaveBeenCalled();
			expect(onExplainDisabled).toHaveBeenCalledOnce();
			expect(onExplainDisabled).toHaveBeenCalledWith('Nothing copied yet');

			// The rest of the menu is unaffected.
			const selectAll = within(canvasElement).getByRole('menuitem', { name: 'Select all' });
			expect(selectAll).not.toHaveAttribute('aria-disabled');
			selectAll.click();
			expect(menu.spies.onSelectAll).toHaveBeenCalledOnce();
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
	args={{ selectionCount: 2, canPaste: false }}
	play={async ({ canvasElement }) => {
		// The phone viewport from the meta's parameters, not the runner's default.
		expect(window.innerWidth).toBe(390);
		const items = within(canvasElement).getAllByRole('menuitem');
		expect(items).toHaveLength(3);
		for (const element of items) {
			expect(element.getBoundingClientRect().height).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
		}
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
