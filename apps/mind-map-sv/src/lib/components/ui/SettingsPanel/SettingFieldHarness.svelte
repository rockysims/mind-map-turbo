<script lang="ts">
	import type { ConfigPath, ConfigValue } from '$lib/config/configPaths';
	import type { FieldSpec } from '$lib/config/configSchema';
	import SettingField from './SettingField.svelte';

	/**
	 * Story harness: holds the value the way `SettingsPanel` (T07) will, and
	 * exposes every callback firing as a `data-*` attribute so story `play`
	 * functions can assert on counts rather than on spies.
	 */
	let {
		path,
		spec,
		defaultValue,
		initialValue = defaultValue
	}: {
		path: ConfigPath;
		spec: FieldSpec;
		defaultValue: ConfigValue;
		initialValue?: ConfigValue;
	} = $props();

	let value = $state<ConfigValue>(initialValueAtMount());
	let previewCount = $state(0);
	let commitCount = $state(0);
	let resetCount = $state(0);
	let lastPreview = $state('');
	let lastCommit = $state('');
	let lastPath = $state('');

	const isModified = $derived(value !== defaultValue);

	/** Seeds the harness once, the way a panel seeds from stored overrides. */
	function initialValueAtMount(): ConfigValue {
		return initialValue;
	}

	function handlePreview(nextPath: ConfigPath, nextValue: ConfigValue): void {
		previewCount += 1;
		lastPreview = String(nextValue);
		lastPath = nextPath;
		value = nextValue;
	}

	function handleCommit(nextPath: ConfigPath, nextValue: ConfigValue): void {
		commitCount += 1;
		lastCommit = String(nextValue);
		lastPath = nextPath;
		value = nextValue;
	}

	function handleReset(nextPath: ConfigPath): void {
		resetCount += 1;
		lastPath = nextPath;
		value = defaultValue;
	}
</script>

<div
	class="harness"
	data-preview-count={previewCount}
	data-commit-count={commitCount}
	data-reset-count={resetCount}
	data-last-preview={lastPreview}
	data-last-commit={lastCommit}
	data-last-path={lastPath}
	data-value={String(value)}
	data-modified={isModified}
>
	<SettingField
		{path}
		{spec}
		{value}
		{isModified}
		onPreview={handlePreview}
		onCommit={handleCommit}
		onReset={handleReset}
	/>
</div>

<style>
	.harness {
		box-sizing: border-box;
		width: min(24rem, 100%);
		padding: 0.75rem;
		border: 1px solid #cbd5e1;
		border-radius: 0.5rem;
		background: #ffffff;
		color: #0f172a;
		font-size: 0.875rem;
	}
</style>
