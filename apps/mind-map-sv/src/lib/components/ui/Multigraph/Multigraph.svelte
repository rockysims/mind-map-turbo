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
	import type { LayoutSettings } from './lib/layoutSettings.js';
	import { withDefaultLayoutSettings } from './lib/layoutSettings.js';
	import {
		animatedScalesAt,
		createScaleAnimations,
		hasActiveScaleAnimations,
		pruneFinishedScaleAnimations,
		type NodeScaleAnimation
	} from './lib/scaleAnimation.js';
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
	let lastSyncedGeneration = $state(-1);

	const resolvedLayoutSettings = $derived(withDefaultLayoutSettings(layoutSettings));
	const animatedScaleByNodeId = $derived(animatedScalesAt(scaleAnimations, animationNowMs));
	const graphLayout = $derived(
		deriveGraphLayout(graph, {
			settings: layoutSettings,
			activeDragNodeId,
			relaxIterations: 0,
			scaleByNodeId: animatedScaleByNodeId
		})
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

	function handleNodeDragEnd() {
		activeDragNodeId = null;
		commitUserGraph(withRelaxedPositions(graph, null, 1));
		settleFramesRemaining = resolvedLayoutSettings.postDragSettleMaxFrames;
		startRelaxationLoop();
	}

	function handleNodeMakePrimary(node: NodeData) {
		closeOverlays();
		const wasPinned = node.pinned === true;
		commitUserGraph(withScaleAnimation(togglePinned(graph, node.id)));

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
		commitUserGraph(withScaleAnimation(togglePinned(graph, nodeId)));
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
		return withRelaxedGraphPositions(nextGraph, {
			settings: layoutSettings,
			activeDragNodeId: dragNodeId,
			relaxIterations,
			scaleByNodeId: animatedScaleByNodeId
		});
	}

	function withScaleAnimation(nextGraph: MultigraphData): MultigraphData {
		const fromLayout = deriveGraphLayout(graph, {
			settings: layoutSettings,
			relaxIterations: 0
		});
		const targetLayout = deriveGraphLayout(nextGraph, {
			settings: layoutSettings,
			relaxIterations: 0
		});
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
		settleFramesRemaining = resolvedLayoutSettings.postDragSettleMaxFrames;

		if (Object.keys(nextAnimations).length > 0 || settleFramesRemaining > 0) {
			startRelaxationLoop();
		}

		return withRelaxedGraphPositions(nextGraph, {
			settings: layoutSettings,
			activeDragNodeId,
			relaxIterations: layoutSettings.relaxIterations,
			scaleByNodeId: animatedScalesAt(nextAnimations, nowMs)
		});
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
			Object.keys(nextScaleByNodeId).length > 0;

		if (shouldRelax) {
			const step = relaxGraphPositionsStep(graph, {
				settings: layoutSettings,
				activeDragNodeId,
				relaxIterations: 1,
				scaleByNodeId: nextScaleByNodeId
			});
			graph = step.data;

			if (activeDragNodeId === null && settleFramesRemaining > 0) {
				settleFramesRemaining -= 1;
				if (step.maxPositionDelta <= resolvedLayoutSettings.postDragSettleEpsilonPx) {
					settleFramesRemaining = 0;
				}
			}
		}

		scaleAnimations = pruneFinishedScaleAnimations(scaleAnimations, nowMs);

		if (
			activeDragNodeId !== null ||
			settleFramesRemaining > 0 ||
			hasActiveScaleAnimations(scaleAnimations, nowMs)
		) {
			startRelaxationLoop();
		}
	}
</script>

<div
	class="graph"
	bind:this={graphRef}
	data-settling={settleFramesRemaining > 0 ? 'true' : undefined}
	data-scale-animation-active={hasActiveScaleAnimations(scaleAnimations, animationNowMs)
		? 'true'
		: undefined}
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
				<div
					class="edge"
					data-edge-id={edge.id}
					data-source-node-id={edge.sourceNodeId}
					data-target-node-id={edge.targetNodeId}
					style={`${edgeStyle(sourcePos, targetPos)} background-color: ${edge.color};`}
				></div>
			{/each}
		</div>

		{#each graph.nodes as node (node.id)}
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
