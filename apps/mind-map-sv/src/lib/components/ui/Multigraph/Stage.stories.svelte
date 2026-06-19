<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, within } from 'storybook/test';
	import StageHarness from './StageHarness.svelte';
	import type { NodeData } from '../types/node';
	import { DBL_CLICK_MS, DRAG_THRESHOLD, LONG_PRESS_MS, NODE_RADIUS } from '$lib/constants';

	const NODES: NodeData[] = [];
	for (let i = 0; i < 10; i++) {
		NODES.push({
			id: `node-${i}`,
			title: `Node ${i}`,
			description: `Node ${i} description`,
			tags: []
		});
	}

	const { Story } = defineMeta({
		title: 'Components/Multigraph/Stage',
		component: StageHarness,
		tags: [],
		argTypes: {
			nodes: { control: 'object' },
			positions: { control: 'object' },
			initialScale: { control: 'number' },
			initialPanX: { control: 'number' },
			initialPanY: { control: 'number' }
		},
		parameters: {
			viewport: {
				defaultViewport: 'phone'
			}
		}
	});

	function getStage(el: HTMLElement): HTMLElement {
		const stage = el.querySelector('.stage');
		if (!stage) throw new Error('Stage not found');
		return stage as HTMLElement;
	}

	function getStageContent(el: HTMLElement): HTMLElement {
		const content = el.querySelector('.stage-content');
		if (!content) throw new Error('Stage content not found');
		return content as HTMLElement;
	}

	function getStageTransform(el: HTMLElement): string {
		return getStageContent(el).style.transform || '';
	}

	function dispatchPointer(
		target: HTMLElement,
		type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
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

	function getCenter(el: HTMLElement): { x: number; y: number } {
		const r = el.getBoundingClientRect();
		return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
	}

	function getGraphPoint(
		stage: HTMLElement,
		clientX: number,
		clientY: number
	): { x: number; y: number } {
		const center = getCenter(stage);
		return { x: clientX - center.x, y: clientY - center.y };
	}

	function parsePointCallback(value: string): { nodeId: string; x: number; y: number } {
		const [nodeId, x, y] = value.split(',');
		return { nodeId, x: Number(x), y: Number(y) };
	}

	function parseViewStateCallback(value: string): { panX: number; panY: number; scale: number } {
		const [panX, panY, scale] = value.split(',');
		return { panX: Number(panX), panY: Number(panY), scale: Number(scale) };
	}

	function sleep(ms: number = 0) {
		return new Promise((r) => setTimeout(r, ms));
	}

	function waitForLayout(): Promise<void> {
		return new Promise((r) => {
			requestAnimationFrame(() => requestAnimationFrame(() => r()));
		});
	}

	/** Simulate double-click at (x, y) on target so Stage treats it as make-primary. */
	async function dispatchDoubleClick(target: HTMLElement, x: number, y: number): Promise<void> {
		dispatchPointer(target, 'pointerdown', x, y);
		dispatchPointer(target, 'pointerup', x, y);
		await sleep(DBL_CLICK_MS * 0.1);
		dispatchPointer(target, 'pointerdown', x, y);
		dispatchPointer(target, 'pointerup', x, y);
	}

	/** Simulate double-click then drag to (toX, toY) for double-click-drop (e.g. add node/edge). */
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
		await sleep(50);
		dispatchPointer(fromTarget, 'pointerdown', fromX, fromY);
		dispatchPointer(toTarget, 'pointermove', toX, toY);
		dispatchPointer(toTarget, 'pointerup', toX, toY);
	}
</script>

<Story name="Summary" args={{ nodes: NODES.slice(0, 3) }} />

<Story
	name="StartsAtInitialScale"
	args={{ nodes: NODES.slice(0, 3), initialScale: 0.5 }}
	play={async ({ canvasElement }) => {
		await waitForLayout();
		expect(getStageTransform(canvasElement)).toContain('scale(0.5)');
	}}
/>

<Story
	name="StartsAtInitialPan"
	args={{ nodes: NODES.slice(0, 3), initialPanX: 80, initialPanY: -40 }}
	play={async ({ canvasElement }) => {
		await waitForLayout();
		expect(getStageTransform(canvasElement)).toContain('translate(80px, -40px)');
	}}
/>

<Story
	name="StartsAtInitialPanAndScale"
	args={{ nodes: NODES.slice(0, 3), initialPanX: 50, initialPanY: 30, initialScale: 1.5 }}
	play={async ({ canvasElement }) => {
		await waitForLayout();
		const transform = getStageTransform(canvasElement);
		expect(transform).toContain('translate(50px, 30px)');
		expect(transform).toContain('scale(1.5)');
	}}
/>

<Story
	name="PanEmitsViewStateChange"
	args={{ nodes: [] }}
	play={async ({ canvasElement }) => {
		const wrapper = canvasElement.querySelector('[data-testid="stage-callbacks"]') as HTMLElement;
		const stage = getStage(canvasElement);

		await waitForLayout();

		expect(wrapper.dataset.lastViewState).toBe('');

		const center = getCenter(stage);
		dispatchPointer(stage, 'pointerdown', center.x, center.y);
		dispatchPointer(stage, 'pointermove', center.x + 60, center.y + 40);
		dispatchPointer(stage, 'pointerup', center.x + 60, center.y + 40);

		await sleep();

		const parts = (wrapper.dataset.lastViewState ?? '').split(',');
		expect(parts).toHaveLength(3);
		expect(Number(parts[0])).toBeCloseTo(60);
		expect(Number(parts[1])).toBeCloseTo(40);
		expect(Number(parts[2])).toBeCloseTo(1);
	}}
/>

<Story
	name="WheelZoomEmitsViewStateChange"
	args={{ nodes: [] }}
	play={async ({ canvasElement }) => {
		const wrapper = canvasElement.querySelector('[data-testid="stage-callbacks"]') as HTMLElement;
		const stage = getStage(canvasElement);

		await waitForLayout();

		const center = getCenter(stage);
		dispatchWheel(stage, -200, center.x + 80, center.y + 40);

		await sleep();

		const viewState = parseViewStateCallback(wrapper.dataset.lastViewState ?? '');
		expect(viewState.scale).toBeGreaterThan(1);
		expect(viewState.panX).toBeCloseTo(80 - 80 * viewState.scale);
		expect(viewState.panY).toBeCloseTo(40 - 40 * viewState.scale);
	}}
/>

<Story
	name="StartsAtInitialPanAndZoom"
	args={{ nodes: NODES.slice(0, 3), initialScale: 1.5, initialPanX: 32, initialPanY: -24 }}
	play={async ({ canvasElement }) => {
		await waitForLayout();
		expect(getStageTransform(canvasElement)).toContain('translate(32px, -24px) scale(1.5)');
	}}
/>

<Story
	name="Empty"
	args={{ nodes: [] }}
	play={async ({ canvasElement }) => {
		const wrapper = canvasElement.querySelector('[data-testid="stage-callbacks"]') as HTMLElement;
		expect(wrapper).toBeInTheDocument();
		const stage = getStage(canvasElement);
		expect(stage).toBeInTheDocument();

		await waitForLayout();

		const initialTransform = getStageTransform(canvasElement);
		const center = getCenter(stage);

		// Pan: down, move, up
		dispatchPointer(stage, 'pointerdown', center.x, center.y);
		dispatchPointer(stage, 'pointermove', center.x + 50, center.y + 30);
		dispatchPointer(stage, 'pointerup', center.x + 50, center.y + 30);

		// Wait for Svelte to flush reactive updates to the DOM
		await sleep();

		const afterPan = getStageTransform(canvasElement);
		expect(afterPan).toContain('translate');
		expect(afterPan).not.toBe(initialTransform);

		// Zoom: wheel
		dispatchWheel(stage, -100);
		await sleep();
		const afterZoom = getStageTransform(canvasElement);
		expect(afterZoom).toContain('scale');
		expect(afterZoom).toContain('translate');
	}}
/>

<Story
	name="SingleNode"
	args={{
		nodes: [NODES[0]]
	}}
	play={async ({ canvasElement }) => {
		const wrapper = canvasElement.querySelector('[data-testid="stage-callbacks"]') as HTMLElement;
		expect(wrapper).toBeInTheDocument();
		await expect(within(canvasElement).getByText(NODES[0].title)).toBeInTheDocument();

		const stage = getStage(canvasElement);
		const circle = canvasElement.querySelector('.circle') as HTMLElement;
		expect(circle).toBeInTheDocument();

		await waitForLayout();

		const nodeCenter = getCenter(circle);

		// Double-click to make primary node
		await dispatchDoubleClick(circle, nodeCenter.x, nodeCenter.y);
		await sleep();
		expect(wrapper.dataset.lastMakePrimary).toBe(NODES[0].id);

		// Double-click then drag to background (add node/edge)
		await dispatchDoubleClickDrag(
			circle,
			nodeCenter.x,
			nodeCenter.y,
			stage,
			nodeCenter.x + (NODE_RADIUS + 10),
			nodeCenter.y + (NODE_RADIUS + 10)
		);
		await sleep();
		const backgroundDrop = parsePointCallback(wrapper.dataset.lastDoubleClickDropBg ?? '');
		const expectedBackgroundPoint = getGraphPoint(
			stage,
			nodeCenter.x + (NODE_RADIUS + 10),
			nodeCenter.y + (NODE_RADIUS + 10)
		);
		expect(backgroundDrop.nodeId).toBe(NODES[0].id);
		expect(backgroundDrop.x).toBeCloseTo(expectedBackgroundPoint.x);
		expect(backgroundDrop.y).toBeCloseTo(expectedBackgroundPoint.y);

		// Self-drops intentionally follow the background-drop path.
		await dispatchDoubleClickDrag(
			circle,
			nodeCenter.x,
			nodeCenter.y,
			circle,
			nodeCenter.x + DRAG_THRESHOLD * 2,
			nodeCenter.y + DRAG_THRESHOLD * 2
		);
		await sleep();
		const selfDrop = parsePointCallback(wrapper.dataset.lastDoubleClickDropBg ?? '');
		const expectedSelfDropPoint = getGraphPoint(
			stage,
			nodeCenter.x + DRAG_THRESHOLD * 2,
			nodeCenter.y + DRAG_THRESHOLD * 2
		);
		expect(selfDrop.nodeId).toBe(NODES[0].id);
		expect(selfDrop.x).toBeCloseTo(expectedSelfDropPoint.x);
		expect(selfDrop.y).toBeCloseTo(expectedSelfDropPoint.y);
		expect(wrapper.dataset.lastDoubleClickDropNode).toBe('');

		// Long-press fires once without interfering with later gestures.
		dispatchPointer(circle, 'pointerdown', nodeCenter.x, nodeCenter.y);
		await sleep(LONG_PRESS_MS + 20);
		expect(wrapper.dataset.lastNodeLongPress?.startsWith(NODES[0].id)).toBe(true);
		dispatchPointer(circle, 'pointerup', nodeCenter.x, nodeCenter.y);

		// Single-click drag to move node
		const moveToX = nodeCenter.x + (NODE_RADIUS + 10);
		const moveToY = nodeCenter.y;
		dispatchPointer(circle, 'pointerdown', nodeCenter.x, nodeCenter.y);
		dispatchPointer(stage, 'pointermove', moveToX, moveToY);
		dispatchPointer(stage, 'pointerup', moveToX, moveToY);
		await sleep();
		const moved = wrapper.dataset.lastNodeMoved ?? '';
		const movedPoint = parsePointCallback(moved);
		const expectedMovedPoint = getGraphPoint(stage, moveToX, moveToY);
		expect(movedPoint.nodeId).toBe(NODES[0].id);
		expect(movedPoint.x).toBeCloseTo(expectedMovedPoint.x);
		expect(movedPoint.y).toBeCloseTo(expectedMovedPoint.y);
		expect(wrapper.dataset.lastNodeDragStart).toBe(NODES[0].id);
		expect(wrapper.dataset.lastNodeDragEnd).toBe(NODES[0].id);
	}}
/>

<Story
	name="TwoNodes"
	args={{
		nodes: [NODES[0], NODES[1]],
		positions: {
			[NODES[0].id]: { left: '5%', top: '50%' },
			[NODES[1].id]: { left: '95%', top: '50%' }
		}
	}}
	play={async ({ canvasElement }) => {
		const wrapper = canvasElement.querySelector('[data-testid="stage-callbacks"]') as HTMLElement;
		expect(wrapper).toBeInTheDocument();
		await expect(within(canvasElement).getByText(NODES[0].title)).toBeInTheDocument();
		await expect(within(canvasElement).getByText(NODES[1].title)).toBeInTheDocument();

		const stage = getStage(canvasElement);
		const circles = canvasElement.querySelectorAll('.circle');
		expect(circles.length).toBeGreaterThanOrEqual(2);
		const firstCircle = circles[0] as HTMLElement;
		const secondCircle = circles[1] as HTMLElement;

		await waitForLayout();

		const fromCenter = getCenter(firstCircle);
		const toCenter = getCenter(secondCircle);

		// Single-click drag node 1 to move it (release at a new position)
		const moveToX = fromCenter.x + 80;
		const moveToY = fromCenter.y;
		dispatchPointer(stage, 'pointerdown', fromCenter.x, fromCenter.y);
		dispatchPointer(stage, 'pointermove', moveToX, moveToY);
		dispatchPointer(stage, 'pointerup', moveToX, moveToY);
		await sleep();
		const moved = parsePointCallback(wrapper.dataset.lastNodeMoved ?? '');
		const expectedMovedPoint = getGraphPoint(stage, moveToX, moveToY);
		expect(moved.nodeId).toBe(NODES[0].id);
		expect(moved.x).toBeCloseTo(expectedMovedPoint.x);
		expect(moved.y).toBeCloseTo(expectedMovedPoint.y);

		// Double-click node 1 to make primary
		await dispatchDoubleClick(firstCircle, fromCenter.x, fromCenter.y);
		await sleep();
		expect(wrapper.dataset.lastMakePrimary).toBe(NODES[0].id);

		// Double-click then drag node 1 onto node 2 (add edge)
		await dispatchDoubleClickDrag(
			firstCircle,
			fromCenter.x,
			fromCenter.y,
			stage,
			toCenter.x,
			toCenter.y
		);
		await sleep();
		expect(wrapper.dataset.lastDoubleClickDropNode).toBe(`${NODES[0].id},${NODES[1].id}`);
	}}
/>

<Story
	name="PanAndZoom"
	args={{ nodes: [] }}
	play={async ({ canvasElement }) => {
		const wrapper = canvasElement.querySelector('[data-testid="stage-callbacks"]') as HTMLElement;
		const stage = getStage(canvasElement);

		await waitForLayout();

		const center = getCenter(stage);

		// Pan
		dispatchPointer(stage, 'pointerdown', center.x, center.y);
		dispatchPointer(stage, 'pointermove', center.x + 20, center.y + 20);
		dispatchPointer(stage, 'pointerup', center.x + 20, center.y + 20);
		await sleep();
		const afterPan = getStageTransform(canvasElement);
		expect(afterPan).toContain('translate(20px, 20px)');
		let viewState = parseViewStateCallback(wrapper.dataset.lastViewState ?? '');
		expect(viewState.panX).toBe(20);
		expect(viewState.panY).toBe(20);
		expect(viewState.scale).toBe(1);

		// Zoom in (negative deltaY)
		dispatchWheel(stage, -200);
		await sleep();
		const afterZoom = getStageTransform(canvasElement);
		expect(afterZoom).toMatch(/scale\([1-9]/);
		viewState = parseViewStateCallback(wrapper.dataset.lastViewState ?? '');
		expect(viewState.scale).toBeGreaterThan(1);
		expect(viewState.panX).toBeCloseTo(20 * viewState.scale);
		expect(viewState.panY).toBeCloseTo(20 * viewState.scale);
	}}
/>

<Story
	name="PanAfterZoomOutAtViewportEdge"
	args={{ nodes: [] }}
	play={async ({ canvasElement }) => {
		const stage = getStage(canvasElement);

		await waitForLayout();

		const rect = stage.getBoundingClientRect();
		const edge = { x: rect.left + rect.width * 0.1, y: rect.top + rect.height * 0.1 };

		dispatchWheel(stage, 400);
		await sleep();
		const afterZoomOut = getStageTransform(canvasElement);
		expect(afterZoomOut).toMatch(/scale\(0\./);

		dispatchPointer(stage, 'pointerdown', edge.x, edge.y);
		dispatchPointer(stage, 'pointermove', edge.x + 30, edge.y + 20);
		dispatchPointer(stage, 'pointerup', edge.x + 30, edge.y + 20);
		await sleep();

		const afterPan = getStageTransform(canvasElement);
		expect(afterPan).toContain('translate(30px, 20px)');
	}}
/>
