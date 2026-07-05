<script lang="ts">
	import type { NodeImageContent } from '../types/node';
	import { scaleFromWheelDelta } from './lib/graphMath';
	import { clampImageZoomState, zoomImageAtPoint, type ImageZoomState } from './lib/imageZoom';

	let {
		image,
		url,
		onClose,
		onZoomOutBoundary
	}: {
		image: NodeImageContent;
		url: string;
		onClose: () => void;
		onZoomOutBoundary?: (delta: number) => void;
	} = $props();

	let surfaceRef = $state<HTMLElement | null>(null);
	let naturalWidth = $state(1);
	let naturalHeight = $state(1);
	let zoomState = $state<ImageZoomState>({ panX: 0, panY: 0, scale: 1 });
	let dragStart = $state<{ x: number; y: number; panX: number; panY: number } | null>(null);

	function bounds() {
		const rect = surfaceRef?.getBoundingClientRect();
		return {
			viewportWidth: rect?.width ?? 1,
			viewportHeight: rect?.height ?? 1,
			naturalWidth,
			naturalHeight
		};
	}

	function handleWheel(event: WheelEvent) {
		event.preventDefault();
		const nextScale = scaleFromWheelDelta(zoomState.scale, event.deltaY, 0.002, 0.01, 100);
		if (
			event.deltaY > 0 &&
			zoomState.scale <= clampImageZoomState(zoomState, bounds()).scale + 0.001
		) {
			onZoomOutBoundary?.(Math.min(1, event.deltaY / 500));
		}
		const rect = surfaceRef?.getBoundingClientRect();
		if (!rect) return;
		zoomState = zoomImageAtPoint(
			zoomState,
			nextScale,
			{ x: event.clientX, y: event.clientY },
			{ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
			bounds()
		);
	}

	function handlePointerDown(event: PointerEvent) {
		dragStart = { x: event.clientX, y: event.clientY, panX: zoomState.panX, panY: zoomState.panY };
		// Svelte types currentTarget broadly, but the handler is bound to the zoom layer element.
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function handlePointerMove(event: PointerEvent) {
		if (!dragStart) return;
		zoomState = clampImageZoomState(
			{
				...zoomState,
				panX: dragStart.panX + event.clientX - dragStart.x,
				panY: dragStart.panY + event.clientY - dragStart.y
			},
			bounds()
		);
	}

	function handlePointerUp(event: PointerEvent) {
		dragStart = null;
		// Svelte types currentTarget broadly, but the handler is bound to the zoom layer element.
		(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') onClose();
	}
</script>

<div
	bind:this={surfaceRef}
	class="image-zoom-layer"
	role="dialog"
	aria-modal="true"
	aria-label={image.alt || 'Image zoom'}
	tabindex="-1"
	onkeydown={handleKeydown}
	onwheel={handleWheel}
	onpointerdown={handlePointerDown}
	onpointermove={handlePointerMove}
	onpointerup={handlePointerUp}
	onpointercancel={handlePointerUp}
>
	<button type="button" class="close-button" aria-label="Close image zoom" onclick={onClose}>
		Close
	</button>
	<img
		src={url}
		alt={image.alt}
		onload={(event) => {
			// Svelte types currentTarget as Element here, but this handler is attached to an img.
			const imageElement = event.currentTarget as HTMLImageElement;
			naturalWidth = imageElement.naturalWidth || 1;
			naturalHeight = imageElement.naturalHeight || 1;
			zoomState = clampImageZoomState(zoomState, bounds());
		}}
		style={`transform: translate(${zoomState.panX}px, ${zoomState.panY}px) scale(${zoomState.scale});`}
	/>
	{#if image.caption}
		<p>{image.caption}</p>
	{/if}
</div>

<style>
	.image-zoom-layer {
		position: fixed;
		inset: 0;
		z-index: 70;
		display: grid;
		place-items: center;
		background: #020617;
		overflow: hidden;
		touch-action: none;
	}

	img {
		max-width: 100%;
		max-height: 100%;
		transform-origin: center;
		user-select: none;
	}

	.close-button {
		position: fixed;
		top: 1rem;
		right: 1rem;
		z-index: 1;
		min-height: 2.5rem;
		border: 0;
		border-radius: 999px;
		padding: 0.5rem 0.875rem;
		background: white;
		color: #0f172a;
		font: inherit;
	}

	p {
		position: fixed;
		bottom: 1rem;
		left: 50%;
		max-width: min(90vw, 42rem);
		margin: 0;
		border-radius: 999px;
		padding: 0.5rem 0.875rem;
		background: rgb(255 255 255 / 90%);
		color: #0f172a;
		transform: translateX(-50%);
	}
</style>
