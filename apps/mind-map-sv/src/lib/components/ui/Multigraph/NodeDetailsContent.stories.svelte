<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, userEvent, waitFor } from 'storybook/test';
	import NodeDetailsContent from './NodeDetailsContent.svelte';
	import type { NodeData, QuantityDesignation } from '../types/node';
	import { symbolFor, type QuantitySymbol } from '../MathText/lib/mathSymbols';
	import { nodeQuantities } from './lib/nodeQuantities';
	import type { QuantityIndexEntry } from './lib/quantityIndex';
	import { designations } from './lib/testFixtures';

	function makeNode(description: string): NodeData {
		return { id: 'node-1', title: 'Kinematics', description, tags: [] };
	}

	const PROSE_ONLY = 'First line.\nSecond line.\n\nAfter a blank line.';

	type JumpSpy = { mock: { calls: Array<[string]> } };

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
		consumerNodeIds: ['node-1']
	};

	/** Confirmed the output, but its text no longer states it — nothing to render. */
	const G_CLAIMED_WITHOUT_AN_EQUATION: QuantityIndexEntry = {
		symbol: symbolFor('g', null),
		definerNodeIds: ['earth'],
		definitions: [],
		consumerNodeIds: ['node-1']
	};

	/** Confirmed as an input, and nothing anywhere answers it. */
	const G_UNDEFINED: QuantityIndexEntry = {
		symbol: symbolFor('g', null),
		definerNodeIds: [],
		definitions: [],
		consumerNodeIds: ['node-1']
	};

	const entryLookup = (entry: QuantityIndexEntry) => (key: string) =>
		key === 'g' ? entry : undefined;

	const MOON_AND_EARTH_TITLES = (nodeId: string) => (nodeId === 'earth' ? 'Earth' : 'Moon');

	/** Open the peek for one confirmed input, the way a reader does. */
	async function peekAt(canvasElement: HTMLElement, key: string): Promise<HTMLElement> {
		const chip = canvasElement.querySelector(
			`[data-designation-chips="view"] [data-designation-key="${key}"]`
		);
		if (!(chip instanceof HTMLElement)) throw new Error(`no view chip for ${key}`);
		chip.click();

		return await waitFor(() => {
			// The root card, specifically: nested cards carry the same label attribute.
			const card = canvasElement.querySelector('[data-peek-path=""]');
			expect(card).toBeInTheDocument();
			return card as HTMLElement;
		});
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

	/** Drill one of a definer's inputs and wait for the card it opens. */
	async function drillInto(
		card: HTMLElement,
		definerNodeId: string,
		key: string
	): Promise<HTMLElement> {
		const chip = drillChip(definerRow(card, definerNodeId), key);
		const pathKey = chip.getAttribute('data-peek-drill-path') ?? '';
		chip.click();

		return await waitFor(() => {
			const nested = card.querySelector(`[data-peek-path="${pathKey}"]`);
			expect(nested).toBeInTheDocument();
			return nested as HTMLElement;
		});
	}

	function entryOf(
		label: string,
		definers: ReadonlyArray<readonly [string, string | null]>
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
	 * sharing an input, a chain back to the root quantity, and an unresolved
	 * subscripted quantity two levels down.
	 */
	const CASCADE_ENTRIES = new Map<string, QuantityIndexEntry>([
		entryOf('g', [
			['constant', 'g = 9.8'],
			['earth', 'g = G m / r^2'],
			['moon', 'g = 1.6']
		]),
		entryOf('m', [['mass', 'm = \\rho_0 V']]),
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
		expect(content.querySelector('[data-designation-key="g"]')).toHaveAttribute(
			'aria-pressed',
			'true'
		);
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
	name="KeyboardEnterOnAChipLandsInsideThePeekCard"
	args={{
		node: WEIGHT_NODE,
		quantities: nodeQuantities(WEIGHT_NODE),
		quantityEntryFor: entryLookup(G_DEFINED_TWICE),
		titleForNodeId: MOON_AND_EARTH_TITLES,
		onJumpToNode: fn()
	}}
	play={async ({ canvasElement }) => {
		const chip = canvasElement.querySelector('[data-designation-key="g"]') as HTMLElement;
		chip.focus();
		await userEvent.keyboard('{Enter}');

		const card = await waitFor(() => {
			const found = canvasElement.querySelector('[data-quantity-peek="g"]');
			expect(found).toBeInTheDocument();
			return found as HTMLElement;
		});

		// The card is what Enter opened, so the next Tab belongs to it. Leaving focus
		// on the chip would send the reader to the following quantity instead of into
		// the answer they just asked for.
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

		drillChip(definerRow(card, 'earth'), 'm').click();

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

		drillChip(definerRow(card, 'earth'), 'm').click();

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
		// thing — and would look right, because the label came from here.
		const createSpy = args.onCreateDefiningNode as unknown as {
			mock: { calls: Array<[string, string]> };
		};
		expect(createSpy.mock.calls.at(-1)).toEqual(['T_0', symbolOf('T_0').key]);
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
	name="TappingTheChipAgainTakesTheQuestionBack"
	args={{ ...CASCADE_ARGS, onJumpToNode: fn() }}
	play={async ({ canvasElement }) => {
		const chip = canvasElement.querySelector('[data-designation-key="g"]') as HTMLElement;
		await peekAtG(canvasElement);
		expect(chip).toHaveAttribute('aria-pressed', 'true');

		chip.click();

		// The chip reads as pressed, so it has to un-press: the tap that asked the
		// question is the obvious way to take it back.
		await waitFor(() => {
			expect(canvasElement.querySelector('[data-peek-path]')).not.toBeInTheDocument();
		});
		expect(chip).toHaveAttribute('aria-pressed', 'false');
		expect(document.activeElement).toBe(chip);
	}}
/>
