<script lang="ts">
	import type { GraphAssetMetadata } from '../types/multigraph';
	import type { NodeData, NodeImageContent } from '../types/node';
	import type { GraphAssetStore } from '$lib/assets/assetStore';

	let {
		node,
		assets = {},
		assetStore = null,
		assetScope = '',
		reduceMotion = false,
		onClose,
		onImageOpen,
		onZoomOutBoundary
	}: {
		node: NodeData;
		assets?: Record<string, GraphAssetMetadata>;
		assetStore?: GraphAssetStore | null;
		assetScope?: string;
		reduceMotion?: boolean;
		onClose: () => void;
		onImageOpen: (image: NodeImageContent, url: string) => void;
		onZoomOutBoundary?: (delta: number) => void;
	} = $props();

	let imageUrls = $state<Record<string, string>>({});
	let status = $state('');

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

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') onClose();
	}

	function handleWheel(event: WheelEvent) {
		if (event.deltaY <= 0) return;
		event.preventDefault();
		onZoomOutBoundary?.(Math.min(1, event.deltaY / 500));
	}
</script>

<div
	class="focus-layer"
	class:reduced-motion={reduceMotion}
	role="dialog"
	aria-modal="true"
	aria-labelledby="node-focus-title"
	tabindex="-1"
	onkeydown={handleKeydown}
	onwheel={handleWheel}
	onpointerdown={(event) => event.stopPropagation()}
>
	<div class="focus-surface">
		<button class="close-button" type="button" aria-label="Close node focus" onclick={onClose}>
			Close
		</button>
		<article>
			<header>
				<h1 id="node-focus-title">{node.title}</h1>
			</header>
			{#if node.description.trim()}
				<p class="description">{node.description}</p>
			{/if}

			{#if imageBlocks.length > 0}
				<div class="image-grid" aria-label="Node images">
					{#each imageBlocks as image (image.assetId)}
						{@const asset = assets[image.assetId]}
						<figure>
							{#if imageUrls[image.assetId]}
								<button
									type="button"
									class="image-button"
									aria-label={`Inspect ${image.alt || asset?.name || 'image'}`}
									onclick={() => onImageOpen(image, imageUrls[image.assetId])}
								>
									<img src={imageUrls[image.assetId]} alt={image.alt} />
								</button>
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

			{#if status}
				<p role="status" class="status">{status}</p>
			{/if}
		</article>
	</div>
</div>

<style>
	.focus-layer {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: grid;
		place-items: center;
		padding: 1rem;
		background: rgb(248 250 252 / 96%);
		pointer-events: auto;
		touch-action: none;
		animation: focus-in 220ms ease-out;
	}

	.focus-surface {
		position: relative;
		box-sizing: border-box;
		width: min(100%, 52rem);
		max-height: min(100%, 46rem);
		overflow: auto;
		border: 2px solid #334155;
		border-radius: 1.25rem;
		background: #ffffff;
		box-shadow: 0 24px 80px rgb(15 23 42 / 22%);
	}

	article {
		display: grid;
		gap: 1rem;
		padding: clamp(1.25rem, 4vw, 3rem);
	}

	h1,
	p,
	figure {
		margin: 0;
	}

	h1 {
		padding-right: 4rem;
		color: #111827;
		font-size: clamp(2rem, 8vw, 4rem);
		line-height: 1.05;
	}

	.description {
		color: #334155;
		font-size: 1.125rem;
		line-height: 1.65;
		white-space: pre-wrap;
	}

	.close-button {
		position: sticky;
		top: 0.75rem;
		float: right;
		z-index: 1;
		min-height: 2.5rem;
		border: 0;
		border-radius: 999px;
		margin: 0.75rem 0.75rem 0 0;
		padding: 0.5rem 0.875rem;
		background: #0f172a;
		color: white;
		font: inherit;
		cursor: pointer;
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

	.image-button,
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

	figcaption,
	.status {
		color: #475569;
		font-size: 0.925rem;
	}

	.focus-layer.reduced-motion {
		animation: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.focus-layer {
			animation: none;
		}
	}

	@keyframes focus-in {
		from {
			opacity: 0;
			transform: scale(0.96);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}
</style>
