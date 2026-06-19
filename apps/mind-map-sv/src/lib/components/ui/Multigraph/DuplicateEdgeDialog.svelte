<script lang="ts">
	let {
		edgeIdentifier,
		onConfirm,
		onCancel
	}: {
		edgeIdentifier: string;
		onConfirm: () => void;
		onCancel: () => void;
	} = $props();
</script>

<div
	class="duplicate-edge-dialog-backdrop"
	role="presentation"
	onclick={onCancel}
	onkeydown={() => {}}
>
	<div
		role="dialog"
		aria-modal="true"
		aria-labelledby="duplicate-edge-dialog-title"
		tabindex="-1"
		class="duplicate-edge-dialog"
		onclick={(event) => event.stopPropagation()}
		onkeydown={() => {}}
	>
		<p id="duplicate-edge-dialog-title" class="duplicate-edge-dialog-message">
			<span>Remove edge?</span>
			<span class="duplicate-edge-dialog-edge">{edgeIdentifier}</span>
		</p>
		<div class="duplicate-edge-dialog-actions">
			<button class="duplicate-edge-dialog-cancel" onclick={onCancel}>Cancel</button>
			<button class="duplicate-edge-dialog-confirm" onclick={onConfirm}>Remove</button>
		</div>
	</div>
</div>

<style>
	.duplicate-edge-dialog-backdrop {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.4);
		z-index: 100;
	}

	.duplicate-edge-dialog {
		background: white;
		border-radius: 8px;
		padding: 24px;
		max-width: 280px;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.duplicate-edge-dialog-message {
		margin: 0;
		font-size: 1rem;
		text-align: center;
	}

	.duplicate-edge-dialog-message span {
		display: block;
	}

	.duplicate-edge-dialog-edge {
		margin-top: 4px;
		font-weight: 600;
	}

	.duplicate-edge-dialog-actions {
		display: flex;
		gap: 12px;
		justify-content: center;
	}

	.duplicate-edge-dialog-confirm,
	.duplicate-edge-dialog-cancel {
		padding: 10px 20px;
		border-radius: 6px;
		border: none;
		font-size: 0.9rem;
		cursor: pointer;
		min-width: 80px;
		min-height: 44px;
	}

	.duplicate-edge-dialog-confirm {
		background: #e53935;
		color: white;
	}

	.duplicate-edge-dialog-cancel {
		background: #e0e0e0;
		color: #333;
	}
</style>
