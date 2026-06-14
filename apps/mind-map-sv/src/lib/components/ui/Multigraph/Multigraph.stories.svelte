<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Multigraph from '$lib/components/ui/Multigraph/Multigraph.svelte';
	import { expect, fn, waitFor, within } from 'storybook/test';
	import { APP_CONFIG } from '$lib/appConfig';
	import { DBL_CLICK_MS, LONG_PRESS_MS, MIN_NODE_HIT_RADIUS, NODE_RADIUS } from '$lib/constants';
	import { makeClusteredRandomEdges, makeGraph, makeRandomEdges } from './lib/testFixtures';
	import type { MultigraphData, Point } from '../types/multigraph';
	import type { ViewState } from '$lib/migrations';
	import type { ExitingBuffer } from './lib/elementTransitions';

	const { Story } = defineMeta({
		title: 'Components/Multigraph',
		component: Multigraph,
		tags: [],
		argTypes: {
			multigraphData: { control: 'object' },
			defaultPrimaryNodeId: { control: 'text' },
			layoutSettings: { control: 'object' },
			initialViewState: { control: 'object' },
			onMultigraphChange: { control: false },
			onViewStateChange: { control: false },
			nodeRenderOverrides: { control: false },
			edgeRenderOverrides: { control: false },
			exitingBuffer: { control: false }
		},
		parameters: {
			viewport: {
				defaultViewport: 'phone'
			}
		}
	});

	type PlayContext = {
		canvasElement: HTMLElement;
		canvas: { getByText: (text: string) => HTMLElement };
		args: {
			multigraphData: MultigraphData;
			defaultPrimaryNodeId?: string;
			onMultigraphChange?: (data: MultigraphData) => void;
			onViewStateChange?: (state: ViewState) => void;
		};
	};

	type ChangeSpy = {
		mock: { calls: Array<[MultigraphData]> };
	};

	type ViewStateSpy = {
		mock: { calls: Array<[ViewState]> };
	};

	function getStage(el: HTMLElement): HTMLElement {
		const stage = el.querySelector('.stage');
		if (!stage) throw new Error('Stage not found');
		return stage as HTMLElement;
	}

	function getStageTransform(el: HTMLElement): string {
		const content = el.querySelector('.stage-content');
		if (!content) throw new Error('Stage content not found');
		return (content as HTMLElement).style.transform || '';
	}

	function getCircle(el: HTMLElement, nodeId: string): HTMLElement {
		const circle = el.querySelector(`[data-node-id="${nodeId}"] .circle`);
		if (!circle) throw new Error(`Circle not found for ${nodeId}`);
		return circle as HTMLElement;
	}

	function getNodeWrapper(el: HTMLElement, nodeId: string): HTMLElement {
		const wrapper = el.querySelector(`[data-node-id="${nodeId}"].node-wrapper`);
		if (!wrapper) throw new Error(`Node wrapper not found for ${nodeId}`);
		return wrapper as HTMLElement;
	}

	function getCenter(el: HTMLElement): { x: number; y: number } {
		const rect = el.getBoundingClientRect();
		return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
	}

	function distanceBetween(source: Point, target: Point): number {
		return Math.hypot(target.x - source.x, target.y - source.y);
	}

	function maxCircleOverlap(el: HTMLElement): number {
		const circles = Array.from(el.querySelectorAll('.node-wrapper .circle')).map((circle) => {
			const rect = circle.getBoundingClientRect();
			return {
				center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
				radius: Math.min(rect.width, rect.height) / 2
			};
		});
		let maxOverlap = 0;

		for (let sourceIndex = 0; sourceIndex < circles.length; sourceIndex += 1) {
			for (let targetIndex = sourceIndex + 1; targetIndex < circles.length; targetIndex += 1) {
				const source = circles[sourceIndex];
				const target = circles[targetIndex];
				const overlap =
					source.radius + target.radius - distanceBetween(source.center, target.center);
				maxOverlap = Math.max(maxOverlap, overlap);
			}
		}

		return maxOverlap;
	}

	function dispatchPointer(
		target: HTMLElement,
		type: 'pointerdown' | 'pointermove' | 'pointerup',
		clientX: number,
		clientY: number,
		pointerId = 1
	) {
		target.dispatchEvent(
			new PointerEvent(type, {
				clientX,
				clientY,
				pointerId,
				bubbles: true,
				cancelable: true
			})
		);
	}

	function dispatchWheel(target: HTMLElement, deltaY: number, clientX?: number, clientY?: number) {
		const center = getCenter(target);
		target.dispatchEvent(
			new WheelEvent('wheel', {
				clientX: clientX ?? center.x,
				clientY: clientY ?? center.y,
				deltaY,
				bubbles: true,
				cancelable: true
			})
		);
	}

	function sleep(ms: number = 0) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	function waitForLayout(): Promise<void> {
		return new Promise((resolve) => {
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
		});
	}

	function waitForFrames(count: number): Promise<void> {
		return new Promise((resolve) => {
			let remaining = count;
			const wait = () => {
				remaining -= 1;
				if (remaining <= 0) {
					resolve();
					return;
				}
				requestAnimationFrame(wait);
			};
			requestAnimationFrame(wait);
		});
	}

	function chainEdges(count: number): Array<[number, number]> {
		return Array.from({ length: count - 1 }, (_, index) => [index, index + 1]);
	}

	function lastChangedGraph(args: PlayContext['args']): MultigraphData {
		const spy = args.onMultigraphChange as ChangeSpy | undefined;
		const graph = spy?.mock.calls.at(-1)?.[0];
		if (!graph) throw new Error('Expected onMultigraphChange to be called with graph data');
		return graph;
	}

	function lastViewState(args: PlayContext['args']): ViewState {
		const spy = args.onViewStateChange as ViewStateSpy | undefined;
		const viewState = spy?.mock.calls.at(-1)?.[0];
		if (!viewState) throw new Error('Expected onViewStateChange to be called with view state');
		return viewState;
	}

	function circlePositions(count: number, radius: number): Record<string, Point> {
		return Object.fromEntries(
			Array.from({ length: count }, (_, index) => {
				const angle = (index / count) * Math.PI * 2;
				return [`n${index}`, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }];
			})
		);
	}

	function nodePosition(el: HTMLElement, nodeId: string): Point {
		const wrapper = getNodeWrapper(el, nodeId);
		const x = Number(wrapper.dataset.x);
		const y = Number(wrapper.dataset.y);
		if (!Number.isFinite(x) || !Number.isFinite(y)) {
			throw new Error(`Node ${nodeId} position is not finite`);
		}
		return { x, y };
	}

	function nodeOpacity(el: HTMLElement, nodeId: string): number {
		return Number(getNodeWrapper(el, nodeId).dataset.nodeOpacity);
	}

	function edgeOpacity(el: HTMLElement, edgeId: string): number {
		const edge = el.querySelector(`[data-edge-id="${edgeId}"]`) as HTMLElement | null;
		if (!edge) throw new Error(`Edge not found for ${edgeId}`);
		return Number(edge.dataset.edgeOpacity);
	}

	function getEdge(el: HTMLElement, edgeId: string): HTMLElement {
		const edge = el.querySelector(`[data-edge-id="${edgeId}"]`) as HTMLElement | null;
		if (!edge) throw new Error(`Edge not found for ${edgeId}`);
		return edge;
	}

	type EdgeGradientStop = {
		color: string;
		position: number;
	};

	function splitGradientStops(stops: string): string[] {
		const parts: string[] = [];
		let startIndex = 0;
		let depth = 0;

		for (let index = 0; index < stops.length; index += 1) {
			const char = stops[index];
			if (char === '(') depth += 1;
			if (char === ')') depth -= 1;
			if (char === ',' && depth === 0) {
				parts.push(stops.slice(startIndex, index).trim());
				startIndex = index + 1;
			}
		}

		parts.push(stops.slice(startIndex).trim());
		return parts;
	}

	function edgeGradientStops(edge: HTMLElement): EdgeGradientStop[] {
		const background = edge.style.getPropertyValue('--edge-background').trim();
		const match = background.match(/^linear-gradient\(to right, (.*)\)$/);
		if (!match) throw new Error(`Expected edge gradient background, got ${background}`);

		return splitGradientStops(match[1]).map((stop) => {
			const stopMatch = stop.match(/^(.*) ([\d.]+)%$/);
			if (!stopMatch) throw new Error(`Could not parse gradient stop: ${stop}`);
			return {
				color: stopMatch[1],
				position: Number(stopMatch[2])
			};
		});
	}

	function minOpacityStops(
		stops: readonly EdgeGradientStop[],
		color: string,
		opacity: number
	): number[] {
		const fadedColor = `color-mix(in srgb, ${color} ${opacity * 100}%, transparent)`;
		return stops.filter((stop) => stop.color === fadedColor).map((stop) => stop.position);
	}

	function nodePositions(el: HTMLElement, nodeIds: readonly string[]): Record<string, Point> {
		return Object.fromEntries(nodeIds.map((nodeId) => [nodeId, nodePosition(el, nodeId)]));
	}

	function centroidOf(positions: Record<string, Point>): Point {
		const points = Object.values(positions);
		return points.reduce(
			(sum, point) => ({
				x: sum.x + point.x / points.length,
				y: sum.y + point.y / points.length
			}),
			{ x: 0, y: 0 }
		);
	}

	function maxPositionDelta(before: Record<string, Point>, after: Record<string, Point>): number {
		return Object.keys(after).reduce((maxDelta, nodeId) => {
			const previous = before[nodeId];
			const next = after[nodeId];
			return Math.max(maxDelta, distanceBetween(previous, next));
		}, 0);
	}

	async function dispatchDoubleClick(target: HTMLElement, x: number, y: number): Promise<void> {
		dispatchPointer(target, 'pointerdown', x, y);
		dispatchPointer(target, 'pointerup', x, y);
		await sleep(DBL_CLICK_MS * 0.1);
		dispatchPointer(target, 'pointerdown', x, y);
		dispatchPointer(target, 'pointerup', x, y);
	}

	async function dispatchDoubleClickDrag(
		fromTarget: HTMLElement,
		fromX: number,
		fromY: number,
		toTarget: HTMLElement,
		toX: number,
		toY: number
	): Promise<void> {
		dispatchPointer(fromTarget, 'pointerdown', fromX, fromY);
		dispatchPointer(fromTarget, 'pointerup', fromX, fromY);
		await sleep(DBL_CLICK_MS * 0.1);
		dispatchPointer(fromTarget, 'pointerdown', fromX, fromY);
		dispatchPointer(toTarget, 'pointermove', toX, toY);
		dispatchPointer(toTarget, 'pointerup', toX, toY);
	}

	const HUNDRED_NODE_POSITIONS = circlePositions(100, 480);
	const HUNDRED_NODE_MESSY_EDGES = makeRandomEdges({ nodeCount: 100, edgeCount: 150, seed: 42 });
	const HUNDRED_NODE_CLUSTERED_EDGES = makeClusteredRandomEdges({
		nodeCount: 100,
		edgeCount: 300,
		groupCount: 8,
		crossGroupFraction: 0.05,
		seed: 42
	});
</script>

<Story
	name="Single"
	args={{
		multigraphData: {
			nodes: [{ id: '1', title: 'Node 1', description: 'Node 1 description', tags: [] }],
			edges: [],
			posByNodeId: {},
			tagColorConfig: { nodeTags: {}, edgeTags: {} }
		},
		defaultPrimaryNodeId: '1'
	}}
	play={async (context: PlayContext) => {
		await expect(
			context.canvas.getByText(context.args.multigraphData.nodes[0].title)
		).toBeInTheDocument();
	}}
/>

<Story
	name="Many"
	args={{
		multigraphData: makeGraph({
			nodeCount: 100,
			pinned: [0],
			edges: HUNDRED_NODE_CLUSTERED_EDGES,
			posByNodeId: HUNDRED_NODE_POSITIONS
		}),
		defaultPrimaryNodeId: 'n0',
		initialViewState: { panX: 0, panY: 0, scale: 0.25 }
	}}
	play={async ({ canvasElement }) => {
		await waitForLayout();
		expect(getStageTransform(canvasElement)).toContain('scale(0.25)');
	}}
/>

<Story
	name="StartsAtPersistedViewState"
	args={{
		multigraphData: makeGraph({ nodeCount: 1 }),
		defaultPrimaryNodeId: 'n0',
		initialViewState: { panX: 36, panY: -18, scale: 1.25 }
	}}
	play={async ({ canvasElement }) => {
		await waitForLayout();
		expect(getStageTransform(canvasElement)).toContain('translate(36px, -18px) scale(1.25)');
	}}
/>

<Story
	name="UserPansAndZoomsWithoutChangingGraphData"
	args={{
		multigraphData: makeGraph({ nodeCount: 0 }),
		onMultigraphChange: fn(),
		onViewStateChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const center = getCenter(stage);

		dispatchPointer(stage, 'pointerdown', center.x, center.y);
		dispatchPointer(stage, 'pointermove', center.x + 24, center.y + 12);
		dispatchPointer(stage, 'pointerup', center.x + 24, center.y + 12);
		await sleep();

		expect(args.onMultigraphChange).not.toHaveBeenCalled();
		expect(lastViewState(args)).toMatchObject({ panX: 24, panY: 12, scale: 1 });

		dispatchWheel(stage, -200);
		await sleep();

		expect(args.onMultigraphChange).not.toHaveBeenCalled();
		const zoomedViewState = lastViewState(args);
		expect(zoomedViewState.scale).toBeGreaterThan(1);
		expect(zoomedViewState.panX).toBeCloseTo(24 * zoomedViewState.scale);
		expect(zoomedViewState.panY).toBeCloseTo(12 * zoomedViewState.scale);
	}}
/>

<Story
	name="UserPinsANode"
	args={{
		multigraphData: makeGraph({ nodeCount: 1 }),
		defaultPrimaryNodeId: 'n0',
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		expect(args.onMultigraphChange).not.toHaveBeenCalled();
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);

		await dispatchDoubleClick(circle, center.x, center.y);
		await sleep();

		const node = canvasElement.querySelector('[data-node-id="n0"] .node');
		expect(node).toHaveAttribute('data-pinned', 'true');
		expect(lastChangedGraph(args).nodes[0].pinned).toBe(true);
	}}
/>

<Story
	name="UserTapOnNodeDoesNothing"
	args={{
		multigraphData: makeGraph({ nodeCount: 1 }),
		defaultPrimaryNodeId: 'n0'
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);

		dispatchPointer(circle, 'pointerdown', center.x, center.y);
		dispatchPointer(circle, 'pointerup', center.x, center.y);
		await sleep(DBL_CLICK_MS + 20);

		const canvas = within(canvasElement);
		expect(canvas.queryByLabelText('Title')).not.toBeInTheDocument();
		expect(canvas.queryByRole('menu')).not.toBeInTheDocument();
	}}
/>

<Story
	name="UserEditsTitleInSheet"
	args={{
		multigraphData: makeGraph({ nodeCount: 1 }),
		defaultPrimaryNodeId: 'n0',
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);

		dispatchPointer(circle, 'pointerdown', center.x, center.y);
		await sleep(LONG_PRESS_MS + 20);

		const canvas = within(canvasElement);
		canvas.getByRole('menuitem', { name: 'Edit' }).click();
		await sleep();

		const titleInput = canvas.getByLabelText('Title') as HTMLInputElement;
		titleInput.value = 'Updated mobile title';
		titleInput.dispatchEvent(new Event('input', { bubbles: true }));
		const nodeTagsInput = canvas.getByLabelText('Node tags') as HTMLInputElement;
		nodeTagsInput.value = 'abc urgent';
		nodeTagsInput.dispatchEvent(new Event('input', { bubbles: true }));
		canvas.getByRole('button', { name: 'Save' }).click();
		await sleep();

		expect(canvas.getByText('Updated mobile title')).toBeInTheDocument();
		expect(lastChangedGraph(args).nodes[0].title).toBe('Updated mobile title');
		expect(lastChangedGraph(args).nodes[0].tags).toEqual(['abc', 'urgent']);
	}}
/>

<Story
	name="UserEditsIncidentEdgeDirectionAndTags"
	args={{
		multigraphData: makeGraph({
			nodeCount: 2,
			pinned: [0],
			edges: [{ source: 0, target: 1, directed: true }],
			posByNodeId: { n0: { x: -180, y: 0 }, n1: { x: 180, y: 0 } }
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { relaxIterations: 0 },
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		const initialEdge = canvasElement.querySelector('[data-edge-id="e0"]')!;
		expect(initialEdge).toHaveAttribute('data-arrow-target-node-id', 'n1');
		expect(Number(initialEdge.getAttribute('data-edge-arrow-scale'))).toBeCloseTo(
			0.7 / APP_CONFIG.multigraph.edgeArrow.referenceNodeScale
		);
		expect(Number(initialEdge.getAttribute('data-edge-stroke-scale'))).toBeCloseTo(
			0.7 / APP_CONFIG.multigraph.edgeStroke.referenceNodeScale
		);
		const initialEdgeRect = initialEdge.getBoundingClientRect();
		const sourceCircleRect = getCircle(canvasElement, 'n0').getBoundingClientRect();
		const targetCircleRect = getCircle(canvasElement, 'n1').getBoundingClientRect();
		expect(initialEdgeRect.left).toBeGreaterThanOrEqual(sourceCircleRect.right);
		expect(initialEdgeRect.right).toBeLessThanOrEqual(targetCircleRect.left);

		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);
		dispatchPointer(circle, 'pointerdown', center.x, center.y);
		await sleep(LONG_PRESS_MS + 20);

		const canvas = within(canvasElement);
		canvas.getByRole('menuitem', { name: 'Edit' }).click();
		await sleep();

		expect(canvas.getByRole('tablist', { name: 'Edit node and edges' })).toBeInTheDocument();
		canvas.getByRole('tab', { name: 'Edges' }).click();
		await sleep();
		expect(canvas.getByRole('tabpanel')).toHaveTextContent('Connected to Node 1');

		const edgeTagsInput = canvas.getByLabelText('Edge tags for Node 1') as HTMLInputElement;
		edgeTagsInput.value = 'rel strong';
		edgeTagsInput.dispatchEvent(new Event('input', { bubbles: true }));

		const direction = canvas.getByLabelText('Direction for Node 1') as HTMLSelectElement;
		direction.value = 'incoming';
		direction.dispatchEvent(new Event('change', { bubbles: true }));
		await sleep();

		expect(lastChangedGraph(args).edges[0]).toMatchObject({
			sourceNodeId: 'n1',
			targetNodeId: 'n0',
			directed: true
		});
		const flippedEdge = canvasElement.querySelector('[data-edge-id="e0"]')!;
		expect(flippedEdge).toHaveAttribute('data-arrow-target-node-id', 'n0');
		expect(Number(flippedEdge.getAttribute('data-edge-arrow-scale'))).toBeCloseTo(
			1 / APP_CONFIG.multigraph.edgeArrow.referenceNodeScale
		);
		expect(Number(flippedEdge.getAttribute('data-edge-stroke-scale'))).toBeCloseTo(
			1 / APP_CONFIG.multigraph.edgeStroke.referenceNodeScale
		);
		expect((canvas.getByLabelText('Edge tags for Node 1') as HTMLInputElement).value).toBe(
			'rel strong'
		);

		canvas.getByRole('button', { name: 'Save edge to Node 1' }).click();
		await sleep();

		expect(lastChangedGraph(args).edges[0].tags).toEqual(['rel', 'strong']);

		canvas.getByRole('button', { name: 'Close' }).click();
		await sleep();

		const targetCircle = getCircle(canvasElement, 'n1');
		const targetCenter = getCenter(targetCircle);
		dispatchPointer(targetCircle, 'pointerdown', targetCenter.x, targetCenter.y);
		await sleep(LONG_PRESS_MS + 20);
		canvas.getByRole('menuitem', { name: 'Edit' }).click();
		await sleep();
		canvas.getByRole('tab', { name: 'Edges' }).click();
		await sleep();
		expect(canvas.getByRole('tabpanel')).toHaveTextContent('Connected to Node 0');

		const oppositeDirection = canvas.getByLabelText('Direction for Node 0') as HTMLSelectElement;
		oppositeDirection.value = 'incoming';
		oppositeDirection.dispatchEvent(new Event('change', { bubbles: true }));
		await sleep();

		expect(lastChangedGraph(args).edges[0]).toMatchObject({
			sourceNodeId: 'n0',
			targetNodeId: 'n1',
			directed: true
		});
		expect(canvasElement.querySelector('[data-edge-id="e0"]')).toHaveAttribute(
			'data-arrow-target-node-id',
			'n1'
		);
	}}
/>

<Story
	name="UserLongPressesNodeForActions"
	args={{
		multigraphData: makeGraph({ nodeCount: 1 }),
		defaultPrimaryNodeId: 'n0'
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);

		dispatchPointer(circle, 'pointerdown', center.x, center.y);
		await sleep(LONG_PRESS_MS + 20);

		const canvas = within(canvasElement);
		expect(canvas.getByRole('menuitem', { name: 'Pin' })).toBeInTheDocument();
		expect(canvas.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
		expect(canvas.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
		dispatchPointer(circle, 'pointerup', center.x, center.y);
	}}
/>

<Story
	name="UserDeletesNodeFromActionMenu"
	args={{
		multigraphData: makeGraph({ nodeCount: 2, edges: [[0, 1]] }),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { enterExitDurationMs: 0 },
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);

		dispatchPointer(circle, 'pointerdown', center.x, center.y);
		await sleep(LONG_PRESS_MS + 20);
		within(canvasElement).getByRole('menuitem', { name: 'Delete' }).click();
		await sleep();

		expect(canvasElement.querySelector('[data-node-id="n0"].node-wrapper')).not.toBeInTheDocument();
		expect(lastChangedGraph(args).nodes.map((node) => node.id)).toEqual(['n1']);
		expect(lastChangedGraph(args).edges).toEqual([]);
	}}
/>

<Story
	name="UserLongPressesTinyDistantNode"
	args={{
		multigraphData: makeGraph({
			nodeCount: 2,
			pinned: [0],
			edges: [[0, 1]],
			posByNodeId: { n0: { x: -160, y: 0 }, n1: { x: 160, y: 0 } }
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { scaleFalloff: 0.1, minScale: 0.1 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const tinyCircle = getCircle(canvasElement, 'n1');
		const tinyCenter = getCenter(tinyCircle);
		const tinyRadius =
			Math.min(
				tinyCircle.getBoundingClientRect().width,
				tinyCircle.getBoundingClientRect().height
			) / 2;
		expect(tinyRadius).toBeLessThan(MIN_NODE_HIT_RADIUS);

		dispatchPointer(stage, 'pointerdown', tinyCenter.x + tinyRadius + 4, tinyCenter.y);
		await sleep(LONG_PRESS_MS + 20);

		expect(within(canvasElement).getByRole('menuitem', { name: 'Pin' })).toBeInTheDocument();
		dispatchPointer(stage, 'pointerup', tinyCenter.x + tinyRadius + 4, tinyCenter.y);
	}}
/>

<Story
	name="UserPinsNodeAndNeighborsScaleDownWithDistance"
	args={{
		multigraphData: makeGraph({
			nodeCount: 4,
			edges: [
				[0, 1],
				[1, 2],
				[2, 3]
			],
			posByNodeId: {
				n0: { x: -360, y: 0 },
				n1: { x: -120, y: 0 },
				n2: { x: 120, y: 0 },
				n3: { x: 360, y: 0 }
			}
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { scaleFalloff: 0.5, minScale: 0.2 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);

		await dispatchDoubleClick(circle, center.x, center.y);
		await sleep(APP_CONFIG.multigraph.layout.scaleAnimationDurationMs + 20);

		expect(Number(getNodeWrapper(canvasElement, 'n0').dataset.scale)).toBe(1);
		expect(Number(getNodeWrapper(canvasElement, 'n1').dataset.scale)).toBe(0.5);
		expect(Number(getNodeWrapper(canvasElement, 'n2').dataset.scale)).toBe(0.25);
		expect(Number(getNodeWrapper(canvasElement, 'n3').dataset.scale)).toBe(0.2);
	}}
/>

<Story
	name="PinningNodeAnimatesNeighborScaleChanges"
	args={{
		multigraphData: makeGraph({
			nodeCount: 3,
			edges: [
				[0, 1],
				[1, 2]
			],
			posByNodeId: {
				n0: { x: -280, y: 0 },
				n1: { x: 0, y: 0 },
				n2: { x: 280, y: 0 }
			}
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: {
			scaleFalloff: 0.5,
			minScale: 0.2,
			scaleAnimationDurationMs: 120,
			postScaleChangeSettleMaxFrames: 8,
			relaxIterations: 1
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);

		await dispatchDoubleClick(circle, center.x, center.y);
		await waitForFrames(2);

		const animatedPinnedScale = Number(getNodeWrapper(canvasElement, 'n0').dataset.scale);
		const animatedNeighborScale = Number(getNodeWrapper(canvasElement, 'n1').dataset.scale);
		expect(animatedPinnedScale).toBeGreaterThan(0.2);
		expect(animatedPinnedScale).toBeLessThan(1);
		expect(animatedNeighborScale).toBeGreaterThan(0.2);
		expect(animatedNeighborScale).toBeLessThan(0.5);

		await sleep(140);
		await waitForLayout();

		expect(Number(getNodeWrapper(canvasElement, 'n0').dataset.scale)).toBe(1);
		expect(Number(getNodeWrapper(canvasElement, 'n1').dataset.scale)).toBe(0.5);
		expect(Number(getNodeWrapper(canvasElement, 'n2').dataset.scale)).toBe(0.25);
	}}
/>

<Story
	name="UserUnpinsAPinnedNode"
	args={{
		multigraphData: makeGraph({
			nodeCount: 2,
			pinned: [0],
			edges: [[0, 1]],
			posByNodeId: { n0: { x: -120, y: 0 }, n1: { x: 240, y: 0 } }
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: {
			scaleFalloff: 0.5,
			minScale: 0.2,
			scaleAnimationDurationMs: 120,
			postScaleChangeSettleMaxFrames: 12,
			postDragSettleEpsilonPx: 0,
			edgeSpringStrength: 1,
			relaxIterations: 2
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const circle = getCircle(canvasElement, 'n0');
		const neighborCircle = getCircle(canvasElement, 'n1');
		const pinnedCenter = getCenter(circle);
		const neighborCenterAtStart = getCenter(neighborCircle);

		await dispatchDoubleClick(circle, pinnedCenter.x, pinnedCenter.y);

		const node = canvasElement.querySelector('[data-node-id="n0"] .node');
		expect(node).not.toHaveAttribute('data-pinned');
		expect(canvasElement.querySelector('.graph')).toHaveAttribute(
			'data-scale-animation-active',
			'true'
		);

		await waitFor(() => {
			const unpinnedScale = Number(getNodeWrapper(canvasElement, 'n0').dataset.scale);
			expect(unpinnedScale).toBeGreaterThan(0.2);
			expect(unpinnedScale).toBeLessThan(1);
			const centerDuringAnimation = getCenter(getCircle(canvasElement, 'n0'));
			expect(centerDuringAnimation.x).toBeCloseTo(pinnedCenter.x);
			expect(centerDuringAnimation.y).toBeCloseTo(pinnedCenter.y);
		});

		await waitFor(() => {
			expect(canvasElement.querySelector('.graph')).toHaveAttribute(
				'data-scale-change-focal',
				'n0'
			);
			const neighborWhileFocalAnchored = getCenter(getCircle(canvasElement, 'n1'));
			expect(distanceBetween(neighborWhileFocalAnchored, neighborCenterAtStart)).toBeGreaterThan(1);
		});

		await waitFor(() => {
			expect(canvasElement.querySelector('.graph')).not.toHaveAttribute('data-scale-change-focal');
		});
	}}
/>

<Story
	name="UserAddsAnEdgeBetweenNodes"
	args={{
		multigraphData: makeGraph({
			nodeCount: 3,
			pinned: [0],
			edges: [
				[0, 2],
				[2, 1]
			],
			posByNodeId: {
				n0: { x: -280, y: 0 },
				n1: { x: 280, y: 0 },
				n2: { x: 0, y: 160 }
			}
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { relaxIterations: 1, edgeSpringStrength: 1 },
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const sourceCircle = getCircle(canvasElement, 'n0');
		const targetCircle = getCircle(canvasElement, 'n1');
		const sourceCenter = getCenter(sourceCircle);
		const targetCenter = getCenter(targetCircle);

		await dispatchDoubleClickDrag(
			sourceCircle,
			sourceCenter.x,
			sourceCenter.y,
			stage,
			targetCenter.x,
			targetCenter.y
		);
		await sleep();

		const edge = canvasElement.querySelector(
			'.edge[data-source-node-id="n0"][data-target-node-id="n1"]'
		);
		expect(edge).toBeInTheDocument();
		expect(lastChangedGraph(args).edges).toContainEqual({
			id: 'e2',
			sourceNodeId: 'n0',
			targetNodeId: 'n1',
			tags: [],
			directed: false
		});

		const movedSourceCircle = getCircle(canvasElement, 'n0');
		const movedTargetCircle = getCircle(canvasElement, 'n1');
		const movedSourceCenter = getCenter(movedSourceCircle);
		const movedTargetCenter = getCenter(movedTargetCircle);
		const visibleGap =
			distanceBetween(movedSourceCenter, movedTargetCenter) -
			movedSourceCircle.getBoundingClientRect().width / 2 -
			movedTargetCircle.getBoundingClientRect().width / 2;

		expect(distanceBetween(movedSourceCenter, movedTargetCenter)).toBeLessThan(
			distanceBetween(sourceCenter, targetCenter)
		);
		expect(visibleGap).toBeGreaterThan(0);
	}}
/>

<Story
	name="UserAddsConnectedNodeOnBackgroundDrop"
	args={{
		multigraphData: makeGraph({
			nodeCount: 1,
			posByNodeId: { n0: { x: -280, y: 0 } }
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { edgeSpringStrength: 1 },
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const sourceCircle = getCircle(canvasElement, 'n0');
		const sourceCenter = getCenter(sourceCircle);
		const dropX = sourceCenter.x + 560;
		const dropY = sourceCenter.y;

		await dispatchDoubleClickDrag(
			sourceCircle,
			sourceCenter.x,
			sourceCenter.y,
			stage,
			dropX,
			dropY
		);
		await sleep();

		const changedGraph = lastChangedGraph(args);
		const createdNode = changedGraph.nodes.find((node) => node.id === 'n1');
		const createdPosition = changedGraph.posByNodeId.n1;
		const sourcePosition = args.multigraphData.posByNodeId.n0;
		const newCircle = getCircle(canvasElement, 'n1');
		const newCenter = getCenter(newCircle);
		expect(Number.isFinite(newCenter.x)).toBe(true);
		expect(createdPosition.x).toBeCloseTo(sourcePosition.x + 560);
		expect(createdPosition.y).toBeCloseTo(sourcePosition.y);
		expect(canvasElement.querySelector('[data-node-id="n1"] .node')).toHaveAttribute(
			'data-pinned',
			'true'
		);
		expect(canvasElement.querySelector('[data-edge-id="e0"]')).toBeInTheDocument();
		expect(changedGraph.nodes.map((node) => node.id)).toEqual(['n0', 'n1']);
		expect(createdNode?.pinned).toBe(true);
	}}
/>

<Story
	name="MovingNodeDoesNotMutateStoryArgs"
	args={{
		multigraphData: makeGraph({ nodeCount: 1 }),
		defaultPrimaryNodeId: 'n0',
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);
		const moveToX = center.x + NODE_RADIUS + 20;
		const moveToY = center.y;

		dispatchPointer(circle, 'pointerdown', center.x, center.y);
		dispatchPointer(stage, 'pointermove', moveToX, moveToY);
		dispatchPointer(stage, 'pointerup', moveToX, moveToY);
		await sleep();

		expect(args.multigraphData.posByNodeId.n0).toEqual({ x: 0, y: 0 });
		expect(lastChangedGraph(args).posByNodeId.n0.x).toBeGreaterThan(0);
		const movedCenter = getCenter(getCircle(canvasElement, 'n0'));
		expect(movedCenter.x).toBeCloseTo(moveToX);
		expect(movedCenter.y).toBeCloseTo(moveToY);
	}}
/>

<Story
	name="UserDragsNodeIntoAnotherAndOverlapRelaxes"
	args={{
		multigraphData: makeGraph({
			nodeCount: 2,
			edges: [[0, 1]],
			posByNodeId: { n0: { x: -160, y: 0 }, n1: { x: 160, y: 0 } }
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { baseRadius: 200, minScale: 1, relaxIterations: 2, hopRepulsionStrength: 0 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const sourceCircle = getCircle(canvasElement, 'n0');
		const targetCircle = getCircle(canvasElement, 'n1');
		const sourceCenter = getCenter(sourceCircle);
		const targetCenter = getCenter(targetCircle);

		dispatchPointer(sourceCircle, 'pointerdown', sourceCenter.x, sourceCenter.y);
		dispatchPointer(stage, 'pointermove', targetCenter.x, targetCenter.y);
		dispatchPointer(stage, 'pointerup', targetCenter.x, targetCenter.y);
		await waitForFrames(12);

		const movedSourceCenter = getCenter(getCircle(canvasElement, 'n0'));
		const movedTargetCenter = getCenter(getCircle(canvasElement, 'n1'));
		expect(Number.isFinite(movedTargetCenter.x)).toBe(true);
		expect(Number.isFinite(movedSourceCenter.x)).toBe(true);
		expect(distanceBetween(targetCenter, movedTargetCenter)).toBeGreaterThan(0);
		expect(distanceBetween(movedSourceCenter, movedTargetCenter)).toBeGreaterThan(NODE_RADIUS);
	}}
/>

<Story
	name="ReleasedDragContinuesSettlingUntilNodesSeparate"
	args={{
		multigraphData: makeGraph({
			nodeCount: 2,
			edges: [[0, 1]],
			posByNodeId: { n0: { x: -180, y: 0 }, n1: { x: 180, y: 0 } }
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: {
			baseRadius: 180,
			minScale: 1,
			relaxIterations: 1,
			hopRepulsionStrength: 0,
			postDragSettleEpsilonPx: 0,
			postDragSettleMaxFrames: 6
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const sourceCircle = getCircle(canvasElement, 'n0');
		const targetCircle = getCircle(canvasElement, 'n1');
		const sourceCenter = getCenter(sourceCircle);
		const targetCenter = getCenter(targetCircle);

		dispatchPointer(sourceCircle, 'pointerdown', sourceCenter.x, sourceCenter.y);
		dispatchPointer(stage, 'pointermove', targetCenter.x, targetCenter.y);
		dispatchPointer(stage, 'pointerup', targetCenter.x, targetCenter.y);
		await sleep();

		expect(canvasElement.querySelector('.graph')).toHaveAttribute('data-settling', 'true');
		await waitForFrames(8);

		expect(canvasElement.querySelector('.graph')).not.toHaveAttribute('data-settling');
	}}
/>

<Story
	name="UnpinnedGraphSettlesWithoutRigidDrift"
	args={{
		multigraphData: makeGraph({
			nodeCount: 4,
			edges: [
				[0, 1],
				[1, 2],
				[2, 3],
				[3, 0],
				[0, 2]
			],
			posByNodeId: {
				n0: { x: 260, y: -140 },
				n1: { x: 380, y: -20 },
				n2: { x: 260, y: 100 },
				n3: { x: 140, y: -20 }
			}
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: {
			baseRadius: 80,
			minScale: 1,
			relaxIterations: 1,
			hopRepulsionStrength: 0,
			edgeSpringStrength: 0.6,
			postDragSettleMaxFrames: 80
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const nodeIds = ['n0', 'n1', 'n2', 'n3'];
		const stage = getStage(canvasElement);
		const sourceCircle = getCircle(canvasElement, 'n0');
		const sourceCenter = getCenter(sourceCircle);

		dispatchPointer(sourceCircle, 'pointerdown', sourceCenter.x, sourceCenter.y);
		dispatchPointer(stage, 'pointermove', sourceCenter.x + 70, sourceCenter.y + 35);
		dispatchPointer(stage, 'pointerup', sourceCenter.x + 70, sourceCenter.y + 35);
		await sleep();

		const settlingStartPositions = nodePositions(canvasElement, nodeIds);
		const settlingStartCentroid = centroidOf(settlingStartPositions);
		expect(canvasElement.querySelector('.graph')).toHaveAttribute('data-settling', 'true');

		await waitForFrames(30);

		const settledPositions = nodePositions(canvasElement, nodeIds);
		const settledCentroid = centroidOf(settledPositions);
		expect(canvasElement.querySelector('.graph')).not.toHaveAttribute('data-settling');
		expect(distanceBetween(settlingStartCentroid, settledCentroid)).toBeLessThan(0.5);

		await waitForFrames(4);

		expect(maxPositionDelta(settledPositions, nodePositions(canvasElement, nodeIds))).toBeLessThan(
			0.01
		);
	}}
/>

<Story
	name="ConnectedNodeFollowsDraggedEndpoint"
	args={{
		multigraphData: makeGraph({
			nodeCount: 2,
			edges: [[0, 1]],
			posByNodeId: { n0: { x: -100, y: 0 }, n1: { x: 40, y: 0 } }
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: {
			baseRadius: 40,
			minScale: 1,
			relaxIterations: 1,
			edgeGapMinRadiusFactor: 0.5,
			edgeGapMaxRadiusFactor: 1,
			edgeSpringStrength: 1
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const sourceCircle = getCircle(canvasElement, 'n0');
		const sourceCenter = getCenter(sourceCircle);
		const targetCenter = getCenter(getCircle(canvasElement, 'n1'));
		const dragX = sourceCenter.x + 500;

		dispatchPointer(sourceCircle, 'pointerdown', sourceCenter.x, sourceCenter.y);
		dispatchPointer(stage, 'pointermove', dragX, sourceCenter.y);
		await waitForLayout();

		const targetDuringDrag = getCenter(getCircle(canvasElement, 'n1'));
		expect(targetDuringDrag.x).toBeGreaterThan(targetCenter.x + 100);
		expect(distanceBetween({ x: dragX, y: sourceCenter.y }, targetDuringDrag)).toBeLessThan(
			distanceBetween({ x: dragX, y: sourceCenter.y }, targetCenter)
		);

		dispatchPointer(stage, 'pointerup', dragX, sourceCenter.y);
	}}
/>

<Story
	name="PinnedNodesDoNotMoveWhenBumped"
	args={{
		multigraphData: makeGraph({
			nodeCount: 2,
			pinned: [0],
			edges: [[0, 1]],
			posByNodeId: { n0: { x: -120, y: 0 }, n1: { x: 240, y: 0 } }
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { baseRadius: 120, minScale: 1, relaxIterations: 2 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const pinnedCenter = getCenter(getCircle(canvasElement, 'n0'));
		const sourceCircle = getCircle(canvasElement, 'n1');
		const sourceCenter = getCenter(sourceCircle);

		dispatchPointer(sourceCircle, 'pointerdown', sourceCenter.x, sourceCenter.y);
		dispatchPointer(stage, 'pointermove', pinnedCenter.x, pinnedCenter.y);
		dispatchPointer(stage, 'pointerup', pinnedCenter.x, pinnedCenter.y);
		await waitForLayout();

		const movedPinnedCenter = getCenter(getCircle(canvasElement, 'n0'));
		expect(movedPinnedCenter.x).toBeCloseTo(pinnedCenter.x);
		expect(movedPinnedCenter.y).toBeCloseTo(pinnedCenter.y);
	}}
/>

<Story
	name="LargePinnedGraphScalesByDistance"
	args={{
		multigraphData: makeGraph({
			nodeCount: 20,
			pinned: [0],
			edges: chainEdges(20),
			posByNodeId: circlePositions(20, 300)
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { displayedLayers: 20, scaleFalloff: 0.5, minScale: 0.2, relaxIterations: 2 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();

		expect(Number(getNodeWrapper(canvasElement, 'n0').dataset.scale)).toBe(1);
		expect(Number(getNodeWrapper(canvasElement, 'n1').dataset.scale)).toBe(0.5);
		expect(Number(getNodeWrapper(canvasElement, 'n2').dataset.scale)).toBe(0.25);
		expect(Number(getNodeWrapper(canvasElement, 'n12').dataset.scale)).toBe(0.2);
		expect(Number(getNodeWrapper(canvasElement, 'n19').dataset.scale)).toBe(0.2);
	}}
/>

<Story
	name="HundredNodeGraphWithPinnedNodesStaysReadable"
	args={{
		multigraphData: makeGraph({
			nodeCount: 100,
			pinned: [0, 33, 66],
			edges: chainEdges(100),
			posByNodeId: HUNDRED_NODE_POSITIONS
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { displayedLayers: 100, scaleFalloff: 0.7, minScale: 0.1, relaxIterations: 4 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const pinnedCenter = getCenter(getCircle(stage, 'n0'));
		const neighborCenter = getCenter(getCircle(stage, 'n1'));
		const rawNeighborDistance = distanceBetween(
			HUNDRED_NODE_POSITIONS.n0,
			HUNDRED_NODE_POSITIONS.n1
		);

		expect(canvasElement.querySelectorAll('.node-wrapper')).toHaveLength(100);
		expect(Number(getNodeWrapper(canvasElement, 'n0').dataset.scale)).toBe(1);
		expect(Number(getNodeWrapper(canvasElement, 'n50').dataset.scale)).toBeGreaterThanOrEqual(0.1);
		expect(distanceBetween(pinnedCenter, neighborCenter)).toBeGreaterThan(
			rawNeighborDistance + NODE_RADIUS
		);
		expect(maxCircleOverlap(stage)).toBeLessThan(1);
	}}
/>

<Story
	name="HundredNodeMessyGraphLaysOutWithoutHeavyOverlap"
	args={{
		multigraphData: makeGraph({
			nodeCount: 100,
			pinned: [0],
			edges: HUNDRED_NODE_MESSY_EDGES,
			posByNodeId: HUNDRED_NODE_POSITIONS
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { displayedLayers: 100, scaleFalloff: 0.7, minScale: 0.1, relaxIterations: 4 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		await waitForFrames(8);

		const stage = getStage(canvasElement);
		expect(canvasElement.querySelectorAll('.node-wrapper').length).toBeGreaterThan(50);
		expect(canvasElement.querySelectorAll('.edge').length).toBeGreaterThan(100);
		expect(Number(getNodeWrapper(canvasElement, 'n0').dataset.scale)).toBe(1);
		expect(maxCircleOverlap(stage)).toBeLessThan(1);
	}}
/>

<Story
	name="HundredNodeClusteredGraphLaysOutWithoutHeavyOverlap"
	args={{
		multigraphData: makeGraph({
			nodeCount: 100,
			pinned: [0],
			edges: HUNDRED_NODE_CLUSTERED_EDGES,
			posByNodeId: HUNDRED_NODE_POSITIONS
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { displayedLayers: 100, scaleFalloff: 0.7, minScale: 0.1, relaxIterations: 4 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		await waitForFrames(8);

		const stage = getStage(canvasElement);
		expect(canvasElement.querySelectorAll('.node-wrapper')).toHaveLength(100);
		expect(canvasElement.querySelectorAll('.edge')).toHaveLength(300);
		expect(
			Array.from(canvasElement.querySelectorAll('.edge')).some(
				(edge) => Number((edge as HTMLElement).dataset.edgeOcclusionCount) > 0
			)
		).toBe(true);
		expect(Number(getNodeWrapper(canvasElement, 'n0').dataset.scale)).toBe(1);
		expect(maxCircleOverlap(stage)).toBeLessThan(1);
	}}
/>

<Story
	name="PinnedNeighborhoodStopsAtDisplayedLayers"
	args={{
		multigraphData: makeGraph({
			nodeCount: 5,
			pinned: [0],
			edges: chainEdges(5),
			posByNodeId: {
				n0: { x: -480, y: 0 },
				n1: { x: -240, y: 0 },
				n2: { x: 0, y: 0 },
				n3: { x: 240, y: 0 },
				n4: { x: 480, y: 0 }
			}
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: {
			displayedLayers: 2,
			scaleFalloff: 0.5,
			minScale: 0.2,
			relaxIterations: 1
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();

		expect(canvasElement.querySelector('[data-node-id="n0"].node-wrapper')).toBeInTheDocument();
		expect(canvasElement.querySelector('[data-node-id="n1"].node-wrapper')).toBeInTheDocument();
		expect(canvasElement.querySelector('[data-node-id="n2"].node-wrapper')).toBeInTheDocument();
		expect(canvasElement.querySelector('[data-node-id="n3"].node-wrapper')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('[data-node-id="n4"].node-wrapper')).not.toBeInTheDocument();
		const visibleUndirectedEdge = canvasElement.querySelector('[data-edge-id="e0"]');
		expect(visibleUndirectedEdge).toHaveAttribute('data-edge-visibility', 'visible');
		expect(visibleUndirectedEdge).not.toHaveAttribute('data-arrow-target-node-id');
		const boundaryEdge = canvasElement.querySelector('[data-edge-id="e2"]') as HTMLElement;
		expect(boundaryEdge).toHaveAttribute('data-edge-visibility', 'boundary');
		expect(boundaryEdge).toHaveAttribute('data-visible-node-id', 'n2');
		expect(boundaryEdge).toHaveAttribute('data-hidden-node-id', 'n3');
		expect(boundaryEdge).toHaveAttribute('data-boundary-fade-ratio', '0.5');
		expect(Number(boundaryEdge.dataset.boundaryFadeRadius)).toBeGreaterThan(0);
		expect(boundaryEdge.style.getPropertyValue('--edge-background')).toMatch(
			/linear-gradient\(to right, #888888 0%, #888888 [\d.]+%, transparent [\d.]+%\)/
		);
		expect(boundaryEdge).toHaveClass('boundary');
		expect(boundaryEdge).toHaveAttribute('data-edge-boundary-dashed', 'true');
		expect(boundaryEdge).not.toHaveAttribute('data-arrow-target-node-id');
		expect(canvasElement.querySelector('[data-edge-id="e3"]')).not.toBeInTheDocument();
	}}
/>

<Story
	name="RepinningMovesTheVisibleNeighborhoodTogether"
	args={{
		multigraphData: makeGraph({
			nodeCount: 6,
			pinned: [0],
			edges: chainEdges(6),
			posByNodeId: {
				n0: { x: -600, y: 0 },
				n1: { x: -360, y: 0 },
				n2: { x: -120, y: 0 },
				n3: { x: 120, y: 0 },
				n4: { x: 360, y: 0 },
				n5: { x: 600, y: 0 }
			}
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: {
			displayedLayers: 1,
			scaleFalloff: 0.5,
			minScale: 0.2,
			scaleAnimationDurationMs: 120,
			layeredRelayoutSettleMaxFrames: 8,
			layeredRelayoutSettleEpsilonPx: 0,
			relaxIterations: 1
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		expect(canvasElement.querySelector('[data-node-id="n0"].node-wrapper')).toBeInTheDocument();
		expect(canvasElement.querySelector('[data-node-id="n1"].node-wrapper')).toBeInTheDocument();
		expect(canvasElement.querySelector('[data-node-id="n4"].node-wrapper')).not.toBeInTheDocument();

		const targetCircle = getCircle(canvasElement, 'n1');
		const targetCenter = getCenter(targetCircle);
		await dispatchDoubleClick(targetCircle, targetCenter.x, targetCenter.y);
		await sleep();

		expect(canvasElement.querySelector('.graph')).toHaveAttribute(
			'data-scale-animation-active',
			'true'
		);
		expect(canvasElement.querySelector('[data-node-id="n2"].node-wrapper')).toBeInTheDocument();
		expect(canvasElement.querySelector('[data-node-id="n3"].node-wrapper')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('[data-edge-id="e2"]')).toHaveAttribute(
			'data-edge-visibility',
			'boundary'
		);
	}}
/>

<Story
	name="PinRevealWaveArrivesNearerFirstAndEndsAtRestingRender"
	args={{
		multigraphData: makeGraph({
			nodeCount: 6,
			edges: chainEdges(6),
			posByNodeId: {
				n0: { x: -600, y: 0 },
				n1: { x: -360, y: 0 },
				n2: { x: -120, y: 0 },
				n3: { x: 120, y: 0 },
				n4: { x: 360, y: 0 },
				n5: { x: 600, y: 0 }
			}
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: {
			displayedLayers: 2,
			relaxIterations: 0,
			scaleAnimationDurationMs: 120,
			revealFrontWidthHops: 1,
			postScaleChangeSettleMaxFrames: 0
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const circle = getCircle(canvasElement, 'n2');
		const center = getCenter(circle);
		await dispatchDoubleClick(circle, center.x, center.y);
		await waitForFrames(2);

		await waitFor(() => {
			expect(nodeOpacity(canvasElement, 'n4')).toBeGreaterThan(0);
			expect(nodeOpacity(canvasElement, 'n4')).toBeLessThan(1);
			expect(edgeOpacity(canvasElement, 'e4')).toBeGreaterThan(0);
			expect(edgeOpacity(canvasElement, 'e4')).toBeLessThan(1);
		});

		await sleep(160);
		await waitForLayout();

		for (const nodeId of ['n0', 'n1', 'n2', 'n3', 'n4']) {
			expect(nodeOpacity(canvasElement, nodeId)).toBe(1);
		}
		expect(canvasElement.querySelector('[data-node-id="n5"].node-wrapper')).not.toBeInTheDocument();

		const boundaryEdge = canvasElement.querySelector('[data-edge-id="e4"]') as HTMLElement;
		expect(boundaryEdge).toBeInTheDocument();
		expect(boundaryEdge).toHaveAttribute('data-edge-visibility', 'boundary');
		expect(boundaryEdge.dataset.edgeOpacity).toBe('1');
	}}
/>

<Story
	name="UnpinRevealWaveReversesToSmallerNeighborhood"
	args={{
		multigraphData: makeGraph({
			nodeCount: 6,
			pinned: [1, 4],
			edges: chainEdges(6),
			posByNodeId: {
				n0: { x: -600, y: 0 },
				n1: { x: -360, y: 0 },
				n2: { x: -120, y: 0 },
				n3: { x: 120, y: 0 },
				n4: { x: 360, y: 0 },
				n5: { x: 600, y: 0 }
			}
		}),
		defaultPrimaryNodeId: 'n1',
		layoutSettings: {
			displayedLayers: 1,
			relaxIterations: 0,
			scaleAnimationDurationMs: 120,
			revealFrontWidthHops: 1,
			postScaleChangeSettleMaxFrames: 0
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const circle = getCircle(canvasElement, 'n4');
		const center = getCenter(circle);
		await dispatchDoubleClick(circle, center.x, center.y);
		await waitForFrames(2);

		const waveBufferedNode = getNodeWrapper(canvasElement, 'n4');
		expect(waveBufferedNode.dataset.nodeRevealBuffer).toBe('true');
		expect(nodeOpacity(canvasElement, 'n4')).toBeGreaterThan(nodeOpacity(canvasElement, 'n3'));
		expect(nodeOpacity(canvasElement, 'n3')).toBeGreaterThan(0);
		expect(nodeOpacity(canvasElement, 'n3')).toBeLessThan(1);

		await sleep(160);
		await waitForLayout();

		expect(canvasElement.querySelector('[data-node-id="n3"].node-wrapper')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('[data-node-id="n4"].node-wrapper')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('[data-node-id="n5"].node-wrapper')).not.toBeInTheDocument();
		for (const nodeId of ['n0', 'n1', 'n2']) {
			expect(nodeOpacity(canvasElement, nodeId)).toBe(1);
		}
		const boundaryEdge = canvasElement.querySelector('[data-edge-id="e2"]') as HTMLElement;
		expect(boundaryEdge).toBeInTheDocument();
		expect(boundaryEdge).toHaveAttribute('data-edge-visibility', 'boundary');
		expect(boundaryEdge.dataset.edgeOpacity).toBe('1');
	}}
/>

<Story
	name="UserConfirmsDuplicateEdgeRemoval"
	args={{
		multigraphData: makeGraph({
			nodeCount: 2,
			pinned: [0],
			edges: [[0, 1]],
			posByNodeId: {
				n0: { x: -200, y: 0 },
				n1: { x: 200, y: 0 }
			}
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { relaxIterations: 1, edgeSpringStrength: 1, enterExitDurationMs: 0 },
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const sourceCircle = getCircle(canvasElement, 'n0');
		const targetCircle = getCircle(canvasElement, 'n1');
		const sourceCenter = getCenter(sourceCircle);
		const targetCenter = getCenter(targetCircle);

		expect(canvasElement.querySelector('[data-edge-id="e0"]')).toBeInTheDocument();
		expect(canvasElement.querySelector('[role="dialog"]')).not.toBeInTheDocument();

		await dispatchDoubleClickDrag(
			sourceCircle,
			sourceCenter.x,
			sourceCenter.y,
			stage,
			targetCenter.x,
			targetCenter.y
		);
		await sleep();

		const dialog = canvasElement.querySelector('[role="dialog"]');
		expect(dialog).toBeInTheDocument();
		expect(dialog?.querySelector('.duplicate-edge-dialog-message')).toHaveTextContent(
			'Remove edge?'
		);
		expect(dialog?.querySelector('.duplicate-edge-dialog-edge')).toHaveTextContent(
			'Node 0 -- Node 1'
		);
		expect(
			Array.from(dialog!.querySelectorAll('button')).map((button) => button.textContent?.trim())
		).toEqual(['Cancel', 'Remove']);
		expect(canvasElement.querySelector('[data-edge-id="e0"]')).toBeInTheDocument();

		const confirmButton = canvasElement.querySelector(
			'.duplicate-edge-dialog-confirm'
		) as HTMLElement;
		confirmButton.click();
		await sleep();

		expect(canvasElement.querySelector('[role="dialog"]')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('[data-edge-id="e0"]')).not.toBeInTheDocument();
		expect(lastChangedGraph(args).edges).toEqual([]);
	}}
/>

<Story
	name="UserCancelsDuplicateEdgeRemoval"
	args={{
		multigraphData: makeGraph({
			nodeCount: 2,
			pinned: [0],
			edges: [[0, 1]],
			posByNodeId: {
				n0: { x: -200, y: 0 },
				n1: { x: 200, y: 0 }
			}
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { relaxIterations: 1, edgeSpringStrength: 1 },
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const sourceCircle = getCircle(canvasElement, 'n0');
		const targetCircle = getCircle(canvasElement, 'n1');
		const sourceCenter = getCenter(sourceCircle);
		const targetCenter = getCenter(targetCircle);

		expect(canvasElement.querySelector('[data-edge-id="e0"]')).toBeInTheDocument();

		await dispatchDoubleClickDrag(
			sourceCircle,
			sourceCenter.x,
			sourceCenter.y,
			stage,
			targetCenter.x,
			targetCenter.y
		);
		await sleep();

		const dialog = canvasElement.querySelector('[role="dialog"]');
		expect(dialog).toBeInTheDocument();
		expect(dialog?.querySelector('.duplicate-edge-dialog-message')).toHaveTextContent(
			'Remove edge?'
		);
		expect(dialog?.querySelector('.duplicate-edge-dialog-edge')).toHaveTextContent(
			'Node 0 -- Node 1'
		);

		const cancelButton = canvasElement.querySelector(
			'.duplicate-edge-dialog-cancel'
		) as HTMLElement;
		cancelButton.click();
		await sleep();

		expect(canvasElement.querySelector('[role="dialog"]')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('[data-edge-id="e0"]')).toBeInTheDocument();
		const spy = args.onMultigraphChange as ChangeSpy | undefined;
		expect(spy?.mock.calls.length ?? 0).toBe(0);
	}}
/>

<Story
	name="UserCreatesNodeAndAppliesTitleSyntaxInline"
	args={{
		multigraphData: makeGraph({
			nodeCount: 1,
			pinned: [0],
			edges: []
		}),
		defaultPrimaryNodeId: 'n0',
		initialViewState: { panX: 0, panY: 0, scale: 0.5 },
		layoutSettings: { relaxIterations: 1 },
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const stageRect = stage.getBoundingClientRect();
		const sourceCircle = getCircle(canvasElement, 'n0');
		const sourceCenter = getCenter(sourceCircle);
		// Pick a background point well past the node hit radius (node is at center, hit radius = 100px at scale 0.5)
		const bgX = stageRect.right - 20;
		const bgY = stageRect.top + stageRect.height / 2;

		await dispatchDoubleClickDrag(sourceCircle, sourceCenter.x, sourceCenter.y, stage, bgX, bgY);
		await sleep();
		await waitForLayout();

		const titleInput = canvasElement.querySelector('.title-input') as HTMLInputElement | null;
		expect(titleInput).toBeInTheDocument();
		expect(document.activeElement).toBe(titleInput);
		expect(canvasElement.querySelector('[data-node-id="n1"] .node')).toHaveAttribute(
			'data-pinned',
			'true'
		);
		expect(lastChangedGraph(args).nodes.find((node) => node.id === 'n1')?.pinned).toBe(true);

		titleInput!.value = '>:abc ;rel The displayed title';
		titleInput!.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
		);
		await sleep();

		expect(canvasElement.querySelector('.title-input')).not.toBeInTheDocument();
		expect(canvasElement).toHaveTextContent('The displayed title');
		expect(canvasElement).not.toHaveTextContent('>:abc ;rel');
		const changedGraph = lastChangedGraph(args);
		expect(changedGraph.nodes.find((node) => node.id === 'n1')).toMatchObject({
			title: 'The displayed title',
			tags: ['abc']
		});
		expect(changedGraph.edges.find((edge) => edge.id === 'e0')).toMatchObject({
			sourceNodeId: 'n0',
			targetNodeId: 'n1',
			tags: ['rel'],
			directed: true
		});
		expect(canvasElement.querySelector('[data-edge-id="e0"]')).toHaveAttribute(
			'data-arrow-target-node-id',
			'n1'
		);
	}}
/>

<Story
	name="UserLeavesInlineTitleEmpty"
	args={{
		multigraphData: makeGraph({
			nodeCount: 1,
			pinned: [0],
			edges: []
		}),
		defaultPrimaryNodeId: 'n0',
		initialViewState: { panX: 0, panY: 0, scale: 0.5 },
		layoutSettings: { relaxIterations: 1 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const stageRect = stage.getBoundingClientRect();
		const sourceCircle = getCircle(canvasElement, 'n0');
		const sourceCenter = getCenter(sourceCircle);
		const bgX = stageRect.right - 20;
		const bgY = stageRect.top + stageRect.height / 2;

		await dispatchDoubleClickDrag(sourceCircle, sourceCenter.x, sourceCenter.y, stage, bgX, bgY);
		await sleep();
		await waitForLayout();

		const titleInput = canvasElement.querySelector('.title-input') as HTMLInputElement | null;
		expect(titleInput).toBeInTheDocument();

		// Clear the pre-filled title and commit — expects fallback to 'New Node'
		titleInput!.value = '';
		titleInput!.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
		await sleep();

		expect(canvasElement.querySelector('.title-input')).not.toBeInTheDocument();
		expect(canvasElement).toHaveTextContent('New Node');
	}}
/>

<Story
	name="InlineTitleInputDoesNotStartStageDrag"
	args={{
		multigraphData: makeGraph({
			nodeCount: 1,
			pinned: [0],
			edges: []
		}),
		defaultPrimaryNodeId: 'n0',
		initialViewState: { panX: 0, panY: 0, scale: 0.5 },
		layoutSettings: {
			relaxIterations: 0,
			scaleAnimationDurationMs: 0,
			postDragSettleMaxFrames: 0,
			postScaleChangeSettleMaxFrames: 0,
			layeredRelayoutSettleMaxFrames: 1,
			layeredRelayoutSettleMaxFramesFinal: 1
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const stageRect = stage.getBoundingClientRect();
		const sourceCircle = getCircle(canvasElement, 'n0');
		const sourceCenter = getCenter(sourceCircle);
		const bgX = stageRect.right - 20;
		const bgY = stageRect.top + stageRect.height / 2;

		await dispatchDoubleClickDrag(sourceCircle, sourceCenter.x, sourceCenter.y, stage, bgX, bgY);
		await sleep();
		// Wait for the single relayout frame to finish so positions are stable
		await waitForFrames(4);

		const titleInput = canvasElement.querySelector('.title-input') as HTMLInputElement | null;
		expect(titleInput).toBeInTheDocument();

		const newNodeWrapper = titleInput!.closest('.node-wrapper') as HTMLElement;
		const xBefore = newNodeWrapper.dataset.x;
		const yBefore = newNodeWrapper.dataset.y;

		// Dispatch a pointer drag on the input exceeding the 5px drag threshold
		const inputRect = titleInput!.getBoundingClientRect();
		const cx = inputRect.left + inputRect.width / 2;
		const cy = inputRect.top + inputRect.height / 2;
		dispatchPointer(titleInput!, 'pointerdown', cx, cy);
		dispatchPointer(titleInput!, 'pointermove', cx + 20, cy + 20);
		dispatchPointer(titleInput!, 'pointerup', cx + 20, cy + 20);
		await sleep();

		// stopPropagation on the input prevents Stage from seeing the events — node must not move
		expect(newNodeWrapper.dataset.x).toBe(xBefore);
		expect(newNodeWrapper.dataset.y).toBe(yBefore);
		// No extra nodes or edges created by the input interaction
		expect(canvasElement.querySelectorAll('.node-wrapper')).toHaveLength(2);
		expect(canvasElement.querySelectorAll('.edge')).toHaveLength(1);
	}}
/>

<Story
	name="TagColorsRenderOnNodesAndEdges"
	args={{
		multigraphData: makeGraph({
			nodes: [
				{ id: 'n0', title: 'Topic', description: '', tags: ['topic'] },
				{ id: 'n1', title: 'Mixed', description: '', tags: ['topic', 'urgent'] },
				{ id: 'n2', title: 'Plain', description: '', tags: [] }
			],
			edges: [
				{ source: 'n0', target: 'n1', tags: ['rel'] },
				{ source: 'n1', target: 'n2', tags: [] }
			],
			posByNodeId: { n0: { x: -240, y: 0 }, n1: { x: 0, y: 0 }, n2: { x: 240, y: 0 } },
			tagColorConfig: {
				nodeTags: { topic: '#ff0000', urgent: '#00ff00' },
				edgeTags: { rel: '#0000ff' }
			}
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { relaxIterations: 0 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();

		expect(canvasElement.querySelector('[data-node-id="n0"] .node')).toHaveAttribute(
			'data-tag-border',
			'true'
		);
		expect(canvasElement.querySelector('[data-node-id="n1"] .node')).toHaveAttribute(
			'data-tag-border',
			'true'
		);
		expect(canvasElement.querySelector('[data-node-id="n2"] .node')).not.toHaveAttribute(
			'data-tag-border'
		);

		const taggedEdge = canvasElement.querySelector('[data-edge-id="e0"]') as HTMLElement;
		const plainEdge = canvasElement.querySelector('[data-edge-id="e1"]') as HTMLElement;
		expect(taggedEdge.style.getPropertyValue('--edge-background').trim()).toBe('#0000ff');
		expect(plainEdge.style.getPropertyValue('--edge-background').trim()).toBe('#888888');
	}}
/>

<Story
	name="UserChangesTagColorFromLegend"
	args={{
		multigraphData: makeGraph({
			nodes: [{ id: 'n0', title: 'Topic', description: '', tags: ['topic'] }],
			tagColorConfig: { nodeTags: { topic: '#ff0000' }, edgeTags: {} }
		}),
		defaultPrimaryNodeId: 'n0',
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		const canvas = within(canvasElement);
		canvas.getByRole('button', { name: 'Tag colors' }).click();
		await sleep();

		const colorInput = canvas.getByLabelText('Color for node tag topic') as HTMLInputElement;
		colorInput.value = '#00ff00';
		colorInput.dispatchEvent(new Event('input', { bubbles: true }));
		await sleep();

		expect(lastChangedGraph(args).tagColorConfig.nodeTags.topic).toBe('#00ff00');
	}}
/>

<Story
	name="UserDeletesTagsFromLegend"
	args={{
		multigraphData: makeGraph({
			nodes: [
				{ id: 'n0', title: 'Topic', description: '', tags: ['topic'] },
				{ id: 'n1', title: 'Other', description: '', tags: ['topic'] }
			],
			edges: [{ source: 'n0', target: 'n1', tags: ['rel', 'rel'] }],
			tagColorConfig: {
				nodeTags: { topic: '#ff0000', unused: '#00ff00' },
				edgeTags: { rel: '#0000ff' }
			}
		}),
		defaultPrimaryNodeId: 'n0',
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		const canvas = within(canvasElement);
		canvas.getByRole('button', { name: 'Tag colors' }).click();
		await sleep();

		canvas.getByRole('button', { name: 'Delete node tag unused' }).click();
		await sleep();
		expect(lastChangedGraph(args).tagColorConfig.nodeTags.unused).toBeUndefined();

		const originalConfirm = window.confirm;
		let confirmMessage = '';
		window.confirm = (message?: string) => {
			confirmMessage = String(message);
			return true;
		};
		try {
			canvas.getByRole('button', { name: 'Delete edge tag rel' }).click();
			await sleep();
		} finally {
			window.confirm = originalConfirm;
		}

		expect(confirmMessage).toContain('2 uses');
		const changedGraph = lastChangedGraph(args);
		expect(changedGraph.tagColorConfig.edgeTags.rel).toBeUndefined();
		expect(changedGraph.edges[0].tags).toEqual([]);
	}}
/>

<Story
	name="UserReordersEdgeTagsAndChangesStrokeColor"
	args={{
		multigraphData: makeGraph({
			nodeCount: 2,
			pinned: [0],
			edges: [{ source: 0, target: 1, tags: ['rel', 'strong'] }],
			posByNodeId: { n0: { x: -180, y: 0 }, n1: { x: 180, y: 0 } },
			tagColorConfig: {
				nodeTags: {},
				edgeTags: { rel: '#0000ff', strong: '#ff0000' }
			}
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { relaxIterations: 0 },
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		const edge = canvasElement.querySelector('[data-edge-id="e0"]') as HTMLElement;
		expect(edge.style.getPropertyValue('--edge-background').trim()).toBe('#0000ff');

		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);
		dispatchPointer(circle, 'pointerdown', center.x, center.y);
		await sleep(LONG_PRESS_MS + 20);

		const canvas = within(canvasElement);
		canvas.getByRole('menuitem', { name: 'Edit' }).click();
		await sleep();
		canvas.getByRole('tab', { name: 'Edges' }).click();
		await sleep();

		canvas.getByRole('button', { name: 'Move edge tag strong earlier' }).click();
		await sleep();

		expect(lastChangedGraph(args).edges[0].tags).toEqual(['strong', 'rel']);
		expect(edge.style.getPropertyValue('--edge-background').trim()).toBe('#ff0000');
	}}
/>

<Story
	name="StaticRenderChannel"
	args={{
		multigraphData: makeGraph({
			nodeCount: 3,
			pinned: [0],
			edges: [
				{ source: 0, target: 1 },
				{ source: 0, target: 2 }
			],
			posByNodeId: { n0: { x: 0, y: 0 }, n1: { x: 200, y: 0 }, n2: { x: -200, y: 0 } }
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { relaxIterations: 0 },
		nodeRenderOverrides: { n1: { opacity: 0.4 } },
		edgeRenderOverrides: { e0: { opacity: 0.3 } },
		exitingBuffer: {
			nodes: {
				n_exiting: {
					nodeData: { id: 'n_exiting', title: 'Exiting Node', description: '', tags: [] },
					x: 100,
					y: 100,
					fromScale: 1,
					startedAtMs: 0,
					durationMs: 0
				}
			},
			edges: {}
		} satisfies ExitingBuffer
	}}
	play={async ({ canvasElement }) => {
		await waitForLayout();

		// n1 should reflect the override opacity
		const n1Wrapper = getNodeWrapper(canvasElement, 'n1');
		expect(n1Wrapper.dataset.nodeOpacity).toBe('0.4');
		expect(n1Wrapper.style.opacity).toBe('0.4');

		// n0 has no override → default opacity 1
		const n0Wrapper = getNodeWrapper(canvasElement, 'n0');
		expect(n0Wrapper.dataset.nodeOpacity).toBe('1');

		// n2 has no override → default opacity 1
		const n2Wrapper = getNodeWrapper(canvasElement, 'n2');
		expect(n2Wrapper.dataset.nodeOpacity).toBe('1');

		// Existing data-scale attr is preserved
		expect(n0Wrapper.dataset.scale).toBeTruthy();

		// edge e0 should reflect the override opacity
		const edge0 = canvasElement.querySelector('[data-edge-id="e0"]') as HTMLElement;
		expect(edge0).toBeInTheDocument();
		expect(edge0.dataset.edgeOpacity).toBe('0.3');
		expect(edge0.style.opacity).toBe('0.3');

		// edge e1 has no override → default opacity 1
		const edge1 = canvasElement.querySelector('[data-edge-id="e1"]') as HTMLElement;
		expect(edge1).toBeInTheDocument();
		expect(edge1.dataset.edgeOpacity).toBe('1');

		// The exiting buffer node must render even though it is not in the visible set
		const exitingWrapper = canvasElement.querySelector('[data-node-id="n_exiting"]') as HTMLElement;
		expect(exitingWrapper).toBeInTheDocument();
		expect(exitingWrapper.dataset.nodeExiting).toBe('true');
		// It must not accept pointer events (non-interactive mid-exit)
		expect(exitingWrapper.style.pointerEvents).toBe('none');
	}}
/>

<Story
	name="VisibleEdgeFadesBehindUnrelatedNode"
	args={{
		multigraphData: makeGraph({
			nodeCount: 3,
			pinned: [0],
			edges: [
				{ source: 0, target: 1 },
				{ source: 0, target: 2 }
			],
			posByNodeId: {
				n0: { x: -200, y: 0 },
				n1: { x: 200, y: 0 },
				n2: { x: 0, y: 0 }
			}
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { baseRadius: 20, relaxIterations: 0, edgeOcclusionFadeWidthPx: 12 },
		edgeRenderOverrides: { e0: { opacity: 0.3 } }
	}}
	play={async ({ canvasElement }) => {
		await waitForLayout();

		const occludedEdge = canvasElement.querySelector('[data-edge-id="e0"]') as HTMLElement;
		expect(occludedEdge).toBeInTheDocument();
		expect(occludedEdge).toHaveAttribute('data-edge-visibility', 'visible');
		expect(occludedEdge).toHaveAttribute('data-edge-occlusion-count', '1');
		expect(occludedEdge).toHaveAttribute('data-edge-occlusion-fade-width', '12');
		expect(occludedEdge.dataset.edgeOpacity).toBe('0.3');
		expect(occludedEdge.style.opacity).toBe('0.3');
		expect(occludedEdge.style.getPropertyValue('--edge-background')).toContain('linear-gradient');

		const endpointOnlyEdge = canvasElement.querySelector('[data-edge-id="e1"]') as HTMLElement;
		expect(endpointOnlyEdge).toBeInTheDocument();
		expect(endpointOnlyEdge).toHaveAttribute('data-edge-occlusion-count', '0');
	}}
/>

<Story
	name="VisibleEdgeOcclusionFadeWidensWhenZoomedOut"
	args={{
		multigraphData: makeGraph({
			nodeCount: 3,
			pinned: [0],
			edges: [
				{ source: 0, target: 1 },
				{ source: 0, target: 2 }
			],
			posByNodeId: {
				n0: { x: -200, y: 0 },
				n1: { x: 200, y: 0 },
				n2: { x: 0, y: 0 }
			}
		}),
		defaultPrimaryNodeId: 'n0',
		initialViewState: { panX: 0, panY: 0, scale: 0.5 },
		layoutSettings: {
			baseRadius: 20,
			relaxIterations: 0,
			edgeOcclusionFadeWidthPx: 12,
			edgeOcclusionZoomScaleExponent: 0.5
		}
	}}
	play={async ({ canvasElement }) => {
		await waitForLayout();

		const occludedEdge = canvasElement.querySelector('[data-edge-id="e0"]') as HTMLElement;
		expect(occludedEdge).toBeInTheDocument();
		expect(occludedEdge).toHaveAttribute('data-edge-occlusion-count', '1');
		expect(Number(occludedEdge.dataset.edgeOcclusionFadeWidth)).toBeCloseTo(12 * Math.SQRT2);
		expect(occludedEdge.style.getPropertyValue('--edge-background')).toContain('linear-gradient');
	}}
/>

<Story
	name="VisibleEdgeKeepsFullColorBetweenSeparateOccluders"
	args={{
		multigraphData: makeGraph({
			nodes: [
				{ id: 'a', title: 'A', description: '', tags: [] },
				{ id: 'b', title: 'B', description: '', tags: [] },
				{ id: 'c', title: 'C', description: '', tags: [] },
				{ id: 'd', title: 'D', description: '', tags: [] }
			],
			pinned: ['a', 'b', 'c', 'd'],
			edges: [{ source: 'a', target: 'd' }],
			posByNodeId: {
				a: { x: -800, y: 0 },
				b: { x: -280, y: 0 },
				c: { x: 280, y: 0 },
				d: { x: 800, y: 0 }
			}
		}),
		defaultPrimaryNodeId: 'a',
		layoutSettings: {
			baseRadius: 20,
			relaxIterations: 0,
			edgeOcclusionClearancePx: 6,
			edgeOcclusionFadeWidthPx: 24,
			edgeOcclusionMinOpacity: 0.2
		}
	}}
	play={async ({ canvasElement }) => {
		await waitForLayout();

		const crossedEdge = getEdge(canvasElement, 'e0');
		expect(crossedEdge).toHaveAttribute('data-edge-visibility', 'visible');
		expect(crossedEdge).toHaveAttribute('data-edge-occlusion-count', '2');

		const stops = edgeGradientStops(crossedEdge);
		const fadedPositions = minOpacityStops(stops, '#888888', 0.2);
		expect(fadedPositions).toHaveLength(4);
		expect(
			stops.some(
				(stop) =>
					stop.color === '#888888' &&
					stop.position > fadedPositions[1] &&
					stop.position < fadedPositions[2]
			)
		).toBe(true);
	}}
/>

<Story
	name="VisibleEdgeZeroFadeCutoffWidensWhenZoomedOut"
	args={{
		multigraphData: makeGraph({
			nodes: [
				{ id: 'a', title: 'A', description: '', tags: [] },
				{ id: 'b', title: 'B', description: '', tags: [] },
				{ id: 'd', title: 'D', description: '', tags: [] }
			],
			pinned: ['a', 'b', 'd'],
			edges: [{ source: 'a', target: 'd' }],
			posByNodeId: {
				a: { x: -800, y: 0 },
				b: { x: 0, y: 0 },
				d: { x: 800, y: 0 }
			}
		}),
		defaultPrimaryNodeId: 'a',
		initialViewState: { panX: 0, panY: 0, scale: 1 },
		layoutSettings: {
			baseRadius: 20,
			relaxIterations: 0,
			edgeOcclusionClearancePx: 6,
			edgeOcclusionFadeWidthPx: 0,
			edgeOcclusionZoomScaleExponent: 0.5,
			edgeOcclusionMinOpacity: 0.2
		}
	}}
	play={async ({ canvasElement }) => {
		await waitForLayout();

		const stage = getStage(canvasElement);
		const edgeAtScaleOne = getEdge(canvasElement, 'e0');
		expect(edgeAtScaleOne).toHaveAttribute('data-edge-occlusion-count', '1');
		expect(edgeAtScaleOne).toHaveAttribute('data-edge-occlusion-fade-width', '0');
		const initialFadedPositions = minOpacityStops(
			edgeGradientStops(edgeAtScaleOne),
			'#888888',
			0.2
		);
		expect(initialFadedPositions).toHaveLength(2);

		dispatchWheel(stage, 250);
		await waitFor(() => {
			expect(getStageTransform(canvasElement)).toContain('scale(0.5)');
		});

		const zoomedOutEdge = getEdge(canvasElement, 'e0');
		expect(zoomedOutEdge).toHaveAttribute('data-edge-occlusion-count', '1');
		expect(zoomedOutEdge).toHaveAttribute('data-edge-occlusion-fade-width', '0');
		const zoomedOutFadedPositions = minOpacityStops(
			edgeGradientStops(zoomedOutEdge),
			'#888888',
			0.2
		);
		expect(zoomedOutFadedPositions).toHaveLength(2);
		expect(zoomedOutFadedPositions[0]).toBeLessThan(initialFadedPositions[0]);
		expect(zoomedOutFadedPositions[1]).toBeGreaterThan(initialFadedPositions[1]);
	}}
/>

<Story
	name="VisibleEdgeNearMissStaysSolid"
	args={{
		multigraphData: makeGraph({
			nodeCount: 3,
			pinned: [0],
			edges: [
				{ source: 0, target: 1 },
				{ source: 0, target: 2 }
			],
			posByNodeId: {
				n0: { x: -200, y: 0 },
				n1: { x: 200, y: 0 },
				n2: { x: 0, y: 17 }
			}
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: {
			baseRadius: 20,
			relaxIterations: 0,
			edgeOcclusionClearancePx: 6,
			edgeOcclusionFadeWidthPx: 12
		}
	}}
	play={async ({ canvasElement }) => {
		await waitForLayout();

		const nearMissEdge = canvasElement.querySelector('[data-edge-id="e0"]') as HTMLElement;
		expect(nearMissEdge).toBeInTheDocument();
		expect(nearMissEdge).toHaveAttribute('data-edge-visibility', 'visible');
		expect(nearMissEdge).toHaveAttribute('data-edge-occlusion-count', '0');
		expect(nearMissEdge.style.getPropertyValue('--edge-background').trim()).toBe('#888888');
	}}
/>

<Story
	name="DraggingUnrelatedNodeUpdatesEdgeOcclusion"
	args={{
		multigraphData: makeGraph({
			nodeCount: 3,
			pinned: [0],
			edges: [
				{ source: 0, target: 1 },
				{ source: 0, target: 2 }
			],
			posByNodeId: {
				n0: { x: -200, y: 0 },
				n1: { x: 200, y: 0 },
				n2: { x: 0, y: 140 }
			}
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { baseRadius: 20, relaxIterations: 0 }
	}}
	play={async ({ canvasElement }) => {
		await waitForLayout();

		const stage = getStage(canvasElement);
		const draggedCircle = getCircle(canvasElement, 'n2');
		const startCenter = getCenter(draggedCircle);
		const edge = getEdge(canvasElement, 'e0');
		const edgeCenter = getCenter(edge);

		expect(edge).toHaveAttribute('data-edge-occlusion-count', '0');
		expect(edge.style.getPropertyValue('--edge-background').trim()).toBe('#888888');

		dispatchPointer(draggedCircle, 'pointerdown', startCenter.x, startCenter.y);
		dispatchPointer(stage, 'pointermove', edgeCenter.x, edgeCenter.y);

		await waitFor(() => {
			const occludedEdge = getEdge(canvasElement, 'e0');
			expect(occludedEdge).toHaveAttribute('data-edge-occlusion-count', '1');
			expect(occludedEdge.style.getPropertyValue('--edge-background')).toContain('linear-gradient');
		});

		dispatchPointer(stage, 'pointermove', edgeCenter.x, edgeCenter.y - 140);

		await waitFor(() => {
			const clearedEdge = getEdge(canvasElement, 'e0');
			expect(clearedEdge).toHaveAttribute('data-edge-occlusion-count', '0');
			expect(clearedEdge.style.getPropertyValue('--edge-background').trim()).toBe('#888888');
		});

		dispatchPointer(stage, 'pointerup', edgeCenter.x, edgeCenter.y - 140);
	}}
/>

<Story
	name="NewNodeScalesInOnBackgroundDrop"
	args={{
		multigraphData: makeGraph({
			nodeCount: 1,
			posByNodeId: { n0: { x: -280, y: 0 } }
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { relaxIterations: 0 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const sourceCircle = getCircle(canvasElement, 'n0');
		const sourceCenter = getCenter(sourceCircle);
		const dropX = sourceCenter.x + 400;
		const dropY = sourceCenter.y;

		await dispatchDoubleClickDrag(
			sourceCircle,
			sourceCenter.x,
			sourceCenter.y,
			stage,
			dropX,
			dropY
		);

		// Immediately after the drop, new node and edge enter animations start.
		// Check mid-animation state (before animation completes).
		await waitForFrames(2);

		const newNodeWrapper = canvasElement.querySelector(
			'[data-node-id="n1"].node-wrapper'
		) as HTMLElement | null;
		expect(newNodeWrapper).toBeInTheDocument();

		const newNodeScale = Number(newNodeWrapper!.dataset.scale);
		expect(newNodeScale).toBeGreaterThan(0);
		expect(newNodeScale).toBeLessThan(1);

		const newEdge = canvasElement.querySelector(
			'.edge[data-source-node-id="n0"][data-target-node-id="n1"]'
		) as HTMLElement | null;
		expect(newEdge).toBeInTheDocument();

		const newEdgeOpacity = Number(newEdge!.dataset.edgeOpacity);
		expect(newEdgeOpacity).toBeGreaterThan(0);
		expect(newEdgeOpacity).toBeLessThan(1);
	}}
/>

<Story
	name="RemovedEdgeFadesOutAfterDuplicateConfirm"
	args={{
		multigraphData: makeGraph({
			nodeCount: 2,
			pinned: [0],
			edges: [[0, 1]],
			posByNodeId: {
				n0: { x: -200, y: 0 },
				n1: { x: 200, y: 0 }
			}
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { relaxIterations: 0 },
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const sourceCircle = getCircle(canvasElement, 'n0');
		const targetCircle = getCircle(canvasElement, 'n1');
		const sourceCenter = getCenter(sourceCircle);
		const targetCenter = getCenter(targetCircle);

		// Create duplicate edge to trigger the confirm dialog.
		await dispatchDoubleClickDrag(
			sourceCircle,
			sourceCenter.x,
			sourceCenter.y,
			stage,
			targetCenter.x,
			targetCenter.y
		);
		await sleep();

		const confirmButton = canvasElement.querySelector(
			'.duplicate-edge-dialog-confirm'
		) as HTMLElement;
		expect(confirmButton).toBeInTheDocument();
		confirmButton.click();

		// Mid-exit: edge is still in the DOM (exiting buffer) but fading out.
		await waitForFrames(2);

		const exitingEdge = canvasElement.querySelector('[data-edge-id="e0"]') as HTMLElement | null;
		expect(exitingEdge).toBeInTheDocument();
		expect(exitingEdge!.dataset.edgeExiting).toBe('true');
		const midOpacity = Number(exitingEdge!.dataset.edgeOpacity);
		expect(midOpacity).toBeGreaterThan(0);
		expect(midOpacity).toBeLessThan(1);

		// After the exit animation completes, the edge is pruned from the buffer.
		await sleep(APP_CONFIG.multigraph.layout.enterExitDurationMs + 40);
		await waitForLayout();

		expect(canvasElement.querySelector('[data-edge-id="e0"]')).not.toBeInTheDocument();
		expect(lastChangedGraph(args).edges).toEqual([]);
	}}
/>
