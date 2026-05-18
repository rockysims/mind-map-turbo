<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, userEvent, waitFor, within } from 'storybook/test';
	import { makeGraph } from '$lib/components/ui/Multigraph/lib/testFixtures';
	import type { MultigraphData } from '$lib/components/ui/types/multigraph';
	import PersistedGraphHarness from './PersistedGraphHarness.svelte';

	const { Story } = defineMeta({
		title: 'Components/GraphPersistence',
		component: PersistedGraphHarness,
		tags: [],
		argTypes: {
			initialGraphId: { control: 'text' },
			graphs: { control: 'object' }
		},
		parameters: {
			viewport: {
				defaultViewport: 'phone'
			}
		}
	});

	type PlayContext = {
		canvasElement: HTMLElement;
	};

	function graphWithTitle(title: string, nodeCount = 1): MultigraphData {
		const graph = makeGraph({ nodeCount });
		return {
			...graph,
			nodes: graph.nodes.map((node, index) => (index === 0 ? { ...node, title } : node))
		};
	}

	function getHarness(canvasElement: HTMLElement): HTMLElement {
		const harness = canvasElement.querySelector('.harness');
		if (!(harness instanceof HTMLElement)) throw new Error('Harness not found');
		return harness;
	}

	async function waitForHarnessData(
		canvasElement: HTMLElement,
		name: string,
		value: string
	): Promise<void> {
		const harness = getHarness(canvasElement);
		await waitFor(() => expect(harness.dataset[name]).toBe(value));
	}
</script>

<Story
	name="ExistingGraphLoadsFromPersistence"
	args={{
		initialGraphId: 'saved',
		graphs: {
			saved: graphWithTitle('Saved Graph')
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const harness = getHarness(canvasElement);

		await waitForHarnessData(canvasElement, 'loadedGraphId', 'saved');
		await expect(harness.dataset.primaryTitle).toBe('Saved Graph');
		await expect(harness.dataset.notice).toBe('Loaded "saved".');
	}}
/>

<Story
	name="UserChangesGraphAndItSaves"
	args={{
		initialGraphId: 'editable',
		graphs: {
			editable: graphWithTitle('Editable Graph')
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);
		const harness = getHarness(canvasElement);

		await waitForHarnessData(canvasElement, 'loadedGraphId', 'editable');
		await userEvent.click(canvas.getByRole('button', { name: 'Simulate graph change' }));

		await waitFor(() => expect(harness.dataset.primaryTitle).toBe('Changed Node'));
		await waitFor(() => expect(harness.dataset.notice).toBe('Saved.'));
		await expect(harness.dataset.graphIds).toContain('editable');
	}}
/>

<Story
	name="UserCreatesAndSwitchesGraphs"
	args={{
		initialGraphId: 'default',
		graphs: {
			default: graphWithTitle('Default Graph')
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);
		const harness = getHarness(canvasElement);

		await waitForHarnessData(canvasElement, 'loadedGraphId', 'default');
		await userEvent.click(canvas.getByRole('button', { name: 'New graph' }));

		await waitForHarnessData(canvasElement, 'loadedGraphId', 'graph-new');
		await expect(harness.dataset.routedGraphId).toBe('graph-new');
		await expect(harness.dataset.graphIds).toContain('graph-new');
	}}
/>

<Story
	name="DeletingSelectedGraphRoutesToRemainingGraph"
	args={{
		initialGraphId: 'second',
		graphs: {
			first: graphWithTitle('First Graph'),
			second: graphWithTitle('Second Graph', 2)
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);
		const harness = getHarness(canvasElement);

		await waitForHarnessData(canvasElement, 'loadedGraphId', 'second');
		await userEvent.click(canvas.getByRole('button', { name: 'Delete graph' }));

		await waitForHarnessData(canvasElement, 'loadedGraphId', 'first');
		await expect(harness.dataset.routedGraphId).toBe('first');
		await expect(harness.dataset.graphIds).toBe('first');
		await expect(harness.dataset.primaryTitle).toBe('First Graph');
	}}
/>

<Story
	name="DeletingLastGraphResetsToDefault"
	args={{
		initialGraphId: 'default',
		graphs: {
			default: graphWithTitle('Temporary Default', 2)
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);
		const harness = getHarness(canvasElement);

		await waitForHarnessData(canvasElement, 'loadedGraphId', 'default');
		await userEvent.click(canvas.getByRole('button', { name: 'Delete graph' }));

		await waitForHarnessData(canvasElement, 'loadedGraphId', 'default');
		await waitFor(() => expect(harness.dataset.nodeCount).toBe('1'));
		await expect(harness.dataset.routedGraphId).toBe('default');
		await expect(harness.dataset.graphIds).toBe('default');
	}}
/>

<Story
	name="ExternalStorageEventReloadsActiveGraph"
	args={{
		initialGraphId: 'shared',
		graphs: {
			shared: graphWithTitle('Original Graph')
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);
		const harness = getHarness(canvasElement);

		await waitForHarnessData(canvasElement, 'loadedGraphId', 'shared');
		await userEvent.click(canvas.getByRole('button', { name: 'Simulate external reload' }));

		await waitFor(() => expect(harness.dataset.primaryTitle).toBe('Externally Reloaded'));
		await expect(harness.dataset.notice).toBe('Reloaded "shared" from another tab.');
	}}
/>

<style>
	:global(body) {
		min-height: 100vh;
	}
</style>
