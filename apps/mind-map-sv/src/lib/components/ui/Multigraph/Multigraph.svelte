<script lang="ts">
	import Node from '$lib/components/ui/Node/Node.svelte';
	import Stage from './Stage.svelte';
	import type { NodeData } from '../types/node';
	import type { MultigraphData, Point } from '../types/multigraph';
	import { isPointInCircle } from './lib/hitTest.js';
	import { addEdge, addNode, moveNode, togglePinned } from './lib/graph.js';

	const CENTERED_POSITION: Point = { x: 0, y: 0 };

	let {
		multigraphData = { nodes: [], edges: [], posByNodeId: {} },
		defaultPrimaryNodeId = ''
	}: {
		multigraphData: MultigraphData;
		defaultPrimaryNodeId?: string;
	} = $props();

	let graph = $state<MultigraphData>({ nodes: [], edges: [], posByNodeId: {} });
	let primaryNodeId = $state('');

	$effect(() => {
		graph = multigraphData;
		primaryNodeId = defaultPrimaryNodeId;
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
		graph = moveNode(graph, node.id, point);
	}

	function handleNodeMakePrimary(node: NodeData) {
		const wasPinned = node.pinned === true;
		graph = togglePinned(graph, node.id);

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
		graph = addEdge(graph, sourceNode.id, targetNode.id);
	}

	function handleNodeDoubleClickDropOntoBackground(sourceNode: NodeData, point: Point) {
		const graphWithNode = addNode(graph, { position: point });
		const newNode = graphWithNode.nodes[graphWithNode.nodes.length - 1] ?? null;

		graph = newNode ? addEdge(graphWithNode, sourceNode.id, newNode.id) : graphWithNode;
	}
</script>

<div class="graph">
	<Stage
		{getNodeAt}
		onNodeClick={handleNodeClick}
		onNodeMoved={handleNodeMoved}
		onNodeMakePrimary={handleNodeMakePrimary}
		onNodeDoubleClickDropOntoNode={handleNodeDoubleClickDropOntoNode}
		onNodeDoubleClickDropOntoBackground={handleNodeDoubleClickDropOntoBackground}
	>
		<svg class="edges" aria-hidden="true">
			{#each graph.edges as edge (edge.id)}
				{@const sourcePos = graph.posByNodeId[edge.sourceNodeId] ?? CENTERED_POSITION}
				{@const targetPos = graph.posByNodeId[edge.targetNodeId] ?? CENTERED_POSITION}
				<line
					class="edge"
					data-edge-id={edge.id}
					data-source-node-id={edge.sourceNodeId}
					data-target-node-id={edge.targetNodeId}
					x1={`calc(50% + ${sourcePos.x}px)`}
					y1={`calc(50% + ${sourcePos.y}px)`}
					x2={`calc(50% + ${targetPos.x}px)`}
					y2={`calc(50% + ${targetPos.y}px)`}
					stroke={edge.color}
				/>
			{/each}
		</svg>

		{#each graph.nodes as node (node.id)}
			{@const nodePos = graph.posByNodeId[node.id] ?? CENTERED_POSITION}
			<div
				class="node-wrapper"
				class:primary={primaryNodeId === node.id}
				data-node-id={node.id}
				style={`left: calc(50% + ${nodePos.x}px); top: calc(50% + ${nodePos.y}px); transform: translate(-50%, -50%);`}
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
		stroke-width: 2;
	}
</style>
