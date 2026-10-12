<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, userEvent, waitFor, within } from 'storybook/test';
	import { CONFIG_SCHEMA } from '$lib/config/configSchema';
	import SettingFieldHarness from './SettingFieldHarness.svelte';

	const { Story } = defineMeta({
		title: 'Components/SettingField',
		component: SettingFieldHarness,
		tags: [],
		argTypes: {
			path: { control: false },
			spec: { control: false },
			defaultValue: { control: false },
			initialValue: { control: false }
		}
	});

	type PlayContext = {
		canvasElement: HTMLElement;
	};

	const FALLOFF_PATH = 'multigraph.layout.scaleFalloff';
	const FALLOFF_SPEC = CONFIG_SCHEMA[FALLOFF_PATH];
	const FALLOFF_LABEL = 'label' in FALLOFF_SPEC ? FALLOFF_SPEC.label : '';

	const ARROW_PATH = 'multigraph.edgeArrow.lengthPx';
	const ARROW_SPEC = CONFIG_SCHEMA[ARROW_PATH];
	const ARROW_LABEL = 'label' in ARROW_SPEC ? ARROW_SPEC.label : '';

	const TOGGLE_PATH = 'multigraph.layout.normalizeRelaxationTranslation';
	const TOGGLE_SPEC = CONFIG_SCHEMA[TOGGLE_PATH];
	const TOGGLE_LABEL = 'label' in TOGGLE_SPEC ? TOGGLE_SPEC.label : '';

	const NUMBER_PATH = 'math.renderCacheMaxEntries';
	const NUMBER_SPEC = CONFIG_SCHEMA[NUMBER_PATH];
	const NUMBER_LABEL = 'label' in NUMBER_SPEC ? NUMBER_SPEC.label : '';

	const HIDDEN_PATH = 'multigraph.nodeRadiusPx';
	const HIDDEN_SPEC = CONFIG_SCHEMA[HIDDEN_PATH];

	function getHarness(canvasElement: HTMLElement): HTMLElement {
		const harness = canvasElement.querySelector('.harness');
		if (!(harness instanceof HTMLElement)) throw new Error('Harness not found');
		return harness;
	}

	function getSlider(canvasElement: HTMLElement, label: string): HTMLInputElement {
		const slider = within(canvasElement).getByRole('slider', { name: label });
		if (!(slider instanceof HTMLInputElement)) throw new Error('Slider not found');
		return slider;
	}

	function getNumberBox(canvasElement: HTMLElement, label: string): HTMLInputElement {
		const box = within(canvasElement).getByRole('spinbutton', { name: label });
		if (!(box instanceof HTMLInputElement)) throw new Error('Numeric input not found');
		return box;
	}

	/**
	 * Drives the slider through the event contract a real pointer drag produces:
	 * one `input` per movement, then a single `change` on release. Synthesizing a
	 * true pointer drag on `input[type=range]` is unreliable across engines, so
	 * the events themselves are the interface under test.
	 */
	function dragSlider(slider: HTMLInputElement, steps: number[]): void {
		for (const step of steps) {
			slider.value = String(step);
			slider.dispatchEvent(new Event('input', { bubbles: true }));
		}
		slider.dispatchEvent(new Event('change', { bubbles: true }));
	}

	/**
	 * The sequence a browser produces for one arrow key on a focused range input:
	 * keydown, the value change, `input`, `change`, keyup. Synthetic key events do
	 * not move a native slider, so the value change is applied here.
	 */
	function pressArrowKey(slider: HTMLInputElement, nextValue: number): void {
		slider.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
		);
		slider.value = String(nextValue);
		slider.dispatchEvent(new Event('input', { bubbles: true }));
		slider.dispatchEvent(new Event('change', { bubbles: true }));
		slider.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
	}

	function typeValue(input: HTMLInputElement, text: string): void {
		input.value = text;
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
		);
	}

	async function expectHarnessData(
		canvasElement: HTMLElement,
		name: string,
		value: string
	): Promise<void> {
		const harness = getHarness(canvasElement);
		await waitFor(() => expect(harness.dataset[name]).toBe(value));
	}
</script>

<Story
	name="UserDragsARangeAndSeesPreviewsThenOneCommit"
	args={{
		path: FALLOFF_PATH,
		spec: FALLOFF_SPEC,
		defaultValue: 0.7
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const slider = getSlider(canvasElement, FALLOFF_LABEL);

		dragSlider(slider, [0.6, 0.5, 0.4]);

		await expectHarnessData(canvasElement, 'previewCount', '3');
		await expectHarnessData(canvasElement, 'lastPreview', '0.4');
		await expectHarnessData(canvasElement, 'commitCount', '1');
		await expectHarnessData(canvasElement, 'lastCommit', '0.4');
		await expectHarnessData(canvasElement, 'lastPath', FALLOFF_PATH);
		await expect(getNumberBox(canvasElement, `${FALLOFF_LABEL} value`).value).toBe('0.4');
	}}
/>

<Story
	name="UserPressesAnArrowKeyAndCommitsWithoutAPreviewStorm"
	args={{
		path: FALLOFF_PATH,
		spec: FALLOFF_SPEC,
		defaultValue: 0.7
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const slider = getSlider(canvasElement, FALLOFF_LABEL);
		slider.focus();

		pressArrowKey(slider, 0.75);

		await expectHarnessData(canvasElement, 'commitCount', '1');
		await expectHarnessData(canvasElement, 'lastCommit', '0.75');
		await expectHarnessData(canvasElement, 'previewCount', '0');

		pressArrowKey(slider, 0.8);
		pressArrowKey(slider, 0.85);

		// One commit per key press, and still not a single preview.
		await expectHarnessData(canvasElement, 'commitCount', '3');
		await expectHarnessData(canvasElement, 'lastCommit', '0.85');
		await expectHarnessData(canvasElement, 'previewCount', '0');
	}}
/>

<Story
	name="UserTypesAValueOutsideTheSliderRange"
	args={{
		path: FALLOFF_PATH,
		spec: FALLOFF_SPEC,
		defaultValue: 0.7
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const box = getNumberBox(canvasElement, `${FALLOFF_LABEL} value`);

		typeValue(box, '5');

		await expectHarnessData(canvasElement, 'commitCount', '1');
		await expectHarnessData(canvasElement, 'lastCommit', '5');
		await expectHarnessData(canvasElement, 'value', '5');
		// The numeric box shows the truth; the slider thumb folds onto its own max.
		await waitFor(() => expect(box.value).toBe('5'));
		expect(getSlider(canvasElement, FALLOFF_LABEL).value).toBe('1');
		expect(getHarness(canvasElement).querySelector('[data-out-of-range="true"]')).not.toBeNull();
	}}
/>

<Story
	name="UserTypesNonsenseAndTheFieldRevertsToItsValue"
	args={{
		path: ARROW_PATH,
		spec: ARROW_SPEC,
		defaultValue: 10
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const box = getNumberBox(canvasElement, `${ARROW_LABEL} value`);

		typeValue(box, 'not a number');

		await expectHarnessData(canvasElement, 'commitCount', '0');
		await expectHarnessData(canvasElement, 'value', '10');
		await waitFor(() => expect(box.value).toBe('10'));
	}}
/>

<Story
	name="UserSeesNoResetButtonUntilTheFieldIsModified"
	args={{
		path: ARROW_PATH,
		spec: ARROW_SPEC,
		defaultValue: 10
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);

		expect(canvas.queryByRole('button', { name: `Reset ${ARROW_LABEL}` })).not.toBeInTheDocument();
		expect(getHarness(canvasElement).querySelector('[data-modified="true"]')).toBeNull();

		dragSlider(getSlider(canvasElement, ARROW_LABEL), [24]);

		const reset = await canvas.findByRole('button', { name: `Reset ${ARROW_LABEL}` });
		await expectHarnessData(canvasElement, 'value', '24');
		expect(getHarness(canvasElement).querySelector('[data-modified="true"]')).not.toBeNull();

		await userEvent.click(reset);

		await expectHarnessData(canvasElement, 'resetCount', '1');
		await expectHarnessData(canvasElement, 'value', '10');
		await waitFor(() =>
			expect(canvas.queryByRole('button', { name: `Reset ${ARROW_LABEL}` })).not.toBeInTheDocument()
		);
	}}
/>

<Story
	name="UserTogglesABooleanFieldAndItCommitsImmediately"
	args={{
		path: TOGGLE_PATH,
		spec: TOGGLE_SPEC,
		defaultValue: true
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);
		const toggle = canvas.getByRole('switch', { name: TOGGLE_LABEL });

		await userEvent.click(toggle);

		await expectHarnessData(canvasElement, 'commitCount', '1');
		await expectHarnessData(canvasElement, 'lastCommit', 'false');
		await expectHarnessData(canvasElement, 'previewCount', '0');
		await expectHarnessData(canvasElement, 'value', 'false');

		await userEvent.click(await canvas.findByRole('button', { name: `Reset ${TOGGLE_LABEL}` }));

		await expectHarnessData(canvasElement, 'resetCount', '1');
		await expectHarnessData(canvasElement, 'value', 'true');
	}}
/>

<Story
	name="UserEditsAnUnboundedNumberField"
	args={{
		path: NUMBER_PATH,
		spec: NUMBER_SPEC,
		defaultValue: 500
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);
		const box = getNumberBox(canvasElement, NUMBER_LABEL);

		expect(canvas.queryByRole('slider')).not.toBeInTheDocument();

		// Integer fields round rather than commit a fraction.
		typeValue(box, '412.6');

		await expectHarnessData(canvasElement, 'commitCount', '1');
		await expectHarnessData(canvasElement, 'lastCommit', '413');
		await expectHarnessData(canvasElement, 'previewCount', '0');
	}}
/>

<Story
	name="HiddenFieldRendersNothing"
	args={{
		path: HIDDEN_PATH,
		spec: HIDDEN_SPEC,
		defaultValue: 200
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const harness = getHarness(canvasElement);

		expect(harness.querySelector('[data-setting-path]')).toBeNull();
		expect(harness.querySelector('input')).toBeNull();
		expect(harness.querySelector('button')).toBeNull();
	}}
/>
