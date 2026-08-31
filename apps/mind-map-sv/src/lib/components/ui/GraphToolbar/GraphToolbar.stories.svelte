<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, within } from 'storybook/test';
	import GraphToolbar from './GraphToolbar.svelte';

	const { Story } = defineMeta({
		title: 'Components/GraphToolbar',
		component: GraphToolbar,
		tags: [],
		argTypes: {
			notice: { control: 'text' },
			severity: { control: 'radio', options: ['info', 'warning'] },
			onNewGraph: { control: false },
			onOpenGraphFilePicker: { control: false },
			onSave: { control: false }
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
			notice?: string;
			severity?: 'info' | 'warning';
			onNewGraph?: () => void;
			onOpenGraphFilePicker?: () => void;
			onSave?: () => void;
		};
	};

	function spyFor(callback: unknown): CallbackSpy {
		return callback as CallbackSpy;
	}
</script>

<Story
	name="UserSeesDocumentControlsOnly"
	args={{
		notice: 'Differs from the opened file. Save to keep the changes.',
		onNewGraph: fn(),
		onOpenGraphFilePicker: fn(),
		onSave: fn()
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);

		await expect(canvas.getByRole('button', { name: 'New' })).toBeInTheDocument();
		await expect(canvas.getByText('Open')).toBeInTheDocument();
		await expect(canvas.getByRole('button', { name: 'Save' })).toBeInTheDocument();
		await expect(canvas.getByRole('status')).toHaveTextContent(
			'Differs from the opened file. Save to keep the changes.'
		);
		await expect(canvas.queryByLabelText('Import graph from file')).not.toBeInTheDocument();
		await expect(canvas.queryByRole('button', { name: 'Delete graph' })).not.toBeInTheDocument();
	}}
/>

<Story
	name="UserClicksNewAndSave"
	args={{
		notice: 'Matches saved file.',
		onNewGraph: fn(),
		onOpenGraphFilePicker: fn(),
		onSave: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		const canvas = within(canvasElement);

		canvas.getByRole('button', { name: 'New' }).click();
		canvas.getByRole('button', { name: 'Save' }).click();

		expect(spyFor(args.onNewGraph).mock.calls).toHaveLength(1);
		expect(spyFor(args.onSave).mock.calls).toHaveLength(1);
	}}
/>

<Story
	name="UserOpensGraphFileTab"
	args={{
		notice: 'Matches opened file.',
		onNewGraph: fn(),
		onOpenGraphFilePicker: fn(),
		onSave: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		const canvas = within(canvasElement);

		canvas.getByRole('button', { name: 'Open' }).click();

		expect(spyFor(args.onOpenGraphFilePicker).mock.calls).toHaveLength(1);
	}}
/>

<Story
	name="UserSeesUnsavedWorkWarning"
	args={{
		notice: 'Caching is blocked here. Save to a file to keep it.',
		severity: 'warning',
		onNewGraph: fn(),
		onOpenGraphFilePicker: fn(),
		onSave: fn()
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);

		const alert = canvas.getByRole('alert');
		await expect(alert).toHaveTextContent('Caching is blocked here. Save to a file to keep it.');
		await expect(alert).toHaveAttribute('aria-live', 'assertive');
		// A sentence longer than the notice column wraps inside it rather than
		// stretching the toolbar or being clipped.
		await expect(getComputedStyle(alert).whiteSpace).toBe('normal');
		await expect(canvas.queryByRole('status')).not.toBeInTheDocument();
	}}
/>

<Story
	name="UserSeesNoticeSentencesStacked"
	args={{
		notice: 'Draft cached in this browser. Save to keep it.',
		onNewGraph: fn(),
		onOpenGraphFilePicker: fn(),
		onSave: fn()
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);

		const status = canvas.getByRole('status');
		await expect(status).toHaveTextContent('Draft cached in this browser. Save to keep it.');
		// Stacked, not run together: the toolbar stays narrow enough to sit beside
		// the buttons instead of stretching across the viewport.
		const lines = Array.from(status.querySelectorAll('span'));
		// Each line carries a trailing space so the sentences do not run together
		// in the accessible text; the visible wording is what is asserted here.
		await expect(lines.map((line) => line.textContent?.trim())).toEqual([
			'Draft cached in this browser.',
			'Save to keep it.'
		]);
		await expect(getComputedStyle(lines[0]).display).toBe('block');
	}}
/>

<style>
	:global(body) {
		min-height: 100vh;
	}
</style>
