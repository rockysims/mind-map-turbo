<script lang="ts">
	import { untrack } from 'svelte';
	import Node from '$lib/components/ui/Node/Node.svelte';
	import DuplicateEdgeDialog from './DuplicateEdgeDialog.svelte';
	import NodeActionMenu from './NodeActionMenu.svelte';
	import NodeEditSheet from './NodeEditSheet.svelte';
	import Stage from './Stage.svelte';
	import TagColorLegend from './TagColorLegend.svelte';
	import type { NodeData } from '../types/node';
	import type { MultigraphData, Point, TagColorNamespace } from '../types/multigraph';
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
		addNode,
		commitInlineTitleSyntax,
		deleteTagEverywhere,
		duplicateEdgeIdentifier,
		findExistingEdge,
		moveNode,
		removeEdge,
		removeNode,
		setTagColor,
		togglePinned,
		updateEdge,
		updateNodeContent
	} from './lib/graph.js';
	import { deriveGraphLayout, withSettledGraphPositions } from './lib/graphLayout.js';
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

	const CENTERED_POSITION: Point = { x: 0, y: 0 };

	let {
		multigraphData = {
			nodes: [],
			edges: [],
			posByNodeId: {},
			tagColorConfig: { nodeTags: {}, edgeTags: {} }
		},
		graphGeneration = 0,
		defaultPrimaryNodeId = '',
		layoutSettings = {},
		initialViewState,
		onMultigraphChange,
		onViewStateChange,
		nodeRenderOverrides,
		edgeRenderOverrides,
		exitingBuffer
	}: {
		multigraphData: MultigraphData;
		graphGeneration?: number;
		defaultPrimaryNodeId?: string;
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
	} = $props();

	let graph = $state<MultigraphData>({
		nodes: [],
		edges: [],
		posByNodeId: {},
		tagColorConfig: { nodeTags: {}, edgeTags: {} }
	});
	let primaryNodeId = $state('');
	let activeDragNodeId = $state<string | null>(null);
	let editNodeId = $state<string | null>(null);
	let actionMenu = $state<{ nodeId: string; position: Point } | null>(null);
	let duplicateEdgeConfirm = $state<{ edgeId: string } | null>(null);
	let titleEditContext = $state<{ nodeId: string; edgeId?: string } | null>(null);
	let tagColorLegendOpen = $state(false);
	let graphRef = $state<HTMLElement | null>(null);
	let lastPinnedNodeId = $state<string | null>(null);
	let lastSyncedGeneration = $state(-1);
	let stageScale = $state(1);

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
			titleEditContext = { nodeId: newNode.id, edgeId: newEdge?.id };
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

	function closeOverlays() {
		actionMenu = null;
		editNodeId = null;
		duplicateEdgeConfirm = null;
		titleEditContext = null;
		tagColorLegendOpen = false;
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

	function commitUserGraph(nextGraph: MultigraphData) {
		graph = nextGraph;
		onMultigraphChange?.(nextGraph);
	}
</script>

<div
	class="graph"
	bind:this={graphRef}
	data-settling={layoutRuntime.isSettling ? 'true' : undefined}
	data-scale-change-focal={layoutRuntime.scaleAnchoredNodeIds[0]}
	data-scale-animation-active={layoutRuntime.hasActiveScaleAnimations ? 'true' : undefined}
	data-layered-relayout-active={layoutRuntime.isLayeredRelayoutActive ? 'true' : undefined}
	data-layered-relayout-state={layoutRuntime.relayoutStateKey ?? undefined}
>
	<button
		type="button"
		class="tag-color-button"
		aria-haspopup="dialog"
		aria-expanded={tagColorLegendOpen}
		onclick={() => {
			closeOverlays();
			tagColorLegendOpen = true;
		}}
	>
		Tag colors
	</button>

	<Stage
		{getNodeAt}
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
			stageScale = state.scale;
		}}
		{onViewStateChange}
	>
		<div class="edges" aria-hidden="true">
			{#each renderableEdgeVisibility as visibility (visibility.edge.id)}
				{@const edge = visibility.edge}
				{@const edgePoints = edgeRenderPoints(visibility, graphLayout, graph.posByNodeId)}
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
				{@const edgeColor = edgeStrokeColor(edge, graph.tagColorConfig.edgeTags)}
				{@const edgeEnterAnim = edgeEnterAnimations[edge.id]}
				{@const baseEdgeOpacity =
					edgeRenderOverrides?.[edge.id]?.opacity ??
					(edgeEnterAnim ? edgeOpacityAt(edgeEnterAnim, layoutRuntime.animationNowMs) : 1)}
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
					)}; color: ${edgeColor}; --edge-arrow-length: ${EDGE_ARROW_LENGTH * arrowScale}px; --edge-arrow-half-height: ${EDGE_ARROW_HALF_HEIGHT * arrowScale}px; --edge-stroke-width: ${EDGE_STROKE_WIDTH * strokeScale}px; opacity: ${edgeOpacity};`}
				></div>
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
			{@const nodePos = graphLayout.posByNodeId[node.id] ?? CENTERED_POSITION}
			{@const nodeTargetScale = graphLayout.scaleByNodeId[node.id] ?? 1}
			{@const nodeEnterAnim = nodeEnterAnimations[node.id]}
			{@const nodeScale = nodeEnterAnim
				? nodeEnterScaleAt(nodeEnterAnim, layoutRuntime.animationNowMs)
				: nodeTargetScale}
			{@const baseNodeOpacity = nodeRenderOverrides?.[node.id]?.opacity ?? 1}
			{@const nodeOpacity = baseNodeOpacity * (revealWaveNodeOpacityByNodeId[node.id] ?? 1)}
			<div
				class="node-wrapper"
				class:primary={primaryNodeId === node.id}
				data-node-id={node.id}
				data-scale={nodeScale}
				data-node-opacity={nodeOpacity}
				data-x={nodePos.x}
				data-y={nodePos.y}
				style={`left: calc(50% + ${nodePos.x}px); top: calc(50% + ${nodePos.y}px); transform: translate(-50%, -50%) scale(${nodeScale}); opacity: ${nodeOpacity};`}
			>
				<Node
					nodeData={node}
					isOpen={false}
					isTitleEditing={titleEditContext?.nodeId === node.id}
					borderSegments={nodeBorderSegments(node, graph.tagColorConfig.nodeTags)}
					onTitleCommit={(title) => {
						const createdEdgeId = titleEditContext?.edgeId;
						titleEditContext = null;
						commitUserGraph(commitInlineTitleSyntax(graph, node.id, title, createdEdgeId));
					}}
				/>
			</div>
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
						isOpen={false}
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
					isOpen={false}
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
			onDelete={() => deleteNode(actionMenuNode.id)}
			onClose={() => (actionMenu = null)}
		/>
	{/if}

	{#if editNode}
		<NodeEditSheet
			node={editNode}
			nodes={graph.nodes}
			edges={graph.edges}
			onSave={(content: { title: string; description: string; tags: string[] }) =>
				saveNodeContent(editNode.id, content)}
			onSaveEdge={saveEdgeContent}
			onCancel={() => (editNodeId = null)}
			onTogglePinned={() => toggleNodePinned(editNode.id)}
			onDelete={() => deleteNode(editNode.id)}
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

	.tag-color-button {
		position: absolute;
		z-index: 25;
		right: 0.75rem;
		bottom: 0.75rem;
		border: 0;
		border-radius: 999px;
		padding: 0.625rem 0.875rem;
		background: #0f172a;
		color: #ffffff;
		font: inherit;
		box-shadow: 0 8px 24px rgb(15 23 42 / 18%);
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
</style>
