<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, within } from 'storybook/test';
	import NodeEditSheet from './NodeEditSheet.svelte';
	import type { NodeData, QuantityDesignation } from '../types/node';

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
					}
				]
			>;
		};
	};

	/** `$$w = m g$$`: one definition and two mentions, all with plain one-letter keys. */
	const WEIGHT_EQUATION = 'Weight is $$w = m g$$.';

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

	/**
	 * `touch-action` decides what the browser's own gesture handling does, which a
	 * synthetic PointerEvent sequence cannot exercise — dispatched events scroll
	 * nothing, and `scrollTop = n` works whatever the rule says. The computed value
	 * is the assertion that actually means something here.
	 */
	function touchActionOf(canvasElement: HTMLElement, selector: string): string {
		const found = canvasElement.querySelector(selector);
		if (!(found instanceof HTMLElement)) {
			throw new Error(`no element for ${selector}`);
		}
		return getComputedStyle(found).touchAction;
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
