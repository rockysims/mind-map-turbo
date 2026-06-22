<script lang="ts">
	let {
		notice = '',
		onNewGraph,
		onOpenGraphFilePicker,
		onDownload
	}: {
		notice?: string;
		onNewGraph?: () => void;
		onOpenGraphFilePicker?: () => void;
		onDownload?: () => void;
	} = $props();
</script>

<div class="graph-toolbar" aria-label="Graph persistence controls">
	<button type="button" onclick={() => onNewGraph?.()}>New</button>
	<button type="button" onclick={() => onOpenGraphFilePicker?.()}>Open</button>
	<button type="button" onclick={() => onDownload?.()}>Download</button>
	<p role="status">{notice}</p>
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
