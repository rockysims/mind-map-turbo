<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { tick } from 'svelte';
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
	 * `c` two hops from the pinned node, so the equation has somewhere to move it
	 * from: crossing it is a single hop, which is both nearer and larger.
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
	 * root -dataflow-> a -authored-> b. `a` wins its component's beacon slot on
	 * degree and id, so `b` has nothing of its own keeping it on screen and
	 * reaching it means a second step after the equation.
	 */
	const BEHIND_A_CONSUMER = makeGraph({
		nodes: [
			{ id: 'root', title: 'Gravity', description: '$$g = 9.8$$' },
			{ id: 'a', title: 'Weight', description: '' },
			{ id: 'b', title: 'Behind', description: '' }
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
	 * their own — beacons come off the authored edges, so an equation cannot
	 * collapse two clusters into one anchor and leave the second one mostly
	 * gone — and `a`, which only the equation reaches, sits a step past `root`.
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

	const edgeOnCanvas = (canvasElement: HTMLElement, edgeId: string) =>
		canvasElement.querySelector(`[data-edge-id="${edgeId}"]`);

	/**
	 * A chain of equations reaching past the derived budget.
	 *
	 * Authored, everything hangs off `p2`, which is already two hops from the
	 * pinned `v` with one layer on show — so `h1`, `h3` and `h4` are all out of
	 * view until an equation says otherwise, and one pinned component means no
	 * beacon gets a say.
	 *
	 * `v` defines x. `h1` and `h4` consume it, so a single derived step brings
	 * both into view. `h3` sits a second derived step out — `h1` defines the y it
	 * consumes — and the budget of one does not pay for it, which is the shape
	 * that used to leave a stub trailing off `h1`. `h4` also consumes the z that
	 * only the still-hidden `h3` defines: the arrow for that one cannot be drawn
	 * either, and the out-of-view diagnostic is what tells the reader where z
	 * comes from.
	 */
	const CHAINED_EQUATIONS = makeGraph({
		nodes: [
			{ id: 'v', title: 'Source', description: '$$x = 3$$' },
			{ id: 'p1', title: 'Drawn neighbor', description: '' },
			{ id: 'p2', title: 'Past the layer', description: '' },
			{ id: 'h1', title: 'First consumer', description: '$$y = x$$' },
			{ id: 'h3', title: 'Second consumer', description: '' },
			{ id: 'h4', title: 'Other consumer', description: '$$w = x + z$$' }
		],
		pinned: ['v'],
		edges: [
			['v', 'p1'],
			['p1', 'p2'],
			['p2', 'h1'],
			['p2', 'h3'],
			['p2', 'h4']
		],
		posByNodeId: {
			v: { x: -400, y: 0 },
			p1: { x: -200, y: 0 },
			p2: { x: 0, y: 0 },
			h1: { x: 200, y: -200 },
			h3: { x: 400, y: -200 },
			h4: { x: 200, y: 200 }
		}
	});

	/** The authored half-edge that has to keep fading: `p1` visible, `p2` not. */
	const AUTHORED_FADE_EDGE_ID =
		CHAINED_EQUATIONS.edges.find((edge) => edge.sourceNodeId === 'p1' && edge.targetNodeId === 'p2')
			?.id ?? '';

	const ONE_LAYER = { displayedLayers: 1, relaxIterations: 0 };

	/** The same chain of equations, with the budget to pay for the second step. */
	const ONE_LAYER_TWO_DERIVED = { ...ONE_LAYER, dataflowDisplayedLayers: 2 };

	/**
	 * `v` defines x and both `near` and `far` consume it, but `far` is three
	 * authored hops out with one layer on show. Whatever the derived budget does,
	 * the `v`–`near` arrow is between two nodes already on screen.
	 */
	const NEAR_AND_FAR_CONSUMERS = makeGraph({
		nodes: [
			{ id: 'v', title: 'Source', description: '$$x = 3$$' },
			{ id: 'near', title: 'Drawn consumer', description: '' },
			{ id: 'mid', title: 'Past the layer', description: '' },
			{ id: 'far', title: 'Distant consumer', description: '$$w = x$$' }
		],
		pinned: ['v'],
		edges: [
			['v', 'near'],
			['near', 'mid'],
			['mid', 'far']
		],
		posByNodeId: {
			v: { x: -300, y: 0 },
			near: { x: -100, y: 0 },
			mid: { x: 100, y: 0 },
			far: { x: 300, y: 0 }
		}
	});

	/**
	 * `d` consumes g and nothing defines it yet, so with two layers on show it is
	 * three authored hops out and off screen. Writing the definition into `a` is a
	 * pure content edit that changes the topology — the case the re-ingest route
	 * cannot reach, because ingest settles everything on its way in.
	 */
	const CONTENT_COMMIT_CHAIN = makeGraph({
		nodes: [
			{ id: 'a', title: 'Gravity', description: '' },
			{ id: 'b', title: 'Middle', description: '' },
			{ id: 'c', title: 'Third', description: '' },
			{ id: 'd', title: 'Weight', description: '$$w = m g$$' }
		],
		pinned: ['a'],
		edges: [
			['a', 'b'],
			['b', 'c'],
			['c', 'd']
		],
		posByNodeId: {
			a: { x: -300, y: 0 },
			b: { x: -100, y: 0 },
			c: { x: 100, y: 0 },
			d: { x: 300, y: 0 }
		}
	});

	const DEFINES_G = '$$g = 9.8$$';

	/**
	 * Presses one of the harness's save buttons and waits for the edit sheet flow
	 * behind it to finish. Microtasks, not frames: the settle the commit kicks has
	 * to be observable before an animation frame could have consumed it.
	 */
	const saveThroughSheet = async (canvasElement: HTMLElement, selector: string) => {
		const harness = canvasElement.querySelector('.harness') as HTMLElement;
		const saveCount = () => Number(harness.dataset.saveCount);
		const before = saveCount();

		(canvasElement.querySelector(selector) as HTMLElement).click();
		for (let attempt = 0; attempt < 20 && saveCount() === before; attempt += 1) {
			await tick();
		}
		expect(saveCount()).toBe(before + 1);
	};

	const isSettling = (canvasElement: HTMLElement) =>
		(canvasElement.querySelector('.graph') as HTMLElement).dataset.settling === 'true';

	const positionOf = (canvasElement: HTMLElement, nodeId: string) => {
		const wrapper = canvasElement.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement;
		return `${wrapper.dataset.x},${wrapper.dataset.y}`;
	};

	const waitForFrames = (count: number) =>
		new Promise<void>((resolve) => {
			let remaining = count;
			const step = () => {
				remaining -= 1;
				if (remaining <= 0) {
					resolve();
					return;
				}
				requestAnimationFrame(step);
			};
			requestAnimationFrame(step);
		});
</script>

<Story
	name="ArrowAppearsAndDisappearsWithTheEquation"
	args={{ baseGraph: CHAIN, editNodeId: 'c', equation: CONSUMES_G }}
	play={async ({ canvasElement }: PlayContext) => {
		await waitFor(() => expect(canvasElement.querySelector('.edge')).toBeInTheDocument());
		expect(derivedEdge(canvasElement)).not.toBeInTheDocument();

		// Written through `c`'s own edit sheet, so the graph is committed the way a
		// reader commits it and the canvas is never handed a fresh one to ingest.
		await saveThroughSheet(canvasElement, '[data-save-equation]');
		await waitFor(() => expect(derivedEdge(canvasElement)).toBeInTheDocument());

		// Inferred dataflow is always directed, definer to consumer.
		expect(derivedEdge(canvasElement)).toHaveAttribute('data-directed', 'true');
		expect(derivedEdge(canvasElement)).toHaveAttribute('data-source-node-id', 'a');
		expect(derivedEdge(canvasElement)).toHaveAttribute('data-target-node-id', 'c');

		await saveThroughSheet(canvasElement, '[data-clear-equation]');
		await waitFor(() => expect(derivedEdge(canvasElement)).not.toBeInTheDocument());
	}}
/>

<Story
	name="AnEquationSavedOnTheCanvasSettlesTheRevealedNode"
	args={{
		baseGraph: CONTENT_COMMIT_CHAIN,
		editNodeId: 'a',
		equation: DEFINES_G,
		// Physics on: the point of the story is that they run.
		layoutSettings: { displayedLayers: 2 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitFor(() => expect(nodeOnCanvas(canvasElement, 'a')).toBeInTheDocument());
		// Three authored hops out with two layers on show, and the graph arrived at
		// rest — so any motion after the save is the save's doing.
		expect(nodeOnCanvas(canvasElement, 'd')).not.toBeInTheDocument();
		expect(isSettling(canvasElement)).toBe(false);

		await saveThroughSheet(canvasElement, '[data-save-equation]');

		// Defining g links `a` to `d`, which brings `d` on screen at whatever
		// position it was last given — drawn at its new, much larger size on top of
		// whatever it overlaps. Nothing re-ingests the graph on this route, so the
		// canvas has to relax and settle by itself or `d` stays frozen there until
		// the reader happens to drag something.
		expect(nodeOnCanvas(canvasElement, 'd')).toBeInTheDocument();
		expect(isSettling(canvasElement)).toBe(true);

		const revealedAt = positionOf(canvasElement, 'd');
		await waitForFrames(5);
		expect(positionOf(canvasElement, 'd')).not.toEqual(revealedAt);
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
	args={{ baseGraph: CHAIN, editNodeId: 'c', equation: CONSUMES_G }}
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

		// Consuming g spends the one derived layer the default budget allows, which
		// puts `e` beside the node defining what it consumes.
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
	name="ANodeBehindADataflowLinkStaysHidden"
	args={{
		baseGraph: BEHIND_A_CONSUMER,
		editNodeId: 'a',
		equation: CONSUMES_G,
		startWithEquation: true,
		layoutSettings: { relaxIterations: 0 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitFor(() => expect(nodeOnCanvas(canvasElement, 'a')).toBeInTheDocument());

		// Crossing the equation spends the authored budget: `a` comes into view
		// beside the node defining what it consumes, and the `b` it was drawn to
		// does not follow. One equation cannot open up a cluster the author never
		// joined to the pinned node.
		expect(nodeOnCanvas(canvasElement, 'b')).not.toBeInTheDocument();
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

		// `a` is a step out from `root` across the equation, so it reads smaller.
		// `b` anchors its own authored cluster and reads at the same size as
		// `root`: an equation about one node must not shrink a cluster the author
		// never joined to it.
		expect(Number(scaleOf(canvasElement, 'a'))).toBeLessThan(
			Number(scaleOf(canvasElement, 'root'))
		);
		expect(scaleOf(canvasElement, 'b')).toBe(scaleOf(canvasElement, 'root'));
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
	name="AnEquationPullsTheConsumerInAndSizesItByItsNewHop"
	args={{
		baseGraph: CHAIN,
		editNodeId: 'c',
		equation: CONSUMES_G,
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

<Story
	name="ADerivedEdgeToAHiddenNodeIsNotDrawn"
	args={{
		baseGraph: CHAINED_EQUATIONS,
		editNodeId: 'h3',
		equation: '$$z = y$$',
		startWithEquation: true,
		layoutSettings: ONE_LAYER
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitFor(() => expect(nodeOnCanvas(canvasElement, 'h1')).toBeInTheDocument());

		// One derived step is paid for, the second is not.
		expect(nodeOnCanvas(canvasElement, 'h4')).toBeInTheDocument();
		expect(nodeOnCanvas(canvasElement, 'h3')).not.toBeInTheDocument();

		// Between two nodes on screen, the equation still draws its arrow.
		expect(edgeOnCanvas(canvasElement, 'dataflow:v->h1')).toBeInTheDocument();
		expect(edgeOnCanvas(canvasElement, 'dataflow:v->h4')).toBeInTheDocument();

		// Reaching off screen, it draws nothing. A half-edge fading toward a node
		// the reader cannot reach — and a chained equation always leaves one — reads
		// as a link to somewhere, and there is nowhere to go.
		expect(edgeOnCanvas(canvasElement, 'dataflow:h1->h3')).not.toBeInTheDocument();
		expect(edgeOnCanvas(canvasElement, 'dataflow:h3->h4')).not.toBeInTheDocument();

		// Authored edges keep their boundary fade, and are the only ones that have it.
		const boundaryEdgeIds = Array.from(
			canvasElement.querySelectorAll('[data-edge-visibility="boundary"]')
		).map((edge) => (edge as HTMLElement).dataset.edgeId ?? '');
		expect(boundaryEdgeIds).toContain(AUTHORED_FADE_EDGE_ID);
		expect(boundaryEdgeIds.filter((id) => id.startsWith('dataflow:'))).toEqual([]);
	}}
/>

<Story
	name="ASecondDerivedLayerPaysForTheChainedEquation"
	args={{
		baseGraph: CHAINED_EQUATIONS,
		editNodeId: 'h3',
		equation: '$$z = y$$',
		startWithEquation: true,
		layoutSettings: ONE_LAYER_TWO_DERIVED
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitFor(() => expect(nodeOnCanvas(canvasElement, 'h1')).toBeInTheDocument());

		// The same fixture that leaves `h3` off screen at the default budget of one
		// — see ADerivedEdgeToAHiddenNodeIsNotDrawn. Two derived layers pay for the
		// second equation, so `h3` arrives and both arrows around it can be drawn.
		expect(nodeOnCanvas(canvasElement, 'h3')).toBeInTheDocument();
		expect(edgeOnCanvas(canvasElement, 'dataflow:h1->h3')).toBeInTheDocument();
		expect(edgeOnCanvas(canvasElement, 'dataflow:h3->h4')).toBeInTheDocument();

		// The derived budget buys derived steps and nothing else: `p2` is what `h1`
		// was drawn to, still two authored hops out with one layer on show.
		expect(nodeOnCanvas(canvasElement, 'p2')).not.toBeInTheDocument();
	}}
/>

<Story
	name="ABudgetOfNoLayersStillDrawsTheArrowsOnScreen"
	args={{
		baseGraph: NEAR_AND_FAR_CONSUMERS,
		editNodeId: 'near',
		equation: '$$q = x$$',
		startWithEquation: true,
		layoutSettings: { displayedLayers: 1, relaxIterations: 0, dataflowDisplayedLayers: 0 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitFor(() => expect(nodeOnCanvas(canvasElement, 'near')).toBeInTheDocument());

		// Nothing is revealed: `far` consumes x like `near` does, and with no budget
		// the equation buys it no way onto the canvas.
		expect(nodeOnCanvas(canvasElement, 'mid')).not.toBeInTheDocument();
		expect(nodeOnCanvas(canvasElement, 'far')).not.toBeInTheDocument();

		// The arrow between two nodes already on screen is still drawn — turning the
		// budget off takes away reveals, not the reading of what flows where.
		expect(edgeOnCanvas(canvasElement, 'dataflow:v->near')).toBeInTheDocument();

		// And no stub trails off toward `far`.
		expect(edgeOnCanvas(canvasElement, 'dataflow:v->far')).not.toBeInTheDocument();
		const derivedEdgeIds = Array.from(canvasElement.querySelectorAll('.edge'))
			.map((edge) => (edge as HTMLElement).dataset.edgeId ?? '')
			.filter((id) => id.startsWith('dataflow:'));
		expect(derivedEdgeIds).toEqual(['dataflow:v->near']);
	}}
/>

<Story
	name="ADerivedArrowFadesWithTheRevealWaveBothWays"
	args={{
		baseGraph: makeGraph({
			nodes: [
				{ id: 'a', title: 'Anchor', description: '' },
				{ id: 'b', title: 'Middle', description: '' },
				{ id: 'c', title: 'Gravity', description: '$$g = 9.8$$' },
				{ id: 'd', title: 'Weight', description: '' }
			],
			pinned: ['a', 'c'],
			edges: [
				['a', 'b'],
				['b', 'c'],
				['c', 'd']
			],
			posByNodeId: {
				a: { x: -750, y: 0 },
				b: { x: -250, y: 0 },
				c: { x: 250, y: 0 },
				d: { x: 750, y: 0 }
			}
		}),
		editNodeId: 'd',
		equation: CONSUMES_G,
		startWithEquation: true,
		layoutSettings: {
			displayedLayers: 1,
			relaxIterations: 0,
			scaleAnimationDurationMs: 600,
			postScaleChangeSettleMaxFrames: 0
		},
		initialViewState: FIXED_VIEW
	}}
	play={async ({ canvasElement }: PlayContext) => {
		// The wave cross-fades what is drawn, and an inferred arrow is drawn like
		// anything else. Unpinning `c` takes it and `d` off screen; pinning `b`
		// brings them back across the equation. Either way the arrow has to travel
		// with the wave rather than vanishing on the first frame or snapping in at
		// full opacity toward a node that is still fading up.
		const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
		const pointerAt = (target: HTMLElement, type: string, x: number, y: number) =>
			target.dispatchEvent(
				new PointerEvent(type, {
					clientX: x,
					clientY: y,
					pointerId: 1,
					pointerType: '',
					bubbles: true,
					cancelable: true
				})
			);
		const doubleClickNode = async (nodeId: string) => {
			const circle = canvasElement.querySelector(
				`[data-node-id="${nodeId}"] .circle`
			) as HTMLElement;
			const rect = circle.getBoundingClientRect();
			const x = rect.left + rect.width / 2;
			const y = rect.top + rect.height / 2;
			pointerAt(circle, 'pointerdown', x, y);
			pointerAt(circle, 'pointerup', x, y);
			// Well inside the double-click window, so the pair reads as one gesture.
			await sleep(25);
			pointerAt(circle, 'pointerdown', x, y);
			pointerAt(circle, 'pointerup', x, y);
		};
		const arrow = () =>
			canvasElement.querySelector('[data-edge-id="dataflow:c->d"]') as HTMLElement | null;
		const arrowOpacity = () => Number(arrow()?.dataset.edgeOpacity);

		await waitFor(() => expect(arrow()).toBeInTheDocument());
		expect(arrowOpacity()).toBe(1);

		await doubleClickNode('c');
		await sleep(300);

		expect(arrow()).toBeInTheDocument();
		expect(arrowOpacity()).toBeGreaterThan(0);
		expect(arrowOpacity()).toBeLessThan(1);

		await sleep(500);
		expect(arrow()).not.toBeInTheDocument();

		await doubleClickNode('b');
		await sleep(300);

		expect(arrow()).toBeInTheDocument();
		expect(arrowOpacity()).toBeGreaterThan(0);
		expect(arrowOpacity()).toBeLessThan(1);

		await sleep(500);
		expect(arrowOpacity()).toBe(1);
	}}
/>
