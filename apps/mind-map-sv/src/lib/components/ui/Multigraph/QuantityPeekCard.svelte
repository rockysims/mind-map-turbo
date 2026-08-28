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
	 * One line per definer, and that line is the equation. The card hangs directly
	 * under the chip that opened it, so a header restating the quantity would say
	 * what the reader is already looking at, and a node title above each equation
	 * would push the answer below the question. The title appears only where there
	 * is no equation to show instead — a node that confirmed the output but whose
	 * text no longer states it. It is still a real answer to "who defines this", so
	 * hiding it would make the peek disagree with the edge on screen.
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

	/**
	 * Inline even when the source was displayed. A display block would break the
	 * row the "Go to node" button shares, and the reader is scanning a list of
	 * definitions here rather than reading one.
	 */
	function texOf(definition: { sourceTex: string }): string {
		return `$${definition.sourceTex}$`;
	}

	// Standard dialog entry: Enter on the chip opened this, so the next Tab has to
	// land inside it rather than on the next chip. The row buttons come first in
	// the DOM, so the first focusable is the leading "Go to node". A plain focus()
	// so a pointer-opened card is left to :focus-visible rather than given a ring.
	$effect(() => {
		card?.querySelector('button')?.focus();
	});

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
					<span class="definition">
						{#if definitions.length === 0}
							{titleForNodeId(definerId)}
						{:else}
							{#each definitions as definition (definition.bodyKey)}
								<MathText text={texOf(definition)} />
							{/each}
						{/if}
					</span>
					<button
						type="button"
						class="goto"
						data-peek-goto={definerId}
						onclick={() => onJumpToNode?.(definerId)}
					>
						Go to node
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	<!-- Last in the DOM so Tab runs the answers before the way out, and parked in
	     the corner so it never competes with them for the row. -->
	<button type="button" class="dismiss" aria-label="Close definition" onclick={onClose}>✕</button>
</div>

<style>
	.quantity-peek {
		position: absolute;
		top: calc(100% + 0.35rem);
		left: 0;
		right: 0;
		z-index: 5;
		display: grid;
		gap: 0.4rem;
		border: 1px solid #cbd5e1;
		border-radius: 0.75rem;
		/* Right padding keeps the rows clear of the corner dismiss. */
		padding: 0.5rem 2rem 0.5rem 0.75rem;
		background: #ffffff;
		box-shadow: 0 12px 32px rgb(15 23 42 / 18%);
		font-size: 0.95rem;
	}

	ul {
		display: grid;
		gap: 0.3rem;
		/* The list scrolls, not the card, so the dismiss stays in its corner. */
		max-height: 16rem;
		overflow: auto;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.definition {
		flex: 1;
		min-width: 0;
		color: #0f172a;
		overflow-x: auto;
	}

	.note {
		margin: 0;
		color: #64748b;
		font-size: 0.85rem;
	}

	button {
		flex: none;
		border: 1px solid #cbd5e1;
		border-radius: 0.35rem;
		background: #f8fafc;
		color: #334155;
		padding: 0.1rem 0.45rem;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}

	button.dismiss {
		position: absolute;
		top: 0.4rem;
		right: 0.4rem;
		border-color: transparent;
		background: transparent;
		color: #64748b;
		line-height: 1;
	}

	button.create {
		justify-self: start;
		border-color: #f59e0b;
		background: #fffbeb;
	}
</style>
