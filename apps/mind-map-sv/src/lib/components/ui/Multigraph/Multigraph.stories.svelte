<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Multigraph from '$lib/components/ui/Multigraph/Multigraph.svelte';
	import { expect } from 'storybook/test';
	import { DBL_CLICK_MS, NODE_RADIUS } from '$lib/constants';
	import { makeGraph } from './lib/testFixtures';
	import type { MultigraphData, Point } from '../types/multigraph';

	const { Story } = defineMeta({
		title: 'Components/Multigraph',
		component: Multigraph,
		tags: [],
		argTypes: {
			multigraphData: { control: 'object' },
			defaultPrimaryNodeId: { control: 'text' },
			layoutSettings: { control: 'object' }
		}
	});

	type PlayContext = {
		canvasElement: HTMLElement;
		canvas: { getByText: (text: string) => HTMLElement };
		args: { multigraphData: MultigraphData; defaultPrimaryNodeId?: string };
	};

	function getStage(el: HTMLElement): HTMLElement {
		const stage = el.querySelector('.stage');
		if (!stage) throw new Error('Stage not found');
		return stage as HTMLElement;
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

	function sleep(ms: number = 0) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	function waitForLayout(): Promise<void> {
		return new Promise((resolve) => {
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
		});
	}

	function chainEdges(count: number): Array<[number, number]> {
		return Array.from({ length: count - 1 }, (_, index) => [index, index + 1]);
	}

	function circlePositions(count: number, radius: number): Record<string, Point> {
		return Object.fromEntries(
			Array.from({ length: count }, (_, index) => {
				const angle = (index / count) * Math.PI * 2;
				return [`n${index}`, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }];
			})
		);
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
</script>

<Story
	name="Single"
	args={{
		multigraphData: {
			nodes: [{ id: '1', title: 'Node 1', description: 'Node 1 description' }],
			edges: [],
			posByNodeId: {}
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
	name="UserPinsANode"
	args={{
		multigraphData: makeGraph({ nodeCount: 1 }),
		defaultPrimaryNodeId: 'n0'
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);

		await dispatchDoubleClick(circle, center.x, center.y);
		await sleep();

		const node = canvasElement.querySelector('[data-node-id="n0"] .node');
		expect(node).toHaveAttribute('data-pinned', 'true');
	}}
/>

<Story
	name="UserPinsNodeAndNeighborsScaleDownWithDistance"
	args={{
		multigraphData: makeGraph({
			nodeCount: 4,
			edges: [
				[0, 1],
				[1, 2]
			],
			posByNodeId: {
				n0: { x: -360, y: 0 },
				n1: { x: -120, y: 0 },
				n2: { x: 120, y: 0 },
				n3: { x: 360, y: 0 }
			}
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { scaleFalloff: 0.5, minScale: 0.2, relaxIterations: 0 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);

		await dispatchDoubleClick(circle, center.x, center.y);
		await sleep();

		expect(Number(getNodeWrapper(canvasElement, 'n0').dataset.scale)).toBe(1);
		expect(Number(getNodeWrapper(canvasElement, 'n1').dataset.scale)).toBe(0.5);
		expect(Number(getNodeWrapper(canvasElement, 'n2').dataset.scale)).toBe(0.25);
		expect(Number(getNodeWrapper(canvasElement, 'n3').dataset.scale)).toBe(0.2);
	}}
/>

<Story
	name="UserUnpinsAPinnedNode"
	args={{
		multigraphData: makeGraph({ nodeCount: 1, pinned: [0] }),
		defaultPrimaryNodeId: 'n0'
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);

		await dispatchDoubleClick(circle, center.x, center.y);
		await sleep();

		const node = canvasElement.querySelector('[data-node-id="n0"] .node');
		expect(node).not.toHaveAttribute('data-pinned');
	}}
/>

<Story
	name="UserAddsAnEdgeBetweenNodes"
	args={{
		multigraphData: makeGraph({
			nodeCount: 2,
			posByNodeId: { n0: { x: -280, y: 0 }, n1: { x: 280, y: 0 } }
		}),
		defaultPrimaryNodeId: 'n0'
	}}
	play={async ({ canvasElement }: PlayContext) => {
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

		const edgeRect = (edge as HTMLElement).getBoundingClientRect();
		expect(edgeRect.left).toBeCloseTo(sourceCenter.x);
		expect(edgeRect.right).toBeCloseTo(targetCenter.x);
		expect(edgeRect.top + edgeRect.height / 2).toBeCloseTo(sourceCenter.y);
	}}
/>

<Story
	name="UserAddsConnectedNodeOnBackgroundDrop"
	args={{
		multigraphData: makeGraph({
			nodeCount: 1,
			posByNodeId: { n0: { x: -280, y: 0 } }
		}),
		defaultPrimaryNodeId: 'n0'
	}}
	play={async ({ canvasElement }: PlayContext) => {
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

		const newCircle = getCircle(canvasElement, 'n1');
		const newCenter = getCenter(newCircle);
		expect(newCenter.x).toBeCloseTo(dropX);
		expect(newCenter.y).toBeCloseTo(dropY);
		expect(canvasElement.querySelector('[data-edge-id="e0"]')).toBeInTheDocument();
	}}
/>

<Story
	name="MovingNodeDoesNotMutateStoryArgs"
	args={{
		multigraphData: makeGraph({ nodeCount: 1 }),
		defaultPrimaryNodeId: 'n0'
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
			posByNodeId: { n0: { x: -160, y: 0 }, n1: { x: 160, y: 0 } }
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { baseRadius: 200, minScale: 1, paddingPx: 12, relaxIterations: 2 }
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
		await waitForLayout();

		const movedSourceCenter = getCenter(getCircle(canvasElement, 'n0'));
		const movedTargetCenter = getCenter(getCircle(canvasElement, 'n1'));
		expect(movedSourceCenter.x).toBeCloseTo(targetCenter.x);
		expect(movedSourceCenter.y).toBeCloseTo(targetCenter.y);
		expect(Number.isFinite(movedTargetCenter.x)).toBe(true);
		expect(Math.abs(movedTargetCenter.x - movedSourceCenter.x)).toBeGreaterThan(0);
		expect(Math.abs(movedTargetCenter.x)).toBeLessThan(stage.getBoundingClientRect().width);
	}}
/>

<Story
	name="PinnedNodesDoNotMoveWhenBumped"
	args={{
		multigraphData: makeGraph({
			nodeCount: 2,
			pinned: [0],
			posByNodeId: { n0: { x: -120, y: 0 }, n1: { x: 240, y: 0 } }
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { baseRadius: 120, minScale: 1, paddingPx: 12, relaxIterations: 2 }
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
			edges: chainEdges(12),
			posByNodeId: circlePositions(20, 300)
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { scaleFalloff: 0.5, minScale: 0.2, relaxIterations: 2 }
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
			posByNodeId: circlePositions(100, 480)
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { scaleFalloff: 0.7, minScale: 0.1, paddingPx: 12, relaxIterations: 4 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();

		expect(canvasElement.querySelectorAll('.node-wrapper')).toHaveLength(100);
		expect(Number(getNodeWrapper(canvasElement, 'n0').dataset.scale)).toBe(1);
		expect(Number(getNodeWrapper(canvasElement, 'n50').dataset.scale)).toBeGreaterThanOrEqual(0.1);
	}}
/>
