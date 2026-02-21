<script lang="ts">
	import Node from '$lib/components/ui/Node/Node.svelte';
	import type { NodeData } from '../types/node';
	import type { MultigraphData } from '../types/multigraph';

	const {
		multigraphData = { nodes: [], edges: [], posByNodeId: {} },
		defaultPrimaryNodeId = ''
	} = $props<{
		multigraphData: MultigraphData;
		defaultPrimaryNodeId?: string;
	}>();

	const primaryNode = $derived.by(() => {
		const nodes: NodeData[] = multigraphData.nodes;
		return (
			nodes.find(n => n.id === defaultPrimaryNodeId) ??
			nodes[0] ??
			null
		);
	});

	// Pan state
	let panX = $state(0);
	let panY = $state(0);
	let panStart = $state<{ clientX: number; clientY: number; panX: number; panY: number } | null>(null);

	// Node-drag state (pointer down on node, waiting for pointer up to resolve drop target)
	let dragNode = $state<NodeData | null>(null);

	function getNodeAt(clientX: number, clientY: number): NodeData | null {
		const el = document.elementFromPoint(clientX, clientY);
		const nodeEl = el?.closest?.('[data-node-id]');
		if (!nodeEl) return null;
		const circle = nodeEl.querySelector('.circle');
		if (!circle) return null;
		const rect = circle.getBoundingClientRect();
		const centerX = rect.left + rect.width / 2;
		const centerY = rect.top + rect.height / 2;
		const radius = Math.min(rect.width, rect.height) / 2;
		const dx = clientX - centerX;
		const dy = clientY - centerY;
		if (dx * dx + dy * dy > radius * radius) return null;
		const nodeId = nodeEl.dataset.nodeId;
		if (!nodeId) return null;
		return multigraphData.nodes.find((n) => n.id === nodeId) ?? null;
	}

	function onStagePointerDown(e: PointerEvent) {
		const clickedNode = getNodeAt(e.clientX, e.clientY);
		if (clickedNode) {
			dragNode = clickedNode;
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		} else {
			panStart = { clientX: e.clientX, clientY: e.clientY, panX, panY };
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		}
	}

	function onStagePointerMove(e: PointerEvent) {
		if (panStart) {
			panX = panStart.panX + (e.clientX - panStart.clientX);
			panY = panStart.panY + (e.clientY - panStart.clientY);
		}
	}

	function onStagePointerUp(e: PointerEvent) {
		const stage = e.currentTarget as HTMLElement;
		if (dragNode) {
			const dropTarget = getNodeAt(e.clientX, e.clientY);
			if (dropTarget) {
				if (dropTarget.id === dragNode.id) {
					console.log('[Multigraph] node drag: dropped node', dragNode.id, 'onto itself');					
				} else {
					console.log('[Multigraph] node drag: dropped node', dragNode.id, 'onto node', dropTarget.id);
				}
			} else {
				console.log('[Multigraph] node drag: dropped node', dragNode.id, 'onto background (no target node)');
			}
			dragNode = null;
			stage.releasePointerCapture(e.pointerId);
			return;
		}
		if (panStart) {
			panStart = null;
			stage.releasePointerCapture(e.pointerId);
		}
	}
</script>

<div class="graph">
	<div
		class="stage"
		class:panning={panStart !== null}
		style="transform: translate({panX}px, {panY}px)"
		onpointerdown={onStagePointerDown}
		onpointermove={onStagePointerMove}
		onpointerup={onStagePointerUp}
		onpointercancel={onStagePointerUp}
	>
		{#if primaryNode}
			<div class="node" data-node-id={primaryNode.id}>
				<Node nodeData={primaryNode} isOpen={false} />
			</div>
		{/if}
	</div>
</div>

<style>
	.graph {
		position: relative;
		width: 100vw;
		height: 100vh;
		overflow: hidden;
		touch-action: none;
	}

	.stage {
		position: absolute;
		inset: 0;
		cursor: grab;
	}
	.stage.panning {
		cursor: grabbing;
	}

	.node {
		position: absolute;
		/* position set inline from posByNodeId or fallback center */
	}
</style>
