<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
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
			onImportGraphFile: { control: false },
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
			onImportGraphFile?: (file: File) => void;
			onSave?: () => void;
		};
	};

	function graphFile(name: string): File {
		return new File(['<!doctype html><html lang="en"></html>'], name, { type: 'text/html' });
	}

	function spyFor(callback: unknown): CallbackSpy {
		return callback as CallbackSpy;
	}
</script>

<Story
	name="UserSeesDocumentControlsOnly"
	args={{
		notice: 'Draft differs from the opened file. Save to keep the changes.',
		onNewGraph: fn(),
		onOpenGraphFilePicker: fn(),
		onImportGraphFile: fn(),
		onSave: fn()
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);

		await expect(canvas.getByRole('button', { name: 'New' })).toBeInTheDocument();
		await expect(canvas.getByText('Open')).toBeInTheDocument();
		await expect(canvas.getByRole('button', { name: 'Import…' })).toBeInTheDocument();
		await expect(canvas.getByRole('button', { name: 'Save' })).toBeInTheDocument();
		await expect(canvas.getByRole('status')).toHaveTextContent(
			'Draft differs from the opened file. Save to keep the changes.'
		);
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
	name="UserChoosesAFileToImport"
	args={{
		notice: 'Matches opened file.',
		onNewGraph: fn(),
		onOpenGraphFilePicker: fn(),
		onImportGraphFile: fn(),
		onSave: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		const canvas = within(canvasElement);
		const input = canvas.getByLabelText('Graph file to import') as HTMLInputElement;
		// The button only opens the file picker, which the browser refuses to do
		// without a real user gesture — so the reader's part is played directly on
		// the input, and this only checks the button is inert until a file arrives.
		canvas.getByRole('button', { name: 'Import…' }).click();
		expect(spyFor(args.onImportGraphFile).mock.calls).toHaveLength(0);

		await userEvent.upload(input, graphFile('other-graph.html'));

		await waitFor(() => expect(spyFor(args.onImportGraphFile).mock.calls).toHaveLength(1));
		expect((spyFor(args.onImportGraphFile).mock.calls[0][0] as File).name).toBe('other-graph.html');
		// Reset on change, so picking the same file again is picked up again.
		expect(input.value).toBe('');
	}}
/>

<Story
	name="UserSeesUnsavedWorkWarning"
	args={{
		notice:
			'This browser is blocking site data, so nothing is cached here. Save to a file to keep your work.',
		severity: 'warning',
		onNewGraph: fn(),
		onOpenGraphFilePicker: fn(),
		onSave: fn()
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);

		const alert = canvas.getByRole('alert');
		await expect(alert).toHaveTextContent(
			'This browser is blocking site data, so nothing is cached here. Save to a file to keep your work.'
		);
		await expect(alert).toHaveAttribute('aria-live', 'assertive');
		// The warning is longer than a status line, so it must be allowed to wrap.
		await expect(getComputedStyle(alert).whiteSpace).toBe('normal');
		await expect(canvas.queryByRole('status')).not.toBeInTheDocument();
	}}
/>

<style>
	:global(body) {
		min-height: 100vh;
	}
</style>
