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

	const nodeGeometry = (canvasElement: HTMLElement, nodeId?: string) =>
		Array.from(
			canvasElement.querySelectorAll(
				nodeId === undefined ? '[data-node-id]' : `[data-node-id="${nodeId}"]`
			)
		).map((element) => {
			const node = element as HTMLElement;
			return `${node.dataset.nodeId}:${node.dataset.scale}:${node.style.transform}`;
		});

	/**
	 * An authored chain longer than the layers on show. With `displayedLayers` at
	 * 2 only a, b and c are visible; `e` is four authored hops out and hidden,
	 * which is the case where a dataflow arrow trailed off into nothing.
	 */
	const CHAIN_BEYOND_LAYERS = makeGraph({
		nodes: [
			{ id: 'a', title: 'Gravity', description: '$$g = 9.8$$' },
			{ id: 'b', title: 'Second', description: '' },
			{ id: 'c', title: 'Third', description: '' },
			{ id: 'd', title: 'Fourth', description: '' },
			{ id: 'e', title: 'Weight', description: '' }
		],
		pinned: ['a'],
		edges: [
			['a', 'b'],
			['b', 'c'],
			['c', 'd'],
			['d', 'e']
		],
		posByNodeId: {
			a: { x: -400, y: 0 },
			b: { x: -200, y: 0 },
			c: { x: 0, y: 0 },
			d: { x: 200, y: 0 },
			e: { x: 400, y: 0 }
		}
	});

	const TWO_LAYERS = { displayedLayers: 2, relaxIterations: 0 };

	const nodeOnCanvas = (canvasElement: HTMLElement, nodeId: string) =>
		canvasElement.querySelector(`[data-node-id="${nodeId}"]`);

	/**
	 * root -dataflow-> a -authored-> b, where `b` is on screen in its own right
	 * as its component's beacon (it has pin history, which wins the slot). Both
	 * used to sit at the flat beacon hop with nothing relating them.
	 */
	const BEHIND_A_CONSUMER = makeGraph({
		nodes: [
			{ id: 'root', title: 'Gravity', description: '$$g = 9.8$$' },
			{ id: 'a', title: 'Weight', description: '' },
			{ id: 'b', title: 'Behind', description: '', lastPinnedSeq: 1 }
		],
		pinned: ['root'],
		edges: [['a', 'b']],
		posByNodeId: {
			root: { x: -300, y: 0 },
			a: { x: 0, y: 0 },
			b: { x: 300, y: 0 }
		}
	});

	/**
	 * The same shape with nothing pinned. `root` and `b` each light a beacon of
	 * their own on the authored edges, so both used to sit at the flat beacon
	 * hop while `a`, the one actually next to `root`, came out smaller than
	 * either. `root` was pinned most recently, so it is where reading starts.
	 */
	const BEHIND_A_CONSUMER_UNPINNED = makeGraph({
		nodes: [
			{ id: 'root', title: 'Gravity', description: '$$g = 9.8$$', lastPinnedSeq: 2 },
			{ id: 'a', title: 'Weight', description: '' },
			{ id: 'b', title: 'Behind', description: '', lastPinnedSeq: 1 }
		],
		pinned: [],
		edges: [['a', 'b']],
		posByNodeId: {
			root: { x: -300, y: 0 },
			a: { x: 0, y: 0 },
			b: { x: 300, y: 0 }
		}
	});

	/**
	 * `a` defines two quantities and the pair d–e consumes one each, so both are
	 * pulled in by a dataflow edge. Joined to each other, they land in the same
	 * component once on screen, where only one of them can be the beacon — the
	 * shape that had the other rendering at the minimum scale.
	 */
	const TWO_CONSUMERS = makeGraph({
		nodes: [
			{ id: 'a', title: 'Constants', description: '$$g = 9.8$$ and $$m = 5$$' },
			{ id: 'b', title: 'Neighbor', description: '' },
			{ id: 'd', title: 'Momentum', description: '$$p = m$$' },
			{ id: 'e', title: 'Weight', description: '' }
		],
		pinned: ['a'],
		edges: [
			['a', 'b'],
			['d', 'e']
		],
		posByNodeId: {
			a: { x: -300, y: 0 },
			b: { x: -100, y: 0 },
			d: { x: 100, y: 0 },
			e: { x: 300, y: 0 }
		}
	});

	/**
	 * `a` defines g and `c` consumes it, with no authored edge anywhere. Any
	 * movement between them has to come from the derived edge.
	 */
	const UNCONNECTED_PAIR = makeGraph({
		nodes: [
			{ id: 'a', title: 'Gravity', description: '$$g = 9.8$$' },
			{ id: 'c', title: 'Weight', description: '' }
		],
		pinned: ['a'],
		edges: [],
		posByNodeId: { a: { x: -300, y: 0 }, c: { x: 300, y: 0 } }
	});

	/**
	 * Hop repulsion off so the only force in play is the edge spring, and nodes
	 * small enough that the fixture spacing sits well outside the spring's dead
	 * band — at the default radius these nodes are already close enough to be at
	 * rest, and nothing would move no matter how hard the edge pulled.
	 */
	const SPRINGS_ONLY = { hopRepulsionStrength: 0, baseRadius: 40 };

	const FIXED_VIEW = { panX: 0, panY: 0, scale: 1 };

	const centerOf = (canvasElement: HTMLElement, nodeId: string) => {
		const rect = (
			canvasElement.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement
		).getBoundingClientRect();
		return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
	};

	const distanceBetween = (canvasElement: HTMLElement, fromId: string, toId: string) => {
		const from = centerOf(canvasElement, fromId);
		const to = centerOf(canvasElement, toId);
		return Math.hypot(to.x - from.x, to.y - from.y);
	};

	const scaleOf = (canvasElement: HTMLElement, nodeId: string) =>
		(canvasElement.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement | null)?.dataset
			.scale;

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
	name="ANodeTheDataflowDoesNotTouchIsLeftAlone"
	args={{ baseGraph: CHAIN, editNodeId: 'c', equation: CONSUMES_G, dataflowInLayout: false }}
	play={async ({ canvasElement }: PlayContext) => {
		await waitFor(() => expect(canvasElement.querySelector('.edge')).toBeInTheDocument());
		const before = nodeGeometry(canvasElement, 'b');

		await click(canvasElement, '[data-add-equation]');
		await waitFor(() => expect(derivedEdge(canvasElement)).toBeInTheDocument());

		// `b` neither defines nor consumes, so the new arrow says nothing about how
		// far away it is and leaves its placement and size exactly as they were.
		expect(nodeGeometry(canvasElement, 'b')).toEqual(before);
	}}
/>

<Story
	name="DataflowPullsNodesTogetherWithoutAnAuthoredEdge"
	args={{
		baseGraph: UNCONNECTED_PAIR,
		editNodeId: 'c',
		equation: CONSUMES_G,
		dataflowInLayout: false,
		layoutSettings: SPRINGS_ONLY,
		initialViewState: FIXED_VIEW
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitFor(() => expect(canvasElement.querySelector('.node')).toBeInTheDocument());
		const before = distanceBetween(canvasElement, 'a', 'c');

		await click(canvasElement, '[data-add-equation]');
		await waitFor(() => expect(derivedEdge(canvasElement)).toBeInTheDocument());

		// Nothing else connects these two, so the equation alone moved them.
		await waitFor(() => expect(distanceBetween(canvasElement, 'a', 'c')).toBeLessThan(before));
	}}
/>

<Story
	name="ADataflowLinkRevealsANodeBeyondTheVisibleLayers"
	args={{
		baseGraph: CHAIN_BEYOND_LAYERS,
		editNodeId: 'e',
		equation: CONSUMES_G,
		layoutSettings: TWO_LAYERS
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitFor(() => expect(nodeOnCanvas(canvasElement, 'a')).toBeInTheDocument());
		// Four authored hops out with only two layers on show.
		expect(nodeOnCanvas(canvasElement, 'e')).not.toBeInTheDocument();

		await click(canvasElement, '[data-add-equation]');

		// Consuming g puts `e` beside the node that defines it, rather than leaving
		// an arrow pointing at somewhere the reader cannot go.
		await waitFor(() => expect(nodeOnCanvas(canvasElement, 'e')).toBeInTheDocument());
	}}
/>

<Story
	name="ARevealedNodeIsTheSameSizeAsAnAuthoredNeighbor"
	args={{
		baseGraph: TWO_CONSUMERS,
		editNodeId: 'e',
		equation: CONSUMES_G,
		startWithEquation: true,
		layoutSettings: TWO_LAYERS
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitFor(() => expect(nodeOnCanvas(canvasElement, 'e')).toBeInTheDocument());

		// `b` is one authored edge from the pinned node and `e` is one dataflow edge
		// from it. Both are one step away, so both read as the same size.
		expect(scaleOf(canvasElement, 'e')).toBe(scaleOf(canvasElement, 'b'));
	}}
/>

<Story
	name="ANodeBehindADataflowLinkIsSizedAHopFurtherOut"
	args={{
		baseGraph: BEHIND_A_CONSUMER,
		editNodeId: 'a',
		equation: CONSUMES_G,
		startWithEquation: true,
		layoutSettings: { relaxIterations: 0 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitFor(() => expect(nodeOnCanvas(canvasElement, 'b')).toBeInTheDocument());

		// `b` reaches the pin only by going through `a`, so it is one step further
		// out and reads smaller. It stays on screen either way — it is the beacon
		// for its cluster — this is about size alone.
		expect(Number(scaleOf(canvasElement, 'b'))).toBeLessThan(Number(scaleOf(canvasElement, 'a')));
	}}
/>

<Story
	name="SizeStillFollowsDistanceWithNothingPinned"
	args={{
		baseGraph: BEHIND_A_CONSUMER_UNPINNED,
		editNodeId: 'a',
		equation: CONSUMES_G,
		startWithEquation: true,
		layoutSettings: { relaxIterations: 0 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitFor(() => expect(nodeOnCanvas(canvasElement, 'b')).toBeInTheDocument());

		// Reading starts at `root` and falls away from there, rather than `root`
		// and `b` both claiming to be a start because the author drew no edge
		// between the two clusters the equation joins.
		expect(Number(scaleOf(canvasElement, 'a'))).toBeLessThan(
			Number(scaleOf(canvasElement, 'root'))
		);
		expect(Number(scaleOf(canvasElement, 'b'))).toBeLessThan(Number(scaleOf(canvasElement, 'a')));
	}}
/>

<Story
	name="ARevealedNodeDoesNotBringItsNeighborsAlong"
	args={{
		baseGraph: CHAIN_BEYOND_LAYERS,
		editNodeId: 'e',
		equation: CONSUMES_G,
		startWithEquation: true,
		layoutSettings: TWO_LAYERS
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitFor(() => expect(nodeOnCanvas(canvasElement, 'e')).toBeInTheDocument());

		// `d` is `e`'s own authored neighbor and stays hidden. One equation must not
		// open up a cluster the author never connected to the pinned node.
		expect(nodeOnCanvas(canvasElement, 'd')).not.toBeInTheDocument();
	}}
/>

<Story
	name="AZeroSpringFactorLeavesTheLayoutAlone"
	args={{
		baseGraph: UNCONNECTED_PAIR,
		editNodeId: 'c',
		equation: CONSUMES_G,
		dataflowInLayout: false,
		layoutSettings: { ...SPRINGS_ONLY, derivedEdgeSpringFactor: 0 },
		initialViewState: FIXED_VIEW
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitFor(() => expect(canvasElement.querySelector('.node')).toBeInTheDocument());
		const before = distanceBetween(canvasElement, 'a', 'c');

		await click(canvasElement, '[data-add-equation]');
		await waitFor(() => expect(derivedEdge(canvasElement)).toBeInTheDocument());

		// The arrow is still drawn; turning the factor down to nothing only takes
		// away its say in where the nodes sit.
		expect(distanceBetween(canvasElement, 'a', 'c')).toBeCloseTo(before, 6);
	}}
/>

<Story
	name="PullingAlsoSizesTheConsumerByItsNewDistance"
	args={{
		baseGraph: CHAIN,
		editNodeId: 'c',
		equation: CONSUMES_G,
		dataflowInLayout: false,
		layoutSettings: SPRINGS_ONLY,
		initialViewState: FIXED_VIEW
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitFor(() => expect(canvasElement.querySelector('.node')).toBeInTheDocument());
		const scaleBefore = scaleOf(canvasElement, 'c');
		const distanceBefore = distanceBetween(canvasElement, 'a', 'c');

		await click(canvasElement, '[data-add-equation]');
		await waitFor(() => expect(derivedEdge(canvasElement)).toBeInTheDocument());
		await waitFor(() =>
			expect(distanceBetween(canvasElement, 'a', 'c')).toBeLessThan(distanceBefore)
		);

		// `c` was two authored hops out and consuming g puts it one dataflow hop
		// from the pinned node, so it grows to the size of `b` — also one hop away,
		// by an edge the author drew rather than one an equation implied.
		expect(scaleOf(canvasElement, 'c')).not.toBe(scaleBefore);
		expect(scaleOf(canvasElement, 'c')).toBe(scaleOf(canvasElement, 'b'));
	}}
/>

<Story
	name="LayoutRespondsWhenDataflowFeedsIt"
	args={{
		baseGraph: CHAIN_BEYOND_LAYERS,
		editNodeId: 'e',
		equation: CONSUMES_G,
		startWithEquation: true,
		dataflowInLayout: true,
		layoutSettings: TWO_LAYERS
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitFor(() => expect(nodeOnCanvas(canvasElement, 'e')).toBeInTheDocument());

		// With the toggle on a dataflow edge is a step through the graph like any
		// other, so `d` rides in behind `e`. This is the whole of what the toggle
		// still decides: size follows the dataflow link either way, and only here
		// does one equation open up a cluster the author never joined to the pin.
		expect(nodeOnCanvas(canvasElement, 'd')).toBeInTheDocument();
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

<Story
	name="DefinedQuantitiesShowOnALargeCompactNode"
	args={{
		baseGraph: CHAIN,
		editNodeId: 'c',
		equation: CONSUMES_G,
		startWithEquation: true,
		initialViewState: { panX: 0, panY: 0, scale: 1 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitFor(() => expect(canvasElement.querySelector('.node')).toBeInTheDocument());

		const chips = () =>
			canvasElement.querySelector(
				'[data-node-id="a"] [data-node-quantities]'
			) as HTMLElement | null;
		await waitFor(() => expect(chips()).toBeInTheDocument());
		expect(chips()).toHaveTextContent('g');

		// The definer shows its chip; a node that defines nothing shows no row at all.
		expect(
			canvasElement.querySelector('[data-node-id="b"] [data-node-quantities]')
		).not.toBeInTheDocument();
	}}
/>

<Story
	name="QuantityChipsStayHiddenWhenNodesAreSmall"
	args={{
		baseGraph: CHAIN,
		editNodeId: 'c',
		equation: CONSUMES_G,
		startWithEquation: true,
		initialViewState: { panX: 0, panY: 0, scale: 0.25 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitFor(() => expect(canvasElement.querySelector('.node')).toBeInTheDocument());
		expect(
			canvasElement.querySelector('[data-node-id="a"] [data-node-quantities]')
		).not.toBeInTheDocument();
	}}
/>

<Story
	name="ChipsDoNotSwallowPointerEventsFromTheNode"
	args={{
		baseGraph: CHAIN,
		editNodeId: 'c',
		equation: CONSUMES_G,
		startWithEquation: true,
		initialViewState: { panX: 0, panY: 0, scale: 1 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitFor(() =>
			expect(
				canvasElement.querySelector('[data-node-id="a"] [data-node-quantities]')
			).toBeInTheDocument()
		);

		// Hit testing is geometric against the node circle, so a chip that captured
		// pointer events would read as a dead zone that refuses to start a drag.
		const chipRow = canvasElement.querySelector(
			'[data-node-id="a"] [data-node-quantities]'
		) as HTMLElement;
		expect(getComputedStyle(chipRow).pointerEvents).toBe('none');
	}}
/>

<Story
	name="TitleLayoutIsUnchangedForANodeDefiningNothing"
	args={{ baseGraph: CHAIN, editNodeId: 'c', equation: CONSUMES_G }}
	play={async ({ canvasElement }: PlayContext) => {
		await waitFor(() => expect(canvasElement.querySelector('.node')).toBeInTheDocument());
		// Size, not placement: a dataflow edge is allowed to pull `b` sideways, but
		// it must not resize the square a node's title is fitted into.
		const titleSize = () => {
			const rect = (
				canvasElement.querySelector('[data-node-id="b"] .square') as HTMLElement
			).getBoundingClientRect();
			return `${rect.width}x${rect.height}`;
		};
		const before = titleSize();

		await click(canvasElement, '[data-add-equation]');
		await waitFor(() => expect(derivedEdge(canvasElement)).toBeInTheDocument());

		expect(titleSize()).toEqual(before);
	}}
/>
