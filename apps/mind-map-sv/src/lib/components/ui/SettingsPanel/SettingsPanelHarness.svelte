<script lang="ts">
	import { setOverride } from '$lib/config/configOverrides';
	import type { ConfigOverrides } from '$lib/config/configOverrides';
	import type { ConfigPath, ConfigValue } from '$lib/config/configPaths';
	import type { SettingsImportOutcome } from '$lib/graphFile';
	import SettingsPanel from './SettingsPanel.svelte';

	/**
	 * Story harness: owns the overrides the way `Multigraph` will in T08 —
	 * commits go through `setOverride` (so a value equal to the default drops the
	 * key), resets arrive as a whole next map — and exposes the result plus every
	 * callback firing as `data-*` attributes, per the `StageHarness` pattern.
	 *
	 * Previews deliberately touch nothing but their counters: in the real app a
	 * preview feeds a component-local layer, never the persisted overrides.
	 *
	 * `onImportSettings` and `onSaveSeed` are optional overrides for the panel's
	 * own defaults (real file parsing, real `localStorage`), so a story can drive
	 * the footer deterministically without a real file or touching browser
	 * storage other stories share.
	 */
	let {
		initialOverrides = {},
		onImportSettings
	}: {
		initialOverrides?: ConfigOverrides;
		onImportSettings?: (fileText: string) => SettingsImportOutcome;
	} = $props();

	let overrides = $state<ConfigOverrides>(overridesAtMount());
	let previewCount = $state(0);
	let commitCount = $state(0);
	let overridesChangeCount = $state(0);
	let closeCount = $state(0);
	let saveSeedCount = $state(0);
	let lastSeedOverrides = $state('');
	let lastPreviewPath = $state('');
	let lastPreviewValue = $state('');
	let lastCommitPath = $state('');
	let lastCommitValue = $state('');

	function handleSaveSeed(next: ConfigOverrides): void {
		saveSeedCount += 1;
		lastSeedOverrides = JSON.stringify(next);
	}

	/** Seeds the harness once, the way a graph seeds from its stored settings. */
	function overridesAtMount(): ConfigOverrides {
		return { ...initialOverrides };
	}

	const overridePaths = $derived(Object.keys(overrides).sort());
	const overridesJson = $derived(JSON.stringify(overrides));

	function handlePreview(path: ConfigPath, value: ConfigValue): void {
		previewCount += 1;
		lastPreviewPath = path;
		lastPreviewValue = String(value);
	}

	function handleCommit(path: ConfigPath, value: ConfigValue): void {
		commitCount += 1;
		lastCommitPath = path;
		lastCommitValue = String(value);
		overrides = setOverride(overrides, path, value);
	}

	function handleOverridesChange(next: ConfigOverrides): void {
		overridesChangeCount += 1;
		overrides = next;
	}
</script>

<div
	class="harness"
	data-overrides={overridesJson}
	data-override-count={overridePaths.length}
	data-override-paths={overridePaths.join(' ')}
	data-preview-count={previewCount}
	data-last-preview-path={lastPreviewPath}
	data-last-preview-value={lastPreviewValue}
	data-commit-count={commitCount}
	data-last-commit-path={lastCommitPath}
	data-last-commit-value={lastCommitValue}
	data-overrides-change-count={overridesChangeCount}
	data-close-count={closeCount}
	data-save-seed-count={saveSeedCount}
	data-last-seed-overrides={lastSeedOverrides}
>
	<SettingsPanel
		{overrides}
		onPreview={handlePreview}
		onCommit={handleCommit}
		onOverridesChange={handleOverridesChange}
		onClose={() => (closeCount += 1)}
		{onImportSettings}
		onSaveSeed={handleSaveSeed}
	/>
</div>

<style>
	.harness {
		position: relative;
		box-sizing: border-box;
		min-height: 34rem;
		background: #f1f5f9;
		color: #0f172a;
		font-size: 0.875rem;
	}
</style>
