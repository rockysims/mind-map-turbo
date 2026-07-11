<script lang="ts">
	import Node from '$lib/components/ui/Node/Node.svelte';
	import DeepZoomLayer from './DeepZoomLayer.svelte';
	import ZoomWorld from './ZoomWorld.svelte';
	import type { GraphAssetStore } from '$lib/assets/assetStore';
	import type { GraphAssetMetadata } from '../types/multigraph';
	import type { NodeData, NodeImageContent } from '../types/node';
	import type { TagColorSegment } from './lib/tagColors';
	import type { Rect } from './lib/zoomBoundary';

	let {
		node,
		assets = {},
		borderSegments = [],
		assetStore = null,
		assetScope = '',
		reduceMotion = false,
		sourceRect,
		fillRect,
		detailsProgress = 1,
		entryGestureIdleMs = 0,
		entryGestureMaxMs = 0,
		onClose,
		onZoomOutBoundary
	}: {
		node: NodeData;
		assets?: Record<string, GraphAssetMetadata>;
		borderSegments?: TagColorSegment[];
		assetStore?: GraphAssetStore | null;
		assetScope?: string;
		reduceMotion?: boolean;
		sourceRect: Rect;
		fillRect: Rect;
		detailsProgress?: number;
		entryGestureIdleMs?: number;
		entryGestureMaxMs?: number;
		onClose: () => void;
		onZoomOutBoundary?: (delta: number) => void;
	} = $props();

	let imageUrls = $state<Record<string, string>>({});
	let surfaceRef = $state<HTMLElement | null>(null);

	const imageBlocks = $derived(
		(node.content ?? []).filter((block): block is NodeImageContent => block.type === 'image')
	);
	const clampedDetailsProgress = $derived(Math.min(1, Math.max(0, detailsProgress)));

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
</script>

<div
	class="focus-layer"
	class:reduced-motion={reduceMotion}
	role="dialog"
	aria-modal="true"
	aria-labelledby="node-focus-title"
	tabindex="-1"
	onkeydown={handleKeydown}
	data-focus-depth="1"
>
	<button class="close-button" type="button" aria-label="Close node focus" onclick={onClose}>
		Close
	</button>

	<DeepZoomLayer {sourceRect} {fillRect} progress={clampedDetailsProgress} {reduceMotion}>
		<ZoomWorld {entryGestureIdleMs} {entryGestureMaxMs} onExitBoundary={onZoomOutBoundary}>
			<div
				bind:this={surfaceRef}
				class="focus-surface"
				class:exiting={clampedDetailsProgress < 1}
				data-morph-source-node-id={node.id}
				data-details-progress={clampedDetailsProgress}
			>
				<Node
					nodeData={node}
					{borderSegments}
					detailsMode
					detailsProgress={clampedDetailsProgress}
					detailsTitleId="node-focus-title"
				>
					<div class="focus-content" data-focus-zoom-scale="1">
						{#if node.description.trim()}
							<p class="description">{node.description}</p>
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
											<div
												class="missing-image"
												role="img"
												aria-label={image.alt || 'Missing image'}
											>
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
				</Node>
			</div>
		</ZoomWorld>
	</DeepZoomLayer>
</div>

<style>
	.focus-layer {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: transparent;
		pointer-events: auto;
		touch-action: none;
	}

	.focus-surface {
		width: 100%;
		height: 100%;
	}

	.focus-surface :global(.node[data-details-mode='true']) {
		width: 100%;
		height: 100%;
	}

	.focus-surface :global(.node[data-details-mode='true'] .circle) {
		width: 100%;
		height: 100%;
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

	.close-button {
		position: fixed;
		top: calc(1rem + env(safe-area-inset-top));
		right: calc(1rem + env(safe-area-inset-right));
		z-index: 65;
		min-height: 2.5rem;
		border: 0;
		border-radius: 999px;
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

	.focus-layer.reduced-motion :global(.deep-zoom-layer) {
		transition: none;
	}
</style>
