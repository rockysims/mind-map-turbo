<script lang="ts">
	import type { GraphAssetStore } from '$lib/assets/assetStore';
	import MathText from '../MathText/MathText.svelte';
	import type { GraphAssetMetadata } from '../types/multigraph';
	import type { NodeData, NodeImageContent } from '../types/node';

	let {
		node,
		assets = {},
		assetStore = null,
		assetScope = ''
	}: {
		node: NodeData;
		assets?: Record<string, GraphAssetMetadata>;
		assetStore?: GraphAssetStore | null;
		assetScope?: string;
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
