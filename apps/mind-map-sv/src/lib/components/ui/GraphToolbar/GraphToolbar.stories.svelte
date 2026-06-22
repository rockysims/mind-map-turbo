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
			onNewGraph: { control: false },
			onOpenGraphFilePicker: { control: false },
			onLoadGraph: { control: false },
			onDownload: { control: false }
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
			onNewGraph?: () => void;
			onOpenGraphFilePicker?: () => void;
			onLoadGraph?: (file: File) => void;
			onDownload?: () => void;
		};
	};

	function spyFor(callback: unknown): CallbackSpy {
		return callback as CallbackSpy;
	}
</script>

<Story
	name="UserSeesDocumentControlsOnly"
	args={{
		notice: 'Draft differs from opened file. Download needed.',
		onNewGraph: fn(),
		onOpenGraphFilePicker: fn(),
		onLoadGraph: fn(),
		onDownload: fn()
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);

		await expect(canvas.getByRole('button', { name: 'New' })).toBeInTheDocument();
		await expect(canvas.getByText('Open')).toBeInTheDocument();
		await expect(canvas.getByRole('button', { name: 'Download' })).toBeInTheDocument();
		await expect(canvas.getByRole('status')).toHaveTextContent(
			'Draft differs from opened file. Download needed.'
		);
		await expect(canvas.queryByLabelText('Load graph file')).toBeInTheDocument();
		await expect(canvas.queryByLabelText('Import graph from file')).not.toBeInTheDocument();
		await expect(canvas.queryByRole('button', { name: 'Delete graph' })).not.toBeInTheDocument();
	}}
/>

<Story
	name="UserClicksNewAndDownload"
	args={{
		notice: 'Matches downloaded file.',
		onNewGraph: fn(),
		onOpenGraphFilePicker: fn(),
		onLoadGraph: fn(),
		onDownload: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		const canvas = within(canvasElement);

		canvas.getByRole('button', { name: 'New' }).click();
		canvas.getByRole('button', { name: 'Download' }).click();

		expect(spyFor(args.onNewGraph).mock.calls).toHaveLength(1);
		expect(spyFor(args.onDownload).mock.calls).toHaveLength(1);
	}}
/>

<Story
	name="UserLoadsHtmlFile"
	args={{
		notice: 'Matches opened file.',
		onNewGraph: fn(),
		onOpenGraphFilePicker: fn(),
		onLoadGraph: fn(),
		onDownload: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		const canvas = within(canvasElement);
		const fileInput = canvas.getByLabelText('Load graph file') as HTMLInputElement;
		const file = new File(['<!doctype html><html></html>'], 'graph.html', { type: 'text/html' });

		canvas.getByRole('button', { name: 'Open' }).click();
		Object.defineProperty(fileInput, 'files', {
			value: [file],
			configurable: true
		});
		fileInput.dispatchEvent(new Event('change', { bubbles: true }));

		expect(spyFor(args.onOpenGraphFilePicker).mock.calls).toHaveLength(1);
		expect(spyFor(args.onLoadGraph).mock.calls).toHaveLength(1);
		expect((spyFor(args.onLoadGraph).mock.calls[0] as [File])[0].name).toBe('graph.html');
		expect(fileInput.value).toBe('');
	}}
/>

<style>
	:global(body) {
		min-height: 100vh;
	}
</style>
