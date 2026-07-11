<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import type { NodeData } from '../types/node';
	import type { Point } from '../types/multigraph';
	import {
		scaleFromWheelDelta,
		clampScale,
		DEFAULT_MIN_SCALE,
		DEFAULT_MAX_SCALE,
		fitGraphBoundsInView,
		type GraphBounds,
		zoomViewTransformAtPoint
	} from './lib/graphMath.js';
	import { pointerDistance } from './lib/hitTest.js';
	import { recognizeLongPress } from './lib/longPress.js';
	import { focusOverzoomMaxScaleForNode, persistedScaleForFocusOverzoom } from './lib/nodeFocus.js';
	import {
		boundaryReleaseDelta,
		solveFocusEntryBoundary,
		type FocusEntryBoundaryCandidate
	} from './lib/focusEntryBoundary.js';
	import {
		beginEntryGestureGate,
		EMPTY_ENTRY_GESTURE_GATE,
		stepEntryGestureGate,
		type EntryGestureDirection,
		type EntryGestureGateState
	} from './lib/entryGestureGate.js';
	import { clientPointToGraphPoint, type StageRect } from './lib/stageCoordinates.js';
	import {
		DRAG_THRESHOLD,
		DBL_CLICK_MS,
		LONG_PRESS_DIST,
		LONG_PRESS_MS,
		NODE_RADIUS
	} from '$lib/constants.js';

	interface ViewStateSnapshot {
		panX: number;
		panY: number;
		scale: number;
	}

	interface BlockedZoomInput {
		direction: 'in' | 'out';
		focalPoint: Point;
		blockedFactor: number;
		boundaryProgress?: number;
		committed?: boolean;
		nodeId?: string;
		viewState: ViewStateSnapshot;
	}

	interface FitViewRequest {
		id: number;
		bounds: GraphBounds;
		paddingPx?: number;
	}

	interface EntryGestureGateRequest {
		id: number;
		direction: EntryGestureDirection;
		idleMs: number;
		maxMs: number;
	}

	interface Props {
		/** Resolve node at (clientX, clientY); return null if none. Injected for testability. */
		getNodeAt: (clientX: number, clientY: number) => NodeData | null;
		/** Stage zoom scale on mount, clamped to configured min/max. */
		initialScale?: number;
		/** Stage pan X offset in pixels on mount. */
		initialPanX?: number;
		/** Stage pan Y offset in pixels on mount. */
		initialPanY?: number;
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
		/** Fired whenever the internal pan/zoom state changes, including initial mount. */
		onViewStateLiveChange?: (state: ViewStateSnapshot) => void;
		/**
		 * Fired with the stage element's on-screen rect (origin + size) on mount,
		 * on every view change, and on resize. Consumers derive on-screen node
		 * geometry from this rect + the live view state, avoiding any DOM
		 * measurement of the nodes themselves (see the focus morph surface).
		 */
		onStageRectChange?: (rect: StageRect) => void;
		/** Return true when zoom-in past max scale should keep moving toward focus. */
		canOverzoomForFocus?: (input: {
			focalPoint: Point;
			requestedScale: number;
			clampedScale: number;
		}) => boolean;
		/** Return the geometric max visual scale for focus overzoom at this point. */
		focusOverzoomMaxScaleForPoint?: (input: {
			focalPoint: Point;
			requestedScale: number;
			clampedScale: number;
		}) => number | null;
		/**
		 * Return the graph-space focus candidate for boundary camera steering.
		 * `stickyNodeId` is the node already being steered toward, if any: the
		 * steering translation can slide the subject out from under the focal
		 * point, so the consumer should keep resolving that node rather than
		 * re-hit-testing from scratch.
		 */
		focusEntryBoundaryCandidateForPoint?: (input: {
			focalPoint: Point;
			requestedScale: number;
			clampedScale: number;
			viewState: ViewStateSnapshot;
			stickyNodeId?: string;
		}) => FocusEntryBoundaryCandidate | null;
		/** Fired when zoom input continues past the configured scale clamps. */
		onBlockedZoom?: (input: BlockedZoomInput) => void;
		/**
		 * Fired after a user pan/zoom gesture completes (pointer-up after pan, wheel event,
		 * or pinch end). Moving camera does not mutate graph data, so this callback is kept
		 * separate from graph-data mutation callbacks.
		 */
		onViewStateChange?: (state: ViewStateSnapshot) => void;
		/** One-shot request to fit graph-local bounds into the stage viewport. */
		fitViewRequest?: FitViewRequest | null;
		/** One-shot request to swallow residual entry/exit zoom input at the stage boundary. */
		entryGestureGateRequest?: EntryGestureGateRequest | null;
	}

	let {
		getNodeAt,
		initialScale = 1,
		initialPanX = 0,
		initialPanY = 0,
		dragThreshold = DRAG_THRESHOLD,
		onNodeMoved,
		onNodeDragStart,
		onNodeDragEnd,
		onNodeMakePrimary,
		onNodeDoubleClickDropOntoNode,
		onNodeDoubleClickDropOntoBackground,
		onNodeLongPress,
		onViewStateLiveChange,
		onStageRectChange,
		canOverzoomForFocus,
		focusOverzoomMaxScaleForPoint,
		focusEntryBoundaryCandidateForPoint,
		onBlockedZoom,
		onViewStateChange,
		fitViewRequest,
		entryGestureGateRequest,
		children
	}: Props & { children?: Snippet } = $props();

	let stageRef = $state<HTMLElement | null>(null);
	let lastFitViewRequestId = $state<number | null>(null);
	let lastEntryGestureGateRequestId = $state<number | null>(null);
	let entryGestureGate = $state<EntryGestureGateState>(EMPTY_ENTRY_GESTURE_GATE);
	let focusEntryBoundaryProgress = $state<{ nodeId: string; progress: number } | null>(null);
	/**
	 * Node the entry boundary is currently steering toward. Steering translates
	 * the view to center/fit the subject, which can move it out from under the
	 * cursor; without this stickiness the next wheel's focal hit-test misses,
	 * the boundary is abandoned, and zoom-in jams at max scale.
	 */
	let focusEntrySteeringNodeId = $state<string | null>(null);

	// Pan
	// svelte-ignore state_referenced_locally
	let panX = $state(initialPanX);
	// svelte-ignore state_referenced_locally
	let panY = $state(initialPanY);
	let panStart = $state<{
		clientX: number;
		clientY: number;
		panX: number;
		panY: number;
	} | null>(null);

	// Zoom: mount-only seed from initialScale; user gestures own scale afterward.
	// svelte-ignore state_referenced_locally
	let scale = $state(clampScale(initialScale));
	let pinchStart = $state<{
		distance: number;
		scale: number;
		centroid: Point;
		panX: number;
		panY: number;
	} | null>(null);

	function reportStageRect() {
		if (!stageRef) return;
		const rect = stageRef.getBoundingClientRect();
		onStageRectChange?.({
			left: rect.left,
			top: rect.top,
			width: rect.width,
			height: rect.height
		});
	}

	$effect(() => {
		const state = { panX, panY, scale };
		untrack(() => {
			onViewStateLiveChange?.(state);
			reportStageRect();
		});
	});

	$effect(() => {
		if (typeof window === 'undefined') return;
		reportStageRect();
		const onResize = () => reportStageRect();
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	});

	$effect(() => {
		const request = fitViewRequest;
		if (!request || request.id === lastFitViewRequestId || !stageRef) return;
		lastFitViewRequestId = request.id;
		const next = fitGraphBoundsInView(
			request.bounds,
			{ width: stageRef.clientWidth, height: stageRef.clientHeight },
			{
				paddingPx: request.paddingPx,
				minScale: DEFAULT_MIN_SCALE,
				maxScale: DEFAULT_MAX_SCALE
			}
		);
		panX = next.panX;
		panY = next.panY;
		scale = next.scale;
		onViewStateChange?.({ panX, panY, scale });
	});

	$effect(() => {
		const request = entryGestureGateRequest;
		if (!request || request.id === lastEntryGestureGateRequestId) return;
		lastEntryGestureGateRequestId = request.id;
		entryGestureGate = beginEntryGestureGate(
			request.direction,
			Date.now(),
			request.idleMs,
			request.maxMs
		);
	});

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

		return clientPointToGraphPoint(
			{ x: e.clientX, y: e.clientY },
			stage.getBoundingClientRect(),
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
			onViewStateChange?.({ panX, panY, scale });
		}
	}

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		if (shouldSwallowEntryGesture(e.deltaY < 0 ? 'in' : 'out')) return;
		const stage = e.currentTarget as HTMLElement;
		const rect = stage.getBoundingClientRect();
		const focalPoint = { x: e.clientX, y: e.clientY };
		if (releaseFocusEntryBoundaryProgress(e.deltaY, focalPoint)) return;
		const requestedScale = scaleFromWheelDelta(
			scale,
			e.deltaY,
			undefined,
			Number.NEGATIVE_INFINITY,
			Number.POSITIVE_INFINITY
		);
		const clampedScale = clampScale(requestedScale, DEFAULT_MIN_SCALE, DEFAULT_MAX_SCALE);
		if (
			applyFocusEntryBoundary({
				focalPoint,
				requestedScale,
				clampedScale,
				rect,
				startView: { panX, panY, scale }
			})
		) {
			onViewStateChange?.({
				panX,
				panY,
				scale: persistedScaleForFocusOverzoom(scale, DEFAULT_MAX_SCALE)
			});
			return;
		}
		const dynamicMaxScale = overzoomMaxScaleForPoint(
			{
				focalPoint,
				requestedScale,
				clampedScale
			},
			rect
		);
		const focusBoundaryScale =
			requestedScale > scale && dynamicMaxScale !== null ? dynamicMaxScale : null;
		const nextScale =
			focusBoundaryScale !== null
				? focusBoundaryScale <= scale
					? scale
					: clampScale(requestedScale, DEFAULT_MIN_SCALE, focusBoundaryScale)
				: clampedScale;
		const nextView = zoomViewTransformAtPoint({ panX, panY, scale }, nextScale, focalPoint, {
			x: rect.left + rect.width / 2,
			y: rect.top + rect.height / 2
		});

		panX = nextView.panX;
		panY = nextView.panY;
		scale = nextView.scale;
		focusEntryBoundaryProgress = null;
		focusEntrySteeringNodeId = null;
		if (focusBoundaryScale !== null) {
			onBlockedZoom?.({
				direction: 'in',
				focalPoint,
				blockedFactor: Math.abs(requestedScale - nextScale) / Math.max(nextScale, 0.001),
				boundaryProgress: focusBoundaryScale <= 0 ? 0 : Math.min(1, nextScale / focusBoundaryScale),
				committed: nextScale >= focusBoundaryScale,
				viewState: { panX, panY, scale }
			});
		} else if (requestedScale > nextScale) {
			onBlockedZoom?.({
				direction: 'in',
				focalPoint,
				blockedFactor: Math.abs(requestedScale - nextScale) / Math.max(nextScale, 0.001),
				viewState: { panX, panY, scale }
			});
		}
		onViewStateChange?.({
			panX,
			panY,
			scale: persistedScaleForFocusOverzoom(scale, DEFAULT_MAX_SCALE)
		});
	}

	function shouldSwallowEntryGesture(direction: EntryGestureDirection): boolean {
		const step = stepEntryGestureGate(
			entryGestureGate,
			{ direction },
			Date.now(),
			entryGestureGateRequest?.idleMs ?? 0,
			entryGestureGateRequest?.maxMs ?? 0
		);
		entryGestureGate = step.state;
		return step.swallow;
	}

	// Pinch: track two active pointers and update scale from distance ratio
	const activePointers = new SvelteMap<number, { clientX: number; clientY: number }>();

	function getTwoPointerDistance(): number | null {
		const pts = [...activePointers.values()];
		if (pts.length !== 2) return null;
		return pointerDistance(pts[0].clientX, pts[0].clientY, pts[1].clientX, pts[1].clientY);
	}

	function getTwoPointerCentroid(): Point | null {
		const pts = [...activePointers.values()];
		if (pts.length !== 2) return null;
		return {
			x: (pts[0].clientX + pts[1].clientX) / 2,
			y: (pts[0].clientY + pts[1].clientY) / 2
		};
	}

	function onPointerDownStage(e: PointerEvent) {
		activePointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
		if (activePointers.size === 1) {
			onPointerDown(e);
		} else if (activePointers.size === 2) {
			panStart = null;
			cancelActiveNodeGesture();
			const dist = getTwoPointerDistance();
			const centroid = getTwoPointerCentroid();
			if (dist !== null && centroid !== null) {
				pinchStart = { distance: dist, scale, centroid, panX, panY };
			}
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
					const centroid = getTwoPointerCentroid();
					if (centroid !== null) pinchStart = { distance: dist, scale, centroid, panX, panY };
				} else {
					const factor = dist / pinchStart.distance;
					const requestedScale = pinchStart.scale * factor;
					const clampedScale = clampScale(requestedScale, DEFAULT_MIN_SCALE, DEFAULT_MAX_SCALE);
					const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
					if (
						releaseFocusEntryBoundaryProgress(requestedScale < scale ? 1 : -1, pinchStart.centroid)
					) {
						pinchStart = { distance: dist, scale, centroid: pinchStart.centroid, panX, panY };
						return;
					}
					if (
						applyFocusEntryBoundary({
							focalPoint: pinchStart.centroid,
							requestedScale,
							clampedScale,
							rect,
							startView: {
								panX: pinchStart.panX,
								panY: pinchStart.panY,
								scale: pinchStart.scale
							}
						})
					) {
						return;
					}
					const dynamicMaxScale = overzoomMaxScaleForPoint(
						{
							focalPoint: pinchStart.centroid,
							requestedScale,
							clampedScale
						},
						rect
					);
					const focusBoundaryScale =
						requestedScale > pinchStart.scale && dynamicMaxScale !== null ? dynamicMaxScale : null;
					const nextScale =
						focusBoundaryScale !== null
							? focusBoundaryScale <= pinchStart.scale
								? pinchStart.scale
								: clampScale(requestedScale, DEFAULT_MIN_SCALE, focusBoundaryScale)
							: clampedScale;
					const nextView = zoomViewTransformAtPoint(
						{ panX: pinchStart.panX, panY: pinchStart.panY, scale: pinchStart.scale },
						nextScale,
						pinchStart.centroid,
						{ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
					);
					panX = nextView.panX;
					panY = nextView.panY;
					scale = nextView.scale;
					focusEntryBoundaryProgress = null;
					focusEntrySteeringNodeId = null;
					if (focusBoundaryScale !== null) {
						onBlockedZoom?.({
							direction: 'in',
							focalPoint: pinchStart.centroid,
							blockedFactor: Math.abs(requestedScale - nextScale) / Math.max(nextScale, 0.001),
							boundaryProgress:
								focusBoundaryScale <= 0 ? 0 : Math.min(1, nextScale / focusBoundaryScale),
							committed: nextScale >= focusBoundaryScale,
							viewState: { panX, panY, scale }
						});
					} else if (requestedScale > nextScale) {
						onBlockedZoom?.({
							direction: 'in',
							focalPoint: pinchStart.centroid,
							blockedFactor: Math.abs(requestedScale - nextScale) / Math.max(nextScale, 0.001),
							viewState: { panX, panY, scale }
						});
					}
				}
			}
		} else {
			onPointerMove(e);
		}
	}

	function onPointerUpStage(e: PointerEvent) {
		activePointers.delete(e.pointerId);
		const pinchWasActive = pinchStart !== null;
		if (activePointers.size < 2) pinchStart = null;
		onPointerUp(e);
		if (pinchWasActive && activePointers.size < 2) {
			onViewStateChange?.({
				panX,
				panY,
				scale: persistedScaleForFocusOverzoom(scale, DEFAULT_MAX_SCALE)
			});
		}
	}

	const transformStyle = $derived(`translate(${panX}px, ${panY}px) scale(${scale})`);

	function applyFocusEntryBoundary({
		focalPoint,
		requestedScale,
		clampedScale,
		rect,
		startView
	}: {
		focalPoint: Point;
		requestedScale: number;
		clampedScale: number;
		rect: DOMRect;
		startView: ViewStateSnapshot;
	}): boolean {
		const resolveCandidate = focusEntryBoundaryCandidateForPoint;
		if (requestedScale <= startView.scale || !resolveCandidate) return false;
		const candidate = resolveCandidate({
			focalPoint,
			requestedScale,
			clampedScale,
			viewState: startView,
			stickyNodeId: focusEntrySteeringNodeId ?? undefined
		});
		if (!candidate) {
			focusEntryBoundaryProgress = null;
			focusEntrySteeringNodeId = null;
			return false;
		}
		const step = solveFocusEntryBoundary({
			currentView: startView,
			requestedScale,
			focalPoint: { x: focalPoint.x - rect.left, y: focalPoint.y - rect.top },
			viewport: { width: rect.width, height: rect.height },
			candidate
		});

		panX = step.view.panX;
		panY = step.view.panY;
		scale = step.view.scale;
		focusEntrySteeringNodeId = step.phase === 'free' ? null : candidate.nodeId;

		if (step.phase === 'free') {
			focusEntryBoundaryProgress = null;
			return true;
		}

		const previousProgress =
			focusEntryBoundaryProgress?.nodeId === candidate.nodeId
				? focusEntryBoundaryProgress.progress
				: 0;
		const boundaryProgress =
			step.phase === 'boundary' ? Math.min(1, previousProgress + step.progressDelta) : 0;
		focusEntryBoundaryProgress =
			boundaryProgress > 0 && boundaryProgress < 1
				? { nodeId: candidate.nodeId, progress: boundaryProgress }
				: null;

		onBlockedZoom?.({
			direction: 'in',
			focalPoint,
			blockedFactor: step.progressDelta,
			boundaryProgress,
			committed: boundaryProgress >= 1,
			nodeId: candidate.nodeId,
			viewState: { panX, panY, scale }
		});
		return true;
	}

	function releaseFocusEntryBoundaryProgress(deltaY: number, focalPoint: Point): boolean {
		if (!focusEntryBoundaryProgress || deltaY <= 0) return false;
		const requestedScale = scaleFromWheelDelta(
			scale,
			deltaY,
			undefined,
			Number.NEGATIVE_INFINITY,
			Number.POSITIVE_INFINITY
		);
		const releaseDelta = boundaryReleaseDelta(requestedScale, scale);
		const nextProgress = Math.max(0, focusEntryBoundaryProgress.progress - releaseDelta);
		const nodeId = focusEntryBoundaryProgress.nodeId;
		focusEntryBoundaryProgress = nextProgress > 0 ? { nodeId, progress: nextProgress } : null;
		onBlockedZoom?.({
			direction: 'out',
			focalPoint,
			blockedFactor: releaseDelta,
			boundaryProgress: nextProgress,
			committed: false,
			nodeId,
			viewState: { panX, panY, scale }
		});
		return true;
	}

	function overzoomMaxScaleForPoint(
		input: {
			focalPoint: Point;
			requestedScale: number;
			clampedScale: number;
		},
		rect: DOMRect
	): number | null {
		if (input.requestedScale <= scale) return null;
		const fromParent = focusOverzoomMaxScaleForPoint?.(input);
		if (fromParent !== undefined && fromParent !== null) {
			return Math.max(DEFAULT_MIN_SCALE, fromParent);
		}
		const canOverzoom =
			canOverzoomForFocus?.(input) ?? getNodeAt(input.focalPoint.x, input.focalPoint.y) !== null;
		if (!canOverzoom) return null;
		return focusOverzoomMaxScaleForNode(
			NODE_RADIUS,
			{ width: rect.width, height: rect.height },
			DEFAULT_MAX_SCALE
		);
	}
</script>

<div
	bind:this={stageRef}
	class="stage"
	class:panning={panStart !== null}
	onpointerdown={onPointerDownStage}
	onpointermove={onPointerMoveStage}
	onpointerup={onPointerUpStage}
	onpointercancel={onPointerUpStage}
	onwheel={onWheel}
	role="presentation"
>
	<div
		class="stage-content"
		style="transform: {transformStyle}; transform-origin: 50% 50%;"
		aria-hidden="true"
	>
		{#if children}
			{@render children()}
		{/if}
	</div>
</div>

<style>
	.stage {
		position: absolute;
		inset: 0;
		cursor: grab;
		touch-action: none;
		-webkit-user-select: none;
		user-select: none;
	}
	.stage.panning {
		cursor: grabbing;
	}
	.stage-content {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
</style>
