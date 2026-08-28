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
	 *
	 * Text is only half of it. Nothing flows anywhere until the quantities are
	 * confirmed, so both routes carry the designations too:
	 * `[data-confirm-io]` / `[data-clear-io]` re-ingest a graph whose nodes agree
	 * with what their math suggests (or with nothing at all), and the sheet route
	 * taps the chips the way a reader does before saving.
	 */
	import { tick, untrack } from 'svelte';
	import Multigraph from './Multigraph.svelte';
	import type { MultigraphData } from '../types/multigraph';
	import type { NodeData, QuantityDesignation } from '../types/node';
	import type { ViewState } from '$lib/migrations';
	import type { LayoutSettings } from './lib/layoutSettings';
	import { nodeQuantities } from './lib/nodeQuantities';

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

	interface NodeIo {
		inputs: QuantityDesignation[];
		outputs: QuantityDesignation[];
	}

	/**
	 * Designations applied by the IO buttons, kept beside the graph so an equation
	 * toggle rebuilt from `baseGraph` does not silently drop them — in the app a
	 * description edit never does.
	 */
	let ioByNodeId = $state<Record<string, NodeIo>>({});

	function withEquation(present: boolean): MultigraphData {
		return {
			...baseGraph,
			nodes: baseGraph.nodes.map((node) => ({
				...node,
				...(ioByNodeId[node.id] ?? {}),
				...(node.id === editNodeId ? { description: present ? equation : '' } : {})
			}))
		};
	}

	function toDesignation(symbol: { base: string; subscript: string | null }): QuantityDesignation {
		return { base: symbol.base, subscript: symbol.subscript };
	}

	/** What this node's own math suggests: what it defines out, what it mentions in. */
	function suggestedIo(node: NodeData): NodeIo {
		const parsed = nodeQuantities(node);
		return {
			inputs: parsed.references.map(toDesignation),
			outputs: parsed.defines.map((definition) => toDesignation(definition.symbol))
		};
	}

	function applyIo(next: Record<string, NodeIo>) {
		ioByNodeId = next;
		graph = {
			...graph,
			nodes: graph.nodes.map((node) => ({ ...node, ...(next[node.id] ?? {}) }))
		};
		generation += 1;
	}

	/**
	 * Confirm every node's suggestions at once. Whole-graph rather than one node
	 * because a dataflow edge needs both ends — a definer that confirmed its
	 * output and a consumer that confirmed its input — and a story about an edge
	 * should not have to say so twice.
	 */
	function confirmSuggestedIo() {
		applyIo(Object.fromEntries(graph.nodes.map((node) => [node.id, suggestedIo(node)])));
	}

	function clearIo() {
		applyIo(Object.fromEntries(graph.nodes.map((node) => [node.id, { inputs: [], outputs: [] }])));
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

	/** Right-click the node and choose Edit, leaving its sheet open. */
	async function openSheet() {
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
	}

	/** One tap on each ghost chip, which lands it in the column it was drawn in. */
	async function confirmSuggestedChips(canvas: HTMLElement) {
		for (const chip of Array.from(
			canvas.querySelectorAll('[data-designation-role="suggestion"]')
		)) {
			(chip as HTMLElement).click();
			await tick();
		}
	}

	/**
	 * Tap confirmed chips until none is left. A stale chip has no suggested role
	 * to enter the cycle at, so how many taps it takes depends on which column it
	 * is in — looping is what makes "take them all off" one step for a story.
	 */
	async function unassignConfirmedChips(canvas: HTMLElement) {
		const confirmed = () =>
			canvas.querySelector('[data-designation-role="input"], [data-designation-role="output"]');
		for (let taps = 0; taps < 24 && confirmed(); taps += 1) {
			(confirmed() as HTMLElement).click();
			await tick();
		}
	}

	/**
	 * Replace the description, settle the designations, save. Every step is one a
	 * reader takes — including confirming what the new equation suggests, without
	 * which the save changes the text and nothing else — so the commit lands in
	 * the canvas's own content path with no help from the harness.
	 */
	async function saveDescriptionThroughSheet(description: string, confirm: boolean) {
		await openSheet();
		const canvas = requireElement(canvasRef, 'canvas');

		const field = requireElement(
			canvas.querySelector('textarea[name="description"]'),
			'description field'
		) as HTMLTextAreaElement;
		field.value = description;
		field.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();

		if (confirm) await confirmSuggestedChips(canvas);
		else await unassignConfirmedChips(canvas);

		const save = requireElement(
			canvas.querySelector('#node-edit-tabpanel button.primary'),
			'Save button'
		) as HTMLButtonElement;
		save.click();
		await tick();
	}

	async function saveEquation(next: boolean) {
		hasEquation = next;
		await saveDescriptionThroughSheet(next ? equation : '', next);
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
		<button type="button" data-confirm-io onclick={confirmSuggestedIo}>Confirm suggested IO</button>
		<button type="button" data-clear-io onclick={clearIo}>Clear IO</button>
		<button type="button" data-open-sheet onclick={() => void openSheet()}>Open sheet</button>
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
