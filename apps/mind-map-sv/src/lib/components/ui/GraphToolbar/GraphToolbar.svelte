<script lang="ts">
	import { noticeLines } from './lib/noticeLines';

	let {
		notice = '',
		severity = 'info',
		onNewGraph,
		onOpenGraphFilePicker,
		onSave
	}: {
		notice?: string;
		/** 'warning' announces assertively and wraps: the work is at risk. */
		severity?: 'info' | 'warning';
		onNewGraph?: () => void;
		onOpenGraphFilePicker?: () => void;
		onSave?: () => void;
	} = $props();

	const lines = $derived(noticeLines(notice));

	/**
	 * Stacked lines are separate elements, so this trailing space is what keeps
	 * the notice reading as one message ('browser. Save') rather than running the
	 * sentences together ('browser.Save'). It collapses away inside a block line.
	 */
	function spoken(line: string): string {
		return `${line} `;
	}
</script>

<div class="graph-toolbar" aria-label="Graph persistence controls">
	<button type="button" onclick={() => onNewGraph?.()}>New</button>
	<button type="button" onclick={() => onOpenGraphFilePicker?.()}>Open</button>
	<button type="button" onclick={() => onSave?.()}>Save</button>
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
