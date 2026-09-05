<script lang="ts">
	/**
	 * The canvas node and its details view over one graph, so a story can watch a
	 * change made in the details view land on the node.
	 *
	 * The details view only reports what the reader did; the mutation belongs to
	 * `lib/graph.ts` and the commit to `Multigraph.svelte`. "Toggle done and see
	 * the badge change" needs all three, so this harness supplies the two the
	 * component does not own — the same pure function the canvas calls, over a
	 * graph in `$state`.
	 *
	 * `data-last-intent` beside them is the label the commit would carry into the
	 * undo list, which is the other half of what the canvas does with the toggle.
	 */
	import { untrack } from 'svelte';
	import Node from '$lib/components/ui/Node/Node.svelte';
	import NodeDetailsContent from './NodeDetailsContent.svelte';
	import { setTaskDone } from './lib/graph';
	import type { GraphAssetStore } from '$lib/assets/assetStore';
	import type { MultigraphData } from '../types/multigraph';

	let {
		baseGraph,
		nodeId,
		assetStore = null,
		assetScope = ''
	}: {
		baseGraph: MultigraphData;
		nodeId: string;
		assetStore?: GraphAssetStore | null;
		assetScope?: string;
	} = $props();

	// Seeded once and owned from then on, the way the edit sheet's harness does
	// it: the story states a starting graph and every later value is committed
	// here. `untrack` says the initial read is deliberate.
	let graph = $state(untrack(() => baseGraph));
	let lastIntent = $state('');

	const node = $derived(graph.nodes.find((candidate) => candidate.id === nodeId));
</script>

{#if node}
	<div data-node-details-harness data-last-intent={lastIntent}></div>
	<div class="canvas-node">
		<Node nodeData={node} />
	</div>
	<NodeDetailsContent
		{node}
		assets={graph.assets ?? {}}
		{assetStore}
		{assetScope}
		currentNodeId={nodeId}
		onToggleTaskDone={(done) => {
			graph = setTaskDone(graph, nodeId, done);
			lastIntent = done ? 'mark task done' : 'mark task not done';
		}}
	/>
{/if}

<style>
	.canvas-node {
		display: flex;
		justify-content: center;
		margin-bottom: 1rem;
	}
</style>
