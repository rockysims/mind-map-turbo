<script lang="ts">
	import { APP_CONFIG } from '$lib/appConfig';
	import Node from '$lib/components/ui/Node/Node.svelte';
	import ZoomWorld from './ZoomWorld.svelte';
	import type { GraphAssetMetadata } from '../types/multigraph';
	import type { NodeData, NodeImageContent } from '../types/node';
	import type { GraphAssetStore } from '$lib/assets/assetStore';
	import type { TagColorSegment } from './lib/tagColors';
	import { scaleFromWheelDelta } from './lib/graphMath';
	import {
		beginEntryGestureGate,
		EMPTY_ENTRY_GESTURE_GATE,
		stepEntryGestureGate,
		type EntryGestureDirection,
		type EntryGestureGateState
	} from './lib/entryGestureGate';
	import {
		clampImageZoomState,
		imageFitScale,
		imageZoomLimits,
		zoomImageAtPoint,
		type ImageZoomBounds,
		type ImageZoomState
	} from './lib/imageZoom';
	import {
		EMPTY_OVERSHOOT_STATE,
		overshootInput,
		resetOvershootAfterCommit,
		type NodeFocusMorphSource,
		type OvershootState
	} from './lib/nodeFocus.js';
	import { inscribedContactForRect } from './lib/zoomBoundary';

	let {
		node,
		assets = {},
		borderSegments = [],
		assetStore = null,
		assetScope = '',
		reduceMotion = false,
		morphSource = null,
		detailsProgress = 1,
		exiting = false,
		entryGestureIdleMs = 0,
		onClose,
		onZoomOutBoundary
	}: {
		node: NodeData;
		assets?: Record<string, GraphAssetMetadata>;
		borderSegments?: TagColorSegment[];
		assetStore?: GraphAssetStore | null;
		assetScope?: string;
		reduceMotion?: boolean;
		morphSource?: NodeFocusMorphSource | null;
		detailsProgress?: number;
		exiting?: boolean;
		entryGestureIdleMs?: number;
		onClose: () => void;
		onZoomOutBoundary?: (delta: number) => void;
	} = $props();

	let imageUrls = $state<Record<string, string>>({});
	let surfaceRef = $state<HTMLElement | null>(null);
	let activeImageAssetId = $state<string | null>(null);
	let activeImageFitScale = $state(1);
	let imageZoom = $state<ImageZoomState>({ panX: 0, panY: 0, scale: 1 });
	let imageOvershoot = $state<OvershootState>(EMPTY_OVERSHOOT_STATE);
	let imageEntryGestureGate = $state<EntryGestureGateState>(EMPTY_ENTRY_GESTURE_GATE);
	let imageDragStart = $state<{
		clientX: number;
		clientY: number;
		panX: number;
		panY: number;
	} | null>(null);

	const imageBlocks = $derived(
		(node.content ?? []).filter((block): block is NodeImageContent => block.type === 'image')
	);
	const focusTransitionMs = APP_CONFIG.multigraph.focus.entryTransitionMs;
	const morphStyle = $derived(`--focus-transition-duration: ${focusTransitionMs}ms`);

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

	function handleWorldExitBoundary(delta: number) {
		onZoomOutBoundary?.(delta);
	}

	function imageElementByAssetId(assetId: string): HTMLImageElement | null {
		if (!surfaceRef) return null;
		const image = surfaceRef.querySelector(`.focus-image[data-asset-id="${assetId}"]`);
		return image instanceof HTMLImageElement ? image : null;
	}

	function boundsForImage(image: HTMLImageElement): ImageZoomBounds | null {
		const frame = image.closest('.image-frame');
		if (!(frame instanceof HTMLElement)) return null;
		const frameRect = frame.getBoundingClientRect();
		return {
			viewportWidth: frameRect.width,
			viewportHeight: frameRect.height,
			naturalWidth: image.naturalWidth || image.getBoundingClientRect().width,
			naturalHeight: image.naturalHeight || image.getBoundingClientRect().height
		};
	}

	function imageIsInscribed(image: HTMLImageElement): boolean {
		const rect = image.getBoundingClientRect();
		const margin = APP_CONFIG.multigraph.focus.boundaryNearTouchMarginPx;
		const contact = inscribedContactForRect(
			{
				left: rect.left,
				top: rect.top,
				width: rect.width,
				height: rect.height
			},
			{ width: window.innerWidth, height: window.innerHeight }
		);
		const coversX = rect.left <= margin && rect.right >= window.innerWidth - margin;
		const coversY = rect.top <= margin && rect.bottom >= window.innerHeight - margin;
		return contact.inscribed || coversX || coversY;
	}

	function enterImageZoom(assetId: string, bounds: ImageZoomBounds) {
		activeImageAssetId = assetId;
		activeImageFitScale = imageFitScale(bounds);
		imageZoom = { panX: 0, panY: 0, scale: activeImageFitScale };
		imageEntryGestureGate = beginEntryGestureGate(
			'in',
			Date.now(),
			APP_CONFIG.multigraph.focus.entryGestureIdleMs
		);
		imageOvershoot = resetOvershootAfterCommit(Date.now());
	}

	function exitImageZoom() {
		activeImageAssetId = null;
		activeImageFitScale = 1;
		imageZoom = { panX: 0, panY: 0, scale: 1 };
		imageEntryGestureGate = EMPTY_ENTRY_GESTURE_GATE;
		imageOvershoot = resetOvershootAfterCommit(Date.now());
	}

	function shouldSwallowImageEntryZoom(direction: EntryGestureDirection): boolean {
		const step = stepEntryGestureGate(
			imageEntryGestureGate,
			{ direction },
			Date.now(),
			APP_CONFIG.multigraph.focus.entryGestureIdleMs
		);
		imageEntryGestureGate = step.state;
		return step.swallow;
	}

	function handleImageWheel(event: WheelEvent, assetId: string) {
		const image = imageElementByAssetId(assetId);
		if (!image) return;
		const bounds = boundsForImage(image);
		if (!bounds) return;

		if (activeImageAssetId !== assetId) {
			if (event.deltaY >= 0 || !imageIsInscribed(image)) return;
			event.preventDefault();
			event.stopPropagation();
			imageOvershoot = overshootInput(
				imageOvershoot,
				Math.min(1, Math.abs(event.deltaY) / APP_CONFIG.multigraph.focus.exitOvershootDeltaScale),
				Date.now()
			);
			if (imageOvershoot.committed) enterImageZoom(assetId, bounds);
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		if (shouldSwallowImageEntryZoom(event.deltaY < 0 ? 'in' : 'out')) return;
		const limits = imageZoomLimits(bounds);
		if (event.deltaY > 0 && imageZoom.scale <= limits.minScale + 0.001) {
			imageOvershoot = overshootInput(
				imageOvershoot,
				Math.min(1, event.deltaY / APP_CONFIG.multigraph.focus.exitOvershootDeltaScale),
				Date.now()
			);
			if (imageOvershoot.committed) exitImageZoom();
			return;
		}

		const frame = image.closest('.image-frame');
		if (!(frame instanceof HTMLElement)) return;
		const frameRect = frame.getBoundingClientRect();
		const nextScale = scaleFromWheelDelta(
			imageZoom.scale,
			event.deltaY,
			APP_CONFIG.multigraph.focus.worldWheelSensitivity,
			limits.minScale,
			limits.maxScale
		);
		imageZoom = zoomImageAtPoint(
			imageZoom,
			nextScale,
			{ x: event.clientX - frameRect.left, y: event.clientY - frameRect.top },
			{ x: frameRect.width / 2, y: frameRect.height / 2 },
			bounds
		);
	}

	function handleImagePointerDown(event: PointerEvent, assetId: string) {
		if (activeImageAssetId !== assetId) return;
		event.stopPropagation();
		imageDragStart = {
			clientX: event.clientX,
			clientY: event.clientY,
			panX: imageZoom.panX,
			panY: imageZoom.panY
		};
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function handleImagePointerMove(event: PointerEvent, assetId: string) {
		if (activeImageAssetId !== assetId || !imageDragStart) return;
		event.stopPropagation();
		const image = imageElementByAssetId(assetId);
		const bounds = image ? boundsForImage(image) : null;
		if (!bounds) return;
		imageZoom = clampImageZoomState(
			{
				...imageZoom,
				panX: imageDragStart.panX + event.clientX - imageDragStart.clientX,
				panY: imageDragStart.panY + event.clientY - imageDragStart.clientY
			},
			bounds
		);
	}

	function handleImagePointerUp(event: PointerEvent) {
		imageDragStart = null;
		const target = event.currentTarget as HTMLElement;
		if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
	}

	function imageTransformStyle(assetId: string): string {
		if (activeImageAssetId !== assetId) return '';
		const relativeScale = imageZoom.scale / activeImageFitScale;
		return `transform: translate(${imageZoom.panX}px, ${imageZoom.panY}px) scale(${relativeScale});`;
	}
</script>

<div
	class="focus-layer"
	class:reduced-motion={reduceMotion}
	class:exiting
	role="dialog"
	aria-modal="true"
	aria-labelledby="node-focus-title"
	tabindex="-1"
	onkeydown={handleKeydown}
>
	<button class="close-button" type="button" aria-label="Close node focus" onclick={onClose}>
		Close
	</button>
	<ZoomWorld {entryGestureIdleMs} onExitBoundary={handleWorldExitBoundary}>
		<div
			bind:this={surfaceRef}
			class="focus-surface"
			class:exiting
			style={morphStyle}
			data-morph-source-node-id={morphSource?.nodeId}
		>
			<Node
				nodeData={node}
				{borderSegments}
				detailsMode
				{detailsProgress}
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
										<div
											class="image-frame"
											class:image-focused={activeImageAssetId === image.assetId}
											role="presentation"
											onwheel={(event) => handleImageWheel(event, image.assetId)}
											onpointerdown={(event) => handleImagePointerDown(event, image.assetId)}
											onpointermove={(event) => handleImagePointerMove(event, image.assetId)}
											onpointerup={handleImagePointerUp}
											onpointercancel={handleImagePointerUp}
											data-image-focused={activeImageAssetId === image.assetId ? 'true' : undefined}
										>
											<img
												class="focus-image"
												data-asset-id={image.assetId}
												data-image-zoom-scale={activeImageAssetId === image.assetId
													? imageZoom.scale
													: undefined}
												src={imageUrls[image.assetId]}
												alt={image.alt}
												style={imageTransformStyle(image.assetId)}
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
			</Node>
		</div>
	</ZoomWorld>
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
		position: relative;
		box-sizing: border-box;
	}

	.focus-surface {
		animation: focus-surface-fade var(--focus-transition-duration) ease-out both;
	}

	.focus-surface.exiting {
		animation: focus-surface-fade var(--focus-transition-duration) ease-in reverse both;
	}

	.focus-content {
		transform-origin: 50% 50%;
		will-change: transform;
		animation: focus-content-in var(--focus-transition-duration) ease-out both;
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
		z-index: 2;
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

	.focus-image {
		transform-origin: 50% 50%;
		will-change: transform;
	}

	.image-frame.image-focused {
		cursor: grab;
		touch-action: none;
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
		.focus-surface,
		.focus-content {
			animation: none;
		}
	}

	@keyframes focus-surface-fade {
		from {
			opacity: 0;
			transform: scale(0.96);
		}
		to {
			opacity: 1;
			transform: scale(1);
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
