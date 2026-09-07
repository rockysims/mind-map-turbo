<script lang="ts">
	import { resetFileInput } from '$lib/browserGraphFile';
	import { noticeLines } from './lib/noticeLines';

	let {
		notice = '',
		severity = 'info',
		canUndo = false,
		canRedo = false,
		undoLabel = null,
		redoLabel = null,
		undoBlockedReason = 'Nothing to undo. Opened files start fresh.',
		redoBlockedReason = 'Nothing to redo.',
		aiConnected = false,
		onOpenAiSettings,
		onNewGraph,
		onOpenGraphFilePicker,
		onImportGraphFile,
		onSave,
		onUndo,
		onRedo,
		onBlockedAction
	}: {
		notice?: string;
		/** 'warning' announces assertively and wraps: the work is at risk. */
		severity?: 'info' | 'warning';
		canUndo?: boolean;
		canRedo?: boolean;
		/** What undo/redo would do, spoken as part of the button's name. */
		undoLabel?: string | null;
		redoLabel?: string | null;
		/** Why the control is standing down, spoken and — on a tap — written to the notice. */
		undoBlockedReason?: string;
		redoBlockedReason?: string;
		/** Whether an Anthropic API key is in hand, so the control can say so. */
		aiConnected?: boolean;
		onOpenAiSettings?: () => void;
		onNewGraph?: () => void;
		onOpenGraphFilePicker?: () => void;
		/** Given the chosen file, to fold into the graph already on screen. */
		onImportGraphFile?: (file: File) => void;
		onSave?: () => void;
		onUndo?: () => void;
		onRedo?: () => void;
		/** A tap on a control with nothing to do, carrying the reason to say so. */
		onBlockedAction?: (reason: string) => void;
	} = $props();

	let importInput = $state<HTMLInputElement | null>(null);

	const lines = $derived(noticeLines(notice));

	/**
	 * Import picks its file in this page, not in the picker tab Open uses: that
	 * tab hands the file over by reloading the app, which would remount the canvas
	 * and cost the reader the pan, zoom and focus an additive import is meant to
	 * leave alone.
	 */
	function chooseImportFile(): void {
		importInput?.click();
	}

	function handleImportFileChange(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0] ?? null;
		// Reset first, so choosing the same file twice fires `change` both times.
		resetFileInput(input);
		if (file !== null) onImportGraphFile?.(file);
	}

	/**
	 * Stacked lines are separate elements, so this trailing space is what keeps
	 * the notice reading as one message ('browser. Save') rather than running the
	 * sentences together ('browser.Save'). It collapses away inside a block line.
	 */
	function spoken(line: string): string {
		return `${line} `;
	}

	/**
	 * A disabled control that explains itself when tapped.
	 *
	 * `aria-disabled` rather than `disabled`, so the button still takes the tap
	 * and can answer it. `title` would be the obvious place for the reason, but it
	 * is hover-only and this app is mobile-first
	 * (`docs/debt/2026-08-30-tooltips-are-hover-only.md`) — the notice column is
	 * the one channel that reaches a thumb.
	 */
	function step(available: boolean, reason: string, run: (() => void) | undefined): void {
		if (!available) {
			onBlockedAction?.(reason);
			return;
		}
		run?.();
	}
</script>

<div class="graph-toolbar" aria-label="Graph persistence controls">
	<button type="button" title="Start a blank graph in a new tab" onclick={() => onNewGraph?.()}
		>New</button
	>
	<button
		type="button"
		title="Open a saved graph file in a new tab"
		onclick={() => onOpenGraphFilePicker?.()}>Open</button
	>
	<button
		type="button"
		title="Add a saved graph file to this graph, keeping both"
		onclick={chooseImportFile}>Import…</button
	>
	<input
		bind:this={importInput}
		class="import-input"
		type="file"
		accept=".html,.json,text/html,application/json"
		aria-label="Graph file to import"
		onchange={handleImportFileChange}
	/>
	<button
		type="button"
		title="Download this graph as a file you can reopen later"
		onclick={() => onSave?.()}>Save</button
	>
	<!--
		Icon-only in an otherwise text toolbar: two more *text* buttons wrap the
		phone toolbar to a third row (the four above already fill a 375px width),
		and ↶/↷ are as close to self-explanatory as icons get. The operation rides
		in the accessible name instead.
	-->
	<!--
		One flex item, not three: at a 375px width the row runs out after Save, and
		letting the icons wrap independently drops one onto a line of its own, which
		reads as a mistake rather than as a control.
	-->
	<div class="icon-controls">
		<button
			type="button"
			class="icon"
			aria-disabled={!canUndo}
			aria-label={canUndo && undoLabel ? `Undo ${undoLabel}` : 'Undo'}
			aria-describedby={canUndo ? undefined : 'graph-toolbar-undo-reason'}
			onclick={() => step(canUndo, undoBlockedReason, onUndo)}>↶</button
		>
		<button
			type="button"
			class="icon"
			aria-disabled={!canRedo}
			aria-label={canRedo && redoLabel ? `Redo ${redoLabel}` : 'Redo'}
			aria-describedby={canRedo ? undefined : 'graph-toolbar-redo-reason'}
			onclick={() => step(canRedo, redoBlockedReason, onRedo)}>↷</button
		>
		{#if !canUndo}
			<span id="graph-toolbar-undo-reason" class="sr-only">{undoBlockedReason}</span>
		{/if}
		{#if !canRedo}
			<span id="graph-toolbar-redo-reason" class="sr-only">{redoBlockedReason}</span>
		{/if}
		<!--
			Connected state rides in the accessible name, not in the fill alone: the
			colour is the glance, the name is the answer for anyone who cannot see it.
		-->
		<button
			type="button"
			class="icon ai"
			class:connected={aiConnected}
			title="Anthropic API key, model and data settings"
			aria-label={aiConnected ? 'AI settings, connected' : 'AI settings, not connected'}
			data-ai-connected={aiConnected}
			onclick={() => onOpenAiSettings?.()}>✦</button
		>
	</div>
	{#if severity === 'warning'}
		<p class="notice warning" role="alert" aria-live="assertive">
			{#each lines as line, index (index)}<span class="notice-line">{spoken(line)}</span>{/each}
		</p>
	{:else}
		<p class="notice" role="status">
			{#each lines as line, index (index)}<span class="notice-line">{spoken(line)}</span>{/each}
		</p>
	{/if}
</div>

<style>
	.graph-toolbar {
		position: fixed;
		z-index: 40;
		top: 0.75rem;
		left: 50%;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		max-width: calc(100vw - 1.5rem);
		padding: 0.5rem;
		border: 1px solid #cbd5e1;
		border-radius: 999px;
		background: rgb(255 255 255 / 92%);
		box-shadow: 0 8px 24px rgb(15 23 42 / 12%);
		transform: translateX(-50%);
	}

	.graph-toolbar button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 2rem;
		border: 0;
		border-radius: 999px;
		padding: 0.375rem 0.625rem;
		background: #e2e8f0;
		color: #0f172a;
		font: inherit;
		cursor: pointer;
	}

	.graph-toolbar .icon-controls {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.graph-toolbar button.ai.connected {
		background: #0f172a;
		color: #ffffff;
	}

	/*
	 * 44px touch targets: these are the only controls in the pill a thumb reaches
	 * for repeatedly, and an icon gives it nothing else to aim at.
	 */
	.graph-toolbar button.icon {
		min-width: 2.75rem;
		min-height: 2.75rem;
		padding: 0;
		font-size: 1.125rem;
		line-height: 1;
	}

	/* The toolbar had no disabled precedent; this is GraphQueryPanel's. */
	.graph-toolbar button[aria-disabled='true'] {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.graph-toolbar .sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		border: 0;
		margin: -1px;
		clip-path: inset(50%);
		overflow: hidden;
		white-space: nowrap;
	}

	/* Kept in the layout but out of sight: the Import button is the visible control. */
	.graph-toolbar .import-input {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		border: 0;
		margin: -1px;
		clip-path: inset(50%);
		overflow: hidden;
		white-space: nowrap;
	}

	/*
	 * Fixed basis and a two-line floor: the toolbar must not resize as the notice
	 * changes between 'Caching draft...' and a two-sentence status. Every notice
	 * is written as sentences that fit this column on their own (the widest
	 * measures ~11.5rem in the bold warning face), and they stack one per line,
	 * so the bar stays the same compact size whatever it is saying.
	 */
	.graph-toolbar .notice {
		flex: 0 0 12rem;
		min-height: 2rem;
		margin: 0;
		color: #475569;
		font-size: 0.8125rem;
		line-height: 1.25;
	}

	.graph-toolbar .notice-line {
		display: block;
		white-space: normal;
	}

	.graph-toolbar p.warning {
		color: #b45309;
		font-weight: 600;
	}

	@media (max-width: 640px) {
		.graph-toolbar {
			right: 0.75rem;
			left: 0.75rem;
			flex-wrap: wrap;
			justify-content: center;
			border-radius: 1rem;
			transform: none;
		}

		.graph-toolbar .notice {
			flex-basis: 100%;
			text-align: center;
		}
	}
</style>
