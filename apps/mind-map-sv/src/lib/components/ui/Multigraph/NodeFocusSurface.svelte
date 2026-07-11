<script lang="ts">
	import Node from '$lib/components/ui/Node/Node.svelte';
	import DeepZoomLayer from './DeepZoomLayer.svelte';
	import NodeDetailsContent from './NodeDetailsContent.svelte';
	import ZoomWorld from './ZoomWorld.svelte';
	import type { GraphAssetStore } from '$lib/assets/assetStore';
	import type { GraphAssetMetadata } from '../types/multigraph';
	import type { NodeData } from '../types/node';
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
		exitSourceRect,
		fillRect,
		borderWidthPx,
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
		exitSourceRect?: Rect | null;
		fillRect: Rect;
		borderWidthPx?: number;
		detailsProgress?: number;
		entryGestureIdleMs?: number;
		entryGestureMaxMs?: number;
		onClose: () => void;
		onZoomOutBoundary?: (delta: number) => void;
	} = $props();

	let surfaceRef = $state<HTMLElement | null>(null);

	const clampedDetailsProgress = $derived(Math.min(1, Math.max(0, detailsProgress)));
	const effectiveSourceRect = $derived(
		clampedDetailsProgress < 1 && exitSourceRect ? exitSourceRect : sourceRect
	);

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

	<DeepZoomLayer
		sourceRect={effectiveSourceRect}
		{fillRect}
		progress={clampedDetailsProgress}
		{reduceMotion}
	>
		<ZoomWorld {entryGestureIdleMs} {entryGestureMaxMs} onExitBoundary={onZoomOutBoundary}>
			<div
				bind:this={surfaceRef}
				class="focus-surface"
				class:exiting={clampedDetailsProgress < 1}
				data-morph-source-node-id={node.id}
				data-details-progress={clampedDetailsProgress}
				data-focus-border-width={borderWidthPx}
			>
				<Node
					nodeData={node}
					{borderSegments}
					detailsMode
					detailsProgress={clampedDetailsProgress}
					{borderWidthPx}
					detailsTitleId="node-focus-title"
				>
					<NodeDetailsContent {node} {assets} {assetStore} {assetScope} />
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
		border-radius: var(--deep-zoom-border-radius);
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

	.focus-layer.reduced-motion :global(.deep-zoom-layer) {
		transition: none;
	}
</style>
