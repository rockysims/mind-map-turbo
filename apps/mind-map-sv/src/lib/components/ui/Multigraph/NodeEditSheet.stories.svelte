<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
	import NodeEditSheet from './NodeEditSheet.svelte';
	import NodeEditSheetHarness from './NodeEditSheetHarness.svelte';
	import ToolbarClearanceStage from './ToolbarClearanceStage.svelte';
	import {
		TOOLBAR_CLEARANCE_PROPERTY,
		toolbarClearancePx
	} from '../GraphToolbar/lib/toolbarClearance';
	import type { NodeContentBlock, NodeData, QuantityDesignation } from '../types/node';
	import type { GraphAssetMetadata, MultigraphData } from '../types/multigraph';
	import { APP_CONFIG } from '$lib/appConfig';
	import { makeGraph } from './lib/testFixtures';
	import { symbolFor } from '../MathText/lib/mathSymbols';

	const NODE: NodeData = {
		id: 'node-1',
		title: 'Kinematics',
		description: 'Plain prose with no math.',
		tags: []
	};

	const { Story } = defineMeta({
		title: 'Components/Multigraph/NodeEditSheet',
		component: NodeEditSheet,
		tags: [],
		args: {
			node: NODE,
			nodes: [NODE],
			edges: [],
			onSave: fn(),
			onSaveEdge: fn(),
			onCancel: fn(),
			onTogglePinned: fn(),
			onDelete: fn()
		}
	});

	type SaveSpy = {
		mock: {
			calls: Array<
				[
					{
						title: string;
						description: string;
						tags: string[];
						inputs: QuantityDesignation[];
						outputs: QuantityDesignation[];
						weight?: number | null;
					}
				]
			>;
		};
	};

	function weightInput(canvasElement: HTMLElement): HTMLInputElement {
		const found = canvasElement.querySelector('input[name="weight"]');
		if (!(found instanceof HTMLInputElement)) throw new Error('no weight field');
		return found;
	}

	/** Type into the weight field the way a user would, so the sheet's draft updates. */
	function typeWeight(canvasElement: HTMLElement, value: string): void {
		const input = weightInput(canvasElement);
		input.value = value;
		input.dispatchEvent(new Event('input', { bubbles: true }));
	}

	/** `$$w = m g$$`: one definition and two mentions, all with plain one-letter keys. */
	const WEIGHT_EQUATION = 'Weight is $$w = m g$$.';

	/**
	 * An equation missing its left-hand side, plus a loose mention to supply the
	 * chip. The parser calls `v` a reference here, so writing it into the empty
	 * left-hand side is what turns it into a definition.
	 */
	const HEADLESS_EQUATION = 'Speed: $$ = a t$$ and $v$ elsewhere.';

	/** The mirror: a left-hand side with nothing after the equals yet. */
	const BODYLESS_EQUATION = 'Force: $$w = $$ and $g$ here.';

	/** Confirmed as an output, with no equation left in the text to back it up. */
	const STALE_NODE: NodeData = {
		id: 'node-2',
		title: 'Weight',
		description: 'Force is $x = $ here.',
		tags: [],
		outputs: [{ base: 'w', subscript: null }]
	};

	function chip(canvasElement: HTMLElement, key: string): HTMLElement {
		const found = canvasElement.querySelector(`[data-designation-key="${key}"]`);
		if (!(found instanceof HTMLElement)) {
			throw new Error(`no chip for ${key}`);
		}
		return found;
	}

	function roleOf(canvasElement: HTMLElement, key: string): string | null {
		return chip(canvasElement, key).getAttribute('data-designation-role');
	}

	/** The chips are `$derived` off the draft, so a keystroke lands a microtask later. */
	function settle(): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, 0));
	}

	/** Type into the description the way a user would, so bound state updates. */
	function typeDescription(canvasElement: HTMLElement, value: string): void {
		const textarea = canvasElement.querySelector('textarea[name="description"]');
		if (!(textarea instanceof HTMLTextAreaElement)) {
			throw new Error('description textarea not found');
		}
		textarea.value = value;
		textarea.dispatchEvent(new Event('input', { bubbles: true }));
	}

	function preview(canvasElement: HTMLElement): HTMLElement | null {
		const found = canvasElement.querySelector('[data-math-preview]');
		return found instanceof HTMLElement ? found : null;
	}

	const HOLD_MS = APP_CONFIG.multigraph.dataflow.chipInsertLongPressMs;
	const HOLD_DRIFT_PX = APP_CONFIG.interaction.longPressDistancePx;

	function sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/**
	 * A subscripted chip, found by scanning rather than by selector: its key embeds
	 * a NUL to separate base from subscript, and `CSS.escape` replaces that with
	 * U+FFFD rather than escaping it, so the raw key is not usable in a selector.
	 */
	function subscriptedChip(canvasElement: HTMLElement, base: string, subscript: string) {
		const key = symbolFor(base, subscript).key;
		for (const candidate of canvasElement.querySelectorAll('[data-designation-key]')) {
			if (candidate.getAttribute('data-designation-key') !== key) continue;
			if (candidate instanceof HTMLElement) return candidate;
		}
		throw new Error(`no chip for ${base}_${subscript}`);
	}

	function fieldOf(canvasElement: HTMLElement, field: 'title' | 'description') {
		const selector = field === 'title' ? 'input[name="title"]' : 'textarea[name="description"]';
		const found = canvasElement.querySelector(selector);
		if (!(found instanceof HTMLInputElement) && !(found instanceof HTMLTextAreaElement)) {
			throw new Error(`no ${field} field`);
		}
		return found;
	}

	/**
	 * Put the cursor where an author would, and tell the sheet about it.
	 * `setSelectionRange` fires nothing on its own, so the `select` the sheet
	 * listens for has to be dispatched — the same event a real drag would send.
	 */
	async function placeCaret(
		canvasElement: HTMLElement,
		field: 'title' | 'description',
		start: number,
		end: number = start
	): Promise<void> {
		// The sheet focuses the title on open inside a `requestAnimationFrame`. A
		// caret placed before that frame lands gets stolen back, and the insertion
		// then goes to the title instead of where the story pointed. A real author
		// cannot act inside one frame of the sheet opening; a story can, so it waits.
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		const element = fieldOf(canvasElement, field);
		element.focus();
		element.setSelectionRange(start, end);
		element.dispatchEvent(new Event('select', { bubbles: true }));
	}

	/** Put the cursor just after `marker` in that field's current value. */
	async function caretAfter(
		canvasElement: HTMLElement,
		field: 'title' | 'description',
		marker: string
	): Promise<void> {
		const index = fieldOf(canvasElement, field).value.indexOf(marker);
		if (index === -1) throw new Error(`no ${marker} in ${field}`);
		await placeCaret(canvasElement, field, index + marker.length);
	}

	function dispatchChipPointer(
		target: HTMLElement,
		type: 'pointerdown' | 'pointermove' | 'pointerup',
		pointerType: string,
		offset = 0
	): void {
		const rect = target.getBoundingClientRect();
		target.dispatchEvent(
			new PointerEvent(type, {
				bubbles: true,
				cancelable: true,
				pointerId: 1,
				button: 0,
				pointerType,
				clientX: rect.left + rect.width / 2 + offset,
				clientY: rect.top + rect.height / 2
			})
		);
	}

	/**
	 * How much longer than the tunable to hold before letting go.
	 *
	 * Generous on purpose. The component arms a real `setTimeout`, so a margin that
	 * only just clears it turns into a flaky test the moment the run is busy: the
	 * timer slips past the release, `pointerup` cancels it, and the story fails
	 * having tested nothing. A whole extra tunable's worth of slack costs a second
	 * across the file and removes the race.
	 */
	const HOLD_MARGIN_MS = HOLD_MS;

	/**
	 * Hold a chip past the tunable and let go, then let the browser's own click
	 * land — the trailing click is the whole reason the suppression flag exists, so
	 * a story that omits it would never exercise it.
	 */
	async function holdChip(chip: HTMLElement, pointerType = 'touch'): Promise<void> {
		dispatchChipPointer(chip, 'pointerdown', pointerType);
		await sleep(HOLD_MS + HOLD_MARGIN_MS);
		dispatchChipPointer(chip, 'pointerup', pointerType);
		chip.click();
		await settle();
	}

	/**
	 * A hold whose trailing click never arrives, because the finger wandered off
	 * the chip before lifting and the click landed on an ancestor instead. This is
	 * the state that used to leave a suppression flag armed forever.
	 */
	async function holdChipLosingItsClick(chip: HTMLElement): Promise<void> {
		dispatchChipPointer(chip, 'pointerdown', 'touch');
		await sleep(HOLD_MS + HOLD_MARGIN_MS);
		dispatchChipPointer(chip, 'pointerup', 'touch');
		await settle();
	}

	/** A press that wanders too far to count, ending in the click a tap would send. */
	async function driftingHold(chip: HTMLElement): Promise<void> {
		dispatchChipPointer(chip, 'pointerdown', 'touch');
		dispatchChipPointer(chip, 'pointermove', 'touch', HOLD_DRIFT_PX + 10);
		await sleep(HOLD_MS + HOLD_MARGIN_MS);
		dispatchChipPointer(chip, 'pointerup', 'touch', HOLD_DRIFT_PX + 10);
		chip.click();
		await settle();
	}

	/**
	 * A desktop right-click in full. The browser fires `pointerdown` with the
	 * secondary button before `contextmenu`, and that pointerdown is what clears a
	 * click suppression left over from an earlier hold — dispatching `contextmenu`
	 * alone would test the guard without the thing that disarms it.
	 */
	async function rightClickChip(chip: HTMLElement): Promise<void> {
		const rect = chip.getBoundingClientRect();
		chip.dispatchEvent(
			new PointerEvent('pointerdown', {
				bubbles: true,
				cancelable: true,
				pointerId: 1,
				button: 2,
				pointerType: 'mouse',
				clientX: rect.left + rect.width / 2,
				clientY: rect.top + rect.height / 2
			})
		);
		chip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await settle();
	}

	async function pressKey(chip: HTMLElement, key: string, shiftKey = false): Promise<void> {
		const event = new KeyboardEvent('keydown', {
			key,
			shiftKey,
			bubbles: true,
			cancelable: true
		});
		chip.dispatchEvent(event);
		// Enter on a focused button also activates it, and `preventDefault` on the
		// keydown is the only thing that stops the browser doing so. Honouring that
		// here is what makes this a real keystroke rather than two events in a row:
		// clicking regardless would make Shift+Enter write *and* cycle in the test
		// no matter what the component did.
		if (key === 'Enter' && !event.defaultPrevented) chip.click();
		await settle();
	}

	async function tapChip(chip: HTMLElement): Promise<void> {
		dispatchChipPointer(chip, 'pointerdown', 'touch');
		dispatchChipPointer(chip, 'pointerup', 'touch');
		chip.click();
		await settle();
	}

	function statusText(canvasElement: HTMLElement): string {
		return canvasElement.querySelector('[data-insert-status]')?.textContent ?? '';
	}

	/**
	 * `touch-action` decides what the browser's own gesture handling does, which a
	 * synthetic PointerEvent sequence cannot exercise — dispatched events scroll
	 * nothing, and `scrollTop = n` works whatever the rule says. The computed value
	 * is the assertion that actually means something here.
	 */
	/** A short phone: the toolbar wraps to its full height and the sheet overflows. */
	const SHORT_PHONE_VIEWPORT = 'shortPhone';

	const SHORT_PHONE_PARAMETERS = {
		viewport: {
			defaultViewport: SHORT_PHONE_VIEWPORT,
			viewports: {
				[SHORT_PHONE_VIEWPORT]: {
					name: 'Short phone',
					styles: { width: '375px', height: '600px' }
				}
			}
		}
	};

	const ATTACHMENT_COUNT = 12;

	/** One node carrying more attachments than a phone's sheet can show at once. */
	function graphWithManyAttachments(): MultigraphData {
		const ids = Array.from({ length: ATTACHMENT_COUNT }, (_, index) => `asset-${index + 1}`);
		const content: NodeContentBlock[] = ids.map((assetId, index) => ({
			type: 'file',
			assetId,
			name: `notes-${index + 1}.csv`
		}));
		const assets: Record<string, GraphAssetMetadata> = Object.fromEntries(
			ids.map((assetId, index) => [
				assetId,
				{
					id: assetId,
					kind: 'file',
					mimeType: 'text/csv',
					name: `notes-${index + 1}.csv`,
					size: 8,
					createdAt: 1
				}
			])
		);
		return { ...taggedGraph({ content }), assets };
	}

	function elementIn(root: ParentNode, selector: string): HTMLElement {
		const found = root.querySelector(selector);
		if (!(found instanceof HTMLElement)) throw new Error(`no element for ${selector}`);
		return found;
	}

	/** The topmost element at a control's centre is the control (or inside it). */
	function hittable(control: HTMLElement): boolean {
		const box = control.getBoundingClientRect();
		const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
		return hit !== null && (hit === control || control.contains(hit));
	}

	function touchActionOf(canvasElement: HTMLElement, selector: string): string {
		const found = canvasElement.querySelector(selector);
		if (!(found instanceof HTMLElement)) {
			throw new Error(`no element for ${selector}`);
		}
		return getComputedStyle(found).touchAction;
	}

	/**
	 * What the size warning asked, recorded by the story that answers yes. Module
	 * scope rather than a spy arg, because the answer is given inside the
	 * template's own callback, which the play function cannot reach into.
	 */
	const sizePrompts: string[] = [];

	/** `text/csv`, eight bytes, so the row's size reads `8 B`. */
	function csvFile(name = 'measurements.csv'): File {
		return new File(['a,b\n1,2\n'], name, { type: 'text/csv' });
	}

	/** Three bytes of nothing in particular, declared `image/png`. */
	function pngFile(name = 'photo.png'): File {
		return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });
	}

	function uploadTo(canvasElement: HTMLElement, label: string, file: File): Promise<void> {
		const input = within(canvasElement).getByLabelText(label);
		if (!(input instanceof HTMLInputElement)) throw new Error(`no ${label} input`);
		return userEvent.upload(input, file);
	}

	/** The dimmed canvas behind the sheet: a click there is a click away. */
	function backdrop(canvasElement: HTMLElement): HTMLElement {
		const found = canvasElement.querySelector('[data-sheet-backdrop]');
		if (!(found instanceof HTMLElement)) throw new Error('no sheet backdrop');
		return found;
	}

	/** Type into the title the way a user would, so the sheet's draft updates. */
	function typeTitle(canvasElement: HTMLElement, value: string): void {
		const input = fieldOf(canvasElement, 'title');
		input.value = value;
		input.dispatchEvent(new Event('input', { bubbles: true }));
	}

	function harnessState(canvasElement: HTMLElement): HTMLElement {
		const found = canvasElement.querySelector('[data-edit-sheet-harness]');
		if (!(found instanceof HTMLElement)) throw new Error('no harness state element');
		return found;
	}

	function attachmentRows(canvasElement: HTMLElement): HTMLElement[] {
		return [...canvasElement.querySelectorAll('[data-attachment-kind]')].filter(
			(row): row is HTMLElement => row instanceof HTMLElement
		);
	}

	function cellText(row: HTMLElement, attribute: string): string {
		return row.querySelector(`[${attribute}]`)?.textContent?.trim() ?? '';
	}

	/** A node with one tag, so a tag parsed out of the title has something to join. */
	function taggedGraph(node: Partial<NodeData> = {}): MultigraphData {
		return makeGraph({
			nodes: [
				{
					id: 'node-1',
					title: 'Kinematics',
					description: 'Plain prose with no math.',
					tags: ['x'],
					...node
				}
			]
		});
	}

	/**
	 * Run `act` with `window.confirm` replaced by a counter, so a story can prove
	 * that removing an add-on asks nothing — undo is the safety net for that one,
	 * and a dialog in the way is the regression worth catching.
	 */
	async function countingConfirms(act: () => Promise<void> | void): Promise<number> {
		const original = window.confirm;
		let calls = 0;
		window.confirm = () => {
			calls += 1;
			return true;
		};
		try {
			await act();
		} finally {
			window.confirm = original;
		}
		return calls;
	}
</script>

<Story
	name="LetsBothScrollContainersPanVerticallyOnTouch"
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);

		// The sheet is taller than the viewport on a phone, so a blanket `none` here
		// meant the fields below the fold could not be reached by finger at all.
		expect(touchActionOf(canvasElement, '.node-edit-sheet')).toBe('pan-y');

		// The backdrop is not a scroll container and must still swallow the gesture
		// whole, or the canvas pans behind an open sheet.
		expect(touchActionOf(canvasElement, '.sheet-backdrop')).toBe('none');

		// The edges tab is its own nested scroll container and needs the rule too.
		canvas.getByRole('tab', { name: 'Edges' }).click();
		await settle();
		expect(touchActionOf(canvasElement, '.edges-tab')).toBe('pan-y');
	}}
/>

<Story
	name="ShowsNoPreviewForADraftWithoutMath"
	play={async ({ canvasElement }) => {
		expect(preview(canvasElement)).toBeNull();
	}}
/>

<Story
	name="ShowsThePreviewOnceTheDraftContainsMath"
	play={async ({ canvasElement }) => {
		expect(preview(canvasElement)).toBeNull();

		typeDescription(canvasElement, 'Velocity obeys $$v = v_0 + a t$$ over time.');
		await new Promise((resolve) => setTimeout(resolve, 0));

		const region = preview(canvasElement);
		expect(region?.querySelectorAll('[data-segment="display-math"] math')).toHaveLength(1);
	}}
/>

<Story
	name="HidesThePreviewAgainWhenTheMathIsRemoved"
	play={async ({ canvasElement }) => {
		typeDescription(canvasElement, 'Uses $x$ here.');
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(preview(canvasElement)).not.toBeNull();

		typeDescription(canvasElement, 'Uses nothing here.');
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(preview(canvasElement)).toBeNull();
	}}
/>

<Story
	name="ShowsAnErrorMarkerForInvalidLatexWithoutBlockingSave"
	play={async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		const draft = 'Broken $$\\frac{1}{$$ here.';

		typeDescription(canvasElement, draft);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(preview(canvasElement)?.querySelector('.temml-error')).toBeTruthy();

		canvas.getByRole('button', { name: 'Save' }).click();
		const saveSpy = args.onSave as unknown as SaveSpy;
		expect(saveSpy.mock.calls.at(-1)?.[0].description).toBe(draft);
	}}
/>

<Story
	name="SavesTheRawDescriptionTextRatherThanRenderedMath"
	play={async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		const draft = 'Velocity obeys $$v = v_0 + a t$$ and costs \\$5.';

		typeDescription(canvasElement, draft);
		await new Promise((resolve) => setTimeout(resolve, 0));

		canvas.getByRole('button', { name: 'Save' }).click();
		const saveSpy = args.onSave as unknown as SaveSpy;
		expect(saveSpy.mock.calls.at(-1)?.[0].description).toBe(draft);
	}}
/>

<Story
	name="TypingMathOffersItsQuantitiesAsSuggestions"
	play={async ({ canvasElement }) => {
		// Prose only: nothing to offer, and the sheet says so rather than showing
		// empty columns with no explanation.
		expect(canvasElement.querySelector('[data-designation-key]')).toBeNull();

		typeDescription(canvasElement, WEIGHT_EQUATION);
		await settle();

		// Every symbol the draft mentions, offered where it would land: what the
		// node states goes to the right, what it merely uses to the left.
		expect(roleOf(canvasElement, 'w')).toBe('suggestion');
		expect(roleOf(canvasElement, 'm')).toBe('suggestion');
		expect(roleOf(canvasElement, 'g')).toBe('suggestion');
		expect(
			canvasElement.querySelector('[aria-label="Output quantities"] [data-designation-key="w"]')
		).toBeInTheDocument();
		expect(
			canvasElement.querySelector('[aria-label="Input quantities"] [data-designation-key="g"]')
		).toBeInTheDocument();
	}}
/>

<Story
	name="TappingASuggestedOutputConfirmsItInOneTap"
	play={async ({ canvasElement }) => {
		typeDescription(canvasElement, WEIGHT_EQUATION);
		await settle();

		// One tap, in the column the ghost was already drawn in. Landing it in the
		// opposite column would contradict what the tap visibly pointed at.
		chip(canvasElement, 'w').click();
		await settle();
		expect(roleOf(canvasElement, 'w')).toBe('output');

		// A second tap is the correction for a wrong guess, and a third releases it
		// — so tapping the wrong chip costs at most two more taps.
		chip(canvasElement, 'w').click();
		await settle();
		expect(roleOf(canvasElement, 'w')).toBe('input');

		chip(canvasElement, 'w').click();
		await settle();
		expect(roleOf(canvasElement, 'w')).toBe('suggestion');
	}}
/>

<Story
	name="DeletingTheEquationLeavesAConfirmedQuantityFlaggedStale"
	play={async ({ canvasElement }) => {
		typeDescription(canvasElement, WEIGHT_EQUATION);
		await settle();
		chip(canvasElement, 'w').click();
		await settle();
		expect(chip(canvasElement, 'w')).not.toHaveAttribute('data-designation-stale');

		typeDescription(canvasElement, 'Weight, described in words.');
		await settle();

		// Still confirmed, still an output, still drawing whatever edge it drew.
		// The parser is a heuristic over prose, and silently dropping a designation
		// because a sentence was reworded is exactly the surprise this replaced.
		expect(roleOf(canvasElement, 'w')).toBe('output');
		expect(chip(canvasElement, 'w')).toHaveAttribute('data-designation-stale', 'true');
		// The symbols that were only ever suggestions leave with the text.
		expect(canvasElement.querySelector('[data-designation-key="g"]')).toBeNull();
	}}
/>

<Story
	name="SavesTheConfirmedQuantitiesAlongsideTheText"
	play={async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		typeDescription(canvasElement, WEIGHT_EQUATION);
		await settle();

		chip(canvasElement, 'w').click();
		await settle();
		chip(canvasElement, 'g').click();
		await settle();

		canvas.getByRole('button', { name: 'Save' }).click();

		// Structured pairs, not symbol keys: a key embeds a NUL to separate base
		// from subscript, which must never reach a save file.
		const saveSpy = args.onSave as unknown as SaveSpy;
		const saved = saveSpy.mock.calls.at(-1)?.[0];
		expect(saved?.description).toBe(WEIGHT_EQUATION);
		expect(saved?.outputs).toEqual([{ base: 'w', subscript: null }]);
		expect(saved?.inputs).toEqual([{ base: 'g', subscript: null }]);
	}}
/>

<Story
	name="HoldingAChipWritesItIntoTheFieldAtTheCaret"
	play={async ({ canvasElement }) => {
		typeDescription(canvasElement, 'Speed starts at $$v_0 = 3$$ here.');
		await settle();

		// The caret decides where, so put it where an author would.
		await caretAfter(canvasElement, 'title', 'Kinematics');
		await holdChip(subscriptedChip(canvasElement, 'v', '0'));

		// Prose, so the symbol brings its own delimiters — and the subscript is
		// braced, so extending it later stays one subscript rather than becoming
		// a different quantity.
		const field = fieldOf(canvasElement, 'title');
		expect(field.value).toBe('Kinematics$v_{0}$');
		// Focus stays where the writing happened, with the caret after it: the point
		// of the shortcut is to keep writing.
		expect(document.activeElement).toBe(field);
		expect(field.selectionStart).toBe('Kinematics$v_{0}$'.length);
		expect(statusText(canvasElement)).toBe('Wrote v_0 into the title.');
	}}
/>

<Story
	name="WritingInsideExistingMathAddsNoDelimiters"
	play={async ({ canvasElement }) => {
		typeDescription(canvasElement, 'Weight is $w = m$ and $g$ too.');
		await settle();

		await caretAfter(canvasElement, 'description', '$w = m');
		await holdChip(chip(canvasElement, 'g'));

		// Already inside math, so the symbol goes in bare — a nested `$` here would
		// close the segment early and break the equation around it.
		expect(fieldOf(canvasElement, 'description').value).toBe('Weight is $w = mg$ and $g$ too.');
	}}
/>

<Story
	name="WritingReplacesASelectedRangeAndSavesTheRawSource"
	play={async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		typeDescription(canvasElement, 'Weight is $w = XX$ here.');
		await settle();

		const start = fieldOf(canvasElement, 'description').value.indexOf('XX');
		await placeCaret(canvasElement, 'description', start, start + 2);
		await holdChip(chip(canvasElement, 'w'));

		expect(fieldOf(canvasElement, 'description').value).toBe('Weight is $w = w$ here.');

		canvas.getByRole('button', { name: 'Save' }).click();
		const saveSpy = args.onSave as unknown as SaveSpy;
		expect(saveSpy.mock.calls.at(-1)?.[0].description).toBe('Weight is $w = w$ here.');
	}}
/>

<Story
	name="TheTargetIsWhicheverFieldWasFocusedLast"
	play={async ({ canvasElement }) => {
		typeDescription(canvasElement, WEIGHT_EQUATION);
		await settle();

		// The sheet focuses the title on open, so a session that has touched neither
		// field still has a real target rather than a guess.
		await holdChip(chip(canvasElement, 'w'));
		expect(fieldOf(canvasElement, 'title').value).toBe('Kinematics$w$');

		// Touching the description moves the target with the cursor.
		await caretAfter(canvasElement, 'description', 'Weight is ');
		await holdChip(chip(canvasElement, 'g'));
		expect(fieldOf(canvasElement, 'description').value).toBe('Weight is $g$$$w = m g$$.');
		expect(fieldOf(canvasElement, 'title').value).toBe('Kinematics$w$');
	}}
/>

<Story
	name="RightClickWritesWithoutWaitingForAHold"
	play={async ({ canvasElement }) => {
		typeDescription(canvasElement, WEIGHT_EQUATION);
		await settle();
		await caretAfter(canvasElement, 'title', 'Kinematics');

		await rightClickChip(chip(canvasElement, 'm'));
		expect(fieldOf(canvasElement, 'title').value).toBe('Kinematics$m$');
	}}
/>

<Story
	name="ATapCyclesAndAHoldDoesNotAlsoCycle"
	play={async ({ canvasElement }) => {
		typeDescription(canvasElement, WEIGHT_EQUATION);
		await settle();
		await caretAfter(canvasElement, 'title', 'Kinematics');

		// Below the hold, the chip does exactly what it always did.
		await tapChip(chip(canvasElement, 'g'));
		expect(roleOf(canvasElement, 'g')).toBe('input');
		expect(fieldOf(canvasElement, 'title').value).toBe('Kinematics');

		// And a hold writes once, without the trailing click cycling underneath it.
		await holdChip(chip(canvasElement, 'm'));
		expect(fieldOf(canvasElement, 'title').value).toBe('Kinematics$m$');
		expect(roleOf(canvasElement, 'm')).toBe('input');
	}}
/>

<Story
	name="AHoldThatDriftsTooFarCancelsAndStillCycles"
	play={async ({ canvasElement }) => {
		typeDescription(canvasElement, WEIGHT_EQUATION);
		await settle();
		await caretAfter(canvasElement, 'title', 'Kinematics');

		// A finger that wandered was scrolling, not answering — so nothing is
		// written, and the click it ends with is an ordinary tap.
		await driftingHold(chip(canvasElement, 'g'));

		expect(fieldOf(canvasElement, 'title').value).toBe('Kinematics');
		expect(roleOf(canvasElement, 'g')).toBe('input');
	}}
/>

<Story
	name="ShiftEnterWritesWhilePlainEnterCycles"
	play={async ({ canvasElement }) => {
		typeDescription(canvasElement, WEIGHT_EQUATION);
		await settle();
		await caretAfter(canvasElement, 'title', 'Kinematics');

		await pressKey(chip(canvasElement, 'm'), 'Enter', true);
		expect(fieldOf(canvasElement, 'title').value).toBe('Kinematics$m$');
		// Shift+Enter must not also activate the button, or the chip writes and
		// cycles from one keystroke.
		expect(roleOf(canvasElement, 'm')).toBe('input');

		await pressKey(chip(canvasElement, 'g'), 'Enter');
		expect(roleOf(canvasElement, 'g')).toBe('input');
		expect(fieldOf(canvasElement, 'title').value).toBe('Kinematics$m$');
	}}
/>

<Story
	name="AFirstInsertionOnALeftHandSideConfirmsAnOutput"
	play={async ({ canvasElement }) => {
		typeDescription(canvasElement, HEADLESS_EQUATION);
		await settle();

		// The parser only sees a loose mention, so the ghost sits on the input side.
		expect(roleOf(canvasElement, 'v')).toBe('suggestion');
		expect(
			canvasElement.querySelector('[aria-label="Input quantities"] [data-designation-key="v"]')
		).toBeInTheDocument();

		// Writing it into the empty left-hand side makes the node define it.
		await caretAfter(canvasElement, 'description', 'Speed: $$');
		await holdChip(chip(canvasElement, 'v'));

		expect(fieldOf(canvasElement, 'description').value).toBe(
			'Speed: $$v = a t$$ and $v$ elsewhere.'
		);
		// The role follows the parser's new reading, not the one the ghost showed
		// before the insertion changed the equation.
		expect(roleOf(canvasElement, 'v')).toBe('output');
	}}
/>

<Story
	name="AFirstInsertionOnARightHandSideConfirmsAnInput"
	play={async ({ canvasElement }) => {
		typeDescription(canvasElement, BODYLESS_EQUATION);
		await settle();
		expect(roleOf(canvasElement, 'g')).toBe('suggestion');

		await caretAfter(canvasElement, 'description', 'Force: $$w = ');
		await holdChip(chip(canvasElement, 'g'));

		expect(fieldOf(canvasElement, 'description').value).toBe('Force: $$w = g$$ and $g$ here.');
		expect(roleOf(canvasElement, 'g')).toBe('input');
	}}
/>

<Story
	name="ASecondInsertionAfterAnAutomaticDecisionChangesTextOnly"
	play={async ({ canvasElement }) => {
		typeDescription(canvasElement, HEADLESS_EQUATION);
		await settle();

		await caretAfter(canvasElement, 'description', 'Speed: $$');
		await holdChip(chip(canvasElement, 'v'));
		expect(roleOf(canvasElement, 'v')).toBe('output');

		// One decision per symbol per opening. A later insertion is ordinary typing.
		await caretAfter(canvasElement, 'title', 'Kinematics');
		await holdChip(chip(canvasElement, 'v'));

		expect(fieldOf(canvasElement, 'title').value).toBe('Kinematics$v$');
		expect(roleOf(canvasElement, 'v')).toBe('output');
	}}
/>

<Story
	name="CyclingASymbolFirstStopsALaterInsertionOverridingIt"
	play={async ({ canvasElement }) => {
		typeDescription(canvasElement, HEADLESS_EQUATION);
		await settle();

		// The author says input, in the column the ghost was drawn in.
		await tapChip(chip(canvasElement, 'v'));
		expect(roleOf(canvasElement, 'v')).toBe('input');

		// Writing it into the left-hand side would otherwise read as a definition.
		await caretAfter(canvasElement, 'description', 'Speed: $$');
		await holdChip(chip(canvasElement, 'v'));

		expect(fieldOf(canvasElement, 'description').value).toBe(
			'Speed: $$v = a t$$ and $v$ elsewhere.'
		);
		// Still the author's answer. Inference never argues with a stated preference.
		expect(roleOf(canvasElement, 'v')).toBe('input');
	}}
/>

<Story
	name="AHoldWhoseClickWasLostDoesNotSwallowTheNextRightClick"
	play={async ({ canvasElement }) => {
		typeDescription(canvasElement, WEIGHT_EQUATION);
		await settle();
		await caretAfter(canvasElement, 'title', 'Kinematics');

		// The hold answers and arms the flag, then its click never lands.
		await holdChipLosingItsClick(chip(canvasElement, 'm'));
		expect(fieldOf(canvasElement, 'title').value).toBe('Kinematics$m$');

		// A leftover flag read as "a hold just answered" used to make the
		// right-click on every other chip silently do nothing.
		await rightClickChip(chip(canvasElement, 'g'));
		expect(fieldOf(canvasElement, 'title').value).toBe('Kinematics$m$$g$');
	}}
/>

<Story
	name="WritingAStaleSymbolBackMakesItCurrentWithoutMovingIt"
	args={{ node: STALE_NODE, nodes: [STALE_NODE] }}
	play={async ({ canvasElement }) => {
		// Confirmed as an output, but the text no longer says so.
		expect(roleOf(canvasElement, 'w')).toBe('output');
		expect(chip(canvasElement, 'w')).toHaveAttribute('data-designation-stale', 'true');

		// Written back on the right-hand side, where the parser reads it as a
		// mention — which for an undecided symbol would mean input.
		await caretAfter(canvasElement, 'description', 'Force is $x = ');
		await holdChip(chip(canvasElement, 'w'));

		expect(fieldOf(canvasElement, 'description').value).toBe('Force is $x = w$ here.');
		// Current again, because `stale` just means the parser could not find it.
		expect(chip(canvasElement, 'w')).not.toHaveAttribute('data-designation-stale');
		// And still an output: a confirmed designation is the author's, and moving
		// it would drop the dataflow edge they asked for.
		expect(roleOf(canvasElement, 'w')).toBe('output');
	}}
/>

<Story
	name="RepeatingAnInsertionAnnouncesItAgain"
	play={async ({ canvasElement }) => {
		typeDescription(canvasElement, WEIGHT_EQUATION);
		await settle();
		await caretAfter(canvasElement, 'title', 'Kinematics');

		const region = canvasElement.querySelector('[data-insert-status]');
		if (!(region instanceof HTMLElement)) throw new Error('no status region');

		// A live region speaks on change, not on assignment. Counting mutations is
		// the only way to tell "said twice" from "assigned the same sentence twice",
		// which is what the reader actually experiences.
		let mutations = 0;
		const observer = new MutationObserver(() => (mutations += 1));
		observer.observe(region, { childList: true, characterData: true, subtree: true });

		await holdChip(chip(canvasElement, 'm'));
		await settle();
		const afterFirst = mutations;
		expect(afterFirst).toBeGreaterThan(0);

		// The same symbol into the same field: the sentence is identical, so without
		// the clear-first the region would never change and the reader would hear
		// nothing the second time.
		await holdChip(chip(canvasElement, 'm'));
		await settle();
		observer.disconnect();

		expect(mutations).toBeGreaterThan(afterFirst);
		expect(fieldOf(canvasElement, 'title').value).toBe('Kinematics$m$$m$');
		expect(statusText(canvasElement)).toBe('Wrote m into the title.');
	}}
/>

<Story
	name="UserAttachesACsvThroughAddFile"
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		expect(canvas.getByRole('heading', { name: 'Attachments' })).toBeInTheDocument();
		expect(canvas.getByText('No attachments.')).toBeInTheDocument();

		await uploadTo(canvasElement, 'Add file', csvFile());

		await waitFor(() => expect(attachmentRows(canvasElement)).toHaveLength(1));
		const [row] = attachmentRows(canvasElement);
		expect(row).toHaveAttribute('data-attachment-kind', 'file');
		expect(cellText(row, 'data-attachment-name')).toBe('measurements.csv');
		expect(cellText(row, 'data-attachment-type')).toBe('text/csv');
		expect(cellText(row, 'data-attachment-size')).toBe('8 B');
		// A file is opened, not rendered, so there is nothing for alt text to say.
		expect(within(row).queryByLabelText('Alt text')).not.toBeInTheDocument();
		expect(within(row).getByLabelText('Caption')).toBeInTheDocument();
		expect(harnessState(canvasElement)).toHaveAttribute('data-last-intent', 'add file');
	}}
>
	{#snippet template()}
		<NodeEditSheetHarness baseGraph={taggedGraph()} nodeId="node-1" />
	{/snippet}
</Story>

<Story
	name="UserAttachesAPngThroughAddImage"
	play={async ({ canvasElement }) => {
		await uploadTo(canvasElement, 'Add image', pngFile());

		await waitFor(() => expect(attachmentRows(canvasElement)).toHaveLength(1));
		const [row] = attachmentRows(canvasElement);
		expect(row).toHaveAttribute('data-attachment-kind', 'image');
		expect(cellText(row, 'data-attachment-name')).toBe('photo.png');
		expect(cellText(row, 'data-attachment-type')).toBe('image/png');
		// Alt starts as the filename, the way it did before files existed here.
		expect(within(row).getByLabelText('Alt text')).toHaveValue('photo.png');
		expect(harnessState(canvasElement)).toHaveAttribute('data-last-intent', 'add image');
	}}
>
	{#snippet template()}
		<NodeEditSheetHarness baseGraph={taggedGraph()} nodeId="node-1" />
	{/snippet}
</Story>

<Story
	name="APngPickedThroughAddFileIsStillAnImage"
	play={async ({ canvasElement }) => {
		// The type decides, not the button: Add image exists for its `image/*`
		// filter, which is what makes a phone offer the camera.
		await uploadTo(canvasElement, 'Add file', pngFile('camera.png'));

		await waitFor(() => expect(attachmentRows(canvasElement)).toHaveLength(1));
		const [row] = attachmentRows(canvasElement);
		expect(row).toHaveAttribute('data-attachment-kind', 'image');
		expect(within(row).getByLabelText('Alt text')).toHaveValue('camera.png');
		expect(harnessState(canvasElement)).toHaveAttribute('data-last-intent', 'add image');
	}}
>
	{#snippet template()}
		<NodeEditSheetHarness baseGraph={taggedGraph()} nodeId="node-1" />
	{/snippet}
</Story>

<Story
	name="ReorderMovesTheBlockWithinTheWholeContentList"
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await uploadTo(canvasElement, 'Add file', csvFile());
		await waitFor(() => expect(attachmentRows(canvasElement)).toHaveLength(1));
		await uploadTo(canvasElement, 'Add image', pngFile());
		await waitFor(() => expect(attachmentRows(canvasElement)).toHaveLength(2));

		// The image is second in `content`. Counting only images would call it
		// index 0 and move nothing — the reason both kinds share one list.
		canvas.getByRole('button', { name: 'Move photo.png earlier' }).click();

		await waitFor(() =>
			expect(
				attachmentRows(canvasElement).map((row) => cellText(row, 'data-attachment-name'))
			).toEqual(['photo.png', 'measurements.csv'])
		);
		expect(harnessState(canvasElement)).toHaveAttribute('data-last-intent', 'move attachment');
	}}
>
	{#snippet template()}
		<NodeEditSheetHarness baseGraph={taggedGraph()} nodeId="node-1" />
	{/snippet}
</Story>

<Story
	name="UserTogglesTheTaskAddOnOn"
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const toggle = canvas.getByRole('checkbox', { name: 'Task' });
		expect(toggle).not.toBeChecked();

		toggle.click();

		await waitFor(() =>
			expect(harnessState(canvasElement)).toHaveAttribute('data-node-addons', 'task')
		);
		// Applied on the spot, like Pin — an add-on is a capability, not a draft.
		expect(harnessState(canvasElement)).toHaveAttribute('data-last-intent', 'add task add-on');
		expect(canvas.getByRole('checkbox', { name: 'Task' })).toBeChecked();
	}}
>
	{#snippet template()}
		<NodeEditSheetHarness baseGraph={taggedGraph()} nodeId="node-1" />
	{/snippet}
</Story>

<Story
	name="UserTogglesADoneTaskOffWithoutADialog"
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const toggle = canvas.getByRole('checkbox', { name: 'Task' });
		expect(toggle).toBeChecked();

		const confirms = await countingConfirms(async () => {
			toggle.click();
			await waitFor(() =>
				expect(harnessState(canvasElement)).toHaveAttribute('data-node-addons', '')
			);
		});

		// No confirm even though the task was done and its data goes with it:
		// milestone 12's undo is the safety net, and the label says what to undo.
		expect(confirms).toBe(0);
		expect(harnessState(canvasElement)).toHaveAttribute('data-last-intent', 'remove task add-on');
		expect(canvas.getByRole('checkbox', { name: 'Task' })).not.toBeChecked();
	}}
>
	{#snippet template()}
		<NodeEditSheetHarness
			baseGraph={taggedGraph({ addons: { task: { done: true, doneAt: 1_700_000_000_000 } } })}
			nodeId="node-1"
		/>
	{/snippet}
</Story>

<Story
	name="UserTypesTitleMarkersAndSaves"
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const title = fieldOf(canvasElement, 'title');
		title.value = '#lab !task Buy filters';
		title.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();

		canvas.getByRole('button', { name: 'Save' }).click();

		await waitFor(() =>
			expect(harnessState(canvasElement)).toHaveAttribute('data-node-title', 'Buy filters')
		);
		// Additive: the tag the title named joins the ones already listed.
		expect(harnessState(canvasElement)).toHaveAttribute('data-node-tags', 'x lab');
		expect(harnessState(canvasElement)).toHaveAttribute('data-node-addons', 'task');
	}}
>
	{#snippet template()}
		<NodeEditSheetHarness baseGraph={taggedGraph()} nodeId="node-1" />
	{/snippet}
</Story>

<Story
	name="ATitleKeepsAnEdgeTagAndADirectionPrefixAsTyped"
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const title = fieldOf(canvasElement, 'title');
		title.value = '> @bench Buy filters';
		title.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();

		canvas.getByRole('button', { name: 'Save' }).click();

		// The sheet edits a node that already exists, with no edge created beside
		// it, so neither marker names anything here and both stay as typed.
		await waitFor(() =>
			expect(harnessState(canvasElement)).toHaveAttribute('data-node-title', '> @bench Buy filters')
		);
		expect(harnessState(canvasElement)).toHaveAttribute('data-node-tags', 'x');
	}}
>
	{#snippet template()}
		<NodeEditSheetHarness baseGraph={taggedGraph()} nodeId="node-1" />
	{/snippet}
</Story>

<Story
	name="DecliningTheSizeWarningAttachesNothing"
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);

		await uploadTo(canvasElement, 'Add file', csvFile('huge.csv'));

		await waitFor(() => expect(canvas.getByText('Attachment cancelled.')).toBeInTheDocument());
		expect(attachmentRows(canvasElement)).toHaveLength(0);
		expect(canvas.getByText('No attachments.')).toBeInTheDocument();
		// Nothing was committed, so the harness never saw an intent.
		expect(harnessState(canvasElement)).toHaveAttribute('data-last-intent', '');
	}}
>
	{#snippet template()}
		<NodeEditSheetHarness
			baseGraph={taggedGraph()}
			nodeId="node-1"
			warnBytesPerFile={4}
			confirmAttachment={() => false}
		/>
	{/snippet}
</Story>

<Story
	name="AcceptingTheSizeWarningAttachesTheFile"
	play={async ({ canvasElement }) => {
		sizePrompts.length = 0;

		await uploadTo(canvasElement, 'Add file', csvFile('huge.csv'));

		await waitFor(() => expect(attachmentRows(canvasElement)).toHaveLength(1));
		expect(sizePrompts).toHaveLength(1);
		// The question names the file and what attaching it costs every saved copy.
		expect(sizePrompts[0]).toContain('huge.csv');
		expect(sizePrompts[0]).toContain('adds about 11 B to every saved copy');
	}}
>
	{#snippet template()}
		<NodeEditSheetHarness
			baseGraph={taggedGraph()}
			nodeId="node-1"
			warnBytesPerFile={4}
			confirmAttachment={(message) => {
				sizePrompts.push(message);
				return true;
			}}
		/>
	{/snippet}
</Story>

<Story
	name="UserGivesANodeWithNoWeightAWeight"
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		expect(weightInput(canvasElement)).toHaveValue(null);
		expect(harnessState(canvasElement)).toHaveAttribute('data-node-weight', 'absent');

		typeWeight(canvasElement, '5');
		await settle();
		canvas.getByRole('button', { name: 'Save' }).click();

		// Through the same commit as the title and tags, so one undo takes it back.
		await waitFor(() =>
			expect(harnessState(canvasElement)).toHaveAttribute('data-node-weight', '5')
		);
		expect(harnessState(canvasElement)).toHaveAttribute('data-last-intent', 'edit node');
	}}
>
	{#snippet template()}
		<NodeEditSheetHarness baseGraph={taggedGraph()} nodeId="node-1" />
	{/snippet}
</Story>

<Story
	name="ClearingTheWeightFieldRemovesTheWeight"
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		expect(weightInput(canvasElement)).toHaveValue(3);

		typeWeight(canvasElement, '');
		await settle();
		canvas.getByRole('button', { name: 'Save' }).click();

		// Blank means "no weight": the key is gone, not kept as 0 or undefined.
		await waitFor(() =>
			expect(harnessState(canvasElement)).toHaveAttribute('data-node-weight', 'absent')
		);
	}}
>
	{#snippet template()}
		<NodeEditSheetHarness baseGraph={taggedGraph({ weight: 3 })} nodeId="node-1" />
	{/snippet}
</Story>

<Story
	name="ANegativeWeightIsSavedAsZero"
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);

		typeWeight(canvasElement, '-2');
		await settle();
		canvas.getByRole('button', { name: 'Save' }).click();

		// Clamped to the floor load enforces, and 0 is a real weight, not "none".
		await waitFor(() =>
			expect(harnessState(canvasElement)).toHaveAttribute('data-node-weight', '0')
		);
	}}
>
	{#snippet template()}
		<NodeEditSheetHarness baseGraph={taggedGraph({ weight: 3 })} nodeId="node-1" />
	{/snippet}
</Story>

<Story
	name="TheWeightFieldUsesTheGraphsLabelAndUnit"
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);

		// The graph's label alone names the field; the unit sits beside it and is
		// read out with the hint.
		const field = canvas.getByLabelText('Mass');
		expect(field).toBe(weightInput(canvasElement));
		expect(field).toHaveValue(12.5);
		expect(canvasElement.querySelector('[data-weight-unit]')?.textContent).toBe('kg');
		expect(field).toHaveAccessibleDescription(
			"kg Drawn as border thickness when the graph's border source is Node weight."
		);
		expect(canvas.queryByLabelText('Weight')).not.toBeInTheDocument();
	}}
>
	{#snippet template()}
		<NodeEditSheetHarness
			baseGraph={{
				...taggedGraph({ weight: 12.5 }),
				weightConfig: { label: 'Mass', unit: 'kg' }
			}}
			nodeId="node-1"
		/>
	{/snippet}
</Story>

<Story
	name="TheWeightFieldReadsWeightWhenTheGraphNamesNothing"
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const field = canvas.getByLabelText('Weight');

		expect(field).toBe(weightInput(canvasElement));
		expect(field).toHaveAttribute('type', 'number');
		expect(field).toHaveAttribute('min', '0');
		expect(field).toHaveAttribute('step', 'any');
		expect(field).toHaveAttribute('inputmode', 'decimal');
		expect(canvasElement.querySelector('[data-weight-unit]')).toBeNull();
		expect(field).toHaveAccessibleDescription(
			"Drawn as border thickness when the graph's border source is Node weight."
		);
	}}
/>

<Story
	name="SaveCarriesTheTypedWeight"
	play={async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);

		typeWeight(canvasElement, '5');
		await settle();
		canvas.getByRole('button', { name: 'Save' }).click();

		const saveSpy = args.onSave as unknown as SaveSpy;
		expect(saveSpy.mock.calls.at(-1)?.[0].weight).toBe(5);
	}}
/>

<Story
	name="EscapeInTheWeightFieldCancelsWithoutSaving"
	play={async ({ canvasElement, args }) => {
		const field = weightInput(canvasElement);
		typeWeight(canvasElement, '9');
		await settle();

		field.focus();
		await userEvent.keyboard('{Escape}');

		// The sheet's one Escape handler, reached from this field like any other.
		expect(args.onCancel).toHaveBeenCalled();
		expect(args.onSave).not.toHaveBeenCalled();
	}}
/>

<Story
	name="ClickingAwaySavesTheTypedTitleDescriptionAndWeight"
	play={async ({ canvasElement }) => {
		typeTitle(canvasElement, 'Dynamics');
		typeDescription(canvasElement, 'Forces, not just motion.');
		typeWeight(canvasElement, '7');
		await settle();

		backdrop(canvasElement).click();

		// Save's own commit, so one undo takes all three back together.
		await waitFor(() =>
			expect(harnessState(canvasElement)).toHaveAttribute('data-node-title', 'Dynamics')
		);
		expect(harnessState(canvasElement)).toHaveAttribute(
			'data-node-description',
			'Forces, not just motion.'
		);
		expect(harnessState(canvasElement)).toHaveAttribute('data-node-weight', '7');
		expect(harnessState(canvasElement)).toHaveAttribute('data-last-intent', 'edit node');
	}}
>
	{#snippet template()}
		<NodeEditSheetHarness baseGraph={taggedGraph({ weight: 3 })} nodeId="node-1" />
	{/snippet}
</Story>

<Story
	name="ClickingAwaySavesExactlyWhatSaveWould"
	play={async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		const saveSpy = args.onSave as unknown as SaveSpy;
		typeTitle(canvasElement, '   ');
		typeWeight(canvasElement, '-2');
		await settle();

		canvas.getByRole('button', { name: 'Save' }).click();
		const fromSave = saveSpy.mock.calls.at(-1)?.[0];
		backdrop(canvasElement).click();
		const fromClickAway = saveSpy.mock.calls.at(-1)?.[0];

		// Save's rules, not a stricter set: a blank title becomes the fallback
		// title rather than blocking the click away, and a negative weight clamps.
		expect(saveSpy.mock.calls).toHaveLength(2);
		expect(fromClickAway).toEqual(fromSave);
		expect(fromClickAway?.title).toBe('New Node');
		expect(fromClickAway?.weight).toBe(0);
		expect(args.onCancel).not.toHaveBeenCalled();
	}}
/>

<Story
	name="ClickingAwayFromAnUntouchedSheetCommitsNothing"
	play={async ({ canvasElement, args }) => {
		await settle();
		backdrop(canvasElement).click();

		// Nothing was edited, so nothing is saved: the sheet just closes, and the
		// canvas never commits a copy of the node for the undo list to drop.
		expect(args.onSave).not.toHaveBeenCalled();
		expect(args.onCancel).toHaveBeenCalledTimes(1);
	}}
/>

<Story
	name="ClickingAwayAfterTypingBackTheSavedTitleCommitsNothing"
	play={async ({ canvasElement, args }) => {
		typeTitle(canvasElement, 'Kinematics!');
		await settle();
		typeTitle(canvasElement, '  Kinematics ');
		await settle();

		backdrop(canvasElement).click();

		// Judged on what the save would store, so an edit undone by hand (and the
		// whitespace the save trims) is still no edit.
		expect(args.onSave).not.toHaveBeenCalled();
		expect(args.onCancel).toHaveBeenCalledTimes(1);
	}}
/>

<Story
	name="EscapeStillCancelsATypedDraft"
	play={async ({ canvasElement, args }) => {
		const title = fieldOf(canvasElement, 'title');
		typeTitle(canvasElement, 'Dynamics');
		typeDescription(canvasElement, 'Forces, not just motion.');
		await settle();

		title.focus();
		await userEvent.keyboard('{Escape}');

		// Clicking away saves; Escape is the deliberate way out without saving.
		expect(args.onCancel).toHaveBeenCalledTimes(1);
		expect(args.onSave).not.toHaveBeenCalled();
	}}
/>

<Story
	name="CloseAndCancelStillDiscardATypedDraft"
	play={async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		typeTitle(canvasElement, 'Dynamics');
		await settle();

		canvas.getByRole('button', { name: 'Close' }).click();
		canvas.getByRole('button', { name: 'Cancel' }).click();

		expect(args.onCancel).toHaveBeenCalledTimes(2);
		expect(args.onSave).not.toHaveBeenCalled();
	}}
/>

<Story
	name="KeepsALongSheetBelowTheToolbarAndScrollsInside"
	parameters={SHORT_PHONE_PARAMETERS}
	play={async ({ canvasElement }) => {
		expect(window.innerWidth).toBe(375);
		expect(window.innerHeight).toBe(600);

		// The toolbar publishes its measured clearance; nothing here guesses it.
		const toolbar = elementIn(canvasElement, '.toolbar-row');
		await waitFor(() =>
			expect(document.documentElement.style.getPropertyValue(TOOLBAR_CLEARANCE_PROPERTY)).toBe(
				`${toolbarClearancePx(toolbar.getBoundingClientRect())}px`
			)
		);
		await waitFor(() => expect(attachmentRows(canvasElement)).toHaveLength(ATTACHMENT_COUNT));

		// The sheet stops below the toolbar's real box and scrolls inside itself.
		const sheet = elementIn(canvasElement, '.node-edit-sheet');
		expect(sheet.getBoundingClientRect().top).toBeGreaterThanOrEqual(
			toolbar.getBoundingClientRect().bottom
		);
		expect(sheet.scrollHeight).toBeGreaterThan(sheet.clientHeight);

		// Halfway down the attachment list, the header is still pinned at the top
		// and Save at the bottom, both under a finger.
		sheet.scrollTop = sheet.scrollHeight / 2;
		const header = elementIn(sheet, 'header');
		expect(header.getBoundingClientRect().top).toBeCloseTo(sheet.getBoundingClientRect().top, 0);
		// Scoped to the sheet: the toolbar above has a Save of its own.
		const inSheet = within(sheet);
		const save = inSheet.getByRole('button', { name: 'Save' });
		expect(hittable(inSheet.getByRole('button', { name: 'Close' }))).toBe(true);
		expect(hittable(save)).toBe(true);
		expect(save.getBoundingClientRect().bottom).toBeLessThanOrEqual(
			sheet.getBoundingClientRect().bottom
		);
	}}
>
	{#snippet template()}
		<ToolbarClearanceStage>
			<NodeEditSheetHarness baseGraph={graphWithManyAttachments()} nodeId="node-1" />
		</ToolbarClearanceStage>
	{/snippet}
</Story>
