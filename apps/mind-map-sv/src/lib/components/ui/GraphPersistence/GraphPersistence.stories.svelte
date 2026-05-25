<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, userEvent, waitFor, within } from 'storybook/test';
	import { DBL_CLICK_MS } from '$lib/constants';
	import { makeGraph } from '$lib/components/ui/Multigraph/lib/testFixtures';
	import type { MultigraphData } from '$lib/components/ui/types/multigraph';
	import PersistedGraphHarness from './PersistedGraphHarness.svelte';

	const { Story } = defineMeta({
		title: 'Components/GraphPersistence',
		component: PersistedGraphHarness,
		tags: [],
		argTypes: {
			initialGraphId: { control: 'text' },
			graphs: { control: 'object' },
			layoutSettings: { control: 'object' }
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

	function getCircle(el: HTMLElement, nodeId: string): HTMLElement {
		const circle = el.querySelector(`[data-node-id="${nodeId}"] .circle`);
		if (!circle) throw new Error(`Circle not found for ${nodeId}`);
		return circle as HTMLElement;
	}

	function getNodeWrapper(el: HTMLElement, nodeId: string): HTMLElement {
		const wrapper = el.querySelector(`[data-node-id="${nodeId}"].node-wrapper`);
		if (!wrapper) throw new Error(`Node wrapper not found for ${nodeId}`);
		return wrapper as HTMLElement;
	}

	function getCenter(el: HTMLElement): { x: number; y: number } {
		const rect = el.getBoundingClientRect();
		return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
	}

	function dispatchPointer(
		target: HTMLElement,
		type: 'pointerdown' | 'pointerup',
		clientX: number,
		clientY: number,
		pointerId = 1
	) {
		target.dispatchEvent(
			new PointerEvent(type, {
				clientX,
				clientY,
				pointerId,
				bubbles: true,
				cancelable: true
			})
		);
	}

	async function dispatchDoubleClick(target: HTMLElement, x: number, y: number): Promise<void> {
		dispatchPointer(target, 'pointerdown', x, y);
		dispatchPointer(target, 'pointerup', x, y);
		await new Promise((resolve) => setTimeout(resolve, DBL_CLICK_MS * 0.1));
		dispatchPointer(target, 'pointerdown', x, y);
		dispatchPointer(target, 'pointerup', x, y);
	}

	function waitForLayout(): Promise<void> {
		return new Promise((resolve) => {
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
		});
	}

	function sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	function waitForFrames(count: number): Promise<void> {
		return new Promise((resolve) => {
			let remaining = count;
			const wait = () => {
				remaining -= 1;
				if (remaining <= 0) {
					resolve();
					return;
				}
				requestAnimationFrame(wait);
			};
			requestAnimationFrame(wait);
		});
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
	name="PinningAnimatesWhenGraphEchoesFromPersistence"
	args={{
		initialGraphId: 'animated',
		graphs: {
			animated: makeGraph({
				nodeCount: 3,
				edges: [
					[0, 1],
					[1, 2]
				],
				posByNodeId: {
					n0: { x: -280, y: 0 },
					n1: { x: 0, y: 0 },
					n2: { x: 280, y: 0 }
				}
			})
		},
		layoutSettings: {
			scaleFalloff: 0.5,
			minScale: 0.2,
			scaleAnimationDurationMs: 120,
			postScaleChangeSettleMaxFrames: 8,
			relaxIterations: 1
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForHarnessData(canvasElement, 'loadedGraphId', 'animated');
		await waitForLayout();

		const harness = getHarness(canvasElement);
		expect(harness.dataset.graphGeneration).toBe('1');
		expect(harness.dataset.scaleAnimationDurationMs).toBe('120');
		expect(Number(getNodeWrapper(canvasElement, 'n0').dataset.scale)).toBe(0.2);

		const generationBeforePin = harness.dataset.graphGeneration;
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);
		await dispatchDoubleClick(circle, center.x, center.y);
		await waitForFrames(2);

		const node = canvasElement.querySelector('[data-node-id="n0"] .node');
		expect(node).toHaveAttribute('data-pinned', 'true');
		expect(harness.dataset.graphGeneration).toBe(generationBeforePin);
		await waitFor(() => {
			expect(canvasElement.querySelector('.graph')).toHaveAttribute(
				'data-scale-animation-active',
				'true'
			);
			const animatedPinnedScale = Number(getNodeWrapper(canvasElement, 'n0').dataset.scale);
			const animatedNeighborScale = Number(getNodeWrapper(canvasElement, 'n1').dataset.scale);
			expect(animatedPinnedScale).toBeGreaterThan(0.2);
			expect(animatedPinnedScale).toBeLessThan(1);
			expect(animatedNeighborScale).toBeLessThan(0.5);
		});

		await sleep(140);
		await waitForLayout();

		expect(Number(getNodeWrapper(canvasElement, 'n0').dataset.scale)).toBe(1);
		expect(Number(getNodeWrapper(canvasElement, 'n1').dataset.scale)).toBe(0.5);
		expect(Number(getNodeWrapper(canvasElement, 'n2').dataset.scale)).toBe(0.25);
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
