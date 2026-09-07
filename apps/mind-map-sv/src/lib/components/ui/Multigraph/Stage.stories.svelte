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
		button = 0
	) {
		target.dispatchEvent(
			new PointerEvent(type, {
				clientX,
				clientY,
				pointerId,
				pointerType,
				button,
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

		// Background right-click: native menu still suppressed, but no callback.
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
