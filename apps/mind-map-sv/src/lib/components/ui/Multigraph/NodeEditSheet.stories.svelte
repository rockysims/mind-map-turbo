<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, within } from 'storybook/test';
	import NodeEditSheet from './NodeEditSheet.svelte';
	import type { NodeData } from '../types/node';

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
		mock: { calls: Array<[{ title: string; description: string; tags: string[] }]> };
	};

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
</script>

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
