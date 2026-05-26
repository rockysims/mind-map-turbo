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
		moveNode,
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
		advanceLayeredRelayout,
		bulkUnpinRelayoutState,
		ghostNodeIds,
		initialLayeredRelayoutState,
		participatingNodeIds,
		type LayeredRelayoutState,
		relayoutBatchKey,
		relayoutMobilityByNodeId,
		shouldClearLayeredRelayoutState,
		shouldUseLayeredRelayout,
		targetLayoutOpacityByNodeId
	} from './lib/layeredRelayout.js';
	import {
		createLayoutOpacityAnimations,
		hasActiveLayoutOpacityAnimations,
		interpolateOpacity,
		pruneFinishedLayoutOpacityAnimations,
		type NodeLayoutOpacityAnimation
	} from './lib/layoutOpacityAnimation.js';
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

	const CENTERED_POSITION: Point = { x: 0, y: 0 };

	let {
		multigraphData = { nodes: [], edges: [], posByNodeId: {} },
		graphGeneration = 0,
		defaultPrimaryNodeId = '',
		layoutSettings = {},
		onMultigraphChange
	}: {
		multigraphData: MultigraphData;
		graphGeneration?: number;
		defaultPrimaryNodeId?: string;
		layoutSettings?: Partial<LayoutSettings>;
		onMultigraphChange?: (data: MultigraphData) => void;
	} = $props();

	let graph = $state<MultigraphData>({ nodes: [], edges: [], posByNodeId: {} });
	let primaryNodeId = $state('');
	let activeDragNodeId = $state<string | null>(null);
	let editNodeId = $state<string | null>(null);
	let actionMenu = $state<{ nodeId: string; position: Point } | null>(null);
	let graphRef = $state<HTMLElement | null>(null);
	let relaxationFrameId: number | null = null;
	let scaleAnimations = $state<Record<string, NodeScaleAnimation>>({});
	let animationNowMs = $state(0);
	let settleFramesRemaining = $state(0);
	let pendingPostScaleSettle = $state(false);
	let scaleChangeFocalNodeId = $state<string | null>(null);
	let layeredRelayoutState = $state<LayeredRelayoutState | null>(null);
	let layoutOpacityAnimations = $state<Record<string, NodeLayoutOpacityAnimation>>({});
	let lastRelayoutBatchKey = $state<string | null>(null);
	let lastSyncedGeneration = $state(-1);

	const resolvedLayoutSettings = $derived(withDefaultLayoutSettings(layoutSettings));
	const animatedScaleByNodeId = $derived(animatedScalesAt(scaleAnimations, animationNowMs));
	const scaleChangeSettleState = $derived({
		pendingPostScaleSettle,
		settleFramesRemaining,
		hasActiveScaleAnimations: hasActiveScaleAnimations(scaleAnimations, animationNowMs)
	});
	const scaleAnchoredNodeIds = $derived(
		scaleChangeLayoutAnchoredNodeIds(scaleChangeFocalNodeId, scaleChangeSettleState)
	);
	const graphLayout = $derived(
		deriveGraphLayout(graph, graphLayoutOptions({ relaxIterations: 0 }))
	);
	const layoutOpacityByNodeId = $derived.by(() => {
		const nowMs = animationNowMs;
		return Object.fromEntries(
			graph.nodes.map((node) => [node.id, layoutOpacityForNode(node.id, nowMs)])
		);
	});
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
		layoutOpacityAnimations = {};
		lastRelayoutBatchKey = null;
		graph = withSettledGraphPositions(incoming, { settings });
		primaryNodeId = primary;
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
		commitUserGraph(withRelaxedPositions(addEdge(graph, sourceNode.id, targetNode.id)));
	}

	function handleNodeDoubleClickDropOntoBackground(sourceNode: NodeData, point: Point) {
		closeOverlays();
		const graphWithNode = addNode(graph, { position: point });
		const newNode = graphWithNode.nodes[graphWithNode.nodes.length - 1] ?? null;

		commitUserGraph(
			withRelaxedPositions(
				newNode ? addEdge(graphWithNode, sourceNode.id, newNode.id) : graphWithNode
			)
		);
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
	}

	function toggleNodePinned(nodeId: string) {
		commitUserGraph(withScaleAnimation(togglePinned(graph, nodeId), nodeId));
	}

	function deleteNode(nodeId: string) {
		commitUserGraph(withRelaxedPositions(removeNode(graph, nodeId)));
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
		overrides: {
			activeDragNodeId?: string | null;
			relaxIterations?: number;
			scaleByNodeId?: Record<string, number>;
			scaleAnchoredNodeIds?: readonly string[];
			participatingNodeIds?: ReadonlySet<string>;
			mobilityByNodeId?: Record<string, number>;
			ghostNodeIds?: ReadonlySet<string>;
		} = {}
	) {
		const hopsByNodeId = hopsFromPinned(graph);
		const nodeIds = graph.nodes.map((node) => node.id);
		const relayoutParticipating =
			overrides.participatingNodeIds ??
			participatingNodeIds(hopsByNodeId, nodeIds, layeredRelayoutState);
		const relayoutGhosts =
			overrides.ghostNodeIds ?? ghostNodeIds(hopsByNodeId, nodeIds, layeredRelayoutState);
		const relayoutMobility =
			overrides.mobilityByNodeId ??
			relayoutMobilityByNodeId(
				nodeIds,
				hopsByNodeId,
				pinnedNodeIds(),
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
			mobilityByNodeId: relayoutMobility,
			ghostNodeIds: relayoutGhosts
		};
	}

	function pinnedNodeIds(data: MultigraphData = graph): Set<string> {
		return new Set(data.nodes.filter((node) => node.pinned).map((node) => node.id));
	}

	function layoutOpacityForNode(nodeId: string, nowMs: number): number {
		if (pinnedNodeIds().has(nodeId)) return 1;

		const animation = layoutOpacityAnimations[nodeId];
		if (animation) return interpolateOpacity(animation, nowMs);

		if (layeredRelayoutState?.active) {
			const targets = targetLayoutOpacityByNodeId(
				graph.nodes.map((node) => node.id),
				hopsFromPinned(graph),
				pinnedNodeIds(),
				layeredRelayoutState,
				resolvedLayoutSettings.layeredRelayoutDimOpacity
			);
			return targets[nodeId] ?? 1;
		}

		return 1;
	}

	function startLayeredRelayout(nextGraph: MultigraphData, nowMs: number): void {
		const hopsByNodeId = hopsFromPinned(nextGraph);
		const pinnedIds = pinnedNodeIds(nextGraph);
		const nodeIds = nextGraph.nodes.map((node) => node.id);
		const settleMaxFrames = resolvedLayoutSettings.layeredRelayoutSettleMaxFrames;
		const settleMaxFramesFinal = resolvedLayoutSettings.layeredRelayoutSettleMaxFramesFinal;

		layeredRelayoutState = shouldUseLayeredRelayout(pinnedIds.size > 0)
			? initialLayeredRelayoutState(hopsByNodeId, pinnedIds, settleMaxFrames, settleMaxFramesFinal)
			: bulkUnpinRelayoutState(settleMaxFrames);
		lastRelayoutBatchKey = relayoutBatchKey(layeredRelayoutState);

		const opacityTargets = targetLayoutOpacityByNodeId(
			nodeIds,
			hopsByNodeId,
			pinnedIds,
			layeredRelayoutState,
			resolvedLayoutSettings.layeredRelayoutDimOpacity
		);

		if (layeredRelayoutState.mode === 'bulk-unpin') {
			const fromOpacities = Object.fromEntries(nodeIds.map((nodeId) => [nodeId, 1]));
			layoutOpacityAnimations =
				resolvedLayoutSettings.layeredRelayoutOpacityAnimationDurationMs > 0
					? createLayoutOpacityAnimations(
							fromOpacities,
							opacityTargets,
							nowMs,
							resolvedLayoutSettings.layeredRelayoutOpacityAnimationDurationMs
						)
					: {};
			return;
		}

		layoutOpacityAnimations = {};
	}

	function syncLayoutOpacityAnimations(nowMs: number): void {
		if (!layeredRelayoutState) return;

		const hopsByNodeId = hopsFromPinned(graph);
		const pinnedIds = pinnedNodeIds();
		const nodeIds = graph.nodes.map((node) => node.id);
		const currentOpacities = Object.fromEntries(
			nodeIds.map((nodeId) => [nodeId, layoutOpacityForNode(nodeId, nowMs)])
		);
		const opacityTargets = targetLayoutOpacityByNodeId(
			nodeIds,
			hopsByNodeId,
			pinnedIds,
			layeredRelayoutState,
			resolvedLayoutSettings.layeredRelayoutDimOpacity
		);
		const revealTargets = Object.fromEntries(
			Object.entries(opacityTargets).filter(
				([nodeId, targetOpacity]) =>
					targetOpacity > currentOpacities[nodeId] + 0.001 && !pinnedIds.has(nodeId)
			)
		);

		layoutOpacityAnimations = {
			...pruneFinishedLayoutOpacityAnimations(layoutOpacityAnimations, nowMs),
			...(Object.keys(revealTargets).length > 0
				? createLayoutOpacityAnimations(
						currentOpacities,
						revealTargets,
						nowMs,
						resolvedLayoutSettings.layeredRelayoutOpacityAnimationDurationMs
					)
				: {})
		};

		if (
			layeredRelayoutState.mode === 'bulk-unpin' &&
			layeredRelayoutState.restoreOpacity &&
			Object.keys(revealTargets).length === 0
		) {
			layoutOpacityAnimations = {
				...layoutOpacityAnimations,
				...createLayoutOpacityAnimations(
					currentOpacities,
					opacityTargets,
					nowMs,
					resolvedLayoutSettings.layeredRelayoutOpacityAnimationDurationMs
				)
			};
		}
	}

	function edgeStyle(sourcePos: Point, targetPos: Point): string {
		const dx = targetPos.x - sourcePos.x;
		const dy = targetPos.y - sourcePos.y;
		const length = Math.sqrt(dx ** 2 + dy ** 2);
		const angle = Math.atan2(dy, dx);

		return `left: calc(50% + ${sourcePos.x}px); top: calc(50% + ${sourcePos.y}px); width: ${length}px; transform: translateY(-50%) rotate(${angle}rad);`;
	}

	function withRelaxedPositions(
		nextGraph: MultigraphData,
		dragNodeId: string | null = activeDragNodeId,
		relaxIterations = layoutSettings.relaxIterations
	): MultigraphData {
		return withRelaxedGraphPositions(
			nextGraph,
			graphLayoutOptions({
				activeDragNodeId: dragNodeId,
				relaxIterations
			})
		);
	}

	function withScaleAnimation(nextGraph: MultigraphData, focalNodeId: string): MultigraphData {
		scaleChangeFocalNodeId = focalNodeId;
		const fromLayout = deriveGraphLayout(graph, graphLayoutOptions({ relaxIterations: 0 }));
		const targetLayout = deriveGraphLayout(nextGraph, graphLayoutOptions({ relaxIterations: 0 }));
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

		return withRelaxedGraphPositions(
			nextGraph,
			graphLayoutOptions({
				relaxIterations: layoutSettings.relaxIterations,
				scaleByNodeId: animatedScalesAt(nextAnimations, nowMs),
				scaleAnchoredNodeIds: [focalNodeId]
			})
		);
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
			const step = relaxGraphPositionsStep(
				graph,
				graphLayoutOptions({
					relaxIterations: 1,
					scaleByNodeId: nextScaleByNodeId
				})
			);
			graph = step.data;

			if (activeDragNodeId === null && settleFramesRemaining > 0) {
				settleFramesRemaining -= 1;
				if (step.maxPositionDelta <= resolvedLayoutSettings.postDragSettleEpsilonPx) {
					settleFramesRemaining = 0;
				}
			}

			if (activeDragNodeId === null && layeredRelayoutState?.active) {
				const previousBatchKey = lastRelayoutBatchKey;
				layeredRelayoutState = advanceLayeredRelayout(layeredRelayoutState, {
					maxPositionDelta: step.maxPositionDelta,
					settleEpsilonPx: resolvedLayoutSettings.layeredRelayoutSettleEpsilonPx,
					settleMaxFrames: resolvedLayoutSettings.layeredRelayoutSettleMaxFrames,
					settleMaxFramesFinal: resolvedLayoutSettings.layeredRelayoutSettleMaxFramesFinal
				});
				const nextBatchKey = relayoutBatchKey(layeredRelayoutState);
				if (nextBatchKey !== previousBatchKey) {
					lastRelayoutBatchKey = nextBatchKey;
					syncLayoutOpacityAnimations(nowMs);
				}
			}
		}

		scaleAnimations = pruneFinishedScaleAnimations(scaleAnimations, nowMs);
		layoutOpacityAnimations = pruneFinishedLayoutOpacityAnimations(layoutOpacityAnimations, nowMs);

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

		if (
			shouldClearLayeredRelayoutState(
				layeredRelayoutState,
				hasActiveLayoutOpacityAnimations(layoutOpacityAnimations, nowMs)
			)
		) {
			layeredRelayoutState = null;
			lastRelayoutBatchKey = null;
		}

		if (
			activeDragNodeId !== null ||
			settleFramesRemaining > 0 ||
			hasActiveScaleAnimations(scaleAnimations, nowMs) ||
			hasActiveLayoutOpacityAnimations(layoutOpacityAnimations, nowMs) ||
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
	data-layered-relayout-batch={lastRelayoutBatchKey ?? undefined}
>
	<Stage
		{getNodeAt}
		onNodeMoved={handleNodeMoved}
		onNodeDragStart={handleNodeDragStart}
		onNodeDragEnd={handleNodeDragEnd}
		onNodeMakePrimary={handleNodeMakePrimary}
		onNodeDoubleClickDropOntoNode={handleNodeDoubleClickDropOntoNode}
		onNodeDoubleClickDropOntoBackground={handleNodeDoubleClickDropOntoBackground}
		onNodeLongPress={handleNodeLongPress}
	>
		<div class="edges" aria-hidden="true">
			{#each graph.edges as edge (edge.id)}
				{@const sourcePos = graphLayout.posByNodeId[edge.sourceNodeId] ?? CENTERED_POSITION}
				{@const targetPos = graphLayout.posByNodeId[edge.targetNodeId] ?? CENTERED_POSITION}
				{@const edgeOpacity = Math.min(
					layoutOpacityByNodeId[edge.sourceNodeId] ?? 1,
					layoutOpacityByNodeId[edge.targetNodeId] ?? 1
				)}
				<div
					class="edge"
					data-edge-id={edge.id}
					data-source-node-id={edge.sourceNodeId}
					data-target-node-id={edge.targetNodeId}
					style={`${edgeStyle(sourcePos, targetPos)} background-color: ${edge.color}; opacity: ${edgeOpacity};`}
				></div>
			{/each}
		</div>

		{#each graph.nodes as node (node.id)}
			{@const nodePos = graphLayout.posByNodeId[node.id] ?? CENTERED_POSITION}
			{@const nodeScale = graphLayout.scaleByNodeId[node.id] ?? 1}
			{@const nodeLayoutOpacity = layoutOpacityByNodeId[node.id] ?? 1}
			<div
				class="node-wrapper"
				class:primary={primaryNodeId === node.id}
				data-node-id={node.id}
				data-scale={nodeScale}
				data-layout-opacity={nodeLayoutOpacity}
				data-x={nodePos.x}
				data-y={nodePos.y}
				style={`left: calc(50% + ${nodePos.x}px); top: calc(50% + ${nodePos.y}px); transform: translate(-50%, -50%) scale(${nodeScale}); opacity: ${nodeLayoutOpacity};`}
			>
				<Node nodeData={node} isOpen={false} />
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
</style>
