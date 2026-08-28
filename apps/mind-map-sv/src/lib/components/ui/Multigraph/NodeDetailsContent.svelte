<script lang="ts">
	import type { GraphAssetStore } from '$lib/assets/assetStore';
	import MathText from '../MathText/MathText.svelte';
	import type { GraphAssetMetadata } from '../types/multigraph';
	import type { NodeData, NodeImageContent } from '../types/node';
	import type { NodeDiagnosticsView } from './lib/nodeDiagnosticsView';

	const EMPTY_DIAGNOSTICS: NodeDiagnosticsView = { items: [], cycleNodeIds: [] };

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
		titleForNodeId = (nodeId: string) => nodeId,
		onCreateDefiningNode,
		onRevealNode
	}: {
		node: NodeData;
		assets?: Record<string, GraphAssetMetadata>;
		assetStore?: GraphAssetStore | null;
		assetScope?: string;
		/** What this node's math says about quantities it cannot resolve cleanly. */
		diagnostics?: NodeDiagnosticsView;
		titleForNodeId?: (nodeId: string) => string;
		onCreateDefiningNode?: (quantityLabel: string) => void;
		onRevealNode?: (nodeId: string) => void;
	} = $props();

	let imageUrls = $state<Record<string, string>>({});

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
										onclick={() => onRevealNode?.(relatedId)}>{titleForNodeId(relatedId)}</button
									>
								{/each}
							</span>
						{/if}
						{#if item.state === 'unresolved' && onCreateDefiningNode}
							<button
								type="button"
								class="create"
								data-create-defining-node={item.label}
								onclick={() => onCreateDefiningNode(item.label)}>Define {item.label}</button
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
									onclick={() => onRevealNode?.(relatedId)}>{titleForNodeId(relatedId)}</button
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
