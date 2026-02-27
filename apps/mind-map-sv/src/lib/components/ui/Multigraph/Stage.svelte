<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { NodeData } from '../types/node';
	import {
		scaleFromWheelDelta,
		clampScale,
		DEFAULT_MIN_SCALE,
		DEFAULT_MAX_SCALE
	} from './lib/graphMath.js';
	import { pointerDistance } from './lib/hitTest.js';

	interface Props {
		/** Resolve node at (clientX, clientY); return null if none. Injected for testability. */
		getNodeAt: (clientX: number, clientY: number) => NodeData | null;
		/** Pixels of movement below which we treat as click rather than drag. */
		dragThreshold?: number;
		/** Callback when user clicks a node (no drag). */
		onNodeClick?: (node: NodeData) => void;
		/** Callback when user drops a node onto another node. */
		onNodeDropOntoNode?: (sourceNode: NodeData, targetNode: NodeData) => void;
		/** Callback when user drops a node onto background. */
		onNodeDropOntoBackground?: (node: NodeData) => void;
	}

	let {
		getNodeAt,
		dragThreshold = 5,
		onNodeClick,
		onNodeDropOntoNode,
		onNodeDropOntoBackground,
		children
	}: Props & { children?: Snippet } = $props();

	// Pan
	let panX = $state(0);
	let panY = $state(0);
	let panStart = $state<{
		clientX: number;
		clientY: number;
		panX: number;
		panY: number;
	} | null>(null);

	// Zoom
	let scale = $state(1);
	let pinchStart = $state<{ distance: number; scale: number } | null>(null);

	// Node drag
	let dragNode = $state<NodeData | null>(null);
	let dragStartPos = $state<{ x: number; y: number } | null>(null);

	function onPointerDown(e: PointerEvent) {
		const node = getNodeAt(e.clientX, e.clientY);
		if (node) {
			dragNode = node;
			dragStartPos = { x: e.clientX, y: e.clientY };
		} else {
			panStart = { clientX: e.clientX, clientY: e.clientY, panX, panY };
		}
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		if (panStart) {
			panX = panStart.panX + (e.clientX - panStart.clientX);
			panY = panStart.panY + (e.clientY - panStart.clientY);
		}
	}

	function onPointerUp(e: PointerEvent) {
		const stage = e.currentTarget as HTMLElement;
		if (dragNode && dragStartPos) {
			const dropTarget = getNodeAt(e.clientX, e.clientY);
			const dist = pointerDistance(dragStartPos.x, dragStartPos.y, e.clientX, e.clientY);
			if (dropTarget) {
				if (dropTarget.id === dragNode.id) {
					if (dist < dragThreshold) {
						onNodeClick?.(dragNode);
					} else {
						onNodeDropOntoNode?.(dragNode, dropTarget);
					}
				} else {
					onNodeDropOntoNode?.(dragNode, dropTarget);
				}
			} else {
				onNodeDropOntoBackground?.(dragNode);
			}
			dragNode = null;
			dragStartPos = null;
			stage.releasePointerCapture(e.pointerId);
			return;
		}
		if (panStart) {
			panStart = null;
			stage.releasePointerCapture(e.pointerId);
		}
	}

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		scale = scaleFromWheelDelta(scale, e.deltaY, undefined, DEFAULT_MIN_SCALE, DEFAULT_MAX_SCALE);
	}

	// Pinch: track two active pointers and update scale from distance ratio
	const activePointers = new Map<number, { clientX: number; clientY: number }>();

	function getTwoPointerDistance(): number | null {
		const pts = [...activePointers.values()];
		if (pts.length !== 2) return null;
		return pointerDistance(pts[0].clientX, pts[0].clientY, pts[1].clientX, pts[1].clientY);
	}

	function onPointerDownStage(e: PointerEvent) {
		activePointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
		if (activePointers.size === 1) {
			onPointerDown(e);
		} else if (activePointers.size === 2 && panStart) {
			panStart = null;
			const dist = getTwoPointerDistance();
			if (dist !== null) pinchStart = { distance: dist, scale };
		}
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onPointerMoveStage(e: PointerEvent) {
		if (activePointers.has(e.pointerId)) {
			activePointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
		}
		if (activePointers.size === 2) {
			const dist = getTwoPointerDistance();
			if (dist !== null) {
				if (!pinchStart) {
					pinchStart = { distance: dist, scale };
				} else {
					const factor = dist / pinchStart.distance;
					scale = clampScale(pinchStart.scale * factor, DEFAULT_MIN_SCALE, DEFAULT_MAX_SCALE);
				}
			}
		} else {
			onPointerMove(e);
		}
	}

	function onPointerUpStage(e: PointerEvent) {
		activePointers.delete(e.pointerId);
		if (activePointers.size < 2) pinchStart = null;
		onPointerUp(e);
	}

	const transformStyle = $derived(
		`translate(${panX}px, ${panY}px) scale(${scale})`
	);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="stage"
	class:panning={panStart !== null}
	style="transform: {transformStyle}; transform-origin: 50% 50%;"
	onpointerdown={onPointerDownStage}
	onpointermove={onPointerMoveStage}
	onpointerup={onPointerUpStage}
	onpointercancel={onPointerUpStage}
	onwheel={onWheel}
		role="presentation"
>
	{#if children}
		{@render children()}
	{/if}
</div>

<style>
	.stage {
		position: absolute;
		inset: 0;
		cursor: grab;
	}
	.stage.panning {
		cursor: grabbing;
	}
</style>
