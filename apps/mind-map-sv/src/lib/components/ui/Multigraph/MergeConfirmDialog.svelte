<script lang="ts">
	/**
	 * The gate on the one lossy part of a merge.
	 *
	 * Everything else a merge does is recoverable in the edit sheet; an edge's
	 * discarded direction is not, so the count is stated before it happens.
	 * `conflictCount` comes straight off the held plan's `directionConflicts`, so
	 * the number here is the number of edges the confirm goes on to rewrite.
	 */
	let {
		conflictCount,
		onConfirm,
		onCancel
	}: {
		conflictCount: number;
		onConfirm: () => void;
		onCancel: () => void;
	} = $props();

	const conflictSentence = $derived(
		conflictCount === 1
			? '1 edge will lose its direction.'
			: `${conflictCount} edges will lose their direction.`
	);
</script>

<div
	class="merge-confirm-dialog-backdrop"
	role="presentation"
	onclick={onCancel}
	onkeydown={() => {}}
>
	<div
		role="dialog"
		aria-modal="true"
		aria-labelledby="merge-confirm-dialog-title"
		tabindex="-1"
		class="merge-confirm-dialog"
		onclick={(event) => event.stopPropagation()}
		onkeydown={() => {}}
	>
		<p id="merge-confirm-dialog-title" class="merge-confirm-dialog-message">
			<span>Merge nodes?</span>
			<span class="merge-confirm-dialog-detail">{conflictSentence}</span>
		</p>
		<div class="merge-confirm-dialog-actions">
			<button class="merge-confirm-dialog-cancel" onclick={onCancel}>Cancel</button>
			<button class="merge-confirm-dialog-confirm" onclick={onConfirm}>Merge</button>
		</div>
	</div>
</div>

<style>
	.merge-confirm-dialog-backdrop {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.4);
		z-index: 100;
	}

	.merge-confirm-dialog {
		background: white;
		border-radius: 8px;
		padding: 24px;
		max-width: 280px;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.merge-confirm-dialog-message {
		margin: 0;
		font-size: 1rem;
		text-align: center;
	}

	.merge-confirm-dialog-message span {
		display: block;
	}

	.merge-confirm-dialog-detail {
		margin-top: 4px;
		font-weight: 600;
	}

	.merge-confirm-dialog-actions {
		display: flex;
		gap: 12px;
		justify-content: center;
	}

	.merge-confirm-dialog-confirm,
	.merge-confirm-dialog-cancel {
		padding: 10px 20px;
		border-radius: 6px;
		border: none;
		font-size: 0.9rem;
		cursor: pointer;
		min-width: 80px;
		min-height: 44px;
	}

	.merge-confirm-dialog-confirm {
		background: #e53935;
		color: white;
	}

	.merge-confirm-dialog-cancel {
		background: #e0e0e0;
		color: #333;
	}
</style>
