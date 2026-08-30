<script lang="ts">
	/**
	 * Story harness for the settings panel wired into a live canvas.
	 *
	 * It plays the part `+page.svelte` plays: it owns `settingsPanelOpen`, it owns
	 * the graph's overrides, and it applies a commit by keeping the map it is
	 * handed — `Multigraph` has already run it through `setOverride`. Every
	 * firing is republished as a `data-*` attribute, per the `StageHarness`
	 * pattern, so a story asserts on the DOM rather than on a spy it also has to
	 * thread through `args`.
	 *
	 * The toggle button stands in for the toolbar's Settings pill, which lives
	 * above the canvas in the real page and so cannot be reached from here.
	 */
	import Multigraph from './Multigraph.svelte';
	import type { ConfigOverrides } from '$lib/config/configOverrides';
	import type { LayoutSettings } from './lib/layoutSettings';
	import type { MultigraphData } from '../types/multigraph';

	let {
		multigraphData,
		layoutSettings = {},
		defaultPrimaryNodeId = '',
		initialSettings = {},
		panelOpenAtMount = false
	}: {
		multigraphData: MultigraphData;
		layoutSettings?: Partial<LayoutSettings>;
		defaultPrimaryNodeId?: string;
		initialSettings?: ConfigOverrides;
		panelOpenAtMount?: boolean;
	} = $props();

	let settings = $state<ConfigOverrides>({ ...initialSettings });
	let settingsPanelOpen = $state(panelOpenAtMount);
	let settingsChangeCount = $state(0);

	const settingsJson = $derived(JSON.stringify(settings));
</script>

<div
	class="harness"
	data-settings={settingsJson}
	data-settings-change-count={settingsChangeCount}
	data-settings-panel-open={settingsPanelOpen}
>
	<button
		type="button"
		class="open-settings"
		aria-haspopup="dialog"
		aria-expanded={settingsPanelOpen}
		onclick={() => (settingsPanelOpen = !settingsPanelOpen)}
	>
		Settings
	</button>

	<Multigraph
		{multigraphData}
		{layoutSettings}
		{defaultPrimaryNodeId}
		{settings}
		{settingsPanelOpen}
		onSettingsChange={(next) => {
			settingsChangeCount += 1;
			settings = next;
		}}
		onSettingsPanelClose={() => (settingsPanelOpen = false)}
	/>
</div>

<style>
	.open-settings {
		position: fixed;
		z-index: 50;
		top: 0.25rem;
		right: 0.25rem;
		border: 1px solid #cbd5e1;
		border-radius: 999px;
		padding: 0.25rem 0.5rem;
		background: #ffffff;
		color: #0f172a;
		font: inherit;
		font-size: 0.75rem;
		cursor: pointer;
	}
</style>
