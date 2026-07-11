<script lang="ts">
	import { untrack } from 'svelte';
	import Node from '$lib/components/ui/Node/Node.svelte';
	import DuplicateEdgeDialog from './DuplicateEdgeDialog.svelte';
	import GraphQueryPanel from './GraphQueryPanel.svelte';
	import NodeDetailsContent from './NodeDetailsContent.svelte';
	import NodeActionMenu from './NodeActionMenu.svelte';
	import NodeEditSheet from './NodeEditSheet.svelte';
	import NodeFocusSurface from './NodeFocusSurface.svelte';
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
	import { FocusRuntime } from './lib/focusRuntime.svelte.js';
	import {
		focalNodeForPoint,
		nodeScreenCircle,
		type NodeFocusCandidate,
		type NodeFocusMorphSource,
		type ViewTransform
	} from './lib/nodeFocus.js';
	import type { FocusEntryBoundaryCandidate } from './lib/focusEntryBoundary.js';
	import type { Rect } from './lib/zoomBoundary.js';

	const CENTERED_POSITION: Point = { x: 0, y: 0 };
	const FOCUS_TRANSITION_MS = APP_CONFIG.multigraph.focus.entryTransitionMs;

	interface NodeRenderMetrics {
		rect: Rect;
		borderWidthPx?: number;
	}

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
	let lastPinnedNodeId = $state<string | null>(null);
	let lastSyncedGeneration = $state(-1);
	let lastInitialTitleEditKey = $state('');
	let stageViewState = $state<ViewState>({ panX: 0, panY: 0, scale: 1 });
	const stageScale = $derived(stageViewState.scale);
	let focusPreviewNodeId = $state<string | null>(null);
	let focusPreviewProgress = $state(0);
	let focusPreviewEffectiveScale = $state(1);
	let pendingFocusCommitNodeId = $state<string | null>(null);
	let reduceMotion = $derived(prefersReducedMotion());
	let focusExiting = $state(false);
	let focusExitSourceRect = $state<Rect | null>(null);
	let focusExitBorderWidthPx = $state<number | undefined>(undefined);
	let focusEntryGestureIdleMs = $state(0);
	let stageEntryGestureGateRequest = $state<{
		id: number;
		direction: EntryGestureDirection;
		idleMs: number;
		maxMs: number;
	} | null>(null);
	let stageEntryGestureGateRequestId = $state(0);
	const focusRuntime = new FocusRuntime();
	let focusExitTimeoutId: ReturnType<typeof setTimeout> | null = null;
	const activeFocusLevel = $derived(focusRuntime.activeLevel);

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
		getFallbackAnchorNodeId: () => lastPinnedNodeId,
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
	const hopsByNodeId = $derived(hopsFromPinned(graph));
	const visibleNodeIds = $derived(
		visibleNodeIdsForPinnedNeighborhood(graph, hopsByNodeId, {
			displayedLayers: resolvedLayoutSettings.displayedLayers,
			fallbackAnchorNodeId: lastPinnedNodeId
		})
	);
	const visibleGraph = $derived(graphWithVisibleNodes(graph, visibleNodeIds));
	const edgeVisibility = $derived(
		edgeVisibilityForPinnedNeighborhood(graph, hopsByNodeId, {
			displayedLayers: resolvedLayoutSettings.displayedLayers,
			fallbackAnchorNodeId: lastPinnedNodeId
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
	const focusedNode = $derived.by(() =>
		focusRuntime.focusedNodeId
			? (graph.nodes.find((node) => node.id === focusRuntime.focusedNodeId) ?? null)
			: null
	);

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
		graph = withSettledGraphPositions(incoming, { settings });
		primaryNodeId = primary;
		lastPinnedNodeId =
			incoming.nodes.find((node) => node.pinned)?.id ??
			incoming.nodes.find((node) => node.id === primary)?.id ??
			null;
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
			if (event.key === 'Escape' && focusRuntime.isFocused) {
				closeFocus();
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
		const nodeIds = graph.nodes.map((node) => node.id);
		const pinnedIds = graph.nodes.filter((node) => node.pinned).map((node) => node.id);
		if (pinnedIds.length > 0) {
			if (!lastPinnedNodeId || !pinnedIds.includes(lastPinnedNodeId)) {
				lastPinnedNodeId = pinnedIds[0];
			}
			return;
		}
		if (lastPinnedNodeId && nodeIds.includes(lastPinnedNodeId)) return;
		lastPinnedNodeId = nodeIds[Math.floor(Math.random() * nodeIds.length)] ?? null;
	});

	$effect(() => {
		return () => {
			clearFocusExitTimeout();
			layoutRuntime.stop();
		};
	});

	/** Resolve node at client coordinates (circle hit-test). Testable by passing a custom getNodeAt from outside if needed. */
	function getNodeAt(clientX: number, clientY: number): NodeData | null {
		const nodeElements = Array.from(
			graphRef?.querySelectorAll('.node-wrapper') ?? []
		).reverse() as HTMLElement[];
		const nodeEl =
			nodeElements.find((el) => {
				const circle = el.querySelector('.circle');
				if (!circle) return false;
				const rect = (circle as HTMLElement).getBoundingClientRect();
				return isPointInCircle(
					clientX,
					clientY,
					rect.left + rect.width / 2,
					rect.top + rect.height / 2,
					effectiveHitRadius(Math.min(rect.width, rect.height) / 2, MIN_NODE_HIT_RADIUS)
				);
			}) ?? null;
		if (!nodeEl) return null;
		const circle = nodeEl.querySelector('.circle');
		if (!circle) return null;
		const rect = (circle as HTMLElement).getBoundingClientRect();
		const centerX = rect.left + rect.width / 2;
		const centerY = rect.top + rect.height / 2;
		const radius = effectiveHitRadius(Math.min(rect.width, rect.height) / 2, MIN_NODE_HIT_RADIUS);
		if (!isPointInCircle(clientX, clientY, centerX, centerY, radius)) return null;
		const nodeId = nodeEl.dataset.nodeId ?? null;
		if (!nodeId) return null;
		return graph.nodes.find((n) => n.id === nodeId) ?? null;
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
		lastPinnedNodeId = node.id;

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

	function openFocus(
		node: NodeData,
		source: NodeFocusMorphSource | null = null,
		entryGestureIdleMs = 0
	) {
		closeOverlays();
		clearFocusExitTimeout();
		focusExiting = false;
		clearFocusExitTarget();
		clearFocusPreview();
		pendingFocusCommitNodeId = null;
		focusEntryGestureIdleMs = entryGestureIdleMs;
		const sourceMetrics = source ? null : nodeRenderMetricsForNodeId(node.id);
		const sourceRect = source ? rectFromMorphSource(source) : sourceMetrics?.rect;
		const borderWidthPx = source?.borderWidthPx ?? sourceMetrics?.borderWidthPx;
		const fillRect = focusFillRect();
		focusRuntime.open(node, sourceRect ?? fillRect, fillRect, {
			borderWidthPx
		});
	}

	function closeFocus() {
		if (!focusRuntime.isFocused || focusExiting) return;
		ensureFocusExitTarget();
		focusRuntime.setProgress(0, 'exiting');
		if (reduceMotion || FOCUS_TRANSITION_MS <= 0 || typeof window === 'undefined') {
			finishCloseFocus();
			return;
		}
		focusExiting = true;
		focusExitTimeoutId = setTimeout(finishCloseFocus, FOCUS_TRANSITION_MS);
	}

	function commitFocusExitFromBoundary() {
		if (!focusRuntime.isFocused || focusExiting) return;
		ensureFocusExitTarget();
		focusRuntime.setProgress(0, 'exiting');
		focusExiting = true;
		if (typeof requestAnimationFrame === 'function') {
			requestAnimationFrame(() => requestAnimationFrame(finishCloseFocus));
		} else {
			finishCloseFocus();
		}
	}

	function clearFocusExitTimeout() {
		if (focusExitTimeoutId === null) return;
		clearTimeout(focusExitTimeoutId);
		focusExitTimeoutId = null;
	}

	function finishCloseFocus() {
		clearFocusExitTimeout();
		focusRuntime.close();
		focusEntryGestureIdleMs = 0;
		focusExiting = false;
		clearFocusExitTarget();
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

	function focusCandidateForPoint(
		focalPoint: Point,
		view: ViewTransform
	): NodeFocusCandidate | null {
		if (!graphRef) return null;
		return focalNodeForPoint(focusCandidates(), focalPoint, graphRef.getBoundingClientRect(), view);
	}

	function focusEntryBoundaryCandidateForPoint(input: {
		focalPoint: Point;
		requestedScale: number;
		viewState: ViewTransform;
	}): FocusEntryBoundaryCandidate | null {
		if (input.requestedScale <= input.viewState.scale || focusRuntime.isFocused || !graphRef) {
			return null;
		}
		const candidate = focusCandidateForPoint(input.focalPoint, input.viewState);
		if (!candidate) return null;
		return {
			nodeId: candidate.node.id,
			position: candidate.position,
			radius: candidate.radius
		};
	}

	function captureFocusMorphSource(
		candidate: NodeFocusCandidate,
		view: ViewTransform
	): NodeFocusMorphSource | null {
		if (!graphRef) return null;
		const rect = graphRef.getBoundingClientRect();
		const circle = nodeScreenCircle(
			candidate.node.id,
			candidate.position,
			candidate.radius,
			rect,
			view
		);
		return {
			nodeId: candidate.node.id,
			left: circle.center.x - circle.radius,
			top: circle.center.y - circle.radius,
			width: circle.radius * 2,
			height: circle.radius * 2,
			borderWidthPx: estimatedBorderWidthPx(candidate, view)
		};
	}

	function clearFocusPreview() {
		focusPreviewNodeId = null;
		focusPreviewProgress = 0;
		focusPreviewEffectiveScale = 1;
	}

	function setFocusPreview(candidate: NodeFocusCandidate, progress: number, view: ViewTransform) {
		focusPreviewNodeId = candidate.node.id;
		focusPreviewProgress = progress;
		focusPreviewEffectiveScale = focusPreviewScaleForCandidate(candidate, view);
	}

	function focusPreviewSizeForNode(nodeId: string): { widthPx: number; heightPx: number } | null {
		if (focusPreviewNodeId !== nodeId || focusPreviewProgress <= 0) return null;
		const fillRect = focusFillRect();
		const effectiveScale = Math.max(0.001, focusPreviewEffectiveScale);
		return {
			widthPx: Math.max(1, fillRect.width / effectiveScale),
			heightPx: Math.max(1, fillRect.height / effectiveScale)
		};
	}

	function focusPreviewScaleForCandidate(
		candidate: NodeFocusCandidate,
		view: ViewTransform
	): number {
		const baseRadius = Math.max(0.001, resolvedLayoutSettings.baseRadius);
		const nodeScale = candidate.radius / baseRadius;
		return Math.max(0.001, view.scale * nodeScale);
	}

	function estimatedBorderWidthPx(candidate: NodeFocusCandidate, view: ViewTransform): number {
		const baseBorderWidth = candidate.node.pinned
			? APP_CONFIG.multigraph.pinnedNodeBorderWidthPx
			: APP_CONFIG.multigraph.nodeBorderWidthPx;
		return roundedBorderWidthPx(baseBorderWidth * focusPreviewScaleForCandidate(candidate, view));
	}

	function rectFromMorphSource(source: NodeFocusMorphSource): Rect {
		return {
			left: source.left,
			top: source.top,
			width: source.width,
			height: source.height
		};
	}

	function morphSourceFromMetrics(
		nodeId: string,
		metrics: NodeRenderMetrics
	): NodeFocusMorphSource {
		return morphSourceFromRect(nodeId, metrics.rect, metrics.borderWidthPx);
	}

	function morphSourceFromRect(
		nodeId: string,
		rect: Rect,
		borderWidthPx?: number
	): NodeFocusMorphSource {
		return {
			nodeId,
			left: rect.left,
			top: rect.top,
			width: rect.width,
			height: rect.height,
			borderWidthPx
		};
	}

	function nodeRenderMetricsForNodeId(nodeId: string): NodeRenderMetrics | null {
		const wrappers = Array.from(graphRef?.querySelectorAll('.node-wrapper') ?? []) as HTMLElement[];
		const wrapper = wrappers.find((element) => element.dataset.nodeId === nodeId) ?? null;
		const circle = wrapper?.querySelector('.circle');
		if (!(circle instanceof HTMLElement)) return null;
		const rect = circle.getBoundingClientRect();
		return {
			rect: {
				left: rect.left,
				top: rect.top,
				width: rect.width,
				height: rect.height
			},
			borderWidthPx: measuredBorderWidthPx(circle, rect)
		};
	}

	function measuredBorderWidthPx(circle: HTMLElement, rect: DOMRect): number | undefined {
		const cssBorderWidth = Number.parseFloat(getComputedStyle(circle).borderTopWidth);
		if (!Number.isFinite(cssBorderWidth) || cssBorderWidth <= 0) return undefined;
		const untransformedWidth = circle.offsetWidth;
		const visualScale = untransformedWidth > 0 ? rect.width / untransformedWidth : 1;
		return roundedBorderWidthPx(cssBorderWidth * visualScale);
	}

	function roundedBorderWidthPx(borderWidthPx: number): number {
		return Math.max(1, Math.round(borderWidthPx));
	}

	function clearFocusExitTarget() {
		focusExitSourceRect = null;
		focusExitBorderWidthPx = undefined;
	}

	function ensureFocusExitTarget() {
		if (focusExitSourceRect || !focusRuntime.focusedNodeId) return;
		const metrics = nodeRenderMetricsForNodeId(focusRuntime.focusedNodeId);
		if (!metrics) return;
		focusExitSourceRect = metrics.rect;
		focusExitBorderWidthPx = metrics.borderWidthPx;
	}

	function focusFillRect(): Rect {
		const rect = graphRef?.getBoundingClientRect();
		const width = rect?.width ?? (typeof window === 'undefined' ? 800 : window.innerWidth);
		const height = rect?.height ?? (typeof window === 'undefined' ? 600 : window.innerHeight);
		const left = rect?.left ?? 0;
		const top = rect?.top ?? 0;
		return {
			left,
			top,
			width: Math.max(1, width),
			height: Math.max(1, height)
		};
	}

	function handleBlockedStageZoom(input: {
		direction: 'in' | 'out';
		focalPoint: Point;
		blockedFactor: number;
		boundaryProgress?: number;
		committed?: boolean;
		nodeId?: string;
		viewState: ViewTransform;
	}) {
		if (focusRuntime.isFocused || !graphRef) return;
		const candidate =
			(input.nodeId
				? focusCandidates().find((entry) => entry.node.id === input.nodeId)
				: focusCandidateForPoint(input.focalPoint, input.viewState)) ?? null;
		if (!candidate) {
			clearFocusPreview();
			return;
		}
		const progress = Math.min(1, Math.max(0, input.boundaryProgress ?? 0));
		if (progress <= 0) {
			if (!input.nodeId || input.nodeId === focusPreviewNodeId) {
				clearFocusPreview();
			}
			return;
		}
		if (progress >= 1 || input.committed === true) {
			setFocusPreview(candidate, 1, input.viewState);
			commitFocusFromCandidate(candidate, input.viewState);
			return;
		}
		setFocusPreview(candidate, progress, input.viewState);
	}

	function commitFocusFromCandidate(candidate: NodeFocusCandidate, fallbackView: ViewTransform) {
		if (pendingFocusCommitNodeId !== null) return;
		pendingFocusCommitNodeId = candidate.node.id;
		const fallbackSource = captureFocusMorphSource(candidate, fallbackView);
		const commit = () => {
			if (pendingFocusCommitNodeId !== candidate.node.id || focusRuntime.isFocused) {
				pendingFocusCommitNodeId = null;
				return;
			}
			const measuredMetrics = nodeRenderMetricsForNodeId(candidate.node.id);
			openFocus(
				candidate.node,
				measuredMetrics
					? morphSourceFromMetrics(candidate.node.id, measuredMetrics)
					: fallbackSource,
				APP_CONFIG.multigraph.focus.entryGestureIdleMs
			);
			pendingFocusCommitNodeId = null;
		};
		if (typeof requestAnimationFrame === 'function') {
			requestAnimationFrame(commit);
		} else {
			commit();
		}
	}

	function handleFocusZoomOutBoundary(delta: number) {
		if (delta <= 0) {
			clearFocusExitTarget();
			focusRuntime.setProgress(1, 'active');
			return;
		}
		if (delta >= 1) {
			armStageEntryGestureGate('out');
			commitFocusExitFromBoundary();
			return;
		}
		ensureFocusExitTarget();
		focusRuntime.setProgress(Math.max(0, 1 - delta), 'exiting');
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
		lastPinnedNodeId = nodeId;
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

		if (lastPinnedNodeId === nodeId) {
			lastPinnedNodeId = graph.nodes.find((candidate) => candidate.id !== nodeId)?.id ?? null;
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
	class:focus-active={focusRuntime.isFocused && !focusExiting}
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
		{focusEntryBoundaryCandidateForPoint}
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
		onBlockedZoom={handleBlockedStageZoom}
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
				{@const focusPreviewSize = focusPreviewSizeForNode(node.id)}
				<div
					class="node-wrapper"
					class:primary={primaryNodeId === node.id}
					class:focus-owned={focusRuntime.focusedNodeId === node.id}
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
						detailsProgress={focusPreviewNodeId === node.id ? focusPreviewProgress : 0}
						detailsWidthPx={focusPreviewSize?.widthPx}
						detailsHeightPx={focusPreviewSize?.heightPx}
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
					>
						{#if focusPreviewSize}
							<NodeDetailsContent {node} assets={graph.assets ?? {}} {assetStore} {assetScope} />
						{/if}
					</Node>
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
			onFocus={() => openFocus(actionMenuNode)}
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

	{#if focusedNode && activeFocusLevel}
		<NodeFocusSurface
			node={focusedNode}
			assets={graph.assets ?? {}}
			borderSegments={nodeBorderSegments(focusedNode, graph.tagColorConfig.nodeTags)}
			detailsProgress={activeFocusLevel.morphProgress}
			{assetStore}
			{assetScope}
			{reduceMotion}
			sourceRect={activeFocusLevel.sourceRect}
			exitSourceRect={focusExitSourceRect}
			fillRect={activeFocusLevel.fillRect}
			borderWidthPx={focusExitBorderWidthPx ?? activeFocusLevel.borderWidthPx}
			entryGestureIdleMs={focusEntryGestureIdleMs}
			entryGestureMaxMs={APP_CONFIG.multigraph.focus.entryGestureMaxMs}
			onClose={closeFocus}
			onZoomOutBoundary={handleFocusZoomOutBoundary}
		/>
	{/if}

	{#if duplicateEdgeConfirm}
		{@const confirmEdgeId = duplicateEdgeConfirm.edgeId}
		<DuplicateEdgeDialog
			edgeIdentifier={duplicateEdgeIdentifier(graph, confirmEdgeId)}
			onCancel={() => (duplicateEdgeConfirm = null)}
			onConfirm={() => {
				const durationMs = resolvedLayoutSettings.enterExitDurationMs;
				if (durationMs > 0) {
					const edgeToRemove = graph.edges.find((e) => e.id === confirmEdgeId) ?? null;
					if (edgeToRemove) {
						const nowMs = layoutRuntime.now();
						const enterAnim = edgeEnterAnimations[confirmEdgeId];
						const fromOpacity = enterAnim ? edgeOpacityAt(enterAnim, nowMs) : 1;
						edgeEnterAnimations = Object.fromEntries(
							Object.entries(edgeEnterAnimations).filter(([k]) => k !== confirmEdgeId)
						);
						internalExitingBuffer = cancelExitingEdge(internalExitingBuffer, confirmEdgeId);
						internalExitingBuffer = addExitingEdge(internalExitingBuffer, confirmEdgeId, {
							edgeData: edgeToRemove,
							fromOpacity,
							startedAtMs: nowMs,
							durationMs
						});
						layoutRuntime.start();
					}
				}
				commitUserGraph(layoutRuntime.relaxAfterMutation(removeEdge(graph, confirmEdgeId)));
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
