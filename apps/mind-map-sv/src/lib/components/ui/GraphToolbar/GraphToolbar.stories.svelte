<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, within } from 'storybook/test';
	import GraphToolbar from './GraphToolbar.svelte';
	import type { GraphSummary } from '$lib/persistence';

	const { Story } = defineMeta({
		title: 'Components/GraphToolbar',
		component: GraphToolbar,
		tags: [],
		argTypes: {
			selectedGraphId: { control: 'text' },
			graphSummaries: { control: 'object' },
			notice: { control: 'text' },
			onGraphSelected: { control: false },
			onNewGraph: { control: false },
			onDeleteGraph: { control: false }
		},
		parameters: {
			viewport: {
				defaultViewport: 'phone'
			}
		}
	});

	type CallbackSpy = {
		mock: { calls: unknown[][] };
	};

	type PlayContext = {
		canvasElement: HTMLElement;
		args: {
			selectedGraphId: string;
			graphSummaries?: GraphSummary[];
			notice?: string;
			onGraphSelected?: (graphId: string) => void;
			onNewGraph?: () => void;
			onDeleteGraph?: () => void;
		};
	};

	function spyFor(callback: unknown): CallbackSpy {
		return callback as CallbackSpy;
	}
</script>

<Story
	name="UserManagesGraphsFromToolbar"
	args={{
		selectedGraphId: 'default',
		graphSummaries: [
			{ id: 'default', updatedAt: 300 },
			{ id: 'brainstorm', updatedAt: 200 },
			{ id: 'roadmap', updatedAt: 100 }
		],
		notice: 'Saved.',
		onGraphSelected: fn(),
		onNewGraph: fn(),
		onDeleteGraph: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		const canvas = within(canvasElement);

		await expect(canvas.getByLabelText('Load graph')).toHaveValue('default');
		await expect(canvas.getByRole('status')).toHaveTextContent('Saved.');

		canvas.getByLabelText('Load graph').dispatchEvent(
			new Event('change', {
				bubbles: true
			})
		);
		(canvas.getByLabelText('Load graph') as HTMLSelectElement).value = 'brainstorm';
		canvas.getByLabelText('Load graph').dispatchEvent(new Event('change', { bubbles: true }));
		canvas.getByRole('button', { name: 'New graph' }).click();
		canvas.getByRole('button', { name: 'Delete graph' }).click();

		expect(spyFor(args.onGraphSelected).mock.calls.at(-1)).toEqual(['brainstorm']);
		expect(spyFor(args.onNewGraph).mock.calls).toHaveLength(1);
		expect(spyFor(args.onDeleteGraph).mock.calls).toHaveLength(1);
	}}
/>

<Story
	name="EmptyGraphListShowsSelectedGraph"
	args={{
		selectedGraphId: 'unsaved',
		graphSummaries: [],
		notice: 'Saving...'
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);

		await expect(canvas.getByLabelText('Load graph')).toHaveValue('unsaved');
		await expect(canvas.getByRole('option', { name: 'unsaved' })).toBeInTheDocument();
		await expect(canvas.getByRole('status')).toHaveTextContent('Saving...');
	}}
/>

<style>
	:global(body) {
		min-height: 100vh;
	}
</style>
