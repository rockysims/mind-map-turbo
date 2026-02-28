<script lang="ts">
	import { toast } from 'svelte-sonner';
	import Node from '$lib/components/ui/Node/Node.svelte';
	import Stage from './Stage.svelte';
	import type { NodeData } from '../types/node';
	import type { MultigraphData } from '../types/multigraph';
	import { isPointInCircle } from './lib/hitTest.js';
	import { Toaster } from '../sonner/index.js';

	const {
		multigraphData = { nodes: [], edges: [], posByNodeId: {} },
		defaultPrimaryNodeId = ''
	}: {
		multigraphData: MultigraphData;
		defaultPrimaryNodeId?: string;
	} = $props();

	const primaryNode = $derived.by(() => {
		const nodes: NodeData[] = multigraphData.nodes;
		return (
			nodes.find((n) => n.id === defaultPrimaryNodeId) ?? nodes[0] ?? null
		);
	});

	const primaryPos = $derived.by(() => {
		if (!primaryNode) return null;
		return multigraphData.posByNodeId[primaryNode.id] ?? null;
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
		return multigraphData.nodes.find((n) => n.id === nodeId) ?? null;
	}

	function handleNodeClick(node: NodeData) {
		toast(`Clicked "${node.title}"`);
	}

	function handleNodeDropOntoNode(source: NodeData, target: NodeData) {
		toast(`Moved "${source.title}" onto "${target.title}"`);
	}

	function handleNodeDropOntoBackground(node: NodeData) {
		toast(`Moved "${node.title}" to background`);
	}

	function handleNodeMakePrimary(node: NodeData) {
		toast(`Set "${node.title}" as primary`);
	}

	function handleNodeDoubleClickDropOntoNode(source: NodeData, target: NodeData) {
		toast.info('TODO: add node/edge', {
			description: `${source.title} → ${target.title}`
		});
	}

	function handleNodeDoubleClickDropOntoBackground(node: NodeData) {
		toast.info('TODO: add node/edge', {
			description: `From "${node.title}" to background`
		});
	}
</script>

<div class="graph">
	<Toaster />
	<Stage
		{getNodeAt}
		onNodeClick={handleNodeClick}
		onNodeDropOntoNode={handleNodeDropOntoNode}
		onNodeDropOntoBackground={handleNodeDropOntoBackground}
		onNodeMakePrimary={handleNodeMakePrimary}
		onNodeDoubleClickDropOntoNode={handleNodeDoubleClickDropOntoNode}
		onNodeDoubleClickDropOntoBackground={handleNodeDoubleClickDropOntoBackground}
	>
		{#if primaryNode}
			<div
				class="node-wrapper"
				data-node-id={primaryNode.id}
				style={
					primaryPos
						? `left: ${primaryPos.x}px; top: ${primaryPos.y}px; transform: translate(-50%, -50%);`
						: 'left: 50%; top: 50%; transform: translate(-50%, -50%);'
				}
			>
				<Node nodeData={primaryNode} isOpen={false} />
			</div>
		{/if}
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
</style>
