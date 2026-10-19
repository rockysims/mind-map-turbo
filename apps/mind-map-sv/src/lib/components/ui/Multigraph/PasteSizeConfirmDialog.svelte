<script lang="ts">
	/**
	 * The one question a paste asks: whether to add this many bytes of
	 * attachments the document does not hold yet.
	 *
	 * Asked once, naming the total, and "Paste anyway" brings every attachment
	 * whatever its size (`docs/ui-decisions/2026-10-18--editing--a-large-paste-asks-once-and-then-brings-every-attachment.md`).
	 * Shaped like `MergeConfirmDialog`, centred in the space below the toolbar's
	 * measured clearance as the Tags dialog is, so the toolbar never sits over it.
	 */
	let {
		sizeText,
		pasting = false,
		onConfirm,
		onCancel
	}: {
		/** The bytes the paste adds, already formatted ("12 MB"). */
		sizeText: string;
		/**
		 * True once "Paste anyway" is storing the attachments, which for the sizes
		 * that ask is long enough to see: the button says so, and neither answer
		 * can be given twice.
		 */
		pasting?: boolean;
		onConfirm: () => void;
		onCancel: () => void;
	} = $props();

	let confirmButton = $state<HTMLButtonElement | null>(null);

	// Into the dialog on open, on the answer the reader was already giving when
	// they pasted, so Enter pastes and Escape (below) cancels.
	$effect(() => {
		confirmButton?.focus();
	});

	function cancel() {
		if (!pasting) onCancel();
	}

	/**
	 * Escape on the window, not the dialog, so it cancels wherever focus has
	 * wandered. The canvas's own Escape steps aside while a paste is waiting, so
	 * this press does not also clear the selection behind it.
	 */
	function handleWindowKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		cancel();
	}
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div class="paste-size-dialog-backdrop" role="presentation" onclick={cancel} onkeydown={() => {}}>
	<div
		role="dialog"
		aria-modal="true"
		aria-labelledby="paste-size-dialog-message"
		tabindex="-1"
		class="paste-size-dialog"
		onclick={(event) => event.stopPropagation()}
		onkeydown={() => {}}
	>
		<p id="paste-size-dialog-message" class="paste-size-dialog-message">
			This paste adds about <strong>{sizeText}</strong> of attachments to this document. Paste anyway?
		</p>
		<div class="paste-size-dialog-actions">
			<button class="paste-size-dialog-cancel" disabled={pasting} onclick={cancel}>Cancel</button>
			<button
				bind:this={confirmButton}
				class="paste-size-dialog-confirm"
				disabled={pasting}
				onclick={onConfirm}
			>
				<!-- Both labels share one grid cell, so the button keeps the wider
				     label's width and does not jump when the state changes. A hidden
				     label is out of the accessible name too. -->
				<span class:hidden={pasting}>Paste anyway</span>
				<span class:hidden={!pasting}>Pasting…</span>
			</button>
		</div>
	</div>
</div>

<style>
	/*
	 * The top padding is the toolbar's measured clearance (published by
	 * GraphToolbar as `--graph-toolbar-clearance`), so the dialog centres in the
	 * space below the toolbar and can never sit under it on a phone where the
	 * toolbar wraps. With no toolbar the fallback is no padding at all.
	 */
	.paste-size-dialog-backdrop {
		position: absolute;
		inset: 0;
		z-index: 100;
		box-sizing: border-box;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--graph-toolbar-clearance, 0px) 16px 16px;
		background: rgba(0, 0, 0, 0.4);
	}

	.paste-size-dialog {
		box-sizing: border-box;
		background: white;
		border-radius: 8px;
		padding: 24px;
		max-width: 280px;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.paste-size-dialog-message {
		margin: 0;
		font-size: 1rem;
		text-align: center;
	}

	.paste-size-dialog-actions {
		display: flex;
		gap: 12px;
		justify-content: center;
	}

	.paste-size-dialog-confirm,
	.paste-size-dialog-cancel {
		padding: 10px 20px;
		border-radius: 6px;
		border: none;
		font-size: 0.9rem;
		cursor: pointer;
		min-width: 80px;
		min-height: 44px;
	}

	.paste-size-dialog-confirm:disabled,
	.paste-size-dialog-cancel:disabled {
		cursor: progress;
	}

	/*
	 * Not the merge dialog's red: nothing is lost either way, and a paste is
	 * undone in one step. The app's primary (the edit sheet's Save, the conflict
	 * prompt's choice) says "go on" without saying "danger".
	 */
	.paste-size-dialog-confirm {
		display: inline-grid;
		background: #0f172a;
		color: white;
	}

	.paste-size-dialog-confirm > span {
		grid-area: 1 / 1;
	}

	.paste-size-dialog-confirm > span.hidden {
		visibility: hidden;
	}

	.paste-size-dialog-cancel {
		background: #e0e0e0;
		color: #333;
	}
</style>
