<script lang="ts">
	import Node from '$lib/components/ui/Node/Node.svelte';
	import Stage from './Stage.svelte';
	import type { NodeData } from '../types/node';
	import type { MultigraphData, Point } from '../types/multigraph';
	import { isPointInCircle } from './lib/hitTest.js';
	import { addEdge, addNode, moveNode, togglePinned } from './lib/graph.js';
	import {
		deriveGraphLayout,
		withRelaxedGraphPositions,
		withSettledGraphPositions
	} from './lib/graphLayout.js';
	import type { LayoutSettings } from './lib/layoutSettings.js';

	const CENTERED_POSITION: Point = { x: 0, y: 0 };

	let {
		multigraphData = { nodes: [], edges: [], posByNodeId: {} },
		defaultPrimaryNodeId = '',
		layoutSettings = {}
	}: {
		multigraphData: MultigraphData;
		defaultPrimaryNodeId?: string;
		layoutSettings?: Partial<LayoutSettings>;
	} = $props();

	let graph = $state<MultigraphData>({ nodes: [], edges: [], posByNodeId: {} });
	let primaryNodeId = $state('');
	let activeDragNodeId = $state<string | null>(null);
	let relaxationFrameId: number | null = null;

	const graphLayout = $derived(
		deriveGraphLayout(graph, { settings: layoutSettings, activeDragNodeId, relaxIterations: 0 })
	);

	$effect(() => {
		graph = withSettledGraphPositions(multigraphData, { settings: layoutSettings });
		primaryNodeId = defaultPrimaryNodeId;
	});

	$effect(() => {
		return () => {
			if (relaxationFrameId !== null) cancelAnimationFrame(relaxationFrameId);
		};
	});

	/** Resolve node at client coordinates (circle hit-test). Testable by passing a custom getNodeAt from outside if needed. */
	function getNodeAt(clientX: number, clientY: number): NodeData | null {
		const elements = document.elementsFromPoint(clientX, clientY) as HTMLElement[];
		const nodeEl = elements.find((el) => el.dataset.nodeId) ?? null;
		if (!nodeEl) return null;
		const circle = nodeEl.querySelector('.circle');
		if (!circle) return null;
		const rect = (circle as HTMLElement).getBoundingClientRect();
		const centerX = rect.left + rect.width / 2;
		const centerY = rect.top + rect.height / 2;
		const radius = Math.min(rect.width, rect.height) / 2;
		if (!isPointInCircle(clientX, clientY, centerX, centerY, radius)) return null;
		const nodeId = nodeEl.dataset.nodeId ?? null;
		if (!nodeId) return null;
		return graph.nodes.find((n) => n.id === nodeId) ?? null;
	}

	function handleNodeClick() {
		// Milestone 03 owns node editing/opening behavior.
	}

	function handleNodeMoved(node: NodeData, point: Point) {
		const movedGraph = moveNode(graph, node.id, point);
		graph = withRelaxedPositions(movedGraph, node.id, 1);
	}

	function handleNodeDragStart(node: NodeData) {
		activeDragNodeId = node.id;
		startRelaxationLoop();
	}

	function handleNodeDragEnd() {
		activeDragNodeId = null;
		stopRelaxationLoop();
		graph = withRelaxedPositions(graph);
	}

	function handleNodeMakePrimary(node: NodeData) {
		const wasPinned = node.pinned === true;
		graph = withRelaxedPositions(togglePinned(graph, node.id));

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
		graph = withRelaxedPositions(addEdge(graph, sourceNode.id, targetNode.id));
	}

	function handleNodeDoubleClickDropOntoBackground(sourceNode: NodeData, point: Point) {
		const graphWithNode = addNode(graph, { position: point });
		const newNode = graphWithNode.nodes[graphWithNode.nodes.length - 1] ?? null;

		graph = withRelaxedPositions(
			newNode ? addEdge(graphWithNode, sourceNode.id, newNode.id) : graphWithNode
		);
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
			relaxIterations
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

	function relaxationStep() {
		relaxationFrameId = null;
		if (!activeDragNodeId) return;
		graph = withRelaxedPositions(graph, activeDragNodeId, 1);
		startRelaxationLoop();
	}
</script>

<div class="graph">
	<Stage
		{getNodeAt}
		onNodeClick={handleNodeClick}
		onNodeMoved={handleNodeMoved}
		onNodeDragStart={handleNodeDragStart}
		onNodeDragEnd={handleNodeDragEnd}
		onNodeMakePrimary={handleNodeMakePrimary}
		onNodeDoubleClickDropOntoNode={handleNodeDoubleClickDropOntoNode}
		onNodeDoubleClickDropOntoBackground={handleNodeDoubleClickDropOntoBackground}
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
				style={`left: calc(50% + ${nodePos.x}px); top: calc(50% + ${nodePos.y}px); transform: translate(-50%, -50%) scale(${nodeScale});`}
			>
				<Node nodeData={node} isOpen={false} />
			</div>
		{/each}
	</Stage>
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
