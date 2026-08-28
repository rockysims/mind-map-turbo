<script lang="ts">
	/**
	 * Drives a description edit from outside the canvas so a story can assert that
	 * a dataflow arrow appears and disappears with the equation that implies it.
	 *
	 * Two routes, because they exercise different halves of the app:
	 *
	 * - `[data-add-equation]` / `[data-remove-equation]` hand the canvas a new
	 *   graph under a new `graphGeneration`. That is the storage route: the whole
	 *   graph is re-ingested and settled on its way in. It makes a story about
	 *   drawing or topology cheap to write, and it is also how the story suite
	 *   once managed to hide a bug — a re-ingest settles everything, so nothing
	 *   here could notice that a real edit settled nothing.
	 * - `[data-save-equation]` / `[data-clear-equation]` write the same text
	 *   through the node's own edit sheet, and the canvas hands the committed
	 *   graph back through `onMultigraphChange` with the generation untouched.
	 *   That is the route a reader takes, and the only one that can tell whether
	 *   an equation puts a node on screen alive or frozen.
	 */
	import { tick, untrack } from 'svelte';
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

	function withEquation(present: boolean): MultigraphData {
		return {
			...baseGraph,
			nodes: baseGraph.nodes.map((node) =>
				node.id === editNodeId ? { ...node, description: present ? equation : '' } : node
			)
		};
	}

	// Read once on purpose: the story sets the starting state, the buttons own it after.
	let hasEquation = $state(untrack(() => startWithEquation));
	let generation = $state(0);
	/**
	 * The graph the app owns. Seeded by the story, replaced wholesale on the
	 * re-ingest route, and written back by the canvas on the save route — where
	 * the generation never moves, so the canvas keeps the graph it committed
	 * rather than being handed a fresh one.
	 */
	let graph = $state<MultigraphData>(untrack(() => withEquation(startWithEquation)));
	let canvasRef = $state<HTMLElement | null>(null);
	/**
	 * Bumped once a sheet save has landed. The flow is microtasks all the way
	 * down, so a story can wait for it without letting an animation frame — and
	 * with it the settle it is about to assert on — slip past.
	 */
	let saveCount = $state(0);

	function setEquation(next: boolean) {
		hasEquation = next;
		graph = withEquation(next);
		generation += 1;
	}

	function requireElement<T extends Element>(found: T | null, what: string): T {
		if (!found) throw new Error(`DataflowHarness: ${what} not on the canvas`);
		return found;
	}

	/**
	 * Right-click the node, choose Edit, replace the description, save. Every step
	 * is one a reader takes, so the commit lands in the canvas's own content path
	 * with no help from the harness.
	 */
	async function saveDescriptionThroughSheet(description: string) {
		const canvas = requireElement(canvasRef, 'canvas');
		const circle = requireElement(
			canvas.querySelector(`[data-node-id="${editNodeId}"] .circle`),
			`node ${editNodeId}`
		);
		const rect = circle.getBoundingClientRect();
		circle.dispatchEvent(
			new MouseEvent('contextmenu', {
				clientX: rect.left + rect.width / 2,
				clientY: rect.top + rect.height / 2,
				bubbles: true,
				cancelable: true
			})
		);
		await tick();

		const edit = requireElement(
			Array.from(canvas.querySelectorAll('[role="menuitem"]')).find(
				(item) => item.textContent?.trim() === 'Edit'
			) ?? null,
			'Edit menu item'
		) as HTMLElement;
		edit.click();
		await tick();

		const field = requireElement(
			canvas.querySelector('textarea[name="description"]'),
			'description field'
		) as HTMLTextAreaElement;
		field.value = description;
		field.dispatchEvent(new Event('input', { bubbles: true }));

		const save = requireElement(
			canvas.querySelector('#node-edit-tabpanel button.primary'),
			'Save button'
		) as HTMLButtonElement;
		save.click();
		await tick();
	}

	async function saveEquation(next: boolean) {
		hasEquation = next;
		await saveDescriptionThroughSheet(next ? equation : '');
		saveCount += 1;
	}
</script>

<div class="harness" data-save-count={saveCount}>
	<div class="controls">
		<button type="button" data-add-equation onclick={() => setEquation(true)}>Add equation</button>
		<button type="button" data-remove-equation onclick={() => setEquation(false)}>
			Remove equation
		</button>
		<button type="button" data-save-equation onclick={() => void saveEquation(true)}>
			Save equation
		</button>
		<button type="button" data-clear-equation onclick={() => void saveEquation(false)}>
			Clear equation
		</button>
	</div>
	<div class="canvas" data-has-equation={hasEquation} bind:this={canvasRef}>
		<Multigraph
			multigraphData={graph}
			graphGeneration={generation}
			defaultPrimaryNodeId={baseGraph.nodes[0]?.id ?? ''}
			onMultigraphChange={(next: MultigraphData) => (graph = next)}
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
