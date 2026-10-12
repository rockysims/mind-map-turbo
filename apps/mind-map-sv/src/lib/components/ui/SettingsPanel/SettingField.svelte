<script lang="ts">
	import type { ConfigPath, ConfigValue } from '$lib/config/configPaths';
	import type { FieldSpec } from '$lib/config/configSchema';
	import SettingNumber from './SettingNumber.svelte';
	import SettingRange from './SettingRange.svelte';
	import SettingSelect from './SettingSelect.svelte';
	import SettingToggle from './SettingToggle.svelte';

	/**
	 * Schema-driven dispatcher for one config leaf.
	 *
	 * It owns the shared chrome — the label row, the "modified" dot, the help text
	 * — and hands the rest (unit suffix, the per-field reset button that appears
	 * only when the field is overridden) to the control, so the compact single
	 * control row stays one flex row no matter which control is chosen.
	 *
	 * Every callback carries the `path` back, so a panel rendering 69 of these can
	 * share one handler instead of closing over the path 69 times.
	 *
	 * Renders nothing for a `hidden` spec, and nothing when the value's runtime
	 * type disagrees with the spec's control — a panel with one mistyped override
	 * must not lose the other 68 fields. A `select` also renders nothing when its
	 * string is not one of the options: a `<select>` cannot show a value it does
	 * not offer.
	 */
	let {
		path,
		spec,
		value,
		isModified,
		onPreview,
		onCommit,
		onReset
	}: {
		path: ConfigPath;
		spec: FieldSpec;
		value: ConfigValue;
		isModified: boolean;
		onPreview?: (path: ConfigPath, value: ConfigValue) => void;
		onCommit: (path: ConfigPath, value: ConfigValue) => void;
		onReset: (path: ConfigPath) => void;
	} = $props();

	type ToggleSpec = Extract<FieldSpec, { control: 'toggle' }>;
	type SelectSpec = Extract<FieldSpec, { control: 'select' }>;
	type RangeSpec = Extract<FieldSpec, { control: 'range' }>;
	type NumberSpec = Extract<FieldSpec, { control: 'number' }>;

	type FieldView =
		| { kind: 'toggle'; spec: ToggleSpec; value: boolean }
		| { kind: 'select'; spec: SelectSpec; value: string }
		| { kind: 'range'; spec: RangeSpec; value: number }
		| { kind: 'number'; spec: NumberSpec; value: number };

	const view = $derived.by<FieldView | null>(() => {
		switch (spec.control) {
			case 'hidden':
				return null;
			case 'toggle':
				return typeof value === 'boolean' ? { kind: 'toggle', spec, value } : null;
			case 'select':
				return typeof value === 'string' && spec.options.some((option) => option.value === value)
					? { kind: 'select', spec, value }
					: null;
			case 'range':
				return typeof value === 'number' ? { kind: 'range', spec, value } : null;
			case 'number':
				return typeof value === 'number' ? { kind: 'number', spec, value } : null;
		}
	});

	/**
	 * The field's help, followed by the chosen option's own help for a select,
	 * so the line under "Border shows" says what the chosen source measures.
	 */
	const helpText = $derived.by<string | undefined>(() => {
		if (view === null) return undefined;
		const optionHelp =
			view.kind === 'select'
				? view.spec.options.find((option) => option.value === view.value)?.help
				: undefined;
		const parts = [view.spec.help, optionHelp].filter((part) => part !== undefined && part !== '');
		return parts.length > 0 ? parts.join(' ') : undefined;
	});
</script>

{#if view}
	<div
		class="setting-field"
		data-setting-path={path}
		data-control={view.kind}
		data-tier={view.spec.tier}
		data-preview={view.spec.preview}
		data-modified={isModified}
	>
		<div class="label-row">
			<span class="label">{view.spec.label}</span>
			{#if isModified}
				<span class="dot" title="Changed from the default"></span>
				<span class="sr-only">Modified</span>
			{/if}
		</div>

		{#if helpText}
			<p class="help">{helpText}</p>
		{/if}

		{#if view.kind === 'toggle'}
			<SettingToggle
				label={view.spec.label}
				help={view.spec.help}
				value={view.value}
				{isModified}
				onCommit={(next) => onCommit(path, next)}
				onReset={() => onReset(path)}
			/>
		{:else if view.kind === 'select'}
			<SettingSelect
				label={view.spec.label}
				help={helpText}
				options={view.spec.options}
				value={view.value}
				{isModified}
				onCommit={(next) => onCommit(path, next)}
				onReset={() => onReset(path)}
			/>
		{:else if view.kind === 'range'}
			<SettingRange
				label={view.spec.label}
				help={view.spec.help}
				unit={view.spec.unit}
				min={view.spec.min}
				max={view.spec.max}
				step={view.spec.step}
				value={view.value}
				{isModified}
				onPreview={(next) => onPreview?.(path, next)}
				onCommit={(next) => onCommit(path, next)}
				onReset={() => onReset(path)}
			/>
		{:else}
			<SettingNumber
				label={view.spec.label}
				help={view.spec.help}
				unit={view.spec.unit}
				min={view.spec.min}
				max={view.spec.max}
				step={view.spec.step}
				integer={view.spec.integer}
				value={view.value}
				{isModified}
				onCommit={(next) => onCommit(path, next)}
				onReset={() => onReset(path)}
			/>
		{/if}
	</div>
{/if}

<style>
	.setting-field {
		display: grid;
		gap: 0.125rem;
		padding: 0.25rem 0;
	}

	.label-row {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.label {
		color: #0f172a;
		font-size: 0.8rem;
	}

	.dot {
		width: 0.375rem;
		height: 0.375rem;
		border-radius: 999px;
		background: #0f172a;
	}

	.help {
		margin: 0;
		color: #475569;
		font-size: 0.7rem;
		line-height: 1.3;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
