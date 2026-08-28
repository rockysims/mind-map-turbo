<script lang="ts">
	/**
	 * Drives a description edit from outside the canvas so a story can assert that
	 * a dataflow arrow appears and disappears with the equation that implies it.
	 *
	 * Editing through the node sheet would exercise more of the app but would make
	 * the assertion about the sheet rather than about the dataflow layer.
	 */
	import { untrack } from 'svelte';
	import Multigraph from './Multigraph.svelte';
	import type { MultigraphData } from '../types/multigraph';
	import type { ViewState } from '$lib/migrations';
	import type { LayoutSettings } from './lib/layoutSettings';

	let {
		baseGraph,
		editNodeId,
		equation,
		startWithEquation = false,
		initialViewState,
		// Physics off by default so stories about drawing and topology assert on
		// exact geometry. A story about force turns it on for itself.
		layoutSettings = { relaxIterations: 0 }
	}: {
		baseGraph: MultigraphData;
		editNodeId: string;
		/** Description applied to `editNodeId` when the equation is present. */
		equation: string;
		startWithEquation?: boolean;
		initialViewState?: ViewState;
		layoutSettings?: Partial<LayoutSettings>;
	} = $props();

	// Read once on purpose: the story sets the starting state, the buttons own it after.
	let hasEquation = $state(untrack(() => startWithEquation));
	let generation = $state(0);

	const graph = $derived<MultigraphData>({
		...baseGraph,
		nodes: baseGraph.nodes.map((node) =>
			node.id === editNodeId ? { ...node, description: hasEquation ? equation : '' } : node
		)
	});

	function setEquation(next: boolean) {
		hasEquation = next;
		generation += 1;
	}
</script>

<div class="harness">
	<div class="controls">
		<button type="button" data-add-equation onclick={() => setEquation(true)}>Add equation</button>
		<button type="button" data-remove-equation onclick={() => setEquation(false)}>
			Remove equation
		</button>
	</div>
	<div class="canvas" data-has-equation={hasEquation}>
		<Multigraph
			multigraphData={graph}
			graphGeneration={generation}
			defaultPrimaryNodeId={baseGraph.nodes[0]?.id ?? ''}
			{layoutSettings}
			{initialViewState}
		/>
	</div>
</div>

<style>
	.harness {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.controls {
		display: flex;
		gap: 0.5rem;
		padding: 0.5rem;
	}

	.canvas {
		flex: 1;
		min-height: 0;
	}
</style>
