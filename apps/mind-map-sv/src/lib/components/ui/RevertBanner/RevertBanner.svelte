<script lang="ts">
	/**
	 * The way back out of an import.
	 *
	 * Shown while the import entry is still on the undo side of the history, which
	 * is longer than the operation that wrote it — a draft's tail survives a
	 * reload, so the banner has to say how old it is rather than assume the reader
	 * just watched the import happen. The age is re-derived on a coarse interval
	 * so a banner left sitting does not keep claiming "moments ago" an hour later.
	 *
	 * Reverting is gated behind its own confirmation because it is not the inverse
	 * of the import alone: everything done since the snapshot goes with it.
	 */
	import { untrack } from 'svelte';
	import {
		formatSnapshotAge,
		snapshotOfferHeadline,
		SNAPSHOT_AGE_REFRESH_MS
	} from './snapshotOffer';

	let {
		label,
		createdAt,
		addedNodeCount,
		onRevert,
		onDismiss,
		now = Date.now,
		ageRefreshMs = SNAPSHOT_AGE_REFRESH_MS
	}: {
		/** The operation's label, e.g. `'import'`. */
		label: string;
		/** Epoch ms the operation happened. */
		createdAt: number;
		/** Nodes the operation added, exactly — both sides of it are recorded. */
		addedNodeCount: number;
		onRevert: () => void;
		onDismiss: () => void;
		now?: () => number;
		ageRefreshMs?: number;
	} = $props();

	let nowMs = $state(untrack(() => now()));
	let confirming = $state(false);

	const headline = $derived(snapshotOfferHeadline(label, addedNodeCount));
	const age = $derived(formatSnapshotAge(createdAt, nowMs));

	$effect(() => {
		const interval = setInterval(() => {
			nowMs = now();
		}, ageRefreshMs);
		return () => clearInterval(interval);
	});

	function confirmRevert(): void {
		confirming = false;
		onRevert();
	}
</script>

<div class="revert-banner" aria-label="Revert the last import">
	<p class="revert-banner-message">
		<span class="revert-banner-headline">{headline}</span>
		<span class="revert-banner-age">from {age}</span>
	</p>
	<div class="revert-banner-actions">
		<button type="button" onclick={() => (confirming = true)}>Revert…</button>
		<button type="button" class="revert-banner-dismiss" aria-label="Dismiss" onclick={onDismiss}>
			✕
		</button>
	</div>
</div>

{#if confirming}
	<div
		class="revert-confirm-backdrop"
		role="presentation"
		onclick={() => (confirming = false)}
		onkeydown={() => {}}
	>
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="revert-confirm-title"
			tabindex="-1"
			class="revert-confirm"
			onclick={(event) => event.stopPropagation()}
			onkeydown={() => {}}
		>
			<p id="revert-confirm-title" class="revert-confirm-message">
				<span>Revert to the graph from {age}?</span>
				<span class="revert-confirm-detail">
					Everything changed since then is lost too, not just the import.
				</span>
			</p>
			<div class="revert-confirm-actions">
				<button type="button" class="revert-confirm-cancel" onclick={() => (confirming = false)}>
					Cancel
				</button>
				<button type="button" class="revert-confirm-confirm" onclick={confirmRevert}>Revert</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.revert-banner {
		position: fixed;
		z-index: 39;
		top: 3.75rem;
		left: 50%;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		max-width: calc(100vw - 1.5rem);
		padding: 0.5rem 0.5rem 0.5rem 0.75rem;
		border: 1px solid #cbd5e1;
		border-radius: 999px;
		background: rgb(255 255 255 / 92%);
		box-shadow: 0 8px 24px rgb(15 23 42 / 12%);
		transform: translateX(-50%);
	}

	.revert-banner-message {
		display: flex;
		align-items: baseline;
		gap: 0.375rem;
		margin: 0;
		white-space: nowrap;
	}

	.revert-banner-headline {
		color: #0f172a;
		font-size: 0.8125rem;
		font-weight: 600;
	}

	.revert-banner-age {
		color: #475569;
		font-size: 0.8125rem;
	}

	.revert-banner-actions {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.revert-banner button {
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

	.revert-banner .revert-banner-dismiss {
		min-width: 2rem;
		padding: 0.375rem;
		background: transparent;
		color: #475569;
	}

	.revert-confirm-backdrop {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: rgb(15 23 42 / 40%);
	}

	.revert-confirm {
		display: flex;
		flex-direction: column;
		gap: 16px;
		width: 100%;
		max-width: 300px;
		padding: 24px;
		border-radius: 8px;
		background: white;
	}

	.revert-confirm-message {
		margin: 0;
		font-size: 1rem;
		text-align: center;
	}

	.revert-confirm-message span {
		display: block;
	}

	.revert-confirm-detail {
		margin-top: 4px;
		color: #475569;
		font-size: 0.875rem;
	}

	.revert-confirm-actions {
		display: flex;
		justify-content: center;
		gap: 12px;
	}

	.revert-confirm-cancel,
	.revert-confirm-confirm {
		min-width: 80px;
		min-height: 44px;
		padding: 10px 20px;
		border: none;
		border-radius: 6px;
		font-size: 0.9rem;
		cursor: pointer;
	}

	.revert-confirm-cancel {
		background: #e0e0e0;
		color: #333;
	}

	.revert-confirm-confirm {
		background: #e53935;
		color: white;
	}

	@media (max-width: 640px) {
		.revert-banner {
			top: auto;
			right: 0.75rem;
			bottom: 0.75rem;
			left: 0.75rem;
			flex-wrap: wrap;
			justify-content: center;
			border-radius: 1rem;
			transform: none;
		}
	}
</style>
