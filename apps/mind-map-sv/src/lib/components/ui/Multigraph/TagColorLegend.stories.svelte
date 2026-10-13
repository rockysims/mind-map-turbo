<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { flushSync, mount, unmount } from 'svelte';
	import { expect, fn, waitFor, within } from 'storybook/test';
	import { APP_CONFIG } from '$lib/appConfig';
	import TagColorLegend from './TagColorLegend.svelte';
	import ToolbarClearanceStage from './ToolbarClearanceStage.svelte';
	import { dialogOpacityStorageKey } from './lib/dialogOpacity';
	import {
		TOOLBAR_CLEARANCE_PROPERTY,
		toolbarClearancePx
	} from '../GraphToolbar/lib/toolbarClearance';
	import type { LegendTag } from './lib/tagColors';
	import type { TagColorNamespace } from '../types/multigraph';

	const TAGS: LegendTag[] = [
		{
			namespace: 'nodeTags',
			tag: 'topic',
			color: '#ff0000',
			usageCount: 2,
			hasExplicitColor: true,
			physicsFactor: 1
		},
		{
			namespace: 'nodeTags',
			tag: 'fallback',
			color: '#00ff00',
			usageCount: 1,
			hasExplicitColor: false,
			physicsFactor: 1
		},
		{
			namespace: 'edgeTags',
			tag: 'rel',
			color: '#0000ff',
			usageCount: 1,
			hasExplicitColor: true,
			physicsFactor: 1
		}
	];

	const { Story } = defineMeta({
		title: 'Components/Multigraph/TagColorLegend',
		component: TagColorLegend,
		tags: [],
		args: {
			tags: TAGS,
			onColorChange: fn(),
			onPhysicsChange: fn(),
			onDelete: fn(),
			onClose: fn()
		}
	});

	/** Both slider rows sitting at ×1.4, the factor the plan's readout examples use. */
	const TUNED_TAGS: LegendTag[] = TAGS.map((tag) =>
		tag.tag === 'fallback' ? tag : { ...tag, physicsFactor: 1.4 }
	);

	/** Just under the 420px breakpoint where each row stacks into a column. */
	const NARROW_VIEWPORT = 'narrow';

	type LegendSpy = {
		mock: { calls: Array<[TagColorNamespace, string, string, 'scrub' | 'commit']> };
	};

	type PhysicsSpy = {
		mock: { calls: Array<[TagColorNamespace, string, number, 'scrub' | 'commit']> };
	};

	type DeleteSpy = {
		mock: { calls: Array<[TagColorNamespace, string]> };
	};

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

	/** Move a range input the way a drag does: a value, then the frame's `input`. */
	function scrubSlider(slider: HTMLInputElement, position: number): void {
		slider.value = String(position);
		slider.dispatchEvent(new Event('input', { bubbles: true }));
	}

	function sliderNamed(canvasElement: HTMLElement, name: string): HTMLInputElement {
		const found = within(canvasElement).getByLabelText(name);
		if (!(found instanceof HTMLInputElement)) throw new Error(`no input labelled ${name}`);
		return found;
	}

	/** The row a control sits in, for comparing where its siblings were laid out. */
	function rowOf(control: HTMLElement): HTMLElement {
		const row = control.closest('li');
		if (!(row instanceof HTMLElement)) throw new Error('control is not in a legend row');
		return row;
	}

	/** True when two boxes share no horizontal band — one sits wholly above the other. */
	function onSeparateLines(first: DOMRect, second: DOMRect): boolean {
		return first.bottom <= second.top || second.bottom <= first.top;
	}

	/** The slider's own box is its hit area; the checklist floor is 44px. */
	const TOUCH_TARGET_PX = 44;

	/** A short phone: the toolbar wraps to its full height and the list overflows. */
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

	/** More node tags than a phone's sheet can show at once. */
	const TALL_TAGS: LegendTag[] = [
		...Array.from(
			{ length: 24 },
			(_, index): LegendTag => ({
				namespace: 'nodeTags',
				tag: `topic-${index + 1}`,
				color: '#ff0000',
				usageCount: 1,
				hasExplicitColor: true,
				physicsFactor: 1
			})
		),
		...TAGS.filter((tag) => tag.namespace === 'edgeTags')
	];

	/** Where the reader's opacity choice lives; stories clear it before and after. */
	const OPACITY_KEY = dialogOpacityStorageKey(APP_CONFIG.persistence.storageNamespace);

	function clearSavedOpacity(): void {
		localStorage.removeItem(OPACITY_KEY);
	}

	function elementOf(root: ParentNode, selector: string): HTMLElement {
		const found = root.querySelector(selector);
		if (!(found instanceof HTMLElement)) throw new Error(`no element for ${selector}`);
		return found;
	}

	function opacityOf(element: Element): string {
		return getComputedStyle(element).opacity;
	}

	function opacitySlider(root: HTMLElement): HTMLInputElement {
		const found = within(root).getByRole('slider', { name: 'Dialog opacity' });
		if (!(found instanceof HTMLInputElement)) throw new Error('no dialog opacity slider');
		return found;
	}

	/** A drag that ends on `value`: the frame's `input`, then the release's `change`. */
	function dragTo(slider: HTMLInputElement, value: number): void {
		slider.value = String(value);
		slider.dispatchEvent(new Event('input', { bubbles: true }));
		slider.dispatchEvent(new Event('change', { bubbles: true }));
	}

	/**
	 * True when nothing between `element` and the layer fades it: CSS opacity
	 * multiplies down the tree, so every ancestor must be at 1 for the element to
	 * be drawn at 1.
	 */
	function drawnFullyOpaque(element: HTMLElement): boolean {
		for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
			if (opacityOf(node) !== '1') return false;
			if (node.classList.contains('legend-layer')) return true;
		}
		return false;
	}

	/** The topmost element at a control's centre is the control (or inside it). */
	function hittable(control: HTMLElement): boolean {
		const box = control.getBoundingClientRect();
		const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
		return hit !== null && (hit === control || control.contains(hit));
	}

	function physicsControlOf(slider: HTMLInputElement): HTMLElement {
		const control = slider.closest('.physics-control');
		if (!(control instanceof HTMLElement)) throw new Error('slider has no physics control');
		return control;
	}

	function hover(element: HTMLElement): void {
		element.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
	}

	function unhover(element: HTMLElement): void {
		element.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
	}
</script>

<Story
	name="ListsNodeAndEdgeTags"
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);

		// Retitled from "Tag colors" once the rows gained layout sliders: the
		// heading names the dialog, so it says what the dialog is about now.
		expect(canvas.getByRole('dialog', { name: 'Tags' })).toBeInTheDocument();
		expect(canvas.queryByText('Graph tags')).not.toBeInTheDocument();
		expect(canvas.getByRole('button', { name: 'Close tags' })).toBeInTheDocument();
		expect(canvas.getByRole('heading', { name: 'Node tags' })).toBeInTheDocument();
		expect(canvas.getByRole('heading', { name: 'Edge tags' })).toBeInTheDocument();
		expect(canvas.getByText('topic')).toBeInTheDocument();
		expect(canvas.getByText('fallback')).toBeInTheDocument();
		expect(canvas.getByText('rel')).toBeInTheDocument();
		expect(canvas.getByText('2 uses · configured')).toBeInTheDocument();
		expect(canvas.getByText('1 use · fallback')).toBeInTheDocument();
	}}
/>

<Story
	name="EmitsColorChangesAndDeletes"
	args={{
		tags: TAGS,
		onColorChange: fn(),
		onDelete: fn(),
		onClose: fn()
	}}
	play={async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		const colorSpy = args.onColorChange as unknown as LegendSpy;
		const deleteSpy = args.onDelete as unknown as DeleteSpy;

		const input = canvas.getByLabelText('Color for node tag topic') as HTMLInputElement;
		input.value = '#123456';
		input.dispatchEvent(new Event('input', { bubbles: true }));

		// A scrub frame: the canvas previews it, and the history folds the run it
		// belongs to into one entry.
		expect(colorSpy.mock.calls.at(-1)).toEqual(['nodeTags', 'topic', '#123456', 'scrub']);

		input.dispatchEvent(new Event('change', { bubbles: true }));

		// Closing the picker ends the run, so a later scrub of this tag is its own
		// undo rather than joining this one.
		expect(colorSpy.mock.calls.at(-1)).toEqual(['nodeTags', 'topic', '#123456', 'commit']);

		canvas.getByRole('button', { name: 'Delete edge tag rel' }).click();
		expect(deleteSpy.mock.calls.at(-1)).toEqual(['edgeTags', 'rel']);
	}}
/>

<Story
	name="LetsAFingerScrollTheTagListWhileTheBackdropSwallowsTheGesture"
	play={async ({ canvasElement }) => {
		// The legend is a scroll container, and a graph with more tags than fit puts
		// its last rows below the fold — a blanket `none` here meant no finger could
		// ever reach them.
		expect(touchActionOf(canvasElement, '.tag-color-legend')).toBe('pan-y');

		// The backdrop scrolls nothing and must still swallow the gesture whole, or
		// the canvas pans behind an open legend.
		expect(touchActionOf(canvasElement, '.legend-backdrop')).toBe('none');
	}}
/>

<Story
	name="EmitsEdgeLengthAndNodeSpacingScrubsThenCommits"
	args={{
		tags: TAGS,
		onColorChange: fn(),
		onPhysicsChange: fn(),
		onDelete: fn(),
		onClose: fn()
	}}
	play={async ({ canvasElement, args }) => {
		const physicsSpy = args.onPhysicsChange as unknown as PhysicsSpy;

		// The track is log2 of the factor, so one notch of position is a doubling.
		const edgeSlider = sliderNamed(canvasElement, 'Edge length for edge tag rel');
		scrubSlider(edgeSlider, 1);
		expect(physicsSpy.mock.calls.at(-1)).toEqual(['edgeTags', 'rel', 2, 'scrub']);

		// Letting go repeats the value and says the drag is over, which is what
		// ends the one undo entry the whole drag folds into.
		edgeSlider.dispatchEvent(new Event('change', { bubbles: true }));
		expect(physicsSpy.mock.calls.at(-1)).toEqual(['edgeTags', 'rel', 2, 'commit']);

		const nodeSlider = sliderNamed(canvasElement, 'Node spacing for node tag topic');
		scrubSlider(nodeSlider, 1);
		expect(physicsSpy.mock.calls.at(-1)).toEqual(['nodeTags', 'topic', 2, 'scrub']);
		nodeSlider.dispatchEvent(new Event('change', { bubbles: true }));
		expect(physicsSpy.mock.calls.at(-1)).toEqual(['nodeTags', 'topic', 2, 'commit']);

		// The ends are ×1 (the default, at the left) and ×8; each notch between is
		// a doubling, not a third of the track.
		scrubSlider(nodeSlider, 0);
		expect(physicsSpy.mock.calls.at(-1)).toEqual(['nodeTags', 'topic', 1, 'scrub']);
		scrubSlider(nodeSlider, 1);
		expect(physicsSpy.mock.calls.at(-1)).toEqual(['nodeTags', 'topic', 2, 'scrub']);
		scrubSlider(nodeSlider, 3);
		expect(physicsSpy.mock.calls.at(-1)).toEqual(['nodeTags', 'topic', 8, 'scrub']);
	}}
/>

<Story
	name="ShowsAStoredFactorOnItsSliderAndReadout"
	args={{ tags: TUNED_TAGS }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const edgeSlider = sliderNamed(canvasElement, 'Edge length for edge tag rel');
		const nodeSlider = sliderNamed(canvasElement, 'Node spacing for node tag topic');

		// log2(1.4) ≈ 0.485, snapped to the 0.05 step.
		expect(edgeSlider.value).toBe('0.5');
		expect(nodeSlider.value).toBe('0.5');

		// A screen reader hears the factor, not the log position.
		expect(edgeSlider).toHaveAttribute('aria-valuetext', '×1.4');
		expect(nodeSlider).toHaveAttribute('aria-valuetext', '×1.4');

		// The visible word says what the factor scales.
		expect(rowOf(edgeSlider)).toHaveTextContent('length ×1.4');
		expect(rowOf(nodeSlider)).toHaveTextContent('spacing ×1.4');

		// An untuned tag sits at the left end, ×1, and reads ×1.0.
		const untuned = sliderNamed(canvasElement, 'Node spacing for node tag fallback');
		expect(untuned.value).toBe('0');
		expect(rowOf(untuned)).toHaveTextContent('spacing ×1.0');

		// The readout is a visual copy of `aria-valuetext`, kept out of the slider's
		// name so the name stays what the control is, not what it is set to.
		expect(canvas.getByRole('slider', { name: 'Edge length for edge tag rel' })).toBe(edgeSlider);

		// A full-width dialog keeps every control of a row on one line, and the
		// slider still clears the touch-target floor.
		const colorInput = canvas.getByLabelText('Color for edge tag rel');
		const sliderBox = edgeSlider.getBoundingClientRect();
		const colorBox = colorInput.getBoundingClientRect();
		expect(onSeparateLines(sliderBox, colorBox)).toBe(false);
		expect(sliderBox.height).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);

		// The readout sits under the track, not beside it: beside it, it pushed
		// the delete button onto a second line.
		const readout = rowOf(edgeSlider).querySelector('.physics-readout');
		if (!(readout instanceof HTMLElement)) throw new Error('row has no readout');
		const readoutBox = readout.getBoundingClientRect();
		expect(readoutBox.top).toBeGreaterThan(sliderBox.top + sliderBox.height / 2);
		expect(readoutBox.left).toBeGreaterThanOrEqual(sliderBox.left - 1);
		expect(readoutBox.right).toBeLessThanOrEqual(sliderBox.right + 1);

		// So delete shares the colour input's line, as an icon with a full-size
		// target and its name intact for anyone reading by name.
		const deleteButton = canvas.getByRole('button', { name: 'Delete edge tag rel' });
		const deleteBox = deleteButton.getBoundingClientRect();
		expect(onSeparateLines(deleteBox, colorBox)).toBe(false);
		expect(deleteButton).not.toHaveTextContent('Delete');
		expect(deleteBox.width).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
		expect(deleteBox.height).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
	}}
/>

<Story
	name="GivesTheSliderItsOwnLineOnANarrowScreen"
	args={{ tags: TUNED_TAGS }}
	parameters={{
		viewport: {
			defaultViewport: NARROW_VIEWPORT,
			viewports: {
				[NARROW_VIEWPORT]: {
					name: 'Narrow phone',
					styles: { width: '400px', height: '800px' }
				}
			}
		}
	}}
	play={async ({ canvasElement }) => {
		expect(window.innerWidth).toBe(400);

		const slider = sliderNamed(canvasElement, 'Edge length for edge tag rel');
		const row = rowOf(slider);
		const sliderBox = slider.getBoundingClientRect();
		const name = row.querySelector('.tag-copy');
		if (!(name instanceof HTMLElement)) throw new Error('row has no tag name');
		const nameBox = name.getBoundingClientRect();
		const colorBox = within(row).getByLabelText('Color for edge tag rel').getBoundingClientRect();

		// Its own line: nothing else in the row shares its band.
		expect(onSeparateLines(sliderBox, nameBox)).toBe(true);
		expect(onSeparateLines(sliderBox, colorBox)).toBe(true);

		// Straight under the name, not below a blank band: the wide row's
		// `flex-basis: 8rem` would otherwise become the name block's height.
		expect(sliderBox.top - nameBox.bottom).toBeLessThan(24);

		// And most of the row's width, so a thumb gets a long, fine-grained track
		// rather than a stub.
		expect(sliderBox.width).toBeGreaterThan(row.getBoundingClientRect().width / 2);
		expect(sliderBox.height).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);

		// The readout sits under the track here too.
		const readout = row.querySelector('.physics-readout');
		if (!(readout instanceof HTMLElement)) throw new Error('row has no readout');
		expect(readout.getBoundingClientRect().top).toBeGreaterThan(
			sliderBox.top + sliderBox.height / 2
		);
	}}
/>

<Story
	name="KeepsATallListBelowTheToolbarWithItsHeaderPinned"
	args={{ tags: TALL_TAGS }}
	parameters={SHORT_PHONE_PARAMETERS}
	play={async ({ canvasElement }) => {
		expect(window.innerWidth).toBe(375);
		expect(window.innerHeight).toBe(600);

		// The toolbar publishes its measured clearance; nothing here guesses it.
		const toolbar = elementOf(canvasElement, '.toolbar-row');
		await waitFor(() =>
			expect(document.documentElement.style.getPropertyValue(TOOLBAR_CLEARANCE_PROPERTY)).toBe(
				`${toolbarClearancePx(toolbar.getBoundingClientRect())}px`
			)
		);
		const toolbarBottom = toolbar.getBoundingClientRect().bottom;

		// The panel stops below the toolbar's real box, however far it wraps.
		const panel = elementOf(canvasElement, '.tag-color-legend');
		expect(panel.getBoundingClientRect().top).toBeGreaterThanOrEqual(toolbarBottom);

		// And the list scrolls inside it rather than pushing it up the screen.
		expect(panel.scrollHeight).toBeGreaterThan(panel.clientHeight);
		panel.scrollTop = panel.scrollHeight;
		expect(panel.scrollTop).toBeGreaterThan(0);

		// The header stays pinned at the panel's top with the list scrolled to its end.
		const header = elementOf(panel, 'header');
		expect(header.getBoundingClientRect().top).toBeCloseTo(panel.getBoundingClientRect().top, 0);
		const canvas = within(canvasElement);
		expect(hittable(canvas.getByRole('heading', { name: 'Tags' }))).toBe(true);
		expect(hittable(canvas.getByRole('button', { name: 'Close' }))).toBe(true);
		expect(hittable(opacitySlider(canvasElement))).toBe(true);

		// The last row is reachable at the bottom of the scroll.
		expect(hittable(sliderNamed(canvasElement, 'Edge length for edge tag rel'))).toBe(true);
	}}
>
	{#snippet template(args)}
		<ToolbarClearanceStage>
			<TagColorLegend {...args} />
		</ToolbarClearanceStage>
	{/snippet}
</Story>

<Story
	name="FadesEverythingButItsOwnOpacitySlider"
	play={async ({ canvasElement }) => {
		clearSavedOpacity();
		try {
			const layer = elementOf(canvasElement, '.legend-layer');
			const panel = elementOf(canvasElement, '.tag-color-legend');
			const backdrop = elementOf(canvasElement, '.legend-backdrop');
			const close = within(canvasElement).getByRole('button', { name: 'Close' });
			const slider = opacitySlider(canvasElement);

			// Fully opaque by default, and the slider says so as a percentage.
			expect(slider.value).toBe('1');
			expect(slider).toHaveAttribute('aria-valuetext', '100%');
			expect(layer).toHaveAttribute('data-dialog-opacity', '1');
			expect(layer).toHaveAttribute('data-backdrop-opacity', '1');

			// At 40% the panel and Close fade; the backdrop, fading twice as fast,
			// is already gone; the slider is drawn at full strength.
			dragTo(slider, 0.4);
			flushSync();
			expect(opacityOf(panel)).toBe('0.4');
			expect(opacityOf(close)).toBe('0.4');
			expect(opacityOf(backdrop)).toBe('0');
			expect(drawnFullyOpaque(slider)).toBe(true);
			expect(slider).toHaveAttribute('aria-valuetext', '40%');
			expect(layer).toHaveAttribute('data-dialog-opacity', '0.4');
			expect(layer).toHaveAttribute('data-backdrop-opacity', '0');
			expect(within(canvasElement).getByText('opacity 40%')).toBeInTheDocument();

			// Between half and full, the backdrop is at 2·o − 1.
			dragTo(slider, 0.75);
			flushSync();
			expect(opacityOf(backdrop)).toBe('0.5');

			// At 0% the panel is invisible but the slider is still there and still
			// takes the pointer, so there is always a way back.
			dragTo(slider, 0);
			flushSync();
			expect(opacityOf(panel)).toBe('0');
			expect(drawnFullyOpaque(slider)).toBe(true);
			expect(slider.getBoundingClientRect().width).toBeGreaterThan(0);
			expect(hittable(slider)).toBe(true);

			// The invisible panel is still a dialog: a press on a row lands on the
			// row, not on the graph or the backdrop behind it.
			expect(hittable(within(canvasElement).getByText('topic'))).toBe(true);

			// 100% restores everything.
			dragTo(slider, 1);
			flushSync();
			expect(opacityOf(panel)).toBe('1');
			expect(opacityOf(close)).toBe('1');
			expect(opacityOf(backdrop)).toBe('1');
		} finally {
			clearSavedOpacity();
		}
	}}
/>

<Story
	name="DipsOnlyTheSliderBeingTuned"
	play={async ({ canvasElement }) => {
		clearSavedOpacity();
		try {
			const panel = elementOf(canvasElement, '.tag-color-legend');
			const spacing = sliderNamed(canvasElement, 'Node spacing for node tag topic');
			const tuned = physicsControlOf(spacing);
			const sibling = physicsControlOf(sliderNamed(canvasElement, 'Edge length for edge tag rel'));

			// A 200ms ease, so the dip reads as a fade rather than a flicker.
			expect(getComputedStyle(tuned).transitionProperty).toContain('opacity');
			expect(getComputedStyle(tuned).transitionDuration).toBe('0.2s');

			// Choose a dialog opacity so the story can tell the panel kept it.
			dragTo(opacitySlider(canvasElement), 0.8);
			flushSync();

			hover(spacing);
			flushSync();
			expect(tuned).toHaveAttribute('data-dipped', 'true');
			await waitFor(() => expect(opacityOf(tuned)).toBe('0.5'));
			expect(opacityOf(panel)).toBe('0.8');
			expect(sibling).toHaveAttribute('data-dipped', 'false');
			expect(opacityOf(sibling)).toBe('1');

			unhover(spacing);
			flushSync();
			expect(tuned).toHaveAttribute('data-dipped', 'false');
			await waitFor(() => expect(opacityOf(tuned)).toBe('1'));

			// Keyboard use dips it the same way, and blur restores it.
			spacing.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
			flushSync();
			expect(tuned).toHaveAttribute('data-dipped', 'true');
			spacing.dispatchEvent(new FocusEvent('blur'));
			flushSync();
			expect(tuned).toHaveAttribute('data-dipped', 'false');
		} finally {
			clearSavedOpacity();
		}
	}}
/>

<Story
	name="DipsWithoutAnimationUnderReducedMotion"
	args={{ tags: TAGS, reduceMotion: true }}
	play={async ({ canvasElement }) => {
		const spacing = sliderNamed(canvasElement, 'Node spacing for node tag topic');
		const tuned = physicsControlOf(spacing);
		expect(getComputedStyle(tuned).transitionDuration).toBe('0s');

		// The same end state, reached at once.
		hover(spacing);
		flushSync();
		expect(opacityOf(tuned)).toBe('0.5');
		unhover(spacing);
		flushSync();
		expect(opacityOf(tuned)).toBe('1');
	}}
/>

<Story
	name="RemembersTheChosenOpacityInThisBrowser"
	play={async ({ canvasElement }) => {
		clearSavedOpacity();
		const host = document.createElement('div');
		document.body.append(host);
		try {
			dragTo(opacitySlider(canvasElement), 0.4);
			flushSync();
			expect(localStorage.getItem(OPACITY_KEY)).toBe('0.4');

			// A fresh mount (the dialog reopened, or the page reloaded) reads it back.
			const reopened = mount(TagColorLegend, { target: host, props: { tags: TAGS } });
			try {
				flushSync();
				expect(opacitySlider(host).value).toBe('0.4');
				expect(opacityOf(elementOf(host, '.tag-color-legend'))).toBe('0.4');
				expect(elementOf(host, '.legend-layer')).toHaveAttribute('data-dialog-opacity', '0.4');
			} finally {
				unmount(reopened);
			}

			// Back at the default, the browser carries no entry at all.
			dragTo(opacitySlider(canvasElement), 1);
			flushSync();
			expect(localStorage.getItem(OPACITY_KEY)).toBeNull();
		} finally {
			host.remove();
			clearSavedOpacity();
		}
	}}
/>
