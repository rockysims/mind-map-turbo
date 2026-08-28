<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import DataflowHarness from './DataflowHarness.svelte';
	import { expect, waitFor } from 'storybook/test';
	import { makeGraph } from './lib/testFixtures';

	const { Story } = defineMeta({
		title: 'Components/Multigraph/Dataflow',
		component: DataflowHarness,
		tags: []
	});

	type PlayContext = { canvasElement: HTMLElement };

	/**
	 * `a` defines g, `c` will come to consume it. The authored chain a–b–c keeps
	 * `c` two hops from the pinned node, so switching the layout toggle on has a
	 * visible effect to assert.
	 */
	const CHAIN = makeGraph({
		nodes: [
			{ id: 'a', title: 'Gravity', description: '$$g = 9.8$$' },
			{ id: 'b', title: 'Middle', description: 'No math here.' },
			{ id: 'c', title: 'Weight', description: '' }
		],
		pinned: ['a'],
		edges: [
			['a', 'b'],
			['b', 'c']
		],
		posByNodeId: {
			a: { x: -260, y: 0 },
			b: { x: 0, y: 0 },
			c: { x: 260, y: 0 }
		}
	});

	const CONSUMES_G = '$$w = m g$$';

	const derivedEdge = (canvasElement: HTMLElement) =>
		canvasElement.querySelector('[data-edge-id="dataflow:a->c"]');

	const nodeGeometry = (canvasElement: HTMLElement) =>
		Array.from(canvasElement.querySelectorAll('[data-node-id]')).map((element) => {
			const node = element as HTMLElement;
			return `${node.dataset.nodeId}:${node.dataset.scale}:${node.style.transform}`;
		});

	const click = async (canvasElement: HTMLElement, selector: string) => {
		(canvasElement.querySelector(selector) as HTMLElement).click();
		await waitFor(() => expect(canvasElement.querySelector('.node')).toBeInTheDocument());
	};
</script>

<Story
	name="ArrowAppearsAndDisappearsWithTheEquation"
	args={{ baseGraph: CHAIN, editNodeId: 'c', equation: CONSUMES_G }}
	play={async ({ canvasElement }: PlayContext) => {
		await waitFor(() => expect(canvasElement.querySelector('.edge')).toBeInTheDocument());
		expect(derivedEdge(canvasElement)).not.toBeInTheDocument();

		await click(canvasElement, '[data-add-equation]');
		await waitFor(() => expect(derivedEdge(canvasElement)).toBeInTheDocument());

		// Inferred dataflow is always directed, definer to consumer.
		expect(derivedEdge(canvasElement)).toHaveAttribute('data-directed', 'true');
		expect(derivedEdge(canvasElement)).toHaveAttribute('data-source-node-id', 'a');
		expect(derivedEdge(canvasElement)).toHaveAttribute('data-target-node-id', 'c');

		await click(canvasElement, '[data-remove-equation]');
		await waitFor(() => expect(derivedEdge(canvasElement)).not.toBeInTheDocument());
	}}
/>

<Story
	name="AuthoredEdgesSurviveTheDataflowLayer"
	args={{ baseGraph: CHAIN, editNodeId: 'c', equation: CONSUMES_G }}
	play={async ({ canvasElement }: PlayContext) => {
		await waitFor(() => expect(canvasElement.querySelector('.edge')).toBeInTheDocument());
		const authoredEdgeIds = () =>
			Array.from(canvasElement.querySelectorAll('.edge'))
				.map((edge) => (edge as HTMLElement).dataset.edgeId ?? '')
				.filter((id) => !id.startsWith('dataflow:'))
				.sort();

		const before = authoredEdgeIds();
		await click(canvasElement, '[data-add-equation]');
		await waitFor(() => expect(derivedEdge(canvasElement)).toBeInTheDocument());

		expect(authoredEdgeIds()).toEqual(before);
	}}
/>

<Story
	name="LayoutIsUnchangedWhenDataflowDoesNotFeedIt"
	args={{ baseGraph: CHAIN, editNodeId: 'c', equation: CONSUMES_G, dataflowInLayout: false }}
	play={async ({ canvasElement }: PlayContext) => {
		await waitFor(() => expect(canvasElement.querySelector('.edge')).toBeInTheDocument());
		const before = nodeGeometry(canvasElement);

		await click(canvasElement, '[data-add-equation]');
		await waitFor(() => expect(derivedEdge(canvasElement)).toBeInTheDocument());

		// The arrow is drawn, but nothing about node placement or scale moved.
		expect(nodeGeometry(canvasElement)).toEqual(before);
	}}
/>

<Story
	name="LayoutRespondsWhenDataflowFeedsIt"
	args={{ baseGraph: CHAIN, editNodeId: 'c', equation: CONSUMES_G, dataflowInLayout: true }}
	play={async ({ canvasElement }: PlayContext) => {
		await waitFor(() => expect(canvasElement.querySelector('.edge')).toBeInTheDocument());
		const scaleOfC = () =>
			Number(
				(canvasElement.querySelector('[data-node-id="c"]') as HTMLElement | null)?.dataset.scale
			);
		const before = scaleOfC();

		await click(canvasElement, '[data-add-equation]');
		await waitFor(() => expect(derivedEdge(canvasElement)).toBeInTheDocument());

		// `c` was two authored hops from the pinned node; the derived edge from `a`
		// brings it to one, so it scales up.
		expect(scaleOfC()).toBeGreaterThan(before);
	}}
/>

<Story
	name="GraphWithoutMathDrawsOnlyAuthoredEdges"
	args={{
		baseGraph: makeGraph({
			nodes: [
				{ id: 'a', title: 'One', description: 'Just prose.' },
				{ id: 'b', title: 'Two', description: 'More prose.' }
			],
			pinned: ['a'],
			edges: [['a', 'b']],
			posByNodeId: { a: { x: -160, y: 0 }, b: { x: 160, y: 0 } }
		}),
		editNodeId: 'b',
		equation: 'Still just prose.'
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitFor(() => expect(canvasElement.querySelector('.edge')).toBeInTheDocument());
		const edgeIds = Array.from(canvasElement.querySelectorAll('.edge')).map(
			(edge) => (edge as HTMLElement).dataset.edgeId
		);
		expect(edgeIds.some((id) => id?.startsWith('dataflow:'))).toBe(false);
	}}
/>

<Story
	name="DerivedEdgesAreDistinguishableFromAuthoredOnes"
	args={{ baseGraph: CHAIN, editNodeId: 'c', equation: CONSUMES_G, startWithEquation: true }}
	play={async ({ canvasElement }: PlayContext) => {
		await waitFor(() => expect(derivedEdge(canvasElement)).toBeInTheDocument());

		expect(derivedEdge(canvasElement)).toHaveAttribute('data-edge-derived', 'true');
		expect(derivedEdge(canvasElement)).toHaveClass('derived');

		// The authored edges alongside it carry neither.
		for (const edge of Array.from(canvasElement.querySelectorAll('.edge'))) {
			const element = edge as HTMLElement;
			if (element.dataset.edgeId?.startsWith('dataflow:')) continue;
			expect(element).not.toHaveClass('derived');
			expect(element.dataset.edgeDerived).toBeUndefined();
		}
	}}
/>

<Story
	name="QuantityLabelRevealsWhenZoomedIn"
	args={{
		baseGraph: CHAIN,
		editNodeId: 'c',
		equation: CONSUMES_G,
		startWithEquation: true,
		initialViewState: { panX: 0, panY: 0, scale: 1.4 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitFor(() => expect(derivedEdge(canvasElement)).toBeInTheDocument());
		await waitFor(() =>
			expect(
				canvasElement.querySelector('[data-edge-quantity-label="dataflow:a->c"]')
			).toBeInTheDocument()
		);
		expect(
			canvasElement.querySelector('[data-edge-quantity-label="dataflow:a->c"]')
		).toHaveTextContent('g');
	}}
/>

<Story
	name="QuantityLabelStaysHiddenWhenZoomedOut"
	args={{
		baseGraph: CHAIN,
		editNodeId: 'c',
		equation: CONSUMES_G,
		startWithEquation: true,
		initialViewState: { panX: 0, panY: 0, scale: 0.35 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitFor(() => expect(derivedEdge(canvasElement)).toBeInTheDocument());
		// The arrow still reads at graph scale; the text would only be clutter.
		expect(
			canvasElement.querySelector('[data-edge-quantity-label="dataflow:a->c"]')
		).not.toBeInTheDocument();
	}}
/>

<Story
	name="BundledQuantitiesShareOneLabelledEdge"
	args={{
		baseGraph: makeGraph({
			nodes: [
				{ id: 'a', title: 'Constants', description: '$$g = 9.8$$ and $$m = 5$$' },
				{ id: 'b', title: 'Middle', description: 'No math here.' },
				{ id: 'c', title: 'Weight', description: '' }
			],
			pinned: ['a'],
			edges: [
				['a', 'b'],
				['b', 'c']
			],
			posByNodeId: {
				a: { x: -260, y: 0 },
				b: { x: 0, y: 0 },
				c: { x: 260, y: 0 }
			}
		}),
		editNodeId: 'c',
		equation: '$$w = m g$$',
		startWithEquation: true,
		initialViewState: { panX: 0, panY: 0, scale: 1.4 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitFor(() => expect(derivedEdge(canvasElement)).toBeInTheDocument());

		// Two quantities flow along the pair, but they read as one arrow.
		const derivedEdges = Array.from(canvasElement.querySelectorAll('.edge')).filter((edge) =>
			(edge as HTMLElement).dataset.edgeId?.startsWith('dataflow:')
		);
		expect(derivedEdges).toHaveLength(1);

		await waitFor(() =>
			expect(
				canvasElement.querySelector('[data-edge-quantity-label="dataflow:a->c"]')
			).toBeInTheDocument()
		);
		expect(
			canvasElement.querySelector('[data-edge-quantity-label="dataflow:a->c"]')
		).toHaveTextContent('g, m');
	}}
/>
