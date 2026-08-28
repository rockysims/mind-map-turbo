<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, userEvent, waitFor } from 'storybook/test';
	import NodeDetailsContent from './NodeDetailsContent.svelte';
	import type { NodeData } from '../types/node';
	import { symbolFor } from '../MathText/lib/mathSymbols';
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

	/** Open the peek for the one confirmed input, the way a reader does. */
	async function peekAtG(canvasElement: HTMLElement): Promise<HTMLElement> {
		const chip = canvasElement.querySelector('[data-designation-role="input"]');
		expect(chip).toHaveAttribute('data-designation-key', 'g');
		(chip as HTMLElement).click();

		return await waitFor(() => {
			const card = canvasElement.querySelector('[data-quantity-peek="g"]');
			expect(card).toBeInTheDocument();
			return card as HTMLElement;
		});
	}

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
