<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, within } from 'storybook/test';
	import TagColorLegend from './TagColorLegend.svelte';
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

		// The far end is ×0.25, not a quarter of the track.
		scrubSlider(nodeSlider, -2);
		expect(physicsSpy.mock.calls.at(-1)).toEqual(['nodeTags', 'topic', 0.25, 'scrub']);
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

		// An untuned tag sits at the centre detent and reads ×1.0.
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
