<script lang="ts">
	import Stage from './Stage.svelte';
	import Node from '$lib/components/ui/Node/Node.svelte';
	import { isPointInCircle } from './lib/hitTest.js';
	import type { NodeData } from '../types/node';

	let {
		nodes = [],
		/** Optional: nodeId -> { left, top } for positioning (default: 50%, 50%) */
		positions = {},
		...rest
	}: {
		nodes: NodeData[];
		positions?: Record<string, { left: string; top: string }>;
	} = $props();

	function getNodeAt(clientX: number, clientY: number): NodeData | null {
		const nodeElems = Array.from(document.querySelectorAll('div.node')) as HTMLElement[];
		const clickedNodeElems = nodeElems.filter(nodeElem => {
			const circle = nodeElem.querySelector('.circle');
			if (!circle) return false;
			const rect = circle.getBoundingClientRect();
			const wasClicked = isPointInCircle(clientX, clientY, rect.left + rect.width / 2, rect.top + rect.height / 2, Math.min(rect.width, rect.height) / 2);
			return wasClicked ? nodeElem : null;
		});

		const nodeEl = clickedNodeElems.find((el) => el.dataset.nodeId) ?? null;
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
		return nodes.find((n) => n.id === nodeId) ?? null;
	}

	let lastNodeClickId = $state<string | null>(null);
	let lastDropOntoNodeIds = $state<string | null>(null);
	let lastDropOntoBgId = $state<string | null>(null);
</script>

<div
	class="stage-story-wrapper"
	data-testid="stage-callbacks"
	data-last-node-click={lastNodeClickId ?? ''}
	data-last-drop-node={lastDropOntoNodeIds ?? ''}
	data-last-drop-bg={lastDropOntoBgId ?? ''}
	{...rest}
>
	<Stage
		{getNodeAt}
		onNodeClick={(n) => {
			lastNodeClickId = n.id;
			console.log('[StageStoryWrapper] node click:', n.id);
		}}
		onNodeDropOntoNode={(s, t) => {
			lastDropOntoNodeIds = `${s.id},${t.id}`;
			console.log('[StageStoryWrapper] node drag: dropped', s.id, 'onto node', t.id);
		}}
		onNodeDropOntoBackground={(n) => {
			lastDropOntoBgId = n.id;
			console.log('[StageStoryWrapper] node drag: dropped', n.id, 'onto background');
		}}
	>
		{#each nodes as node (node.id)}
			{@const pos = positions[node.id] ?? { left: '50%', top: '50%' }}
			<div
				class="node-wrapper"
				style="position: absolute; left: {pos.left}; top: {pos.top}; transform: translate(-50%, -50%);"
				data-node-id={node.id}
			>
				<Node nodeData={node} isOpen={false} />
			</div>
		{/each}
	</Stage>
</div>

<style>
	.stage-story-wrapper {
		position: relative;
		width: 100%;
		height: 400px;
		background: #0f1115;
		overflow: hidden;
		touch-action: none;
	}
</style>
