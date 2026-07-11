<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, waitFor } from 'storybook/test';
	import DeepZoomStackHarness from './DeepZoomStackHarness.svelte';

	const { Story } = defineMeta({
		title: 'Components/Multigraph/DeepZoomStack',
		component: DeepZoomStackHarness,
		tags: []
	});

	function dispatchWheel(target: Element, deltaY: number) {
		const rect = target.getBoundingClientRect();
		target.dispatchEvent(
			new WheelEvent('wheel', {
				deltaY,
				clientX: rect.left + rect.width / 2,
				clientY: rect.top + rect.height / 2,
				bubbles: true,
				cancelable: true
			})
		);
	}
</script>

<Story
	name="PlaceholderContentRecursesAndExits"
	play={async ({ canvasElement }) => {
		const harness = canvasElement.querySelector('.deep-zoom-stack-harness') as HTMLElement;
		expect(harness).toHaveAttribute('data-depth', '1');

		let child = canvasElement.querySelector('.placeholder-child') as HTMLElement;
		dispatchWheel(child, -1000);
		await waitFor(() => expect(harness).toHaveAttribute('data-depth', '2'));

		child = Array.from(canvasElement.querySelectorAll('.placeholder-child')).at(-1) as HTMLElement;
		dispatchWheel(child, -1000);
		await waitFor(() => expect(harness).toHaveAttribute('data-depth', '3'));

		let world = Array.from(canvasElement.querySelectorAll('.zoom-world')).at(-1) as HTMLElement;
		dispatchWheel(world, 5000);
		await waitFor(() => expect(harness).toHaveAttribute('data-depth', '2'));

		world = Array.from(canvasElement.querySelectorAll('.zoom-world')).at(-1) as HTMLElement;
		dispatchWheel(world, 5000);
		await waitFor(() => expect(harness).toHaveAttribute('data-depth', '1'));
	}}
/>
