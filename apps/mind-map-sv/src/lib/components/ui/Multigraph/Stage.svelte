<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import type { NodeData } from '../types/node';
	import type { Point } from '../types/multigraph';
	import {
		scaleFromWheelDelta,
		wheelDeltaPixels,
		clampScale,
		DEFAULT_MIN_SCALE,
		DEFAULT_MAX_SCALE,
		fitGraphBoundsInView,
		type GraphBounds,
		zoomViewTransformAtPoint
	} from './lib/graphMath.js';
	import { pointerDistance } from './lib/hitTest.js';
	import { resolveCreationDrop, type NodeGestureMode } from './lib/creationGesture.js';
	import { recognizeLongPress } from './lib/longPress.js';
	import { persistedScaleForFocusOverzoom } from './lib/nodeFocus.js';
	import {
		boundaryReleaseDelta,
		solveFocusEntryBoundary,
		type FocusEntryBoundaryCandidate,
		type FocusEntrySteeringState
	} from './lib/focusEntryBoundary.js';
	import {
		beginEntryGestureGate,
		EMPTY_ENTRY_GESTURE_GATE,
		stepEntryGestureGate,
		type EntryGestureDirection,
		type EntryGestureGateState
	} from './lib/entryGestureGate.js';
	import {
		clientPointToGraphPoint,
		rectFromCorners,
		type StageRect
	} from './lib/stageCoordinates.js';
	import { EDGE_CUT_COLOR } from './lib/edgeCut.js';
	import { DRAG_THRESHOLD, DBL_CLICK_MS, LONG_PRESS_DIST, LONG_PRESS_MS } from '$lib/constants.js';

	interface ViewStateSnapshot {
		panX: number;
		panY: number;
		scale: number;
	}

	interface BlockedZoomInput {
		direction: 'in' | 'out';
		focalPoint: Point;
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

	/**
	 * An exact camera, not a fit: `fitViewRequest` derives pan/scale from bounds
	 * and clamps them to what fits, which cannot reproduce a view the reader was
	 * already looking at. Restoring a remembered view needs the numbers back
	 * verbatim.
	 */
	interface ViewStateRequest {
		id: number;
		panX: number;
		panY: number;
		scale: number;
	}

	interface EntryGestureGateRequest {
		id: number;
		direction: EntryGestureDirection;
		idleMs: number;
		maxMs: number;
	}

	interface CreationArmRequest {
		id: number;
		sourceNode: NodeData;
		/** What the release commits. Omitted means the original create gesture. */
		mode?: NodeGestureMode;
	}

	interface EdgeCutArmRequest {
		id: number;
		/** Client coordinates of the line's fixed end: where the background menu was opened. */
		anchor: Point;
	}

	interface EdgeCutCancelRequest {
		id: number;
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
		/**
		 * Gap within which a second press on the same node, or on the same spot of
		 * empty canvas, counts as a double-click.
		 */
		doubleClickMs?: number;
		/** How long a touch must rest on a node or on empty canvas before it counts as a hold. */
		longPressMs?: number;
		/**
		 * How far the pointer may wander during a hold before it stops being one,
		 * and how close two presses on empty canvas must land to make a double.
		 */
		longPressDistancePx?: number;
		/** Lower zoom clamp for every gesture, the mount seed, and fit. */
		minScale?: number;
		/** Upper zoom clamp for every gesture, the mount seed, and fit. */
		maxScale?: number;
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
		/** Callback when user holds a node without dragging (touch pointers only). */
		onNodeLongPress?: (node: NodeData, point: Point) => void;
		/** Callback when user right-clicks (or pen-barrel-clicks) a node; client coords like onNodeLongPress. */
		onNodeContextMenu?: (node: NodeData, point: Point) => void;
		/** Fired on every pointer move during an active creation gesture (double-click drag or menu-armed). */
		onCreationDragUpdate?: (sourceNode: NodeData, point: Point, hoverNode: NodeData | null) => void;
		/** Fired when a creation gesture is cancelled (Escape, release on source, pinch, pointercancel). */
		onCreationCancel?: (sourceNode: NodeData) => void;
		/** Callback when a merge-mode gesture is dropped onto another node: fold `sourceNode` into `targetNode`. */
		onNodeMergeDropOntoNode?: (sourceNode: NodeData, targetNode: NodeData) => void;
		/**
		 * Fired on every pointer move while a selection box is open: a
		 * double-click-drag (double-tap-drag) that started on empty canvas. The
		 * rect is in client coordinates, like `onStageRectChange`'s, so a consumer
		 * can test it against on-screen node geometry without the view transform.
		 * `additive` is Shift as held right now — read from each move, and
		 * reported again when Shift alone goes down or up — so a consumer that
		 * previews the box's result can follow it mid-drag. Release still decides
		 * with its own Shift (`onSelectionBoxEnd`).
		 */
		onSelectionBoxUpdate?: (rect: StageRect, options: { additive: boolean }) => void;
		/** Fired when an open box is released; `additive` is Shift held at release. */
		onSelectionBoxEnd?: (rect: StageRect, options: { additive: boolean }) => void;
		/** Fired when an open box is abandoned: a second pointer, pointercancel, Escape or a right-click. */
		onSelectionBoxCancel?: () => void;
		/**
		 * Fired when a press on empty canvas is released without crossing
		 * `dragThreshold`, was not the second press of a double and was not a
		 * hold. Client coords like onNodeLongPress.
		 */
		onBackgroundClick?: (point: Point, options: { shiftKey: boolean }) => void;
		/** Callback when user holds empty canvas without moving (touch pointers only); client coords. */
		onBackgroundLongPress?: (point: Point) => void;
		/** Callback when user right-clicks (or pen-barrel-clicks) empty canvas; client coords. */
		onBackgroundContextMenu?: (point: Point) => void;
		/** One-shot request to arm a drag-from-node gesture (menu-initiated, no button pressed). */
		creationArmRequest?: CreationArmRequest | null;
		/**
		 * One-shot request to arm an edge cut (menu-initiated, no button pressed):
		 * a dashed line from `anchor` to the pointer, ended by the next click or
		 * touch release. Arming cancels an armed creation session or an earlier
		 * cut, as arming a creation session cancels a cut.
		 */
		edgeCutArmRequest?: EdgeCutArmRequest | null;
		/** One-shot request to abandon an armed edge cut, as Escape would; nothing when none is armed. */
		edgeCutCancelRequest?: EdgeCutCancelRequest | null;
		/**
		 * Fired as an edge cut is armed, with the line still a point at the anchor,
		 * then on every pointer move and press while it is: `a` is the anchor and
		 * `b` the pointer, both in client coordinates like `onNodeLongPress`. A
		 * mouse drives it by hovering, a touch by dragging, as with the menu-armed
		 * creation drag.
		 */
		onEdgeCutUpdate?: (a: Point, b: Point) => void;
		/** Fired by the click or touch release that ends an armed cut: the anchor and where it ended. */
		onEdgeCutEnd?: (a: Point, b: Point) => void;
		/**
		 * Fired when an armed cut is abandoned: Escape, a second pointer,
		 * pointercancel, a right-click, a press outside the stage, a new arm
		 * request of either kind, or `edgeCutCancelRequest`.
		 */
		onEdgeCutCancel?: () => void;
		/** Fired whenever the internal pan/zoom state changes, including initial mount. */
		onViewStateLiveChange?: (state: ViewStateSnapshot) => void;
		/**
		 * Fired with the stage element's on-screen rect (origin + size) on mount,
		 * on every view change, and on resize. Consumers derive on-screen node
		 * geometry from this rect + the live view state, avoiding any DOM
		 * measurement of the nodes themselves (see the focus morph surface).
		 */
		onStageRectChange?: (rect: StageRect) => void;
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
		/** One-shot request to restore an exact pan/scale (scale still clamped). */
		viewStateRequest?: ViewStateRequest | null;
		/** One-shot request to swallow residual entry/exit zoom input at the stage boundary. */
		entryGestureGateRequest?: EntryGestureGateRequest | null;
	}

	let {
		getNodeAt,
		initialScale = 1,
		initialPanX = 0,
		initialPanY = 0,
		// Every tunable below defaults to the shipped constant so a story or spec
		// can mount Stage with none of them. A parent that owns a live config
		// (Multigraph) passes all of them explicitly instead — a prop default is
		// evaluated once, so it must never be the path a changing value takes.
		dragThreshold = DRAG_THRESHOLD,
		doubleClickMs = DBL_CLICK_MS,
		longPressMs = LONG_PRESS_MS,
		longPressDistancePx = LONG_PRESS_DIST,
		minScale = DEFAULT_MIN_SCALE,
		maxScale = DEFAULT_MAX_SCALE,
		onNodeMoved,
		onNodeDragStart,
		onNodeDragEnd,
		onNodeMakePrimary,
		onNodeDoubleClickDropOntoNode,
		onNodeDoubleClickDropOntoBackground,
		onNodeLongPress,
		onNodeContextMenu,
		onCreationDragUpdate,
		onCreationCancel,
		onNodeMergeDropOntoNode,
		onSelectionBoxUpdate,
		onSelectionBoxEnd,
		onSelectionBoxCancel,
		onBackgroundClick,
		onBackgroundLongPress,
		onBackgroundContextMenu,
		creationArmRequest,
		edgeCutArmRequest,
		edgeCutCancelRequest,
		onEdgeCutUpdate,
		onEdgeCutEnd,
		onEdgeCutCancel,
		onViewStateLiveChange,
		onStageRectChange,
		focusEntryBoundaryCandidateForPoint,
		onBlockedZoom,
		onViewStateChange,
		fitViewRequest,
		viewStateRequest,
		entryGestureGateRequest,
		children
	}: Props & { children?: Snippet } = $props();

	let stageRef = $state<HTMLElement | null>(null);
	let lastFitViewRequestId = $state<number | null>(null);
	let lastViewStateRequestId = $state<number | null>(null);
	let lastEntryGestureGateRequestId = $state<number | null>(null);
	let entryGestureGate = $state<EntryGestureGateState>(EMPTY_ENTRY_GESTURE_GATE);
	let focusEntryBoundaryProgress = $state<{ nodeId: string; progress: number } | null>(null);
	let focusEntrySteeringState = $state<FocusEntrySteeringState | null>(null);
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
	let scale = $state(clampScale(initialScale, minScale, maxScale));
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
				minScale,
				maxScale
			}
		);
		panX = next.panX;
		panY = next.panY;
		scale = next.scale;
		onViewStateChange?.({ panX, panY, scale });
	});

	$effect(() => {
		const request = viewStateRequest;
		if (!request || request.id === lastViewStateRequestId) return;
		lastViewStateRequestId = request.id;
		panX = request.panX;
		panY = request.panY;
		// The only adjustment: the same clamp the mount seed and every gesture go
		// through, so a restore cannot leave the stage at a scale no gesture could
		// have produced. Pan is reproduced verbatim — that is the whole point.
		scale = clampScale(request.scale, minScale, maxScale);
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

	// Double-click: same node clicked twice within doubleClickMs
	let lastClickNodeId = $state<string | null>(null);
	let lastClickTime = $state(0);
	let isDoubleClickSession = $state(false);

	let longPressTimeoutId: ReturnType<typeof setTimeout> | null = null;
	let longPressStartTime = 0;
	let longPressFired = false;

	// Background press: the gestures that start on empty canvas. Precedence, in
	// the order the code below decides it:
	//
	// 1. A background press is a double when the previous background click was
	//    released within `doubleClickMs` (the gap the node's double measures
	//    too) and landed within `longPressDistancePx` of this press. The
	//    bookkeeping is the background's own — `lastBackgroundClick`, never
	//    `lastClickNodeId` — and a node press clears it, so a node click cannot
	//    complete a background double nor a background click a node one. Any
	//    background press consumes it, so a third click starts fresh.
	// 2. Outside a double the press pans from its first pixel, as it always has.
	//    Inside one it never pans: `panStart` is not set at all (setting it and
	//    clearing it at the threshold would leave the view nudged by however far
	//    the pointer crept first), and movement past `dragThreshold` opens the
	//    selection box instead.
	// 3. The box is drawn here, in stage space beside `.stage-content` and not
	//    inside it, because the content layer carries the pan/zoom transform.
	//    `onSelectionBoxUpdate` fires on every move while it is open, with
	//    `additive: e.shiftKey` from that move, and again when Shift alone is
	//    pressed or let go, so a preview of the box's result follows Shift
	//    without waiting for the pointer to move.
	// 4. Release closes an open box with `additive: e.shiftKey`. With no box, a
	//    press that never crossed `dragThreshold`, was not a double and was not
	//    held is a click (`onBackgroundClick`). A double that never moved is
	//    nothing: on a node it toggles the pin, on empty canvas it only arms the
	//    box. A pan release persists the view exactly as before.
	// 5. A second pointer, pointercancel and Escape abandon the box
	//    (`onSelectionBoxCancel`) and with it the press, so nothing that follows
	//    lands as a click; the second pointer then pinches, as over a node.
	// 6. A touch hold fires `onBackgroundLongPress` through the node hold's
	//    timer slot and guards (one pointer, no drag, no double, within the
	//    slop), and its release is not a click. A right-click fires
	//    `onBackgroundContextMenu` and abandons whatever the press began, since
	//    macOS ctrl+click delivers a button-0 press before the contextmenu.
	// 7. The two menu-armed sessions — a creation drag (`creationSession.via ===
	//    'menu'`) and an edge cut (`edgeCutSession`) — swallow background
	//    presses before any of this runs (`onPointerDownStage`). They never
	//    coexist: arming either cancels the other, and arming a cut cancels a
	//    cut already armed. A cut also gives way to a right-click, which a
	//    creation session does not: macOS ctrl+click delivers a button-0 press
	//    before the contextmenu, and that press's release must not land as the
	//    cut.
	//
	// Plain variables rather than `$state`: nothing renders from the press, and
	// the hold timer checks it is still the same press by identity.
	interface BackgroundPress {
		clientX: number;
		clientY: number;
		/** Latest pointer position, for the hold's slop and the box's far corner. */
		current: Point;
		isDouble: boolean;
		/** Crossed `dragThreshold` at some point — a pan that came back is still not a click. */
		dragged: boolean;
	}
	let backgroundPress: BackgroundPress | null = null;
	let lastBackgroundClick: { clientX: number; clientY: number; time: number } | null = null;
	/**
	 * The open box where it is drawn, in stage-local pixels. The callbacks get
	 * the same rect in client space; the two differ by the stage's own offset.
	 */
	let selectionBox = $state<StageRect | null>(null);
	const selectionBoxOpen = $derived(selectionBox !== null);

	$effect(() => {
		if (typeof window === 'undefined' || !selectionBoxOpen) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				cancelBackgroundGesture();
				return;
			}
			followShift(e);
		};
		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('keyup', followShift);
		return () => {
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', followShift);
		};
	});

	/**
	 * Shift pressed or let go while the pointer holds still. Moves alone would
	 * leave the last update's `additive` stale until the next one, and a
	 * preview built from it would show one result while release committed the
	 * other. Key repeat changes nothing, so it reports nothing.
	 */
	function followShift(e: KeyboardEvent) {
		if (e.key !== 'Shift' || e.repeat || !backgroundPress || !selectionBox) return;
		updateSelectionBox(backgroundPress, e.shiftKey);
	}

	function beginBackgroundPress(e: PointerEvent) {
		const previous = lastBackgroundClick;
		lastBackgroundClick = null;
		const isDouble =
			previous !== null &&
			Date.now() - previous.time < doubleClickMs &&
			pointerDistance(previous.clientX, previous.clientY, e.clientX, e.clientY) <=
				longPressDistancePx;
		const press: BackgroundPress = {
			clientX: e.clientX,
			clientY: e.clientY,
			current: { x: e.clientX, y: e.clientY },
			isDouble,
			dragged: false
		};
		backgroundPress = press;
		longPressFired = false;
		if (!isDouble) panStart = { clientX: e.clientX, clientY: e.clientY, panX, panY };
		if (e.pointerType === 'touch') startBackgroundLongPressTimer(press);
	}

	function startBackgroundLongPressTimer(press: BackgroundPress) {
		cancelLongPressTimer();
		longPressStartTime = Date.now();
		longPressTimeoutId = setTimeout(() => {
			longPressTimeoutId = null;
			if (backgroundPress !== press) return;
			if (activePointers.size !== 1 || press.dragged || press.isDouble) return;
			const distance = pointerDistance(
				press.clientX,
				press.clientY,
				press.current.x,
				press.current.y
			);
			if (
				recognizeLongPress({
					duration: Date.now() - longPressStartTime,
					distance,
					minDuration: longPressMs,
					maxDistance: longPressDistancePx
				})
			) {
				longPressFired = true;
				onBackgroundLongPress?.({ x: press.current.x, y: press.current.y });
			}
		}, longPressMs);
	}

	/** Follow the pointer for the hold's slop and the click/drag decision. */
	function trackBackgroundPress(press: BackgroundPress, e: PointerEvent) {
		press.current = { x: e.clientX, y: e.clientY };
		const dist = pointerDistance(press.clientX, press.clientY, e.clientX, e.clientY);
		if (dist > longPressDistancePx) cancelLongPressTimer();
		if (dist >= dragThreshold) {
			cancelLongPressTimer();
			press.dragged = true;
		}
	}

	function updateSelectionBox(press: BackgroundPress, additive: boolean) {
		const rect = rectFromCorners({ x: press.clientX, y: press.clientY }, press.current);
		const stageBounds = stageRef?.getBoundingClientRect();
		selectionBox = {
			left: rect.left - (stageBounds?.left ?? 0),
			top: rect.top - (stageBounds?.top ?? 0),
			width: rect.width,
			height: rect.height
		};
		onSelectionBoxUpdate?.(rect, { additive });
	}

	function cancelSelectionBox() {
		if (!selectionBox) return;
		selectionBox = null;
		onSelectionBoxCancel?.();
	}

	/**
	 * Abandon whatever a background press began: its release then counts as
	 * nothing — no click, no box, no half of a double. The pan is left alone:
	 * the second pointer clears `panStart` itself, and a right-click mid-pan
	 * lets the pan finish and persist as it always has.
	 */
	function cancelBackgroundGesture() {
		if (backgroundPress) {
			backgroundPress = null;
			cancelLongPressTimer();
			longPressFired = false;
		}
		lastBackgroundClick = null;
		cancelSelectionBox();
	}

	function endBackgroundPress(press: BackgroundPress, e: PointerEvent) {
		backgroundPress = null;
		cancelLongPressTimer();
		const held = longPressFired;
		longPressFired = false;
		if (e.type === 'pointercancel') {
			cancelSelectionBox();
			return;
		}
		if (selectionBox) {
			const rect = rectFromCorners(
				{ x: press.clientX, y: press.clientY },
				{ x: e.clientX, y: e.clientY }
			);
			selectionBox = null;
			onSelectionBoxEnd?.(rect, { additive: e.shiftKey });
			return;
		}
		const dragged =
			press.dragged ||
			pointerDistance(press.clientX, press.clientY, e.clientX, e.clientY) >= dragThreshold;
		if (held || dragged || press.isDouble) return;
		lastBackgroundClick = { clientX: press.clientX, clientY: press.clientY, time: Date.now() };
		onBackgroundClick?.({ x: e.clientX, y: e.clientY }, { shiftKey: e.shiftKey });
	}

	// Drag-from-node gesture (new node/edge, or a merge): either a double-click
	// drag or a menu-armed hover session where no button is pressed until the
	// final click. Only `mode` differs between the two aims; the tracking,
	// cancelling and hit testing below are shared verbatim.
	let creationSession = $state<{
		sourceNode: NodeData;
		via: 'menu' | 'doubleclick';
		mode: NodeGestureMode;
	} | null>(null);
	let lastCreationArmRequestId = $state<number | null>(null);

	$effect(() => {
		const request = creationArmRequest;
		if (!request || request.id === lastCreationArmRequestId) return;
		lastCreationArmRequestId = request.id;
		cancelActiveNodeGesture();
		cancelBackgroundGesture();
		// Untracked, so this effect does not re-run on every move of a cut.
		untrack(() => cancelEdgeCut());
		panStart = null;
		creationSession = {
			sourceNode: request.sourceNode,
			via: 'menu',
			mode: request.mode ?? 'create'
		};
	});

	$effect(() => {
		if (typeof window === 'undefined' || creationSession === null) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') cancelCreationSession();
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	});

	/**
	 * A menu-armed session holds no button, so a press on app chrome (toolbar,
	 * panels, dialogs) never reaches the stage. Without this the session would
	 * stay armed: the preview stays painted, panning is dead, and the next
	 * canvas click silently creates a node.
	 */
	$effect(() => {
		if (typeof window === 'undefined' || creationSession?.via !== 'menu') return;
		const onWindowPointerDown = (e: PointerEvent) => {
			const target = e.target;
			if (stageRef && target instanceof Node && stageRef.contains(target)) return;
			cancelCreationSession();
		};
		window.addEventListener('pointerdown', onWindowPointerDown, true);
		return () => window.removeEventListener('pointerdown', onWindowPointerDown, true);
	});

	function cancelCreationSession() {
		const session = creationSession;
		if (!session) return;
		creationSession = null;
		onCreationCancel?.(session.sourceNode);
		// Neutralize any in-flight double-click drag so the upcoming pointerup no-ops.
		cancelLongPressTimer();
		dragNode = null;
		dragStartPos = null;
		dragCurrentPos = null;
		isNodeDragActive = false;
		isDoubleClickSession = false;
		longPressFired = false;
	}

	function completeCreationSession(sourceNode: NodeData, e: PointerEvent) {
		const mode = creationSession?.mode ?? 'create';
		creationSession = null;
		const dropTarget = getNodeAt(e.clientX, e.clientY);
		const action = resolveCreationDrop(sourceNode.id, dropTarget?.id ?? null, mode);
		if (action.kind === 'connect-to-node') {
			onNodeDoubleClickDropOntoNode?.(sourceNode, dropTarget!);
		} else if (action.kind === 'merge-into-node') {
			onNodeMergeDropOntoNode?.(sourceNode, dropTarget!);
		} else if (action.kind === 'create-node-and-edge') {
			onNodeDoubleClickDropOntoBackground?.(sourceNode, graphPointForEvent(e));
		} else {
			onCreationCancel?.(sourceNode);
		}
	}

	// Edge cut ("Cut edges" in the background menu): a dashed line from where
	// the menu was opened to the pointer, which the click or touch release that
	// ends it hands back for the consumer to cut along. Shaped like the
	// menu-armed creation session: no button is held while it is armed, the
	// pointer is tracked with or without one, the press that ends it is
	// swallowed, and Escape, a second pointer, pointercancel and a press outside
	// the stage abandon it (precedence 7 above).
	interface EdgeCutSession {
		/** Client point the line is anchored at, fixed for the session. */
		anchor: Point;
		/**
		 * Both ends where they are drawn, in stage-local pixels. The callbacks
		 * get client points; the two differ by the stage's own offset, as the
		 * selection box's rects do.
		 */
		drawn: { from: Point; to: Point };
	}
	let edgeCutSession = $state<EdgeCutSession | null>(null);
	/** Its own signal, so the listeners below follow arming and not every move. */
	const edgeCutArmed = $derived(edgeCutSession !== null);
	let lastEdgeCutArmRequestId = $state<number | null>(null);
	let lastEdgeCutCancelRequestId = $state<number | null>(null);

	// Declared before the arm effect, so a cancel and a fresh arm landing in the
	// same flush run in that order and the fresh cut survives.
	$effect(() => {
		const request = edgeCutCancelRequest;
		if (!request || request.id === lastEdgeCutCancelRequestId) return;
		lastEdgeCutCancelRequestId = request.id;
		untrack(() => cancelEdgeCut());
	});

	$effect(() => {
		const request = edgeCutArmRequest;
		if (!request || request.id === lastEdgeCutArmRequestId) return;
		lastEdgeCutArmRequestId = request.id;
		// Untracked: the session it writes changes on every move, and nothing here
		// should run again until the next request.
		untrack(() => {
			cancelActiveNodeGesture();
			cancelBackgroundGesture();
			cancelEdgeCut();
			panStart = null;
			edgeCutSession = edgeCutSessionTo(request.anchor, request.anchor);
			// Reported at once, before any move: until the pointer comes back over
			// the stage the line is a point at the anchor, and a consumer learns
			// from this that a cut is armed.
			onEdgeCutUpdate?.(request.anchor, request.anchor);
		});
	});

	$effect(() => {
		if (typeof window === 'undefined' || !edgeCutArmed) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') cancelEdgeCut();
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	});

	/** As for the menu-armed creation session: a press on app chrome never reaches the stage. */
	$effect(() => {
		if (typeof window === 'undefined' || !edgeCutArmed) return;
		const onWindowPointerDown = (e: PointerEvent) => {
			const target = e.target;
			if (stageRef && target instanceof Node && stageRef.contains(target)) return;
			cancelEdgeCut();
		};
		window.addEventListener('pointerdown', onWindowPointerDown, true);
		return () => window.removeEventListener('pointerdown', onWindowPointerDown, true);
	});

	/** A session anchored at `anchor` whose free end is at `current`, both client points. */
	function edgeCutSessionTo(anchor: Point, current: Point): EdgeCutSession {
		const stageBounds = stageRef?.getBoundingClientRect();
		const left = stageBounds?.left ?? 0;
		const top = stageBounds?.top ?? 0;
		return {
			anchor,
			drawn: {
				from: { x: anchor.x - left, y: anchor.y - top },
				to: { x: current.x - left, y: current.y - top }
			}
		};
	}

	/** Carry the line's free end to `point` and report it. */
	function updateEdgeCut(point: Point) {
		const session = edgeCutSession;
		if (!session) return;
		edgeCutSession = edgeCutSessionTo(session.anchor, point);
		onEdgeCutUpdate?.(session.anchor, point);
	}

	function endEdgeCut(point: Point) {
		const session = edgeCutSession;
		if (!session) return;
		edgeCutSession = null;
		onEdgeCutEnd?.(session.anchor, point);
	}

	function cancelEdgeCut() {
		if (!edgeCutSession) return;
		edgeCutSession = null;
		onEdgeCutCancel?.();
	}

	function onPointerDown(e: PointerEvent) {
		const node = getNodeAt(e.clientX, e.clientY);
		if (node) {
			// A node press breaks a background double in progress (precedence 1).
			lastBackgroundClick = null;
			backgroundPress = null;
			dragNode = node;
			dragStartPos = { x: e.clientX, y: e.clientY };
			dragCurrentPos = dragStartPos;
			longPressFired = false;
			isDoubleClickSession =
				lastClickNodeId === node.id && Date.now() - lastClickTime < doubleClickMs;
			if (e.pointerType === 'touch') startLongPressTimer(node);
		} else {
			beginBackgroundPress(e);
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
					minDuration: longPressMs,
					maxDistance: longPressDistancePx
				})
			) {
				longPressFired = true;
				onNodeLongPress?.(node, { x: dragCurrentPos.x, y: dragCurrentPos.y });
			}
			longPressTimeoutId = null;
		}, longPressMs);
	}

	function cancelLongPressTimer() {
		if (longPressTimeoutId === null) return;
		clearTimeout(longPressTimeoutId);
		longPressTimeoutId = null;
	}

	function cancelActiveNodeGesture() {
		cancelLongPressTimer();
		if (creationSession) {
			const session = creationSession;
			creationSession = null;
			onCreationCancel?.(session.sourceNode);
		}
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
			if (backgroundPress) trackBackgroundPress(backgroundPress, e);
		} else if (backgroundPress?.isDouble) {
			trackBackgroundPress(backgroundPress, e);
			if (backgroundPress.dragged) updateSelectionBox(backgroundPress, e.shiftKey);
		} else if (dragNode && dragStartPos && isDoubleClickSession) {
			dragCurrentPos = { x: e.clientX, y: e.clientY };
			const dist = pointerDistance(dragStartPos.x, dragStartPos.y, e.clientX, e.clientY);
			if (dist >= dragThreshold || creationSession) {
				cancelLongPressTimer();
				if (!creationSession) {
					creationSession = { sourceNode: dragNode, via: 'doubleclick', mode: 'create' };
				}
				onCreationDragUpdate?.(
					creationSession.sourceNode,
					graphPointForEvent(e),
					getNodeAt(e.clientX, e.clientY)
				);
			}
		} else if (dragNode && dragStartPos && !isDoubleClickSession) {
			const dist = pointerDistance(dragStartPos.x, dragStartPos.y, e.clientX, e.clientY);
			dragCurrentPos = { x: e.clientX, y: e.clientY };
			if (dist > longPressDistancePx || getNodeAt(e.clientX, e.clientY)?.id !== dragNode.id) {
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
			if (isCancel && creationSession) {
				const session = creationSession;
				creationSession = null;
				onCreationCancel?.(session.sourceNode);
			}
			if (!isCancel && !longPressFired) {
				const dist = pointerDistance(dragStartPos.x, dragStartPos.y, e.clientX, e.clientY);
				const didDrag = dist >= dragThreshold;

				if (isDoubleClickSession) {
					lastClickNodeId = null;
					lastClickTime = 0;
				}

				if (didDrag || creationSession?.via === 'doubleclick') {
					if (isDoubleClickSession) {
						completeCreationSession(dragNode, e);
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
		if (backgroundPress) {
			// A double session holds the capture with no pan to release it.
			if (stage.hasPointerCapture?.(e.pointerId)) stage.releasePointerCapture(e.pointerId);
			endBackgroundPress(backgroundPress, e);
		}
	}

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		// Normalized once, here at the DOM boundary: everything downstream reads a
		// pixel delta, and Firefox reports a mouse wheel in lines — which through
		// the zoom sensitivity is a 0.6% step where Chrome's notch is 18%.
		const deltaY = wheelDeltaPixels(
			e,
			typeof window === 'undefined' ? undefined : window.innerHeight
		);
		if (shouldSwallowEntryGesture(deltaY < 0 ? 'in' : 'out')) return;
		const stage = e.currentTarget as HTMLElement;
		const rect = stage.getBoundingClientRect();
		const focalPoint = { x: e.clientX, y: e.clientY };
		const requestedScale = scaleFromWheelDelta(
			scale,
			deltaY,
			undefined,
			Number.NEGATIVE_INFINITY,
			Number.POSITIVE_INFINITY
		);
		if (releaseFocusEntryBoundaryProgress(requestedScale, focalPoint)) return;
		const clampedScale = clampScale(requestedScale, minScale, maxScale);
		if (
			!applyZoomGesture({
				focalPoint,
				requestedScale,
				clampedScale,
				rect,
				startView: { panX, panY, scale }
			})
		) {
			// Plain zoom: wheel persists view state immediately on each event.
			onViewStateChange?.({
				panX,
				panY,
				scale: persistedScaleForFocusOverzoom(scale, maxScale)
			});
		}
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

	function onContextMenu(e: MouseEvent) {
		// Always suppress the native menu on the stage (also swallows the
		// contextmenu Android synthesizes from a touch long-press).
		e.preventDefault();
		if ((e as PointerEvent).pointerType === 'touch') return;
		const node = getNodeAt(e.clientX, e.clientY);
		// macOS ctrl+click fires a button-0 pointerdown before contextmenu, so
		// whatever that press began must not also land as a click or a box — nor,
		// with a cut armed, as the cut (precedence 7).
		cancelBackgroundGesture();
		cancelEdgeCut();
		if (!node) {
			onBackgroundContextMenu?.({ x: e.clientX, y: e.clientY });
			return;
		}
		cancelActiveNodeGesture();
		onNodeContextMenu?.(node, { x: e.clientX, y: e.clientY });
	}

	function onPointerDownStage(e: PointerEvent) {
		if (e.button !== 0) return;
		activePointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
		if (activePointers.size === 1) {
			// A menu-armed session swallows the press: the pointer is tracked (for
			// pinch detection and pointerup) but must not start a
			// pan/drag/long-press. A cut's free end jumps to the press, so a touch
			// that lifts without moving cuts along the line it was shown.
			if (edgeCutSession) updateEdgeCut({ x: e.clientX, y: e.clientY });
			else if (creationSession?.via !== 'menu') onPointerDown(e);
		} else if (activePointers.size === 2) {
			panStart = null;
			cancelActiveNodeGesture();
			cancelBackgroundGesture();
			cancelEdgeCut();
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
					const clampedScale = clampScale(requestedScale, minScale, maxScale);
					const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
					// The pinch's own requested scale, not a stand-in for one: how far the
					// fingers moved is exactly what should decide how much of the
					// boundary is given back.
					if (releaseFocusEntryBoundaryProgress(requestedScale, pinchStart.centroid)) {
						pinchStart = { distance: dist, scale, centroid: pinchStart.centroid, panX, panY };
						return;
					}
					applyZoomGesture({
						focalPoint: pinchStart.centroid,
						requestedScale,
						clampedScale,
						rect,
						startView: {
							panX: pinchStart.panX,
							panY: pinchStart.panY,
							scale: pinchStart.scale
						}
					});
					// Plain pinch zoom is persisted on pointer-up; boundary steering is
					// persisted inside applyZoomGesture (fixing the prior asymmetry).
				}
			}
		} else if (creationSession?.via === 'menu') {
			// Menu-armed sessions track the cursor even with no button pressed.
			onCreationDragUpdate?.(
				creationSession.sourceNode,
				graphPointForEvent(e),
				getNodeAt(e.clientX, e.clientY)
			);
		} else if (edgeCutSession) {
			// So does an armed cut.
			updateEdgeCut({ x: e.clientX, y: e.clientY });
		} else {
			onPointerMove(e);
		}
	}

	function onPointerUpStage(e: PointerEvent) {
		// A mouse reuses one pointerId for every button, so a non-primary release
		// must neither complete/cancel a creation session nor tear down the pan or
		// drag the primary button is still holding. Touch/pen report button 0, and
		// pointercancel (button -1) always has to run its teardown.
		if (e.type !== 'pointercancel' && e.button > 0) return;
		activePointers.delete(e.pointerId);
		const pinchWasActive = pinchStart !== null;
		if (activePointers.size < 2) pinchStart = null;
		if (creationSession?.via === 'menu' && !pinchWasActive) {
			if (e.type === 'pointercancel') {
				cancelCreationSession();
			} else {
				completeCreationSession(creationSession.sourceNode, e);
			}
			const stage = e.currentTarget as HTMLElement;
			if (stage.hasPointerCapture?.(e.pointerId)) stage.releasePointerCapture(e.pointerId);
			return;
		}
		if (edgeCutSession && !pinchWasActive) {
			if (e.type === 'pointercancel') {
				cancelEdgeCut();
			} else {
				endEdgeCut({ x: e.clientX, y: e.clientY });
			}
			const stage = e.currentTarget as HTMLElement;
			if (stage.hasPointerCapture?.(e.pointerId)) stage.releasePointerCapture(e.pointerId);
			return;
		}
		onPointerUp(e);
		if (pinchWasActive && activePointers.size < 2) {
			onViewStateChange?.({
				panX,
				panY,
				scale: persistedScaleForFocusOverzoom(scale, maxScale)
			});
		}
	}

	const transformStyle = $derived(`translate(${panX}px, ${panY}px) scale(${scale})`);

	/**
	 * Shared focus-entry zoom sequence for wheel and pinch.
	 *
	 * Tries boundary steering via `applyFocusEntryBoundary`. If the gesture is
	 * handled (steering or commit), persists view state via `onViewStateChange`
	 * and returns `true` — callers must not persist again.
	 *
	 * Otherwise applies the plain clamp-zoom, resets boundary progress, emits
	 * `onBlockedZoom` if the scale was clamped, and returns `false` — the caller
	 * decides when to persist (wheel: immediately; pinch: on pointer-up).
	 */
	function applyZoomGesture({
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
		if (applyFocusEntryBoundary({ focalPoint, requestedScale, clampedScale, rect, startView })) {
			// Fix wheel/pinch asymmetry: both now persist view state after steering.
			onViewStateChange?.({
				panX,
				panY,
				scale: persistedScaleForFocusOverzoom(scale, maxScale)
			});
			return true;
		}
		const nextScale = clampedScale;
		const nextView = zoomViewTransformAtPoint(startView, nextScale, focalPoint, {
			x: rect.left + rect.width / 2,
			y: rect.top + rect.height / 2
		});
		panX = nextView.panX;
		panY = nextView.panY;
		scale = nextView.scale;
		focusEntryBoundaryProgress = null;
		focusEntrySteeringNodeId = null;
		focusEntrySteeringState = null;
		if (requestedScale > nextScale) {
			onBlockedZoom?.({
				direction: 'in',
				focalPoint,
				viewState: { panX, panY, scale }
			});
		}
		return false;
	}

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
			focusEntrySteeringState = null;
			return false;
		}
		const step = solveFocusEntryBoundary({
			currentView: startView,
			requestedScale,
			focalPoint: { x: focalPoint.x - rect.left, y: focalPoint.y - rect.top },
			viewport: { width: rect.width, height: rect.height },
			candidate,
			steeringState: focusEntrySteeringState
		});

		panX = step.view.panX;
		panY = step.view.panY;
		scale = step.view.scale;
		focusEntrySteeringNodeId = step.phase === 'free' ? null : candidate.nodeId;
		focusEntrySteeringState = step.steeringState;

		if (step.phase === 'free') {
			focusEntryBoundaryProgress = null;
			focusEntrySteeringState = null;
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
			boundaryProgress,
			committed: boundaryProgress >= 1,
			nodeId: candidate.nodeId,
			viewState: { panX, panY, scale }
		});
		return true;
	}

	/**
	 * Back away from a focus-entry boundary, by however much the gesture asked
	 * for.
	 *
	 * Takes the requested scale rather than a wheel delta. The pinch path used to
	 * hand this a synthetic delta of ±1 — a stand-in for "the fingers moved
	 * inward" — which was then run back through `scaleFromWheelDelta` as if it
	 * were a real wheel. That produced a fixed ~0.2% release per pointermove no
	 * matter how far the fingers actually travelled, while a wheel released in
	 * proportion to its delta. The magnitude was being thrown away at the call
	 * site, so the call sites now do the conversion each already knows how to do
	 * and pass a scale.
	 */
	function releaseFocusEntryBoundaryProgress(requestedScale: number, focalPoint: Point): boolean {
		if (!focusEntryBoundaryProgress || requestedScale >= scale) return false;
		const releaseDelta = boundaryReleaseDelta(requestedScale, scale);
		const nextProgress = Math.max(0, focusEntryBoundaryProgress.progress - releaseDelta);
		const nodeId = focusEntryBoundaryProgress.nodeId;
		focusEntryBoundaryProgress = nextProgress > 0 ? { nodeId, progress: nextProgress } : null;
		onBlockedZoom?.({
			direction: 'out',
			focalPoint,
			boundaryProgress: nextProgress,
			committed: false,
			nodeId,
			viewState: { panX, panY, scale }
		});
		return true;
	}
</script>

<div
	bind:this={stageRef}
	class="stage"
	class:panning={panStart !== null}
	class:boxing={selectionBox !== null}
	class:cutting={edgeCutSession !== null}
	onpointerdown={onPointerDownStage}
	onpointermove={onPointerMoveStage}
	onpointerup={onPointerUpStage}
	onpointercancel={onPointerUpStage}
	oncontextmenu={onContextMenu}
	onwheel={onWheel}
	role="presentation"
>
	<!--
		Deliberately NOT `aria-hidden`. It was, which put the entire graph — every
		node, every title — outside the accessibility tree, so the canvas offered a
		screen reader nothing at all. The parts that really are decoration say so
		themselves: the edge layer, and the buffered/exiting/preview node renders.
	-->
	<div class="stage-content" style="transform: {transformStyle}; transform-origin: 50% 50%;">
		{#if children}
			{@render children()}
		{/if}
	</div>
	{#if selectionBox}
		<!--
			Beside the content layer, not in it: that layer is panned and scaled, and
			the box is drawn in the stage's own pixels from client coordinates. It
			takes no pointer events, so the press that drew it keeps hitting the
			stage underneath.
		-->
		<div
			class="selection-box"
			aria-hidden="true"
			style:left="{selectionBox.left}px"
			style:top="{selectionBox.top}px"
			style:width="{selectionBox.width}px"
			style:height="{selectionBox.height}px"
		></div>
	{/if}
	{#if edgeCutSession}
		{@const { from, to } = edgeCutSession.drawn}
		<!--
			The armed cut, beside the content layer for the box's reason: drawn in
			the stage's own pixels from client points, not panned or scaled. It takes
			no pointer events, so every press still reaches the stage. The dot marks
			the anchor, which is all there is to see on a phone until the finger
			lands.
		-->
		<svg class="edge-cut-line" aria-hidden="true">
			<line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={EDGE_CUT_COLOR} />
			<circle cx={from.x} cy={from.y} r="4" fill={EDGE_CUT_COLOR} />
		</svg>
	{/if}
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
	.stage.boxing,
	.stage.cutting {
		cursor: crosshair;
	}
	.edge-cut-line {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		overflow: visible;
		pointer-events: none;
	}
	/* Dashed, so the cut is not told from an edge by its colour alone. */
	.edge-cut-line line {
		stroke-width: 2;
		stroke-dasharray: 8 5;
		stroke-linecap: round;
	}
	.selection-box {
		position: absolute;
		box-sizing: border-box;
		pointer-events: none;
		border: 1px solid color-mix(in oklab, var(--foreground) 55%, transparent);
		background: color-mix(in oklab, var(--foreground) 8%, transparent);
		border-radius: 2px;
	}
	.stage-content {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
</style>
