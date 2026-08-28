<script lang="ts">
	import type { GraphAssetStore } from '$lib/assets/assetStore';
	import MathText from '../MathText/MathText.svelte';
	import type { GraphAssetMetadata } from '../types/multigraph';
	import type { NodeData, NodeImageContent, QuantityDesignation } from '../types/node';
	import type { NodeDiagnosticsView } from './lib/nodeDiagnosticsView';
	import type { NodeQuantities } from './lib/nodeQuantities';
	import type { QuantityIndexEntry } from './lib/quantityIndex';
	import { designationView } from './lib/quantityDesignations';
	import {
		closeBranch,
		isBranchOpen,
		openCascade,
		parsePath,
		serializePath,
		toggleBranch,
		type PeekCascade,
		type PeekPath
	} from './lib/peekCascade';
	import QuantityDesignationChips from './QuantityDesignationChips.svelte';
	import QuantityPeekCard from './QuantityPeekCard.svelte';

	const EMPTY_DIAGNOSTICS: NodeDiagnosticsView = { items: [], cycleNodeIds: [] };
	const EMPTY_QUANTITIES: NodeQuantities = { defines: [], references: [] };
	const EMPTY_DESIGNATIONS: readonly QuantityDesignation[] = [];

	const DIAGNOSTIC_TEXT = {
		unresolved: 'is not defined anywhere',
		'out-of-view': 'is defined outside the visible area',
		// Both say "differently" rather than "more than once", because agreeing
		// definitions are not reported at all and the copy should not imply they are.
		conflict: 'is defined differently by',
		'self-conflict': 'is defined more than one way in this node'
	} as const;

	let {
		node,
		assets = {},
		assetStore = null,
		assetScope = '',
		diagnostics = EMPTY_DIAGNOSTICS,
		quantities = EMPTY_QUANTITIES,
		quantityEntryFor,
		inputsForNodeId = () => EMPTY_DESIGNATIONS,
		titleForNodeId = (nodeId: string) => nodeId,
		onCreateDefiningNode,
		onJumpToNode
	}: {
		node: NodeData;
		assets?: Record<string, GraphAssetMetadata>;
		assetStore?: GraphAssetStore | null;
		assetScope?: string;
		/** What this node's math says about quantities it cannot resolve cleanly. */
		diagnostics?: NodeDiagnosticsView;
		/** What this node's text says it defines and mentions — the suggestion pool. */
		quantities?: NodeQuantities;
		/**
		 * The graph-wide record for one quantity, read only when a peek opens. A
		 * lookup rather than a map so nothing here depends on the whole index.
		 */
		quantityEntryFor?: (key: string) => QuantityIndexEntry | undefined;
		/**
		 * One node's confirmed inputs, for the drill line under each definer row.
		 * A lookup for the same reason `quantityEntryFor` is one, and it hands back
		 * the node's own array so the cards do no work per graph frame.
		 */
		inputsForNodeId?: (nodeId: string) => readonly QuantityDesignation[];
		titleForNodeId?: (nodeId: string) => string;
		/**
		 * The key rides along with the label so the new node can be seeded with the
		 * designation that makes it a definer — the label alone is display text.
		 */
		onCreateDefiningNode?: (quantityLabel: string, quantityKey: string) => void;
		/**
		 * Leave for another node without pinning it. Every navigation offered here
		 * goes through this: a surface that reads is not a surface that edits, and
		 * pinning from a diagnostic would edit the graph behind a button that reads
		 * like a link.
		 */
		onJumpToNode?: (nodeId: string) => void;
	} = $props();

	let imageUrls = $state<Record<string, string>>({});
	/**
	 * Every peek card on screen, as one tree. This is the whole cascade's state:
	 * the cards themselves are presentational, because N cards each holding a
	 * document listener would race — every one of them stopping propagation, and
	 * the wrong one closing.
	 */
	let cascade = $state<PeekCascade | null>(null);
	/** The chip the cascade belongs to, so dismissing returns focus to it. */
	let peekAnchor: HTMLElement | null = null;
	/**
	 * The card that should take focus, addressed by serialized path. Consumed and
	 * cleared by whichever card matches, or every later render would refocus it.
	 */
	let focusRequestPath = $state<string | null>(null);
	/** The subtree the cards live in, for hit-testing a press against them. */
	let peekSection = $state<HTMLElement | null>(null);

	const designations = $derived(designationView(quantities, node.inputs, node.outputs));
	const hasDesignations = $derived(
		designations.inputs.length > 0 ||
			designations.outputs.length > 0 ||
			designations.suggestions.length > 0
	);
	const peekKey = $derived(cascade?.rootKey ?? null);
	const peekEntry = $derived(peekKey === null ? undefined : quantityEntryFor?.(peekKey));
	const peekLabel = $derived(
		designations.inputs.find((chip) => chip.symbol.key === peekKey)?.symbol.label ?? ''
	);

	// A quantity that stops being an input while its cascade is open has nothing
	// left to explain, and the node it was read from may have gone with it. Only
	// the root is watched: a nested chip that disappears already stops rendering,
	// because the cards walk the definers' live designations.
	$effect(() => {
		if (peekKey === null) return;
		if (designations.inputs.some((chip) => chip.symbol.key === peekKey)) return;
		cascade = null;
		focusRequestPath = null;
		peekAnchor = null;
	});

	function rootCard(): Element | null {
		return peekSection?.querySelector('[data-peek-path=""]') ?? null;
	}

	function openPeek(key: string, anchor: HTMLElement) {
		// A chip that reads as pressed has to un-press: the same tap that asked the
		// question is how a reader takes it back.
		if (cascade?.rootKey === key) {
			closeCascade();
			return;
		}
		peekAnchor = anchor;
		cascade = openCascade(key);
		focusRequestPath = '';
	}

	function closeCascade() {
		cascade = null;
		focusRequestPath = null;
		peekAnchor?.focus();
		peekAnchor = null;
	}

	function toggleBranchAt(path: PeekPath) {
		const open = cascade;
		if (open === null) return;
		const opening = !isBranchOpen(open, path);
		cascade = toggleBranch(open, path);
		// Opening is the same gesture as opening the root card, so it lands the
		// reader inside the answer; closing leaves them on the chip they pressed.
		focusRequestPath = opening ? serializePath(path) : null;
	}

	/**
	 * The chip that opened the card at this path. It carries the same serialized
	 * path the card does, which is what makes this a lookup rather than a search:
	 * quantity keys embed a NUL, and `CSS.escape` turns that into U+FFFD rather
	 * than escaping it, so the raw key is not usable in a selector.
	 */
	function drillChipFor(serializedPath: string): HTMLElement | null {
		const found = rootCard()?.querySelector(`[data-peek-drill-path="${serializedPath}"]`);
		return found instanceof HTMLElement ? found : null;
	}

	// One listener pair for the whole cascade, registered from inside the click
	// that opened it, so the opening gesture's own pointerdown has been and gone.
	$effect(() => {
		if (cascade === null) return;

		function onPointerDown(event: PointerEvent) {
			const target = event.target;
			if (target instanceof Node) {
				if (rootCard()?.contains(target)) return;
				// The chip is a toggle; letting the press close the cascade would leave
				// its click reopening what the reader just asked to dismiss.
				if (peekAnchor?.contains(target)) return;
			}
			closeCascade();
		}

		function onKeyDown(event: KeyboardEvent) {
			if (event.key !== 'Escape') return;
			const open = cascade;
			if (open === null) return;
			// The focus overlay closes on Escape too, and dismissing a card is the
			// narrower intent while one is open.
			event.stopPropagation();

			// Deepest wins, read off the DOM rather than from a second copy of the
			// tree: the card holding focus is the one the reader is in.
			const active = document.activeElement;
			const holder = active instanceof Element ? active.closest('[data-peek-path]') : null;
			const serializedPath = holder?.getAttribute('data-peek-path') ?? '';
			if (serializedPath === '') {
				closeCascade();
				return;
			}

			// Read the chip before the card goes, then hand the reader back to the
			// question they had just asked rather than to the top of the tab order.
			const chip = drillChipFor(serializedPath);
			cascade = closeBranch(open, parsePath(serializedPath));
			focusRequestPath = null;
			chip?.focus();
		}

		document.addEventListener('pointerdown', onPointerDown, true);
		document.addEventListener('keydown', onKeyDown, true);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown, true);
			document.removeEventListener('keydown', onKeyDown, true);
		};
	});

	const imageBlocks = $derived(
		(node.content ?? []).filter((block): block is NodeImageContent => block.type === 'image')
	);

	$effect(() => {
		let cancelled = false;
		const urlsToRevoke: string[] = [];
		async function loadImages() {
			if (!assetStore || !assetScope) return;
			const loaded: Record<string, string> = {};
			for (const image of imageBlocks) {
				const asset = await assetStore.get(assetScope, image.assetId);
				if (!asset.ok) continue;
				const url = URL.createObjectURL(asset.value.blob);
				urlsToRevoke.push(url);
				loaded[image.assetId] = url;
			}
			if (!cancelled) imageUrls = loaded;
		}
		void loadImages();
		return () => {
			cancelled = true;
			for (const url of urlsToRevoke) URL.revokeObjectURL(url);
		};
	});
</script>

<div class="focus-content" data-focus-zoom-scale="1">
	{#if node.description.trim()}
		<p class="description"><MathText text={node.description} /></p>
	{/if}

	{#if hasDesignations}
		<!--
			Read-only here on purpose: this surface sits over the canvas, where a tap
			that quietly rewrote the graph would be indistinguishable from a tap that
			navigated. Assignment lives in the edit sheet; peeking lives here.
		-->
		<section class="designation-section" bind:this={peekSection}>
			<QuantityDesignationChips mode="view" view={designations} onPeek={openPeek} {peekKey} />
			{#if cascade !== null}
				<!--
					One instance for the whole cascade, and no remount when the reader asks
					about another quantity: focus is directed by `focusRequestPath`, which
					lands them inside the new answer without throwing away the DOM.
				-->
				<QuantityPeekCard
					isRoot
					entry={peekEntry}
					label={peekLabel}
					quantityKey={cascade.rootKey}
					{cascade}
					{titleForNodeId}
					{inputsForNodeId}
					{quantityEntryFor}
					{focusRequestPath}
					onFocusHandled={() => (focusRequestPath = null)}
					onToggleBranch={toggleBranchAt}
					onJumpToNode={(nodeId) => {
						cascade = null;
						focusRequestPath = null;
						peekAnchor = null;
						onJumpToNode?.(nodeId);
					}}
					{onCreateDefiningNode}
					onClose={closeCascade}
				/>
			{/if}
		</section>
	{/if}

	{#if diagnostics.items.length > 0 || diagnostics.cycleNodeIds.length > 0}
		<!--
			Kept off the canvas on purpose. An undefined letter is common while
			drafting, so flagging it at graph scale would be noise; here it reads as
			an invitation to extend the graph.
		-->
		<section
			class="quantity-diagnostics"
			aria-label="Quantity diagnostics"
			data-quantity-diagnostics
		>
			<ul>
				{#each diagnostics.items as item (item.key)}
					<li data-diagnostic-state={item.state} data-diagnostic-quantity={item.label}>
						<span class="quantity">{item.label}</span>
						<span class="reason">{DIAGNOSTIC_TEXT[item.state]}</span>
						{#if item.nodeIds.length > 0}
							<span class="related">
								{#each item.nodeIds as relatedId (relatedId)}
									<button
										type="button"
										data-reveal-node={relatedId}
										onclick={() => onJumpToNode?.(relatedId)}>{titleForNodeId(relatedId)}</button
									>
								{/each}
							</span>
						{/if}
						{#if item.state === 'unresolved' && onCreateDefiningNode}
							<button
								type="button"
								class="create"
								data-create-defining-node={item.label}
								onclick={() => onCreateDefiningNode(item.label, item.key)}
								>Define {item.label}</button
							>
						{/if}
					</li>
				{/each}
				{#if diagnostics.cycleNodeIds.length > 0}
					<li data-diagnostic-state="cycle">
						<span class="reason">Defined in terms of itself, through</span>
						<span class="related">
							{#each diagnostics.cycleNodeIds as relatedId (relatedId)}
								<button
									type="button"
									data-reveal-node={relatedId}
									onclick={() => onJumpToNode?.(relatedId)}>{titleForNodeId(relatedId)}</button
								>
							{/each}
						</span>
					</li>
				{/if}
			</ul>
		</section>
	{/if}

	{#if imageBlocks.length > 0}
		<div class="image-grid" aria-label="Node images">
			{#each imageBlocks as image (image.assetId)}
				{@const asset = assets[image.assetId]}
				<figure>
					{#if imageUrls[image.assetId]}
						<div class="image-frame" role="presentation">
							<img
								class="focus-image"
								data-asset-id={image.assetId}
								src={imageUrls[image.assetId]}
								alt={image.alt}
							/>
						</div>
					{:else}
						<div class="missing-image" role="img" aria-label={image.alt || 'Missing image'}>
							{asset?.name ?? 'Image unavailable'}
						</div>
					{/if}
					{#if image.caption}
						<figcaption>{image.caption}</figcaption>
					{/if}
				</figure>
			{/each}
		</div>
	{/if}
</div>

<style>
	.focus-content {
		display: grid;
		gap: 1rem;
		color: #334155;
		font-size: 1.125rem;
		line-height: 1.65;
	}

	p,
	figure {
		margin: 0;
	}

	.description {
		color: #334155;
		font-size: 1.125rem;
		line-height: 1.65;
		white-space: pre-wrap;
	}

	/* Positions the peek card, which is absolute so it never reflows the section. */
	.designation-section {
		position: relative;
	}

	.quantity-diagnostics ul {
		display: grid;
		gap: 0.4rem;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 0.95rem;
	}

	.quantity-diagnostics li {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.4rem;
		padding-left: 0.6rem;
		border-left: 3px solid #cbd5e1;
	}

	.quantity-diagnostics li[data-diagnostic-state='unresolved'] {
		border-left-color: #f59e0b;
	}

	.quantity-diagnostics li[data-diagnostic-state='conflict'],
	.quantity-diagnostics li[data-diagnostic-state='cycle'] {
		border-left-color: #ef4444;
	}

	.quantity {
		font-style: italic;
		font-weight: 600;
	}

	.reason {
		color: #64748b;
	}

	.related {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.quantity-diagnostics button {
		border: 1px solid #cbd5e1;
		border-radius: 0.35rem;
		background: #f8fafc;
		color: #334155;
		padding: 0.05rem 0.4rem;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.quantity-diagnostics button.create {
		border-color: #f59e0b;
		background: #fffbeb;
	}

	.image-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: 1rem;
	}

	figure {
		display: grid;
		gap: 0.5rem;
	}

	.image-frame,
	.missing-image {
		aspect-ratio: 4 / 3;
		width: 100%;
		border: 1px solid #cbd5e1;
		border-radius: 0.5rem;
		background: #f8fafc;
		overflow: hidden;
	}

	img {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.missing-image {
		display: grid;
		place-items: center;
		color: #64748b;
	}

	figcaption {
		color: #475569;
		font-size: 0.925rem;
	}
</style>
