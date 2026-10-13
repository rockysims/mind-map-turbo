<script lang="ts">
	import { readFileText, resetFileInput } from '$lib/browserGraphFile';
	import { APP_CONFIG } from '$lib/appConfig';
	import { clearOverride, readConfigDefault } from '$lib/config/configOverrides';
	import type { ConfigOverrides } from '$lib/config/configOverrides';
	import type { ConfigPath, ConfigValue } from '$lib/config/configPaths';
	import { writeSettingsSeed } from '$lib/config/settingsSeed';
	import { readSettingsFromGraphFileText, type SettingsImportOutcome } from '$lib/graphFile';
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
	 *
	 * The footer's two actions — import and seed — are also callback props
	 * (`onImportSettings`, `onSaveSeed`), each defaulted to a real
	 * implementation. Every other callback here is a pure hand-off to whichever
	 * component renders this panel (currently `Multigraph.svelte`) precisely so
	 * this component stays free of side effects; these two are the exception.
	 * `Multigraph.svelte` is not touched by this change, and it is the only
	 * place this panel is mounted, so a callback prop with no default would be
	 * unreachable in the shipped app — there would be no caller left to supply
	 * it. Defaulting to the real `readSettingsFromGraphFileText` /
	 * `writeSettingsSeed` keeps the feature working end to end while still
	 * letting a story substitute a fixture, which is the only reason these stay
	 * props rather than plain internal calls.
	 */
	let {
		overrides,
		onPreview,
		onCommit,
		onOverridesChange,
		onClose,
		onImportSettings = readSettingsFromGraphFileText,
		onSaveSeed = saveSeedToLocalStorage
	}: {
		overrides: ConfigOverrides;
		onPreview?: (path: ConfigPath, value: ConfigValue) => void;
		onCommit: (path: ConfigPath, value: ConfigValue) => void;
		onOverridesChange: (next: ConfigOverrides) => void;
		onClose: () => void;
		/** Parses a `.html`/`.json` graph file's text into an import outcome. */
		onImportSettings?: (fileText: string) => SettingsImportOutcome;
		/** Persists `next` as the seed future "New graph" actions will stamp in. */
		onSaveSeed?: (next: ConfigOverrides) => void;
	} = $props();

	/** Default `onSaveSeed`: writes straight to `localStorage`. See the prop doc above. */
	function saveSeedToLocalStorage(next: ConfigOverrides): void {
		if (typeof localStorage === 'undefined') return;
		writeSettingsSeed(localStorage, APP_CONFIG.persistence.storageNamespace, next);
	}

	// The schema is a module constant, so the grouping is computed once.
	const sections = buildPanelSections();
	const advancedFieldCount = sections.advanced.reduce(
		(total, section) => total + section.fields.length,
		0
	);

	let advancedOpen = $state(false);

	const anyOverride = $derived(hasAnyOverride(overrides));
	/** How many settings a Reset all would clear; named on the armed button. */
	const overriddenCount = $derived(Object.keys(overrides).length);

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

	/**
	 * Reset all asks first, in place.
	 *
	 * It is the one reset that can throw away work the reader cannot see — an
	 * override in a collapsed Advanced group, or in a section scrolled off the
	 * panel — so unlike the per-field and per-section resets it takes two
	 * presses. The armed label names the count for that reason: it is the only
	 * way to say how much is about to go.
	 *
	 * Armed in place rather than behind a modal because the reader is already
	 * looking at the thing being reset; a dialog would cover it. The arming
	 * lapses on its own so a panel left open does not keep a destructive button
	 * one stray click away.
	 */
	const RESET_ALL_ARM_MS = 6000;
	/**
	 * A double-click is one gesture, and it must not be able to arm and confirm
	 * in one go — that would hand the reader a confirmation they never saw. The
	 * second press only counts once it is slow enough to have been a decision.
	 */
	const RESET_ALL_MIN_READ_MS = 350;

	let resetAllArmed = $state(false);
	let resetAllArmedAtMs = 0;
	let resetAllArmTimer: ReturnType<typeof setTimeout> | null = null;

	function disarmResetAll(): void {
		if (resetAllArmTimer !== null) clearTimeout(resetAllArmTimer);
		resetAllArmTimer = null;
		resetAllArmed = false;
	}

	function resetAll(): void {
		if (!resetAllArmed) {
			resetAllArmed = true;
			resetAllArmedAtMs = Date.now();
			if (resetAllArmTimer !== null) clearTimeout(resetAllArmTimer);
			resetAllArmTimer = setTimeout(disarmResetAll, RESET_ALL_ARM_MS);
			return;
		}
		// Still inside the double-click window: stay armed and wait for a press
		// that was actually aimed at the question.
		if (Date.now() - resetAllArmedAtMs < RESET_ALL_MIN_READ_MS) return;
		disarmResetAll();
		onOverridesChange({});
	}

	// Nothing left to reset — after the reset itself, or after the last field
	// was reset one at a time — so the armed state has nothing to be about.
	$effect(() => {
		if (!anyOverride && resetAllArmed) disarmResetAll();
	});

	$effect(() => () => {
		if (resetAllArmTimer !== null) clearTimeout(resetAllArmTimer);
	});

	// --- Footer: import from a graph file, and save the current overrides as
	// the seed for new graphs. Both are one-shot actions with no config state
	// of their own; the panel still holds no *settings* state, only the little
	// UI state needed to report what the last action did.

	let importInputEl = $state<HTMLInputElement | undefined>();
	let importResult = $state<SettingsImportOutcome | null>(null);
	let seedSaved = $state(false);

	function openImportPicker(): void {
		seedSaved = false;
		importInputEl?.click();
	}

	async function handleImportFileChange(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0] ?? null;
		resetFileInput(input); // allow reselecting the same file later
		if (!file) return;

		let text: string;
		try {
			text = await readFileText(file);
		} catch {
			importResult = { kind: 'unreadable' };
			return;
		}

		const outcome = onImportSettings(text);
		importResult = outcome;
		if (outcome.kind === 'applied') {
			// Replace, not merge, with the imported overrides. A merge would make
			// repeated imports non-deterministic — a later, narrower import would
			// leave behind keys from an earlier one that it never mentioned — and
			// "replace" is what lets the applied count above equal exactly what
			// this file carries.
			onOverridesChange(outcome.overrides);
		}
	}

	function saveSeed(): void {
		importResult = null;
		onSaveSeed(overrides);
		seedSaved = true;
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
				<button
					type="button"
					class="quiet"
					class:armed={resetAllArmed}
					data-reset-all-armed={resetAllArmed}
					aria-label={resetAllArmed
						? `Confirm resetting all ${overriddenCount} changed settings to their defaults`
						: 'Reset all changed settings to their defaults'}
					onclick={resetAll}
					onblur={disarmResetAll}
				>
					{resetAllArmed ? `Reset all ${overriddenCount}?` : 'Reset all'}
				</button>
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

	<footer class="footer">
		<div class="footer-actions">
			<button type="button" class="quiet" onclick={openImportPicker}>
				Import settings from graph file…
			</button>
			<button type="button" class="quiet" onclick={saveSeed}>
				Use as settings for new graphs
			</button>
		</div>
		<input
			bind:this={importInputEl}
			type="file"
			accept=".html,.json"
			class="visually-hidden"
			aria-label="Import settings from graph file"
			onchange={handleImportFileChange}
		/>

		{#if importResult}
			<p class="footer-message" data-import-outcome={importResult.kind}>
				{#if importResult.kind === 'applied'}
					{@const count = Object.keys(importResult.overrides).length}
					Imported {count} setting{count === 1 ? '' : 's'} from the file.
					{#if importResult.warnings.length > 0}
						<span class="footer-warnings">
							{#each importResult.warnings as warning (warning)}
								<span class="footer-warning">{warning}</span>
							{/each}
						</span>
					{/if}
				{:else if importResult.kind === 'no-settings'}
					This graph file carries no custom settings.
				{:else}
					Couldn't read settings from that file.
				{/if}
			</p>
		{/if}

		{#if seedSaved}
			<p class="footer-message" data-seed-saved="true">Saved as the settings for new graphs.</p>
		{/if}
	</footer>
</section>

<style>
	.settings-panel {
		position: absolute;
		/* Above the persistence toolbar (z-index 40), for the reason the Find /
		   Filter panel is: at narrower viewports the centred toolbar reaches over
		   this panel's top-right corner and would swallow clicks on Close. The
		   reader summoned the panel and can dismiss it, so while open it wins;
		   the focus overlay (60) stays above both. */
		z-index: 45;
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

	/* Armed: the same button, saying what the next press will do. Amber rather
	   than red — this clears presentation settings, it does not touch the graph. */
	.quiet.armed {
		background: #fef3c7;
		color: #92400e;
		font-weight: 600;
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

	.footer {
		display: grid;
		gap: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid #e2e8f0;
	}

	.footer-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.footer-message {
		color: #334155;
		font-size: 0.75rem;
	}

	.footer-warnings {
		display: grid;
		gap: 0.125rem;
		margin-top: 0.25rem;
	}

	.footer-warning {
		display: block;
		color: #b45309;
	}

	.visually-hidden {
		position: absolute;
		box-sizing: border-box;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
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
