<script lang="ts">
	import type { Snippet } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import type { NodeData } from '../types/node';
	import type { Point } from '../types/multigraph';
	import {
		scaleFromWheelDelta,
		clampScale,
		DEFAULT_MIN_SCALE,
		DEFAULT_MAX_SCALE
	} from './lib/graphMath.js';
	import { pointerDistance } from './lib/hitTest.js';
	import { recognizeLongPress } from './lib/longPress.js';
	import { clientPointToGraphPoint } from './lib/stageCoordinates.js';
	import { DRAG_THRESHOLD, DBL_CLICK_MS, LONG_PRESS_DIST, LONG_PRESS_MS } from '$lib/constants.js';

	interface Props {
		/** Resolve node at (clientX, clientY); return null if none. Injected for testability. */
		getNodeAt: (clientX: number, clientY: number) => NodeData | null;
		/** Pixels of movement below which we treat as click rather than drag. */
		dragThreshold?: number;
		/** Callback when user single-click-drags a node and releases with a graph-local point. */
		onNodeMoved?: (node: NodeData, point: Point) => void;
		/** Callback when user starts dragging a node after crossing the drag threshold. */
		onNodeDragStart?: (node: NodeData) => void;
		/** Callback when user releases or cancels an active node drag. */
		onNodeDragEnd?: (node: NodeData) => void;
		/** Callback when user double-clicks a node (make primary). */
		onNodeMakePrimary?: (node: NodeData) => void;
		/** Callback when user double-click-drags and drops onto another node (e.g. add edge). */
		onNodeDoubleClickDropOntoNode?: (sourceNode: NodeData, targetNode: NodeData) => void;
		/** Callback when user double-click-drags and drops onto background with a graph-local point. */
		onNodeDoubleClickDropOntoBackground?: (node: NodeData, point: Point) => void;
		/** Callback when user holds a node without dragging. */
		onNodeLongPress?: (node: NodeData, point: Point) => void;
	}

	let {
		getNodeAt,
		dragThreshold = DRAG_THRESHOLD,
		onNodeMoved,
		onNodeDragStart,
		onNodeDragEnd,
		onNodeMakePrimary,
		onNodeDoubleClickDropOntoNode,
		onNodeDoubleClickDropOntoBackground,
		onNodeLongPress,
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
	let dragCurrentPos = $state<{ x: number; y: number } | null>(null);
	let isNodeDragActive = $state(false);

	// Double-click: same node clicked twice within DBL_CLICK_MS
	let lastClickNodeId = $state<string | null>(null);
	let lastClickTime = $state(0);
	let isDoubleClickSession = $state(false);

	let longPressTimeoutId: ReturnType<typeof setTimeout> | null = null;
	let longPressStartTime = 0;
	let longPressFired = false;

	function onPointerDown(e: PointerEvent) {
		const node = getNodeAt(e.clientX, e.clientY);
		if (node) {
			dragNode = node;
			dragStartPos = { x: e.clientX, y: e.clientY };
			dragCurrentPos = dragStartPos;
			longPressFired = false;
			isDoubleClickSession =
				lastClickNodeId === node.id && Date.now() - lastClickTime < DBL_CLICK_MS;
			startLongPressTimer(node);
		} else {
			panStart = { clientX: e.clientX, clientY: e.clientY, panX, panY };
			isDoubleClickSession = false;
		}
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function startLongPressTimer(node: NodeData) {
		cancelLongPressTimer();
		longPressStartTime = Date.now();
		longPressTimeoutId = setTimeout(() => {
			if (!dragNode || dragNode.id !== node.id || !dragStartPos || !dragCurrentPos) return;
			if (activePointers.size !== 1 || isNodeDragActive || isDoubleClickSession) return;
			const distance = pointerDistance(
				dragStartPos.x,
				dragStartPos.y,
				dragCurrentPos.x,
				dragCurrentPos.y
			);
			if (
				recognizeLongPress({
					duration: Date.now() - longPressStartTime,
					distance,
					minDuration: LONG_PRESS_MS,
					maxDistance: LONG_PRESS_DIST
				})
			) {
				longPressFired = true;
				onNodeLongPress?.(node, { x: dragCurrentPos.x, y: dragCurrentPos.y });
			}
			longPressTimeoutId = null;
		}, LONG_PRESS_MS);
	}

	function cancelLongPressTimer() {
		if (longPressTimeoutId === null) return;
		clearTimeout(longPressTimeoutId);
		longPressTimeoutId = null;
	}

	function cancelActiveNodeGesture() {
		cancelLongPressTimer();
		if (dragNode && isNodeDragActive) {
			onNodeDragEnd?.(dragNode);
		}
		dragNode = null;
		dragStartPos = null;
		dragCurrentPos = null;
		isNodeDragActive = false;
		longPressFired = false;
		isDoubleClickSession = false;
	}

	function graphPointForEvent(e: PointerEvent): Point {
		const stage = e.currentTarget as HTMLElement;
		const frame = stage.parentElement ?? stage;

		return clientPointToGraphPoint(
			{ x: e.clientX, y: e.clientY },
			frame.getBoundingClientRect(),
			{ x: panX, y: panY },
			scale
		);
	}

	function onPointerMove(e: PointerEvent) {
		if (panStart) {
			panX = panStart.panX + (e.clientX - panStart.clientX);
			panY = panStart.panY + (e.clientY - panStart.clientY);
		} else if (dragNode && dragStartPos && !isDoubleClickSession) {
			const dist = pointerDistance(dragStartPos.x, dragStartPos.y, e.clientX, e.clientY);
			dragCurrentPos = { x: e.clientX, y: e.clientY };
			if (dist > LONG_PRESS_DIST || getNodeAt(e.clientX, e.clientY)?.id !== dragNode.id) {
				cancelLongPressTimer();
			}
			if (dist >= dragThreshold) {
				cancelLongPressTimer();
				if (!isNodeDragActive) {
					isNodeDragActive = true;
					onNodeDragStart?.(dragNode);
				}
				onNodeMoved?.(dragNode, graphPointForEvent(e));
			}
		}
	}

	function onPointerUp(e: PointerEvent) {
		const stage = e.currentTarget as HTMLElement;
		const isCancel = e.type === 'pointercancel';

		if (dragNode && dragStartPos) {
			// Only fire drop/click callbacks on actual pointerup; cancel means the gesture was aborted (e.g. drag started)
			cancelLongPressTimer();
			if (!isCancel && !longPressFired) {
				const dropTarget = getNodeAt(e.clientX, e.clientY);
				const dist = pointerDistance(dragStartPos.x, dragStartPos.y, e.clientX, e.clientY);
				const didDrag = dist >= dragThreshold;

				if (isDoubleClickSession) {
					lastClickNodeId = null;
					lastClickTime = 0;
				}

				if (didDrag) {
					if (isDoubleClickSession) {
						if (dropTarget && dropTarget.id !== dragNode.id) {
							onNodeDoubleClickDropOntoNode?.(dragNode, dropTarget);
						} else if (!dropTarget || dropTarget.id === dragNode.id) {
							onNodeDoubleClickDropOntoBackground?.(dragNode, graphPointForEvent(e));
						}
					} else {
						onNodeMoved?.(dragNode, graphPointForEvent(e));
					}
				} else if (isDoubleClickSession) {
					onNodeMakePrimary?.(dragNode);
				} else {
					lastClickNodeId = dragNode.id;
					lastClickTime = Date.now();
				}
			}

			if (isNodeDragActive) {
				onNodeDragEnd?.(dragNode);
			}
			isNodeDragActive = false;
			dragNode = null;
			dragStartPos = null;
			dragCurrentPos = null;
			longPressFired = false;
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
	const activePointers = new SvelteMap<number, { clientX: number; clientY: number }>();

	function getTwoPointerDistance(): number | null {
		const pts = [...activePointers.values()];
		if (pts.length !== 2) return null;
		return pointerDistance(pts[0].clientX, pts[0].clientY, pts[1].clientX, pts[1].clientY);
	}

	function onPointerDownStage(e: PointerEvent) {
		activePointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
		if (activePointers.size === 1) {
			onPointerDown(e);
		} else if (activePointers.size === 2) {
			panStart = null;
			cancelActiveNodeGesture();
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

	const transformStyle = $derived(`translate(${panX}px, ${panY}px) scale(${scale})`);
</script>

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
		-webkit-user-select: none;
		user-select: none;
	}
	.stage.panning {
		cursor: grabbing;
	}
</style>
