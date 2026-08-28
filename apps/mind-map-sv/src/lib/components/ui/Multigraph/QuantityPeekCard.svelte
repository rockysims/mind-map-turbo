<script lang="ts">
	/**
	 * What one confirmed input actually means, without leaving the node reading it.
	 *
	 * The question a reader has at an input chip is "what is this?", and answering
	 * it by flying the canvas somewhere else costs them their place. So the
	 * definition comes to them: every node that claims this quantity, with the
	 * equation each one wrote, rendered as written. Going there stays available as
	 * an explicit choice rather than the price of asking.
	 *
	 * A definer with no equation is shown anyway. It confirmed the output, so it is
	 * a real answer to "who defines this" even when its text has nothing left to
	 * render — hiding it would make the peek disagree with the edge on screen.
	 */
	import MathText from '../MathText/MathText.svelte';
	import type { QuantityIndexEntry } from './lib/quantityIndex';

	let {
		entry,
		label,
		titleForNodeId,
		onJumpToNode,
		onCreateDefiningNode,
		onClose
	}: {
		/** The index entry for the peeked quantity, or undefined when nothing knows it. */
		entry?: QuantityIndexEntry;
		/** Human-readable quantity name, for the copy when there is no entry to read. */
		label: string;
		titleForNodeId: (nodeId: string) => string;
		onJumpToNode?: (nodeId: string) => void;
		onCreateDefiningNode?: (quantityLabel: string) => void;
		onClose: () => void;
	} = $props();

	let card = $state<HTMLDivElement | null>(null);

	const definerNodeIds = $derived(entry?.definerNodeIds ?? []);

	function definitionsFor(nodeId: string) {
		return (entry?.definitions ?? []).filter((definition) => definition.nodeId === nodeId);
	}

	/** As written: inline math stays inline, a displayed equation stays displayed. */
	function texOf(definition: { sourceTex: string; displayMode: boolean }): string {
		return definition.displayMode ? `$$${definition.sourceTex}$$` : `$${definition.sourceTex}$`;
	}

	$effect(() => {
		// Registered from inside the click that opened the card, so the opening
		// gesture's own pointerdown has already been and gone.
		function onPointerDown(event: PointerEvent) {
			const target = event.target;
			if (target instanceof Node && card?.contains(target)) return;
			onClose();
		}
		function onKeyDown(event: KeyboardEvent) {
			if (event.key !== 'Escape') return;
			// The focus overlay closes on Escape too, and dismissing the card is the
			// narrower intent while it is open.
			event.stopPropagation();
			onClose();
		}
		document.addEventListener('pointerdown', onPointerDown, true);
		document.addEventListener('keydown', onKeyDown, true);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown, true);
			document.removeEventListener('keydown', onKeyDown, true);
		};
	});
</script>

<div
	bind:this={card}
	class="quantity-peek"
	data-quantity-peek={label}
	role="dialog"
	aria-label={`Where ${label} is defined`}
>
	<header>
		<span class="quantity">{label}</span>
		<button type="button" class="dismiss" aria-label="Close definition" onclick={onClose}>
			Close
		</button>
	</header>

	{#if definerNodeIds.length === 0}
		<p class="note">Nothing defines {label} yet.</p>
		{#if onCreateDefiningNode}
			<button
				type="button"
				class="create"
				data-create-defining-node={label}
				onclick={() => onCreateDefiningNode?.(label)}
			>
				Define {label}
			</button>
		{/if}
	{:else}
		<ul>
			{#each definerNodeIds as definerId (definerId)}
				{@const definitions = definitionsFor(definerId)}
				<li data-peek-definer={definerId}>
					<div class="definer">
						<span class="definer-title">{titleForNodeId(definerId)}</span>
						<button
							type="button"
							class="goto"
							data-peek-goto={definerId}
							onclick={() => onJumpToNode?.(definerId)}
						>
							Go to node
						</button>
					</div>
					{#if definitions.length === 0}
						<p class="note">Confirmed as an output, but its text no longer states it.</p>
					{:else}
						{#each definitions as definition (definition.bodyKey)}
							<div class="definition"><MathText text={texOf(definition)} /></div>
						{/each}
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.quantity-peek {
		position: absolute;
		top: calc(100% + 0.35rem);
		left: 0;
		right: 0;
		z-index: 5;
		display: grid;
		gap: 0.5rem;
		max-height: 18rem;
		overflow: auto;
		border: 1px solid #cbd5e1;
		border-radius: 0.75rem;
		padding: 0.75rem;
		background: #ffffff;
		box-shadow: 0 12px 32px rgb(15 23 42 / 18%);
		font-size: 0.95rem;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.quantity {
		font-style: italic;
		font-weight: 600;
	}

	ul {
		display: grid;
		gap: 0.6rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: grid;
		gap: 0.3rem;
		padding-left: 0.6rem;
		border-left: 3px solid #cbd5e1;
	}

	.definer {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.4rem;
	}

	.definer-title {
		font-weight: 700;
	}

	.definition {
		color: #0f172a;
		line-height: 1.5;
	}

	.note {
		margin: 0;
		color: #64748b;
		font-size: 0.85rem;
	}

	button {
		border: 1px solid #cbd5e1;
		border-radius: 0.35rem;
		background: #f8fafc;
		color: #334155;
		padding: 0.1rem 0.45rem;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}

	button.create {
		justify-self: start;
		border-color: #f59e0b;
		background: #fffbeb;
	}
</style>
