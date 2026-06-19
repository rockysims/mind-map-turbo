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
		mock: { calls: Array<[TagColorNamespace, string, string]> };
	};

	type DeleteSpy = {
		mock: { calls: Array<[TagColorNamespace, string]> };
	};
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

		expect(colorSpy.mock.calls.at(-1)).toEqual(['nodeTags', 'topic', '#123456']);

		canvas.getByRole('button', { name: 'Delete edge tag rel' }).click();
		expect(deleteSpy.mock.calls.at(-1)).toEqual(['edgeTags', 'rel']);
	}}
/>
