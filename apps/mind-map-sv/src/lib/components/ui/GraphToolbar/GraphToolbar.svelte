<script lang="ts">
	import { resetFileInput } from '$lib/browserGraphFile';

	let {
		notice = '',
		severity = 'info',
		onNewGraph,
		onOpenGraphFilePicker,
		onImportGraphFile,
		onSave
	}: {
		notice?: string;
		/** 'warning' announces assertively and wraps: the work is at risk. */
		severity?: 'info' | 'warning';
		onNewGraph?: () => void;
		onOpenGraphFilePicker?: () => void;
		/** Given the chosen file, to fold into the graph already on screen. */
		onImportGraphFile?: (file: File) => void;
		onSave?: () => void;
	} = $props();

	let importInput = $state<HTMLInputElement | null>(null);

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
	{#if severity === 'warning'}
		<p class="warning" role="alert" aria-live="assertive">{notice}</p>
	{:else}
		<p role="status">{notice}</p>
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

	.graph-toolbar p {
		margin: 0;
		color: #475569;
		font-size: 0.8125rem;
		white-space: nowrap;
	}

	.graph-toolbar p.warning {
		max-width: 22rem;
		color: #b45309;
		font-weight: 600;
		/* Warnings are longer than a status line and must not be clipped. */
		white-space: normal;
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
	}
</style>
