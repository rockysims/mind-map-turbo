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
		pointerId = 1,
		pointerType = '',
		button = 0,
		modifiers: { shiftKey?: boolean } = {}
	) {
		target.dispatchEvent(
			new PointerEvent(type, {
				clientX,
				clientY,
				pointerId,
				pointerType,
				button,
				shiftKey: modifiers.shiftKey ?? false,
				bubbles: true,
				cancelable: true
			})
		);
	}

	/** Right mouse button, which shares its pointerId with the primary button. */
	const SECONDARY_BUTTON = 2;

	function dispatchContextMenu(target: HTMLElement, clientX: number, clientY: number): MouseEvent {
		const event = new MouseEvent('contextmenu', {
			clientX,
			clientY,
			bubbles: true,
			cancelable: true
		});
		target.dispatchEvent(event);
		return event;
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

	function getCallbacks(el: HTMLElement): HTMLElement {
		const wrapper = el.querySelector('[data-testid="stage-callbacks"]');
		if (!(wrapper instanceof HTMLElement)) throw new Error('Stage harness not found');
		return wrapper;
	}

	function getSelectionBox(stage: HTMLElement): HTMLElement | null {
		const box = stage.querySelector('.selection-box');
		return box instanceof HTMLElement ? box : null;
	}

	interface ReportedRect {
		left: number;
		top: number;
		width: number;
		height: number;
	}

	/** `left,top,width,height[,flag]` as the harness writes a box callback. */
	function parseRectCallback(value: string): ReportedRect & { flag: string } {
		const [left, top, width, height, flag] = value.split(',');
		return {
			left: Number(left),
			top: Number(top),
			width: Number(width),
			height: Number(height),
			flag: flag ?? ''
		};
	}

	/** `x,y[,flag]` as the harness writes a background callback. */
	function parseBackgroundPointCallback(value: string): { x: number; y: number; flag: string } {
		const [x, y, flag] = value.split(',');
		return { x: Number(x), y: Number(y), flag: flag ?? '' };
	}

	function expectRectCloseTo(actual: ReportedRect, expected: ReportedRect) {
		expect(actual.left).toBeCloseTo(expected.left);
		expect(actual.top).toBeCloseTo(expected.top);
		expect(actual.width).toBeCloseTo(expected.width);
		expect(actual.height).toBeCloseTo(expected.height);
	}

	/**
	 * A click on empty canvas, then a second press at the same spot that moves
	 * to (toX, toY) and is left held: the background twin of
	 * `dispatchDoubleClickDrag`. The box is open when this returns.
	 */
	async function dispatchBackgroundDoubleClickDrag(
		stage: HTMLElement,
		fromX: number,
		fromY: number,
		toX: number,
		toY: number,
		pointerType = ''
	): Promise<void> {
		dispatchPointer(stage, 'pointerdown', fromX, fromY, 1, pointerType);
		dispatchPointer(stage, 'pointerup', fromX, fromY, 1, pointerType);
		await sleep(50);
		dispatchPointer(stage, 'pointerdown', fromX, fromY, 1, pointerType);
		dispatchPointer(stage, 'pointermove', toX, toY, 1, pointerType);
		await sleep();
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
	name="WheelOverInscribedNodeFeedsBoundaryAtMax"
	args={{ nodes: [NODES[0]], initialScale: 4 }}
	play={async ({ canvasElement }) => {
		const wrapper = canvasElement.querySelector('[data-testid="stage-callbacks"]') as HTMLElement;
		const stage = getStage(canvasElement);
		const circle = canvasElement.querySelector('.circle') as HTMLElement;

		await waitForLayout();

		const center = getCenter(circle);
		dispatchWheel(stage, -200, center.x, center.y);
		await sleep();

		const liveViewState = parseViewStateCallback(wrapper.dataset.lastLiveViewState ?? '');
		const persistedViewState = parseViewStateCallback(wrapper.dataset.lastViewState ?? '');
		expect(liveViewState.scale).toBe(4);
		expect(persistedViewState.scale).toBe(4);
		expect(wrapper.dataset.lastBlockedZoom?.startsWith('in,')).toBe(true);
		expect(getStageTransform(canvasElement)).toContain(`scale(${liveViewState.scale})`);
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

		// Self-drops cancel the creation gesture instead of creating a node.
		const dropBgBeforeSelfDrop = wrapper.dataset.lastDoubleClickDropBg;
		await dispatchDoubleClickDrag(
			circle,
			nodeCenter.x,
			nodeCenter.y,
			circle,
			nodeCenter.x + DRAG_THRESHOLD * 2,
			nodeCenter.y + DRAG_THRESHOLD * 2
		);
		await sleep();
		expect(wrapper.dataset.lastDoubleClickDropBg).toBe(dropBgBeforeSelfDrop);
		expect(wrapper.dataset.lastDoubleClickDropNode).toBe('');
		expect(wrapper.dataset.lastCreationCancel).toBe(NODES[0].id);

		// Long-press (touch pointers only) fires once without interfering with later gestures.
		dispatchPointer(circle, 'pointerdown', nodeCenter.x, nodeCenter.y, 1, 'touch');
		await sleep(LONG_PRESS_MS + 20);
		expect(wrapper.dataset.lastNodeLongPress?.startsWith(NODES[0].id)).toBe(true);
		dispatchPointer(circle, 'pointerup', nodeCenter.x, nodeCenter.y, 1, 'touch');

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

<Story
	name="RightClickOpensNodeContextMenuCallback"
	args={{ nodes: [NODES[0]] }}
	play={async ({ canvasElement }) => {
		const wrapper = canvasElement.querySelector('[data-testid="stage-callbacks"]') as HTMLElement;
		const stage = getStage(canvasElement);
		const circle = canvasElement.querySelector('.circle') as HTMLElement;

		await waitForLayout();

		const nodeCenter = getCenter(circle);
		const nodeEvent = dispatchContextMenu(stage, nodeCenter.x, nodeCenter.y);
		await sleep();
		expect(nodeEvent.defaultPrevented).toBe(true);
		const contextMenu = parsePointCallback(wrapper.dataset.lastNodeContextMenu ?? '');
		expect(contextMenu.nodeId).toBe(NODES[0].id);
		expect(contextMenu.x).toBeCloseTo(nodeCenter.x);
		expect(contextMenu.y).toBeCloseTo(nodeCenter.y);

		// Background right-click: native menu still suppressed, and no node
		// callback (the background has its own; see the story below).
		const priorValue = wrapper.dataset.lastNodeContextMenu;
		const backgroundEvent = dispatchContextMenu(
			stage,
			nodeCenter.x + NODE_RADIUS * 3,
			nodeCenter.y + NODE_RADIUS * 3
		);
		await sleep();
		expect(backgroundEvent.defaultPrevented).toBe(true);
		expect(wrapper.dataset.lastNodeContextMenu).toBe(priorValue);
	}}
/>

<Story
	name="MouseLongPressDoesNotFire"
	args={{ nodes: [NODES[0]] }}
	play={async ({ canvasElement }) => {
		const wrapper = canvasElement.querySelector('[data-testid="stage-callbacks"]') as HTMLElement;
		const circle = canvasElement.querySelector('.circle') as HTMLElement;

		await waitForLayout();

		const nodeCenter = getCenter(circle);
		dispatchPointer(circle, 'pointerdown', nodeCenter.x, nodeCenter.y, 1, 'mouse');
		await sleep(LONG_PRESS_MS + 20);
		expect(wrapper.dataset.lastNodeLongPress).toBe('');
		dispatchPointer(circle, 'pointerup', nodeCenter.x, nodeCenter.y, 1, 'mouse');
	}}
/>

<Story
	name="ArmedCreationHoverGesture"
	args={{ nodes: [NODES[0]] }}
	play={async ({ canvasElement }) => {
		const wrapper = canvasElement.querySelector('[data-testid="stage-callbacks"]') as HTMLElement;
		const stage = getStage(canvasElement);
		const circle = canvasElement.querySelector('.circle') as HTMLElement;

		await waitForLayout();

		const nodeCenter = getCenter(circle);
		const bgX = nodeCenter.x + NODE_RADIUS * 3;
		const bgY = nodeCenter.y;

		const armButton = canvasElement.querySelector(
			`[data-testid="arm-creation-${NODES[0].id}"]`
		) as HTMLElement;
		armButton.click();
		await sleep();

		// Hover moves (no button pressed) drive the creation gesture.
		dispatchPointer(stage, 'pointermove', bgX, bgY);
		await sleep();
		const update = (wrapper.dataset.lastCreationUpdate ?? '').split(',');
		const expectedPoint = getGraphPoint(stage, bgX, bgY);
		expect(update[0]).toBe(NODES[0].id);
		expect(Number(update[1])).toBeCloseTo(expectedPoint.x);
		expect(Number(update[2])).toBeCloseTo(expectedPoint.y);
		expect(update[3]).toBe('');

		// The next click completes the gesture on the background.
		dispatchPointer(stage, 'pointerdown', bgX, bgY);
		dispatchPointer(stage, 'pointerup', bgX, bgY);
		await sleep();
		const backgroundDrop = parsePointCallback(wrapper.dataset.lastDoubleClickDropBg ?? '');
		expect(backgroundDrop.nodeId).toBe(NODES[0].id);
		expect(backgroundDrop.x).toBeCloseTo(expectedPoint.x);
		expect(backgroundDrop.y).toBeCloseTo(expectedPoint.y);
		expect(wrapper.dataset.lastCreationCancel).toBe('');
		// The armed session swallowed the press: it was not also a background click.
		expect(wrapper.dataset.lastBackgroundClick).toBe('');
	}}
/>

<Story
	name="ArmedCreationReleaseOnNode"
	args={{
		nodes: [NODES[0], NODES[1]],
		positions: {
			[NODES[0].id]: { left: '5%', top: '50%' },
			[NODES[1].id]: { left: '95%', top: '50%' }
		}
	}}
	play={async ({ canvasElement }) => {
		const wrapper = canvasElement.querySelector('[data-testid="stage-callbacks"]') as HTMLElement;
		const stage = getStage(canvasElement);
		const circles = canvasElement.querySelectorAll('.circle');
		const targetCircle = circles[1] as HTMLElement;

		await waitForLayout();

		const targetCenter = getCenter(targetCircle);
		const armButton = canvasElement.querySelector(
			`[data-testid="arm-creation-${NODES[0].id}"]`
		) as HTMLElement;
		armButton.click();
		await sleep();

		dispatchPointer(stage, 'pointermove', targetCenter.x, targetCenter.y);
		await sleep();
		const update = (wrapper.dataset.lastCreationUpdate ?? '').split(',');
		expect(update[0]).toBe(NODES[0].id);
		expect(update[3]).toBe(NODES[1].id);

		dispatchPointer(stage, 'pointerdown', targetCenter.x, targetCenter.y);
		dispatchPointer(stage, 'pointerup', targetCenter.x, targetCenter.y);
		await sleep();
		expect(wrapper.dataset.lastDoubleClickDropNode).toBe(`${NODES[0].id},${NODES[1].id}`);
		expect(wrapper.dataset.lastCreationCancel).toBe('');
	}}
/>

<Story
	name="ArmedCreationReleaseOnSourceCancels"
	args={{ nodes: [NODES[0]] }}
	play={async ({ canvasElement }) => {
		const wrapper = canvasElement.querySelector('[data-testid="stage-callbacks"]') as HTMLElement;
		const stage = getStage(canvasElement);
		const circle = canvasElement.querySelector('.circle') as HTMLElement;

		await waitForLayout();

		const nodeCenter = getCenter(circle);
		const armButton = canvasElement.querySelector(
			`[data-testid="arm-creation-${NODES[0].id}"]`
		) as HTMLElement;
		armButton.click();
		await sleep();

		dispatchPointer(stage, 'pointermove', nodeCenter.x + NODE_RADIUS * 3, nodeCenter.y);
		dispatchPointer(stage, 'pointermove', nodeCenter.x, nodeCenter.y);
		dispatchPointer(stage, 'pointerdown', nodeCenter.x, nodeCenter.y);
		dispatchPointer(stage, 'pointerup', nodeCenter.x, nodeCenter.y);
		await sleep();
		expect(wrapper.dataset.lastCreationCancel).toBe(NODES[0].id);
		expect(wrapper.dataset.lastDoubleClickDropBg).toBe('');
		expect(wrapper.dataset.lastDoubleClickDropNode).toBe('');
	}}
/>

<Story
	name="ArmedCreationEscapeCancels"
	args={{ nodes: [NODES[0]] }}
	play={async ({ canvasElement }) => {
		const wrapper = canvasElement.querySelector('[data-testid="stage-callbacks"]') as HTMLElement;
		const stage = getStage(canvasElement);
		const circle = canvasElement.querySelector('.circle') as HTMLElement;

		await waitForLayout();

		const nodeCenter = getCenter(circle);
		const bgX = nodeCenter.x + NODE_RADIUS * 3;
		const armButton = canvasElement.querySelector(
			`[data-testid="arm-creation-${NODES[0].id}"]`
		) as HTMLElement;
		armButton.click();
		await sleep();

		dispatchPointer(stage, 'pointermove', bgX, nodeCenter.y);
		await sleep();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await sleep();
		expect(wrapper.dataset.lastCreationCancel).toBe(NODES[0].id);

		// The gesture is over: a later click no longer creates anything.
		dispatchPointer(stage, 'pointerdown', bgX, nodeCenter.y);
		dispatchPointer(stage, 'pointerup', bgX, nodeCenter.y);
		await sleep();
		expect(wrapper.dataset.lastDoubleClickDropBg).toBe('');
		expect(wrapper.dataset.lastDoubleClickDropNode).toBe('');
	}}
/>

<Story
	name="ArmedCreationIgnoresSecondaryButtonRelease"
	args={{ nodes: [NODES[0]] }}
	play={async ({ canvasElement }) => {
		const wrapper = canvasElement.querySelector('[data-testid="stage-callbacks"]') as HTMLElement;
		const stage = getStage(canvasElement);
		const circle = canvasElement.querySelector('.circle') as HTMLElement;

		await waitForLayout();

		const nodeCenter = getCenter(circle);
		const bgX = nodeCenter.x + NODE_RADIUS * 3;
		const bgY = nodeCenter.y;
		const armButton = canvasElement.querySelector(
			`[data-testid="arm-creation-${NODES[0].id}"]`
		) as HTMLElement;
		armButton.click();
		await sleep();

		dispatchPointer(stage, 'pointermove', bgX, bgY);
		await sleep();

		// A right-click release must neither create nor cancel; the session stays armed.
		dispatchPointer(stage, 'pointerdown', bgX, bgY, 1, 'mouse', SECONDARY_BUTTON);
		dispatchPointer(stage, 'pointerup', bgX, bgY, 1, 'mouse', SECONDARY_BUTTON);
		await sleep();
		expect(wrapper.dataset.lastDoubleClickDropBg).toBe('');
		expect(wrapper.dataset.lastDoubleClickDropNode).toBe('');
		expect(wrapper.dataset.lastCreationCancel).toBe('');

		dispatchPointer(stage, 'pointerdown', bgX, bgY);
		dispatchPointer(stage, 'pointerup', bgX, bgY);
		await sleep();
		expect(parsePointCallback(wrapper.dataset.lastDoubleClickDropBg ?? '').nodeId).toBe(
			NODES[0].id
		);
	}}
/>

<Story
	name="ArmedCreationCancelsOnPointerDownOutsideStage"
	args={{ nodes: [NODES[0]] }}
	play={async ({ canvasElement }) => {
		const wrapper = canvasElement.querySelector('[data-testid="stage-callbacks"]') as HTMLElement;
		const stage = getStage(canvasElement);
		const circle = canvasElement.querySelector('.circle') as HTMLElement;

		await waitForLayout();

		const nodeCenter = getCenter(circle);
		const bgX = nodeCenter.x + NODE_RADIUS * 3;
		const bgY = nodeCenter.y;
		const armButton = canvasElement.querySelector(
			`[data-testid="arm-creation-${NODES[0].id}"]`
		) as HTMLElement;
		armButton.click();
		await sleep();

		dispatchPointer(stage, 'pointermove', bgX, bgY);
		await sleep();

		// Pressing app chrome outside the stage disarms the session.
		const outside = getCenter(armButton);
		dispatchPointer(armButton, 'pointerdown', outside.x, outside.y);
		dispatchPointer(armButton, 'pointerup', outside.x, outside.y);
		await sleep();
		expect(wrapper.dataset.lastCreationCancel).toBe(NODES[0].id);

		dispatchPointer(stage, 'pointerdown', bgX, bgY);
		dispatchPointer(stage, 'pointerup', bgX, bgY);
		await sleep();
		expect(wrapper.dataset.lastDoubleClickDropBg).toBe('');
		expect(wrapper.dataset.lastDoubleClickDropNode).toBe('');

		// Re-arming after a cancel works.
		armButton.click();
		await sleep();
		dispatchPointer(stage, 'pointermove', bgX, bgY);
		dispatchPointer(stage, 'pointerdown', bgX, bgY);
		dispatchPointer(stage, 'pointerup', bgX, bgY);
		await sleep();
		const backgroundDrop = parsePointCallback(wrapper.dataset.lastDoubleClickDropBg ?? '');
		const expectedPoint = getGraphPoint(stage, bgX, bgY);
		expect(backgroundDrop.nodeId).toBe(NODES[0].id);
		expect(backgroundDrop.x).toBeCloseTo(expectedPoint.x);
		expect(backgroundDrop.y).toBeCloseTo(expectedPoint.y);
	}}
/>

<Story
	name="ArmedCreationPointerCancelCancels"
	args={{ nodes: [NODES[0]] }}
	play={async ({ canvasElement }) => {
		const wrapper = canvasElement.querySelector('[data-testid="stage-callbacks"]') as HTMLElement;
		const stage = getStage(canvasElement);
		const circle = canvasElement.querySelector('.circle') as HTMLElement;

		await waitForLayout();

		const nodeCenter = getCenter(circle);
		const bgX = nodeCenter.x + NODE_RADIUS * 3;
		const bgY = nodeCenter.y;
		const armButton = canvasElement.querySelector(
			`[data-testid="arm-creation-${NODES[0].id}"]`
		) as HTMLElement;
		armButton.click();
		await sleep();

		dispatchPointer(stage, 'pointermove', bgX, bgY);
		dispatchPointer(stage, 'pointerdown', bgX, bgY);
		dispatchPointer(stage, 'pointercancel', bgX, bgY);
		await sleep();
		expect(wrapper.dataset.lastCreationCancel).toBe(NODES[0].id);
		expect(wrapper.dataset.lastDoubleClickDropBg).toBe('');

		// The session is over: a later click no longer creates anything.
		dispatchPointer(stage, 'pointerdown', bgX, bgY);
		dispatchPointer(stage, 'pointerup', bgX, bgY);
		await sleep();
		expect(wrapper.dataset.lastDoubleClickDropBg).toBe('');
		expect(wrapper.dataset.lastDoubleClickDropNode).toBe('');
	}}
/>

<Story
	name="SecondaryButtonReleaseKeepsPanAlive"
	args={{ nodes: [] }}
	play={async ({ canvasElement }) => {
		const wrapper = canvasElement.querySelector('[data-testid="stage-callbacks"]') as HTMLElement;
		const stage = getStage(canvasElement);

		await waitForLayout();

		const center = getCenter(stage);

		// A mouse shares one pointerId across buttons: releasing the right button
		// mid-pan must not end the pan the left button is still holding.
		dispatchPointer(stage, 'pointerdown', center.x, center.y, 1, 'mouse');
		dispatchPointer(stage, 'pointermove', center.x + 20, center.y + 20, 1, 'mouse');
		dispatchPointer(stage, 'pointerup', center.x + 20, center.y + 20, 1, 'mouse', SECONDARY_BUTTON);
		await sleep();
		expect(wrapper.dataset.lastViewState).toBe('');

		dispatchPointer(stage, 'pointermove', center.x + 40, center.y + 40, 1, 'mouse');
		dispatchPointer(stage, 'pointerup', center.x + 40, center.y + 40, 1, 'mouse');
		await sleep();
		expect(getStageTransform(canvasElement)).toContain('translate(40px, 40px)');
		const viewState = parseViewStateCallback(wrapper.dataset.lastViewState ?? '');
		expect(viewState.panX).toBe(40);
		expect(viewState.panY).toBe(40);
	}}
/>

<Story
	name="DoubleClickDragEmitsCreationUpdates"
	args={{ nodes: [NODES[0]] }}
	play={async ({ canvasElement }) => {
		const wrapper = canvasElement.querySelector('[data-testid="stage-callbacks"]') as HTMLElement;
		const stage = getStage(canvasElement);
		const circle = canvasElement.querySelector('.circle') as HTMLElement;

		await waitForLayout();

		const nodeCenter = getCenter(circle);
		const bgX = nodeCenter.x + NODE_RADIUS * 3;
		const bgY = nodeCenter.y;

		dispatchPointer(circle, 'pointerdown', nodeCenter.x, nodeCenter.y);
		dispatchPointer(circle, 'pointerup', nodeCenter.x, nodeCenter.y);
		await sleep(50);
		dispatchPointer(circle, 'pointerdown', nodeCenter.x, nodeCenter.y);
		dispatchPointer(stage, 'pointermove', bgX, bgY);
		await sleep();

		const update = (wrapper.dataset.lastCreationUpdate ?? '').split(',');
		const expectedPoint = getGraphPoint(stage, bgX, bgY);
		expect(update[0]).toBe(NODES[0].id);
		expect(Number(update[1])).toBeCloseTo(expectedPoint.x);
		expect(Number(update[2])).toBeCloseTo(expectedPoint.y);
		expect(update[3]).toBe('');

		dispatchPointer(stage, 'pointerup', bgX, bgY);
		await sleep();
		const backgroundDrop = parsePointCallback(wrapper.dataset.lastDoubleClickDropBg ?? '');
		expect(backgroundDrop.nodeId).toBe(NODES[0].id);
	}}
/>

<Story
	name="TappingABadgeIsTappingTheNode"
	args={{
		nodes: [
			{
				id: 'badged',
				title: 'Change the filters',
				description: 'Carries both badges',
				tags: [],
				addons: { task: { done: false } },
				content: [{ type: 'file', assetId: 'a1', name: 'measurements.csv' }]
			}
		]
	}}
	play={async ({ canvasElement }) => {
		const wrapper = canvasElement.querySelector('[data-testid="stage-callbacks"]') as HTMLElement;
		const stage = getStage(canvasElement);
		await waitForLayout();

		const row = canvasElement.querySelector('[data-node-addon-badges]') as HTMLElement;
		expect(row).toBeInTheDocument();
		// Display only: the badges take no pointer events, so nothing about them
		// competes with the gestures the node itself owns.
		expect(window.getComputedStyle(row).pointerEvents).toBe('none');

		// The gesture lands at the badge's own centre, and the Stage reads it as
		// the node underneath — its hit test is geometric against the circle, and
		// the badge sits inside it.
		const badgeCentre = getCenter(row);
		await dispatchDoubleClick(stage, badgeCentre.x, badgeCentre.y);
		await sleep();

		expect(wrapper.dataset.lastMakePrimary).toBe('badged');
	}}
/>

<Story
	name="BackgroundDoubleClickDragReportsASelectionBox"
	args={{ nodes: [], initialPanX: 40, initialPanY: -20, initialScale: 1.5 }}
	play={async ({ canvasElement }) => {
		const wrapper = getCallbacks(canvasElement);
		const stage = getStage(canvasElement);

		await waitForLayout();

		const center = getCenter(stage);
		const transformBefore = getStageTransform(canvasElement);

		// Dragged up and to the left, so the corners arrive in the "wrong" order.
		await dispatchBackgroundDoubleClickDrag(
			stage,
			center.x,
			center.y,
			center.x - 60,
			center.y - 30
		);

		const firstUpdate = parseRectCallback(wrapper.dataset.lastSelectionBoxUpdate ?? '');
		expectRectCloseTo(firstUpdate, {
			left: center.x - 60,
			top: center.y - 30,
			width: 60,
			height: 30
		});
		// An update carries Shift as the move held it, the way the end does.
		expect(firstUpdate.flag).toBe('false');

		// Drawn by the stage in its own pixels, beside the panned and scaled
		// content layer, where the reported client rect is exactly where it sits.
		const box = getSelectionBox(stage);
		expect(box).not.toBeNull();
		if (!box) return;
		expect(box.parentElement).toBe(stage);
		expect(box.getAttribute('aria-hidden')).toBe('true');
		expect(window.getComputedStyle(box).pointerEvents).toBe('none');
		expectRectCloseTo(box.getBoundingClientRect(), {
			left: center.x - 60,
			top: center.y - 30,
			width: 60,
			height: 30
		});

		// Every move reports, and nothing pans under the box.
		dispatchPointer(stage, 'pointermove', center.x + 50, center.y + 40);
		await sleep();
		expectRectCloseTo(parseRectCallback(wrapper.dataset.lastSelectionBoxUpdate ?? ''), {
			left: center.x,
			top: center.y,
			width: 50,
			height: 40
		});
		expect(getStageTransform(canvasElement)).toBe(transformBefore);

		dispatchPointer(stage, 'pointerup', center.x + 50, center.y + 40);
		await sleep();
		const end = parseRectCallback(wrapper.dataset.lastSelectionBoxEnd ?? '');
		expectRectCloseTo(end, { left: center.x, top: center.y, width: 50, height: 40 });
		expect(end.flag).toBe('false');
		expect(getSelectionBox(stage)).toBeNull();
		expect(wrapper.dataset.lastSelectionBoxCancel).toBe('');
		expect(getStageTransform(canvasElement)).toBe(transformBefore);

		// Only the first press of the double was a click.
		const click = parseBackgroundPointCallback(wrapper.dataset.lastBackgroundClick ?? '');
		expect(click.x).toBeCloseTo(center.x);
		expect(click.y).toBeCloseTo(center.y);
	}}
/>

<Story
	name="SingleBackgroundDragStillPansAndReportsNoBox"
	args={{ nodes: [] }}
	play={async ({ canvasElement }) => {
		const wrapper = getCallbacks(canvasElement);
		const stage = getStage(canvasElement);

		await waitForLayout();

		const center = getCenter(stage);
		dispatchPointer(stage, 'pointerdown', center.x, center.y);
		dispatchPointer(stage, 'pointermove', center.x + 60, center.y + 40);
		await sleep();
		expect(getSelectionBox(stage)).toBeNull();
		dispatchPointer(stage, 'pointerup', center.x + 60, center.y + 40);
		await sleep();
		expect(getStageTransform(canvasElement)).toContain('translate(60px, 40px)');
		expect(wrapper.dataset.lastSelectionBoxUpdate).toBe('');
		expect(wrapper.dataset.lastSelectionBoxEnd).toBe('');
		// A drag is not a click.
		expect(wrapper.dataset.lastBackgroundClick).toBe('');

		// A pan that comes back to where it started is still not a click.
		dispatchPointer(stage, 'pointerdown', center.x, center.y);
		dispatchPointer(stage, 'pointermove', center.x + 40, center.y);
		dispatchPointer(stage, 'pointermove', center.x, center.y);
		dispatchPointer(stage, 'pointerup', center.x, center.y);
		await sleep();
		expect(wrapper.dataset.lastBackgroundClick).toBe('');

		// A click, then a second press after the double-click gap: a plain pan.
		dispatchPointer(stage, 'pointerdown', center.x, center.y);
		dispatchPointer(stage, 'pointerup', center.x, center.y);
		await sleep(DBL_CLICK_MS + 50);
		dispatchPointer(stage, 'pointerdown', center.x, center.y);
		dispatchPointer(stage, 'pointermove', center.x + 20, center.y + 10);
		dispatchPointer(stage, 'pointerup', center.x + 20, center.y + 10);
		await sleep();
		expect(getStageTransform(canvasElement)).toContain('translate(80px, 50px)');
		expect(wrapper.dataset.lastSelectionBoxUpdate).toBe('');
		const viewState = parseViewStateCallback(wrapper.dataset.lastViewState ?? '');
		expect(viewState.panX).toBe(80);
		expect(viewState.panY).toBe(50);
	}}
/>

<Story
	name="ShiftOnReleaseReportsAnAdditiveBox"
	args={{ nodes: [] }}
	play={async ({ canvasElement }) => {
		const wrapper = getCallbacks(canvasElement);
		const stage = getStage(canvasElement);

		await waitForLayout();

		const center = getCenter(stage);
		await dispatchBackgroundDoubleClickDrag(
			stage,
			center.x,
			center.y,
			center.x + 40,
			center.y + 20
		);
		dispatchPointer(stage, 'pointerup', center.x + 40, center.y + 20, 1, '', 0, {
			shiftKey: true
		});
		await sleep();
		const end = parseRectCallback(wrapper.dataset.lastSelectionBoxEnd ?? '');
		expectRectCloseTo(end, { left: center.x, top: center.y, width: 40, height: 20 });
		expect(end.flag).toBe('true');
	}}
/>

<Story
	name="EveryUpdateCarriesShiftAsHeldOnAMoveOrAShiftKeyAlone"
	args={{ nodes: [] }}
	play={async ({ canvasElement }) => {
		const wrapper = getCallbacks(canvasElement);
		const stage = getStage(canvasElement);
		const lastUpdate = () => parseRectCallback(wrapper.dataset.lastSelectionBoxUpdate ?? '');
		const pressShift = (type: 'keydown' | 'keyup', options: { repeat?: boolean } = {}) =>
			window.dispatchEvent(
				new KeyboardEvent(type, {
					key: 'Shift',
					shiftKey: type === 'keydown',
					repeat: options.repeat ?? false,
					bubbles: true
				})
			);

		await waitForLayout();

		const center = getCenter(stage);
		await dispatchBackgroundDoubleClickDrag(
			stage,
			center.x,
			center.y,
			center.x + 40,
			center.y + 20
		);
		expect(lastUpdate().flag).toBe('false');

		// Shift is read from each move, so it can come and go mid-drag.
		dispatchPointer(stage, 'pointermove', center.x + 50, center.y + 30, 1, '', 0, {
			shiftKey: true
		});
		await sleep();
		expectRectCloseTo(lastUpdate(), { left: center.x, top: center.y, width: 50, height: 30 });
		expect(lastUpdate().flag).toBe('true');
		dispatchPointer(stage, 'pointermove', center.x + 60, center.y + 30);
		await sleep();
		expectRectCloseTo(lastUpdate(), { left: center.x, top: center.y, width: 60, height: 30 });
		expect(lastUpdate().flag).toBe('false');

		// Shift alone, with the pointer still: the same box, reported again with
		// the new flag, so nothing has to wait for a move to see it.
		pressShift('keydown');
		await sleep();
		expectRectCloseTo(lastUpdate(), { left: center.x, top: center.y, width: 60, height: 30 });
		expect(lastUpdate().flag).toBe('true');
		pressShift('keyup');
		await sleep();
		expect(lastUpdate().flag).toBe('false');

		// A held key's repeats are not news.
		pressShift('keydown');
		await sleep();
		const beforeRepeat = wrapper.dataset.lastSelectionBoxUpdate;
		pressShift('keydown', { repeat: true });
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxUpdate).toBe(beforeRepeat);

		// Release decides with its own Shift, as before.
		dispatchPointer(stage, 'pointerup', center.x + 60, center.y + 30, 1, '', 0, {
			shiftKey: true
		});
		await sleep();
		expect(parseRectCallback(wrapper.dataset.lastSelectionBoxEnd ?? '').flag).toBe('true');

		// With the box closed, Shift reports nothing.
		const afterEnd = wrapper.dataset.lastSelectionBoxUpdate;
		pressShift('keyup');
		pressShift('keydown');
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxUpdate).toBe(afterEnd);
		pressShift('keyup');
	}}
/>

<Story
	name="SecondPointerCancelsTheBoxAndPinches"
	args={{ nodes: [] }}
	play={async ({ canvasElement }) => {
		const wrapper = getCallbacks(canvasElement);
		const stage = getStage(canvasElement);

		await waitForLayout();

		// Chromium refuses to capture a pointer id no device has down, and the
		// second finger here is synthetic. Capture is not what this story tests,
		// so a refused capture is swallowed rather than surfacing as an
		// unhandled error from inside the stage's handler.
		const capture = stage.setPointerCapture.bind(stage);
		stage.setPointerCapture = (pointerId: number) => {
			try {
				capture(pointerId);
			} catch {
				// Synthetic pointer: nothing to capture.
			}
		};

		const center = getCenter(stage);
		// Double-tap-drag on touch opens the box exactly as a mouse does.
		await dispatchBackgroundDoubleClickDrag(
			stage,
			center.x,
			center.y,
			center.x - 40,
			center.y,
			'touch'
		);
		expect(getSelectionBox(stage)).not.toBeNull();
		const updateBeforePinch = wrapper.dataset.lastSelectionBoxUpdate;

		dispatchPointer(stage, 'pointerdown', center.x + 40, center.y, 2, 'touch');
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxCancel).toBe('1');
		expect(getSelectionBox(stage)).toBeNull();

		// The second finger then pinches, as it always has: spreading doubles the
		// distance between the fingers.
		dispatchPointer(stage, 'pointermove', center.x + 120, center.y, 2, 'touch');
		await sleep();
		expect(parseViewStateCallback(wrapper.dataset.lastLiveViewState ?? '').scale).toBeGreaterThan(
			1
		);
		dispatchPointer(stage, 'pointerup', center.x + 120, center.y, 2, 'touch');

		// The first finger carrying on reopens nothing, and its release ends nothing.
		dispatchPointer(stage, 'pointermove', center.x - 80, center.y, 1, 'touch');
		dispatchPointer(stage, 'pointerup', center.x - 80, center.y, 1, 'touch');
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxUpdate).toBe(updateBeforePinch);
		expect(wrapper.dataset.lastSelectionBoxEnd).toBe('');
		expect(wrapper.dataset.lastSelectionBoxCancel).toBe('1');
		expect(parseViewStateCallback(wrapper.dataset.lastViewState ?? '').scale).toBeGreaterThan(1);

		Reflect.deleteProperty(stage, 'setPointerCapture');
	}}
/>

<Story
	name="EscapeCancelsTheBox"
	args={{ nodes: [] }}
	play={async ({ canvasElement }) => {
		const wrapper = getCallbacks(canvasElement);
		const stage = getStage(canvasElement);

		await waitForLayout();

		const center = getCenter(stage);
		const transformBefore = getStageTransform(canvasElement);
		await dispatchBackgroundDoubleClickDrag(
			stage,
			center.x,
			center.y,
			center.x + 40,
			center.y + 20
		);
		const clickBeforeEscape = wrapper.dataset.lastBackgroundClick;
		const updateBeforeEscape = wrapper.dataset.lastSelectionBoxUpdate;
		expect(getSelectionBox(stage)).not.toBeNull();

		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxCancel).toBe('1');
		expect(getSelectionBox(stage)).toBeNull();

		// The press is spent: moving on neither reopens the box nor pans, and the
		// release is neither a box end nor a click.
		dispatchPointer(stage, 'pointermove', center.x + 80, center.y + 40);
		await sleep();
		expect(getSelectionBox(stage)).toBeNull();
		expect(wrapper.dataset.lastSelectionBoxUpdate).toBe(updateBeforeEscape);
		dispatchPointer(stage, 'pointerup', center.x + 80, center.y + 40);
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxEnd).toBe('');
		expect(wrapper.dataset.lastBackgroundClick).toBe(clickBeforeEscape);
		expect(getStageTransform(canvasElement)).toBe(transformBefore);

		// Escape with no box open is not the stage's to take.
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxCancel).toBe('1');
	}}
/>

<Story
	name="BackgroundClickReportsThePointAndANodeClickDoesNot"
	args={{ nodes: [NODES[0]] }}
	play={async ({ canvasElement }) => {
		const wrapper = getCallbacks(canvasElement);
		const stage = getStage(canvasElement);
		const circle = canvasElement.querySelector('.circle') as HTMLElement;

		await waitForLayout();

		const nodeCenter = getCenter(circle);
		const bgX = nodeCenter.x + NODE_RADIUS * 3;
		const bgY = nodeCenter.y;

		dispatchPointer(stage, 'pointerdown', nodeCenter.x, nodeCenter.y);
		dispatchPointer(stage, 'pointerup', nodeCenter.x, nodeCenter.y);
		await sleep();
		expect(wrapper.dataset.lastBackgroundClick).toBe('');

		await sleep(DBL_CLICK_MS + 50);
		dispatchPointer(stage, 'pointerdown', bgX, bgY);
		dispatchPointer(stage, 'pointerup', bgX, bgY);
		await sleep();
		let click = parseBackgroundPointCallback(wrapper.dataset.lastBackgroundClick ?? '');
		expect(click.x).toBeCloseTo(bgX);
		expect(click.y).toBeCloseTo(bgY);
		expect(click.flag).toBe('false');

		await sleep(DBL_CLICK_MS + 50);
		dispatchPointer(stage, 'pointerdown', bgX + 20, bgY, 1, '', 0, { shiftKey: true });
		dispatchPointer(stage, 'pointerup', bgX + 20, bgY, 1, '', 0, { shiftKey: true });
		await sleep();
		click = parseBackgroundPointCallback(wrapper.dataset.lastBackgroundClick ?? '');
		expect(click.x).toBeCloseTo(bgX + 20);
		expect(click.flag).toBe('true');

		// A node press in between breaks a background double: the press that
		// follows the background click pans instead of opening a box.
		await sleep(DBL_CLICK_MS + 50);
		dispatchPointer(stage, 'pointerdown', bgX, bgY);
		dispatchPointer(stage, 'pointerup', bgX, bgY);
		dispatchPointer(stage, 'pointerdown', nodeCenter.x, nodeCenter.y);
		dispatchPointer(stage, 'pointerup', nodeCenter.x, nodeCenter.y);
		dispatchPointer(stage, 'pointerdown', bgX, bgY);
		dispatchPointer(stage, 'pointermove', bgX + 30, bgY + 10);
		dispatchPointer(stage, 'pointerup', bgX + 30, bgY + 10);
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxUpdate).toBe('');
		expect(getStageTransform(canvasElement)).toContain('translate(30px, 10px)');
	}}
/>

<Story
	name="BackgroundDoubleClickWithoutDragReportsNothingAndResets"
	args={{ nodes: [] }}
	play={async ({ canvasElement }) => {
		const wrapper = getCallbacks(canvasElement);
		const stage = getStage(canvasElement);

		await waitForLayout();

		const center = getCenter(stage);
		const clickAt = async (x: number) => {
			dispatchPointer(stage, 'pointerdown', x, center.y);
			dispatchPointer(stage, 'pointerup', x, center.y);
			await sleep(20);
		};
		const lastClickX = () =>
			parseBackgroundPointCallback(wrapper.dataset.lastBackgroundClick ?? '').x;

		await clickAt(center.x);
		expect(lastClickX()).toBeCloseTo(center.x);

		// Too far from the first click to pair with it: a click of its own.
		await clickAt(center.x + 50);
		expect(lastClickX()).toBeCloseTo(center.x + 50);

		// Close enough and soon enough: the double, which with no drag is nothing.
		await clickAt(center.x + 53);
		expect(lastClickX()).toBeCloseTo(center.x + 50);
		expect(wrapper.dataset.lastSelectionBoxUpdate).toBe('');
		expect(wrapper.dataset.lastSelectionBoxEnd).toBe('');

		// The double used the first click up, so a third click starts fresh...
		await clickAt(center.x + 56);
		expect(lastClickX()).toBeCloseTo(center.x + 56);

		// ...and is itself the first half of the next double.
		dispatchPointer(stage, 'pointerdown', center.x + 56, center.y);
		dispatchPointer(stage, 'pointermove', center.x + 96, center.y + 20);
		dispatchPointer(stage, 'pointerup', center.x + 96, center.y + 20);
		await sleep();
		expectRectCloseTo(parseRectCallback(wrapper.dataset.lastSelectionBoxEnd ?? ''), {
			left: center.x + 56,
			top: center.y,
			width: 40,
			height: 20
		});
	}}
/>

<Story
	name="TouchHoldOnTheBackgroundFiresTheLongPressAndNoClick"
	args={{ nodes: [] }}
	play={async ({ canvasElement }) => {
		const wrapper = getCallbacks(canvasElement);
		const stage = getStage(canvasElement);

		await waitForLayout();

		const center = getCenter(stage);
		dispatchPointer(stage, 'pointerdown', center.x, center.y, 1, 'touch');
		await sleep(LONG_PRESS_MS + 20);
		const hold = parseBackgroundPointCallback(wrapper.dataset.lastBackgroundLongPress ?? '');
		expect(hold.x).toBeCloseTo(center.x);
		expect(hold.y).toBeCloseTo(center.y);
		dispatchPointer(stage, 'pointerup', center.x, center.y, 1, 'touch');
		await sleep();
		expect(wrapper.dataset.lastBackgroundClick).toBe('');

		// A touch that wanders past the slop is a pan, not a hold.
		const holdBefore = wrapper.dataset.lastBackgroundLongPress;
		dispatchPointer(stage, 'pointerdown', center.x + 30, center.y, 1, 'touch');
		dispatchPointer(stage, 'pointermove', center.x + 60, center.y, 1, 'touch');
		await sleep(LONG_PRESS_MS + 20);
		expect(wrapper.dataset.lastBackgroundLongPress).toBe(holdBefore);
		dispatchPointer(stage, 'pointerup', center.x + 60, center.y, 1, 'touch');
	}}
/>

<Story
	name="MouseHoldOnTheBackgroundDoesNotFireTheLongPress"
	args={{ nodes: [] }}
	play={async ({ canvasElement }) => {
		const wrapper = getCallbacks(canvasElement);
		const stage = getStage(canvasElement);

		await waitForLayout();

		const center = getCenter(stage);
		dispatchPointer(stage, 'pointerdown', center.x, center.y, 1, 'mouse');
		await sleep(LONG_PRESS_MS + 20);
		expect(wrapper.dataset.lastBackgroundLongPress).toBe('');
		dispatchPointer(stage, 'pointerup', center.x, center.y, 1, 'mouse');
		await sleep();
		// With no hold for a mouse, a slow click is still a click.
		expect(wrapper.dataset.lastBackgroundClick).not.toBe('');
	}}
/>

<Story
	name="RightClickOnEmptyCanvasFiresTheBackgroundContextMenu"
	args={{ nodes: [NODES[0]] }}
	play={async ({ canvasElement }) => {
		const wrapper = getCallbacks(canvasElement);
		const stage = getStage(canvasElement);
		const circle = canvasElement.querySelector('.circle') as HTMLElement;

		await waitForLayout();

		const nodeCenter = getCenter(circle);
		const bgX = nodeCenter.x + NODE_RADIUS * 3;
		const bgY = nodeCenter.y;

		const backgroundEvent = dispatchContextMenu(stage, bgX, bgY);
		await sleep();
		expect(backgroundEvent.defaultPrevented).toBe(true);
		const menu = parseBackgroundPointCallback(wrapper.dataset.lastBackgroundContextMenu ?? '');
		expect(menu.x).toBeCloseTo(bgX);
		expect(menu.y).toBeCloseTo(bgY);
		expect(wrapper.dataset.lastNodeContextMenu).toBe('');

		// A right-click on the node is the node's.
		const menuBefore = wrapper.dataset.lastBackgroundContextMenu;
		dispatchContextMenu(stage, nodeCenter.x, nodeCenter.y);
		await sleep();
		expect(wrapper.dataset.lastNodeContextMenu?.startsWith(NODES[0].id)).toBe(true);
		expect(wrapper.dataset.lastBackgroundContextMenu).toBe(menuBefore);

		// The contextmenu a touch hold synthesizes is left to the hold.
		const touchEvent = new PointerEvent('contextmenu', {
			clientX: bgX + 10,
			clientY: bgY,
			pointerType: 'touch',
			bubbles: true,
			cancelable: true
		});
		stage.dispatchEvent(touchEvent);
		await sleep();
		expect(touchEvent.defaultPrevented).toBe(true);
		expect(wrapper.dataset.lastBackgroundContextMenu).toBe(menuBefore);

		// macOS ctrl+click: the button-0 press that precedes the contextmenu is
		// not also a click on release.
		dispatchPointer(stage, 'pointerdown', bgX + 20, bgY);
		dispatchContextMenu(stage, bgX + 20, bgY);
		dispatchPointer(stage, 'pointerup', bgX + 20, bgY);
		await sleep();
		expect(
			parseBackgroundPointCallback(wrapper.dataset.lastBackgroundContextMenu ?? '').x
		).toBeCloseTo(bgX + 20);
		expect(wrapper.dataset.lastBackgroundClick).toBe('');

		// A right-click while a box is open abandons the box.
		await sleep(DBL_CLICK_MS + 50);
		await dispatchBackgroundDoubleClickDrag(stage, bgX, bgY, bgX + 40, bgY + 20);
		expect(getSelectionBox(stage)).not.toBeNull();
		dispatchContextMenu(stage, bgX + 40, bgY + 20);
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxCancel).toBe('1');
		expect(getSelectionBox(stage)).toBeNull();
		dispatchPointer(stage, 'pointerup', bgX + 40, bgY + 20);
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxEnd).toBe('');
	}}
/>
