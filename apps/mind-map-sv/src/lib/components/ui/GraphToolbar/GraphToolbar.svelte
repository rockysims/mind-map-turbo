<script lang="ts">
	let {
		notice = '',
		onNewGraph,
		onLoadGraph,
		onDownload
	}: {
		notice?: string;
		onNewGraph?: () => void;
		onLoadGraph?: (file: File) => void;
		onDownload?: () => void;
	} = $props();

	let fileInput = $state<HTMLInputElement | undefined>(undefined);

	function handleFileChange(event: Event): void {
		const target = event.currentTarget as HTMLInputElement;
		const file = target.files?.[0];
		if (file) {
			onLoadGraph?.(file);
		}
		if (fileInput) {
			setTimeout(() => {
				if (fileInput) fileInput.value = '';
			});
		}
	}
</script>

<div class="graph-toolbar" aria-label="Graph persistence controls">
	<button type="button" onclick={() => onNewGraph?.()}>New</button>
	<label>
		<span class="sr-only">Load graph file</span>
		<input
			bind:this={fileInput}
			type="file"
			accept=".html,text/html"
			aria-label="Load graph file"
			class="file-input-hidden"
			onchange={handleFileChange}
		/>
		<span aria-hidden="true" class="file-input-button">Open</span>
	</label>
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

	.graph-toolbar button,
	.file-input-button {
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

	.file-input-hidden {
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
