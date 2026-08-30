<script lang="ts">
	import { clearOverride, readConfigDefault } from '$lib/config/configOverrides';
	import type { ConfigOverrides } from '$lib/config/configOverrides';
	import type { ConfigPath, ConfigValue } from '$lib/config/configPaths';
	import SettingField from './SettingField.svelte';
	import {
		buildPanelSections,
		clearSectionOverrides,
		countOverridden,
		hasAnyOverride,
		isOverridden
	} from './lib/panelSections';
	import type { PanelSection } from './lib/panelSections';

	/**
	 * The schema-driven settings panel: every non-hidden `APP_CONFIG` leaf, in
	 * sections derived from its own path (see `lib/panelSections.ts`).
	 *
	 * It holds **no config state**. The values it shows are `overrides` merged
	 * over the shipped defaults, and every change leaves through a callback:
	 *
	 * - `onPreview` — a slider moving under the pointer. Transient by definition;
	 *   it must never reach `overrides`, which is why it is a channel of its own.
	 * - `onCommit` — the single value the user settled on. The **parent** applies
	 *   `setOverride`, so the "a value equal to the default clears the key" rule
	 *   lives in exactly one place rather than being re-implemented here.
	 * - `onOverridesChange` — the reset actions, which are pure removals the panel
	 *   can compute exactly: one field, one section, or everything.
	 *
	 * Advanced fields are not rendered until the group is opened, so the panel
	 * mounts 15 controls rather than 69 and a collapsed field cannot be found by
	 * anything walking the DOM.
	 */
	let {
		overrides,
		onPreview,
		onCommit,
		onOverridesChange,
		onClose
	}: {
		overrides: ConfigOverrides;
		onPreview?: (path: ConfigPath, value: ConfigValue) => void;
		onCommit: (path: ConfigPath, value: ConfigValue) => void;
		onOverridesChange: (next: ConfigOverrides) => void;
		onClose: () => void;
	} = $props();

	// The schema is a module constant, so the grouping is computed once.
	const sections = buildPanelSections();
	const advancedFieldCount = sections.advanced.reduce(
		(total, section) => total + section.fields.length,
		0
	);

	let advancedOpen = $state(false);

	const anyOverride = $derived(hasAnyOverride(overrides));

	/** The override if there is one, otherwise the shipped default. */
	function valueFor(path: ConfigPath): ConfigValue | undefined {
		return overrides[path] ?? readConfigDefault(path);
	}

	function resetField(path: ConfigPath): void {
		onOverridesChange(clearOverride(overrides, path));
	}

	function resetSection(section: PanelSection): void {
		onOverridesChange(clearSectionOverrides(overrides, section.fields));
	}

	function resetAll(): void {
		onOverridesChange({});
	}
</script>

{#snippet sectionBlock(section: PanelSection)}
	{@const modifiedCount = countOverridden(section.fields, overrides)}
	<div
		class="config-section"
		data-section-id={section.id}
		data-section-prefix={section.prefix}
		data-modified-count={modifiedCount}
	>
		<div class="section-header">
			<h3>{section.title}</h3>
			{#if modifiedCount > 0}
				<button
					type="button"
					class="reset"
					aria-label={`Reset ${section.title} section`}
					onclick={() => resetSection(section)}
				>
					Reset
				</button>
			{/if}
		</div>

		{#if !section.hasLivePreview}
			<p class="no-preview">changes here have no live preview</p>
		{/if}

		{#each section.fields as field (field.path)}
			{@const value = valueFor(field.path)}
			{#if value !== undefined}
				<SettingField
					path={field.path}
					spec={field.spec}
					{value}
					isModified={isOverridden(overrides, field.path)}
					{onPreview}
					{onCommit}
					onReset={resetField}
				/>
			{/if}
		{/each}
	</div>
{/snippet}

<section class="settings-panel" aria-label="Settings" data-advanced-open={advancedOpen}>
	<header>
		<h2>Settings</h2>
		<div class="header-actions">
			{#if anyOverride}
				<button type="button" class="quiet" onclick={resetAll}>Reset all</button>
			{/if}
			<button type="button" class="quiet" onclick={onClose}>Close</button>
		</div>
	</header>

	<div class="sections">
		{#each sections.basic as section (section.id)}
			{@render sectionBlock(section)}
		{/each}
	</div>

	<div class="advanced">
		<button
			type="button"
			class="advanced-toggle"
			aria-expanded={advancedOpen}
			onclick={() => (advancedOpen = !advancedOpen)}
		>
			<span class="marker" aria-hidden="true">{advancedOpen ? '▾' : '▸'}</span>
			<span>Advanced</span>
			<span class="count">{advancedFieldCount}</span>
		</button>

		{#if advancedOpen}
			<div class="sections" data-advanced-body="true">
				{#each sections.advanced as section (section.id)}
					{@render sectionBlock(section)}
				{/each}
			</div>
		{/if}
	</div>
</section>

<style>
	.settings-panel {
		position: absolute;
		z-index: 30;
		left: 0.75rem;
		top: 0.75rem;
		display: grid;
		gap: 0.75rem;
		box-sizing: border-box;
		width: min(30rem, calc(100vw - 1.5rem));
		max-height: calc(100vh - 1.5rem);
		overflow: auto;
		padding: 0.875rem;
		border: 1px solid #cbd5e1;
		border-radius: 0.5rem;
		background: rgb(255 255 255 / 96%);
		color: #0f172a;
		box-shadow: 0 14px 40px rgb(15 23 42 / 18%);
		pointer-events: auto;
	}

	header,
	.header-actions,
	.section-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	header {
		justify-content: space-between;
	}

	h2,
	h3,
	p {
		margin: 0;
	}

	h2 {
		font-size: 1rem;
	}

	h3 {
		flex: 1 1 auto;
		color: #334155;
		font-size: 0.85rem;
	}

	.sections {
		display: grid;
		gap: 0.625rem;
	}

	.config-section {
		display: grid;
		gap: 0.125rem;
		padding-top: 0.375rem;
		border-top: 1px solid #e2e8f0;
	}

	.section-header {
		min-height: 1.5rem;
	}

	.no-preview {
		color: #64748b;
		font-size: 0.7rem;
		font-style: italic;
	}

	button {
		border: 0;
		border-radius: 999px;
		padding: 0.35rem 0.625rem;
		background: #0f172a;
		color: #ffffff;
		font: inherit;
		font-size: 0.75rem;
		cursor: pointer;
	}

	.quiet {
		background: #e2e8f0;
		color: #0f172a;
	}

	.reset {
		flex: 0 0 auto;
		border: 1px solid #cbd5e1;
		border-radius: 0.5rem;
		padding: 0.125rem 0.375rem;
		background: #f8fafc;
		color: #475569;
		font-size: 0.7rem;
	}

	.reset:hover {
		background: #e2e8f0;
	}

	.advanced-toggle {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		width: 100%;
		border: 1px solid #cbd5e1;
		border-radius: 0.5rem;
		padding: 0.375rem 0.5rem;
		background: #f8fafc;
		color: #0f172a;
		font-size: 0.8rem;
		text-align: left;
	}

	.marker {
		color: #64748b;
	}

	.count {
		margin-left: auto;
		border-radius: 999px;
		padding: 0 0.375rem;
		background: #e2e8f0;
		color: #475569;
		font-size: 0.7rem;
	}

	.advanced {
		display: grid;
		gap: 0.625rem;
	}

	@media (max-width: 640px) {
		.settings-panel {
			top: auto;
			right: 0;
			bottom: 0;
			left: 0;
			width: 100%;
			max-height: 70vh;
			border-right: 0;
			border-bottom: 0;
			border-left: 0;
			border-radius: 0.5rem 0.5rem 0 0;
		}
	}
</style>
