<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Multigraph from '$lib/components/ui/Multigraph/Multigraph.svelte';
	import { expect, fn, waitFor, within } from 'storybook/test';
	import { APP_CONFIG } from '$lib/appConfig';
	import { DBL_CLICK_MS, LONG_PRESS_MS, MIN_NODE_HIT_RADIUS, NODE_RADIUS } from '$lib/constants';
	import { makeClusteredRandomEdges, makeGraph, makeRandomEdges } from './lib/testFixtures';
	import type { MultigraphData, Point } from '../types/multigraph';

	const { Story } = defineMeta({
		title: 'Components/Multigraph',
		component: Multigraph,
		tags: [],
		argTypes: {
			multigraphData: { control: 'object' },
			defaultPrimaryNodeId: { control: 'text' },
			layoutSettings: { control: 'object' },
			onMultigraphChange: { control: false }
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
		};
	};

	type ChangeSpy = {
		mock: { calls: Array<[MultigraphData]> };
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
		canvas.getByRole('button', { name: 'Save' }).click();
		await sleep();

		expect(canvas.getByText('Updated mobile title')).toBeInTheDocument();
		expect(lastChangedGraph(args).nodes[0].title).toBe('Updated mobile title');
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
			color: '#888'
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

		const newCircle = getCircle(canvasElement, 'n1');
		const newCenter = getCenter(newCircle);
		expect(Number.isFinite(newCenter.x)).toBe(true);
		expect(newCenter.y).toBeCloseTo(dropY);
		expect(distanceBetween(sourceCenter, newCenter)).toBeLessThan(
			distanceBetween(sourceCenter, { x: dropX, y: dropY })
		);
		expect(canvasElement.querySelector('[data-edge-id="e0"]')).toBeInTheDocument();
		expect(lastChangedGraph(args).nodes.map((node) => node.id)).toEqual(['n0', 'n1']);
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
		expect(canvasElement.querySelector('[data-edge-id="e0"]')).toHaveAttribute(
			'data-edge-visibility',
			'visible'
		);
		const boundaryEdge = canvasElement.querySelector('[data-edge-id="e2"]');
		expect(boundaryEdge).toHaveAttribute('data-edge-visibility', 'boundary');
		expect(boundaryEdge).toHaveAttribute('data-visible-node-id', 'n2');
		expect(boundaryEdge).toHaveAttribute('data-hidden-node-id', 'n3');
		expect(boundaryEdge).toHaveAttribute('data-boundary-fade-ratio', '0.5');
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
