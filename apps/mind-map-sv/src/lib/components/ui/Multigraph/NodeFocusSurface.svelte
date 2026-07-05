<script lang="ts">
	import { APP_CONFIG } from '$lib/appConfig';
	import type { GraphAssetMetadata } from '../types/multigraph';
	import type { NodeData, NodeImageContent } from '../types/node';
	import type { GraphAssetStore } from '$lib/assets/assetStore';
	import { scaleFromWheelDelta } from './lib/graphMath.js';
	import {
		clampImageZoomState,
		zoomImageAtPoint,
		type ImageZoomBounds,
		type ImageZoomState
	} from './lib/imageZoom.js';
	import type { NodeFocusMorphSource } from './lib/nodeFocus.js';

	let {
		node,
		assets = {},
		assetStore = null,
		assetScope = '',
		reduceMotion = false,
		morphSource = null,
		exiting = false,
		onClose,
		onZoomOutBoundary
	}: {
		node: NodeData;
		assets?: Record<string, GraphAssetMetadata>;
		assetStore?: GraphAssetStore | null;
		assetScope?: string;
		reduceMotion?: boolean;
		morphSource?: NodeFocusMorphSource | null;
		exiting?: boolean;
		onClose: () => void;
		onZoomOutBoundary?: (delta: number) => void;
	} = $props();

	let imageUrls = $state<Record<string, string>>({});
	let surfaceRef = $state<HTMLElement | null>(null);
	let contentRef = $state<HTMLElement | null>(null);
	let activeImageAssetId = $state<string | null>(null);
	let focusZoom = $state<ImageZoomState>({ panX: 0, panY: 0, scale: 1 });
	let dragStart = $state<{
		x: number;
		y: number;
		panX: number;
		panY: number;
	} | null>(null);

	const imageBlocks = $derived(
		(node.content ?? []).filter((block): block is NodeImageContent => block.type === 'image')
	);
	const hasMorph = $derived(morphSource !== null && !reduceMotion);
	const focusTransitionMs = APP_CONFIG.multigraph.focus.entryTransitionMs;
	const morphStyle = $derived(
		morphSource
			? [
					`--focus-transition-duration: ${focusTransitionMs}ms`,
					`--morph-left: ${morphSource.left}px`,
					`--morph-top: ${morphSource.top}px`,
					`--morph-width: ${morphSource.width}px`,
					`--morph-height: ${morphSource.height}px`,
					`--morph-radius: ${morphSource.borderRadius}px`,
					`--morph-background: ${morphSource.background}`,
					`--morph-border-color: ${morphSource.borderColor}`,
					`--morph-border-width: ${morphSource.borderWidth}`,
					`--morph-box-shadow: ${morphSource.boxShadow}`
				].join('; ')
			: `--focus-transition-duration: ${focusTransitionMs}ms`
	);
	const contentTransform = $derived(
		`translate(${focusZoom.panX}px, ${focusZoom.panY}px) scale(${focusZoom.scale})`
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

	function imageElementAt(clientX: number, clientY: number): HTMLImageElement | null {
		const element = document.elementFromPoint(clientX, clientY);
		return element instanceof HTMLImageElement && element.classList.contains('focus-image')
			? element
			: null;
	}

	function imageElementByAssetId(assetId: string | null): HTMLImageElement | null {
		if (!assetId || !contentRef) return null;
		const images = Array.from(contentRef.querySelectorAll('.focus-image')) as HTMLImageElement[];
		return images.find((image) => image.dataset.assetId === assetId) ?? null;
	}

	function boundsForImage(image: HTMLImageElement): ImageZoomBounds | null {
		if (!surfaceRef) return null;
		const surfaceRect = surfaceRef.getBoundingClientRect();
		const imageRect = image.getBoundingClientRect();
		return {
			viewportWidth: surfaceRect.width,
			viewportHeight: surfaceRect.height,
			naturalWidth: imageRect.width,
			naturalHeight: imageRect.height,
			minScale: 1,
			maxScale: APP_CONFIG.multigraph.focus.imageZoomMaxScale
		};
	}

	function handleWheel(event: WheelEvent) {
		const targetImage = imageElementAt(event.clientX, event.clientY);
		const activeImage =
			targetImage ??
			imageElementByAssetId(activeImageAssetId) ??
			imageElementByAssetId(imageBlocks[0]?.assetId);
		if (event.deltaY < 0 && !activeImage) return;
		event.preventDefault();

		if (event.deltaY > 0 && focusZoom.scale <= 1.001) {
			focusZoom = { panX: 0, panY: 0, scale: 1 };
			activeImageAssetId = null;
			onZoomOutBoundary?.(Math.min(1, event.deltaY / 500));
			return;
		}

		if (!activeImage || !surfaceRef) return;
		activeImageAssetId = activeImage.dataset.assetId ?? null;
		const bounds = boundsForImage(activeImage);
		if (!bounds) return;
		const surfaceRect = surfaceRef.getBoundingClientRect();
		const nextScale = scaleFromWheelDelta(
			focusZoom.scale,
			event.deltaY,
			0.002,
			1,
			APP_CONFIG.multigraph.focus.imageZoomMaxScale
		);
		const nextZoom = zoomImageAtPoint(
			focusZoom,
			nextScale,
			{ x: event.clientX - surfaceRect.left, y: event.clientY - surfaceRect.top },
			{ x: surfaceRect.width / 2, y: surfaceRect.height / 2 },
			bounds
		);
		focusZoom = nextZoom.scale <= 1.001 ? { panX: 0, panY: 0, scale: 1 } : nextZoom;
		if (focusZoom.scale <= 1.001) activeImageAssetId = null;
	}

	function handlePointerDown(event: PointerEvent) {
		event.stopPropagation();
		if (focusZoom.scale <= 1.001) return;
		dragStart = { x: event.clientX, y: event.clientY, panX: focusZoom.panX, panY: focusZoom.panY };
		// The handler is bound to the fixed focus layer, which supports pointer capture.
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function handlePointerMove(event: PointerEvent) {
		if (!dragStart) return;
		const activeImage = imageElementByAssetId(activeImageAssetId);
		if (!activeImage) return;
		const bounds = boundsForImage(activeImage);
		if (!bounds) return;
		focusZoom = clampImageZoomState(
			{
				...focusZoom,
				panX: dragStart.panX + event.clientX - dragStart.x,
				panY: dragStart.panY + event.clientY - dragStart.y
			},
			bounds
		);
	}

	function handlePointerUp(event: PointerEvent) {
		dragStart = null;
		// The handler is bound to the fixed focus layer, which supports pointer capture.
		const target = event.currentTarget as HTMLElement;
		if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
	}
</script>

<div
	class="focus-layer"
	class:reduced-motion={reduceMotion}
	class:zooming={focusZoom.scale > 1.001}
	class:exiting
	role="dialog"
	aria-modal="true"
	aria-labelledby="node-focus-title"
	tabindex="-1"
	onkeydown={handleKeydown}
	onwheel={handleWheel}
	onpointerdown={handlePointerDown}
	onpointermove={handlePointerMove}
	onpointerup={handlePointerUp}
	onpointercancel={handlePointerUp}
>
	<div
		bind:this={surfaceRef}
		class="focus-surface"
		class:has-morph={hasMorph}
		class:exiting
		style={morphStyle}
		data-morph-source-node-id={morphSource?.nodeId}
	>
		<button class="close-button" type="button" aria-label="Close node focus" onclick={onClose}>
			Close
		</button>
		<article
			bind:this={contentRef}
			class="focus-content"
			style={`transform: ${contentTransform};`}
			data-focus-zoom-scale={focusZoom.scale}
			data-active-image-asset-id={activeImageAssetId ?? undefined}
		>
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
								<div class="image-frame">
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
		background: transparent;
		pointer-events: auto;
		touch-action: none;
	}

	.focus-layer.exiting {
		pointer-events: none;
	}

	.focus-surface {
		position: fixed;
		left: 50%;
		top: 50%;
		box-sizing: border-box;
		width: min(calc(100% - 2rem), 52rem);
		height: min(calc(100% - 2rem), 46rem);
		overflow: auto;
		border: 2px solid #334155;
		border-radius: 1.25rem;
		background: #ffffff;
		box-shadow: 0 24px 80px rgb(15 23 42 / 22%);
		transform: translate(-50%, -50%);
	}

	.focus-surface:not(.has-morph) {
		animation: focus-surface-fade var(--focus-transition-duration) ease-out both;
	}

	.focus-surface.has-morph {
		animation: surface-morph var(--focus-transition-duration) ease-out both;
	}

	.focus-surface.exiting:not(.has-morph) {
		animation: focus-surface-fade var(--focus-transition-duration) ease-in reverse both;
	}

	.focus-surface.has-morph.exiting {
		animation: surface-morph var(--focus-transition-duration) ease-in reverse both;
	}

	article {
		display: grid;
		gap: 1rem;
		padding: clamp(1.25rem, 4vw, 3rem);
	}

	.focus-content {
		min-height: 100%;
		transform-origin: 50% 50%;
		will-change: transform;
	}

	.focus-surface.has-morph .focus-content {
		animation: focus-content-in var(--focus-transition-duration) ease-out both;
	}

	.focus-surface.has-morph.exiting .focus-content {
		animation: focus-content-in var(--focus-transition-duration) ease-in reverse both;
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
		z-index: 2;
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

	.focus-layer.reduced-motion {
		animation: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.focus-surface.has-morph,
		.focus-surface:not(.has-morph),
		.focus-surface.has-morph .focus-content {
			animation: none;
		}
	}

	@keyframes focus-surface-fade {
		from {
			opacity: 0;
			transform: translate(-50%, -50%) scale(0.96);
		}
		to {
			opacity: 1;
			transform: translate(-50%, -50%) scale(1);
		}
	}

	@keyframes surface-morph {
		from {
			left: var(--morph-left);
			top: var(--morph-top);
			width: var(--morph-width);
			height: var(--morph-height);
			border-color: var(--morph-border-color);
			border-radius: var(--morph-radius);
			border-width: var(--morph-border-width);
			background: var(--morph-background);
			box-shadow: var(--morph-box-shadow);
			transform: none;
		}
		to {
			left: 50%;
			top: 50%;
			width: min(calc(100% - 2rem), 52rem);
			height: min(calc(100% - 2rem), 46rem);
			border-color: #334155;
			border-radius: 1.25rem;
			border-width: 2px;
			background: #ffffff;
			box-shadow: 0 24px 80px rgb(15 23 42 / 22%);
			transform: translate(-50%, -50%);
		}
	}

	@keyframes focus-content-in {
		from {
			opacity: 0;
		}
		70% {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
</style>
