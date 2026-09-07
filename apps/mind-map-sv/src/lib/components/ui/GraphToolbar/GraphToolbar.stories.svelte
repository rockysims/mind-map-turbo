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
			aiConnected?: boolean;
			onNewGraph?: () => void;
			onOpenGraphFilePicker?: () => void;
			onImportGraphFile?: (file: File) => void;
			onSave?: () => void;
			onOpenAiSettings?: () => void;
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
		notice: 'Differs from the opened file. Save to keep the changes.',
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

		// Each control says what it does beyond its one-word label. Import and Open
		// both take a file, so their tooltips have to separate "adds to this graph"
		// from "opens somewhere else".
		await expect(canvas.getByRole('button', { name: 'Import…' })).toHaveAttribute(
			'title',
			'Add a saved graph file to this graph, keeping both'
		);
		await expect(canvas.getByRole('button', { name: 'Open' })).toHaveAttribute(
			'title',
			'Open a saved graph file in a new tab'
		);
		for (const name of ['New', 'Save']) {
			await expect(canvas.getByRole('button', { name })).toHaveAttribute('title');
		}
		await expect(canvas.getByRole('status')).toHaveTextContent(
			'Differs from the opened file. Save to keep the changes.'
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

<Story
	name="UserOpensAiSettingsFromTheToolbar"
	args={{
		notice: 'Matches saved file.',
		aiConnected: false,
		onNewGraph: fn(),
		onOpenGraphFilePicker: fn(),
		onSave: fn(),
		onOpenAiSettings: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		const canvas = within(canvasElement);

		// Whether a key is in hand is part of the name, not colour alone.
		const control = canvas.getByRole('button', { name: 'AI settings, not connected' });
		await expect(control).toHaveAttribute('data-ai-connected', 'false');
		await expect(
			canvas.queryByRole('button', { name: 'AI settings, connected' })
		).not.toBeInTheDocument();

		// A filled glyph and an unfilled one are the same shape, so the state also
		// carries a dot: grey here, green once a key is in hand.
		const dot = control.querySelector('[data-ai-connected-dot]');
		await expect(dot).toHaveAttribute('aria-hidden', 'true');
		await expect(getComputedStyle(dot as Element).backgroundColor).toBe('rgb(148, 163, 184)');

		control.click();
		expect(spyFor(args.onOpenAiSettings).mock.calls).toHaveLength(1);
	}}
/>

<Story
	name="UserSeesAiSettingsConnected"
	args={{
		notice: 'Matches saved file.',
		aiConnected: true,
		onNewGraph: fn(),
		onOpenGraphFilePicker: fn(),
		onSave: fn(),
		onOpenAiSettings: fn()
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);

		const control = canvas.getByRole('button', { name: 'AI settings, connected' });
		await expect(control).toHaveAttribute('data-ai-connected', 'true');

		// The dot the reader looks for after pressing Connect.
		const dot = control.querySelector('[data-ai-connected-dot]');
		await expect(getComputedStyle(dot as Element).backgroundColor).toBe('rgb(74, 222, 128)');
	}}
/>

<style>
	:global(body) {
		min-height: 100vh;
	}
</style>
