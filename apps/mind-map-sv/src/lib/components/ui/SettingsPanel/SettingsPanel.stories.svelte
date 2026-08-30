<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, userEvent, waitFor, within } from 'storybook/test';
	import { CONFIG_SCHEMA } from '$lib/config/configSchema';
	import type { ConfigOverrides } from '$lib/config/configOverrides';
	import SettingsPanelHarness from './SettingsPanelHarness.svelte';

	const { Story } = defineMeta({
		title: 'Components/SettingsPanel',
		component: SettingsPanelHarness,
		tags: [],
		argTypes: {
			initialOverrides: { control: false }
		}
	});

	type PlayContext = {
		canvasElement: HTMLElement;
	};

	const schemaEntries = Object.entries(CONFIG_SCHEMA);
	const VISIBLE_PATHS = schemaEntries
		.filter(([, spec]) => spec.control !== 'hidden')
		.map(([path]) => path);
	const HIDDEN_PATHS = schemaEntries
		.filter(([, spec]) => spec.control === 'hidden')
		.map(([path]) => path);
	const BASIC_PATH_COUNT = schemaEntries.filter(
		([, spec]) => spec.control !== 'hidden' && spec.tier === 'basic'
	).length;

	/** Ten overrides spread across nine sections, five of them advanced. */
	const SPREAD_OVERRIDES: ConfigOverrides = {
		'multigraph.nodeTextFontSizePx': 48,
		'multigraph.edgeArrow.lengthPx': 18,
		'multigraph.edgeStroke.widthPx': 4,
		'multigraph.zoom.minScale': 0.2,
		'multigraph.layout.scaleFalloff': 0.45,
		'interaction.longPressMs': 1500,
		'math.maxSizeEm': 20,
		'multigraph.focus.entryTransitionMs': 320,
		'multigraph.dataflow.labelMinStageScale': 1.2,
		'multigraph.layout.relaxIterations': 30
	};

	const BASIC_OVERRIDE_PATHS = [
		'multigraph.edgeArrow.lengthPx',
		'multigraph.edgeStroke.widthPx',
		'multigraph.layout.scaleFalloff',
		'multigraph.nodeTextFontSizePx',
		'multigraph.zoom.minScale'
	];

	function getHarness(canvasElement: HTMLElement): HTMLElement {
		const harness = canvasElement.querySelector('.harness');
		if (!(harness instanceof HTMLElement)) throw new Error('Harness not found');
		return harness;
	}

	function renderedPaths(canvasElement: HTMLElement): string[] {
		return [...canvasElement.querySelectorAll('[data-setting-path]')].map(
			(element) => element.getAttribute('data-setting-path') ?? ''
		);
	}

	function modifiedPaths(canvasElement: HTMLElement): string[] {
		return [...canvasElement.querySelectorAll('[data-setting-path][data-modified="true"]')]
			.map((element) => element.getAttribute('data-setting-path') ?? '')
			.sort();
	}

	function sectionEl(canvasElement: HTMLElement, id: string): HTMLElement {
		const section = canvasElement.querySelector(`[data-section-id="${id}"]`);
		if (!(section instanceof HTMLElement)) throw new Error(`Section ${id} not found`);
		return section;
	}

	function getSlider(canvasElement: HTMLElement, label: string): HTMLInputElement {
		const slider = within(canvasElement).getByRole('slider', { name: label });
		if (!(slider instanceof HTMLInputElement)) throw new Error(`Slider ${label} not found`);
		return slider;
	}

	function getNumberBox(canvasElement: HTMLElement, label: string): HTMLInputElement {
		const box = within(canvasElement).getByRole('spinbutton', { name: `${label} value` });
		if (!(box instanceof HTMLInputElement)) throw new Error(`Numeric input ${label} not found`);
		return box;
	}

	/**
	 * The event contract a real pointer drag produces on a range input: one
	 * `input` per movement, then a single `change` on release. Omitting the
	 * release models a drag still in progress.
	 */
	function dragSlider(slider: HTMLInputElement, steps: number[], release = true): void {
		for (const step of steps) {
			slider.value = String(step);
			slider.dispatchEvent(new Event('input', { bubbles: true }));
		}
		if (release) slider.dispatchEvent(new Event('change', { bubbles: true }));
	}

	async function expectHarnessData(
		canvasElement: HTMLElement,
		name: string,
		value: string
	): Promise<void> {
		const harness = getHarness(canvasElement);
		await waitFor(() => expect(harness.dataset[name]).toBe(value));
	}

	async function openAdvanced(canvasElement: HTMLElement): Promise<void> {
		await userEvent.click(within(canvasElement).getByRole('button', { name: /Advanced/ }));
		await waitFor(() => expect(canvasElement.querySelector('[data-advanced-body]')).not.toBeNull());
	}
</script>

<Story
	name="UserOpensAdvancedAndClosesItAgain"
	args={{ initialOverrides: {} }}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);

		// Collapsed: only the basic tier is in the DOM at all.
		expect(renderedPaths(canvasElement)).toHaveLength(BASIC_PATH_COUNT);
		expect(canvas.queryByRole('slider', { name: 'Relax iterations' })).not.toBeInTheDocument();
		expect(canvas.queryByRole('spinbutton', { name: 'Relax iterations' })).not.toBeInTheDocument();

		await openAdvanced(canvasElement);

		await waitFor(() => expect(renderedPaths(canvasElement)).toHaveLength(VISIBLE_PATHS.length));
		expect(canvas.getByRole('spinbutton', { name: 'Relax iterations' })).toBeInTheDocument();
		expect(sectionEl(canvasElement, 'advanced:interaction')).toBeInTheDocument();

		await userEvent.click(canvas.getByRole('button', { name: /Advanced/ }));

		await waitFor(() => expect(renderedPaths(canvasElement)).toHaveLength(BASIC_PATH_COUNT));
		expect(canvasElement.querySelector('[data-advanced-body]')).toBeNull();
		expect(canvas.queryByRole('spinbutton', { name: 'Relax iterations' })).not.toBeInTheDocument();

		await userEvent.click(canvas.getByRole('button', { name: 'Close' }));
		await expectHarnessData(canvasElement, 'closeCount', '1');
	}}
/>

<Story
	name="UserResetsOneSectionWithoutTouchingAnother"
	args={{ initialOverrides: {} }}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);

		dragSlider(getSlider(canvasElement, 'Minimum zoom'), [0.2]);
		dragSlider(getSlider(canvasElement, 'Maximum zoom'), [8]);
		dragSlider(getSlider(canvasElement, 'Scale falloff per hop'), [0.45]);

		await expectHarnessData(
			canvasElement,
			'overridePaths',
			'multigraph.layout.scaleFalloff multigraph.zoom.maxScale multigraph.zoom.minScale'
		);
		await waitFor(() =>
			expect(sectionEl(canvasElement, 'basic:multigraph.zoom').dataset.modifiedCount).toBe('2')
		);

		await userEvent.click(canvas.getByRole('button', { name: 'Reset Zoom section' }));

		// Only the zoom section went back to its defaults.
		await expectHarnessData(canvasElement, 'overridePaths', 'multigraph.layout.scaleFalloff');
		await expectHarnessData(canvasElement, 'overridesChangeCount', '1');
		expect(modifiedPaths(canvasElement)).toEqual(['multigraph.layout.scaleFalloff']);
		await waitFor(() => expect(getNumberBox(canvasElement, 'Minimum zoom').value).toBe('0.05'));
		expect(getNumberBox(canvasElement, 'Maximum zoom').value).toBe('4');
		expect(getNumberBox(canvasElement, 'Scale falloff per hop').value).toBe('0.45');
		expect(canvas.queryByRole('button', { name: 'Reset Zoom section' })).not.toBeInTheDocument();
	}}
/>

<Story
	name="UserResetsEverySettingAtOnce"
	args={{ initialOverrides: SPREAD_OVERRIDES }}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);

		await expectHarnessData(canvasElement, 'overrideCount', '10');

		await userEvent.click(canvas.getByRole('button', { name: 'Reset all' }));

		await expectHarnessData(canvasElement, 'overrides', '{}');
		await expectHarnessData(canvasElement, 'overrideCount', '0');
		await expectHarnessData(canvasElement, 'overridesChangeCount', '1');
		expect(modifiedPaths(canvasElement)).toEqual([]);
		expect(canvas.queryByRole('button', { name: 'Reset all' })).not.toBeInTheDocument();

		// Advanced fields were cleared too, even though they were never mounted.
		await openAdvanced(canvasElement);
		expect(modifiedPaths(canvasElement)).toEqual([]);
	}}
/>

<Story
	name="UserSeesModifiedIndicatorsForEverySavedOverride"
	args={{ initialOverrides: SPREAD_OVERRIDES }}
	play={async ({ canvasElement }: PlayContext) => {
		expect(modifiedPaths(canvasElement)).toEqual(BASIC_OVERRIDE_PATHS);

		await openAdvanced(canvasElement);

		await waitFor(() =>
			expect(modifiedPaths(canvasElement)).toEqual(Object.keys(SPREAD_OVERRIDES).sort())
		);
		// A sibling in an overridden section is still unmarked.
		const sibling = sectionEl(canvasElement, 'basic:multigraph.zoom').querySelector(
			'[data-setting-path="multigraph.zoom.maxScale"]'
		);
		expect(sibling).not.toBeNull();
		expect(sibling?.getAttribute('data-modified')).not.toBe('true');
		expect(sectionEl(canvasElement, 'advanced:math').dataset.modifiedCount).toBe('1');
		expect(sectionEl(canvasElement, 'advanced:multigraph.layout').dataset.modifiedCount).toBe('1');
	}}
/>

<Story
	name="UserNeverSeesAHiddenSetting"
	args={{ initialOverrides: {} }}
	play={async ({ canvasElement }: PlayContext) => {
		await openAdvanced(canvasElement);

		const paths = renderedPaths(canvasElement);

		expect([...paths].sort()).toEqual([...VISIBLE_PATHS].sort());
		expect(HIDDEN_PATHS.length).toBeGreaterThan(0);
		for (const hidden of HIDDEN_PATHS) expect(paths).not.toContain(hidden);
		expect(canvasElement.querySelector('[data-section-prefix="persistence"]')).toBeNull();
		expect(canvasElement.querySelector('[data-section-prefix="multigraph.tagSyntax"]')).toBeNull();
	}}
/>

<Story
	name="UserSeesPreviewsWhileDraggingWithoutSavingThem"
	args={{ initialOverrides: {} }}
	play={async ({ canvasElement }: PlayContext) => {
		const slider = getSlider(canvasElement, 'Scale falloff per hop');

		// A drag still in flight: input events only, no release.
		dragSlider(slider, [0.6, 0.5, 0.4], false);

		await expectHarnessData(canvasElement, 'previewCount', '3');
		await expectHarnessData(canvasElement, 'lastPreviewPath', 'multigraph.layout.scaleFalloff');
		await expectHarnessData(canvasElement, 'lastPreviewValue', '0.4');
		await expectHarnessData(canvasElement, 'commitCount', '0');
		await expectHarnessData(canvasElement, 'overrides', '{}');
		expect(modifiedPaths(canvasElement)).toEqual([]);

		slider.dispatchEvent(new Event('change', { bubbles: true }));

		await expectHarnessData(canvasElement, 'commitCount', '1');
		await expectHarnessData(canvasElement, 'overrides', '{"multigraph.layout.scaleFalloff":0.4}');
		await expectHarnessData(canvasElement, 'previewCount', '3');
	}}
/>
