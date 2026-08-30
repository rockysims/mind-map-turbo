<script lang="ts">
	/**
	 * Two pills, centered as one unit.
	 *
	 * The document pill holds a `<p role="status">` whose text changes width every
	 * time the save state does. A separately positioned Settings button would
	 * therefore slide left and right whenever a notice appeared — so the wrapper
	 * owns the centering and the pair moves together, with each pill keeping its
	 * own chrome.
	 */
	let {
		notice = '',
		settingsOpen = false,
		onNewGraph,
		onOpenGraphFilePicker,
		onDownload,
		onOpenSettings
	}: {
		notice?: string;
		/** Drives `aria-expanded` on the Settings button; the panel lives elsewhere. */
		settingsOpen?: boolean;
		onNewGraph?: () => void;
		onOpenGraphFilePicker?: () => void;
		onDownload?: () => void;
		onOpenSettings?: () => void;
	} = $props();
</script>

<div class="toolbar-row">
	<div class="graph-toolbar" aria-label="Graph persistence controls">
		<button type="button" onclick={() => onNewGraph?.()}>New</button>
		<button type="button" onclick={() => onOpenGraphFilePicker?.()}>Open</button>
		<button type="button" onclick={() => onDownload?.()}>Download</button>
		<p role="status">{notice}</p>
	</div>

	<div class="settings-toolbar" aria-label="Graph settings controls">
		<button
			type="button"
			aria-haspopup="dialog"
			aria-expanded={settingsOpen}
			onclick={() => onOpenSettings?.()}
		>
			Settings
		</button>
	</div>
</div>

<style>
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
		min-width: 0;
		padding: 0.5rem;
		border: 1px solid #cbd5e1;
		border-radius: 999px;
		background: rgb(255 255 255 / 92%);
		box-shadow: 0 8px 24px rgb(15 23 42 / 12%);
	}

	.settings-toolbar {
		flex: 0 0 auto;
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

	.graph-toolbar p {
		margin: 0;
		color: #475569;
		font-size: 0.8125rem;
		white-space: nowrap;
	}

	@media (max-width: 640px) {
		.toolbar-row {
			right: 0.75rem;
			left: 0.75rem;
			max-width: none;
			flex-wrap: wrap;
			justify-content: center;
			transform: none;
		}

		.graph-toolbar,
		.settings-toolbar {
			flex-wrap: wrap;
			justify-content: center;
			border-radius: 1rem;
		}
	}
</style>
