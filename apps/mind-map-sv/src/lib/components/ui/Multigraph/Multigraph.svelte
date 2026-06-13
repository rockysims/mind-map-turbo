<script lang="ts">
	import { untrack } from 'svelte';
	import Node from '$lib/components/ui/Node/Node.svelte';
	import NodeActionMenu from './NodeActionMenu.svelte';
	import NodeEditSheet from './NodeEditSheet.svelte';
	import Stage from './Stage.svelte';
	import type { NodeData } from '../types/node';
	import type { MultigraphData, Point } from '../types/multigraph';
	import { effectiveHitRadius, isPointInCircle } from './lib/hitTest.js';
	import {
		addEdge,
		addNode,
		findExistingEdge,
		moveNode,
		normalizeNodeTitle,
		removeEdge,
		removeNode,
		togglePinned,
		updateNodeContent
	} from './lib/graph.js';
	import {
		deriveGraphLayout,
		relaxGraphPositionsStep,
		withRelaxedGraphPositions,
		withSettledGraphPositions
	} from './lib/graphLayout.js';
	import { hopsFromPinned } from './lib/layout.js';
	import type { LayoutSettings } from './lib/layoutSettings.js';
	import { withDefaultLayoutSettings } from './lib/layoutSettings.js';
	import {
		edgeVisibilityForPinnedNeighborhood,
		visibleNodeIdsForPinnedNeighborhood,
		type EdgeVisibility
	} from './lib/boundedVisibility.js';
	import {
		advanceLayeredRelayout,
		initialLayeredRelayoutState,
		participatingNodeIds,
		type LayeredRelayoutState,
		relayoutStateKey,
		relayoutMobilityByNodeId,
		shouldClearLayeredRelayoutState
	} from './lib/layeredRelayout.js';
	import {
		animatedScalesAt,
		createScaleAnimations,
		hasActiveScaleAnimations,
		pruneFinishedScaleAnimations,
		type NodeScaleAnimation
	} from './lib/scaleAnimation.js';
	import {
		scaleChangeLayoutAnchoredNodeIds,
		settleStateAfterScaleAnimationsEnd,
		settleStateForScaleChange,
		shouldClearScaleChangeFocalNode
	} from './lib/scaleChangeSettle.js';
	import { externalGraphSyncToken } from './lib/graphSync.js';
	import { MIN_NODE_HIT_RADIUS } from '$lib/constants.js';
	import type { ViewState } from '$lib/migrations.js';

	const CENTERED_POSITION: Point = { x: 0, y: 0 };
	type RenderableEdgeVisibility = Exclude<EdgeVisibility, { kind: 'hidden' }>;

	let {
		multigraphData = { nodes: [], edges: [], posByNodeId: {} },
		graphGeneration = 0,
		defaultPrimaryNodeId = '',
		layoutSettings = {},
		initialViewState,
		onMultigraphChange,
		onViewStateChange
	}: {
		multigraphData: MultigraphData;
		graphGeneration?: number;
		defaultPrimaryNodeId?: string;
		layoutSettings?: Partial<LayoutSettings>;
		initialViewState?: ViewState;
		onMultigraphChange?: (data: MultigraphData) => void;
		onViewStateChange?: (state: ViewState) => void;
	} = $props();

	let graph = $state<MultigraphData>({ nodes: [], edges: [], posByNodeId: {} });
	let primaryNodeId = $state('');
	let activeDragNodeId = $state<string | null>(null);
	let editNodeId = $state<string | null>(null);
	let actionMenu = $state<{ nodeId: string; position: Point } | null>(null);
	let duplicateEdgeConfirm = $state<{ edgeId: string } | null>(null);
	let titleEditNodeId = $state<string | null>(null);
	let graphRef = $state<HTMLElement | null>(null);
	let relaxationFrameId: number | null = null;
	let scaleAnimations = $state<Record<string, NodeScaleAnimation>>({});
	let animationNowMs = $state(0);
	let settleFramesRemaining = $state(0);
	let pendingPostScaleSettle = $state(false);
	let scaleChangeFocalNodeId = $state<string | null>(null);
	let layeredRelayoutState = $state<LayeredRelayoutState | null>(null);
	let lastRelayoutStateKey = $state<string | null>(null);
	let lastPinnedNodeId = $state<string | null>(null);
	let lastSyncedGeneration = $state(-1);

	const resolvedLayoutSettings = $derived(withDefaultLayoutSettings(layoutSettings));
	const animatedScaleByNodeId = $derived(animatedScalesAt(scaleAnimations, animationNowMs));
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
	const scaleChangeSettleState = $derived({
		pendingPostScaleSettle,
		settleFramesRemaining,
		hasActiveScaleAnimations: hasActiveScaleAnimations(scaleAnimations, animationNowMs)
	});
	const scaleAnchoredNodeIds = $derived(
		scaleChangeLayoutAnchoredNodeIds(scaleChangeFocalNodeId, scaleChangeSettleState)
	);
	const graphLayout = $derived(
		deriveGraphLayout(visibleGraph, graphLayoutOptions(visibleGraph, { relaxIterations: 0 }))
	);
	const editNode = $derived(graph.nodes.find((node) => node.id === editNodeId) ?? null);
	const actionMenuNode = $derived.by(() => {
		const menu = actionMenu;
		return menu ? (graph.nodes.find((node) => node.id === menu.nodeId) ?? null) : null;
	});

	$effect(() => {
		const generation = externalGraphSyncToken(graphGeneration);
		if (generation === lastSyncedGeneration) return;

		lastSyncedGeneration = generation;
		const incoming = untrack(() => multigraphData);
		const primary = untrack(() => defaultPrimaryNodeId);
		const settings = untrack(() => layoutSettings);
		stopRelaxationLoop();
		scaleAnimations = {};
		animationNowMs = 0;
		settleFramesRemaining = 0;
		pendingPostScaleSettle = false;
		scaleChangeFocalNodeId = null;
		layeredRelayoutState = null;
		lastRelayoutStateKey = null;
		graph = withSettledGraphPositions(incoming, { settings });
		primaryNodeId = primary;
		lastPinnedNodeId =
			incoming.nodes.find((node) => node.pinned)?.id ??
			incoming.nodes.find((node) => node.id === primary)?.id ??
			null;
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
			if (relaxationFrameId !== null) cancelAnimationFrame(relaxationFrameId);
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
		commitUserGraph(withRelaxedPositions(movedGraph, node.id, 1));
	}

	function handleNodeDragStart(node: NodeData) {
		activeDragNodeId = node.id;
		settleFramesRemaining = 0;
		startRelaxationLoop();
	}

	function handleNodeDragEnd(node: NodeData) {
		activeDragNodeId = null;

		if (node.pinned) {
			commitUserGraph(withScaleAnimation(graph, node.id));
			return;
		}

		commitUserGraph(withRelaxedPositions(graph, null, 1));
		settleFramesRemaining = resolvedLayoutSettings.postDragSettleMaxFrames;
		startRelaxationLoop();
	}

	function handleNodeMakePrimary(node: NodeData) {
		closeOverlays();
		const wasPinned = node.pinned === true;
		lastPinnedNodeId = node.id;
		commitUserGraph(withScaleAnimation(togglePinned(graph, node.id), node.id));

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
			commitUserGraph(withRelaxedPositions(addEdge(graph, sourceNode.id, targetNode.id)));
		}
	}

	function handleNodeDoubleClickDropOntoBackground(sourceNode: NodeData, point: Point) {
		closeOverlays();
		const graphWithNode = addNode(graph, { pinned: true, position: point });
		const newNode = graphWithNode.nodes[graphWithNode.nodes.length - 1] ?? null;

		commitUserGraph(
			withRelaxedPositions(
				newNode ? addEdge(graphWithNode, sourceNode.id, newNode.id) : graphWithNode
			)
		);

		if (newNode) {
			titleEditNodeId = newNode.id;
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
		titleEditNodeId = null;
	}

	function toggleNodePinned(nodeId: string) {
		lastPinnedNodeId = nodeId;
		commitUserGraph(withScaleAnimation(togglePinned(graph, nodeId), nodeId));
	}

	function deleteNode(nodeId: string) {
		commitUserGraph(withRelaxedPositions(removeNode(graph, nodeId)));
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

	function saveNodeContent(nodeId: string, content: { title: string; description: string }) {
		commitUserGraph(updateNodeContent(graph, nodeId, content));
		closeOverlays();
	}

	function commitUserGraph(nextGraph: MultigraphData) {
		graph = nextGraph;
		onMultigraphChange?.(nextGraph);
	}

	function graphLayoutOptions(
		layoutGraph: MultigraphData,
		overrides: {
			activeDragNodeId?: string | null;
			relaxIterations?: number;
			scaleByNodeId?: Record<string, number>;
			scaleAnchoredNodeIds?: readonly string[];
			participatingNodeIds?: ReadonlySet<string>;
			mobilityByNodeId?: Record<string, number>;
		} = {}
	) {
		const nodeIds = layoutGraph.nodes.map((node) => node.id);
		const relayoutParticipating =
			overrides.participatingNodeIds ?? participatingNodeIds(nodeIds, layeredRelayoutState);
		const relayoutMobility =
			overrides.mobilityByNodeId ??
			relayoutMobilityByNodeId(
				nodeIds,
				pinnedNodeIds(layoutGraph),
				layeredRelayoutState,
				resolvedLayoutSettings
			);

		return {
			settings: layoutSettings,
			activeDragNodeId: overrides.activeDragNodeId ?? activeDragNodeId,
			scaleAnchoredNodeIds: overrides.scaleAnchoredNodeIds ?? scaleAnchoredNodeIds,
			relaxIterations: overrides.relaxIterations,
			scaleByNodeId: overrides.scaleByNodeId ?? animatedScaleByNodeId,
			participatingNodeIds: relayoutParticipating,
			mobilityByNodeId: relayoutMobility
		};
	}

	function pinnedNodeIds(data: MultigraphData = graph): Set<string> {
		return new Set(data.nodes.filter((node) => node.pinned).map((node) => node.id));
	}

	function graphWithVisibleNodes(
		data: MultigraphData,
		nodeIds: ReadonlySet<string>
	): MultigraphData {
		return {
			...data,
			nodes: data.nodes.filter((node) => nodeIds.has(node.id)),
			edges: data.edges.filter(
				(edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId)
			)
		};
	}

	function startLayeredRelayout(nextGraph: MultigraphData, nowMs: number): void {
		const pinnedIds = pinnedNodeIds(nextGraph);
		layeredRelayoutState = initialLayeredRelayoutState(
			pinnedIds,
			resolvedLayoutSettings.layeredRelayoutSettleMaxFrames
		);
		lastRelayoutStateKey = relayoutStateKey(layeredRelayoutState);
		animationNowMs = nowMs;
	}

	function edgeStyle(sourcePos: Point, targetPos: Point): string {
		const dx = targetPos.x - sourcePos.x;
		const dy = targetPos.y - sourcePos.y;
		const length = Math.sqrt(dx ** 2 + dy ** 2);
		const angle = Math.atan2(dy, dx);

		return `left: calc(50% + ${sourcePos.x}px); top: calc(50% + ${sourcePos.y}px); width: ${length}px; transform: translateY(-50%) rotate(${angle}rad);`;
	}

	function edgeRenderPoints(visibility: RenderableEdgeVisibility): {
		source: Point;
		target: Point;
	} {
		if (visibility.kind === 'visible') {
			return {
				source: graphLayout.posByNodeId[visibility.edge.sourceNodeId] ?? CENTERED_POSITION,
				target: graphLayout.posByNodeId[visibility.edge.targetNodeId] ?? CENTERED_POSITION
			};
		}

		const visiblePos = graphLayout.posByNodeId[visibility.visibleNodeId] ?? CENTERED_POSITION;
		const hiddenPos = graph.posByNodeId[visibility.hiddenNodeId] ?? visiblePos;
		return {
			source: visiblePos,
			target: {
				x: visiblePos.x + (hiddenPos.x - visiblePos.x) * visibility.fadeRatio,
				y: visiblePos.y + (hiddenPos.y - visiblePos.y) * visibility.fadeRatio
			}
		};
	}

	function edgeBackground(visibility: RenderableEdgeVisibility): string {
		if (visibility.kind === 'visible') return visibility.edge.color;
		return `linear-gradient(to right, ${visibility.edge.color}, transparent)`;
	}

	function duplicateEdgeIdentifier(edgeId: string): string {
		const edge = graph.edges.find((candidate) => candidate.id === edgeId);
		if (!edge) return 'Unknown edge';

		const sourceTitle = normalizeNodeTitle(
			graph.nodes.find((node) => node.id === edge.sourceNodeId)?.title ?? ''
		);
		const targetTitle = normalizeNodeTitle(
			graph.nodes.find((node) => node.id === edge.targetNodeId)?.title ?? ''
		);

		return `${sourceTitle} -- ${targetTitle}`;
	}

	function withRelaxedPositions(
		nextGraph: MultigraphData,
		dragNodeId: string | null = activeDragNodeId,
		relaxIterations = layoutSettings.relaxIterations
	): MultigraphData {
		const nextVisibleNodeIds = visibleNodeIdsForPinnedNeighborhood(
			nextGraph,
			hopsFromPinned(nextGraph),
			{
				displayedLayers: resolvedLayoutSettings.displayedLayers,
				fallbackAnchorNodeId: lastPinnedNodeId
			}
		);
		const nextVisibleGraph = graphWithVisibleNodes(nextGraph, nextVisibleNodeIds);
		const relaxedVisibleGraph = withRelaxedGraphPositions(
			nextVisibleGraph,
			graphLayoutOptions(nextVisibleGraph, {
				activeDragNodeId: dragNodeId,
				relaxIterations
			})
		);
		return {
			...nextGraph,
			posByNodeId: {
				...nextGraph.posByNodeId,
				...relaxedVisibleGraph.posByNodeId
			}
		};
	}

	function withScaleAnimation(nextGraph: MultigraphData, focalNodeId: string): MultigraphData {
		scaleChangeFocalNodeId = focalNodeId;
		const nextVisibleNodeIds = visibleNodeIdsForPinnedNeighborhood(
			nextGraph,
			hopsFromPinned(nextGraph),
			{
				displayedLayers: resolvedLayoutSettings.displayedLayers,
				fallbackAnchorNodeId: lastPinnedNodeId
			}
		);
		const nextVisibleGraph = graphWithVisibleNodes(nextGraph, nextVisibleNodeIds);
		const fromLayout = deriveGraphLayout(
			visibleGraph,
			graphLayoutOptions(visibleGraph, { relaxIterations: 0 })
		);
		const targetLayout = deriveGraphLayout(
			nextVisibleGraph,
			graphLayoutOptions(nextVisibleGraph, { relaxIterations: 0 })
		);
		const nowMs = performance.now();
		const nextAnimations =
			resolvedLayoutSettings.scaleAnimationDurationMs > 0
				? createScaleAnimations(
						fromLayout.scaleByNodeId,
						targetLayout.scaleByNodeId,
						nowMs,
						resolvedLayoutSettings.scaleAnimationDurationMs
					)
				: {};

		scaleAnimations = nextAnimations;
		animationNowMs = nowMs;
		startLayeredRelayout(nextGraph, nowMs);
		const settleState = settleStateForScaleChange(
			Object.keys(nextAnimations).length > 0,
			resolvedLayoutSettings.postScaleChangeSettleMaxFrames
		);
		pendingPostScaleSettle = settleState.pendingPostScaleSettle;
		settleFramesRemaining = settleState.settleFramesRemaining;

		if (
			Object.keys(nextAnimations).length > 0 ||
			settleFramesRemaining > 0 ||
			layeredRelayoutState?.active
		) {
			startRelaxationLoop();
		}

		const relaxedVisibleGraph = withRelaxedGraphPositions(
			nextVisibleGraph,
			graphLayoutOptions(nextVisibleGraph, {
				relaxIterations: layoutSettings.relaxIterations,
				scaleByNodeId: animatedScalesAt(nextAnimations, nowMs),
				scaleAnchoredNodeIds: [focalNodeId]
			})
		);
		return {
			...nextGraph,
			posByNodeId: {
				...nextGraph.posByNodeId,
				...relaxedVisibleGraph.posByNodeId
			}
		};
	}

	function startRelaxationLoop() {
		if (relaxationFrameId !== null) return;
		relaxationFrameId = requestAnimationFrame(relaxationStep);
	}

	function stopRelaxationLoop() {
		if (relaxationFrameId === null) return;
		cancelAnimationFrame(relaxationFrameId);
		relaxationFrameId = null;
	}

	function relaxationStep(nowMs: number) {
		relaxationFrameId = null;
		animationNowMs = nowMs;

		const nextScaleByNodeId = animatedScalesAt(scaleAnimations, nowMs);
		const shouldRelax =
			activeDragNodeId !== null ||
			settleFramesRemaining > 0 ||
			Object.keys(nextScaleByNodeId).length > 0 ||
			layeredRelayoutState?.active === true;

		if (shouldRelax) {
			const currentVisibleGraph = visibleGraph;
			const step = relaxGraphPositionsStep(
				currentVisibleGraph,
				graphLayoutOptions(currentVisibleGraph, {
					relaxIterations: 1,
					scaleByNodeId: nextScaleByNodeId
				})
			);
			graph = {
				...graph,
				posByNodeId: {
					...graph.posByNodeId,
					...step.data.posByNodeId
				}
			};

			if (activeDragNodeId === null && settleFramesRemaining > 0) {
				settleFramesRemaining -= 1;
				if (step.maxPositionDelta <= resolvedLayoutSettings.postDragSettleEpsilonPx) {
					settleFramesRemaining = 0;
				}
			}

			if (activeDragNodeId === null && layeredRelayoutState?.active) {
				const previousStateKey = lastRelayoutStateKey;
				layeredRelayoutState = advanceLayeredRelayout(layeredRelayoutState, {
					maxPositionDelta: step.maxPositionDelta,
					settleEpsilonPx: resolvedLayoutSettings.layeredRelayoutSettleEpsilonPx
				});
				const nextStateKey = relayoutStateKey(layeredRelayoutState);
				if (nextStateKey !== previousStateKey) {
					lastRelayoutStateKey = nextStateKey;
				}
			}
		}

		scaleAnimations = pruneFinishedScaleAnimations(scaleAnimations, nowMs);

		const postScaleSettle = settleStateAfterScaleAnimationsEnd(
			pendingPostScaleSettle,
			resolvedLayoutSettings.postScaleChangeSettleMaxFrames
		);
		if (postScaleSettle !== null) {
			pendingPostScaleSettle = postScaleSettle.pendingPostScaleSettle;
			settleFramesRemaining = postScaleSettle.settleFramesRemaining;
		}

		if (
			shouldClearScaleChangeFocalNode(scaleChangeFocalNodeId, {
				pendingPostScaleSettle,
				settleFramesRemaining,
				hasActiveScaleAnimations: hasActiveScaleAnimations(scaleAnimations, nowMs)
			})
		) {
			scaleChangeFocalNodeId = null;
		}

		if (shouldClearLayeredRelayoutState(layeredRelayoutState)) {
			layeredRelayoutState = null;
			lastRelayoutStateKey = null;
		}

		if (
			activeDragNodeId !== null ||
			settleFramesRemaining > 0 ||
			hasActiveScaleAnimations(scaleAnimations, nowMs) ||
			layeredRelayoutState?.active
		) {
			startRelaxationLoop();
		}
	}
</script>

<div
	class="graph"
	bind:this={graphRef}
	data-settling={settleFramesRemaining > 0 ? 'true' : undefined}
	data-scale-change-focal={scaleAnchoredNodeIds[0]}
	data-scale-animation-active={hasActiveScaleAnimations(scaleAnimations, animationNowMs)
		? 'true'
		: undefined}
	data-layered-relayout-active={layeredRelayoutState?.active ? 'true' : undefined}
	data-layered-relayout-state={lastRelayoutStateKey ?? undefined}
>
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
		{onViewStateChange}
	>
		<div class="edges" aria-hidden="true">
			{#each renderableEdgeVisibility as visibility (visibility.edge.id)}
				{@const edge = visibility.edge}
				{@const edgePoints = edgeRenderPoints(visibility)}
				<div
					class="edge"
					data-edge-id={edge.id}
					data-source-node-id={edge.sourceNodeId}
					data-target-node-id={edge.targetNodeId}
					data-edge-visibility={visibility.kind}
					data-visible-node-id={visibility.kind === 'boundary'
						? visibility.visibleNodeId
						: undefined}
					data-hidden-node-id={visibility.kind === 'boundary' ? visibility.hiddenNodeId : undefined}
					data-boundary-fade-ratio={visibility.kind === 'boundary'
						? visibility.fadeRatio
						: undefined}
					style={`${edgeStyle(edgePoints.source, edgePoints.target)} background: ${edgeBackground(visibility)};`}
				></div>
			{/each}
		</div>

		{#each visibleGraph.nodes as node (node.id)}
			{@const nodePos = graphLayout.posByNodeId[node.id] ?? CENTERED_POSITION}
			{@const nodeScale = graphLayout.scaleByNodeId[node.id] ?? 1}
			<div
				class="node-wrapper"
				class:primary={primaryNodeId === node.id}
				data-node-id={node.id}
				data-scale={nodeScale}
				data-x={nodePos.x}
				data-y={nodePos.y}
				style={`left: calc(50% + ${nodePos.x}px); top: calc(50% + ${nodePos.y}px); transform: translate(-50%, -50%) scale(${nodeScale});`}
			>
				<Node
					nodeData={node}
					isOpen={false}
					isTitleEditing={titleEditNodeId === node.id}
					onTitleCommit={(title) => {
						titleEditNodeId = null;
						commitUserGraph(
							updateNodeContent(graph, node.id, {
								title,
								description: node.description ?? ''
							})
						);
					}}
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
			onSave={(content) => saveNodeContent(editNode.id, content)}
			onCancel={() => (editNodeId = null)}
			onTogglePinned={() => toggleNodePinned(editNode.id)}
			onDelete={() => deleteNode(editNode.id)}
		/>
	{/if}

	{#if duplicateEdgeConfirm}
		{@const confirmEdgeId = duplicateEdgeConfirm.edgeId}
		{@const edgeIdentifier = duplicateEdgeIdentifier(confirmEdgeId)}
		<div
			class="duplicate-edge-dialog-backdrop"
			role="presentation"
			onclick={() => (duplicateEdgeConfirm = null)}
			onkeydown={() => {}}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="duplicate-edge-dialog-title"
				tabindex="-1"
				class="duplicate-edge-dialog"
				onclick={(e) => e.stopPropagation()}
				onkeydown={() => {}}
			>
				<p id="duplicate-edge-dialog-title" class="duplicate-edge-dialog-message">
					<span>Remove edge:</span>
					<span class="duplicate-edge-dialog-edge">{edgeIdentifier}</span>
				</p>
				<div class="duplicate-edge-dialog-actions">
					<button
						class="duplicate-edge-dialog-cancel"
						onclick={() => (duplicateEdgeConfirm = null)}
					>
						Cancel
					</button>
					<button
						class="duplicate-edge-dialog-confirm"
						onclick={() => {
							commitUserGraph(withRelaxedPositions(removeEdge(graph, confirmEdgeId)));
							duplicateEdgeConfirm = null;
						}}
					>
						Remove
					</button>
				</div>
			</div>
		</div>
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

	.edges {
		position: absolute;
		inset: 0;
		overflow: visible;
		pointer-events: none;
	}

	.edge {
		position: absolute;
		height: 2px;
		transform-origin: left center;
	}

	.duplicate-edge-dialog-backdrop {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.4);
		z-index: 100;
	}

	.duplicate-edge-dialog {
		background: white;
		border-radius: 8px;
		padding: 24px;
		max-width: 280px;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.duplicate-edge-dialog-message {
		margin: 0;
		font-size: 1rem;
		text-align: center;
	}

	.duplicate-edge-dialog-message span {
		display: block;
	}

	.duplicate-edge-dialog-edge {
		margin-top: 4px;
		font-weight: 600;
	}

	.duplicate-edge-dialog-actions {
		display: flex;
		gap: 12px;
		justify-content: center;
	}

	.duplicate-edge-dialog-confirm,
	.duplicate-edge-dialog-cancel {
		padding: 10px 20px;
		border-radius: 6px;
		border: none;
		font-size: 0.9rem;
		cursor: pointer;
		min-width: 80px;
		min-height: 44px;
	}

	.duplicate-edge-dialog-confirm {
		background: #e53935;
		color: white;
	}

	.duplicate-edge-dialog-cancel {
		background: #e0e0e0;
		color: #333;
	}
</style>
