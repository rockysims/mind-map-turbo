<script lang="ts">
	let {
		notice = '',
		severity = 'info',
		onNewGraph,
		onOpenGraphFilePicker,
		onDownload
	}: {
		notice?: string;
		/** 'warning' announces assertively and wraps: the work is at risk. */
		severity?: 'info' | 'warning';
		onNewGraph?: () => void;
		onOpenGraphFilePicker?: () => void;
		onDownload?: () => void;
	} = $props();
</script>

<div class="graph-toolbar" aria-label="Graph persistence controls">
	<button type="button" onclick={() => onNewGraph?.()}>New</button>
	<button type="button" onclick={() => onOpenGraphFilePicker?.()}>Open</button>
	<button type="button" onclick={() => onDownload?.()}>Download</button>
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
