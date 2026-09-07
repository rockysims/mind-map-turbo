<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, userEvent, waitFor } from 'storybook/test';
	import NodeDetailsContent from './NodeDetailsContent.svelte';
	import type { NodeData, QuantityDesignation } from '../types/node';
	import { symbolFor, type QuantitySymbol } from '../MathText/lib/mathSymbols';
	import { APP_CONFIG } from '$lib/appConfig';
	import { nodeQuantities } from './lib/nodeQuantities';
	import type { QuantityIndexEntry } from './lib/quantityIndex';
	import { cycleDesignation } from './lib/quantityDesignations';
	import { designations, makeGraph } from './lib/testFixtures';
	import NodeDetailsHarness from './NodeDetailsHarness.svelte';
	import { MemoryGraphAssetStore } from '$lib/assets/assetStore';
	import type { MultigraphData } from '../types/multigraph';

	function makeNode(description: string): NodeData {
		return { id: 'node-1', title: 'Kinematics', description, tags: [] };
	}

	const PROSE_ONLY = 'First line.\nSecond line.\n\nAfter a blank line.';

	type JumpSpy = { mock: { calls: Array<[string]> } };
	type ConfirmSpy = { mock: { calls: Array<[string, string]> } };
	type CycleSpy = {
		mock: { calls: Array<[QuantitySymbol, 'input' | 'output' | undefined]> };
	};

	/** A node that has confirmed g as one of its inputs, with the text to match. */
	const WEIGHT_NODE: NodeData = {
		...makeNode('Weight is $$w = m g$$.'),
		inputs: designations('g'),
		outputs: designations('w')
	};

	/** Two nodes claim g, and they disagree — the case the peek exists to show. */
	const G_DEFINED_TWICE: QuantityIndexEntry = {
		symbol: symbolFor('g', null),
		definerNodeIds: ['earth', 'moon'],
		definitions: [
			{ nodeId: 'earth', bodyKey: 'earth-g', sourceTex: 'g = 9.8', displayMode: true },
			{ nodeId: 'moon', bodyKey: 'moon-g', sourceTex: 'g = 1.6', displayMode: true }
		],
		textDefinerNodeIds: [],
		textDefinitions: [],
		consumerNodeIds: ['node-1']
	};

	/** Confirmed the output, but its text no longer states it — nothing to render. */
	const G_CLAIMED_WITHOUT_AN_EQUATION: QuantityIndexEntry = {
		symbol: symbolFor('g', null),
		definerNodeIds: ['earth'],
		definitions: [],
		textDefinerNodeIds: [],
		textDefinitions: [],
		consumerNodeIds: ['node-1']
	};

	/** Confirmed as an input, and nothing anywhere answers it — not even in text. */
	const G_UNDEFINED: QuantityIndexEntry = {
		symbol: symbolFor('g', null),
		definerNodeIds: [],
		definitions: [],
		textDefinerNodeIds: [],
		textDefinitions: [],
		consumerNodeIds: ['node-1']
	};

	/**
	 * Nobody has confirmed g, but `gravity` writes the equation down. The state
	 * that used to read as "nothing defines g yet" — and offered to define it
	 * again.
	 */
	const G_WRITTEN_BUT_UNCONFIRMED: QuantityIndexEntry = {
		symbol: symbolFor('g', null),
		definerNodeIds: [],
		definitions: [],
		textDefinerNodeIds: ['gravity'],
		textDefinitions: [
			{ nodeId: 'gravity', bodyKey: 'gravity-g', sourceTex: 'g = 9.8', displayMode: true }
		],
		consumerNodeIds: ['node-1']
	};

	/** One confirmed definer and one that has only written it down. */
	const G_CONFIRMED_AND_WRITTEN: QuantityIndexEntry = {
		symbol: symbolFor('g', null),
		definerNodeIds: ['earth'],
		definitions: [{ nodeId: 'earth', bodyKey: 'earth-g', sourceTex: 'g = 9.8', displayMode: true }],
		textDefinerNodeIds: ['moon'],
		textDefinitions: [
			{ nodeId: 'moon', bodyKey: 'moon-g', sourceTex: 'g = 1.6', displayMode: true }
		],
		consumerNodeIds: ['node-1']
	};

	/**
	 * This node says what w is, and so does a second one. An output's definers are
	 * exactly where a disagreement shows up, which is why the peek is on every
	 * chip rather than only on the inputs.
	 */
	const W_DEFINED_HERE_AND_ELSEWHERE: QuantityIndexEntry = {
		symbol: symbolFor('w', null),
		definerNodeIds: ['node-1', 'scales'],
		definitions: [
			{ nodeId: 'node-1', bodyKey: 'node-1-w', sourceTex: 'w = m g', displayMode: true },
			{ nodeId: 'scales', bodyKey: 'scales-w', sourceTex: 'w = 700', displayMode: true }
		],
		textDefinerNodeIds: [],
		textDefinitions: [],
		consumerNodeIds: []
	};

	/**
	 * The reported bug at component scale: a node titled `$y = 1$` whose own text
	 * is the only thing defining y, with nothing confirmed anywhere.
	 */
	const OWN_EQUATION_NODE: NodeData = {
		id: 'node-1',
		title: '$y = 1$',
		description: '',
		tags: []
	};

	const Y_WRITTEN_HERE: QuantityIndexEntry = {
		symbol: symbolFor('y', null),
		definerNodeIds: [],
		definitions: [],
		textDefinerNodeIds: ['node-1'],
		textDefinitions: [
			{ nodeId: 'node-1', bodyKey: 'node-1-y', sourceTex: 'y = 1', displayMode: false }
		],
		consumerNodeIds: []
	};

	const OWN_EQUATION_ARGS = {
		node: OWN_EQUATION_NODE,
		currentNodeId: 'node-1',
		quantities: nodeQuantities(OWN_EQUATION_NODE),
		quantityEntryFor: (key: string) => (key === 'y' ? Y_WRITTEN_HERE : undefined),
		titleForNodeId: (nodeId: string) => nodeId
	};

	const wEntryLookup = (key: string) => (key === 'w' ? W_DEFINED_HERE_AND_ELSEWHERE : undefined);

	/** `w` feeds two nodes — what a downstream card is for. */
	const W_USED_TWICE: QuantityIndexEntry = {
		symbol: symbolFor('w', null),
		definerNodeIds: ['node-1'],
		definitions: [
			{ nodeId: 'node-1', bodyKey: 'node-1-w', sourceTex: 'w = m g', displayMode: true }
		],
		textDefinerNodeIds: [],
		textDefinitions: [],
		consumerNodeIds: ['scales', 'crane']
	};

	/** Both columns answerable at once: `g` upstream, `w` downstream. */
	const BOTH_DIRECTIONS = (key: string) =>
		key === 'g' ? G_DEFINED_TWICE : key === 'w' ? W_USED_TWICE : undefined;

	const BOTH_DIRECTIONS_ARGS = {
		node: WEIGHT_NODE,
		currentNodeId: 'node-1',
		quantities: nodeQuantities(WEIGHT_NODE),
		quantityEntryFor: BOTH_DIRECTIONS,
		titleForNodeId: (nodeId: string) => nodeId
	};

	const entryLookup = (entry: QuantityIndexEntry) => (key: string) =>
		key === 'g' ? entry : undefined;

	const MOON_AND_EARTH_TITLES = (nodeId: string) => (nodeId === 'earth' ? 'Earth' : 'Moon');

	const CHIP_HOLD_MS = APP_CONFIG.multigraph.dataflow.chipPeekLongPressMs;

	/** A node carrying the task add-on, in the state the story asks for. */
	function taskNode(done: boolean): NodeData {
		return {
			id: 'node-1',
			title: 'Change the filters',
			description: '',
			tags: [],
			addons: { task: done ? { done: true, doneAt: 1_700_000_000_000 } : { done: false } }
		};
	}

	function taskGraph(): MultigraphData {
		return makeGraph({ nodes: [taskNode(false)] });
	}

	/** One node with one CSV attached, and the asset metadata the rows read. */
	function fileGraph(): MultigraphData {
		return {
			...makeGraph({
				nodes: [
					{
						id: 'node-1',
						title: 'Rig measurements',
						description: '',
						tags: [],
						content: [
							{
								type: 'file',
								assetId: 'asset-csv',
								name: 'measurements.csv',
								caption: 'Rig run 3'
							}
						]
					}
				]
			}),
			assets: {
				'asset-csv': {
					id: 'asset-csv',
					kind: 'file',
					mimeType: 'text/csv',
					name: 'measurements.csv',
					size: 8,
					createdAt: 1
				}
			}
		};
	}

	/** The blob behind that metadata — eight bytes, so the row reads `8 B`. */
	function csvStore(): MemoryGraphAssetStore {
		const store = new MemoryGraphAssetStore();
		void store.put({
			scope: 'story',
			assetId: 'asset-csv',
			blob: new Blob(['a,b\n1,2\n'], { type: 'text/csv' }),
			mimeType: 'text/csv',
			name: 'measurements.csv',
			size: 8,
			updatedAt: 1
		});
		return store;
	}

	function cellText(row: HTMLElement, attribute: string): string {
		return row.querySelector(`[${attribute}]`)?.textContent?.trim() ?? '';
	}

	function taskToggle(canvasElement: HTMLElement): HTMLElement {
		const found = canvasElement.querySelector('[data-task-toggle]');
		if (!(found instanceof HTMLElement)) throw new Error('no task toggle');
		return found;
	}

	/** The task glyph on the harness's canvas node. */
	function badgeGlyph(canvasElement: HTMLElement): string {
		return canvasElement.querySelector('[data-addon-badge="task"]')?.textContent?.trim() ?? '';
	}

	function titleColor(canvasElement: HTMLElement): string {
		const titleEl = canvasElement.querySelector('.node .title');
		if (!(titleEl instanceof HTMLElement)) throw new Error('no canvas node title');
		return window.getComputedStyle(titleEl).color;
	}

	function harnessState(canvasElement: HTMLElement): HTMLElement {
		const found = canvasElement.querySelector('[data-node-details-harness]');
		if (!(found instanceof HTMLElement)) throw new Error('no harness state element');
		return found;
	}

	function sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/** One view chip, found by key. */
	function viewChip(canvasElement: HTMLElement, key: string): HTMLElement {
		const chip = canvasElement.querySelector(
			`[data-designation-chips="view"] [data-designation-key="${key}"]`
		);
		if (!(chip instanceof HTMLElement)) throw new Error(`no view chip for ${key}`);
		return chip;
	}

	/**
	 * Right-click, which is the desktop half of "tell me more". user-event v14
	 * does not synthesize a `contextmenu`, so the event is built by hand.
	 */
	function dispatchContextMenu(target: HTMLElement): MouseEvent {
		const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
		target.dispatchEvent(event);
		return event;
	}

	/**
	 * A desktop right-click in full. The browser fires `pointerdown` with the
	 * secondary button before `contextmenu`, and that pointerdown is what clears a
	 * click suppression left over from an earlier hold — dispatching the
	 * `contextmenu` alone would test the guard without the thing that disarms it.
	 */
	function rightClickChip(chip: HTMLElement): void {
		const rect = chip.getBoundingClientRect();
		chip.dispatchEvent(
			new PointerEvent('pointerdown', {
				bubbles: true,
				cancelable: true,
				pointerId: 1,
				button: 2,
				pointerType: 'mouse',
				clientX: rect.left + rect.width / 2,
				clientY: rect.top + rect.height / 2
			})
		);
		dispatchContextMenu(chip);
	}

	function dispatchChipPointer(
		target: HTMLElement,
		type: 'pointerdown' | 'pointermove' | 'pointerup',
		pointerType: string
	): void {
		const rect = target.getBoundingClientRect();
		target.dispatchEvent(
			new PointerEvent(type, {
				bubbles: true,
				cancelable: true,
				pointerId: 1,
				button: 0,
				pointerType,
				clientX: rect.left + rect.width / 2,
				clientY: rect.top + rect.height / 2
			})
		);
	}

	/** Hold a chip past the tunable, the way a thumb does, and let go. */
	async function holdChip(chip: HTMLElement, pointerType = 'touch'): Promise<void> {
		dispatchChipPointer(chip, 'pointerdown', pointerType);
		await sleep(CHIP_HOLD_MS + 80);
		dispatchChipPointer(chip, 'pointerup', pointerType);
	}

	/**
	 * Open the peek for one quantity, the way a reader does — by holding or
	 * right-clicking. A tap is the cycle now, so a story that wants the answer has
	 * to ask for it the way the surface asks.
	 */
	async function peekAt(canvasElement: HTMLElement, key: string): Promise<HTMLElement> {
		dispatchContextMenu(viewChip(canvasElement, key));

		return await waitFor(() => {
			// The root card, specifically: nested cards carry the same label attribute.
			const card = canvasElement.querySelector('[data-peek-path=""]');
			expect(card).toBeInTheDocument();
			return card as HTMLElement;
		});
	}

	/** The root cards of one column, in the order they are rendered. */
	function columnCards(canvasElement: HTMLElement, column: 'input' | 'output'): HTMLElement[] {
		return [
			...canvasElement.querySelectorAll(`[data-peek-column="${column}"] [data-peek-path=""]`)
		].filter((card): card is HTMLElement => card instanceof HTMLElement);
	}

	/** Every root card on screen, whichever column it sits in. */
	function allCards(canvasElement: HTMLElement): HTMLElement[] {
		return [...columnCards(canvasElement, 'input'), ...columnCards(canvasElement, 'output')];
	}

	/** The quantities each column's cards answer, top to bottom. */
	function cardLabels(canvasElement: HTMLElement, column: 'input' | 'output'): string[] {
		return columnCards(canvasElement, column).map(
			(card) => card.getAttribute('data-quantity-peek') ?? ''
		);
	}

	/**
	 * A press somewhere that is neither a chip nor a card. The dismissal listens
	 * for the `click`, not the `pointerdown` — collapsing the cards mid-press
	 * moved the controls below them out from under the reader's finger — so the
	 * whole press is dispatched here rather than just its first half.
	 */
	function pressOutside(canvasElement: HTMLElement): void {
		canvasElement.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
		canvasElement.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
		canvasElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));
	}

	/** Open the peek for the one confirmed input, the way a reader does. */
	async function peekAtG(canvasElement: HTMLElement): Promise<HTMLElement> {
		const chip = canvasElement.querySelector('[data-designation-role="input"]');
		expect(chip).toHaveAttribute('data-designation-key', 'g');

		return await peekAt(canvasElement, 'g');
	}

	/** The symbol a designation label stands for — `v_0` included. */
	function symbolOf(label: string): QuantitySymbol {
		const [designation] = designations(label);
		return symbolFor(designation.base, designation.subscript);
	}

	function definerRow(card: HTMLElement, definerNodeId: string): HTMLElement {
		// The card's own row comes first in document order, so a nested card that
		// happens to repeat a definer cannot shadow it.
		const row = card.querySelector(`[data-peek-definer="${definerNodeId}"]`);
		if (!(row instanceof HTMLElement)) throw new Error(`no definer row for ${definerNodeId}`);
		return row;
	}

	/** The drill chips one row offers, in order, as quantity keys. */
	function drillKeys(row: HTMLElement): string[] {
		return Array.from(
			row.querySelectorAll(':scope > [data-peek-drill-line] [data-peek-drill]')
		).map((chip) => chip.getAttribute('data-peek-drill') ?? '');
	}

	/**
	 * Matched by reading the attribute rather than by selector: a subscripted key
	 * embeds a NUL, which no attribute selector can carry.
	 */
	function drillChip(row: HTMLElement, key: string): HTMLElement {
		const found = Array.from(
			row.querySelectorAll(':scope > [data-peek-drill-line] [data-peek-drill]')
		).find((chip) => chip.getAttribute('data-peek-drill') === key);
		if (!(found instanceof HTMLElement)) throw new Error(`no drill chip for ${key}`);
		return found;
	}

	/**
	 * Drill one of a definer's inputs and wait for the card it opens.
	 *
	 * Right-clicked, not clicked: a drill chip takes the same gesture as the chip
	 * that opened the card above it, so that reading down a cascade never asks the
	 * reader to switch hands halfway.
	 */
	async function drillInto(
		card: HTMLElement,
		definerNodeId: string,
		key: string
	): Promise<HTMLElement> {
		const chip = drillChip(definerRow(card, definerNodeId), key);
		const pathKey = chip.getAttribute('data-peek-drill-path') ?? '';
		rightClickChip(chip);

		return await waitFor(() => {
			const nested = card.querySelector(`[data-peek-path="${pathKey}"]`);
			expect(nested).toBeInTheDocument();
			return nested as HTMLElement;
		});
	}

	/**
	 * One index entry, from `[nodeId, sourceTex]` pairs — a null source standing
	 * for a definer whose text no longer states the equation. `textDefiners` are
	 * the same pairs for nodes that have written the definition without anyone
	 * confirming it; they always carry a source, since that is what puts them on
	 * the list.
	 */
	function entryOf(
		label: string,
		definers: ReadonlyArray<readonly [string, string | null]>,
		textDefiners: ReadonlyArray<readonly [string, string]> = []
	): [string, QuantityIndexEntry] {
		const symbol = symbolOf(label);
		return [
			symbol.key,
			{
				symbol,
				definerNodeIds: definers.map(([nodeId]) => nodeId),
				definitions: definers
					.filter((definer): definer is [string, string] => definer[1] !== null)
					.map(([nodeId, sourceTex]) => ({
						nodeId,
						bodyKey: `${nodeId}-${symbol.key}`,
						sourceTex,
						displayMode: true
					})),
				textDefinerNodeIds: textDefiners.map(([nodeId]) => nodeId),
				textDefinitions: textDefiners.map(([nodeId, sourceTex]) => ({
					nodeId,
					bodyKey: `${nodeId}-${symbol.key}`,
					sourceTex,
					displayMode: true
				})),
				consumerNodeIds: []
			}
		];
	}

	function inputTable(byNodeId: Record<string, string[]>): Record<string, QuantityDesignation[]> {
		return Object.fromEntries(
			Object.entries(byNodeId).map(([nodeId, labels]) => [nodeId, designations(...labels)])
		);
	}

	/**
	 * A graph deep enough to drill through, with everything a cascade can hit:
	 * three definers of one quantity (one of which consumes nothing), two of them
	 * sharing an input, a chain back to the root quantity, an unresolved
	 * subscripted quantity two levels down, and — under `m` — a node that has
	 * written a definition without confirming it, so a nested card has a row to
	 * confirm.
	 */
	const CASCADE_ENTRIES = new Map<string, QuantityIndexEntry>([
		entryOf('g', [
			['constant', 'g = 9.8'],
			['earth', 'g = G m / r^2'],
			['moon', 'g = 1.6']
		]),
		entryOf('m', [['mass', 'm = \\rho_0 V']], [['scales', 'm = 70']]),
		entryOf('r', [['radius', 'r = 6371']]),
		entryOf('rho_0', [['density', '\\rho_0 = 1000']])
	]);

	const CASCADE_INPUTS = inputTable({
		constant: [],
		earth: ['m', 'r'],
		moon: ['m'],
		mass: ['g', 'rho_0'],
		radius: ['T_0'],
		density: []
	});

	const NO_INPUTS: QuantityDesignation[] = [];

	const CASCADE_ARGS = {
		node: WEIGHT_NODE,
		quantities: nodeQuantities(WEIGHT_NODE),
		quantityEntryFor: (key: string) => CASCADE_ENTRIES.get(key),
		inputsForNodeId: (nodeId: string) => CASCADE_INPUTS[nodeId] ?? NO_INPUTS,
		titleForNodeId: (nodeId: string) => nodeId
	};

	/** Seven quantities in a line, so a cascade can be driven past the indent cap. */
	const CHAIN_LABELS = ['a', 'b', 'c', 'd', 'e', 'f', 'h'];
	const CHAIN_ENTRIES = new Map<string, QuantityIndexEntry>(
		CHAIN_LABELS.map((label, index) => {
			const next = CHAIN_LABELS[index + 1];
			return entryOf(label, [
				[`n-${label}`, next === undefined ? `${label} = 1` : `${label} = ${next} + 1`]
			]);
		})
	);
	const CHAIN_INPUTS = inputTable(
		Object.fromEntries(
			CHAIN_LABELS.map((label, index) => {
				const next = CHAIN_LABELS[index + 1];
				return [`n-${label}`, next === undefined ? [] : [next]];
			})
		)
	);
	const CHAIN_NODE: NodeData = {
		...makeNode('A long chain: $$z = a$$.'),
		inputs: designations('a'),
		outputs: designations('z')
	};

	const CHAIN_ARGS = {
		node: CHAIN_NODE,
		quantities: nodeQuantities(CHAIN_NODE),
		quantityEntryFor: (key: string) => CHAIN_ENTRIES.get(key),
		inputsForNodeId: (nodeId: string) => CHAIN_INPUTS[nodeId] ?? NO_INPUTS,
		titleForNodeId: (nodeId: string) => nodeId
	};

	const { Story } = defineMeta({
		title: 'Components/Multigraph/NodeDetailsContent',
		component: NodeDetailsContent,
		tags: [],
		args: {
			node: makeNode('Constant acceleration gives $$v = v_0 + a t$$ for velocity $v$.')
		}
	});

	function focusContent(canvasElement: HTMLElement): HTMLElement {
		const content = canvasElement.querySelector('.focus-content');
		if (!(content instanceof HTMLElement)) {
			throw new Error('focus content not found');
		}
		return content;
	}

	/**
	 * What the canvas does with a cycle, in one line: this component reads its
	 * designations off the node it is given, so a story about a chip actually
	 * moving has to own the node and rewrite it the way `Multigraph` does.
	 */
	function cycledNode(
		node: NodeData,
		symbol: QuantitySymbol,
		suggestedRole?: 'input' | 'output'
	): NodeData {
		return {
			...node,
			...cycleDesignation({ inputs: node.inputs, outputs: node.outputs }, symbol, suggestedRole)
		};
	}
</script>

<script lang="ts">
	// One node per story that needs the columns to change under the chip, so
	// neither can be left in the other's state.
	let ghostNode = $state<NodeData>(WEIGHT_NODE);
	let focusNode = $state<NodeData>(WEIGHT_NODE);
</script>

<Story
	name="ShowsTypesetMathInADescription"
	play={async ({ canvasElement }) => {
		const content = focusContent(canvasElement);

		expect(content.querySelectorAll('[data-segment="display-math"] math')).toHaveLength(1);
		expect(content.querySelectorAll('[data-segment="inline-math"] math')).toHaveLength(1);
		expect(content.textContent).toContain('Constant acceleration gives');
	}}
/>

<Story
	name="LeavesADescriptionWithoutMathUnchanged"
	args={{ node: makeNode(PROSE_ONLY) }}
	play={async ({ canvasElement }) => {
		const content = focusContent(canvasElement);
		const description = content.querySelector('.description');
		if (!(description instanceof HTMLElement)) {
			throw new Error('description not found');
		}

		expect(content.querySelectorAll('math')).toHaveLength(0);
		expect(description.textContent).toBe(PROSE_ONLY);
		expect(getComputedStyle(description).whiteSpace).toBe('pre-wrap');
	}}
/>

<Story
	name="OmitsTheDescriptionWhenItIsBlank"
	args={{ node: makeNode('   \n  ') }}
	play={async ({ canvasElement }) => {
		expect(focusContent(canvasElement).querySelector('.description')).toBeNull();
	}}
/>

<Story
	name="AddsNoScrollContainerSoWheelInputReachesTheZoomWorld"
	play={async ({ canvasElement }) => {
		const content = focusContent(canvasElement);
		const description = content.querySelector('.description');
		if (!(description instanceof HTMLElement)) {
			throw new Error('description not found');
		}

		// Focus mode relies on wheel events reaching ZoomWorld underneath, so nothing
		// in this subtree may become scrollable.
		for (const element of [content, description, ...description.querySelectorAll('*')]) {
			const { overflowX, overflowY } = getComputedStyle(element);
			expect([overflowX, overflowY]).not.toContain('scroll');
			expect([overflowX, overflowY]).not.toContain('auto');
		}
	}}
/>

<Story
	name="ShowsNoDiagnosticsWhenEveryQuantityResolves"
	play={async ({ canvasElement }) => {
		// A clean description reads exactly as it did before diagnostics existed.
		expect(
			focusContent(canvasElement).querySelector('[data-quantity-diagnostics]')
		).not.toBeInTheDocument();
	}}
/>

<Story
	name="OffersToDefineAnUnresolvedQuantity"
	args={{
		node: makeNode('Energy is $$E = m c^2$$.'),
		diagnostics: {
			items: [
				{ key: 'm', label: 'm', state: 'unresolved', nodeIds: [] },
				{ key: 'c', label: 'c', state: 'unresolved', nodeIds: [] }
			],
			cycleNodeIds: []
		},
		onCreateDefiningNode: () => {}
	}}
	play={async ({ canvasElement }) => {
		const content = focusContent(canvasElement);
		expect(content.querySelector('[data-quantity-diagnostics]')).toBeInTheDocument();
		expect(content.querySelector('[data-diagnostic-quantity="m"]')).toHaveAttribute(
			'data-diagnostic-state',
			'unresolved'
		);
		// An unresolved quantity is an invitation to extend the graph.
		expect(content.querySelector('[data-create-defining-node="m"]')).toBeInTheDocument();
	}}
/>

<Story
	name="OffersAWayToReachAnOutOfViewDefiner"
	args={{
		node: makeNode('Weight is $$w = m g$$.'),
		diagnostics: {
			items: [{ key: 'g', label: 'g', state: 'out-of-view', nodeIds: ['gravity-node'] }],
			cycleNodeIds: []
		},
		titleForNodeId: () => 'Gravity',
		onJumpToNode: () => {}
	}}
	play={async ({ canvasElement }) => {
		const content = focusContent(canvasElement);
		expect(content.querySelector('[data-diagnostic-quantity="g"]')).toHaveAttribute(
			'data-diagnostic-state',
			'out-of-view'
		);
		// Reachable, and named, so it is not mistaken for an error.
		expect(content.querySelector('[data-reveal-node="gravity-node"]')).toHaveTextContent('Gravity');
		expect(content.querySelector('[data-create-defining-node="g"]')).not.toBeInTheDocument();
	}}
/>

<Story
	name="NamesTheCompetingDefinersOfAConflictingQuantity"
	args={{
		node: makeNode('Weight is $$w = m g$$.'),
		diagnostics: {
			items: [{ key: 'g', label: 'g', state: 'conflict', nodeIds: ['earth', 'moon'] }],
			cycleNodeIds: []
		},
		titleForNodeId: (nodeId) => (nodeId === 'earth' ? 'Earth' : 'Moon'),
		onJumpToNode: () => {}
	}}
	play={async ({ canvasElement }) => {
		const content = focusContent(canvasElement);
		expect(content.querySelector('[data-diagnostic-quantity="g"]')).toHaveAttribute(
			'data-diagnostic-state',
			'conflict'
		);
		expect(content.querySelector('[data-reveal-node="earth"]')).toHaveTextContent('Earth');
		expect(content.querySelector('[data-reveal-node="moon"]')).toHaveTextContent('Moon');
	}}
/>

<Story
	name="TellsANodeWhenItContradictsItself"
	args={{
		node: makeNode('Speed is $$v = 1$$, but also $$v = 2$$.'),
		diagnostics: {
			items: [{ key: 'v', label: 'v', state: 'self-conflict', nodeIds: [] }],
			cycleNodeIds: []
		},
		titleForNodeId: (nodeId) => nodeId,
		onJumpToNode: () => {}
	}}
	play={async ({ canvasElement }) => {
		const content = focusContent(canvasElement);
		const item = content.querySelector('[data-diagnostic-quantity="v"]');
		expect(item).toHaveAttribute('data-diagnostic-state', 'self-conflict');

		// The contradiction is in this node, so there is no other node to name and
		// nothing to navigate to. A reveal button here would point at the node the
		// reader is already looking at.
		expect(item?.querySelector('[data-reveal-node]')).toBeNull();
		expect(content).toHaveTextContent('is defined more than one way in this node');
	}}
/>

<Story
	name="SurfacesACycleAndNamesTheOtherNodesInIt"
	args={{
		node: makeNode('Circular: $$x = y$$.'),
		diagnostics: { items: [], cycleNodeIds: ['other'] },
		titleForNodeId: () => 'Other',
		onJumpToNode: () => {}
	}}
	play={async ({ canvasElement }) => {
		const content = focusContent(canvasElement);
		expect(content.querySelector('[data-diagnostic-state="cycle"]')).toBeInTheDocument();
		expect(content.querySelector('[data-reveal-node="other"]')).toHaveTextContent('Other');
	}}
/>

<Story
	name="PeekShowsEveryDefinerOfAConfirmedInput"
	args={{
		node: WEIGHT_NODE,
		quantities: nodeQuantities(WEIGHT_NODE),
		quantityEntryFor: entryLookup(G_DEFINED_TWICE),
		titleForNodeId: MOON_AND_EARTH_TITLES,
		onJumpToNode: fn()
	}}
	play={async ({ canvasElement }) => {
		const content = focusContent(canvasElement);
		const card = await peekAtG(canvasElement);

		// The question at an input chip is "what is this?", and flying the canvas
		// somewhere else to answer it costs the reader their place. So every node
		// claiming g comes to them, each with the equation it actually wrote.
		const rows = Array.from(card.querySelectorAll('[data-peek-definer]'));
		expect(rows.map((row) => row.getAttribute('data-peek-definer'))).toEqual(['earth', 'moon']);
		for (const row of rows) {
			expect(row.querySelector('math')).not.toBeNull();
		}
		// The equation is the answer, so it is the whole row. Repeating the node's
		// title above it would push what was asked for below what was not, and the
		// chip that opened the card already names the quantity overhead.
		expect(card.textContent).not.toContain('Earth');
		expect(card.textContent).not.toContain('Moon');
		expect(card.querySelector('header')).toBeNull();
		// Typeset as written — the source of a definition is never shown raw.
		expect(card.textContent).not.toContain('$');
		// The chip is marked rather than pressed: a three-state cycle button is not
		// a toggle, and the card's own role and label are what an assistive reader
		// hears.
		const chip = content.querySelector('[data-designation-key="g"]');
		expect(chip).toHaveAttribute('data-designation-peeking', 'true');
		expect(chip).not.toHaveAttribute('aria-pressed');
	}}
/>

<Story
	name="GoToNodeFromThePeekAsksToLeaveForTheDefiner"
	args={{
		node: WEIGHT_NODE,
		quantities: nodeQuantities(WEIGHT_NODE),
		quantityEntryFor: entryLookup(G_DEFINED_TWICE),
		titleForNodeId: MOON_AND_EARTH_TITLES,
		onJumpToNode: fn()
	}}
	play={async ({ canvasElement, args }) => {
		const card = await peekAtG(canvasElement);

		(card.querySelector('[data-peek-goto="moon"]') as HTMLElement).click();

		// Going there is an explicit choice rather than the price of asking, and it
		// names the definer the reader pointed at — not the quantity.
		const jumpSpy = args.onJumpToNode as unknown as JumpSpy;
		expect(jumpSpy.mock.calls.at(-1)?.[0]).toBe('moon');
		// The card closes with the canvas it was reading over.
		await waitFor(() => {
			expect(canvasElement.querySelector('[data-quantity-peek]')).not.toBeInTheDocument();
		});
	}}
/>

<Story
	name="PeekOffersToDefineAnInputNothingAnswers"
	args={{
		node: WEIGHT_NODE,
		quantities: nodeQuantities(WEIGHT_NODE),
		quantityEntryFor: entryLookup(G_UNDEFINED),
		onCreateDefiningNode: fn()
	}}
	play={async ({ canvasElement }) => {
		const card = await peekAtG(canvasElement);

		// An unresolved input is a claim the author made — "this node needs a value
		// for g" — so the answer to it is an offer to supply one.
		expect(card).toHaveTextContent('Nothing defines g yet.');
		expect(card.querySelector('[data-create-defining-node="g"]')).toBeInTheDocument();
		expect(card.querySelector('[data-peek-definer]')).toBeNull();
	}}
/>

<Story
	name="PeekNamesADefinerThatHasNoEquationLeftToShow"
	args={{
		node: WEIGHT_NODE,
		quantities: nodeQuantities(WEIGHT_NODE),
		quantityEntryFor: entryLookup(G_CLAIMED_WITHOUT_AN_EQUATION),
		titleForNodeId: MOON_AND_EARTH_TITLES,
		onJumpToNode: fn()
	}}
	play={async ({ canvasElement }) => {
		const card = await peekAtG(canvasElement);
		const row = card.querySelector('[data-peek-definer="earth"]');

		// It confirmed the output, so it is still a real answer to "who defines this"
		// and dropping it would make the peek disagree with the edge on screen. With
		// no equation to stand in for it, the row falls back to naming the node.
		expect(row).toHaveTextContent('Earth');
		expect(row?.querySelector('math')).toBeNull();
		expect(card.querySelector('[data-peek-goto="earth"]')).toBeInTheDocument();
	}}
/>

<Story
	name="TheWayOutIsStyledLikeTheWayThrough"
	args={{
		node: WEIGHT_NODE,
		quantities: nodeQuantities(WEIGHT_NODE),
		quantityEntryFor: entryLookup(G_DEFINED_TWICE),
		titleForNodeId: MOON_AND_EARTH_TITLES,
		onJumpToNode: fn()
	}}
	play={async ({ canvasElement }) => {
		const card = await peekAtG(canvasElement);
		const dismiss = card.querySelector('[aria-label="Close definition"]') as HTMLElement;
		const goto = card.querySelector('[data-peek-goto="earth"]') as HTMLElement;

		// Dismissing is a control the card offers, the same as going to a node, and
		// the bare glyph it used to be read as decoration — which is also what left
		// it sitting off the row buttons' baseline.
		const dismissStyle = getComputedStyle(dismiss);
		const gotoStyle = getComputedStyle(goto);
		for (const property of [
			'borderTopWidth',
			'borderTopStyle',
			'borderTopColor',
			'borderRadius',
			'backgroundColor',
			'color',
			'fontSize',
			'padding'
		] as const) {
			expect(dismissStyle[property]).toBe(gotoStyle[property]);
		}
		// Same box, not just the same paint: a taller or shorter control would still
		// look misaligned beside the row it shares an edge with.
		expect(dismiss.getBoundingClientRect().height).toBeCloseTo(
			goto.getBoundingClientRect().height,
			1
		);

		// The rows still clear the corner it sits in.
		expect(goto.getBoundingClientRect().right).toBeLessThanOrEqual(
			dismiss.getBoundingClientRect().left
		);
	}}
/>

<Story
	name="ShiftEnterOnAChipLandsInsideThePeekCard"
	args={{
		node: WEIGHT_NODE,
		quantities: nodeQuantities(WEIGHT_NODE),
		quantityEntryFor: entryLookup(G_DEFINED_TWICE),
		titleForNodeId: MOON_AND_EARTH_TITLES,
		onJumpToNode: fn(),
		onCycleDesignation: fn()
	}}
	play={async ({ canvasElement, args }) => {
		const chip = canvasElement.querySelector('[data-designation-key="g"]') as HTMLElement;
		chip.focus();
		// Plain Enter is the tap, so the keyboard asks its question with the modifier
		// — and the handler has to cancel the browser's own activation, or the chip
		// would answer and cycle at once.
		await userEvent.keyboard('{Shift>}{Enter}{/Shift}');

		const card = await waitFor(() => {
			const found = canvasElement.querySelector('[data-quantity-peek="g"]');
			expect(found).toBeInTheDocument();
			return found as HTMLElement;
		});
		expect((args.onCycleDesignation as unknown as CycleSpy).mock.calls).toHaveLength(0);

		// The card is what Shift+Enter opened, so the next Tab belongs to it. Leaving
		// focus on the chip would send the reader to the following quantity instead of
		// into the answer they just asked for.
		await waitFor(() => {
			expect(card.contains(document.activeElement)).toBe(true);
		});
		expect(document.activeElement).toHaveAttribute('data-peek-goto', 'earth');

		// Every control the card offers is reachable in order, the way out last.
		await userEvent.tab();
		expect(document.activeElement).toHaveAttribute('data-peek-goto', 'moon');
		await userEvent.tab();
		expect(document.activeElement).toHaveAttribute('aria-label', 'Close definition');

		await userEvent.keyboard('{Escape}');
		await waitFor(() => {
			expect(canvasElement.querySelector('[data-quantity-peek]')).not.toBeInTheDocument();
		});
		// Dismissing hands the reader back to the chip they asked from, not to the
		// top of the tab order.
		expect(document.activeElement).toBe(chip);
	}}
/>

<Story
	name="PeekRowsOfferTheDefinersOwnInputs"
	args={{ ...CASCADE_ARGS, onJumpToNode: fn() }}
	play={async ({ canvasElement }) => {
		const card = await peekAtG(canvasElement);

		// The next question after "what is g?" is "and what is that symbol?", so
		// each definer row offers the quantities that node itself takes in — read
		// off its confirmed designations, in the order the author put them.
		expect(drillKeys(definerRow(card, 'earth'))).toEqual(['m', 'r']);
		expect(drillKeys(definerRow(card, 'moon'))).toEqual(['m']);

		// A definer that consumes nothing has nothing to be asked about, and an
		// empty line under its equation would read as something missing.
		expect(definerRow(card, 'constant').querySelector('[data-peek-drill-line]')).toBeNull();
	}}
/>

<Story
	name="DrillingAnInputOpensANestedCardUnderThatRow"
	args={{ ...CASCADE_ARGS, onJumpToNode: fn() }}
	play={async ({ canvasElement }) => {
		const card = await peekAtG(canvasElement);
		const row = definerRow(card, 'earth');

		const nested = await drillInto(card, 'earth', 'm');

		// The answer belongs to the row that raised the question, so it hangs off
		// that row rather than replacing the card the reader is reading.
		expect(row.contains(nested)).toBe(true);
		expect(nested).toHaveAttribute('data-peek-depth', '1');
		expect(nested.querySelector('[data-peek-definer="mass"]')).toBeInTheDocument();
		// Indented, so the nesting is visible without reading the equations.
		expect(parseFloat(getComputedStyle(nested).marginLeft)).toBeGreaterThan(0);

		// A nested card claims no modality: every level stays visible and usable at
		// once, which is the opposite of what a dialog means.
		expect(nested).toHaveAttribute('role', 'group');
		expect(card).toHaveAttribute('role', 'dialog');

		expect(drillChip(row, 'm')).toHaveAttribute('aria-pressed', 'true');
	}}
/>

<Story
	name="ADrillChipTakesTheChipGestureRatherThanAPlainClick"
	args={{ ...CASCADE_ARGS, onJumpToNode: fn() }}
	play={async ({ canvasElement }) => {
		const card = await peekAtG(canvasElement);
		const chip = drillChip(definerRow(card, 'earth'), 'm');

		// A plain click opened these once, which meant a reader who had just held or
		// right-clicked a chip to get this card had to left-click the chip inside it
		// to go one level deeper — two identical-looking chips, two gestures.
		chip.click();
		// Long enough for the card a click used to open to have rendered. Asserting
		// on the next line instead passes either way: the DOM has not caught up yet,
		// so "nothing opened" and "something is about to" look identical.
		await sleep(100);
		expect(definerRow(card, 'earth').querySelector('[data-peek-path]')).toBeNull();

		// The hold is the same recognizer the column chips use, so the touch path
		// down a cascade is the touch path into it.
		await holdChip(chip);

		await waitFor(() => {
			expect(definerRow(card, 'earth').querySelector('[data-peek-path]')).toBeInTheDocument();
		});
	}}
/>

<Story
	name="TwoBranchesStayOpenUnderOneCard"
	args={{ ...CASCADE_ARGS, onJumpToNode: fn() }}
	play={async ({ canvasElement }) => {
		const card = await peekAtG(canvasElement);

		const underM = await drillInto(card, 'earth', 'm');
		const underR = await drillInto(card, 'earth', 'r');

		// Comparing is the whole point of the card, so opening the second question
		// must not collapse the first. This is a tree, not an accordion.
		expect(underM).toBeInTheDocument();
		expect(underR).toBeInTheDocument();
		expect(underM.querySelector('[data-peek-definer="mass"]')).toBeInTheDocument();
		expect(underR.querySelector('[data-peek-definer="radius"]')).toBeInTheDocument();
	}}
/>

<Story
	name="ClosingABranchClosesItsDescendants"
	args={{ ...CASCADE_ARGS, onJumpToNode: fn() }}
	play={async ({ canvasElement }) => {
		const card = await peekAtG(canvasElement);
		const underM = await drillInto(card, 'earth', 'm');
		const underRho = await drillInto(underM, 'mass', symbolOf('rho_0').key);
		expect(underRho).toBeInTheDocument();

		rightClickChip(drillChip(definerRow(card, 'earth'), 'm'));

		// The reader closed the question the deeper answers hang off; leaving them
		// on screen would strand them under nothing.
		await waitFor(() => {
			expect(underM).not.toBeInTheDocument();
		});
		expect(underRho).not.toBeInTheDocument();
		expect(drillChip(definerRow(card, 'earth'), 'm')).toHaveAttribute('aria-pressed', 'false');
	}}
/>

<Story
	name="AChipAlreadyOpenAboveRendersAsALoop"
	args={{ ...CASCADE_ARGS, onJumpToNode: fn() }}
	play={async ({ canvasElement }) => {
		const card = await peekAtG(canvasElement);
		const underM = await drillInto(card, 'earth', 'm');

		// g → m → g. Opening it would produce the card the reader is already inside,
		// forever, so the chip stays visible — the relationship is real — and says
		// what it is instead of pretending to be a way forward.
		const loop = drillChip(definerRow(underM, 'mass'), 'g');
		expect(loop.tagName).toBe('SPAN');
		expect(loop).toHaveAttribute('data-peek-loop', 'true');
		expect(loop).toHaveAttribute('title', 'Already open in this chain');
		expect(loop).not.toHaveAttribute('aria-pressed');

		await userEvent.click(loop);
		expect(definerRow(underM, 'mass').querySelector('[data-peek-path]')).toBeNull();

		// Its sibling on the same row is an ordinary question and stays openable.
		expect(drillChip(definerRow(underM, 'mass'), symbolOf('rho_0').key).tagName).toBe('BUTTON');
	}}
/>

<Story
	name="TheSameSymbolOpensIndependentlyUnderSiblingRows"
	args={{ ...CASCADE_ARGS, onJumpToNode: fn() }}
	play={async ({ canvasElement }) => {
		const card = await peekAtG(canvasElement);

		const underEarth = await drillInto(card, 'earth', 'm');
		const underMoon = await drillInto(card, 'moon', 'm');

		// Two definers of g both consuming m is ordinary, not circular, so neither
		// chip is a loop and each owns its own card.
		expect(underEarth).not.toBe(underMoon);
		expect(definerRow(card, 'earth').contains(underEarth)).toBe(true);
		expect(definerRow(card, 'moon').contains(underMoon)).toBe(true);

		rightClickChip(drillChip(definerRow(card, 'earth'), 'm'));

		await waitFor(() => {
			expect(underEarth).not.toBeInTheDocument();
		});
		expect(underMoon).toBeInTheDocument();
	}}
/>

<Story
	name="EnterOnADrillChipLandsInsideTheNestedCard"
	args={{ ...CASCADE_ARGS, onJumpToNode: fn() }}
	play={async ({ canvasElement }) => {
		const card = await peekAtG(canvasElement);
		const chip = drillChip(definerRow(card, 'earth'), 'm');
		chip.focus();

		await userEvent.keyboard('{Enter}');

		const nested = await waitFor(() => {
			const found = definerRow(card, 'earth').querySelector('[data-peek-path]');
			expect(found).toBeInTheDocument();
			return found as HTMLElement;
		});

		// Same contract as the chip that opened the root card: what Enter opened is
		// where the next Tab belongs, not the chip beside it.
		await waitFor(() => {
			expect(nested.contains(document.activeElement)).toBe(true);
		});
		expect(document.activeElement).toHaveAttribute('data-peek-goto', 'mass');
	}}
/>

<Story
	name="EscapeClosesTheCardHoldingFocusAndReturnsToItsChip"
	args={{ ...CASCADE_ARGS, onJumpToNode: fn() }}
	play={async ({ canvasElement }) => {
		const detailsChip = canvasElement.querySelector('[data-designation-key="g"]') as HTMLElement;
		const card = await peekAtG(canvasElement);
		const underM = await drillInto(card, 'earth', 'm');
		const rhoKey = symbolOf('rho_0').key;
		const underRho = await drillInto(underM, 'mass', rhoKey);
		await waitFor(() => {
			expect(underRho.contains(document.activeElement)).toBe(true);
		});

		// Escape means "close what I am in", so it walks out one level at a time
		// rather than throwing away every answer the reader has opened.
		await userEvent.keyboard('{Escape}');
		await waitFor(() => {
			expect(underRho).not.toBeInTheDocument();
		});
		expect(document.activeElement).toBe(drillChip(definerRow(underM, 'mass'), rhoKey));

		await userEvent.keyboard('{Escape}');
		await waitFor(() => {
			expect(underM).not.toBeInTheDocument();
		});
		expect(document.activeElement).toBe(drillChip(definerRow(card, 'earth'), 'm'));

		await userEvent.keyboard('{Escape}');
		await waitFor(() => {
			expect(canvasElement.querySelector('[data-peek-path]')).not.toBeInTheDocument();
		});
		// And out of the cascade entirely, back to the chip that started it.
		expect(document.activeElement).toBe(detailsChip);
	}}
/>

<Story
	name="AnUnresolvedInputAtDepthOffersToDefineItThere"
	args={{ ...CASCADE_ARGS, onCreateDefiningNode: fn() }}
	play={async ({ canvasElement, args }) => {
		const card = await peekAtG(canvasElement);
		const underR = await drillInto(card, 'earth', 'r');
		const underT = await drillInto(underR, 'radius', symbolOf('T_0').key);

		expect(underT).toHaveTextContent('Nothing defines T_0 yet.');
		(underT.querySelector('[data-create-defining-node="T_0"]') as HTMLElement).click();

		// The offer belongs to the card that made it. Seeding the new node with the
		// quantity the reader was reading three levels up would define the wrong
		// thing — and would look right, because the label came from here. The
		// consumer rides along too, so the new node lands beside the node whose
		// input this is (radius), not beside the node the reader is focused on.
		const createSpy = args.onCreateDefiningNode as unknown as {
			mock: { calls: Array<[string, string, string | undefined]> };
		};
		expect(createSpy.mock.calls.at(-1)).toEqual(['T_0', symbolOf('T_0').key, 'radius']);
	}}
/>

<Story
	name="GoToNodeAtDepthLeavesForTheDefinerAndClosesEverything"
	args={{ ...CASCADE_ARGS, onJumpToNode: fn() }}
	play={async ({ canvasElement, args }) => {
		const card = await peekAtG(canvasElement);
		const underM = await drillInto(card, 'earth', 'm');

		(underM.querySelector('[data-peek-goto="mass"]') as HTMLElement).click();

		// Going there names the definer the reader pointed at, however deep it was,
		// and the whole cascade goes with the canvas it was reading over.
		const jumpSpy = args.onJumpToNode as unknown as JumpSpy;
		expect(jumpSpy.mock.calls.at(-1)?.[0]).toBe('mass');
		await waitFor(() => {
			expect(canvasElement.querySelector('[data-peek-path]')).not.toBeInTheDocument();
		});
	}}
/>

<Story
	name="TheCascadeScrollsInsteadOfEscapingTheOverlay"
	args={{ ...CHAIN_ARGS, onJumpToNode: fn() }}
	play={async ({ canvasElement }) => {
		const root = await peekAt(canvasElement, 'a');

		let card = root;
		for (let level = 0; level + 1 < CHAIN_LABELS.length; level += 1) {
			card = await drillInto(
				card,
				`n-${CHAIN_LABELS[level]}`,
				symbolOf(CHAIN_LABELS[level + 1]).key
			);
		}
		expect(root.querySelector('[data-peek-depth="6"]')).toBeInTheDocument();

		// The focus overlay has no scroll container on purpose — wheel input has to
		// reach the ZoomWorld underneath — and its pan clamp puts below-frame
		// content out of reach. So the card scrolls, or a deep cascade is lost.
		const scroller = root.querySelector('[data-peek-scroll]') as HTMLElement;
		expect(getComputedStyle(scroller).overflowY).toBe('auto');
		// And the marker that makes ZoomWorld hand the wheel to it while it has room.
		expect(scroller).toHaveAttribute('data-zoom-scroll');
		await waitFor(() => {
			expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
		});

		// Depth is unbounded but the indent is not: past four steps it costs more
		// width than it buys, and the enclosing borders already show the nesting.
		const indentAt = (depth: number) =>
			getComputedStyle(root.querySelector(`[data-peek-depth="${depth}"]`) as HTMLElement)
				.marginLeft;
		expect(indentAt(4)).not.toBe(indentAt(3));
		expect(indentAt(5)).toBe(indentAt(4));
		expect(indentAt(6)).toBe(indentAt(4));
	}}
/>

<Story
	name="HoldingTheChipAgainTakesTheQuestionBack"
	args={{ ...CASCADE_ARGS, onJumpToNode: fn(), onCycleDesignation: fn() }}
	play={async ({ canvasElement, args }) => {
		const chip = canvasElement.querySelector('[data-designation-key="g"]') as HTMLElement;
		await peekAtG(canvasElement);
		expect(chip).toHaveAttribute('data-designation-peeking', 'true');

		await holdChip(chip);

		// The chip is marked as the one being asked about, so the same gesture has to
		// take the question back — and the hold that closed the card must not leave a
		// cycle behind it when the pointer lifts.
		await waitFor(() => {
			expect(canvasElement.querySelector('[data-peek-path]')).not.toBeInTheDocument();
		});
		chip.click();
		expect(chip).not.toHaveAttribute('data-designation-peeking');
		expect((args.onCycleDesignation as unknown as CycleSpy).mock.calls).toHaveLength(0);
		expect(document.activeElement).toBe(chip);
	}}
/>

<Story
	name="ClickingAViewChipCyclesItsDesignation"
	args={{
		node: WEIGHT_NODE,
		quantities: nodeQuantities(WEIGHT_NODE),
		quantityEntryFor: entryLookup(G_DEFINED_TWICE),
		onCycleDesignation: fn()
	}}
	play={async ({ canvasElement, args }) => {
		// Changing what a quantity is used to mean a round trip through the edit
		// sheet. The chip already knows which quantity it is and which column it is
		// in, so the tap that used to only ask can decide.
		viewChip(canvasElement, 'g').click();

		const cycleSpy = args.onCycleDesignation as unknown as CycleSpy;
		expect(cycleSpy.mock.calls.at(-1)).toEqual([symbolOf('g'), 'input']);
		// Asking is now the other gesture, so a tap opens nothing.
		expect(canvasElement.querySelector('[data-peek-path]')).not.toBeInTheDocument();
	}}
/>

<Story
	name="ALongPressDoesNotAlsoCycle"
	args={{
		node: WEIGHT_NODE,
		quantities: nodeQuantities(WEIGHT_NODE),
		quantityEntryFor: entryLookup(G_DEFINED_TWICE),
		titleForNodeId: MOON_AND_EARTH_TITLES,
		onCycleDesignation: fn(),
		onJumpToNode: fn()
	}}
	play={async ({ canvasElement, args }) => {
		const chip = viewChip(canvasElement, 'g');

		await holdChip(chip);
		await waitFor(() => {
			expect(canvasElement.querySelector('[data-peek-path=""]')).toBeInTheDocument();
		});

		// A real button gets a real click after the pointer lifts, whatever the hold
		// already did with it. Swallowing that click is the whole reason the
		// suppression exists — and clearing it when the pointer lifts, rather than
		// when the click arrives, is how this quietly stops working.
		chip.click();

		expect((args.onCycleDesignation as unknown as CycleSpy).mock.calls).toHaveLength(0);
		expect(canvasElement.querySelector('[data-peek-path=""]')).toBeInTheDocument();

		// And the next tap is an ordinary one: the suppression covers one click, not
		// every click after a hold.
		chip.click();
		expect((args.onCycleDesignation as unknown as CycleSpy).mock.calls).toHaveLength(1);
	}}
/>

<Story
	name="HoldingAChipOpensItsDefinition"
	args={{
		node: WEIGHT_NODE,
		quantities: nodeQuantities(WEIGHT_NODE),
		quantityEntryFor: entryLookup(G_DEFINED_TWICE),
		titleForNodeId: MOON_AND_EARTH_TITLES,
		onCycleDesignation: fn(),
		onJumpToNode: fn()
	}}
	play={async ({ canvasElement }) => {
		const chip = viewChip(canvasElement, 'g');
		await holdChip(chip);

		// Hold is "tell me more" everywhere else on this canvas, so it is what asks
		// the question the tap used to.
		const card = await waitFor(() => {
			const found = canvasElement.querySelector('[data-quantity-peek="g"]');
			expect(found).toBeInTheDocument();
			return found as HTMLElement;
		});
		expect(card.querySelectorAll('[data-peek-definer]')).toHaveLength(2);
		expect(chip).toHaveAttribute('data-designation-peeking', 'true');
	}}
/>

<Story
	name="AMouseHoldOpensItsDefinitionToo"
	args={{
		node: WEIGHT_NODE,
		quantities: nodeQuantities(WEIGHT_NODE),
		quantityEntryFor: entryLookup(G_DEFINED_TWICE),
		titleForNodeId: MOON_AND_EARTH_TITLES,
		onCycleDesignation: fn(),
		onJumpToNode: fn()
	}}
	play={async ({ canvasElement, args }) => {
		const chip = viewChip(canvasElement, 'g');

		// Right-click is the fast desktop path, not the only one: a reader who
		// learned this gesture on a phone should not have to learn a second one to
		// ask the same question with a mouse.
		await holdChip(chip, 'mouse');

		await waitFor(() => {
			expect(canvasElement.querySelector('[data-quantity-peek="g"]')).toBeInTheDocument();
		});
		chip.click();
		expect((args.onCycleDesignation as unknown as CycleSpy).mock.calls).toHaveLength(0);
	}}
/>

<Story
	name="RightClickStillAnswersAfterAHoldThatLostItsClick"
	args={{
		node: WEIGHT_NODE,
		quantities: nodeQuantities(WEIGHT_NODE),
		quantityEntryFor: entryLookup(G_DEFINED_TWICE),
		titleForNodeId: MOON_AND_EARTH_TITLES,
		onCycleDesignation: fn(),
		onJumpToNode: fn()
	}}
	play={async ({ canvasElement }) => {
		// A hold answers, then arms a flag to swallow the click still on its way. If
		// the finger wanders off the chip before lifting, that click lands on an
		// ancestor instead and the flag is never spent.
		await holdChip(viewChip(canvasElement, 'g'));
		await waitFor(() => {
			expect(canvasElement.querySelector('[data-quantity-peek="g"]')).toBeInTheDocument();
		});

		// Read as the bare "a hold just answered", one leftover flag made the
		// right-click on every chip do nothing at all — and `preventDefault` had
		// already taken the browser's own menu away, so the reader got no answer
		// from either surface.
		rightClickChip(viewChip(canvasElement, 'm'));

		await waitFor(() => {
			expect(canvasElement.querySelector('[data-quantity-peek="m"]')).toBeInTheDocument();
		});
	}}
/>

<Story
	name="RightClickOnAnOutputChipListsEveryDefiner"
	args={{
		node: WEIGHT_NODE,
		quantities: nodeQuantities(WEIGHT_NODE),
		quantityEntryFor: wEntryLookup,
		titleForNodeId: (nodeId: string) => nodeId,
		onCycleDesignation: fn(),
		onJumpToNode: fn()
	}}
	play={async ({ canvasElement }) => {
		const chip = viewChip(canvasElement, 'w');
		expect(chip).toHaveAttribute('data-designation-role', 'output');

		const card = await peekAt(canvasElement, 'w');

		// An output used to answer nothing, which hid the one thing a reader most
		// needs to see: this node says w is one thing and another node says it is
		// something else. The card names both, so the disagreement is visible from
		// the node that has it.
		const rows = Array.from(card.querySelectorAll('[data-peek-definer]'));
		expect(rows.map((row) => row.getAttribute('data-peek-definer'))).toEqual(['node-1', 'scales']);
		for (const row of rows) {
			expect(row.querySelector('math')).not.toBeNull();
		}
	}}
/>

<Story
	name="ThePeekOffersNoWayToTheNodeYouAreAlreadyIn"
	args={{
		node: WEIGHT_NODE,
		currentNodeId: 'node-1',
		quantities: nodeQuantities(WEIGHT_NODE),
		quantityEntryFor: wEntryLookup,
		titleForNodeId: (nodeId: string) => nodeId,
		onJumpToNode: fn()
	}}
	play={async ({ canvasElement }) => {
		const card = await peekAt(canvasElement, 'w');

		// `w` is an output, so its card looks downstream — and the reader's own
		// definition is not an answer to "what uses this". It is on screen above the
		// chips anyway, which is the reason it is not repeated here.
		expect(card.querySelector('[data-peek-definer="node-1"]')).toBeNull();

		// The disagreement still surfaces, which is what the output card existed
		// for before it changed direction: somebody else defines w, differently.
		const also = card.querySelector('[data-peek-also-defined]') as HTMLElement;
		expect(also.querySelector('[data-peek-definer="scales"]')).toBeInTheDocument();
		expect(card.querySelector('[data-peek-goto="scales"]')).toBeInTheDocument();
	}}
/>

<Story
	name="HoldingAGhostChipAnswersWithoutConfirmingIt"
	args={{
		node: WEIGHT_NODE,
		quantities: nodeQuantities(WEIGHT_NODE),
		onCycleDesignation: fn()
	}}
	play={async ({ canvasElement, args }) => {
		const ghost = viewChip(canvasElement, 'm');
		expect(ghost).toHaveAttribute('data-designation-role', 'suggestion');

		await holdChip(ghost);

		// "What is this?" is a fair question about a quantity nobody has decided
		// about yet — and asking it must not be mistaken for answering it.
		await waitFor(() => {
			expect(canvasElement.querySelector('[data-quantity-peek="m"]')).toHaveTextContent(
				'Nothing defines m yet.'
			);
		});
		expect((args.onCycleDesignation as unknown as CycleSpy).mock.calls).toHaveLength(0);
	}}
/>

<Story
	name="ChipTitlesNameBothGestures"
	args={{
		node: WEIGHT_NODE,
		quantities: nodeQuantities(WEIGHT_NODE),
		quantityEntryFor: entryLookup(G_DEFINED_TWICE),
		onCycleDesignation: fn()
	}}
	play={async ({ canvasElement }) => {
		// A chip that does two things has to say both, or the hold is a secret and
		// the tap is a surprise.
		const title = viewChip(canvasElement, 'g').getAttribute('title') ?? '';
		expect(title).toContain('Make g an output');
		expect(title).toContain('hold or right-click to see where it is defined');

		expect(viewChip(canvasElement, 'm').getAttribute('title')).toContain('Label m as an input');
	}}
/>

<Story
	name="ConfirmingAGhostFromTheDetailsViewTakesOneTap"
	play={async ({ canvasElement }) => {
		const ghost = viewChip(canvasElement, 'm');
		expect(ghost).toHaveAttribute('data-designation-role', 'suggestion');

		ghost.click();

		// The parser put the ghost in the column it belongs in, so confirming it is
		// one tap where it stands — not a trip through the edit sheet and back.
		await waitFor(() => {
			expect(viewChip(canvasElement, 'm')).toHaveAttribute('data-designation-role', 'input');
		});
		const inputs = canvasElement.querySelector('ul[aria-label="Input quantities"]') as HTMLElement;
		expect(inputs.querySelector('[data-designation-key="m"]')).toBeInTheDocument();
	}}
>
	{#snippet template()}
		<NodeDetailsContent
			node={ghostNode}
			quantities={nodeQuantities(ghostNode)}
			onCycleDesignation={(symbol, suggestedRole) =>
				(ghostNode = cycledNode(ghostNode, symbol, suggestedRole))}
		/>
	{/snippet}
</Story>

<Story
	name="PeekShowsAnUnconfirmedDefinerAsAGhostRow"
	args={{
		node: WEIGHT_NODE,
		quantities: nodeQuantities(WEIGHT_NODE),
		quantityEntryFor: entryLookup(G_WRITTEN_BUT_UNCONFIRMED),
		titleForNodeId: (nodeId: string) => nodeId,
		onJumpToNode: fn(),
		onConfirmDefiner: fn()
	}}
	play={async ({ canvasElement }) => {
		const card = await peekAtG(canvasElement);
		const row = definerRow(card, 'gravity');

		// Somebody has written what g is. Saying "nothing defines g" over that is
		// false, so the equation shows — marked as the offer it is rather than as
		// part of what the graph does.
		expect(row).toHaveAttribute('data-peek-definer-state', 'unconfirmed');
		expect(row.querySelector('math')).not.toBeNull();
		expect(card).not.toHaveTextContent('Nothing defines g yet.');

		// Both ways forward: read it where it lives, or agree with it from here.
		expect(row.querySelector('[data-peek-goto="gravity"]')).toBeInTheDocument();
		expect(row.querySelector('[data-peek-confirm="gravity"]')).toBeInTheDocument();
	}}
/>

<Story
	name="PeekOffersNoDefineWhenSomethingAlreadyWritesIt"
	args={{
		node: WEIGHT_NODE,
		quantities: nodeQuantities(WEIGHT_NODE),
		quantityEntryFor: entryLookup(G_WRITTEN_BUT_UNCONFIRMED),
		titleForNodeId: (nodeId: string) => nodeId,
		onCreateDefiningNode: fn(),
		onConfirmDefiner: fn()
	}}
	play={async ({ canvasElement }) => {
		const card = await peekAtG(canvasElement);

		// The trap this closes: the empty state offered to define g, and taking the
		// offer produced a second node saying exactly what `gravity` already says.
		// Define belongs to the case where truly nothing states the quantity.
		expect(card.querySelector('[data-create-defining-node="g"]')).not.toBeInTheDocument();
		expect(card.querySelector('[data-peek-definer="gravity"]')).toBeInTheDocument();
	}}
/>

<Story
	name="TheNodesOwnUnconfirmedEquationAnswersItsOwnChip"
	args={{ ...OWN_EQUATION_ARGS, onJumpToNode: fn(), onConfirmDefiner: fn() }}
	play={async ({ canvasElement }) => {
		// The reported bug was a node titled `$y = 1$` being told nothing defined y
		// — by the card hanging under its own equation. `y` is what this node
		// produces, so its chip sits in the outputs and its card looks downstream:
		// the false claim is not merely corrected, it is not made.
		const card = await peekAt(canvasElement, 'y');

		expect(card).not.toHaveTextContent('Nothing defines y yet.');
		expect(card).toHaveTextContent('Nothing uses y yet.');
		expect(card.querySelector('[data-peek-definer="node-1"]')).toBeNull();
	}}
/>

<Story
	name="ConfirmingFromThePeekNamesTheDefinerNotTheReader"
	args={{
		node: WEIGHT_NODE,
		currentNodeId: 'node-1',
		quantities: nodeQuantities(WEIGHT_NODE),
		quantityEntryFor: entryLookup(G_WRITTEN_BUT_UNCONFIRMED),
		titleForNodeId: (nodeId: string) => nodeId,
		onJumpToNode: fn(),
		onConfirmDefiner: fn()
	}}
	play={async ({ canvasElement, args }) => {
		const card = await peekAtG(canvasElement);

		(card.querySelector('[data-peek-confirm="gravity"]') as HTMLElement).click();

		// The designation belongs to the node that wrote the equation, not to the
		// node the reader happens to be standing in. Confirming on the reader would
		// claim it defines a quantity it only consumes.
		const confirmSpy = args.onConfirmDefiner as unknown as ConfirmSpy;
		expect(confirmSpy.mock.calls.at(-1)).toEqual(['gravity', 'g']);
	}}
/>

<Story
	name="ConfirmingInANestedCardConfirmsThatCardsQuantity"
	args={{ ...CASCADE_ARGS, onJumpToNode: fn(), onConfirmDefiner: fn() }}
	play={async ({ canvasElement, args }) => {
		const card = await peekAtG(canvasElement);
		const underM = await drillInto(card, 'earth', 'm');

		(underM.querySelector('[data-peek-confirm="scales"]') as HTMLElement).click();

		// The offer belongs to the card that made it. Confirming g — the quantity
		// the reader started from one level up — would look right and be wrong,
		// exactly as Define at depth would.
		const confirmSpy = args.onConfirmDefiner as unknown as ConfirmSpy;
		expect(confirmSpy.mock.calls.at(-1)).toEqual(['scales', 'm']);
	}}
/>

<Story
	name="OpeningTheCardFocusesSomethingThatChangesNothing"
	args={{
		node: WEIGHT_NODE,
		currentNodeId: 'node-1',
		quantities: nodeQuantities(WEIGHT_NODE),
		quantityEntryFor: entryLookup(G_WRITTEN_BUT_UNCONFIRMED),
		titleForNodeId: (nodeId: string) => nodeId,
		onConfirmDefiner: fn()
	}}
	play={async ({ canvasElement, args }) => {
		// An input chip, where the confirm offer lives: asking who defines `g`
		// turns up a node whose text says so without anyone having confirmed it.
		const card = await peekAt(canvasElement, 'g');

		// With no "Go to node" on a self row, the card's mount focus lands on the
		// confirm button — which is fine, and only fine because focus is not
		// activation. A card that committed a designation by opening would rewrite
		// the graph every time somebody asked a question.
		await waitFor(() => {
			expect(card.contains(document.activeElement)).toBe(true);
		});
		expect(document.activeElement).toHaveAttribute('data-peek-goto', 'gravity');
		expect((args.onConfirmDefiner as unknown as ConfirmSpy).mock.calls).toHaveLength(0);
	}}
/>

<Story
	name="AnUnconfirmedRowReadsAsAnOfferNotAFact"
	args={{
		node: WEIGHT_NODE,
		quantities: nodeQuantities(WEIGHT_NODE),
		quantityEntryFor: entryLookup(G_CONFIRMED_AND_WRITTEN),
		titleForNodeId: (nodeId: string) => nodeId,
		onJumpToNode: fn(),
		onConfirmDefiner: fn()
	}}
	play={async ({ canvasElement }) => {
		const card = await peekAtG(canvasElement);
		const confirmed = definerRow(card, 'earth').querySelector('.definition') as HTMLElement;
		const offered = definerRow(card, 'moon').querySelector('.definition') as HTMLElement;
		// The ghost chip the reader has already learned to read as "not decided yet".
		const ghostChip = viewChip(canvasElement, 'm');

		expect(definerRow(card, 'earth')).toHaveAttribute('data-peek-definer-state', 'confirmed');
		expect(definerRow(card, 'moon')).toHaveAttribute('data-peek-definer-state', 'unconfirmed');

		// Same visual language as the ghost chip, so nothing new has to be learned:
		// faint means written down and not yet agreed to.
		const offeredStyle = getComputedStyle(offered);
		const ghostStyle = getComputedStyle(ghostChip);
		expect(offeredStyle.opacity).toBe(ghostStyle.opacity);
		expect(offeredStyle.color).toBe(ghostStyle.color);

		// And a confirmed row is not faded, or the distinction says nothing.
		const confirmedStyle = getComputedStyle(confirmed);
		expect(confirmedStyle.opacity).not.toBe(offeredStyle.opacity);

		// Opacity is not an accessible signal, so the control says it in words.
		expect(card.querySelector('[data-peek-confirm="moon"]')).toHaveAttribute(
			'aria-label',
			'Label g as an output of moon'
		);
		expect(card.querySelector('[data-peek-confirm="earth"]')).toBeNull();
	}}
/>

<Story
	name="SaysAQuantityIsWrittenButUnconfirmed"
	args={{
		node: makeNode('Weight is $$w = m g$$.'),
		diagnostics: {
			items: [{ key: 'g', label: 'g', state: 'unconfirmed', nodeIds: ['gravity'] }],
			cycleNodeIds: []
		},
		titleForNodeId: () => 'Gravity',
		onJumpToNode: fn(),
		onCreateDefiningNode: fn(),
		onConfirmDefiner: fn()
	}}
	play={async ({ canvasElement, args }) => {
		const content = focusContent(canvasElement);
		const item = content.querySelector('[data-diagnostic-quantity="g"]') as HTMLElement;

		// "is not defined anywhere" was wrong here, and the Define button beside it
		// was worse: the graph already contains the answer and needs one tap, not a
		// second node saying the same thing.
		expect(item).toHaveAttribute('data-diagnostic-state', 'unconfirmed');
		expect(item).toHaveTextContent('is written but not labeled as an output in');
		expect(content.querySelector('[data-create-defining-node="g"]')).not.toBeInTheDocument();

		// The node that wrote it is named, so the reader can go read it — and
		// agreed with in place, so they do not have to.
		expect(item.querySelector('[data-reveal-node="gravity"]')).toHaveTextContent('Gravity');
		(item.querySelector('[data-confirm-definer="gravity"]') as HTMLElement).click();
		expect((args.onConfirmDefiner as unknown as ConfirmSpy).mock.calls.at(-1)).toEqual([
			'gravity',
			'g'
		]);
	}}
/>

<Story
	name="SaysAQuantityIsMislabeledWhenThisNodeWroteIt"
	args={{
		...OWN_EQUATION_ARGS,
		node: { ...OWN_EQUATION_NODE, inputs: designations('y') },
		diagnostics: {
			items: [{ key: 'y', label: 'y', state: 'self-unconfirmed', nodeIds: [] }],
			cycleNodeIds: []
		},
		onJumpToNode: fn(),
		onCreateDefiningNode: fn(),
		onConfirmDefiner: fn()
	}}
	play={async ({ canvasElement, args }) => {
		const content = focusContent(canvasElement);
		const item = content.querySelector('[data-diagnostic-quantity="y"]') as HTMLElement;

		// The reader is told which rule read their equation as a definition, since
		// that rule is the one thing on this row they cannot see for themselves.
		expect(item).toHaveAttribute('data-diagnostic-state', 'self-unconfirmed');
		expect(item).toHaveTextContent('is labeled as an input');
		expect(item).toHaveTextContent('alone on the left of “=”');

		// The reported bug: the row named the node it was rendered in, so the way
		// out of a mislabel was a jump to the page the reader was already on —
		// which pushed that page into its own trail.
		expect(item.querySelector('[data-reveal-node]')).not.toBeInTheDocument();
		// And no offer to define it: this node already does.
		expect(content.querySelector('[data-create-defining-node="y"]')).not.toBeInTheDocument();

		// The repair is this node's own label, moved.
		const relabel = item.querySelector('[data-confirm-definer="node-1"]') as HTMLElement;
		expect(relabel).toHaveTextContent('Relabel as output');
		relabel.click();
		expect((args.onConfirmDefiner as unknown as ConfirmSpy).mock.calls.at(-1)).toEqual([
			'node-1',
			'y'
		]);
	}}
/>

<Story
	name="TheChipKeepsFocusAfterItChangesColumn"
	play={async ({ canvasElement }) => {
		const chip = viewChip(canvasElement, 'g');
		chip.focus();

		await userEvent.keyboard('{Enter}');

		// Cycling moves the chip from one column's list to the other, which destroys
		// and rebuilds it — so a keyboard reader would be dropped at the top of the
		// page by the very keystroke that worked.
		await waitFor(() => {
			const outputs = canvasElement.querySelector(
				'ul[aria-label="Output quantities"]'
			) as HTMLElement;
			expect(outputs.querySelector('[data-designation-key="g"]')).toBeInTheDocument();
		});
		expect(document.activeElement).toHaveAttribute('data-designation-key', 'g');
		expect(document.activeElement).not.toBe(chip);
	}}
>
	{#snippet template()}
		<NodeDetailsContent
			node={focusNode}
			quantities={nodeQuantities(focusNode)}
			onCycleDesignation={(symbol, suggestedRole) =>
				(focusNode = cycledNode(focusNode, symbol, suggestedRole))}
		/>
	{/snippet}
</Story>

<Story
	name="TwoChipsOpenTwoCardsOnePerColumn"
	args={{ ...BOTH_DIRECTIONS_ARGS, onJumpToNode: fn() }}
	play={async ({ canvasElement }) => {
		rightClickChip(viewChip(canvasElement, 'g'));
		await waitFor(() => expect(columnCards(canvasElement, 'input')).toHaveLength(1));

		// Asking a second question keeps the first answer: the whole point is the
		// comparison, and a card that closed on the next press would forbid it.
		rightClickChip(viewChip(canvasElement, 'w'));
		await waitFor(() => expect(columnCards(canvasElement, 'output')).toHaveLength(1));
		expect(columnCards(canvasElement, 'input')).toHaveLength(1);

		// Each card sits under the column its question came from, and both chips
		// read as pressed while their card is open.
		expect(cardLabels(canvasElement, 'input')).toEqual(['g']);
		expect(cardLabels(canvasElement, 'output')).toEqual(['w']);
		expect(viewChip(canvasElement, 'g')).toHaveAttribute('data-designation-peeking', 'true');
		expect(viewChip(canvasElement, 'w')).toHaveAttribute('data-designation-peeking', 'true');
	}}
/>

<Story
	name="AThirdCardOpensWithoutClosingTheSecond"
	args={{ ...BOTH_DIRECTIONS_ARGS, onJumpToNode: fn() }}
	play={async ({ canvasElement }) => {
		// The guard that made this impossible exempted only the open card and its
		// own anchor, so pressing a third chip counted as a press outside the second
		// card and closed it on the way in — a permanent cap of two.
		for (const key of ['g', 'm', 'w']) {
			rightClickChip(viewChip(canvasElement, key));
			await sleep(0);
		}

		await waitFor(() => expect(allCards(canvasElement)).toHaveLength(3));
		expect(cardLabels(canvasElement, 'input')).toEqual(['g', 'm']);
		expect(cardLabels(canvasElement, 'output')).toEqual(['w']);
	}}
/>

<Story
	name="AnOutputCardAnswersWithItsConsumers"
	args={{ ...BOTH_DIRECTIONS_ARGS, onJumpToNode: fn() }}
	play={async ({ canvasElement }) => {
		const card = await peekAt(canvasElement, 'w');

		expect(card).toHaveAttribute('data-peek-direction', 'downstream');
		// The nodes that take w as a confirmed input, each with the way to them.
		expect(card.querySelector('[data-peek-consumer="scales"]')).toBeInTheDocument();
		expect(card.querySelector('[data-peek-consumer="crane"]')).toBeInTheDocument();
		expect(card.querySelector('[data-peek-goto="crane"]')).toBeInTheDocument();

		// Nothing else defines w here, so the conflict section is absent rather
		// than empty — it exists to be alarming, and an always-on heading is not.
		expect(card.querySelector('[data-peek-also-defined]')).toBeNull();
		expect(card.querySelector('[data-peek-definer="node-1"]')).toBeNull();
	}}
/>

<Story
	name="AnOutsidePressClosesTheNewestCardOnly"
	args={{ ...BOTH_DIRECTIONS_ARGS, onJumpToNode: fn() }}
	play={async ({ canvasElement }) => {
		for (const key of ['g', 'w']) {
			rightClickChip(viewChip(canvasElement, key));
			await sleep(0);
		}
		await waitFor(() => expect(allCards(canvasElement)).toHaveLength(2));

		// Newest first, so the reader unwinds the way they built it up — and one at
		// a time, so a stray press costs one card rather than the comparison.
		pressOutside(canvasElement);
		await waitFor(() => expect(allCards(canvasElement)).toHaveLength(1));
		expect(cardLabels(canvasElement, 'input')).toEqual(['g']);

		pressOutside(canvasElement);
		await waitFor(() => expect(allCards(canvasElement)).toHaveLength(0));
	}}
/>

<Story
	name="CardsHoldChipOrderWhateverOrderTheyWereOpenedIn"
	args={{ ...BOTH_DIRECTIONS_ARGS, onJumpToNode: fn() }}
	play={async ({ canvasElement }) => {
		// Opened second, but `g` is the first input chip, so its card is first.
		rightClickChip(viewChip(canvasElement, 'm'));
		await sleep(0);
		rightClickChip(viewChip(canvasElement, 'g'));
		await waitFor(() => expect(columnCards(canvasElement, 'input')).toHaveLength(2));

		expect(cardLabels(canvasElement, 'input')).toEqual(['g', 'm']);
	}}
/>

<Story
	name="ACardOutlivesTheDesignationThatOpenedIt"
	args={{ ...BOTH_DIRECTIONS_ARGS, onCycleDesignation: fn(), onJumpToNode: fn() }}
	play={async ({ canvasElement }) => {
		const card = await peekAt(canvasElement, 'g');
		expect(card).toBeInTheDocument();

		// Cycling the chip is an edit, not a withdrawal of the question. The card
		// keeps its place until the reader dismisses it, which is what lets a
		// comparison survive a change made while reading it.
		viewChip(canvasElement, 'g').click();
		await sleep(0);

		expect(columnCards(canvasElement, 'input')).toHaveLength(1);
		expect(cardLabels(canvasElement, 'input')).toEqual(['g']);
	}}
/>

<Story
	name="AFileAttachmentIsListedWithAWayToOpenIt"
	play={async ({ canvasElement }) => {
		// The canvas node announces the file with a count glyph; the row below is
		// where the name, type and size actually live.
		const badge = canvasElement.querySelector('[data-addon-badge="attachments"]');
		expect(badge).toBeInTheDocument();
		expect(badge).toHaveAttribute('aria-label', '1 attachment');

		const row = await waitFor(() => {
			const found = canvasElement.querySelector('[data-file-asset-id="asset-csv"]');
			expect(found).toBeInTheDocument();
			return found as HTMLElement;
		});
		expect(cellText(row, 'data-file-name')).toBe('measurements.csv');
		expect(cellText(row, 'data-file-type')).toBe('text/csv');
		expect(cellText(row, 'data-file-size')).toBe('8 B');
		expect(cellText(row, 'data-file-caption')).toBe('Rig run 3');

		// A link rather than a scripted `window.open`, so nothing here opens a
		// window: the story reads the href the reader's tap would follow.
		const open = await waitFor(() => {
			const found = row.querySelector('[data-file-open]');
			expect(found).toBeInstanceOf(HTMLAnchorElement);
			return found as HTMLAnchorElement;
		});
		expect(open.href.startsWith('blob:')).toBe(true);
		expect(open.target).toBe('_blank');
		expect(open.rel).toBe('noopener');
	}}
>
	{#snippet template()}
		<NodeDetailsHarness
			baseGraph={fileGraph()}
			nodeId="node-1"
			assetStore={csvStore()}
			assetScope="story"
		/>
	{/snippet}
</Story>

<Story
	name="AFileWhoseBlobIsMissingSaysSo"
	play={async ({ canvasElement }) => {
		const row = canvasElement.querySelector('[data-file-asset-id="asset-csv"]');
		expect(row).toBeInTheDocument();
		// The document still names it, the way a missing image still names its
		// asset; the store simply has no copy in this profile.
		expect(cellText(row as HTMLElement, 'data-file-name')).toBe('measurements.csv');
		await waitFor(() =>
			expect((row as HTMLElement).querySelector('[data-file-unavailable]')).toBeInTheDocument()
		);
		expect((row as HTMLElement).querySelector('[data-file-open]')).toBeNull();
	}}
>
	{#snippet template()}
		<NodeDetailsHarness
			baseGraph={fileGraph()}
			nodeId="node-1"
			assetStore={new MemoryGraphAssetStore()}
			assetScope="story"
		/>
	{/snippet}
</Story>

<Story
	name="TheTaskControlShowsNotDone"
	args={{
		node: taskNode(false),
		currentNodeId: 'node-1',
		onToggleTaskDone: fn()
	}}
	play={async ({ canvasElement }) => {
		const toggle = taskToggle(canvasElement);
		expect(toggle).toHaveAttribute('data-task-done', 'false');
		expect(toggle).toHaveAttribute('aria-pressed', 'false');
		expect(toggle.textContent).toContain('Not done');
	}}
/>

<Story
	name="TheTaskControlShowsDone"
	args={{
		node: taskNode(true),
		currentNodeId: 'node-1',
		onToggleTaskDone: fn()
	}}
	play={async ({ canvasElement }) => {
		const toggle = taskToggle(canvasElement);
		expect(toggle).toHaveAttribute('data-task-done', 'true');
		expect(toggle).toHaveAttribute('aria-pressed', 'true');
		expect(toggle.textContent).toContain('Done');
	}}
/>

<Story
	name="TogglingDoneUpdatesTheBadgeAndMutesTheTitle"
	play={async ({ canvasElement }) => {
		expect(badgeGlyph(canvasElement)).toBe('☐');
		expect(canvasElement.querySelector('.node')).not.toHaveAttribute('data-task-done');
		const litTitle = titleColor(canvasElement);

		await userEvent.click(taskToggle(canvasElement));

		await waitFor(() => expect(badgeGlyph(canvasElement)).toBe('☑'));
		expect(canvasElement.querySelector('.node')).toHaveAttribute('data-task-done', 'true');
		expect(titleColor(canvasElement)).toBe('rgb(100, 116, 139)');
		expect(titleColor(canvasElement)).not.toBe(litTitle);
		expect(harnessState(canvasElement)).toHaveAttribute('data-last-intent', 'mark task done');

		// And back, which is the undo path's label as well as the reader's.
		await userEvent.click(taskToggle(canvasElement));

		await waitFor(() => expect(badgeGlyph(canvasElement)).toBe('☐'));
		expect(canvasElement.querySelector('.node')).not.toHaveAttribute('data-task-done');
		expect(harnessState(canvasElement)).toHaveAttribute('data-last-intent', 'mark task not done');
	}}
>
	{#snippet template()}
		<NodeDetailsHarness baseGraph={taskGraph()} nodeId="node-1" />
	{/snippet}
</Story>
