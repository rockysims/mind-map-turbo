<script lang="ts">
	import { MIN_NODE_HIT_RADIUS, NODE_RADIUS } from '$lib/constants';
	import Stage from './Stage.svelte';
	import Node from '$lib/components/ui/Node/Node.svelte';
	import { effectiveHitRadius, isPointInCircle } from './lib/hitTest.js';
	import type { NodeData } from '../types/node.js';
	import type { Point } from '../types/multigraph.js';

	let {
		nodes = [],
		/** Optional: nodeId -> { left, top } for positioning (default: 50%, 50%) */
		positions = {},
		initialScale,
		initialPanX,
		initialPanY,
		onNodeMoved: onNodeMovedProp,
		...rest
	}: {
		nodes: NodeData[];
		positions?: Record<string, { left: string; top: string }>;
		initialScale?: number;
		initialPanX?: number;
		initialPanY?: number;
		onNodeMoved?: (node: NodeData, point: Point) => void;
	} = $props();

	let harnessRef = $state<HTMLElement | null>(null);

	function getNodeAt(clientX: number, clientY: number): NodeData | null {
		const nodeElems = Array.from(
			harnessRef?.querySelectorAll('div.node') ?? []
		).reverse() as HTMLElement[];
		const clickedNodeElems = nodeElems.filter((nodeElem) => {
			const circle = nodeElem.querySelector('.circle');
			if (!circle) return false;
			const rect = circle.getBoundingClientRect();
			const wasClicked = isPointInCircle(
				clientX,
				clientY,
				rect.left + rect.width / 2,
				rect.top + rect.height / 2,
				effectiveHitRadius(Math.min(rect.width, rect.height) / 2, MIN_NODE_HIT_RADIUS)
			);
			return wasClicked ? nodeElem : null;
		});

		const nodeEl = clickedNodeElems.find((el) => el.dataset.nodeId) ?? null;
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
		return nodes.find((n) => n.id === nodeId) ?? null;
	}

	let lastNodeMoved = $state<{ nodeId: string; point: Point } | null>(null);
	let lastNodeDragStartId = $state<string | null>(null);
	let lastNodeDragEndId = $state<string | null>(null);
	let lastMakePrimaryId = $state<string | null>(null);
	let lastDoubleClickDropBg = $state<{ nodeId: string; point: Point } | null>(null);
	let lastDoubleClickDropNodeIds = $state<string | null>(null);
	let lastNodeLongPress = $state<{ nodeId: string; point: Point } | null>(null);
	let lastViewState = $state<{ panX: number; panY: number; scale: number } | null>(null);
</script>

<div
	class="stage-harness"
	bind:this={harnessRef}
	style="--stage-harness-height: {NODE_RADIUS * 2}px"
	data-testid="stage-callbacks"
	data-last-node-moved={lastNodeMoved
		? `${lastNodeMoved.nodeId},${lastNodeMoved.point.x},${lastNodeMoved.point.y}`
		: ''}
	data-last-node-drag-start={lastNodeDragStartId ?? ''}
	data-last-node-drag-end={lastNodeDragEndId ?? ''}
	data-last-make-primary={lastMakePrimaryId ?? ''}
	data-last-double-click-drop-bg={lastDoubleClickDropBg
		? `${lastDoubleClickDropBg.nodeId},${lastDoubleClickDropBg.point.x},${lastDoubleClickDropBg.point.y}`
		: ''}
	data-last-double-click-drop-node={lastDoubleClickDropNodeIds ?? ''}
	data-last-node-long-press={lastNodeLongPress
		? `${lastNodeLongPress.nodeId},${lastNodeLongPress.point.x},${lastNodeLongPress.point.y}`
		: ''}
	data-last-view-state={lastViewState
		? `${lastViewState.panX},${lastViewState.panY},${lastViewState.scale}`
		: ''}
	{...rest}
>
	<Stage
		{getNodeAt}
		{initialScale}
		{initialPanX}
		{initialPanY}
		onNodeMoved={(n, point) => {
			lastNodeMoved = { nodeId: n.id, point };
			onNodeMovedProp?.(n, point);
		}}
		onNodeDragStart={(n) => {
			lastNodeDragStartId = n.id;
		}}
		onNodeDragEnd={(n) => {
			lastNodeDragEndId = n.id;
		}}
		onNodeMakePrimary={(n) => {
			lastMakePrimaryId = n.id;
		}}
		onNodeDoubleClickDropOntoNode={(s, t) => {
			lastDoubleClickDropNodeIds = `${s.id},${t.id}`;
		}}
		onNodeDoubleClickDropOntoBackground={(n, point) => {
			lastDoubleClickDropBg = { nodeId: n.id, point };
		}}
		onNodeLongPress={(n, point) => {
			lastNodeLongPress = { nodeId: n.id, point };
		}}
		onViewStateChange={(state) => {
			lastViewState = state;
		}}
	>
		{#each nodes as node (node.id)}
			{@const pos = positions[node.id] ?? { left: '50%', top: '50%' }}
			<div
				class="node-harness"
				style="position: absolute; left: {pos.left}; top: {pos.top}; transform: translate(-50%, -50%);"
				data-node-id={node.id}
			>
				<Node nodeData={node} isOpen={false} />
			</div>
		{/each}
	</Stage>
</div>

<style>
	.stage-harness {
		position: relative;
		width: 100%;
		height: var(--stage-harness-height);
		overflow: hidden;
		touch-action: none;
	}
</style>
