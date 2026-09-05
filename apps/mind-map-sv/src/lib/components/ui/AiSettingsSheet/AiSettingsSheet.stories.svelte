<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
	import AiSettingsSheet from './AiSettingsSheet.svelte';
	import { defaultAiSettings, type AiKeyValidation, type AiSettings } from '$lib/ai/aiSettings';

	const { Story } = defineMeta({
		title: 'Components/AiSettingsSheet',
		component: AiSettingsSheet,
		tags: [],
		args: {
			settings: defaultAiSettings(),
			connected: false,
			validateKey: fn(async () => ({ ok: true }) as AiKeyValidation),
			onSave: fn(),
			onForget: fn(),
			onClose: fn(),
			onConnected: fn()
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
			settings: AiSettings;
			connected?: boolean;
			validateKey: (key: string) => Promise<AiKeyValidation>;
			onSave: (settings: AiSettings) => void;
			onForget: () => void;
			onClose: () => void;
			onConnected?: () => void;
		};
	};

	function spyFor(callback: unknown): CallbackSpy {
		return callback as CallbackSpy;
	}

	function savedSettings(callback: unknown, index = 0): AiSettings {
		return spyFor(callback).mock.calls[index][0] as AiSettings;
	}

	function section(canvasElement: HTMLElement): HTMLDetailsElement {
		const found = canvasElement.querySelector('details');
		if (!(found instanceof HTMLDetailsElement)) throw new Error('no details section');
		return found;
	}

	const REMEMBERED_KEY: AiSettings = { ...defaultAiSettings(), apiKey: 'sk-ant-already-here' };
</script>

<Story
	name="UserSeesAnEmptySheet"
	play={async ({ canvasElement, args }: PlayContext) => {
		const canvas = within(canvasElement);

		const field = canvas.getByLabelText('Anthropic API key') as HTMLInputElement;
		// A password field, so a key never sits in plain sight on a shared screen.
		await expect(field).toHaveAttribute('type', 'password');
		await expect(field.value).toBe('');

		await expect(
			canvas.getByText('Stays in this browser. Never saved in your graph files.')
		).toBeInTheDocument();
		await expect(
			canvas.getByText('Use a key from its own workspace with a spending limit.')
		).toBeInTheDocument();
		await expect(canvas.getByRole('link', { name: 'Get a key' })).toHaveAttribute(
			'href',
			'https://console.anthropic.com/settings/keys'
		);
		await expect(canvas.getByRole('checkbox', { name: 'Remember on this browser' })).toBeChecked();
		await expect(canvas.getByRole('button', { name: 'Connect' })).toBeInTheDocument();

		// Nothing but the key on first sight: the rest is one summary away.
		await expect(section(canvasElement).open).toBe(false);

		// Both ways out. Escape is pressed from the focused field, which is where
		// the sheet puts the caret and how the keystroke reaches the layer.
		canvas.getByRole('button', { name: 'Close' }).click();
		await waitFor(() => expect(field).toHaveFocus());
		await userEvent.keyboard('{Escape}');
		await expect(spyFor(args.onClose).mock.calls).toHaveLength(2);
	}}
/>

<Story
	name="UserSeesAnInvalidKeyMessage"
	args={{
		validateKey: fn(
			async () =>
				({ ok: false, message: 'That key was refused. Check it and try again.' }) as AiKeyValidation
		)
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		const canvas = within(canvasElement);

		await userEvent.type(canvas.getByLabelText('Anthropic API key'), 'sk-ant-wrong');
		canvas.getByRole('button', { name: 'Connect' }).click();

		// The validator's own words, in the sheet, beside the field that caused it.
		await expect(await canvas.findByRole('alert')).toHaveTextContent(
			'That key was refused. Check it and try again.'
		);
		expect(spyFor(args.validateKey).mock.calls[0][0]).toBe('sk-ant-wrong');
		// A refused key is not saved, and nothing continues on from it.
		expect(spyFor(args.onSave).mock.calls).toHaveLength(0);
		expect(spyFor(args.onConnected).mock.calls).toHaveLength(0);
	}}
/>

<Story
	name="UserSeesConnectedStateWithTheSectionCollapsed"
	args={{ settings: REMEMBERED_KEY, connected: true }}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);

		await expect(canvas.getByText('Connected on this browser.')).toHaveAttribute(
			'data-ai-connection',
			'connected'
		);
		// Being connected does not expand the section either.
		await expect(section(canvasElement).open).toBe(false);
	}}
/>

<Story
	name="UserExpandsModelCostAndData"
	args={{ settings: REMEMBERED_KEY, connected: true }}
	play={async ({ canvasElement, args }: PlayContext) => {
		const canvas = within(canvasElement);

		canvas.getByText('Model, cost and data').click();
		await waitFor(() => expect(section(canvasElement).open).toBe(true));

		const model = canvas.getByLabelText('Model') as HTMLSelectElement;
		await expect(model.value).toBe(defaultAiSettings().model);
		await expect(canvas.getByLabelText('Preview rows sent per file')).toBeInTheDocument();
		await expect(
			canvas.getByRole('checkbox', { name: 'Send rendered plots back to Claude for checking' })
		).toBeChecked();
		await expect(canvas.getByRole('button', { name: 'Forget key' })).toBeInTheDocument();

		// The section's controls save as they are changed; there is no Save here.
		await userEvent.selectOptions(model, 'claude-sonnet-5');
		await waitFor(() => expect(spyFor(args.onSave).mock.calls).toHaveLength(1));
		expect(savedSettings(args.onSave).model).toBe('claude-sonnet-5');
		expect(savedSettings(args.onSave).apiKey).toBe('sk-ant-already-here');

		canvas.getByRole('button', { name: 'Forget key' }).click();
		await waitFor(() => expect(spyFor(args.onForget).mock.calls).toHaveLength(1));
		expect((canvas.getByLabelText('Anthropic API key') as HTMLInputElement).value).toBe('');
	}}
/>

<Story
	name="UserConnectsWithAValidKey"
	play={async ({ canvasElement, args }: PlayContext) => {
		const canvas = within(canvasElement);

		await userEvent.type(canvas.getByLabelText('Anthropic API key'), 'sk-ant-good');
		canvas.getByRole('button', { name: 'Connect' }).click();

		await waitFor(() => expect(spyFor(args.onSave).mock.calls).toHaveLength(1));
		expect(savedSettings(args.onSave)).toEqual({
			...defaultAiSettings(),
			apiKey: 'sk-ant-good'
		});
		// The run that opened the sheet is what continues from here (T08).
		expect(spyFor(args.onConnected).mock.calls).toHaveLength(1);
		expect(canvas.queryByRole('alert')).not.toBeInTheDocument();
	}}
/>
