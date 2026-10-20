<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, within } from 'storybook/test';
	import StageHarness from './StageHarness.svelte';
	import type { NodeData } from '../types/node';
	import type { Point } from '../types/multigraph';
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

	/** Press the harness's "Arm cut" control: a cut anchored at the stage's centre. */
	function armEdgeCut(el: HTMLElement): void {
		const button = el.querySelector('[data-testid="arm-edge-cut"]');
		if (!(button instanceof HTMLElement)) throw new Error('Arm cut control not found');
		button.click();
	}

	/**
	 * Press the harness's "Arm select" control — or with `additive` its "Arm
	 * select more" — a box anchored at the stage's centre.
	 */
	function armSelectionBox(el: HTMLElement, additive = false): void {
		const testId = additive ? 'arm-selection-box-additive' : 'arm-selection-box';
		const button = el.querySelector(`[data-testid="${testId}"]`);
		if (!(button instanceof HTMLElement)) throw new Error('Arm select control not found');
		button.click();
	}

	function getEdgeCutLine(stage: HTMLElement): SVGSVGElement | null {
		const line = stage.querySelector('.edge-cut-line');
		return line instanceof SVGSVGElement ? line : null;
	}

	/** The drawn line's two ends, in the stage-local pixels its attributes carry. */
	function drawnEdgeCutEnds(svg: SVGSVGElement): { from: Point; to: Point } {
		const line = svg.querySelector('line');
		if (!line) throw new Error('Edge cut line has no <line>');
		const read = (name: string) => Number(line.getAttribute(name));
		return { from: { x: read('x1'), y: read('y1') }, to: { x: read('x2'), y: read('y2') } };
	}

	/** `ax,ay,bx,by` as the harness writes a cut callback. */
	function parseSegmentCallback(value: string): { a: Point; b: Point } {
		const [ax, ay, bx, by] = value.split(',').map(Number);
		return { a: { x: ax, y: ay }, b: { x: bx, y: by } };
	}

	function expectPointCloseTo(actual: Point, expected: Point) {
		expect(actual.x).toBeCloseTo(expected.x);
		expect(actual.y).toBeCloseTo(expected.y);
	}

	function expectSegmentCallback(value: string | undefined, a: Point, b: Point) {
		const segment = parseSegmentCallback(value ?? '');
		expectPointCloseTo(segment.a, a);
		expectPointCloseTo(segment.b, b);
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

<Story
	name="ArmedEdgeCutDrawsTheLineFromTheAnchorAndHoverUpdatesIt"
	args={{ nodes: [] }}
	play={async ({ canvasElement }) => {
		const wrapper = getCallbacks(canvasElement);
		const stage = getStage(canvasElement);

		await waitForLayout();

		const anchor = getCenter(stage);
		const stageBounds = stage.getBoundingClientRect();
		const local = (point: Point): Point => ({
			x: point.x - stageBounds.left,
			y: point.y - stageBounds.top
		});
		const transformBefore = getStageTransform(canvasElement);
		expect(getEdgeCutLine(stage)).toBeNull();

		armEdgeCut(canvasElement);
		await sleep();

		// Armed, the line is a point at the anchor, and the stage says so at once:
		// until the pointer comes back over the canvas that is all there is.
		expectSegmentCallback(wrapper.dataset.lastEdgeCutUpdate, anchor, anchor);
		const line = getEdgeCutLine(stage);
		expect(line).not.toBeNull();
		if (!line) return;
		let drawn = drawnEdgeCutEnds(line);
		expectPointCloseTo(drawn.from, local(anchor));
		expectPointCloseTo(drawn.to, local(anchor));

		// Drawn by the stage in its own pixels, beside the panned and scaled
		// content layer, and out of the way of every press and of assistive tech.
		expect(line.parentElement).toBe(stage);
		expect(getStageContent(canvasElement).parentElement).toBe(stage);
		expect(line.getAttribute('aria-hidden')).toBe('true');
		expect(window.getComputedStyle(line).pointerEvents).toBe('none');
		// Dashed as well as red, so colour is not the only thing that says "cut".
		const stroke = line.querySelector('line');
		expect(stroke).not.toBeNull();
		if (!stroke) return;
		expect(window.getComputedStyle(stroke).strokeDasharray).not.toBe('none');
		expect(window.getComputedStyle(stage).cursor).toBe('crosshair');

		// Hover with no button moves the free end, and every move reports.
		dispatchPointer(stage, 'pointermove', anchor.x + 60, anchor.y - 40);
		await sleep();
		const hover = { x: anchor.x + 60, y: anchor.y - 40 };
		expectSegmentCallback(wrapper.dataset.lastEdgeCutUpdate, anchor, hover);
		drawn = drawnEdgeCutEnds(line);
		expectPointCloseTo(drawn.from, local(anchor));
		expectPointCloseTo(drawn.to, local(hover));

		dispatchPointer(stage, 'pointermove', anchor.x - 90, anchor.y + 70);
		await sleep();
		expectSegmentCallback(wrapper.dataset.lastEdgeCutUpdate, anchor, {
			x: anchor.x - 90,
			y: anchor.y + 70
		});

		// Nothing pans under the line, and nothing ends or cancels it yet.
		expect(getStageTransform(canvasElement)).toBe(transformBefore);
		expect(wrapper.dataset.lastEdgeCutEnd).toBe('');
		expect(wrapper.dataset.lastEdgeCutCancel).toBe('');
	}}
/>

<Story
	name="ArmedEdgeCutClickEndsItWithBothPoints"
	args={{ nodes: [] }}
	play={async ({ canvasElement }) => {
		const wrapper = getCallbacks(canvasElement);
		const stage = getStage(canvasElement);

		await waitForLayout();

		const anchor = getCenter(stage);
		const transformBefore = getStageTransform(canvasElement);
		armEdgeCut(canvasElement);
		await sleep();
		dispatchPointer(stage, 'pointermove', anchor.x + 80, anchor.y, 1, 'mouse');
		await sleep();

		// A right-click release neither ends nor cancels it.
		dispatchPointer(stage, 'pointerdown', anchor.x + 80, anchor.y, 1, 'mouse', SECONDARY_BUTTON);
		dispatchPointer(stage, 'pointerup', anchor.x + 80, anchor.y, 1, 'mouse', SECONDARY_BUTTON);
		await sleep();
		expect(wrapper.dataset.lastEdgeCutEnd).toBe('');
		expect(wrapper.dataset.lastEdgeCutCancel).toBe('');
		expect(getEdgeCutLine(stage)).not.toBeNull();

		// The click: its press carries the free end to where it landed, and its
		// release ends the cut with both points.
		const end = { x: anchor.x + 84, y: anchor.y + 3 };
		dispatchPointer(stage, 'pointerdown', end.x, end.y, 1, 'mouse');
		await sleep();
		expectSegmentCallback(wrapper.dataset.lastEdgeCutUpdate, anchor, end);
		expect(wrapper.dataset.lastEdgeCutEnd).toBe('');
		dispatchPointer(stage, 'pointerup', end.x, end.y, 1, 'mouse');
		await sleep();
		expectSegmentCallback(wrapper.dataset.lastEdgeCutEnd, anchor, end);
		expect(wrapper.dataset.lastEdgeCutCancel).toBe('');
		expect(getEdgeCutLine(stage)).toBeNull();
		expect(window.getComputedStyle(stage).cursor).not.toBe('crosshair');

		// The armed cut swallowed the press: it was neither a click nor a pan.
		expect(wrapper.dataset.lastBackgroundClick).toBe('');
		expect(getStageTransform(canvasElement)).toBe(transformBefore);

		// The cut is over: the next click is a plain background click, and moving
		// reports nothing.
		const updateAfterEnd = wrapper.dataset.lastEdgeCutUpdate;
		dispatchPointer(stage, 'pointermove', anchor.x - 40, anchor.y, 1, 'mouse');
		dispatchPointer(stage, 'pointerdown', anchor.x - 40, anchor.y, 1, 'mouse');
		dispatchPointer(stage, 'pointerup', anchor.x - 40, anchor.y, 1, 'mouse');
		await sleep();
		expect(wrapper.dataset.lastEdgeCutUpdate).toBe(updateAfterEnd);
		expect(parseBackgroundPointCallback(wrapper.dataset.lastBackgroundClick ?? '').x).toBeCloseTo(
			anchor.x - 40
		);
		expectSegmentCallback(wrapper.dataset.lastEdgeCutEnd, anchor, end);
	}}
/>

<Story
	name="ArmedEdgeCutEscapeCancels"
	args={{ nodes: [] }}
	play={async ({ canvasElement }) => {
		const wrapper = getCallbacks(canvasElement);
		const stage = getStage(canvasElement);

		await waitForLayout();

		const anchor = getCenter(stage);
		armEdgeCut(canvasElement);
		await sleep();
		dispatchPointer(stage, 'pointermove', anchor.x + 50, anchor.y + 30);
		await sleep();

		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await sleep();
		expect(wrapper.dataset.lastEdgeCutCancel).toBe('1');
		expect(getEdgeCutLine(stage)).toBeNull();

		// The cut is over: a later click is a click, not a cut.
		dispatchPointer(stage, 'pointerdown', anchor.x + 50, anchor.y + 30);
		dispatchPointer(stage, 'pointerup', anchor.x + 50, anchor.y + 30);
		await sleep();
		expect(wrapper.dataset.lastEdgeCutEnd).toBe('');
		expect(wrapper.dataset.lastBackgroundClick).not.toBe('');

		// Escape with no cut armed is not the cut's to take.
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await sleep();
		expect(wrapper.dataset.lastEdgeCutCancel).toBe('1');
	}}
/>

<Story
	name="ArmedEdgeCutSecondPointerCancelsAndPinches"
	args={{ nodes: [] }}
	play={async ({ canvasElement }) => {
		const wrapper = getCallbacks(canvasElement);
		const stage = getStage(canvasElement);

		await waitForLayout();

		// As in SecondPointerCancelsTheBoxAndPinches: Chromium will not capture a
		// synthetic second finger, and capture is not what this story tests.
		const capture = stage.setPointerCapture.bind(stage);
		stage.setPointerCapture = (pointerId: number) => {
			try {
				capture(pointerId);
			} catch {
				// Synthetic pointer: nothing to capture.
			}
		};

		const anchor = getCenter(stage);
		armEdgeCut(canvasElement);
		await sleep();
		dispatchPointer(stage, 'pointerdown', anchor.x - 40, anchor.y, 1, 'touch');
		dispatchPointer(stage, 'pointermove', anchor.x - 60, anchor.y, 1, 'touch');
		await sleep();
		const updateBeforePinch = wrapper.dataset.lastEdgeCutUpdate;
		expectSegmentCallback(updateBeforePinch, anchor, { x: anchor.x - 60, y: anchor.y });

		dispatchPointer(stage, 'pointerdown', anchor.x + 40, anchor.y, 2, 'touch');
		await sleep();
		expect(wrapper.dataset.lastEdgeCutCancel).toBe('1');
		expect(getEdgeCutLine(stage)).toBeNull();

		// The second finger then pinches, as it always has.
		dispatchPointer(stage, 'pointermove', anchor.x + 140, anchor.y, 2, 'touch');
		await sleep();
		expect(parseViewStateCallback(wrapper.dataset.lastLiveViewState ?? '').scale).toBeGreaterThan(
			1
		);
		dispatchPointer(stage, 'pointerup', anchor.x + 140, anchor.y, 2, 'touch');

		// The first finger carrying on and lifting neither reopens nor ends a cut.
		dispatchPointer(stage, 'pointermove', anchor.x - 80, anchor.y, 1, 'touch');
		dispatchPointer(stage, 'pointerup', anchor.x - 80, anchor.y, 1, 'touch');
		await sleep();
		expect(wrapper.dataset.lastEdgeCutUpdate).toBe(updateBeforePinch);
		expect(wrapper.dataset.lastEdgeCutEnd).toBe('');
		expect(wrapper.dataset.lastEdgeCutCancel).toBe('1');

		Reflect.deleteProperty(stage, 'setPointerCapture');
	}}
/>

<Story
	name="ArmedEdgeCutCancelsOnPointerDownOutsideStage"
	args={{ nodes: [] }}
	play={async ({ canvasElement }) => {
		const wrapper = getCallbacks(canvasElement);
		const stage = getStage(canvasElement);
		const armButton = canvasElement.querySelector('[data-testid="arm-edge-cut"]');
		if (!(armButton instanceof HTMLElement)) throw new Error('Arm cut control not found');

		await waitForLayout();

		const anchor = getCenter(stage);
		const target = { x: anchor.x + 70, y: anchor.y - 20 };
		armEdgeCut(canvasElement);
		await sleep();
		dispatchPointer(stage, 'pointermove', target.x, target.y);
		await sleep();

		// Pressing app chrome outside the stage disarms the cut.
		const outside = getCenter(armButton);
		dispatchPointer(armButton, 'pointerdown', outside.x, outside.y);
		dispatchPointer(armButton, 'pointerup', outside.x, outside.y);
		await sleep();
		expect(wrapper.dataset.lastEdgeCutCancel).toBe('1');
		expect(getEdgeCutLine(stage)).toBeNull();

		dispatchPointer(stage, 'pointerdown', target.x, target.y);
		dispatchPointer(stage, 'pointerup', target.x, target.y);
		await sleep();
		expect(wrapper.dataset.lastEdgeCutEnd).toBe('');

		// Re-arming after a cancel works.
		armEdgeCut(canvasElement);
		await sleep();
		dispatchPointer(stage, 'pointermove', target.x, target.y);
		dispatchPointer(stage, 'pointerdown', target.x, target.y);
		dispatchPointer(stage, 'pointerup', target.x, target.y);
		await sleep();
		expectSegmentCallback(wrapper.dataset.lastEdgeCutEnd, anchor, target);
		expect(wrapper.dataset.lastEdgeCutCancel).toBe('1');
	}}
/>

<Story
	name="ArmedEdgeCutTouchDragEndsOnRelease"
	args={{ nodes: [] }}
	play={async ({ canvasElement }) => {
		const wrapper = getCallbacks(canvasElement);
		const stage = getStage(canvasElement);

		await waitForLayout();

		const anchor = getCenter(stage);
		const transformBefore = getStageTransform(canvasElement);
		armEdgeCut(canvasElement);
		await sleep();

		// No hover on a phone: the finger lands, and the free end goes there.
		const landing = { x: anchor.x - 100, y: anchor.y + 60 };
		dispatchPointer(stage, 'pointerdown', landing.x, landing.y, 1, 'touch');
		await sleep();
		expectSegmentCallback(wrapper.dataset.lastEdgeCutUpdate, anchor, landing);

		// A finger resting mid-cut is not a hold: the press was the cut's.
		await sleep(LONG_PRESS_MS + 20);
		expect(wrapper.dataset.lastBackgroundLongPress).toBe('');

		const lift = { x: anchor.x + 90, y: anchor.y - 50 };
		dispatchPointer(stage, 'pointermove', anchor.x, anchor.y, 1, 'touch');
		dispatchPointer(stage, 'pointermove', lift.x, lift.y, 1, 'touch');
		await sleep();
		expectSegmentCallback(wrapper.dataset.lastEdgeCutUpdate, anchor, lift);
		expect(wrapper.dataset.lastEdgeCutEnd).toBe('');

		dispatchPointer(stage, 'pointerup', lift.x, lift.y, 1, 'touch');
		await sleep();
		expectSegmentCallback(wrapper.dataset.lastEdgeCutEnd, anchor, lift);
		expect(wrapper.dataset.lastEdgeCutCancel).toBe('');
		expect(getEdgeCutLine(stage)).toBeNull();
		// The drag was the cut's, not a pan, and its release not a click.
		expect(getStageTransform(canvasElement)).toBe(transformBefore);
		expect(wrapper.dataset.lastBackgroundClick).toBe('');
	}}
/>

<Story
	name="ArmingEdgeCutCancelsAnArmedCreationSessionAndViceVersa"
	args={{ nodes: [NODES[0]] }}
	play={async ({ canvasElement }) => {
		const wrapper = getCallbacks(canvasElement);
		const stage = getStage(canvasElement);
		const circle = canvasElement.querySelector('.circle') as HTMLElement;
		const armCreation = canvasElement.querySelector(
			`[data-testid="arm-creation-${NODES[0].id}"]`
		) as HTMLElement;

		await waitForLayout();

		const anchor = getCenter(stage);
		const nodeCenter = getCenter(circle);
		const bgPoint = { x: nodeCenter.x + NODE_RADIUS * 3, y: nodeCenter.y };

		// A creation drag armed from the node menu, then a cut armed over it.
		armCreation.click();
		await sleep();
		dispatchPointer(stage, 'pointermove', bgPoint.x, bgPoint.y);
		await sleep();
		expect(wrapper.dataset.lastCreationUpdate?.startsWith(NODES[0].id)).toBe(true);
		armEdgeCut(canvasElement);
		await sleep();
		expect(wrapper.dataset.lastCreationCancel).toBe(NODES[0].id);
		expect(getEdgeCutLine(stage)).not.toBeNull();

		// The click that follows is the cut's: it ends the cut, and creates nothing.
		const creationUpdateBefore = wrapper.dataset.lastCreationUpdate;
		dispatchPointer(stage, 'pointermove', bgPoint.x, bgPoint.y);
		dispatchPointer(stage, 'pointerdown', bgPoint.x, bgPoint.y);
		dispatchPointer(stage, 'pointerup', bgPoint.x, bgPoint.y);
		await sleep();
		expectSegmentCallback(wrapper.dataset.lastEdgeCutEnd, anchor, bgPoint);
		expect(wrapper.dataset.lastCreationUpdate).toBe(creationUpdateBefore);
		expect(wrapper.dataset.lastDoubleClickDropBg).toBe('');
		expect(wrapper.dataset.lastDoubleClickDropNode).toBe('');

		// A second cut armed over a first replaces it.
		armEdgeCut(canvasElement);
		await sleep();
		armEdgeCut(canvasElement);
		await sleep();
		expect(wrapper.dataset.lastEdgeCutCancel).toBe('1');
		expect(getEdgeCutLine(stage)).not.toBeNull();
		expectSegmentCallback(wrapper.dataset.lastEdgeCutUpdate, anchor, anchor);

		// And a creation drag armed over a cut cancels the cut, and takes the click.
		const endBefore = wrapper.dataset.lastEdgeCutEnd;
		armCreation.click();
		await sleep();
		expect(wrapper.dataset.lastEdgeCutCancel).toBe('2');
		expect(getEdgeCutLine(stage)).toBeNull();
		dispatchPointer(stage, 'pointermove', bgPoint.x, bgPoint.y);
		dispatchPointer(stage, 'pointerdown', bgPoint.x, bgPoint.y);
		dispatchPointer(stage, 'pointerup', bgPoint.x, bgPoint.y);
		await sleep();
		expect(parsePointCallback(wrapper.dataset.lastDoubleClickDropBg ?? '').nodeId).toBe(
			NODES[0].id
		);
		expect(wrapper.dataset.lastEdgeCutEnd).toBe(endBefore);
	}}
/>

<Story
	name="ArmedEdgeCutIsAbandonedByPointerCancelARightClickOrACancelRequest"
	args={{ nodes: [] }}
	play={async ({ canvasElement }) => {
		const wrapper = getCallbacks(canvasElement);
		const stage = getStage(canvasElement);
		const cancelButton = canvasElement.querySelector('[data-testid="cancel-edge-cut"]');
		if (!(cancelButton instanceof HTMLElement)) throw new Error('Cancel cut control not found');

		await waitForLayout();

		const anchor = getCenter(stage);
		const point = { x: anchor.x + 60, y: anchor.y + 20 };

		// The browser taking the pointer back.
		armEdgeCut(canvasElement);
		await sleep();
		dispatchPointer(stage, 'pointerdown', point.x, point.y, 1, 'touch');
		dispatchPointer(stage, 'pointercancel', point.x, point.y, 1, 'touch');
		await sleep();
		expect(wrapper.dataset.lastEdgeCutCancel).toBe('1');
		expect(getEdgeCutLine(stage)).toBeNull();

		// macOS ctrl+click: a button-0 press, the contextmenu, then the release.
		// The menu opens, and the release is not taken as the cut.
		armEdgeCut(canvasElement);
		await sleep();
		dispatchPointer(stage, 'pointerdown', point.x, point.y);
		dispatchContextMenu(stage, point.x, point.y);
		dispatchPointer(stage, 'pointerup', point.x, point.y);
		await sleep();
		expect(wrapper.dataset.lastEdgeCutCancel).toBe('2');
		expect(
			parseBackgroundPointCallback(wrapper.dataset.lastBackgroundContextMenu ?? '').x
		).toBeCloseTo(point.x);

		// The consumer's own cancel, with no press at all.
		armEdgeCut(canvasElement);
		await sleep();
		cancelButton.click();
		await sleep();
		expect(wrapper.dataset.lastEdgeCutCancel).toBe('3');
		expect(getEdgeCutLine(stage)).toBeNull();

		// A cancel with nothing armed reports nothing, and nothing ever ended.
		cancelButton.click();
		await sleep();
		expect(wrapper.dataset.lastEdgeCutCancel).toBe('3');
		expect(wrapper.dataset.lastEdgeCutEnd).toBe('');
	}}
/>

<Story
	name="ArmedSelectionBoxDrawsTheBoxFromTheAnchorAndHoverUpdatesIt"
	args={{ nodes: [] }}
	play={async ({ canvasElement }) => {
		const wrapper = getCallbacks(canvasElement);
		const stage = getStage(canvasElement);
		const cancelButton = canvasElement.querySelector('[data-testid="cancel-selection-box"]');
		if (!(cancelButton instanceof HTMLElement)) throw new Error('Cancel select control not found');
		const lastUpdate = () => parseRectCallback(wrapper.dataset.lastSelectionBoxUpdate ?? '');

		await waitForLayout();

		const anchor = getCenter(stage);
		const transformBefore = getStageTransform(canvasElement);
		expect(getSelectionBox(stage)).toBeNull();

		armSelectionBox(canvasElement);
		await sleep();

		// Armed, the box is a point at the anchor, and the stage says so at once,
		// as it does for a cut: until the pointer comes back over the canvas that
		// is all there is. `additive` is the request's.
		expectRectCloseTo(lastUpdate(), { left: anchor.x, top: anchor.y, width: 0, height: 0 });
		expect(lastUpdate().flag).toBe('false');
		const box = getSelectionBox(stage);
		expect(box).not.toBeNull();
		if (!box) return;
		// The dragged box's own element, drawn the same way.
		expect(box.parentElement).toBe(stage);
		expect(box.getAttribute('aria-hidden')).toBe('true');
		expect(window.getComputedStyle(box).pointerEvents).toBe('none');
		expect(window.getComputedStyle(stage).cursor).toBe('crosshair');

		// Hover with no button grows it from the anchor, whichever way it goes,
		// and every move reports.
		dispatchPointer(stage, 'pointermove', anchor.x - 60, anchor.y - 30);
		await sleep();
		const upLeft = { left: anchor.x - 60, top: anchor.y - 30, width: 60, height: 30 };
		expectRectCloseTo(lastUpdate(), upLeft);
		expect(lastUpdate().flag).toBe('false');
		expectRectCloseTo(box.getBoundingClientRect(), upLeft);

		dispatchPointer(stage, 'pointermove', anchor.x + 50, anchor.y + 40);
		await sleep();
		const downRight = { left: anchor.x, top: anchor.y, width: 50, height: 40 };
		expectRectCloseTo(lastUpdate(), downRight);
		expectRectCloseTo(box.getBoundingClientRect(), downRight);

		// Nothing pans under the box, and nothing ends or cancels it yet.
		expect(getStageTransform(canvasElement)).toBe(transformBefore);
		expect(wrapper.dataset.lastSelectionBoxEnd).toBe('');
		expect(wrapper.dataset.lastSelectionBoxCancel).toBe('');

		// "Select more": the same box, reporting `additive` from its first update.
		cancelButton.click();
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxCancel).toBe('1');
		armSelectionBox(canvasElement, true);
		await sleep();
		expectRectCloseTo(lastUpdate(), { left: anchor.x, top: anchor.y, width: 0, height: 0 });
		expect(lastUpdate().flag).toBe('true');
		dispatchPointer(stage, 'pointermove', anchor.x + 30, anchor.y - 20);
		await sleep();
		expectRectCloseTo(lastUpdate(), { left: anchor.x, top: anchor.y - 20, width: 30, height: 20 });
		expect(lastUpdate().flag).toBe('true');
	}}
/>

<Story
	name="ArmedSelectionBoxClickEndsItWithTheFinalRect"
	args={{ nodes: [] }}
	play={async ({ canvasElement }) => {
		const wrapper = getCallbacks(canvasElement);
		const stage = getStage(canvasElement);

		await waitForLayout();

		const anchor = getCenter(stage);
		const transformBefore = getStageTransform(canvasElement);
		armSelectionBox(canvasElement);
		await sleep();
		dispatchPointer(stage, 'pointermove', anchor.x + 80, anchor.y + 20, 1, 'mouse');
		await sleep();

		// A right-click release neither ends nor cancels it.
		dispatchPointer(
			stage,
			'pointerdown',
			anchor.x + 80,
			anchor.y + 20,
			1,
			'mouse',
			SECONDARY_BUTTON
		);
		dispatchPointer(stage, 'pointerup', anchor.x + 80, anchor.y + 20, 1, 'mouse', SECONDARY_BUTTON);
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxEnd).toBe('');
		expect(wrapper.dataset.lastSelectionBoxCancel).toBe('');
		expect(getSelectionBox(stage)).not.toBeNull();

		// The click: its press carries the far corner to where it landed, and its
		// release ends the box with the final rect.
		const end = { x: anchor.x + 84, y: anchor.y + 23 };
		dispatchPointer(stage, 'pointerdown', end.x, end.y, 1, 'mouse');
		await sleep();
		const finalRect = { left: anchor.x, top: anchor.y, width: 84, height: 23 };
		expectRectCloseTo(parseRectCallback(wrapper.dataset.lastSelectionBoxUpdate ?? ''), finalRect);
		expect(wrapper.dataset.lastSelectionBoxEnd).toBe('');
		dispatchPointer(stage, 'pointerup', end.x, end.y, 1, 'mouse');
		await sleep();
		const ended = parseRectCallback(wrapper.dataset.lastSelectionBoxEnd ?? '');
		expectRectCloseTo(ended, finalRect);
		expect(ended.flag).toBe('false');
		expect(wrapper.dataset.lastSelectionBoxCancel).toBe('');
		expect(getSelectionBox(stage)).toBeNull();
		expect(window.getComputedStyle(stage).cursor).not.toBe('crosshair');

		// The armed box swallowed the press: it was neither a click nor a pan.
		expect(wrapper.dataset.lastBackgroundClick).toBe('');
		expect(getStageTransform(canvasElement)).toBe(transformBefore);

		// The box is over: moving reports nothing, and the next click is a plain
		// background click.
		const updateAfterEnd = wrapper.dataset.lastSelectionBoxUpdate;
		dispatchPointer(stage, 'pointermove', anchor.x - 40, anchor.y, 1, 'mouse');
		dispatchPointer(stage, 'pointerdown', anchor.x - 40, anchor.y, 1, 'mouse');
		dispatchPointer(stage, 'pointerup', anchor.x - 40, anchor.y, 1, 'mouse');
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxUpdate).toBe(updateAfterEnd);
		expect(parseBackgroundPointCallback(wrapper.dataset.lastBackgroundClick ?? '').x).toBeCloseTo(
			anchor.x - 40
		);
		expectRectCloseTo(parseRectCallback(wrapper.dataset.lastSelectionBoxEnd ?? ''), finalRect);

		// "Select more" ends the same way, reporting `additive`.
		armSelectionBox(canvasElement, true);
		await sleep();
		dispatchPointer(stage, 'pointerdown', anchor.x - 30, anchor.y - 10, 1, 'mouse');
		dispatchPointer(stage, 'pointerup', anchor.x - 30, anchor.y - 10, 1, 'mouse');
		await sleep();
		const added = parseRectCallback(wrapper.dataset.lastSelectionBoxEnd ?? '');
		expectRectCloseTo(added, { left: anchor.x - 30, top: anchor.y - 10, width: 30, height: 10 });
		expect(added.flag).toBe('true');
	}}
/>

<Story
	name="ArmedSelectionBoxTouchDragEndsOnRelease"
	args={{ nodes: [] }}
	play={async ({ canvasElement }) => {
		const wrapper = getCallbacks(canvasElement);
		const stage = getStage(canvasElement);

		await waitForLayout();

		const anchor = getCenter(stage);
		const transformBefore = getStageTransform(canvasElement);
		armSelectionBox(canvasElement);
		await sleep();

		// No hover on a phone: the finger lands, and the far corner goes there.
		dispatchPointer(stage, 'pointerdown', anchor.x - 100, anchor.y + 60, 1, 'touch');
		await sleep();
		expectRectCloseTo(parseRectCallback(wrapper.dataset.lastSelectionBoxUpdate ?? ''), {
			left: anchor.x - 100,
			top: anchor.y,
			width: 100,
			height: 60
		});

		// A finger resting mid-box is not a hold: the press was the box's.
		await sleep(LONG_PRESS_MS + 20);
		expect(wrapper.dataset.lastBackgroundLongPress).toBe('');

		dispatchPointer(stage, 'pointermove', anchor.x, anchor.y, 1, 'touch');
		dispatchPointer(stage, 'pointermove', anchor.x + 90, anchor.y - 50, 1, 'touch');
		await sleep();
		const lifted = { left: anchor.x, top: anchor.y - 50, width: 90, height: 50 };
		expectRectCloseTo(parseRectCallback(wrapper.dataset.lastSelectionBoxUpdate ?? ''), lifted);
		expect(wrapper.dataset.lastSelectionBoxEnd).toBe('');

		dispatchPointer(stage, 'pointerup', anchor.x + 90, anchor.y - 50, 1, 'touch');
		await sleep();
		const ended = parseRectCallback(wrapper.dataset.lastSelectionBoxEnd ?? '');
		expectRectCloseTo(ended, lifted);
		expect(ended.flag).toBe('false');
		expect(wrapper.dataset.lastSelectionBoxCancel).toBe('');
		expect(getSelectionBox(stage)).toBeNull();
		// The drag was the box's, not a pan, and its release not a click.
		expect(getStageTransform(canvasElement)).toBe(transformBefore);
		expect(wrapper.dataset.lastBackgroundClick).toBe('');
	}}
/>

<Story
	name="ArmedSelectionBoxEscapeCancels"
	args={{ nodes: [] }}
	play={async ({ canvasElement }) => {
		const wrapper = getCallbacks(canvasElement);
		const stage = getStage(canvasElement);

		await waitForLayout();

		const anchor = getCenter(stage);
		armSelectionBox(canvasElement);
		await sleep();
		dispatchPointer(stage, 'pointermove', anchor.x + 50, anchor.y + 30);
		await sleep();
		const updateBeforeEscape = wrapper.dataset.lastSelectionBoxUpdate;

		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxCancel).toBe('1');
		expect(getSelectionBox(stage)).toBeNull();

		// The box is over: moving reports nothing, and a later click is a click.
		dispatchPointer(stage, 'pointermove', anchor.x + 70, anchor.y + 40);
		dispatchPointer(stage, 'pointerdown', anchor.x + 70, anchor.y + 40);
		dispatchPointer(stage, 'pointerup', anchor.x + 70, anchor.y + 40);
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxUpdate).toBe(updateBeforeEscape);
		expect(wrapper.dataset.lastSelectionBoxEnd).toBe('');
		expect(wrapper.dataset.lastBackgroundClick).not.toBe('');

		// Escape with no box open is not the box's to take.
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxCancel).toBe('1');
	}}
/>

<Story
	name="ArmedSelectionBoxSecondPointerCancelsAndPinches"
	args={{ nodes: [] }}
	play={async ({ canvasElement }) => {
		const wrapper = getCallbacks(canvasElement);
		const stage = getStage(canvasElement);

		await waitForLayout();

		// As in SecondPointerCancelsTheBoxAndPinches: Chromium will not capture a
		// synthetic second finger, and capture is not what this story tests.
		const capture = stage.setPointerCapture.bind(stage);
		stage.setPointerCapture = (pointerId: number) => {
			try {
				capture(pointerId);
			} catch {
				// Synthetic pointer: nothing to capture.
			}
		};

		const anchor = getCenter(stage);
		armSelectionBox(canvasElement);
		await sleep();
		dispatchPointer(stage, 'pointerdown', anchor.x - 40, anchor.y, 1, 'touch');
		dispatchPointer(stage, 'pointermove', anchor.x - 60, anchor.y + 10, 1, 'touch');
		await sleep();
		const updateBeforePinch = wrapper.dataset.lastSelectionBoxUpdate;
		expectRectCloseTo(parseRectCallback(updateBeforePinch ?? ''), {
			left: anchor.x - 60,
			top: anchor.y,
			width: 60,
			height: 10
		});

		dispatchPointer(stage, 'pointerdown', anchor.x + 40, anchor.y, 2, 'touch');
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxCancel).toBe('1');
		expect(getSelectionBox(stage)).toBeNull();

		// The second finger then pinches, as it always has.
		dispatchPointer(stage, 'pointermove', anchor.x + 140, anchor.y, 2, 'touch');
		await sleep();
		expect(parseViewStateCallback(wrapper.dataset.lastLiveViewState ?? '').scale).toBeGreaterThan(
			1
		);
		dispatchPointer(stage, 'pointerup', anchor.x + 140, anchor.y, 2, 'touch');

		// The first finger carrying on and lifting neither reopens nor ends a box.
		dispatchPointer(stage, 'pointermove', anchor.x - 80, anchor.y, 1, 'touch');
		dispatchPointer(stage, 'pointerup', anchor.x - 80, anchor.y, 1, 'touch');
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxUpdate).toBe(updateBeforePinch);
		expect(wrapper.dataset.lastSelectionBoxEnd).toBe('');
		expect(wrapper.dataset.lastSelectionBoxCancel).toBe('1');

		Reflect.deleteProperty(stage, 'setPointerCapture');
	}}
/>

<Story
	name="ArmedSelectionBoxCancelsOnPointerDownOutsideStage"
	args={{ nodes: [] }}
	play={async ({ canvasElement }) => {
		const wrapper = getCallbacks(canvasElement);
		const stage = getStage(canvasElement);
		const armButton = canvasElement.querySelector('[data-testid="arm-selection-box"]');
		if (!(armButton instanceof HTMLElement)) throw new Error('Arm select control not found');

		await waitForLayout();

		const anchor = getCenter(stage);
		const target = { x: anchor.x + 70, y: anchor.y - 20 };
		armSelectionBox(canvasElement);
		await sleep();
		dispatchPointer(stage, 'pointermove', target.x, target.y);
		await sleep();

		// Pressing app chrome outside the stage disarms the box.
		const outside = getCenter(armButton);
		dispatchPointer(armButton, 'pointerdown', outside.x, outside.y);
		dispatchPointer(armButton, 'pointerup', outside.x, outside.y);
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxCancel).toBe('1');
		expect(getSelectionBox(stage)).toBeNull();

		dispatchPointer(stage, 'pointerdown', target.x, target.y);
		dispatchPointer(stage, 'pointerup', target.x, target.y);
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxEnd).toBe('');

		// Re-arming after a cancel works.
		await sleep(DBL_CLICK_MS + 50);
		armSelectionBox(canvasElement);
		await sleep();
		dispatchPointer(stage, 'pointermove', target.x, target.y);
		dispatchPointer(stage, 'pointerdown', target.x, target.y);
		dispatchPointer(stage, 'pointerup', target.x, target.y);
		await sleep();
		expectRectCloseTo(parseRectCallback(wrapper.dataset.lastSelectionBoxEnd ?? ''), {
			left: anchor.x,
			top: anchor.y - 20,
			width: 70,
			height: 20
		});
		expect(wrapper.dataset.lastSelectionBoxCancel).toBe('1');
	}}
/>

<Story
	name="ArmingASelectionBoxCancelsAnArmedCutOrCreationOrBoxAndViceVersa"
	args={{ nodes: [NODES[0]] }}
	play={async ({ canvasElement }) => {
		const wrapper = getCallbacks(canvasElement);
		const stage = getStage(canvasElement);
		const circle = canvasElement.querySelector('.circle') as HTMLElement;
		const armCreation = canvasElement.querySelector(
			`[data-testid="arm-creation-${NODES[0].id}"]`
		) as HTMLElement;
		const lastUpdate = () => parseRectCallback(wrapper.dataset.lastSelectionBoxUpdate ?? '');

		await waitForLayout();

		const anchor = getCenter(stage);
		const nodeCenter = getCenter(circle);
		const bgPoint = { x: nodeCenter.x + NODE_RADIUS * 3, y: nodeCenter.y };

		// A cut, then a box armed over it: the cut goes, and the click that
		// follows is the box's.
		armEdgeCut(canvasElement);
		await sleep();
		armSelectionBox(canvasElement);
		await sleep();
		expect(wrapper.dataset.lastEdgeCutCancel).toBe('1');
		expect(getEdgeCutLine(stage)).toBeNull();
		expect(getSelectionBox(stage)).not.toBeNull();
		dispatchPointer(stage, 'pointermove', bgPoint.x, bgPoint.y);
		dispatchPointer(stage, 'pointerdown', bgPoint.x, bgPoint.y);
		dispatchPointer(stage, 'pointerup', bgPoint.x, bgPoint.y);
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxEnd).not.toBe('');
		expect(wrapper.dataset.lastEdgeCutEnd).toBe('');

		// A box, then a cut armed over it: the box goes, and the click is the cut's.
		const boxEndBefore = wrapper.dataset.lastSelectionBoxEnd;
		armSelectionBox(canvasElement);
		await sleep();
		armEdgeCut(canvasElement);
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxCancel).toBe('1');
		expect(getSelectionBox(stage)).toBeNull();
		expect(getEdgeCutLine(stage)).not.toBeNull();
		dispatchPointer(stage, 'pointermove', bgPoint.x, bgPoint.y);
		dispatchPointer(stage, 'pointerdown', bgPoint.x, bgPoint.y);
		dispatchPointer(stage, 'pointerup', bgPoint.x, bgPoint.y);
		await sleep();
		expectSegmentCallback(wrapper.dataset.lastEdgeCutEnd, anchor, bgPoint);
		expect(wrapper.dataset.lastSelectionBoxEnd).toBe(boxEndBefore);

		// A second box armed over a first replaces it.
		armSelectionBox(canvasElement);
		await sleep();
		dispatchPointer(stage, 'pointermove', bgPoint.x, bgPoint.y);
		await sleep();
		armSelectionBox(canvasElement, true);
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxCancel).toBe('2');
		expect(getSelectionBox(stage)).not.toBeNull();
		expectRectCloseTo(lastUpdate(), { left: anchor.x, top: anchor.y, width: 0, height: 0 });
		expect(lastUpdate().flag).toBe('true');

		// A creation drag armed over a box cancels the box, and takes the click.
		armCreation.click();
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxCancel).toBe('3');
		expect(getSelectionBox(stage)).toBeNull();
		dispatchPointer(stage, 'pointermove', bgPoint.x, bgPoint.y);
		dispatchPointer(stage, 'pointerdown', bgPoint.x, bgPoint.y);
		dispatchPointer(stage, 'pointerup', bgPoint.x, bgPoint.y);
		await sleep();
		expect(parsePointCallback(wrapper.dataset.lastDoubleClickDropBg ?? '').nodeId).toBe(
			NODES[0].id
		);
		expect(wrapper.dataset.lastSelectionBoxEnd).toBe(boxEndBefore);

		// And a box armed over a creation drag cancels the drag, and takes the click.
		const dropBefore = wrapper.dataset.lastDoubleClickDropBg;
		armCreation.click();
		await sleep();
		dispatchPointer(stage, 'pointermove', bgPoint.x, bgPoint.y);
		await sleep();
		armSelectionBox(canvasElement, true);
		await sleep();
		expect(wrapper.dataset.lastCreationCancel).toBe(NODES[0].id);
		dispatchPointer(stage, 'pointermove', bgPoint.x, bgPoint.y);
		dispatchPointer(stage, 'pointerdown', bgPoint.x, bgPoint.y);
		dispatchPointer(stage, 'pointerup', bgPoint.x, bgPoint.y);
		await sleep();
		expect(wrapper.dataset.lastDoubleClickDropBg).toBe(dropBefore);
		expect(parseRectCallback(wrapper.dataset.lastSelectionBoxEnd ?? '').flag).toBe('true');

		// A box armed over a dragged box in flight abandons it, so the two are
		// never open together.
		const endBeforeDrag = wrapper.dataset.lastSelectionBoxEnd;
		await sleep(DBL_CLICK_MS + 50);
		await dispatchBackgroundDoubleClickDrag(
			stage,
			bgPoint.x,
			bgPoint.y,
			bgPoint.x + 40,
			bgPoint.y + 20
		);
		expect(getSelectionBox(stage)).not.toBeNull();
		armSelectionBox(canvasElement);
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxCancel).toBe('4');
		expectRectCloseTo(lastUpdate(), { left: anchor.x, top: anchor.y, width: 0, height: 0 });
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxCancel).toBe('5');
		// The abandoned drag's release ends nothing.
		dispatchPointer(stage, 'pointerup', bgPoint.x + 40, bgPoint.y + 20);
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxEnd).toBe(endBeforeDrag);
		expect(getSelectionBox(stage)).toBeNull();
	}}
/>

<Story
	name="ArmedSelectionBoxIsAbandonedByPointerCancelARightClickOrACancelRequest"
	args={{ nodes: [] }}
	play={async ({ canvasElement }) => {
		const wrapper = getCallbacks(canvasElement);
		const stage = getStage(canvasElement);
		const cancelButton = canvasElement.querySelector('[data-testid="cancel-selection-box"]');
		if (!(cancelButton instanceof HTMLElement)) throw new Error('Cancel select control not found');

		await waitForLayout();

		const anchor = getCenter(stage);
		const point = { x: anchor.x + 60, y: anchor.y + 20 };

		// The browser taking the pointer back.
		armSelectionBox(canvasElement);
		await sleep();
		dispatchPointer(stage, 'pointerdown', point.x, point.y, 1, 'touch');
		dispatchPointer(stage, 'pointercancel', point.x, point.y, 1, 'touch');
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxCancel).toBe('1');
		expect(getSelectionBox(stage)).toBeNull();

		// macOS ctrl+click: a button-0 press, the contextmenu, then the release.
		// The menu opens, and the release is not taken as the box's end.
		armSelectionBox(canvasElement);
		await sleep();
		dispatchPointer(stage, 'pointerdown', point.x, point.y);
		dispatchContextMenu(stage, point.x, point.y);
		dispatchPointer(stage, 'pointerup', point.x, point.y);
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxCancel).toBe('2');
		expect(
			parseBackgroundPointCallback(wrapper.dataset.lastBackgroundContextMenu ?? '').x
		).toBeCloseTo(point.x);

		// The consumer's own cancel, with no press at all.
		armSelectionBox(canvasElement);
		await sleep();
		cancelButton.click();
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxCancel).toBe('3');
		expect(getSelectionBox(stage)).toBeNull();

		// A cancel with nothing armed reports nothing, and nothing ever ended.
		cancelButton.click();
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxCancel).toBe('3');
		expect(wrapper.dataset.lastSelectionBoxEnd).toBe('');

		// Nor does it touch a dragged box: that one is under a held pointer, and
		// its release is the reader's.
		await sleep(DBL_CLICK_MS + 50);
		await dispatchBackgroundDoubleClickDrag(stage, point.x, point.y, point.x + 40, point.y + 20);
		cancelButton.click();
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxCancel).toBe('3');
		expect(getSelectionBox(stage)).not.toBeNull();
		dispatchPointer(stage, 'pointerup', point.x + 40, point.y + 20);
		await sleep();
		expectRectCloseTo(parseRectCallback(wrapper.dataset.lastSelectionBoxEnd ?? ''), {
			left: point.x,
			top: point.y,
			width: 40,
			height: 20
		});
	}}
/>

<Story
	name="ArmedSelectionBoxIgnoresShift"
	args={{ nodes: [] }}
	play={async ({ canvasElement }) => {
		const wrapper = getCallbacks(canvasElement);
		const stage = getStage(canvasElement);
		const lastUpdate = () => parseRectCallback(wrapper.dataset.lastSelectionBoxUpdate ?? '');
		const pressShift = (type: 'keydown' | 'keyup') =>
			window.dispatchEvent(
				new KeyboardEvent(type, { key: 'Shift', shiftKey: type === 'keydown', bubbles: true })
			);

		await waitForLayout();

		const anchor = getCenter(stage);

		// "Select" replaces whatever Shift says: on a move, alone, or at the click.
		armSelectionBox(canvasElement);
		await sleep();
		dispatchPointer(stage, 'pointermove', anchor.x + 40, anchor.y + 20, 1, '', 0, {
			shiftKey: true
		});
		await sleep();
		expect(lastUpdate().flag).toBe('false');
		const beforeKey = wrapper.dataset.lastSelectionBoxUpdate;
		pressShift('keydown');
		await sleep();
		expect(wrapper.dataset.lastSelectionBoxUpdate).toBe(beforeKey);
		dispatchPointer(stage, 'pointerdown', anchor.x + 40, anchor.y + 20, 1, '', 0, {
			shiftKey: true
		});
		dispatchPointer(stage, 'pointerup', anchor.x + 40, anchor.y + 20, 1, '', 0, {
			shiftKey: true
		});
		await sleep();
		pressShift('keyup');
		expect(parseRectCallback(wrapper.dataset.lastSelectionBoxEnd ?? '').flag).toBe('false');

		// "Select more" adds with no Shift held anywhere.
		armSelectionBox(canvasElement, true);
		await sleep();
		dispatchPointer(stage, 'pointermove', anchor.x - 40, anchor.y + 20);
		await sleep();
		expect(lastUpdate().flag).toBe('true');
		pressShift('keydown');
		pressShift('keyup');
		await sleep();
		expect(lastUpdate().flag).toBe('true');
		dispatchPointer(stage, 'pointerdown', anchor.x - 40, anchor.y + 20);
		dispatchPointer(stage, 'pointerup', anchor.x - 40, anchor.y + 20);
		await sleep();
		expect(parseRectCallback(wrapper.dataset.lastSelectionBoxEnd ?? '').flag).toBe('true');
	}}
/>
