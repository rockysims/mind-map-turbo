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
			settingsOpen: { control: 'boolean' },
			onNewGraph: { control: false },
			onOpenGraphFilePicker: { control: false },
			onDownload: { control: false },
			onOpenSettings: { control: false }
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
			settingsOpen?: boolean;
			onNewGraph?: () => void;
			onOpenGraphFilePicker?: () => void;
			onDownload?: () => void;
			onOpenSettings?: () => void;
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
	name="UserOpensGraphFileTab"
	args={{
		notice: 'Matches opened file.',
		onNewGraph: fn(),
		onOpenGraphFilePicker: fn(),
		onDownload: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		const canvas = within(canvasElement);

		canvas.getByRole('button', { name: 'Open' }).click();

		expect(spyFor(args.onOpenGraphFilePicker).mock.calls).toHaveLength(1);
	}}
/>

<Story
	name="UserOpensSettingsFromTheSecondPill"
	args={{
		notice: 'Draft differs from opened file. Download needed.',
		settingsOpen: false,
		onNewGraph: fn(),
		onOpenGraphFilePicker: fn(),
		onDownload: fn(),
		onOpenSettings: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		const canvas = within(canvasElement);
		const settings = canvas.getByRole('button', { name: 'Settings' });

		// A dialog opener, not a toggle button: the panel it opens is a dialog, and
		// `aria-expanded` is what tells a screen reader whether it is already there.
		await expect(settings).toHaveAttribute('aria-haspopup', 'dialog');
		await expect(settings).toHaveAttribute('aria-expanded', 'false');

		// One wrapper holds both pills, so the variable-width notice can never
		// position the Settings button independently of the document controls.
		const row = settings.closest('.toolbar-row');
		await expect(row).not.toBeNull();
		await expect(row).toContainElement(canvas.getByRole('button', { name: 'Download' }));
		await expect(row).toContainElement(canvas.getByRole('status'));

		settings.click();

		expect(spyFor(args.onOpenSettings).mock.calls).toHaveLength(1);
		expect(spyFor(args.onNewGraph).mock.calls).toHaveLength(0);
	}}
/>

<Story
	name="UserSeesTheSettingsPillMarkedOpen"
	args={{
		notice: 'Matches downloaded file.',
		settingsOpen: true,
		onNewGraph: fn(),
		onOpenGraphFilePicker: fn(),
		onDownload: fn(),
		onOpenSettings: fn()
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);

		await expect(canvas.getByRole('button', { name: 'Settings' })).toHaveAttribute(
			'aria-expanded',
			'true'
		);
	}}
/>

<style>
	:global(body) {
		min-height: 100vh;
	}
</style>
