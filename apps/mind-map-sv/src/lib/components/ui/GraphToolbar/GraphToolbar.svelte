<script lang="ts">
	import { resetFileInput } from '$lib/browserGraphFile';
	import { noticeLines } from './lib/noticeLines';

	let {
		notice = '',
		severity = 'info',
		settingsOpen = false,
		onNewGraph,
		onOpenGraphFilePicker,
		onImportGraphFile,
		onSave,
		onOpenSettings
	}: {
		notice?: string;
		/** 'warning' announces assertively and wraps: the work is at risk. */
		severity?: 'info' | 'warning';
		/** Drives `aria-expanded` on the Settings button; the panel lives elsewhere. */
		settingsOpen?: boolean;
		onNewGraph?: () => void;
		onOpenGraphFilePicker?: () => void;
		/** Given the chosen file, to fold into the graph already on screen. */
		onImportGraphFile?: (file: File) => void;
		onSave?: () => void;
		onOpenSettings?: () => void;
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
</script>

<!--
	Two pills, centred as one unit. Settings is a separate pill because it acts on
	the view rather than on the document the other three share, and the row is what
	keeps the pair adjacent: each pill keeps its own chrome, and neither can drift
	from the other as the toolbar's contents change.
-->
<div class="toolbar-row">
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

	<div class="settings-toolbar" aria-label="Graph settings controls">
		<button
			type="button"
			title="Adjust how this graph looks and behaves"
			aria-haspopup="dialog"
			aria-expanded={settingsOpen}
			onclick={() => onOpenSettings?.()}
		>
			Settings
		</button>
	</div>
</div>

<style>
	/* The row owns the placement; the pills inside it own their own chrome. */
	.toolbar-row {
		position: fixed;
		z-index: 40;
		top: 0.75rem;
		left: 50%;
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		max-width: calc(100vw - 1.5rem);
		transform: translateX(-50%);
	}

	.graph-toolbar,
	.settings-toolbar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
		border: 1px solid #cbd5e1;
		border-radius: 999px;
		background: rgb(255 255 255 / 92%);
		box-shadow: 0 8px 24px rgb(15 23 42 / 12%);
	}

	.graph-toolbar {
		min-width: 0;
	}

	.graph-toolbar button,
	.settings-toolbar button {
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
		.toolbar-row {
			right: 0.75rem;
			left: 0.75rem;
			flex-wrap: wrap;
			justify-content: center;
			transform: none;
		}

		.graph-toolbar {
			flex-wrap: wrap;
			justify-content: center;
			border-radius: 1rem;
		}

		.settings-toolbar {
			border-radius: 1rem;
		}

		.graph-toolbar .notice {
			flex-basis: 100%;
			text-align: center;
		}
	}
</style>
