<script lang="ts">
	import { untrack } from 'svelte';
	import Node from '$lib/components/ui/Node/Node.svelte';
	import NodeChrome from '$lib/components/ui/Node/NodeChrome.svelte';
	import NodeCompactContent from '$lib/components/ui/Node/NodeCompactContent.svelte';
	import NodeDetailsLayer from '$lib/components/ui/Node/NodeDetailsLayer.svelte';
	import DuplicateEdgeDialog from './DuplicateEdgeDialog.svelte';
	import GraphQueryPanel from './GraphQueryPanel.svelte';
	import NodeDetailsContent from './NodeDetailsContent.svelte';
	import NodeActionMenu from './NodeActionMenu.svelte';
	import NodeEditSheet from './NodeEditSheet.svelte';
	import DeepZoomStack, { type StackFrameArgs, type LayerBaseSize } from './DeepZoomStack.svelte';
	import Stage from './Stage.svelte';
	import TagColorLegend from './TagColorLegend.svelte';
	import { APP_CONFIG } from '$lib/appConfig';
	import type { GraphAssetStore } from '$lib/assets/assetStore';
	import { prefersReducedMotion } from '$lib/reducedMotion';
	import type { NodeData } from '../types/node';
	import type { EdgeData } from '../types/edge';
	import type {
		GraphAssetMetadata,
		MultigraphData,
		Point,
		TagColorNamespace
	} from '../types/multigraph';
	import { effectiveHitRadius, isPointInCircle } from './lib/hitTest.js';
	import {
		edgeArrowScale,
		edgeBackground,
		edgeRenderPoints,
		edgeStrokeScale,
		edgeStyle,
		type RenderableEdgeVisibility
	} from './lib/edgeStyle.js';
	import {
		computeEdgeOcclusionWindows,
		edgeOcclusionParametersForZoom,
		type EdgeOcclusionNode
	} from './lib/edgeOcclusion.js';
	import {
		addEdge,
		addNodeImageContent,
		addNode,
		commitInlineTitleSyntax,
		deleteTagEverywhere,
		duplicateEdgeIdentifier,
		findExistingEdge,
		moveNode,
		neighborsOf,
		removeEdge,
		removeNode,
		removeNodeImageContent,
		moveNodeContentBlock,
		setNodePinned,
		setTagColor,
		togglePinned,
		updateEdge,
		updateNodeImageContent,
		updateNodeContent
	} from './lib/graph.js';
	import { deriveGraphLayout, withSettledGraphPositions } from './lib/graphLayout.js';
	import { evaluateGraphQuery, type GraphQueryElementState } from './lib/graphQuery.js';
	import { beaconHopOverrides, beaconNodeIds, withBeaconHops } from './lib/beacons.js';
	import { hopsFromPinned } from './lib/layout.js';
	import type { LayoutSettings } from './lib/layoutSettings.js';
	import { withDefaultLayoutSettings } from './lib/layoutSettings.js';
	import {
		edgeVisibilityForPinnedNeighborhood,
		graphWithVisibleNodes,
		visibleNodeIdsForPinnedNeighborhood
	} from './lib/boundedVisibility.js';
	import { LayoutRuntime } from './lib/layoutRuntime.svelte.js';
	import { externalGraphSyncToken } from './lib/graphSync.js';
	import type { EntryGestureDirection } from './lib/entryGestureGate.js';
	import {
		collectLegendTags,
		edgeStrokeColor,
		nodeBorderSegments,
		tagBorderBackground,
		tagUsageCount
	} from './lib/tagColors.js';
	import {
		EDGE_ARROW_HALF_HEIGHT,
		EDGE_ARROW_LENGTH,
		EDGE_STROKE_WIDTH,
		MIN_NODE_HIT_RADIUS
	} from '$lib/constants.js';
	import type { ViewState } from '$lib/migrations.js';
	import {
		EMPTY_EXITING_BUFFER,
		addExitingEdge,
		addExitingNode,
		cancelExitingEdge,
		cancelExitingNode,
		createEdgeEnterAnimation,
		createNodeEnterAnimation,
		edgeOpacityAt,
		exitingEdgeOpacityAt,
		exitingNodeScaleAt,
		hasActiveEdgeEnterAnimations,
		hasActiveExiting,
		hasActiveNodeEnterAnimations,
		nodeEnterScaleAt,
		pruneFinishedEdgeEnterAnimations,
		pruneFinishedExiting,
		pruneFinishedNodeEnterAnimations,
		type EdgeOpacityAnimation,
		type ExitingBuffer,
		type NodeEnterAnimation
	} from './lib/elementTransitions.js';
	import { computeParallelEdgeOffsets } from './lib/parallelEdges.js';
	import type { FocusLevel } from './lib/focusRuntime.svelte.js';
	import { FocusController } from './lib/focusController.svelte.js';
	import {
		nodeScreenCircle,
		type NodeFocusCandidate,
		type ViewTransform
	} from './lib/nodeFocus.js';
	import {
		frameGeometry,
		type FrameGeometry,
		type FrameViewState,
		type NodeFrameLayout
	} from './lib/frameGeometry.js';
	import { interpolateMorph } from './lib/morphGeometry.js';
	import type { Rect } from './lib/zoomBoundary.js';
	import type { StageRect } from './lib/stageCoordinates.js';
	import { NODE_RADIUS, NODE_TEXT_FONT_SIZE } from '$lib/constants.js';

	const CENTERED_POSITION: Point = { x: 0, y: 0 };
	const FOCUS_TRANSITION_MS = APP_CONFIG.multigraph.focus.entryTransitionMs;
	const DETAILS_TITLE_ID = 'node-focus-title';
	const NODE_DIAMETER_PX = NODE_RADIUS * 2;
	/** Modest starting corner radius for an image frame's descend morph. */
	const IMAGE_SOURCE_RADIUS_PX = 8;
	/** Fixed logical size of the image level's compact (thumbnail) layer. */
	const IMAGE_COMPACT_PX = 96;

	let {
		multigraphData = {
			nodes: [],
			edges: [],
			posByNodeId: {},
			tagColorConfig: { nodeTags: {}, edgeTags: {} },
			assets: {}
		},
		graphGeneration = 0,
		defaultPrimaryNodeId = '',
		initialTitleEditNodeId,
		layoutSettings = {},
		initialViewState,
		onMultigraphChange,
		onViewStateChange,
		nodeRenderOverrides,
		edgeRenderOverrides,
		exitingBuffer,
		assetStore = null,
		assetScope = ''
	}: {
		multigraphData: MultigraphData;
		graphGeneration?: number;
		defaultPrimaryNodeId?: string;
		initialTitleEditNodeId?: string | null;
		layoutSettings?: Partial<LayoutSettings>;
		initialViewState?: ViewState;
		onMultigraphChange?: (data: MultigraphData) => void;
		onViewStateChange?: (state: ViewState) => void;
		/** Static per-node opacity override; used by stories and T04/T05 animation wiring. Default 1. */
		nodeRenderOverrides?: Record<string, { opacity?: number }>;
		/** Static per-edge opacity override; used by stories and T04/T05 animation wiring. Default 1. */
		edgeRenderOverrides?: Record<string, { opacity?: number }>;
		/** Elements that have left the visible set but are still animating out. Rendered but non-interactive. */
		exitingBuffer?: ExitingBuffer;
		assetStore?: GraphAssetStore | null;
		assetScope?: string;
	} = $props();

	let graph = $state<MultigraphData>({
		nodes: [],
		edges: [],
		posByNodeId: {},
		tagColorConfig: { nodeTags: {}, edgeTags: {} },
		assets: {}
	});
	let primaryNodeId = $state('');
	let activeDragNodeId = $state<string | null>(null);
	let editNodeId = $state<string | null>(null);
	let actionMenu = $state<{ nodeId: string; position: Point } | null>(null);
	let duplicateEdgeConfirm = $state<{ edgeId: string } | null>(null);
	let titleEditContext = $state<{
		nodeId: string;
		edgeId?: string;
		unpinOnCommit?: boolean;
	} | null>(null);
	let tagColorLegendOpen = $state(false);
	let graphQueryPanelOpen = $state(false);
	let graphQueryText = $state('');
	let graphQueryPreviewText = $state<string | null>(null);
	let activeQueryRegionIndex = $state(0);
	let fitViewRequest = $state<{
		id: number;
		bounds: import('./lib/graphMath.js').GraphBounds;
	} | null>(null);
	let fitViewRequestId = $state(0);
	let graphRef = $state<HTMLElement | null>(null);
	/**
	 * Endpoints of the most recent severing mutation (edge removal / node
	 * deletion), used as a last-resort beacon hint for pinless components that
	 * carry no pin history. Session-only; overwritten by the next severing
	 * mutation and cleared on external graph sync.
	 */
	let severedBeaconPreference = $state<string[]>([]);
	let lastSyncedGeneration = $state(-1);
	let lastInitialTitleEditKey = $state('');
	let stageViewState = $state<ViewState>({ panX: 0, panY: 0, scale: 1 });
	const stageScale = $derived(stageViewState.scale);
	/** Stage element's live on-screen rect, reported by Stage — never measured here. */
	let stageRect = $state<StageRect | null>(null);
	let reduceMotion = $derived(prefersReducedMotion());
	let stageEntryGestureGateRequest = $state<{
		id: number;
		direction: EntryGestureDirection;
		idleMs: number;
		maxMs: number;
	} | null>(null);
	let stageEntryGestureGateRequestId = $state(0);
	/**
	 * Owns the focus state machine (runtime stack, phase, commit/exit/idle). This
	 * component only feeds it live geometry/view deps and renders from its getters.
	 */
	const focus = new FocusController({
		getStageRect: () => stageRect,
		getViewState: () => stageViewState,
		getFillRect: () => focusFillRect(),
		getFocusCandidates: () => focusCandidates(),
		getReduceMotion: () => reduceMotion,
		armEntryGate: (direction) => armStageEntryGestureGate(direction),
		closeOverlays: () => closeOverlays(),
		config: {
			transitionMs: FOCUS_TRANSITION_MS,
			entryGestureIdleMs: APP_CONFIG.multigraph.focus.entryGestureIdleMs,
			entryGestureMaxMs: APP_CONFIG.multigraph.focus.entryGestureMaxMs
		}
	});

	/** Internal enter animations for nodes added by the user (scale 0 → target). */
	let nodeEnterAnimations = $state<Record<string, NodeEnterAnimation>>({});
	/** Internal enter/exit opacity animations for edges added/removed by the user. */
	let edgeEnterAnimations = $state<Record<string, EdgeOpacityAnimation>>({});
	/** Render-only buffer for elements removed by the user that are still animating out. */
	let internalExitingBuffer = $state<ExitingBuffer>(EMPTY_EXITING_BUFFER);

	const layoutRuntime: LayoutRuntime = new LayoutRuntime({
		getGraph: () => graph,
		getLayoutSettings: () => layoutSettings,
		getActiveDragNodeId: () => activeDragNodeId,
		getPreferredBeaconNodeIds: () => severedBeaconPreference,
		applyGraph: (nextGraph) => {
			graph = nextGraph;
		},
		getHasActiveTransitions: (): boolean => {
			const now: number = layoutRuntime.animationNowMs;
			return (
				hasActiveExiting(internalExitingBuffer, now) ||
				hasActiveNodeEnterAnimations(nodeEnterAnimations, now) ||
				hasActiveEdgeEnterAnimations(edgeEnterAnimations, now)
			);
		},
		onFrame: (nowMs) => {
			internalExitingBuffer = pruneFinishedExiting(internalExitingBuffer, nowMs);
			nodeEnterAnimations = pruneFinishedNodeEnterAnimations(nodeEnterAnimations, nowMs);
			edgeEnterAnimations = pruneFinishedEdgeEnterAnimations(edgeEnterAnimations, nowMs);
		}
	});

	const resolvedLayoutSettings = $derived(withDefaultLayoutSettings(layoutSettings));
	const beaconIds = $derived(beaconNodeIds(graph, { preferredNodeIds: severedBeaconPreference }));
	const hopsByNodeId = $derived(withBeaconHops(hopsFromPinned(graph), beaconIds));
	const visibleNodeIds = $derived(
		visibleNodeIdsForPinnedNeighborhood(graph, hopsByNodeId, {
			displayedLayers: resolvedLayoutSettings.displayedLayers
		})
	);
	const visibleGraph = $derived(graphWithVisibleNodes(graph, visibleNodeIds));
	const edgeVisibility = $derived(
		edgeVisibilityForPinnedNeighborhood(graph, hopsByNodeId, {
			displayedLayers: resolvedLayoutSettings.displayedLayers
		})
	);
	const renderableEdgeVisibility = $derived(
		edgeVisibility.filter(
			(visibility): visibility is RenderableEdgeVisibility => visibility.kind !== 'hidden'
		)
	);
	const legendTags = $derived(collectLegendTags(graph));
	const activeGraphQueryText = $derived(graphQueryPreviewText ?? graphQueryText);
	const graphQueryResult = $derived(evaluateGraphQuery(graph, activeGraphQueryText));
	const graphLayout = $derived(
		deriveGraphLayout(
			visibleGraph,
			layoutRuntime.layoutOptions(visibleGraph, { relaxIterations: 0 })
		)
	);
	const visibleEdgeOcclusionNodes = $derived.by((): EdgeOcclusionNode[] =>
		visibleGraph.nodes.flatMap((node) => {
			const position = graphLayout.posByNodeId[node.id];
			const radius = graphLayout.radiusByNodeId[node.id];
			if (!position || radius === undefined) return [];
			return [{ nodeId: node.id, position, radius }];
		})
	);
	const visibleEdgeParallelOffsets = $derived.by(() => {
		const visibleEdges: EdgeData[] = [];
		const visualHalfWidthByEdgeId: Record<string, number> = {};

		for (const visibility of renderableEdgeVisibility) {
			if (visibility.kind !== 'visible') continue;

			const edge = visibility.edge;
			const strokeHalfWidth =
				(EDGE_STROKE_WIDTH * edgeStrokeScale(visibility, graphLayout.scaleByNodeId)) / 2;
			const arrowHalfHeight =
				edge.directed === true
					? EDGE_ARROW_HALF_HEIGHT * edgeArrowScale(visibility, graphLayout.scaleByNodeId)
					: 0;
			visibleEdges.push(edge);
			visualHalfWidthByEdgeId[edge.id] = Math.max(strokeHalfWidth, arrowHalfHeight);
		}

		return computeParallelEdgeOffsets(visibleEdges, graphLayout, {
			clearancePx: resolvedLayoutSettings.parallelEdgeClearancePx,
			maxOffsetRadiusFactor: resolvedLayoutSettings.parallelEdgeMaxOffsetRadiusFactor,
			visualHalfWidthByEdgeId
		});
	});
	const nodeById = $derived(Object.fromEntries(graph.nodes.map((node) => [node.id, node])));
	const revealWaveNodeOpacityByNodeId = $derived(layoutRuntime.revealWaveNodeOpacityByNodeId);
	const revealWaveEdgeOpacityByEdgeId = $derived(layoutRuntime.revealWaveEdgeOpacityByEdgeId);
	const revealWavePreviousScaleByNodeId = $derived(layoutRuntime.revealWavePreviousScaleByNodeId);
	const combinedScaleByNodeId = $derived({
		...graphLayout.scaleByNodeId,
		...revealWavePreviousScaleByNodeId
	});
	const revealWavePreviousRadiusByNodeId = $derived.by(() =>
		Object.fromEntries(
			Object.entries(revealWavePreviousScaleByNodeId).map(([nodeId, scale]) => [
				nodeId,
				resolvedLayoutSettings.baseRadius * scale
			])
		)
	);
	const combinedRadiusByNodeId = $derived({
		...graphLayout.radiusByNodeId,
		...revealWavePreviousRadiusByNodeId
	});
	const combinedEdgeLayout = $derived({
		posByNodeId: graphLayout.posByNodeId,
		radiusByNodeId: combinedRadiusByNodeId
	});
	const editNode = $derived(graph.nodes.find((node) => node.id === editNodeId) ?? null);
	const actionMenuNode = $derived.by(() => {
		const menu = actionMenu;
		return menu ? (graph.nodes.find((node) => node.id === menu.nodeId) ?? null) : null;
	});
	/** Merged exiting buffer: external prop (stories/T03 testing) + internal (user actions). */
	const effectiveExitingBuffer = $derived.by((): ExitingBuffer => {
		const ext = exitingBuffer ?? EMPTY_EXITING_BUFFER;
		return {
			nodes: { ...ext.nodes, ...internalExitingBuffer.nodes },
			edges: { ...ext.edges, ...internalExitingBuffer.edges }
		};
	});

	/** Exiting buffer nodes that are not currently in the visible set (avoid double-render). */
	const exitingOnlyNodes = $derived.by(() => {
		const visibleIds = new Set(visibleGraph.nodes.map((n) => n.id));
		return Object.entries(effectiveExitingBuffer.nodes).filter(([id]) => !visibleIds.has(id));
	});

	/** Exiting buffer edges that are not currently in the renderable visible set. */
	const exitingOnlyEdges = $derived.by(() => {
		const renderableIds = new Set(renderableEdgeVisibility.map((v) => v.edge.id));
		return Object.entries(effectiveExitingBuffer.edges).filter(([id]) => !renderableIds.has(id));
	});

	$effect(() => {
		const generation = externalGraphSyncToken(graphGeneration);
		if (generation === lastSyncedGeneration) return;

		lastSyncedGeneration = generation;
		const incoming = untrack(() => multigraphData);
		const primary = untrack(() => defaultPrimaryNodeId);
		const settings = untrack(() => layoutSettings);
		layoutRuntime.reset();
		graph = withSettledGraphPositions(incoming, {
			settings,
			hopOverridesByNodeId: beaconHopOverrides(beaconNodeIds(incoming))
		});
		primaryNodeId = primary;
		severedBeaconPreference = [];
		internalExitingBuffer = EMPTY_EXITING_BUFFER;
		nodeEnterAnimations = {};
		edgeEnterAnimations = {};
	});

	$effect(() => {
		const nodeId = initialTitleEditNodeId;
		if (!nodeId) return;
		const editKey = `${externalGraphSyncToken(graphGeneration)}:${nodeId}`;
		if (editKey === lastInitialTitleEditKey) return;
		if (!graph.nodes.some((node) => node.id === nodeId)) return;
		lastInitialTitleEditKey = editKey;
		closeOverlays();
		titleEditContext = { nodeId };
	});

	$effect(() => {
		const regionCount = graphQueryResult.regions.length;
		if (regionCount === 0) {
			activeQueryRegionIndex = 0;
			return;
		}
		if (activeQueryRegionIndex >= regionCount) {
			activeQueryRegionIndex = regionCount - 1;
		}
	});

	$effect(() => {
		if (typeof window === 'undefined') return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && focus.isFocused) {
				focus.closeFocus();
				return;
			}
			if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
			event.preventDefault();
			closeOverlays();
			graphQueryPanelOpen = true;
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	});

	$effect(() => {
		return () => {
			focus.dispose();
			layoutRuntime.stop();
		};
	});

	/**
	 * Resolve the node at client coordinates by projecting each visible node's
	 * on-screen circle from its layout + the live stage view — no DOM
	 * measurement. Iterates front-to-back (last rendered is topmost) and honors
	 * the minimum tap radius. Query-excluded nodes are not rendered, so skip
	 * them here too.
	 */
	function getNodeAt(clientX: number, clientY: number): NodeData | null {
		const rect = stageRect;
		if (!rect) return null;
		const view: ViewTransform = {
			panX: stageViewState.panX,
			panY: stageViewState.panY,
			scale: stageViewState.scale
		};
		const nodes = visibleGraph.nodes;
		for (let index = nodes.length - 1; index >= 0; index -= 1) {
			const node = nodes[index];
			if (queryStateForNode(node.id)?.role === 'excluded') continue;
			const position = graphLayout.posByNodeId[node.id];
			const radius = graphLayout.radiusByNodeId[node.id];
			if (!position || radius === undefined) continue;
			const circle = nodeScreenCircle(node.id, position, radius, rect, view);
			const hitRadius = effectiveHitRadius(circle.radius, MIN_NODE_HIT_RADIUS);
			if (isPointInCircle(clientX, clientY, circle.center.x, circle.center.y, hitRadius)) {
				return node;
			}
		}
		return null;
	}

	function handleNodeMoved(node: NodeData, point: Point) {
		const movedGraph = moveNode(graph, node.id, point);
		commitUserGraph(layoutRuntime.relaxAfterMutation(movedGraph, node.id, 1));
	}

	function handleNodeDragStart(node: NodeData) {
		activeDragNodeId = node.id;
		layoutRuntime.beginDrag();
	}

	function handleNodeDragEnd(node: NodeData) {
		activeDragNodeId = null;

		if (node.pinned) {
			commitUserGraph(layoutRuntime.beginScaleChange(graph, node.id));
			return;
		}

		commitUserGraph(layoutRuntime.relaxAfterMutation(graph, null, 1));
		layoutRuntime.settleAfterDrag();
	}

	function handleNodeMakePrimary(node: NodeData) {
		closeOverlays();
		const wasPinned = node.pinned === true;
		commitUserGraph(layoutRuntime.beginScaleChange(togglePinned(graph, node.id), node.id));

		if (!wasPinned) {
			primaryNodeId = node.id;
			return;
		}

		primaryNodeId =
			graph.nodes.find((candidate) => candidate.pinned)?.id ??
			graph.nodes.find((candidate) => candidate.id === defaultPrimaryNodeId)?.id ??
			graph.nodes[0]?.id ??
			'';
	}

	function handleNodeDoubleClickDropOntoNode(sourceNode: NodeData, targetNode: NodeData) {
		closeOverlays();
		const existing = findExistingEdge(graph, sourceNode.id, targetNode.id);
		if (existing) {
			duplicateEdgeConfirm = { edgeId: existing.id };
		} else {
			const graphWithEdge = addEdge(graph, sourceNode.id, targetNode.id);
			const newEdge = graphWithEdge.edges[graphWithEdge.edges.length - 1] ?? null;
			commitUserGraph(layoutRuntime.relaxAfterMutation(graphWithEdge));

			const durationMs = resolvedLayoutSettings.enterExitDurationMs;
			if (newEdge && durationMs > 0) {
				const nowMs = layoutRuntime.now();
				internalExitingBuffer = cancelExitingEdge(internalExitingBuffer, newEdge.id);
				edgeEnterAnimations = {
					...edgeEnterAnimations,
					[newEdge.id]: createEdgeEnterAnimation(nowMs, durationMs)
				};
				layoutRuntime.start();
			}
		}
	}

	function handleNodeDoubleClickDropOntoBackground(sourceNode: NodeData, point: Point) {
		closeOverlays();
		const graphWithNode = addNode(graph, { pinned: true, position: point });
		const newNode = graphWithNode.nodes[graphWithNode.nodes.length - 1] ?? null;
		const graphWithEdge = newNode
			? addEdge(graphWithNode, sourceNode.id, newNode.id)
			: graphWithNode;
		const newEdge = graphWithEdge.edges[graphWithEdge.edges.length - 1] ?? null;

		commitUserGraph(layoutRuntime.relaxAfterMutation(graphWithEdge));

		const durationMs = resolvedLayoutSettings.enterExitDurationMs;
		if (durationMs > 0) {
			const nowMs = layoutRuntime.now();
			if (newNode) {
				internalExitingBuffer = cancelExitingNode(internalExitingBuffer, newNode.id);
				const targetScale = graphLayout.scaleByNodeId[newNode.id] ?? 1;
				nodeEnterAnimations = {
					...nodeEnterAnimations,
					[newNode.id]: createNodeEnterAnimation(targetScale, nowMs, durationMs)
				};
			}
			if (newEdge) {
				internalExitingBuffer = cancelExitingEdge(internalExitingBuffer, newEdge.id);
				edgeEnterAnimations = {
					...edgeEnterAnimations,
					[newEdge.id]: createEdgeEnterAnimation(nowMs, durationMs)
				};
			}
			if (newNode || newEdge) {
				layoutRuntime.start();
			}
		}

		if (newNode) {
			titleEditContext = { nodeId: newNode.id, edgeId: newEdge?.id, unpinOnCommit: true };
		}
	}

	function handleNodeLongPress(node: NodeData, point: Point) {
		editNodeId = null;
		actionMenu = { nodeId: node.id, position: point };
	}

	function openEditSheet(nodeId: string) {
		actionMenu = null;
		editNodeId = nodeId;
	}

	function armStageEntryGestureGate(direction: EntryGestureDirection) {
		stageEntryGestureGateRequestId += 1;
		stageEntryGestureGateRequest = {
			id: stageEntryGestureGateRequestId,
			direction,
			idleMs: APP_CONFIG.multigraph.focus.entryGestureIdleMs,
			maxMs: APP_CONFIG.multigraph.focus.entryGestureMaxMs
		};
	}

	function closeOverlays() {
		actionMenu = null;
		editNodeId = null;
		duplicateEdgeConfirm = null;
		titleEditContext = null;
		tagColorLegendOpen = false;
		graphQueryPanelOpen = false;
		graphQueryPreviewText = null;
	}

	function focusCandidates(): NodeFocusCandidate[] {
		return visibleGraph.nodes.flatMap((node, index) => {
			const position = graphLayout.posByNodeId[node.id];
			const radius = graphLayout.radiusByNodeId[node.id];
			if (!position || radius === undefined) return [];
			return [{ node, position, radius, zIndex: index }];
		});
	}

	/** Live view state feeding `frameGeometry`; the stage rect is reported, not measured. */
	function focusViewState(): FrameViewState | null {
		if (!stageRect) return null;
		return {
			pan: { x: stageViewState.panX, y: stageViewState.panY },
			scale: stageViewState.scale,
			stageRect
		};
	}

	/** The subject node's current layout in graph space + its on-screen content scale. */
	function focusNodeLayout(subjectId: string): NodeFrameLayout | null {
		const node = nodeById[subjectId];
		const center = graphLayout.posByNodeId[subjectId];
		const radius = graphLayout.radiusByNodeId[subjectId];
		if (!node || !center || radius === undefined) return null;
		return {
			center,
			radius,
			nodeScale: graphLayout.scaleByNodeId[subjectId] ?? 1,
			pinned: node.pinned ?? false
		};
	}

	function focusFillRect(): Rect {
		const rect = stageRect;
		const width = rect?.width ?? (typeof window === 'undefined' ? 800 : window.innerWidth);
		const height = rect?.height ?? (typeof window === 'undefined' ? 600 : window.innerHeight);
		return {
			left: rect?.left ?? 0,
			top: rect?.top ?? 0,
			width: Math.max(1, width),
			height: Math.max(1, height)
		};
	}

	/**
	 * Compute the level's frame geometry LIVE every render from the subject
	 * node's layout + the live stage view — no captured or measured rect. This
	 * is why the exit morph automatically tracks the node's current on-screen
	 * position; there is nothing to snapshot.
	 */
	function geometryForFocusLevel(level: FocusLevel): FrameGeometry {
		if (level.subjectKind === 'image') {
			// The image frame morphs from the captured on-screen image rect out to
			// the viewport through the SAME interpolation used for node frames.
			const morph = interpolateMorph(level.sourceRect, level.fillRect, level.morphProgress, {
				sourceRadiusPx: IMAGE_SOURCE_RADIUS_PX,
				targetRadiusPx: APP_CONFIG.multigraph.focus.detailsCornerRadiusPx,
				sourceBorderWidthPx: 0,
				targetBorderWidthPx: APP_CONFIG.multigraph.focus.detailsBorderWidthPx
			});
			return {
				x: morph.x,
				y: morph.y,
				width: morph.width,
				height: morph.height,
				borderRadiusPx: morph.borderRadiusPx,
				borderWidthPx: morph.borderWidthPx ?? 0
			};
		}
		const layout = focusNodeLayout(level.subjectId);
		const view = focusViewState();
		const fill = focusFillRect();
		if (!layout || !view) {
			return {
				x: fill.left,
				y: fill.top,
				width: fill.width,
				height: fill.height,
				borderRadiusPx: APP_CONFIG.multigraph.focus.detailsCornerRadiusPx,
				borderWidthPx: APP_CONFIG.multigraph.focus.detailsBorderWidthPx
			};
		}
		return frameGeometry(layout, view, fill, level.morphProgress);
	}

	function baseSizeForFocusLevel(level: FocusLevel): LayerBaseSize {
		if (level.subjectKind === 'image') {
			// Details layer laid out at the captured fill size so its scale is
			// exactly 1 at fit — the image is scaled only by the layer + world
			// transforms, never twice, so it stays crisp.
			return {
				compactPx: IMAGE_COMPACT_PX,
				detailsWidthPx: level.fillRect.width,
				detailsHeightPx: level.fillRect.height
			};
		}
		const fill = focusFillRect();
		return {
			compactPx: NODE_DIAMETER_PX,
			detailsWidthPx: fill.width,
			detailsHeightPx: fill.height
		};
	}

	function toggleTagColorLegend() {
		const shouldOpen = !tagColorLegendOpen;
		closeOverlays();
		tagColorLegendOpen = shouldOpen;
	}

	function toggleGraphQueryPanel() {
		const shouldOpen = !graphQueryPanelOpen;
		closeOverlays();
		graphQueryPanelOpen = shouldOpen;
	}

	function toggleNodePinned(nodeId: string) {
		commitUserGraph(layoutRuntime.beginScaleChange(togglePinned(graph, nodeId), nodeId));
	}

	function deleteNode(nodeId: string) {
		const durationMs = resolvedLayoutSettings.enterExitDurationMs;
		const nowMs = layoutRuntime.now();

		// Capture final-known render data before mutating graph.
		const nodeToRemove = graph.nodes.find((n) => n.id === nodeId) ?? null;
		const nodePos = graph.posByNodeId[nodeId] ?? CENTERED_POSITION;
		const nodeScaleAtDelete = graphLayout.scaleByNodeId[nodeId] ?? 1;
		const affectedEdgeData = renderableEdgeVisibility
			.filter((v) => v.edge.sourceNodeId === nodeId || v.edge.targetNodeId === nodeId)
			.map((v) => v.edge);

		severedBeaconPreference = neighborsOf(graph, nodeId).map((neighbor) => neighbor.id);
		commitUserGraph(layoutRuntime.relaxAfterMutation(removeNode(graph, nodeId)));

		if (durationMs > 0) {
			let nextBuffer = internalExitingBuffer;

			if (nodeToRemove) {
				// Cancel any enter animation and start exit.
				nodeEnterAnimations = Object.fromEntries(
					Object.entries(nodeEnterAnimations).filter(([k]) => k !== nodeId)
				);
				nextBuffer = cancelExitingNode(nextBuffer, nodeId);
				nextBuffer = addExitingNode(nextBuffer, nodeId, {
					nodeData: nodeToRemove,
					x: nodePos.x,
					y: nodePos.y,
					fromScale: nodeScaleAtDelete,
					startedAtMs: nowMs,
					durationMs
				});
			}

			for (const edge of affectedEdgeData) {
				const enterAnim = edgeEnterAnimations[edge.id];
				const fromOpacity = enterAnim ? edgeOpacityAt(enterAnim, nowMs) : 1;
				edgeEnterAnimations = Object.fromEntries(
					Object.entries(edgeEnterAnimations).filter(([k]) => k !== edge.id)
				);
				nextBuffer = cancelExitingEdge(nextBuffer, edge.id);
				nextBuffer = addExitingEdge(nextBuffer, edge.id, {
					edgeData: edge,
					fromOpacity,
					startedAtMs: nowMs,
					durationMs
				});
			}

			internalExitingBuffer = nextBuffer;
			if (nodeToRemove || affectedEdgeData.length > 0) {
				layoutRuntime.start();
			}
		}

		if (primaryNodeId === nodeId) {
			primaryNodeId =
				graph.nodes.find((candidate) => candidate.pinned)?.id ??
				graph.nodes.find((candidate) => candidate.id === defaultPrimaryNodeId)?.id ??
				graph.nodes[0]?.id ??
				'';
		}
		closeOverlays();
	}

	function saveNodeContent(
		nodeId: string,
		content: { title: string; description: string; tags?: string[] }
	) {
		commitUserGraph(updateNodeContent(graph, nodeId, content));
		closeOverlays();
	}

	async function addImageToNode(
		nodeId: string,
		file: File,
		details: { alt: string; caption?: string }
	): Promise<'added' | 'unsupported' | 'store-failed'> {
		if (!file.type.startsWith('image/')) return 'unsupported';
		if (!assetStore || !assetScope) return 'store-failed';
		const assetId =
			typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
				? crypto.randomUUID()
				: `asset-${Date.now().toString(36)}`;
		const stored = await assetStore.put({
			scope: assetScope,
			assetId,
			blob: file,
			mimeType: file.type,
			name: file.name,
			size: file.size,
			updatedAt: Date.now()
		});
		if (!stored.ok) return 'store-failed';
		const asset: GraphAssetMetadata = {
			id: assetId,
			kind: 'image',
			mimeType: file.type,
			name: file.name,
			size: file.size,
			createdAt: Date.now()
		};
		commitUserGraph(
			addNodeImageContent(
				graph,
				nodeId,
				{ type: 'image', assetId, alt: details.alt, caption: details.caption },
				asset
			)
		);
		return 'added';
	}

	function saveNodeImage(
		nodeId: string,
		assetId: string,
		details: { alt: string; caption?: string }
	) {
		commitUserGraph(updateNodeImageContent(graph, nodeId, assetId, details));
	}

	function moveNodeImage(nodeId: string, fromIndex: number, direction: -1 | 1) {
		commitUserGraph(moveNodeContentBlock(graph, nodeId, fromIndex, fromIndex + direction));
	}

	async function deleteNodeImage(nodeId: string, assetId: string) {
		const result = removeNodeImageContent(graph, nodeId, assetId);
		commitUserGraph(result.graph);
		if (!assetStore || !assetScope) return;
		for (const removedAssetId of result.removedAssetIds) {
			await assetStore.delete(assetScope, removedAssetId);
		}
	}

	function saveEdgeContent(edgeId: string, patch: Parameters<typeof updateEdge>[2]) {
		commitUserGraph(updateEdge(graph, edgeId, patch));
	}

	function updateTagColor(namespace: TagColorNamespace, tag: string, color: string) {
		commitUserGraph(setTagColor(graph, namespace, tag, color));
	}

	function deleteLegendTag(namespace: TagColorNamespace, tag: string) {
		const usageCount = tagUsageCount(graph, namespace, tag);
		if (usageCount > 0) {
			const tagKind = namespace === 'nodeTags' ? 'node tag' : 'edge tag';
			const confirmed = window.confirm(
				`Delete ${tagKind} "${tag}" from ${usageCount} ${usageCount === 1 ? 'use' : 'uses'}?`
			);
			if (!confirmed) return;
		}

		commitUserGraph(deleteTagEverywhere(graph, namespace, tag));
	}

	function queryStateForNode(nodeId: string): GraphQueryElementState | undefined {
		return graphQueryResult.nodeStateById[nodeId];
	}

	function queryStateForEdge(edgeId: string): GraphQueryElementState | undefined {
		return graphQueryResult.edgeStateById[edgeId];
	}

	function queryOpacity(state: GraphQueryElementState | undefined): number {
		if (!graphQueryResult.hasActiveQuery || !state) return 1;
		if (state.role === 'focus' || state.role === 'spotlight') return 1;
		if (state.role === 'excluded') return 0;
		if (!graphQueryResult.dimsBackground) return 1;
		if (state.role === 'context') return 0.42;
		if (state.role === 'background') return 0.16;
		return 0;
	}

	function navigateQueryRegion(direction: 'previous' | 'next') {
		const regionCount = graphQueryResult.regions.length;
		if (regionCount === 0) return;
		activeQueryRegionIndex =
			direction === 'next'
				? (activeQueryRegionIndex + 1) % regionCount
				: (activeQueryRegionIndex - 1 + regionCount) % regionCount;
		fitActiveQueryRegion();
	}

	function fitActiveQueryRegion() {
		const region = graphQueryResult.regions[activeQueryRegionIndex];
		if (!region) return;
		const bounds = boundsForNodeIds(region.nodeIds);
		if (!bounds) return;
		fitViewRequest = { id: (fitViewRequestId += 1), bounds };
	}

	function boundsForNodeIds(nodeIds: string[]) {
		const entries = nodeIds.flatMap((nodeId) => {
			const position = graphLayout.posByNodeId[nodeId];
			const radius = graphLayout.radiusByNodeId[nodeId];
			if (!position || radius === undefined) return [];
			return [
				{
					minX: position.x - radius,
					minY: position.y - radius,
					maxX: position.x + radius,
					maxY: position.y + radius
				}
			];
		});
		if (entries.length === 0) return null;
		return {
			minX: Math.min(...entries.map((entry) => entry.minX)),
			minY: Math.min(...entries.map((entry) => entry.minY)),
			maxX: Math.max(...entries.map((entry) => entry.maxX)),
			maxY: Math.max(...entries.map((entry) => entry.maxY))
		};
	}

	function commitUserGraph(nextGraph: MultigraphData) {
		graph = nextGraph;
		onMultigraphChange?.(nextGraph);
	}
</script>

<div
	class="graph"
	class:focus-active={focus.committed && !focus.exiting}
	bind:this={graphRef}
	style={`--focus-transition-duration: ${FOCUS_TRANSITION_MS}ms;`}
	data-settling={layoutRuntime.isSettling ? 'true' : undefined}
	data-scale-change-focal={layoutRuntime.scaleAnchoredNodeIds[0]}
	data-scale-animation-active={layoutRuntime.hasActiveScaleAnimations ? 'true' : undefined}
	data-layered-relayout-active={layoutRuntime.isLayeredRelayoutActive ? 'true' : undefined}
	data-layered-relayout-state={layoutRuntime.relayoutStateKey ?? undefined}
>
	<button
		type="button"
		class="toolbar-button tag-color-button"
		aria-haspopup="dialog"
		aria-expanded={tagColorLegendOpen}
		onclick={toggleTagColorLegend}
	>
		Tag colors
	</button>

	<button
		type="button"
		class="toolbar-button graph-query-button"
		aria-haspopup="dialog"
		aria-expanded={graphQueryPanelOpen}
		onclick={toggleGraphQueryPanel}
	>
		Find / Filter
	</button>

	<Stage
		{getNodeAt}
		{fitViewRequest}
		focusEntryBoundaryCandidateForPoint={(input) => focus.entryBoundaryCandidateForPoint(input)}
		entryGestureGateRequest={stageEntryGestureGateRequest}
		initialScale={initialViewState?.scale}
		initialPanX={initialViewState?.panX}
		initialPanY={initialViewState?.panY}
		onNodeMoved={handleNodeMoved}
		onNodeDragStart={handleNodeDragStart}
		onNodeDragEnd={handleNodeDragEnd}
		onNodeMakePrimary={handleNodeMakePrimary}
		onNodeDoubleClickDropOntoNode={handleNodeDoubleClickDropOntoNode}
		onNodeDoubleClickDropOntoBackground={handleNodeDoubleClickDropOntoBackground}
		onNodeLongPress={handleNodeLongPress}
		onViewStateLiveChange={(state) => {
			stageViewState = state;
		}}
		onStageRectChange={(rect) => {
			stageRect = rect;
		}}
		onBlockedZoom={(input) => focus.handleBlockedZoom(input)}
		{onViewStateChange}
	>
		<div class="edges" aria-hidden="true">
			{#each renderableEdgeVisibility as visibility (visibility.edge.id)}
				{@const edge = visibility.edge}
				{@const queryEdgeState = queryStateForEdge(edge.id)}
				{#if queryEdgeState?.role !== 'excluded'}
					{@const parallelOffset =
						visibility.kind === 'visible' ? visibleEdgeParallelOffsets[edge.id] : undefined}
					{@const edgePoints = edgeRenderPoints(
						visibility,
						graphLayout,
						graph.posByNodeId,
						parallelOffset
					)}
					{@const edgeLengthPx = Math.hypot(
						edgePoints.target.x - edgePoints.source.x,
						edgePoints.target.y - edgePoints.source.y
					)}
					{@const boundaryFadeRadiusPx =
						visibility.kind === 'boundary'
							? (graphLayout.radiusByNodeId[visibility.visibleNodeId] ?? 0)
							: undefined}
					{@const effectiveEdgeOcclusionParameters = edgeOcclusionParametersForZoom(
						{
							clearancePx: resolvedLayoutSettings.edgeOcclusionClearancePx,
							fadeWidthPx: resolvedLayoutSettings.edgeOcclusionFadeWidthPx,
							zoomScaleExponent: resolvedLayoutSettings.edgeOcclusionZoomScaleExponent
						},
						stageScale
					)}
					{@const edgeOcclusionWindows =
						visibility.kind === 'visible'
							? computeEdgeOcclusionWindows(
									{
										sourceNodeId: edge.sourceNodeId,
										targetNodeId: edge.targetNodeId,
										source: edgePoints.source,
										target: edgePoints.target,
										directed: edge.directed
									},
									visibleEdgeOcclusionNodes,
									{
										...effectiveEdgeOcclusionParameters,
										edgeOcclusionMinOpacity: resolvedLayoutSettings.edgeOcclusionMinOpacity
									}
								)
							: []}
					{@const arrowScale = edgeArrowScale(visibility, graphLayout.scaleByNodeId)}
					{@const strokeScale = edgeStrokeScale(visibility, graphLayout.scaleByNodeId)}
					{@const edgeColor =
						queryEdgeState?.role === 'spotlight' && queryEdgeState.spotlightColor
							? queryEdgeState.spotlightColor
							: edgeStrokeColor(edge, graph.tagColorConfig.edgeTags)}
					{@const edgeEnterAnim = edgeEnterAnimations[edge.id]}
					{@const baseEdgeOpacity =
						edgeRenderOverrides?.[edge.id]?.opacity ??
						(edgeEnterAnim ? edgeOpacityAt(edgeEnterAnim, layoutRuntime.animationNowMs) : 1)}
					{@const edgeOpacity =
						baseEdgeOpacity *
						(revealWaveEdgeOpacityByEdgeId[edge.id] ?? 1) *
						queryOpacity(queryEdgeState)}
					<div
						class="edge"
						class:directed={edge.directed === true && visibility.kind === 'visible'}
						class:boundary={visibility.kind === 'boundary'}
						class:query-spotlight={queryEdgeState?.role === 'spotlight'}
						data-edge-id={edge.id}
						data-query-role={queryEdgeState?.role}
						data-source-node-id={edge.sourceNodeId}
						data-target-node-id={edge.targetNodeId}
						data-directed={edge.directed === true ? 'true' : undefined}
						data-arrow-target-node-id={edge.directed === true && visibility.kind === 'visible'
							? edge.targetNodeId
							: undefined}
						data-edge-visibility={visibility.kind}
						data-visible-node-id={visibility.kind === 'boundary'
							? visibility.visibleNodeId
							: undefined}
						data-hidden-node-id={visibility.kind === 'boundary'
							? visibility.hiddenNodeId
							: undefined}
						data-boundary-fade-ratio={visibility.kind === 'boundary'
							? visibility.fadeRatio
							: undefined}
						data-boundary-fade-radius={boundaryFadeRadiusPx}
						data-edge-boundary-dashed={visibility.kind === 'boundary' ? 'true' : undefined}
						data-edge-arrow-scale={edge.directed === true && visibility.kind === 'visible'
							? arrowScale
							: undefined}
						data-edge-stroke-scale={strokeScale}
						data-edge-opacity={edgeOpacity}
						data-edge-parallel-count={visibility.kind === 'visible'
							? parallelOffset?.groupCount
							: undefined}
						data-edge-parallel-slot={visibility.kind === 'visible'
							? parallelOffset?.slot
							: undefined}
						data-edge-parallel-offset={visibility.kind === 'visible'
							? (parallelOffset?.offsetDistance ?? 0)
							: undefined}
						data-edge-occlusion-count={visibility.kind === 'visible'
							? edgeOcclusionWindows.length
							: undefined}
						data-edge-occlusion-fade-width={visibility.kind === 'visible'
							? effectiveEdgeOcclusionParameters.edgeOcclusionFadeWidthPx
							: undefined}
						style={`${edgeStyle(edgePoints.source, edgePoints.target)} --edge-background: ${edgeBackground(
							visibility,
							edgeColor,
							{
								occlusionWindows: edgeOcclusionWindows,
								edgeLengthPx,
								edgeArrowLengthPx: EDGE_ARROW_LENGTH * arrowScale,
								edgeOcclusionMinOpacity: resolvedLayoutSettings.edgeOcclusionMinOpacity,
								boundaryFadeRadiusPx
							}
						)}; color: ${edgeColor}; --edge-spotlight-color: ${queryEdgeState?.spotlightColor ?? 'transparent'}; --edge-arrow-length: ${EDGE_ARROW_LENGTH * arrowScale}px; --edge-arrow-half-height: ${EDGE_ARROW_HALF_HEIGHT * arrowScale}px; --edge-stroke-width: ${EDGE_STROKE_WIDTH * strokeScale}px; opacity: ${edgeOpacity};`}
					></div>
				{/if}
			{/each}
			{#each layoutRuntime.revealWavePreviousOnlyEdgeVisibility as visibility (visibility.edge.id)}
				{@const edge = visibility.edge}
				{@const edgePoints = edgeRenderPoints(visibility, combinedEdgeLayout, graph.posByNodeId)}
				{@const edgeLengthPx = Math.hypot(
					edgePoints.target.x - edgePoints.source.x,
					edgePoints.target.y - edgePoints.source.y
				)}
				{@const boundaryFadeRadiusPx =
					visibility.kind === 'boundary'
						? (combinedEdgeLayout.radiusByNodeId[visibility.visibleNodeId] ?? 0)
						: undefined}
				{@const arrowScale = edgeArrowScale(visibility, combinedScaleByNodeId)}
				{@const strokeScale = edgeStrokeScale(visibility, combinedScaleByNodeId)}
				{@const edgeColor = edgeStrokeColor(edge, graph.tagColorConfig.edgeTags)}
				{@const baseEdgeOpacity = edgeRenderOverrides?.[edge.id]?.opacity ?? 1}
				{@const edgeOpacity = baseEdgeOpacity * (revealWaveEdgeOpacityByEdgeId[edge.id] ?? 1)}
				<div
					class="edge"
					class:directed={edge.directed === true && visibility.kind === 'visible'}
					class:boundary={visibility.kind === 'boundary'}
					data-edge-id={edge.id}
					data-source-node-id={edge.sourceNodeId}
					data-target-node-id={edge.targetNodeId}
					data-directed={edge.directed === true ? 'true' : undefined}
					data-arrow-target-node-id={edge.directed === true && visibility.kind === 'visible'
						? edge.targetNodeId
						: undefined}
					data-edge-visibility={visibility.kind}
					data-visible-node-id={visibility.kind === 'boundary'
						? visibility.visibleNodeId
						: undefined}
					data-hidden-node-id={visibility.kind === 'boundary' ? visibility.hiddenNodeId : undefined}
					data-boundary-fade-ratio={visibility.kind === 'boundary'
						? visibility.fadeRatio
						: undefined}
					data-boundary-fade-radius={boundaryFadeRadiusPx}
					data-edge-boundary-dashed={visibility.kind === 'boundary' ? 'true' : undefined}
					data-edge-arrow-scale={edge.directed === true && visibility.kind === 'visible'
						? arrowScale
						: undefined}
					data-edge-stroke-scale={strokeScale}
					data-edge-opacity={edgeOpacity}
					data-edge-reveal-buffer="true"
					style={`${edgeStyle(edgePoints.source, edgePoints.target)} --edge-background: ${edgeBackground(
						visibility,
						edgeColor,
						{
							edgeLengthPx,
							boundaryFadeRadiusPx
						}
					)}; color: ${edgeColor}; --edge-arrow-length: ${EDGE_ARROW_LENGTH * arrowScale}px; --edge-arrow-half-height: ${EDGE_ARROW_HALF_HEIGHT * arrowScale}px; --edge-stroke-width: ${EDGE_STROKE_WIDTH * strokeScale}px; opacity: ${edgeOpacity}; pointer-events: none;`}
				></div>
			{/each}
			{#each exitingOnlyEdges as [id, entry] (id)}
				{@const sourcePos = graph.posByNodeId[entry.edgeData.sourceNodeId]}
				{@const targetPos = graph.posByNodeId[entry.edgeData.targetNodeId]}
				{#if sourcePos && targetPos}
					{@const edgeOpacity =
						edgeRenderOverrides?.[id]?.opacity ??
						exitingEdgeOpacityAt(entry, layoutRuntime.animationNowMs)}
					{@const edgeColor = edgeStrokeColor(entry.edgeData, graph.tagColorConfig.edgeTags)}
					<div
						class="edge"
						data-edge-id={id}
						data-source-node-id={entry.edgeData.sourceNodeId}
						data-target-node-id={entry.edgeData.targetNodeId}
						data-edge-exiting="true"
						data-edge-opacity={edgeOpacity}
						style={`${edgeStyle(sourcePos, targetPos)} --edge-background: ${edgeColor}; color: ${edgeColor}; --edge-stroke-width: ${EDGE_STROKE_WIDTH}px; opacity: ${edgeOpacity}; pointer-events: none;`}
					></div>
				{/if}
			{/each}
		</div>

		{#each visibleGraph.nodes as node (node.id)}
			{@const queryNodeState = queryStateForNode(node.id)}
			{#if queryNodeState?.role !== 'excluded'}
				{@const nodePos = graphLayout.posByNodeId[node.id] ?? CENTERED_POSITION}
				{@const nodeTargetScale = graphLayout.scaleByNodeId[node.id] ?? 1}
				{@const nodeEnterAnim = nodeEnterAnimations[node.id]}
				{@const nodeScale = nodeEnterAnim
					? nodeEnterScaleAt(nodeEnterAnim, layoutRuntime.animationNowMs)
					: nodeTargetScale}
				{@const baseNodeOpacity = nodeRenderOverrides?.[node.id]?.opacity ?? 1}
				{@const nodeOpacity =
					baseNodeOpacity *
					(revealWaveNodeOpacityByNodeId[node.id] ?? 1) *
					queryOpacity(queryNodeState)}
				<div
					class="node-wrapper"
					class:primary={primaryNodeId === node.id}
					class:focus-owned={focus.focusedNodeId === node.id}
					data-node-id={node.id}
					data-query-role={queryNodeState?.role}
					data-scale={nodeScale}
					data-node-opacity={nodeOpacity}
					data-x={nodePos.x}
					data-y={nodePos.y}
					style={`left: calc(50% + ${nodePos.x}px); top: calc(50% + ${nodePos.y}px); transform: translate(-50%, -50%) scale(${nodeScale}); opacity: ${nodeOpacity};`}
				>
					<Node
						nodeData={node}
						isTitleEditing={titleEditContext?.nodeId === node.id}
						borderSegments={nodeBorderSegments(node, graph.tagColorConfig.nodeTags)}
						spotlightColor={queryNodeState?.role === 'spotlight'
							? queryNodeState.spotlightColor
							: undefined}
						onTitleCommit={(title) => {
							const createdEdgeId = titleEditContext?.edgeId;
							const shouldUnpin = titleEditContext?.unpinOnCommit === true;
							titleEditContext = null;
							const committedGraph = commitInlineTitleSyntax(graph, node.id, title, createdEdgeId);
							const nextGraph = shouldUnpin
								? layoutRuntime.beginScaleChange(
										setNodePinned(committedGraph, node.id, false),
										node.id
									)
								: committedGraph;
							commitUserGraph(nextGraph);
						}}
					/>
				</div>
			{/if}
		{/each}
		{#each layoutRuntime.revealWavePreviousOnlyNodeIds as nodeId (nodeId)}
			{@const bufferedNode = nodeById[nodeId]}
			{#if bufferedNode}
				{@const nodePos = graph.posByNodeId[nodeId] ?? CENTERED_POSITION}
				{@const nodeScale =
					revealWavePreviousScaleByNodeId[nodeId] ?? resolvedLayoutSettings.minScale}
				{@const baseNodeOpacity = nodeRenderOverrides?.[nodeId]?.opacity ?? 1}
				{@const nodeOpacity = baseNodeOpacity * (revealWaveNodeOpacityByNodeId[nodeId] ?? 1)}
				<div
					class="node-wrapper"
					data-node-id={nodeId}
					data-scale={nodeScale}
					data-node-opacity={nodeOpacity}
					data-node-reveal-buffer="true"
					data-x={nodePos.x}
					data-y={nodePos.y}
					style={`left: calc(50% + ${nodePos.x}px); top: calc(50% + ${nodePos.y}px); transform: translate(-50%, -50%) scale(${nodeScale}); opacity: ${nodeOpacity}; pointer-events: none;`}
				>
					<Node
						nodeData={bufferedNode}
						isTitleEditing={false}
						borderSegments={nodeBorderSegments(bufferedNode, graph.tagColorConfig.nodeTags)}
					/>
				</div>
			{/if}
		{/each}
		{#each exitingOnlyNodes as [id, entry] (id)}
			{@const exitScale = exitingNodeScaleAt(entry, layoutRuntime.animationNowMs)}
			{@const nodeOpacity = nodeRenderOverrides?.[id]?.opacity ?? 1}
			<div
				class="node-wrapper"
				data-node-id={id}
				data-scale={exitScale}
				data-node-opacity={nodeOpacity}
				data-node-exiting="true"
				data-x={entry.x}
				data-y={entry.y}
				style={`left: calc(50% + ${entry.x}px); top: calc(50% + ${entry.y}px); transform: translate(-50%, -50%) scale(${exitScale}); opacity: ${nodeOpacity}; pointer-events: none;`}
			>
				<Node
					nodeData={entry.nodeData}
					isTitleEditing={false}
					borderSegments={nodeBorderSegments(entry.nodeData, graph.tagColorConfig.nodeTags)}
				/>
			</div>
		{/each}
	</Stage>

	{#if actionMenu && actionMenuNode}
		<NodeActionMenu
			node={actionMenuNode}
			position={actionMenu.position}
			onTogglePinned={() => {
				toggleNodePinned(actionMenuNode.id);
				closeOverlays();
			}}
			onEdit={() => openEditSheet(actionMenuNode.id)}
			onFocus={() => focus.openFocus(actionMenuNode)}
			onDelete={() => deleteNode(actionMenuNode.id)}
			onClose={() => (actionMenu = null)}
		/>
	{/if}

	{#if editNode}
		<NodeEditSheet
			node={editNode}
			nodes={graph.nodes}
			edges={graph.edges}
			assets={graph.assets ?? {}}
			onSave={(content: { title: string; description: string; tags: string[] }) =>
				saveNodeContent(editNode.id, content)}
			onAddImage={(file, details) => addImageToNode(editNode.id, file, details)}
			onSaveImage={(assetId, details) => saveNodeImage(editNode.id, assetId, details)}
			onMoveImage={(fromIndex, direction) => moveNodeImage(editNode.id, fromIndex, direction)}
			onDeleteImage={(assetId) => void deleteNodeImage(editNode.id, assetId)}
			onSaveEdge={saveEdgeContent}
			onCancel={() => (editNodeId = null)}
			onTogglePinned={() => toggleNodePinned(editNode.id)}
			onDelete={() => deleteNode(editNode.id)}
		/>
	{/if}

	{#snippet focusFrame({ level, borderRadiusPx, borderWidthPx, content }: StackFrameArgs)}
		{#if level.subjectKind === 'image'}
			<div
				class="focus-image-frame"
				style={`border-radius: ${borderRadiusPx}px; border-width: ${borderWidthPx}px;`}
			>
				{@render content()}
			</div>
		{:else}
			{@const frameNode = nodeById[level.subjectId]}
			{#if frameNode}
				{@const segments = nodeBorderSegments(frameNode, graph.tagColorConfig.nodeTags)}
				<NodeChrome
					diameterPx={NODE_DIAMETER_PX}
					{borderRadiusPx}
					{borderWidthPx}
					pinnedBorderWidthPx={borderWidthPx}
					pinned={frameNode.pinned ?? false}
					hasTagBorder={segments.length > 0}
					tagBorderBackground={tagBorderBackground(segments)}
					detailsMode
					surfaceBackground="#ffffff"
				>
					{@render content()}
				</NodeChrome>
			{/if}
		{/if}
	{/snippet}

	{#snippet focusCompact(level: FocusLevel)}
		{#if level.subjectKind === 'image'}
			<div class="focus-compact-fill">
				<img class="focus-image-thumb" src={level.subjectSrc} alt={level.subjectAlt ?? ''} />
			</div>
		{:else}
			{@const compactNode = nodeById[level.subjectId]}
			{#if compactNode}
				<div class="focus-compact-fill">
					<NodeCompactContent
						title={compactNode.title}
						diameterPx={NODE_DIAMETER_PX}
						fontSizePx={NODE_TEXT_FONT_SIZE}
						detailsMode
					/>
				</div>
			{/if}
		{/if}
	{/snippet}

	{#snippet focusDetails(level: FocusLevel)}
		{#if level.subjectKind === 'image'}
			<div
				class="focus-image-details"
				data-focus-subject-id={level.subjectId}
				data-subject-kind="image"
			>
				<img class="focus-image-full" src={level.subjectSrc} alt={level.subjectAlt ?? ''} />
			</div>
		{:else}
			{@const detailsNode = nodeById[level.subjectId]}
			{#if detailsNode}
				<div class="focus-surface" data-focus-subject-id={level.subjectId}>
					<NodeDetailsLayer title={detailsNode.title} detailsTitleId={DETAILS_TITLE_ID} detailsMode>
						<NodeDetailsContent
							node={detailsNode}
							assets={graph.assets ?? {}}
							{assetStore}
							{assetScope}
						/>
					</NodeDetailsLayer>
				</div>
			{/if}
		{/if}
	{/snippet}

	{#if focus.isFocused}
		<div
			class="focus-root"
			class:reduced-motion={reduceMotion}
			role={focus.dialogOpen ? 'dialog' : undefined}
			aria-modal={focus.dialogOpen ? 'true' : undefined}
			aria-labelledby={focus.dialogOpen ? DETAILS_TITLE_ID : undefined}
			tabindex="-1"
			data-focus-depth={focus.depth}
			data-exit-scrub={focus.exitScrubActive ? 'true' : undefined}
			onkeydown={(event) => {
				if (event.key === 'Escape') focus.closeFocus();
			}}
		>
			{#if focus.dialogOpen}
				<button
					class="focus-close-button"
					type="button"
					aria-label="Close node focus"
					onclick={() => focus.closeFocus()}
				>
					Close
				</button>
			{/if}
			<DeepZoomStack
				levels={focus.levels}
				{reduceMotion}
				entryGestureIdleMs={focus.entryGestureIdleMs}
				entryGestureMaxMs={APP_CONFIG.multigraph.focus.entryGestureMaxMs}
				geometryForLevel={geometryForFocusLevel}
				baseSizeForLevel={baseSizeForFocusLevel}
				frame={focusFrame}
				compact={focusCompact}
				details={focusDetails}
				onAscend={(level, delta) => focus.handleExit(level, delta)}
				onDescend={(input) => focus.descendToImage(input)}
			/>
		</div>
	{/if}

	{#if duplicateEdgeConfirm}
		{@const confirmEdgeId = duplicateEdgeConfirm.edgeId}
		<DuplicateEdgeDialog
			edgeIdentifier={duplicateEdgeIdentifier(graph, confirmEdgeId)}
			onCancel={() => (duplicateEdgeConfirm = null)}
			onConfirm={() => {
				const removedEdge = graph.edges.find((e) => e.id === confirmEdgeId) ?? null;
				if (removedEdge) {
					severedBeaconPreference = [removedEdge.sourceNodeId, removedEdge.targetNodeId];
				}
				const nextGraph = removeEdge(graph, confirmEdgeId);
				const nextHops = hopsFromPinned(nextGraph);
				const endpointIds = removedEdge ? [removedEdge.sourceNodeId, removedEdge.targetNodeId] : [];
				const survivorId = endpointIds.find((id) => Number.isFinite(nextHops[id]));
				const seversComponent =
					survivorId !== undefined && endpointIds.some((id) => !Number.isFinite(nextHops[id]));

				if (seversComponent && survivorId !== undefined) {
					// The removal cut a component off from every pinned node. Play the
					// reveal wave (as unpinning does) so the severed side fades down to
					// its beacon; the wave also renders the removed edge fading out, so
					// the exiting-buffer fade below must be skipped to avoid drawing the
					// edge twice.
					edgeEnterAnimations = Object.fromEntries(
						Object.entries(edgeEnterAnimations).filter(([k]) => k !== confirmEdgeId)
					);
					commitUserGraph(layoutRuntime.beginScaleChange(nextGraph, survivorId));
					duplicateEdgeConfirm = null;
					return;
				}

				const durationMs = resolvedLayoutSettings.enterExitDurationMs;
				if (durationMs > 0 && removedEdge) {
					const nowMs = layoutRuntime.now();
					const enterAnim = edgeEnterAnimations[confirmEdgeId];
					const fromOpacity = enterAnim ? edgeOpacityAt(enterAnim, nowMs) : 1;
					edgeEnterAnimations = Object.fromEntries(
						Object.entries(edgeEnterAnimations).filter(([k]) => k !== confirmEdgeId)
					);
					internalExitingBuffer = cancelExitingEdge(internalExitingBuffer, confirmEdgeId);
					internalExitingBuffer = addExitingEdge(internalExitingBuffer, confirmEdgeId, {
						edgeData: removedEdge,
						fromOpacity,
						startedAtMs: nowMs,
						durationMs
					});
					layoutRuntime.start();
				}
				commitUserGraph(layoutRuntime.relaxAfterMutation(nextGraph));
				duplicateEdgeConfirm = null;
			}}
		/>
	{/if}

	{#if tagColorLegendOpen}
		<TagColorLegend
			tags={legendTags}
			onColorChange={updateTagColor}
			onDelete={deleteLegendTag}
			onClose={() => (tagColorLegendOpen = false)}
		/>
	{/if}

	{#if graphQueryPanelOpen}
		<GraphQueryPanel
			query={graphQueryText}
			tags={legendTags}
			result={graphQueryResult}
			activeRegionIndex={activeQueryRegionIndex}
			onQueryChange={(query) => {
				graphQueryText = query;
				graphQueryPreviewText = null;
				activeQueryRegionIndex = 0;
			}}
			onPreviewQueryChange={(query) => (graphQueryPreviewText = query)}
			onRegionNavigate={navigateQueryRegion}
			onClose={() => {
				graphQueryPanelOpen = false;
				graphQueryPreviewText = null;
			}}
		/>
	{/if}
</div>

<style>
	.graph {
		position: relative;
		width: 100vw;
		height: 100vh;
		overflow: hidden;
		touch-action: none;
	}

	.node-wrapper {
		position: absolute;
	}

	.node-wrapper.focus-owned {
		visibility: hidden;
	}

	.focus-root {
		position: fixed;
		inset: 0;
		z-index: 60;
		pointer-events: none;
		touch-action: none;
	}

	.focus-root.reduced-motion :global(.deep-zoom-layer) {
		transition: none;
	}

	/* NodeChrome's `.circle` is the single bordered box; its absolutely
	   positioned content layers anchor to it. */
	.focus-root :global(.deep-zoom-layer .circle) {
		position: relative;
		box-shadow: none;
	}

	.focus-compact-fill {
		display: grid;
		place-items: center;
		width: 100%;
		height: 100%;
	}

	.focus-surface {
		width: 100%;
		height: 100%;
	}

	/* The single bordered box for an image level (mirrors the node frame's
	   NodeChrome, but neutral: images bring their own subject). */
	.focus-image-frame {
		position: absolute;
		inset: 0;
		box-sizing: border-box;
		border-style: solid;
		border-color: #334155;
		background: #ffffff;
		overflow: hidden;
	}

	.focus-image-thumb {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.focus-image-details {
		width: 100%;
		height: 100%;
	}

	/* Rendered at contain size in the details layer; scaled ONLY by the layer's
	   content transform and the ZoomWorld transform — never a manual second
	   scale — so the image is crisp at fit. */
	.focus-image-full {
		width: 100%;
		height: 100%;
		object-fit: contain;
		user-select: none;
		-webkit-user-drag: none;
	}

	.focus-close-button {
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
		pointer-events: auto;
	}

	.toolbar-button {
		position: absolute;
		z-index: 25;
		bottom: 0.75rem;
		border: 0;
		border-radius: 999px;
		padding: 0.625rem 0.875rem;
		background: #f8fafc;
		color: #0f172a;
		font: inherit;
		box-shadow: 0 8px 24px rgb(15 23 42 / 18%);
	}

	.tag-color-button {
		right: 0.75rem;
	}

	.graph-query-button {
		left: 0.75rem;
	}

	.edges {
		position: absolute;
		inset: 0;
		overflow: visible;
		pointer-events: none;
	}

	.edge {
		position: absolute;
		height: var(--edge-stroke-width);
		transform-origin: left center;
	}

	.edge::before {
		position: absolute;
		inset: 0;
		width: 100%;
		background: var(--edge-background);
		content: '';
	}

	.edge.directed::before {
		width: calc(100% - var(--edge-arrow-length) / 2);
	}

	.edge.boundary::before {
		--edge-dash-length: 8px;
		--edge-dash-gap: 6px;

		mask-image: repeating-linear-gradient(
			to right,
			#000 0 var(--edge-dash-length),
			transparent var(--edge-dash-length) calc(var(--edge-dash-length) + var(--edge-dash-gap))
		);
	}

	.edge.directed::after {
		position: absolute;
		right: 0;
		top: 50%;
		width: 0;
		height: 0;
		border-top: var(--edge-arrow-half-height) solid transparent;
		border-bottom: var(--edge-arrow-half-height) solid transparent;
		border-left: var(--edge-arrow-length) solid currentColor;
		color: inherit;
		content: '';
		transform: translateY(-50%);
	}

	.edge.query-spotlight::before {
		box-shadow:
			0 0 0 4px color-mix(in srgb, var(--edge-spotlight-color) 42%, transparent),
			0 0 18px color-mix(in srgb, var(--edge-spotlight-color) 58%, transparent);
	}
</style>
