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
			hasExplicitColor: true
		},
		{
			namespace: 'nodeTags',
			tag: 'fallback',
			color: '#00ff00',
			usageCount: 1,
			hasExplicitColor: false
		},
		{
			namespace: 'edgeTags',
			tag: 'rel',
			color: '#0000ff',
			usageCount: 1,
			hasExplicitColor: true
		}
	];

	const { Story } = defineMeta({
		title: 'Components/Multigraph/TagColorLegend',
		component: TagColorLegend,
		tags: [],
		args: {
			tags: TAGS,
			onColorChange: fn(),
			onDelete: fn(),
			onClose: fn()
		}
	});

	type LegendSpy = {
		mock: { calls: Array<[TagColorNamespace, string, string, 'scrub' | 'commit']> };
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
</script>

<Story
	name="ListsNodeAndEdgeTags"
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);

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
