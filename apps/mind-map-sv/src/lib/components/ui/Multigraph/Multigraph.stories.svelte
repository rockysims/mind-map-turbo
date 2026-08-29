<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Multigraph from '$lib/components/ui/Multigraph/Multigraph.svelte';
	import { expect, fn, waitFor, within } from 'storybook/test';
	import { tick } from 'svelte';
	import { APP_CONFIG } from '$lib/appConfig';
	import {
		DBL_CLICK_MS,
		DRAG_THRESHOLD,
		EDGE_ARROW_HALF_HEIGHT,
		LONG_PRESS_MS,
		MIN_NODE_HIT_RADIUS,
		NODE_RADIUS
	} from '$lib/constants';
	import {
		designations,
		makeClusteredRandomEdges,
		makeGraph,
		makeRandomEdges,
		OPPOSITE_DIRECTION_PARALLEL_EDGES_GRAPH,
		SAME_DIRECTION_PARALLEL_EDGES_GRAPH,
		withDesignations,
		withRandomTagsAndDirections
	} from './lib/testFixtures';
	import type { MultigraphData, Point } from '../types/multigraph';
	import type { QuantityDesignation } from '../types/node';
	import type { ViewState } from '$lib/migrations';
	import type { ExitingBuffer } from './lib/elementTransitions';
	import type { GraphAssetStore, StoredGraphAsset } from '$lib/assets/assetStore';

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

	const FOCUS_IMAGE_ASSET_ID = 'focus-image-asset';
	const FOCUS_IMAGE_SCOPE = 'focus-story';
	const FOCUS_IMAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480">
		<rect width="640" height="480" fill="#e0f2fe"/>
		<circle cx="220" cy="230" r="120" fill="#fb7185"/>
		<rect x="330" y="145" width="190" height="190" rx="26" fill="#22c55e"/>
	</svg>`;
	const focusImageAssetStore: GraphAssetStore = {
		async put() {
			return { ok: true, value: undefined };
		},
		async get(scope: string, assetId: string) {
			if (scope !== FOCUS_IMAGE_SCOPE || assetId !== FOCUS_IMAGE_ASSET_ID) {
				return { ok: false, reason: 'not-found' };
			}
			const blob = new Blob([FOCUS_IMAGE_SVG], { type: 'image/svg+xml' });
			const asset: StoredGraphAsset = {
				scope,
				assetId,
				blob,
				mimeType: 'image/svg+xml',
				name: 'focus-image.svg',
				size: FOCUS_IMAGE_SVG.length,
				updatedAt: 0
			};
			return { ok: true, value: asset };
		},
		async delete() {
			return { ok: true, value: undefined };
		},
		async deleteUnreferenced() {
			return { ok: true, value: [] };
		},
		async list() {
			return { ok: true, value: [] };
		}
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

	/** The single deep-zoom morph surface (there is exactly one per active level). */
	function getFocusLayer(el: HTMLElement): HTMLElement {
		const layer = el.querySelector('.deep-zoom-layer');
		if (!layer) throw new Error('Focus morph layer not found');
		return layer as HTMLElement;
	}

	/** The surface's live morphed rect, read from the data-* the layer publishes. */
	function morphRectOf(layer: HTMLElement): {
		x: number;
		y: number;
		width: number;
		height: number;
		progress: number;
		radius: number;
		borderWidth: number;
	} {
		return {
			x: Number(layer.dataset.morphX),
			y: Number(layer.dataset.morphY),
			width: Number(layer.dataset.morphWidth),
			height: Number(layer.dataset.morphHeight),
			progress: Number(layer.dataset.morphProgress),
			radius: Number(layer.dataset.morphRadius),
			borderWidth: Number(layer.dataset.morphBorderWidth)
		};
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
		pointerId = 1,
		pointerType = ''
	) {
		target.dispatchEvent(
			new PointerEvent(type, {
				clientX,
				clientY,
				pointerId,
				pointerType,
				bubbles: true,
				cancelable: true
			})
		);
	}

	/** Touch long-press: the only pointer type that still opens the menu by holding. */
	async function dispatchLongPress(target: HTMLElement, clientX: number, clientY: number) {
		dispatchPointer(target, 'pointerdown', clientX, clientY, 1, 'touch');
		await sleep(LONG_PRESS_MS + 20);
	}

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

	/**
	 * Right-click whatever is actually topmost at a point — with the action menu
	 * open that is its full-viewport overlay, not the node underneath.
	 */
	function dispatchContextMenuAt(clientX: number, clientY: number): MouseEvent {
		const target = document.elementFromPoint(clientX, clientY);
		if (!target) throw new Error(`No element at (${clientX}, ${clientY})`);
		return dispatchContextMenu(target as HTMLElement, clientX, clientY);
	}

	function dispatchKeydown(target: Element | null, key: string): KeyboardEvent {
		if (!target) throw new Error(`No target to receive ${key}`);
		const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
		target.dispatchEvent(event);
		return event;
	}

	function activeElementText(): string {
		return document.activeElement?.textContent?.trim() ?? '';
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

	function expectParallelEdgeMetadata(edge: HTMLElement, groupCount: number, slot: number): void {
		expect(edge).toHaveAttribute('data-edge-parallel-count', String(groupCount));
		expect(Number(edge.dataset.edgeParallelSlot)).toBe(slot);

		const offset = Number(edge.dataset.edgeParallelOffset);
		if (slot === 0) {
			expect(offset).toBe(0);
			return;
		}

		expect(Math.sign(offset)).toBe(Math.sign(slot));
		expect(Math.abs(offset)).toBeGreaterThan(0);
	}

	function expectEdgeBetweenHorizontalNodeRims(
		el: HTMLElement,
		edgeId: string,
		leftNodeId: string,
		rightNodeId: string
	): void {
		const edgeRect = getEdge(el, edgeId).getBoundingClientRect();
		const leftCircleRect = getCircle(el, leftNodeId).getBoundingClientRect();
		const rightCircleRect = getCircle(el, rightNodeId).getBoundingClientRect();

		expect(edgeRect.left).toBeGreaterThanOrEqual(leftCircleRect.right);
		expect(edgeRect.right).toBeLessThanOrEqual(rightCircleRect.left);
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
	const HUNDRED_NODE_MANY_GRAPH = withRandomTagsAndDirections(
		makeGraph({
			nodeCount: 100,
			pinned: [0],
			edges: HUNDRED_NODE_CLUSTERED_EDGES,
			posByNodeId: HUNDRED_NODE_POSITIONS
		}),
		{ seed: 42, minNodeTags: 0, maxNodeTags: 4, minEdgeTags: 0, maxEdgeTags: 2 }
	);

	const SAME_DIRECTION_PARALLEL_EDGES_WITH_UNRELATED_EDGE = {
		...SAME_DIRECTION_PARALLEL_EDGES_GRAPH,
		nodes: [
			...SAME_DIRECTION_PARALLEL_EDGES_GRAPH.nodes.map((node) =>
				node.id === 'parallel-a' ? { ...node, pinned: true } : node
			),
			{
				id: 'parallel-c',
				title: 'Parallel C',
				description: 'Endpoint for an unrelated single edge',
				tags: []
			}
		],
		edges: [
			...SAME_DIRECTION_PARALLEL_EDGES_GRAPH.edges,
			{
				id: 'parallel-unrelated-a-to-c',
				sourceNodeId: 'parallel-a',
				targetNodeId: 'parallel-c',
				tags: ['unrelated'],
				directed: false
			}
		],
		posByNodeId: {
			...SAME_DIRECTION_PARALLEL_EDGES_GRAPH.posByNodeId,
			'parallel-c': { x: 0, y: 240 }
		},
		tagColorConfig: {
			nodeTags: {},
			edgeTags: {
				supports: '#2563eb',
				blocks: '#dc2626',
				references: '#16a34a',
				unrelated: '#7c3aed'
			}
		}
	} satisfies MultigraphData;

	const OPPOSITE_DIRECTION_PARALLEL_EDGES_WITH_COLORS = {
		...OPPOSITE_DIRECTION_PARALLEL_EDGES_GRAPH,
		nodes: OPPOSITE_DIRECTION_PARALLEL_EDGES_GRAPH.nodes.map((node) =>
			node.id === 'parallel-a' ? { ...node, pinned: true } : node
		),
		tagColorConfig: {
			nodeTags: {},
			edgeTags: {
				parent: '#0f766e',
				child: '#ea580c'
			}
		}
	} satisfies MultigraphData;

	/**
	 * `d` has confirmed g as an input and nothing defines it yet, so `d` sits
	 * three authored hops from the pin with two layers on show — off screen.
	 * Writing the definition into `a` and confirming it there is a pure content
	 * edit that changes the topology, which is the case the harness stories
	 * cannot reach: they re-ingest the whole graph on every equation change, and
	 * ingest settles everything on its way in.
	 */
	const DATAFLOW_CONTENT_COMMIT_CHAIN = makeGraph({
		nodes: [
			{ id: 'a', title: 'Gravity', description: '' },
			{ id: 'b', title: 'Middle', description: '' },
			{ id: 'c', title: 'Third', description: '' },
			{
				id: 'd',
				title: 'Weight',
				description: '$$w = m g$$',
				inputs: designations('g'),
				outputs: designations('w')
			}
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

	const TWO_LAYERS_SETTLING = { displayedLayers: 2 };

	/**
	 * One layer on show and no derived budget, so a definer stays off screen
	 * however many quantities point at it. That is the situation the jump exists
	 * for: the reader can see that g comes from somewhere and cannot see where.
	 */
	const NO_REVEALS = { displayedLayers: 1, relaxIterations: 0, dataflowDisplayedLayers: 0 };

	/** `reader` needs g; `gravity` defines it, three authored hops away. */
	const JUMP_TO_DEFINER = makeGraph({
		nodes: [
			{
				id: 'reader',
				title: 'Weight',
				description: '$$w = m g$$',
				inputs: designations('g'),
				outputs: designations('w')
			},
			{ id: 'mid', title: 'Middle', description: '' },
			{
				id: 'gravity',
				title: 'Gravity',
				description: '$$g = 9.8$$',
				outputs: designations('g')
			}
		],
		pinned: ['reader'],
		edges: [
			['reader', 'mid'],
			['mid', 'gravity']
		],
		posByNodeId: {
			reader: { x: 0, y: 0 },
			mid: { x: 400, y: 0 },
			gravity: { x: 800, y: 0 }
		}
	});

	/** The same shape one link longer: `gravity` in turn needs h, which `scale` defines. */
	const JUMP_TWICE_TO_DEFINERS = makeGraph({
		nodes: [
			{
				id: 'reader',
				title: 'Weight',
				description: '$$w = m g$$',
				inputs: designations('g'),
				outputs: designations('w')
			},
			{ id: 'mid', title: 'Middle', description: '' },
			{
				id: 'gravity',
				title: 'Gravity',
				description: '$$g = 9.8 h$$',
				inputs: designations('h'),
				outputs: designations('g')
			},
			{ id: 'scale', title: 'Scale', description: '$$h = 2$$', outputs: designations('h') }
		],
		pinned: ['reader'],
		edges: [
			['reader', 'mid'],
			['mid', 'gravity'],
			['gravity', 'scale']
		],
		posByNodeId: {
			reader: { x: 0, y: 0 },
			mid: { x: 400, y: 0 },
			gravity: { x: 800, y: 0 },
			scale: { x: 1200, y: 0 }
		}
	});

	/** One link longer again: `scale` needs r, which `radius` defines — three jumps. */
	const JUMP_THRICE_TO_DEFINERS = makeGraph({
		nodes: [
			{
				id: 'reader',
				title: 'Weight',
				description: '$$w = m g$$',
				inputs: designations('g'),
				outputs: designations('w')
			},
			{ id: 'mid', title: 'Middle', description: '' },
			{
				id: 'gravity',
				title: 'Gravity',
				description: '$$g = 9.8 h$$',
				inputs: designations('h'),
				outputs: designations('g')
			},
			{
				id: 'scale',
				title: 'Scale',
				description: '$$h = 2 r$$',
				inputs: designations('r'),
				outputs: designations('h')
			},
			{ id: 'radius', title: 'Radius', description: '$$r = 6$$', outputs: designations('r') }
		],
		pinned: ['reader'],
		edges: [
			['reader', 'mid'],
			['mid', 'gravity'],
			['gravity', 'scale'],
			['scale', 'radius']
		],
		posByNodeId: {
			reader: { x: 0, y: 0 },
			mid: { x: 400, y: 0 },
			gravity: { x: 800, y: 0 },
			scale: { x: 1200, y: 0 },
			radius: { x: 1600, y: 0 }
		}
	});

	/**
	 * `gravity` defines g and `reader`'s equation mentions it. Whether that counts
	 * as a dataflow edge is exactly the decision a chip in the details view now
	 * makes, so the two nodes are pinned rather than joined: the only thing that
	 * can put an edge between them is the tap.
	 */
	function cycleInDeepZoom(readerInputs: QuantityDesignation[]) {
		return makeGraph({
			nodes: [
				{
					id: 'reader',
					title: 'Weight',
					description: '$$w = m g$$',
					inputs: readerInputs,
					outputs: designations('w')
				},
				{ id: 'gravity', title: 'Gravity', description: '$$g = 9.8$$', outputs: designations('g') }
			],
			pinned: ['reader', 'gravity'],
			posByNodeId: {
				reader: { x: 0, y: 0 },
				gravity: { x: 400, y: 0 }
			}
		});
	}

	/**
	 * One node, one equation, nothing confirmed — the literal repro. Asking what
	 * defines y used to be answered "nothing does", by the card hanging under the
	 * very equation that defines it.
	 */
	const ITS_OWN_DEFINER = makeGraph({
		nodes: [{ id: 'reader', title: '$y = 1$', description: '' }],
		pinned: ['reader'],
		posByNodeId: { reader: { x: 0, y: 0 } }
	});

	/**
	 * The same node, having filed the quantity it writes under Inputs. Nobody else
	 * is involved, so every part of the report and its repair has to fit on this
	 * one node's surface.
	 */
	const ITS_OWN_DEFINER_LABELED_INPUT = makeGraph({
		nodes: [{ id: 'reader', title: '$y = 1$', description: '', inputs: designations('y') }],
		pinned: ['reader'],
		posByNodeId: { reader: { x: 0, y: 0 } }
	});

	/**
	 * `reader` has confirmed g as an input and `gravity` has written what g is
	 * without confirming it. Nothing is joined and nothing is derived, so the only
	 * thing that can put an edge between them is the confirm in the peek card.
	 */
	const CONFIRM_FROM_A_PEEK = makeGraph({
		nodes: [
			{
				id: 'reader',
				title: 'Weight',
				description: '$$w = m g$$',
				inputs: designations('g'),
				outputs: designations('w')
			},
			{ id: 'gravity', title: 'Gravity', description: '$$g = 9.8$$' }
		],
		pinned: ['reader', 'gravity'],
		posByNodeId: {
			reader: { x: 0, y: 0 },
			gravity: { x: 400, y: 0 }
		}
	});

	/**
	 * `reader` needs g, `gravity` defines it and in turn needs h — and nothing
	 * anywhere defines h. The offer to define it is therefore made two levels down
	 * a peek cascade, by a card about a quantity the reader never named, on behalf
	 * of a node the reader is not focused on.
	 */
	const DEFINE_FROM_A_NESTED_PEEK = makeGraph({
		nodes: [
			{
				id: 'reader',
				title: 'Weight',
				description: '$$w = m g$$',
				inputs: designations('g'),
				outputs: designations('w')
			},
			{
				id: 'gravity',
				title: 'Gravity',
				description: '$$g = 9.8 h$$',
				inputs: designations('h'),
				outputs: designations('g')
			}
		],
		pinned: ['reader'],
		edges: [['reader', 'gravity']],
		posByNodeId: {
			reader: { x: 0, y: 0 },
			gravity: { x: 400, y: 0 }
		}
	});

	/**
	 * Open one named node's focus overlay through its action menu.
	 *
	 * The overzoom gesture is the everyday route and has its own stories; a story
	 * about what happens *inside* the overlay wants the node it asked for, not
	 * whichever one the camera happened to leave under the cursor.
	 */
	async function enterFocusOn(canvasElement: HTMLElement, nodeId: string): Promise<HTMLElement> {
		const circle = getCircle(canvasElement, nodeId);
		const center = getCenter(circle);
		await dispatchLongPress(circle, center.x, center.y);
		within(canvasElement).getByRole('menuitem', { name: 'Focus' }).click();

		const dialog = await within(canvasElement).findByRole('dialog');
		await expectFocusOn(canvasElement, nodeId);
		return dialog;
	}

	/** Which node's details the reader is currently reading. */
	async function expectFocusOn(canvasElement: HTMLElement, nodeId: string): Promise<void> {
		await waitFor(() => {
			expect(canvasElement.querySelector('.focus-surface')).toHaveAttribute(
				'data-focus-subject-id',
				nodeId
			);
		});
	}

	/** One quantity chip in the details view, once the overlay has drawn it. */
	async function viewChip(canvasElement: HTMLElement, quantityKey: string): Promise<HTMLElement> {
		return await waitFor(() => {
			const found = canvasElement.querySelector(
				`[data-designation-chips="view"] [data-designation-key="${quantityKey}"]`
			);
			expect(found).toBeInTheDocument();
			return found as HTMLElement;
		});
	}

	/** Open the peek card for one quantity and follow it to its definer. */
	async function jumpFromPeek(
		canvasElement: HTMLElement,
		quantityKey: string,
		definerNodeId: string
	): Promise<void> {
		await openPeekCard(canvasElement, quantityKey);

		const goto = await waitFor(() => {
			const button = canvasElement.querySelector(`[data-peek-goto="${definerNodeId}"]`);
			expect(button).toBeInTheDocument();
			return button as HTMLElement;
		});
		goto.click();
		// The reader asked what that node says, so the jump has to hand them the
		// definer's details — not the canvas around it, with the overlay to reopen
		// by hand. The subject swapping is also how a story knows the jump ran.
		await expectFocusOn(canvasElement, definerNodeId);
		// A reveal changes who is on screen, which the layout settles for — and a
		// story that reached for a node mid-settle would be aiming at where it was.
		await waitFor(() => {
			expect(isSettling(canvasElement)).toBe(false);
		});
		await waitForLayout();
	}

	/**
	 * Open a view chip's peek card and hand back the root card.
	 *
	 * Deliberately one place: the gesture that opens a peek is a decision this
	 * suite makes, and a story about what a card offers should not have to
	 * re-state it. A tap on a view chip cycles the designation now, so the
	 * question is asked the way the surface asks it — by right-clicking, the
	 * desktop half of the hold.
	 */
	async function openPeekCard(
		canvasElement: HTMLElement,
		quantityKey: string
	): Promise<HTMLElement> {
		const chip = await viewChip(canvasElement, quantityKey);
		const center = getCenter(chip);
		dispatchContextMenu(chip, center.x, center.y);

		// The root card specifically — nested cards carry the same label attribute.
		return await waitFor(() => {
			const card = canvasElement.querySelector('[data-peek-path=""]');
			expect(card).toBeInTheDocument();
			return card as HTMLElement;
		});
	}

	/**
	 * Drill one definer's own input and hand back the card it opens.
	 *
	 * The chip is found by reading `data-peek-drill` rather than by selector: a
	 * subscripted key embeds a NUL, which no attribute selector can carry.
	 */
	async function drillIntoPeek(
		card: HTMLElement,
		definerNodeId: string,
		quantityKey: string
	): Promise<HTMLElement> {
		const row = card.querySelector(`[data-peek-definer="${definerNodeId}"]`);
		if (!(row instanceof HTMLElement)) throw new Error(`no definer row for ${definerNodeId}`);
		const chip = Array.from(
			row.querySelectorAll(':scope > [data-peek-drill-line] [data-peek-drill]')
		).find((candidate) => candidate.getAttribute('data-peek-drill') === quantityKey);
		if (!(chip instanceof HTMLElement)) throw new Error(`no drill chip for ${quantityKey}`);
		const pathKey = chip.getAttribute('data-peek-drill-path') ?? '';
		chip.click();

		return await waitFor(() => {
			const nested = card.querySelector(`[data-peek-path="${pathKey}"]`);
			expect(nested).toBeInTheDocument();
			return nested as HTMLElement;
		});
	}

	/** The inline title input a Define lands the author in, once it opens. */
	async function openTitleInput(canvasElement: HTMLElement): Promise<HTMLInputElement> {
		const input = await waitFor(() => {
			const found = canvasElement.querySelector('.title-input');
			expect(found).toBeInTheDocument();
			return found as HTMLInputElement;
		});
		await waitFor(() => {
			expect(document.activeElement).toBe(input);
		});
		return input;
	}

	/** The jump trail as the reader reads it, oldest first. */
	function navTrail(canvasElement: HTMLElement): string[] {
		return Array.from(canvasElement.querySelectorAll('[data-nav-breadcrumbs] .crumb')).map(
			(crumb) => crumb.textContent?.trim() ?? ''
		);
	}

	/** Unwind to one crumb, named by the node it goes back to. */
	async function clickCrumb(canvasElement: HTMLElement, originNodeId: string): Promise<void> {
		const crumb = await waitFor(() => {
			const found = canvasElement.querySelector(`[data-nav-crumb-node="${originNodeId}"]`);
			expect(found).toBeInTheDocument();
			return found as HTMLElement;
		});
		crumb.click();
	}

	function isSettling(el: HTMLElement): boolean {
		const graph = el.querySelector('.graph');
		if (!graph) throw new Error('Graph root not found');
		return (graph as HTMLElement).dataset.settling === 'true';
	}

	/**
	 * One tap on each ghost chip, which confirms it in the column it is drawn in.
	 *
	 * Scoped to the edit surface: the details view's chips answer to a tap too
	 * now, and a helper that reached for whichever chip happened to be on screen
	 * would be confirming designations somewhere the story never opened.
	 */
	async function confirmSuggestedChips(canvasElement: HTMLElement): Promise<void> {
		const suggestions = canvasElement.querySelectorAll(
			'[data-designation-chips="edit"] [data-designation-role="suggestion"]'
		);
		expect(suggestions.length).toBeGreaterThan(0);
		for (const chip of Array.from(suggestions)) {
			(chip as HTMLElement).click();
			await tick();
		}
	}

	/**
	 * Tap confirmed chips until nothing is assigned. A stale chip has no suggested
	 * role to enter the cycle at, so the number of taps depends on which column it
	 * sits in — looping is what makes "take them all off" one step for a story.
	 */
	async function clearDesignationChips(canvasElement: HTMLElement): Promise<void> {
		const confirmed = () =>
			canvasElement.querySelector(
				'[data-designation-chips="edit"] [data-designation-role="input"], [data-designation-chips="edit"] [data-designation-role="output"]'
			);
		for (let taps = 0; taps < 24 && confirmed(); taps += 1) {
			(confirmed() as HTMLElement).click();
			await tick();
		}
		expect(confirmed()).toBeNull();
	}

	/**
	 * Long-press a node, open its sheet, replace the description, settle the
	 * quantity chips, and save.
	 *
	 * The chips are part of the edit, not decoration on top of it: text alone
	 * designates nothing, so a story about an equation arriving has to confirm
	 * what it suggests, and one about an equation leaving has to take the
	 * designations off — otherwise they stand as stale, and the edge with them.
	 */
	async function commitDescriptionThroughSheet(
		canvasElement: HTMLElement,
		nodeId: string,
		description: string,
		designationStep?: (canvasElement: HTMLElement) => Promise<void>
	): Promise<void> {
		const circle = getCircle(canvasElement, nodeId);
		const center = getCenter(circle);
		await dispatchLongPress(circle, center.x, center.y);

		const canvas = within(canvasElement);
		canvas.getByRole('menuitem', { name: 'Edit' }).click();
		await sleep();

		const descriptionInput = canvas.getByLabelText('Description') as HTMLTextAreaElement;
		descriptionInput.value = description;
		descriptionInput.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();
		await designationStep?.(canvasElement);
		canvas.getByRole('button', { name: 'Save' }).click();
		// A microtask flush, not a frame: the settle kick has to be observable
		// before the first animation frame could have consumed it.
		await tick();
	}
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
		multigraphData: HUNDRED_NODE_MANY_GRAPH,
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
	name="UserZoomsFocusWorldOverNodeImage"
	args={{
		multigraphData: {
			...makeGraph({
				nodes: [
					{
						id: 'image-node',
						title: 'Image node',
						description: 'Zoom directly into the image inside focus.',
						tags: ['visual'],
						content: [
							{
								type: 'image',
								assetId: FOCUS_IMAGE_ASSET_ID,
								alt: 'Color blocks',
								caption: 'A small test image'
							}
						]
					}
				],
				pinned: ['image-node']
			}),
			assets: {
				[FOCUS_IMAGE_ASSET_ID]: {
					id: FOCUS_IMAGE_ASSET_ID,
					kind: 'image',
					mimeType: 'image/svg+xml',
					name: 'focus-image.svg',
					size: FOCUS_IMAGE_SVG.length,
					createdAt: 0
				}
			}
		},
		defaultPrimaryNodeId: 'image-node',
		assetStore: focusImageAssetStore,
		assetScope: FOCUS_IMAGE_SCOPE,
		layoutSettings: { relaxIterations: 0 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const circle = getCircle(canvasElement, 'image-node');
		const center = getCenter(circle);
		const canvas = within(canvasElement);

		await dispatchLongPress(circle, center.x, center.y);
		dispatchPointer(circle, 'pointerup', center.x, center.y);
		canvas.getByRole('menuitem', { name: 'Focus' }).click();

		const dialog = await canvas.findByRole('dialog');
		await waitFor(() => {
			expect(dialog.querySelector('.focus-image')).toBeInTheDocument();
		});
		expect(canvas.queryByRole('button', { name: /Inspect/i })).not.toBeInTheDocument();

		const image = dialog.querySelector('.focus-image') as HTMLElement;
		const imageCenter = getCenter(image);
		const world = dialog.querySelector('.zoom-world') as HTMLElement;
		const surface = dialog.querySelector('.focus-surface') as HTMLElement;
		const initialSurfaceRect = surface.getBoundingClientRect();
		dispatchWheel(image, -500, imageCenter.x, imageCenter.y);
		await waitFor(() => {
			expect(Number(world.dataset.zoomWorldScale)).toBeGreaterThan(1);
			expect(surface.getBoundingClientRect().width).toBeGreaterThan(initialSurfaceRect.width);
		});

		const frame = image.closest('.image-frame') as HTMLElement;
		dispatchWheel(image, -1000, imageCenter.x, imageCenter.y);
		await waitFor(() => {
			expect(Number(world.dataset.zoomWorldScale)).toBeGreaterThan(1);
		});
		expect(frame.dataset.imageFocused).toBeUndefined();
		expect(image.dataset.imageZoomScale).toBeUndefined();

		dispatchWheel(world, 2000, imageCenter.x, imageCenter.y);
		await waitFor(() => {
			expect(Number(world.dataset.zoomWorldScale)).toBe(1);
		});
		expect(dialog).toBeInTheDocument();
	}}
/>

<Story
	name="UserBoldZoomsIntoNodeImageToDepthTwo"
	args={{
		multigraphData: {
			...makeGraph({
				nodes: [
					{
						id: 'image-node',
						title: 'Image node',
						description: 'Bold-zoom into the image to nest a deeper level.',
						tags: ['visual'],
						content: [
							{
								type: 'image',
								assetId: FOCUS_IMAGE_ASSET_ID,
								alt: 'Color blocks',
								caption: 'A small test image'
							}
						]
					}
				],
				pinned: ['image-node']
			}),
			assets: {
				[FOCUS_IMAGE_ASSET_ID]: {
					id: FOCUS_IMAGE_ASSET_ID,
					kind: 'image',
					mimeType: 'image/svg+xml',
					name: 'focus-image.svg',
					size: FOCUS_IMAGE_SVG.length,
					createdAt: 0
				}
			}
		},
		defaultPrimaryNodeId: 'image-node',
		assetStore: focusImageAssetStore,
		assetScope: FOCUS_IMAGE_SCOPE,
		layoutSettings: { relaxIterations: 0 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const circle = getCircle(canvasElement, 'image-node');
		const center = getCenter(circle);
		const canvas = within(canvasElement);

		// Commit focus on the node via the long-press menu (no residual gate).
		await dispatchLongPress(circle, center.x, center.y);
		dispatchPointer(circle, 'pointerup', center.x, center.y);
		canvas.getByRole('menuitem', { name: 'Focus' }).click();

		const dialog = await canvas.findByRole('dialog');
		await waitFor(() => {
			expect(dialog.querySelector('.focus-image')).toBeInTheDocument();
		});

		const stack = canvasElement.querySelector('.deep-zoom-stack') as HTMLElement;
		expect(stack.dataset.depth).toBe('1');

		const image = dialog.querySelector('.focus-image') as HTMLElement;
		const imageCenter = getCenter(image);
		const nodeWorld = dialog.querySelector('.zoom-world') as HTMLElement;

		// Zoom the node world in toward max scale over the image.
		dispatchWheel(image, -3000, imageCenter.x, imageCenter.y);
		await waitFor(() => {
			expect(Number(nodeWorld.dataset.zoomWorldScale)).toBeGreaterThan(1);
		});

		// A bold zoom-in past max, cursor over the image, descends to depth 2.
		dispatchWheel(image, -6000, imageCenter.x, imageCenter.y);
		await waitFor(() => {
			expect(stack.dataset.depth).toBe('2');
		});
		expect(dialog.dataset.focusDepth).toBe('2');

		// The nested details layer mounts lazily once the entry morph advances
		// past progress 0, so wait for it rather than asserting synchronously.
		await waitFor(() => {
			const imageDetails = canvasElement.querySelector(
				'[data-subject-kind="image"]'
			) as HTMLElement | null;
			expect(imageDetails).toBeInTheDocument();
			expect(imageDetails?.dataset.focusSubjectId).toBe(FOCUS_IMAGE_ASSET_ID);
			expect(canvasElement.querySelector('.focus-image-full')).toBeInTheDocument();
		});

		// Wait for the entry morph to finish so the image world mounts and pans.
		await waitFor(
			() => {
				const layers = canvasElement.querySelectorAll('.deep-zoom-layer');
				const active = layers[layers.length - 1] as HTMLElement;
				expect(Number(active.dataset.morphProgress)).toBe(1);
			},
			{ timeout: 2000 }
		);

		// Zoom out past fit in the image world pops back to the node (depth 1),
		// continuously (focus stays open — it does not close).
		const imageWorld = dialog.querySelector('.zoom-world') as HTMLElement;
		dispatchWheel(imageWorld, 6000, imageCenter.x, imageCenter.y);
		await waitFor(
			() => {
				expect(stack.dataset.depth).toBe('1');
			},
			{ timeout: 2000 }
		);
		expect(dialog).toBeInTheDocument();
		expect(dialog.dataset.focusDepth).toBe('1');
	}}
/>

<Story
	name="UserBoldZoomsIntoNodeImageWithReducedMotion"
	args={{
		multigraphData: {
			...makeGraph({
				nodes: [
					{
						id: 'image-node',
						title: 'Image node',
						description: 'Reduced motion still reaches the nested image level.',
						tags: ['visual'],
						content: [
							{
								type: 'image',
								assetId: FOCUS_IMAGE_ASSET_ID,
								alt: 'Color blocks',
								caption: 'A small test image'
							}
						]
					}
				],
				pinned: ['image-node']
			}),
			assets: {
				[FOCUS_IMAGE_ASSET_ID]: {
					id: FOCUS_IMAGE_ASSET_ID,
					kind: 'image',
					mimeType: 'image/svg+xml',
					name: 'focus-image.svg',
					size: FOCUS_IMAGE_SVG.length,
					createdAt: 0
				}
			}
		},
		defaultPrimaryNodeId: 'image-node',
		assetStore: focusImageAssetStore,
		assetScope: FOCUS_IMAGE_SCOPE,
		layoutSettings: { relaxIterations: 0 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		// Force reduced motion BEFORE focus first reads it (the derived is lazy
		// and only read once focus mounts), so the morph skips intermediate frames.
		const originalMatchMedia = window.matchMedia;
		window.matchMedia = ((query: string) => ({
			matches: query.includes('prefers-reduced-motion'),
			media: query,
			onchange: null,
			addListener() {},
			removeListener() {},
			addEventListener() {},
			removeEventListener() {},
			dispatchEvent() {
				return false;
			}
		})) as typeof window.matchMedia;
		try {
			await waitForLayout();
			const circle = getCircle(canvasElement, 'image-node');
			const center = getCenter(circle);
			const canvas = within(canvasElement);

			await dispatchLongPress(circle, center.x, center.y);
			dispatchPointer(circle, 'pointerup', center.x, center.y);
			canvas.getByRole('menuitem', { name: 'Focus' }).click();

			const dialog = await canvas.findByRole('dialog');
			await waitFor(() => {
				expect(dialog.querySelector('.focus-image')).toBeInTheDocument();
			});

			const stack = canvasElement.querySelector('.deep-zoom-stack') as HTMLElement;
			const image = dialog.querySelector('.focus-image') as HTMLElement;
			const imageCenter = getCenter(image);
			const nodeWorld = dialog.querySelector('.zoom-world') as HTMLElement;

			dispatchWheel(image, -3000, imageCenter.x, imageCenter.y);
			await waitFor(() => {
				expect(Number(nodeWorld.dataset.zoomWorldScale)).toBeGreaterThan(1);
			});

			dispatchWheel(image, -6000, imageCenter.x, imageCenter.y);
			await waitFor(() => {
				expect(stack.dataset.depth).toBe('2');
			});

			// Reduced motion jumps straight to the committed image level: the
			// nested layer is already at full morph progress (no intermediate frame).
			const layers = canvasElement.querySelectorAll('.deep-zoom-layer');
			const active = layers[layers.length - 1] as HTMLElement;
			expect(Number(active.dataset.morphProgress)).toBe(1);
			expect(canvasElement.querySelector('[data-subject-kind="image"]')).toBeInTheDocument();
		} finally {
			window.matchMedia = originalMatchMedia;
		}
	}}
/>

<Story
	name="UserOverzoomsNodeIntoFocus"
	args={{
		multigraphData: makeGraph({
			nodeCount: 1,
			pinned: [0],
			posByNodeId: { n0: { x: 0, y: 0 } }
		}),
		defaultPrimaryNodeId: 'n0',
		initialViewState: { panX: 0, panY: 0, scale: APP_CONFIG.multigraph.zoom.maxScale },
		layoutSettings: { relaxIterations: 0 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);
		const oversizedRect = circle.getBoundingClientRect();
		const stageRect = stage.getBoundingClientRect();

		dispatchWheel(stage, -800, center.x, center.y);

		const dialog = await within(canvasElement).findByRole('dialog');
		// One morph surface owns the committed frame; it fills the stage.
		const layer = getFocusLayer(canvasElement);
		const surface = dialog.querySelector('.focus-surface') as HTMLElement;
		const world = dialog.querySelector('.zoom-world') as HTMLElement;
		expect(surface.dataset.focusSubjectId).toBe('n0');
		const committed = morphRectOf(layer);
		expect(committed.progress).toBe(1);
		expect(committed.width).toBeCloseTo(stageRect.width, 0);
		expect(committed.height).toBeCloseTo(stageRect.height, 0);
		expect(committed.x).toBeCloseTo(stageRect.left, 0);
		expect(committed.y).toBeCloseTo(stageRect.top, 0);
		// The single bordered box is the layer's NodeChrome `.circle`.
		const layerRect = layer.getBoundingClientRect();
		const focusedCircle = layer.querySelector('.circle') as HTMLElement;
		const focusedCircleRect = focusedCircle.getBoundingClientRect();
		expect(focusedCircleRect.width).toBeCloseTo(layerRect.width, 0);
		expect(focusedCircleRect.height).toBeCloseTo(layerRect.height, 0);
		expect(parseFloat(window.getComputedStyle(focusedCircle).borderWidth)).toBeCloseTo(
			committed.borderWidth,
			0
		);
		// The frame must not be a scroll container: it wraps the ZoomWorld, so an
		// `overflow: auto/scroll` here would swallow wheel input meant for zoom.
		const focusedCircleStyle = window.getComputedStyle(focusedCircle);
		expect(['auto', 'scroll']).not.toContain(focusedCircleStyle.overflowX);
		expect(['auto', 'scroll']).not.toContain(focusedCircleStyle.overflowY);
		// The overzoomed in-stage circle is larger than the committed source
		// diameter would be — proving the surface used derived (not measured) geometry.
		expect(oversizedRect.width).toBeGreaterThan(0);
		expect(canvasElement.querySelector('.graph')).toHaveClass('focus-active');

		dispatchWheel(world, -800, center.x, center.y);
		await sleep();
		expect(Number(world.dataset.zoomWorldScale)).toBe(1);

		await sleep(APP_CONFIG.multigraph.focus.entryGestureIdleMs + 20);
		dispatchWheel(world, -800, center.x, center.y);
		await waitFor(() => {
			expect(Number(world.dataset.zoomWorldScale)).toBeGreaterThan(1);
		});

		const scaleBeforeBorderWheel = Number(world.dataset.zoomWorldScale);
		dispatchWheel(
			focusedCircle,
			-80,
			focusedCircleRect.left + focusedCircleRect.width / 2,
			focusedCircleRect.top + committed.borderWidth / 2
		);
		await waitFor(() => {
			expect(Number(world.dataset.zoomWorldScale)).toBeGreaterThan(scaleBeforeBorderWheel);
		});

		const stageTransformBeforeExit = getStageTransform(canvasElement);
		dispatchWheel(world, 5000, center.x, center.y);
		await waitFor(() => {
			expect(canvasElement.querySelector('.graph')).not.toHaveClass('focus-active');
		});

		dispatchWheel(stage, 5000, center.x, center.y);
		await sleep();
		expect(getStageTransform(canvasElement)).toBe(stageTransformBeforeExit);

		await sleep(Math.max(0, APP_CONFIG.multigraph.focus.entryGestureIdleMs - 30));
		dispatchWheel(stage, 5000, center.x, center.y);
		await sleep();
		expect(getStageTransform(canvasElement)).toBe(stageTransformBeforeExit);

		await sleep(APP_CONFIG.multigraph.focus.entryGestureIdleMs + 20);
		dispatchWheel(stage, 5000, center.x, center.y);
		await waitFor(() => {
			expect(getStageTransform(canvasElement)).not.toBe(stageTransformBeforeExit);
		});
		await sleep(APP_CONFIG.multigraph.focus.entryTransitionMs + 40);
		expect(canvasElement.querySelector('[role="dialog"]')).not.toBeInTheDocument();
	}}
/>

<Story
	name="NodeFocusPreviewResetsWhenBoundaryZoomReverses"
	args={{
		multigraphData: makeGraph({
			nodeCount: 1,
			pinned: [0],
			posByNodeId: { n0: { x: 0, y: 0 } }
		}),
		defaultPrimaryNodeId: 'n0',
		initialViewState: { panX: 0, panY: 0, scale: 0.95 },
		layoutSettings: { relaxIterations: 0 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);

		// A gentle scrub mounts the single morph surface partway — but does NOT
		// commit, so there is no dialog and the in-stage node is hidden.
		dispatchWheel(stage, -80, center.x, center.y);
		await waitFor(() => {
			const layer = getFocusLayer(canvasElement);
			expect(morphRectOf(layer).progress).toBeGreaterThan(0);
			expect(morphRectOf(layer).progress).toBeLessThan(1);
		});
		expect(canvasElement.querySelector('[role="dialog"]')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('.graph')).not.toHaveClass('focus-active');
		expect(canvasElement.querySelector('.node-wrapper.focus-owned')).toBeInTheDocument();

		const scrubLayer = getFocusLayer(canvasElement);
		const scrubCompact = scrubLayer.querySelector('.deep-zoom-compact-layer') as HTMLElement;
		const scrubDetails = scrubLayer.querySelector('.deep-zoom-details-layer') as HTMLElement;
		expect(scrubDetails.querySelector('.details-title')?.textContent).toBe('Node 0');
		// Crossfade is underway within the one surface: compact fading out,
		// details fading in.
		expect(Number(scrubCompact.dataset.layerOpacity)).toBeLessThan(1);
		expect(Number(scrubDetails.dataset.layerOpacity)).toBeGreaterThan(0);

		// Reversing the scrub drives progress back to 0; after the entry gesture
		// idles the surface unmounts and hands the frame back to the in-stage node.
		dispatchWheel(stage, 160, center.x, center.y);
		await waitFor(() => {
			expect(morphRectOf(getFocusLayer(canvasElement)).progress).toBe(0);
		});
		await sleep(APP_CONFIG.multigraph.focus.entryGestureIdleMs + 40);
		await waitFor(() => {
			expect(canvasElement.querySelector('.deep-zoom-layer')).not.toBeInTheDocument();
		});
		expect(canvasElement.querySelector('[role="dialog"]')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('.node-wrapper.focus-owned')).not.toBeInTheDocument();
	}}
/>

<Story
	name="FocusedWorldExitsWithGradualZoomOut"
	args={{
		multigraphData: makeGraph({
			nodeCount: 1,
			pinned: [0],
			posByNodeId: { n0: { x: 0, y: 0 } }
		}),
		defaultPrimaryNodeId: 'n0',
		initialViewState: { panX: 0, panY: 0, scale: APP_CONFIG.multigraph.zoom.maxScale },
		layoutSettings: { relaxIterations: 0 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);

		dispatchWheel(stage, -800, center.x, center.y);
		const dialog = await within(canvasElement).findByRole('dialog');
		const world = dialog.querySelector('.zoom-world') as HTMLElement;
		const layer = getFocusLayer(canvasElement);
		const focusedCircle = layer.querySelector('.circle') as HTMLElement;
		const initialLayerRect = layer.getBoundingClientRect();

		// A gradual zoom-out scrubs the SAME surface's morphProgress down while
		// the level stays committed (the frame shrinks toward the node).
		dispatchWheel(world, 70, center.x, center.y);
		await waitFor(() => {
			const progress = morphRectOf(layer).progress;
			expect(progress).toBeGreaterThan(0);
			expect(progress).toBeLessThan(1);
		});
		const exitingLayerRect = layer.getBoundingClientRect();
		expect(exitingLayerRect.width * exitingLayerRect.height).toBeLessThan(
			initialLayerRect.width * initialLayerRect.height
		);
		const compactLayer = layer.querySelector('.deep-zoom-compact-layer') as HTMLElement;
		const detailsLayer = layer.querySelector('.deep-zoom-details-layer') as HTMLElement;
		expect(Number(compactLayer.dataset.layerOpacity)).toBeGreaterThan(0);
		expect(Number(detailsLayer.dataset.layerOpacity)).toBeLessThan(1);
		expect(parseFloat(window.getComputedStyle(focusedCircle).borderRadius)).toBeCloseTo(
			morphRectOf(layer).radius,
			0
		);
		expect(canvasElement.querySelector('.graph')).toHaveClass('focus-active');

		const partialExitProgress = morphRectOf(layer).progress;
		dispatchWheel(world, -10, center.x, center.y);
		await waitFor(() => {
			const progress = morphRectOf(layer).progress;
			expect(progress).toBeGreaterThan(partialExitProgress);
			expect(progress).toBeLessThan(1);
		});

		// A bold flick out crosses the exit boundary: the gesture drives progress
		// directly to 0, then unmounts the surface one frame later.
		dispatchWheel(world, 5000, center.x, center.y);
		await tick();
		expect(dialog).toBeInTheDocument();
		expect(canvasElement.querySelector('.graph')).not.toHaveClass('focus-active');
		expect(morphRectOf(layer).progress).toBe(0);
		const exited = morphRectOf(layer);
		// At progress 0 the frame is the node's circle: radius === half its width.
		expect(exited.radius).toBeCloseTo(exited.width / 2, 0);
		// One rAF later the surface unmounts.
		await waitForFrames(1);
		await waitFor(() => {
			expect(canvasElement.querySelector('[role="dialog"]')).not.toBeInTheDocument();
		});
	}}
/>

<Story
	name="MorphSurfaceMatchesInStageNodeAtProgressZero"
	args={{
		multigraphData: makeGraph({
			nodeCount: 1,
			pinned: [0],
			posByNodeId: { n0: { x: 0, y: 0 } }
		}),
		defaultPrimaryNodeId: 'n0',
		initialViewState: { panX: 0, panY: 0, scale: 0.95 },
		layoutSettings: { relaxIterations: 0 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);

		// Assert the surface at progress 0 lands exactly on the in-stage node's
		// derived on-screen rect (≤1px) — no seam in either handoff direction.
		const assertHandoff = () => {
			const layer = getFocusLayer(canvasElement);
			const morph = morphRectOf(layer);
			expect(morph.progress).toBe(0);
			const inStage = getCircle(canvasElement, 'n0');
			const nodeRect = inStage.getBoundingClientRect();
			expect(morph.x).toBeCloseTo(nodeRect.left, 0);
			expect(morph.y).toBeCloseTo(nodeRect.top, 0);
			expect(morph.width).toBeCloseTo(nodeRect.width, 0);
			expect(morph.height).toBeCloseTo(nodeRect.height, 0);
			// Border radius: at progress 0 the surface is a full circle like the node.
			expect(morph.radius).toBeCloseTo(nodeRect.width / 2, 0);
			// Border width: compare the node's VISUAL (transform-scaled) border to
			// the surface's derived border width.
			const localBorder = parseFloat(window.getComputedStyle(inStage).borderTopWidth);
			const visualScale = nodeRect.width / inStage.offsetWidth;
			expect(localBorder * visualScale).toBeCloseTo(morph.borderWidth, 0);
			// Title text must land close to where the in-stage node drew it — a
			// border-box vs. padding-box mismatch in the content layer's anchor
			// would otherwise shift it by ~borderWidth px (many px) down-right of
			// the node. A couple sub-pixel px of drift is expected: the in-stage
			// node composites via a `translate + scale` transform on `.node-wrapper`
			// while the surface composites via `left/top` + a separate `scale` on
			// the content layer — different transform chains round differently.
			const inStageTitle = inStage.querySelector('.title') as HTMLElement;
			const morphTitle = layer.querySelector('.title') as HTMLElement;
			const inStageTitleRect = inStageTitle.getBoundingClientRect();
			const morphTitleRect = morphTitle.getBoundingClientRect();
			const titleDriftPx = Math.hypot(
				morphTitleRect.left - inStageTitleRect.left,
				morphTitleRect.top - inStageTitleRect.top
			);
			expect(titleDriftPx).toBeLessThan(2);
		};

		// Direction A — mount on entry: scrub in a bit, then reverse to 0 (the
		// surface stays mounted through the idle window at progress 0).
		dispatchWheel(stage, -80, center.x, center.y);
		await waitFor(() => {
			expect(morphRectOf(getFocusLayer(canvasElement)).progress).toBeGreaterThan(0);
		});
		dispatchWheel(stage, 200, center.x, center.y);
		await waitFor(() => {
			expect(morphRectOf(getFocusLayer(canvasElement)).progress).toBe(0);
		});
		assertHandoff();

		// Let it unmount, then reset for the exit direction.
		await sleep(APP_CONFIG.multigraph.focus.entryGestureIdleMs + 40);
		await waitFor(() => {
			expect(canvasElement.querySelector('.deep-zoom-layer')).not.toBeInTheDocument();
		});

		// Direction B — unmount on exit: commit, then flick out. On the exit frame
		// morphProgress is 0 and the surface must again equal the in-stage rect.
		dispatchWheel(stage, -1000, center.x, center.y);
		await within(canvasElement).findByRole('dialog');
		const world = canvasElement.querySelector('.zoom-world') as HTMLElement;
		dispatchWheel(world, 6000, center.x, center.y);
		await waitFor(() => {
			expect(morphRectOf(getFocusLayer(canvasElement)).progress).toBe(0);
		});
		assertHandoff();
	}}
/>

<Story
	name="OneMorphSurfaceSpansEntryCommitExit"
	args={{
		multigraphData: makeGraph({
			nodeCount: 1,
			pinned: [0],
			posByNodeId: { n0: { x: 0, y: 0 } }
		}),
		defaultPrimaryNodeId: 'n0',
		initialViewState: { panX: 0, panY: 0, scale: 0.95 },
		layoutSettings: { relaxIterations: 0 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);

		// Entry scrub mounts one surface element.
		dispatchWheel(stage, -80, center.x, center.y);
		await waitFor(() => {
			const p = morphRectOf(getFocusLayer(canvasElement)).progress;
			expect(p).toBeGreaterThan(0);
			expect(p).toBeLessThan(1);
		});
		const surfaceEl = getFocusLayer(canvasElement);

		// Commit (bold flick): the SAME element reaches progress 1.
		dispatchWheel(stage, -1000, center.x, center.y);
		await waitFor(() => {
			expect(morphRectOf(getFocusLayer(canvasElement)).progress).toBe(1);
		});
		expect(getFocusLayer(canvasElement)).toBe(surfaceEl);
		expect(canvasElement.querySelector('.zoom-world')).toBeInTheDocument();

		// Exit scrub: still the SAME element, now morphing back down.
		const world = canvasElement.querySelector('.zoom-world') as HTMLElement;
		dispatchWheel(world, 70, center.x, center.y);
		await waitFor(() => {
			const p = morphRectOf(getFocusLayer(canvasElement)).progress;
			expect(p).toBeGreaterThan(0);
			expect(p).toBeLessThan(1);
		});
		expect(getFocusLayer(canvasElement)).toBe(surfaceEl);
	}}
/>

<Story
	name="AllCloseRoutesReachSameUnfocusedState"
	args={{
		multigraphData: makeGraph({
			nodeCount: 1,
			pinned: [0],
			posByNodeId: { n0: { x: 0, y: 0 } }
		}),
		defaultPrimaryNodeId: 'n0',
		initialViewState: { panX: 0, panY: 0, scale: APP_CONFIG.multigraph.zoom.maxScale },
		layoutSettings: { relaxIterations: 0 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);

		/** Commit focus via a bold in-zoom at max scale. */
		const commitFocusViaWheel = async () => {
			dispatchWheel(stage, -800, center.x, center.y);
			await within(canvasElement).findByRole('dialog');
			expect(canvasElement.querySelector('.graph')).toHaveClass('focus-active');
			expect(canvasElement.querySelector('.deep-zoom-layer')).toBeInTheDocument();
		};

		/** Assert the focus surface has fully unmounted and the graph is unfocused. */
		const assertUnfocused = async () => {
			await waitFor(() => {
				expect(canvasElement.querySelector('[role="dialog"]')).not.toBeInTheDocument();
				expect(canvasElement.querySelector('.deep-zoom-layer')).not.toBeInTheDocument();
			});
			expect(canvasElement.querySelector('.graph')).not.toHaveClass('focus-active');
		};

		// Route A: Escape key dispatched to window (mirrors the $effect keydown listener).
		await commitFocusViaWheel();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await assertUnfocused();

		// Route B: Close button (aria-label "Close node focus").
		await commitFocusViaWheel();
		within(canvasElement).getByRole('button', { name: 'Close node focus' }).click();
		await assertUnfocused();

		// Route C: Wheel-out completion (delta >= 1 triggers unified closeFocus).
		await commitFocusViaWheel();
		const world = canvasElement.querySelector('.zoom-world') as HTMLElement;
		dispatchWheel(world, 5000, center.x, center.y);
		await assertUnfocused();
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

		await dispatchLongPress(circle, center.x, center.y);

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
	name="AnEquationSavedInTheSheetSettlesTheRevealedNode"
	args={{
		multigraphData: DATAFLOW_CONTENT_COMMIT_CHAIN,
		defaultPrimaryNodeId: 'a',
		layoutSettings: TWO_LAYERS_SETTLING,
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		// Three authored hops out with two layers on show.
		expect(canvasElement.querySelector('[data-node-id="d"]')).not.toBeInTheDocument();

		await commitDescriptionThroughSheet(canvasElement, 'a', DEFINES_G, confirmSuggestedChips);

		// Confirming g links `a` to `d`, which brings `d` on screen at whatever
		// position it was last given. Without a settle it stays there frozen —
		// drawn at its new, much larger size on top of whatever it overlaps —
		// until the reader happens to drag something.
		expect(canvasElement.querySelector('[data-node-id="d"]')).toBeInTheDocument();
		expect(isSettling(canvasElement)).toBe(true);

		const revealedAt = nodePosition(canvasElement, 'd');
		await waitForFrames(5);
		expect(nodePosition(canvasElement, 'd')).not.toEqual(revealedAt);
	}}
/>

<Story
	name="RemovingAnEquationInTheSheetSettlesTheGraphToo"
	args={{
		multigraphData: withDesignations(
			{
				...DATAFLOW_CONTENT_COMMIT_CHAIN,
				nodes: DATAFLOW_CONTENT_COMMIT_CHAIN.nodes.map((node) =>
					node.id === 'a' ? { ...node, description: DEFINES_G } : node
				)
			},
			{ a: { outputs: ['g'] } }
		),
		defaultPrimaryNodeId: 'a',
		layoutSettings: TWO_LAYERS_SETTLING,
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		expect(canvasElement.querySelector('[data-node-id="d"]')).toBeInTheDocument();

		await commitDescriptionThroughSheet(canvasElement, 'a', 'No math here.', clearDesignationChips);

		// Taking the definition away — text and designation both, since the chip
		// would otherwise stand as stale and keep drawing its edge — drops `d` back
		// out of view, which leaves a hole in the layout the rest have to close.
		expect(canvasElement.querySelector('[data-node-id="d"]')).not.toBeInTheDocument();
		expect(isSettling(canvasElement)).toBe(true);
	}}
/>

<Story
	name="RenamingANodeSettlesCheaply"
	args={{
		multigraphData: makeGraph({
			nodes: [
				{ id: 'a', title: 'One', description: 'Just prose.' },
				{ id: 'b', title: 'Two', description: 'More prose.' }
			],
			pinned: ['a'],
			edges: [['a', 'b']],
			posByNodeId: { a: { x: -300, y: 0 }, b: { x: 300, y: 0 } }
		}),
		defaultPrimaryNodeId: 'a',
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const before = nodePosition(canvasElement, 'b');

		// The commit path is the same one an equation takes, so a rename kicks the
		// settle too. It has to cost nothing: the graph is already at rest, so the
		// first frame moves less than the settle epsilon and ends it.
		await commitDescriptionThroughSheet(canvasElement, 'a', 'Still just prose.');
		expect(isSettling(canvasElement)).toBe(true);

		await waitForFrames(3);
		expect(isSettling(canvasElement)).toBe(false);
		expect(nodePosition(canvasElement, 'b')).toEqual(before);
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
		await dispatchLongPress(circle, center.x, center.y);

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
		await dispatchLongPress(targetCircle, targetCenter.x, targetCenter.y);
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

		await dispatchLongPress(circle, center.x, center.y);

		const canvas = within(canvasElement);
		expect(canvas.getByRole('menuitem', { name: 'Add node/edge' })).toBeInTheDocument();
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

		await dispatchLongPress(circle, center.x, center.y);
		within(canvasElement).getByRole('menuitem', { name: 'Delete' }).click();
		await sleep();

		expect(canvasElement.querySelector('[data-node-id="n0"].node-wrapper')).not.toBeInTheDocument();
		expect(lastChangedGraph(args).nodes.map((node) => node.id)).toEqual(['n1']);
		expect(lastChangedGraph(args).edges).toEqual([]);
	}}
/>

<Story
	name="UserDeletesNodeOrphaningAComponent"
	args={{
		multigraphData: makeGraph({
			nodeCount: 5,
			pinned: [0],
			// Deleting n1 cuts n2..n4 off from the only pinned node, exactly as a
			// severing edge removal does, so the orphaned side must fade with the
			// reveal wave instead of popping. n4 sits outside the default three
			// displayed layers; it is here so edge e3 has two newly hidden ends.
			edges: [
				[0, 1],
				[1, 2],
				[2, 3],
				[3, 4]
			],
			posByNodeId: {
				n0: { x: -400, y: 0 },
				n1: { x: -200, y: 0 },
				n2: { x: 0, y: 0 },
				n3: { x: 200, y: 0 },
				n4: { x: 400, y: 0 }
			}
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: {
			relaxIterations: 0,
			enterExitDurationMs: 120,
			scaleAnimationDurationMs: 200,
			postScaleChangeSettleMaxFrames: 0
		},
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		const circle = getCircle(canvasElement, 'n1');
		const center = getCenter(circle);

		await dispatchLongPress(circle, center.x, center.y);
		within(canvasElement).getByRole('menuitem', { name: 'Delete' }).click();
		await waitForFrames(2);

		expect(lastChangedGraph(args).nodes.map((node) => node.id)).toEqual(['n0', 'n2', 'n3', 'n4']);

		// n3 drops out of the visible set and fades with the wave, as does the edge
		// between the two newly hidden nodes.
		expect(getNodeWrapper(canvasElement, 'n3').dataset.nodeRevealBuffer).toBe('true');
		const wavingEdges = canvasElement.querySelectorAll('[data-edge-id="e3"]');
		expect(wavingEdges).toHaveLength(1);
		expect((wavingEdges[0] as HTMLElement).dataset.edgeRevealBuffer).toBe('true');

		// The deleted node keeps the exiting-buffer fade (the wave has no geometry
		// for it), and is drawn exactly once.
		const deletedNodes = canvasElement.querySelectorAll('[data-node-id="n1"].node-wrapper');
		expect(deletedNodes).toHaveLength(1);
		expect((deletedNodes[0] as HTMLElement).dataset.nodeExiting).toBe('true');
		expect((deletedNodes[0] as HTMLElement).dataset.nodeRevealBuffer).toBeUndefined();

		// After the wave, only the pinned node and the orphaned component's beacon
		// remain on screen.
		await waitFor(() => {
			expect(
				canvasElement.querySelector('[data-node-id="n3"].node-wrapper')
			).not.toBeInTheDocument();
		});
		expect(canvasElement.querySelector('[data-node-id="n1"].node-wrapper')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('[data-edge-id="e3"]')).not.toBeInTheDocument();
		expect(getNodeWrapper(canvasElement, 'n2')).toBeInTheDocument();
		expect(canvasElement.querySelector('[data-node-id="n2"] .node')).not.toHaveAttribute(
			'data-pinned'
		);
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

		await dispatchLongPress(stage, tinyCenter.x + tinyRadius + 4, tinyCenter.y);

		expect(within(canvasElement).getByRole('menuitem', { name: 'Pin' })).toBeInTheDocument();
		dispatchPointer(stage, 'pointerup', tinyCenter.x + tinyRadius + 4, tinyCenter.y);
	}}
/>

<Story
	name="UserRightClicksNodeForActions"
	args={{
		multigraphData: makeGraph({ nodeCount: 1 }),
		defaultPrimaryNodeId: 'n0'
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);

		const event = dispatchContextMenu(circle, center.x, center.y);
		await sleep();

		expect(event.defaultPrevented).toBe(true);
		const canvas = within(canvasElement);
		expect(canvas.getByRole('menuitem', { name: 'Add node/edge' })).toBeInTheDocument();
		expect(canvas.getByRole('menuitem', { name: 'Pin' })).toBeInTheDocument();
		expect(canvas.getByRole('menuitem', { name: 'Focus' })).toBeInTheDocument();
		expect(canvas.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
		expect(canvas.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
	}}
/>

<Story
	name="UserGetsFocusOnFirstActionMenuItem"
	args={{
		multigraphData: makeGraph({ nodeCount: 1 }),
		defaultPrimaryNodeId: 'n0'
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);

		dispatchContextMenu(circle, center.x, center.y);
		await tick();

		const firstItem = within(canvasElement).getByRole('menuitem', { name: 'Add node/edge' });
		expect(document.activeElement).toBe(firstItem);
		// Roving tabindex: only the active item is a tab stop.
		expect(firstItem).toHaveAttribute('tabindex', '0');
		expect(within(canvasElement).getByRole('menuitem', { name: 'Delete' })).toHaveAttribute(
			'tabindex',
			'-1'
		);
	}}
/>

<Story
	name="UserClosesActionMenuWithEscape"
	args={{
		multigraphData: makeGraph({ nodeCount: 1 }),
		defaultPrimaryNodeId: 'n0'
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);

		dispatchContextMenu(circle, center.x, center.y);
		await tick();
		expect(within(canvasElement).getByRole('menu')).toBeInTheDocument();

		// Dispatched on whatever has focus, which is why the menu must have taken it.
		dispatchKeydown(document.activeElement, 'Escape');
		await tick();

		expect(within(canvasElement).queryByRole('menu')).not.toBeInTheDocument();
		expect(within(canvasElement).queryByRole('menuitem')).not.toBeInTheDocument();
	}}
/>

<Story
	name="UserMovesActionMenuFocusWithArrowKeys"
	args={{
		multigraphData: makeGraph({ nodeCount: 1 }),
		defaultPrimaryNodeId: 'n0'
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);

		dispatchContextMenu(circle, center.x, center.y);
		await tick();
		expect(activeElementText()).toBe('Add node/edge');

		dispatchKeydown(document.activeElement, 'ArrowRight');
		expect(activeElementText()).toBe('Pin');
		dispatchKeydown(document.activeElement, 'ArrowDown');
		expect(activeElementText()).toBe('Focus');
		dispatchKeydown(document.activeElement, 'ArrowLeft');
		expect(activeElementText()).toBe('Pin');
		dispatchKeydown(document.activeElement, 'ArrowUp');
		expect(activeElementText()).toBe('Add node/edge');

		// Wraps backwards off the first item onto the last, and forwards back round.
		dispatchKeydown(document.activeElement, 'ArrowLeft');
		expect(activeElementText()).toBe('Delete');
		dispatchKeydown(document.activeElement, 'ArrowRight');
		expect(activeElementText()).toBe('Add node/edge');

		dispatchKeydown(document.activeElement, 'End');
		expect(activeElementText()).toBe('Delete');
		dispatchKeydown(document.activeElement, 'Home');
		expect(activeElementText()).toBe('Add node/edge');

		await tick();
		expect(within(canvasElement).getByRole('menuitem', { name: 'Delete' })).toHaveAttribute(
			'tabindex',
			'-1'
		);
	}}
/>

<Story
	name="UserRestoresFocusWhenActionMenuCloses"
	args={{
		multigraphData: makeGraph({ nodeCount: 1 }),
		defaultPrimaryNodeId: 'n0'
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const toolbarButton = within(canvasElement).getByRole('button', { name: 'Tag colors' });
		toolbarButton.focus();
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);

		dispatchContextMenu(circle, center.x, center.y);
		await tick();
		expect(document.activeElement).not.toBe(toolbarButton);

		dispatchKeydown(document.activeElement, 'Escape');
		await tick();

		expect(document.activeElement).toBe(toolbarButton);
	}}
/>

<Story
	name="UserRightClicksElsewhereWhileActionMenuIsOpen"
	args={{
		multigraphData: makeGraph({
			nodeCount: 2,
			pinned: [0, 1],
			edges: [[0, 1]],
			// Stacked vertically so n0's pill (which floats above n0) never covers n1.
			posByNodeId: {
				n0: { x: 0, y: 140 },
				n1: { x: 0, y: -140 }
			}
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { relaxIterations: 0 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const stageRect = stage.getBoundingClientRect();
		const sourceCenter = getCenter(getCircle(canvasElement, 'n0'));
		const targetCenter = getCenter(getCircle(canvasElement, 'n1'));

		dispatchContextMenu(getCircle(canvasElement, 'n0'), sourceCenter.x, sourceCenter.y);
		await tick();
		expect(within(canvasElement).getByRole('menu')).toHaveAttribute(
			'aria-label',
			'Actions for Node 0'
		);

		// The menu overlay swallows this right-click: it must not leak the native
		// menu, and must not leave the menu stranded on n0 either.
		const overNode = dispatchContextMenuAt(targetCenter.x, targetCenter.y);
		await tick();
		expect(overNode.defaultPrevented).toBe(true);
		expect(within(canvasElement).getByRole('menu')).toHaveAttribute(
			'aria-label',
			'Actions for Node 1'
		);
		expect(activeElementText()).toBe('Add node/edge');

		// Right-clicking empty background closes instead of re-targeting.
		const overBackground = dispatchContextMenuAt(stageRect.right - 8, stageRect.bottom - 8);
		await tick();
		expect(overBackground.defaultPrevented).toBe(true);
		expect(within(canvasElement).queryByRole('menu')).not.toBeInTheDocument();
	}}
/>

<Story
	name="UserMouseLongPressDoesNotOpenMenu"
	args={{
		multigraphData: makeGraph({ nodeCount: 1 }),
		defaultPrimaryNodeId: 'n0'
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);

		dispatchPointer(circle, 'pointerdown', center.x, center.y, 1, 'mouse');
		await sleep(LONG_PRESS_MS + 20);

		expect(within(canvasElement).queryByRole('menuitem')).not.toBeInTheDocument();
		dispatchPointer(circle, 'pointerup', center.x, center.y, 1, 'mouse');
	}}
/>

<Story
	name="UserAddsNodeViaMenuGesture"
	args={{
		multigraphData: makeGraph({ nodeCount: 1, pinned: [0] }),
		defaultPrimaryNodeId: 'n0',
		initialViewState: { panX: 0, panY: 0, scale: 0.5 },
		layoutSettings: { enterExitDurationMs: 0, relaxIterations: 1 },
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const stageRect = stage.getBoundingClientRect();
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);
		const bgX = stageRect.right - 20;
		const bgY = stageRect.top + stageRect.height / 2;

		dispatchContextMenu(circle, center.x, center.y);
		await sleep();
		within(canvasElement).getByRole('menuitem', { name: 'Add node/edge' }).click();
		await sleep();
		expect(within(canvasElement).queryByRole('menuitem')).not.toBeInTheDocument();

		// Hovering the background shows the preview node and edge (durations are 0).
		dispatchPointer(stage, 'pointermove', bgX, bgY);
		await sleep();
		expect(canvasElement.querySelector('[data-creation-preview-node]')).toBeInTheDocument();
		expect(canvasElement.querySelector('[data-creation-preview-edge]')).toBeInTheDocument();

		// The next click commits the new node + edge and opens the inline title editor.
		dispatchPointer(stage, 'pointerdown', bgX, bgY);
		dispatchPointer(stage, 'pointerup', bgX, bgY);
		await sleep();
		await waitForLayout();

		expect(canvasElement.querySelector('[data-creation-preview-node]')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('[data-creation-preview-edge]')).not.toBeInTheDocument();
		const changedGraph = lastChangedGraph(args);
		expect(changedGraph.nodes.map((node) => node.id)).toEqual(['n0', 'n1']);
		expect(changedGraph.nodes[1].title).toBe('New Node');
		expect(changedGraph.edges).toHaveLength(1);
		expect(changedGraph.edges[0]).toMatchObject({ sourceNodeId: 'n0', targetNodeId: 'n1' });
		expect(canvasElement.querySelector('.title-input')).toBeInTheDocument();
	}}
/>

<Story
	name="UserAddsEdgeViaMenuGesture"
	args={{
		multigraphData: makeGraph({
			nodeCount: 3,
			pinned: [0],
			edges: [
				[0, 1],
				[1, 2]
			],
			posByNodeId: {
				n0: { x: -160, y: 0 },
				n1: { x: 0, y: 0 },
				n2: { x: 160, y: 0 }
			}
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { enterExitDurationMs: 0, relaxIterations: 1 },
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const sourceCircle = getCircle(canvasElement, 'n0');
		const sourceCenter = getCenter(sourceCircle);
		const targetCircle = getCircle(canvasElement, 'n2');
		const targetCenter = getCenter(targetCircle);

		dispatchContextMenu(sourceCircle, sourceCenter.x, sourceCenter.y);
		await sleep();
		within(canvasElement).getByRole('menuitem', { name: 'Add node/edge' }).click();
		await sleep();

		// Hovering an existing node hides the preview node but keeps the preview edge.
		dispatchPointer(stage, 'pointermove', targetCenter.x, targetCenter.y);
		await sleep();
		expect(canvasElement.querySelector('[data-creation-preview-node]')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('[data-creation-preview-edge]')).toBeInTheDocument();

		dispatchPointer(stage, 'pointerdown', targetCenter.x, targetCenter.y);
		dispatchPointer(stage, 'pointerup', targetCenter.x, targetCenter.y);
		await sleep();

		expect(canvasElement.querySelector('[data-creation-preview-edge]')).not.toBeInTheDocument();
		const changedGraph = lastChangedGraph(args);
		expect(changedGraph.nodes).toHaveLength(3);
		expect(changedGraph.edges).toHaveLength(3);
		expect(changedGraph.edges[2]).toMatchObject({ sourceNodeId: 'n0', targetNodeId: 'n2' });
	}}
/>

<Story
	name="UserClicksChromeWhileMenuGestureArmed"
	args={{
		multigraphData: makeGraph({ nodeCount: 1, pinned: [0] }),
		defaultPrimaryNodeId: 'n0',
		initialViewState: { panX: 0, panY: 0, scale: 0.5 },
		layoutSettings: { enterExitDurationMs: 0, relaxIterations: 1 },
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const stageRect = stage.getBoundingClientRect();
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);
		const bgX = stageRect.right - 20;
		const bgY = stageRect.top + stageRect.height / 2;

		dispatchContextMenu(circle, center.x, center.y);
		await sleep();
		within(canvasElement).getByRole('menuitem', { name: 'Add node/edge' }).click();
		await sleep();
		dispatchPointer(stage, 'pointermove', bgX, bgY);
		await sleep();
		expect(canvasElement.querySelector('[data-creation-preview-node]')).toBeInTheDocument();

		// Pressing app chrome outside the stage disarms the gesture and drops the preview.
		const toolbarButton = canvasElement.querySelector('.tag-color-button') as HTMLElement;
		const toolbarCenter = getCenter(toolbarButton);
		dispatchPointer(toolbarButton, 'pointerdown', toolbarCenter.x, toolbarCenter.y);
		dispatchPointer(toolbarButton, 'pointerup', toolbarCenter.x, toolbarCenter.y);
		toolbarButton.click();
		await sleep();
		await waitForLayout();
		expect(canvasElement.querySelector('[data-creation-preview-node]')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('[data-creation-preview-edge]')).not.toBeInTheDocument();

		// The next canvas click pans instead of silently creating a node.
		dispatchPointer(stage, 'pointerdown', bgX, bgY);
		dispatchPointer(stage, 'pointerup', bgX, bgY);
		await sleep();
		expect(canvasElement.querySelector('[data-node-id="n1"]')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('.title-input')).not.toBeInTheDocument();
		const changeSpy = args.onMultigraphChange as ChangeSpy | undefined;
		expect(changeSpy?.mock.calls).toHaveLength(0);
	}}
/>

<Story
	name="UserSeesNoEdgeSnapOnCreationHandoff"
	args={{
		multigraphData: makeGraph({ nodeCount: 1, pinned: [0] }),
		defaultPrimaryNodeId: 'n0',
		// Zoomed out far enough that the drop point clears both node radii, so the
		// trimmed edge has real length to compare.
		initialViewState: { panX: 0, panY: 0, scale: 0.25 },
		layoutSettings: { enterExitDurationMs: 0, relaxIterations: 1 },
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const stageRect = stage.getBoundingClientRect();
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);
		const bgX = stageRect.right - 20;
		const bgY = stageRect.top + stageRect.height / 2;

		dispatchContextMenu(circle, center.x, center.y);
		await sleep();
		within(canvasElement).getByRole('menuitem', { name: 'Add node/edge' }).click();
		await sleep();
		dispatchPointer(stage, 'pointermove', bgX, bgY);
		await sleep();

		const previewEdge = canvasElement.querySelector(
			'[data-creation-preview-edge]'
		) as HTMLElement | null;
		expect(previewEdge).toBeInTheDocument();
		const previewEdgeWidth = Number.parseFloat(previewEdge!.style.width);
		const previewNode = canvasElement.querySelector(
			'[data-creation-preview-node]'
		) as HTMLElement | null;
		const centerToCenter = distanceBetween(nodePosition(canvasElement, 'n0'), {
			x: Number(previewNode!.dataset.x),
			y: Number(previewNode!.dataset.y)
		});
		// The preview edge is trimmed to both node borders, not drawn center to center.
		expect(previewEdgeWidth).toBeCloseTo(centerToCenter - 2 * NODE_RADIUS, 1);

		dispatchPointer(stage, 'pointerdown', bgX, bgY);
		dispatchPointer(stage, 'pointerup', bgX, bgY);
		await sleep();
		await waitForLayout();

		const realEdge = canvasElement.querySelector(
			'[data-source-node-id="n0"][data-target-node-id="n1"]'
		) as HTMLElement | null;
		expect(realEdge).toBeInTheDocument();
		// Handoff happens at the preview's settled scale, so the committed edge has
		// the same geometry: no visible snap.
		expect(Number.parseFloat(realEdge!.style.width)).toBeCloseTo(previewEdgeWidth, 1);
	}}
/>

<Story
	name="UserCancelsMenuGestureWithEscape"
	args={{
		multigraphData: makeGraph({ nodeCount: 1, pinned: [0] }),
		defaultPrimaryNodeId: 'n0',
		initialViewState: { panX: 0, panY: 0, scale: 0.5 },
		layoutSettings: { enterExitDurationMs: 0, relaxIterations: 1 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const stageRect = stage.getBoundingClientRect();
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);
		const bgX = stageRect.right - 20;
		const bgY = stageRect.top + stageRect.height / 2;

		dispatchContextMenu(circle, center.x, center.y);
		await sleep();
		within(canvasElement).getByRole('menuitem', { name: 'Add node/edge' }).click();
		await sleep();

		dispatchPointer(stage, 'pointermove', bgX, bgY);
		await sleep();
		expect(canvasElement.querySelector('[data-creation-preview-node]')).toBeInTheDocument();

		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await sleep();

		expect(canvasElement.querySelector('[data-creation-preview-node]')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('[data-creation-preview-edge]')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('[data-node-id="n1"]')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('.title-input')).not.toBeInTheDocument();
	}}
/>

<Story
	name="UserSeesPreviewDuringDoubleClickDrag"
	args={{
		multigraphData: makeGraph({ nodeCount: 1, pinned: [0] }),
		defaultPrimaryNodeId: 'n0',
		initialViewState: { panX: 0, panY: 0, scale: 0.5 },
		layoutSettings: { enterExitDurationMs: 0, relaxIterations: 1 },
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const stageRect = stage.getBoundingClientRect();
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);
		const bgX = stageRect.right - 20;
		const bgY = stageRect.top + stageRect.height / 2;

		dispatchPointer(circle, 'pointerdown', center.x, center.y);
		dispatchPointer(circle, 'pointerup', center.x, center.y);
		await sleep(DBL_CLICK_MS * 0.1);
		dispatchPointer(circle, 'pointerdown', center.x, center.y);
		dispatchPointer(stage, 'pointermove', bgX, bgY);
		await sleep();

		expect(canvasElement.querySelector('[data-creation-preview-node]')).toBeInTheDocument();
		expect(canvasElement.querySelector('[data-creation-preview-edge]')).toBeInTheDocument();

		dispatchPointer(stage, 'pointerup', bgX, bgY);
		await sleep();
		await waitForLayout();

		expect(canvasElement.querySelector('[data-creation-preview-node]')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('[data-creation-preview-edge]')).not.toBeInTheDocument();
		expect(lastChangedGraph(args).nodes.map((node) => node.id)).toEqual(['n0', 'n1']);
	}}
/>

<Story
	name="UserSelfDropCancelsCreation"
	args={{
		multigraphData: makeGraph({ nodeCount: 1, pinned: [0] }),
		defaultPrimaryNodeId: 'n0',
		initialViewState: { panX: 0, panY: 0, scale: 0.5 },
		layoutSettings: { enterExitDurationMs: 0, relaxIterations: 1 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);

		await dispatchDoubleClickDrag(
			circle,
			center.x,
			center.y,
			circle,
			center.x + DRAG_THRESHOLD * 2,
			center.y + DRAG_THRESHOLD * 2
		);
		await sleep();

		expect(canvasElement.querySelector('[data-node-id="n1"]')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('.title-input')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('[data-creation-preview-node]')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('[data-creation-preview-edge]')).not.toBeInTheDocument();
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
			pinHistory: { 0: 1 },
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
			nodeCount: 4,
			pinned: [0],
			edges: [
				[0, 1],
				[1, 2],
				[2, 3]
			],
			posByNodeId: {
				n0: { x: -420, y: 0 },
				n1: { x: -140, y: 0 },
				n2: { x: 140, y: 0 },
				n3: { x: 420, y: 0 }
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
		const circle = getCircle(canvasElement, 'n3');
		const center = getCenter(circle);

		await dispatchDoubleClick(circle, center.x, center.y);
		await waitForFrames(2);

		const animatedPinnedScale = Number(getNodeWrapper(canvasElement, 'n3').dataset.scale);
		const animatedNeighborScale = Number(getNodeWrapper(canvasElement, 'n2').dataset.scale);
		expect(animatedPinnedScale).toBeGreaterThan(0.2);
		expect(animatedPinnedScale).toBeLessThan(1);
		expect(animatedNeighborScale).toBeGreaterThan(0.25);
		expect(animatedNeighborScale).toBeLessThan(0.5);

		await sleep(140);
		await waitForLayout();

		expect(Number(getNodeWrapper(canvasElement, 'n3').dataset.scale)).toBe(1);
		expect(Number(getNodeWrapper(canvasElement, 'n2').dataset.scale)).toBe(0.5);
		expect(Number(getNodeWrapper(canvasElement, 'n1').dataset.scale)).toBe(0.5);
		expect(Number(getNodeWrapper(canvasElement, 'n0').dataset.scale)).toBe(1);
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
		const pinnedCenter = getCenter(circle);

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
			expect(canvasElement.querySelector('.graph')).not.toHaveAttribute('data-scale-change-focal');
		});

		// The component collapses to its beacon: n0 (last pin interaction) stays
		// visible at hop-1 scale, the neighbor hides, and the edge fades out as
		// a boundary half-edge.
		expect(canvasElement.querySelector('[data-node-id="n1"].node-wrapper')).not.toBeInTheDocument();
		expect(Number(getNodeWrapper(canvasElement, 'n0').dataset.scale)).toBe(0.5);
		expect(canvasElement.querySelector('[data-edge-id="e0"]')).toHaveAttribute(
			'data-edge-visibility',
			'boundary'
		);
		const restingCenter = getCenter(getCircle(canvasElement, 'n0'));
		expect(restingCenter.x).toBeCloseTo(pinnedCenter.x);
		expect(restingCenter.y).toBeCloseTo(pinnedCenter.y);
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
			pinned: [0],
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
			pinned: [1],
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
	name="ReleasedDragSettlesWithoutRigidDrift"
	args={{
		multigraphData: makeGraph({
			nodeCount: 4,
			pinned: [2],
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
		expect(distanceBetween(settlingStartCentroid, settledCentroid)).toBeLessThan(12);

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
			pinned: [0],
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
	name="DisconnectedComponentShowsBeacon"
	args={{
		multigraphData: makeGraph({
			nodeCount: 5,
			pinned: [0],
			edges: [
				[0, 1],
				[2, 3],
				[3, 4]
			],
			pinHistory: { 3: 2 },
			posByNodeId: {
				n0: { x: -480, y: 0 },
				n1: { x: -160, y: 0 },
				n2: { x: 240, y: 0 },
				n3: { x: 480, y: 0 },
				n4: { x: 720, y: 0 }
			}
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: {
			displayedLayers: 3,
			scaleFalloff: 0.7,
			minScale: 0.1,
			relaxIterations: 1
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();

		// The pinned component renders normally.
		expect(canvasElement.querySelector('[data-node-id="n0"].node-wrapper')).toBeInTheDocument();
		expect(canvasElement.querySelector('[data-node-id="n1"].node-wrapper')).toBeInTheDocument();
		// The pinless component collapses to its beacon: the most recently pinned node.
		expect(canvasElement.querySelector('[data-node-id="n2"].node-wrapper')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('[data-node-id="n4"].node-wrapper')).not.toBeInTheDocument();
		const beacon = getNodeWrapper(canvasElement, 'n3');
		expect(Number(beacon.dataset.scale)).toBeCloseTo(0.7);
		expect(canvasElement.querySelector('[data-node-id="n3"] .node')).not.toHaveAttribute(
			'data-pinned'
		);
		// Every beacon edge renders as a fading boundary half-edge.
		expect(canvasElement.querySelector('[data-edge-id="e1"]')).toHaveAttribute(
			'data-edge-visibility',
			'boundary'
		);
		expect(canvasElement.querySelector('[data-edge-id="e2"]')).toHaveAttribute(
			'data-edge-visibility',
			'boundary'
		);

		// Pinning the beacon through the normal gesture brings its component back.
		const beaconCircle = getCircle(canvasElement, 'n3');
		const center = getCenter(beaconCircle);
		await dispatchDoubleClick(beaconCircle, center.x, center.y);
		await sleep();
		await waitForLayout();

		expect(canvasElement.querySelector('[data-node-id="n3"] .node')).toHaveAttribute(
			'data-pinned',
			'true'
		);
		expect(canvasElement.querySelector('[data-node-id="n2"].node-wrapper')).toBeInTheDocument();
		expect(canvasElement.querySelector('[data-node-id="n4"].node-wrapper')).toBeInTheDocument();
	}}
/>

<Story
	name="AllUnpinnedGraphShowsOneBeaconPerComponent"
	args={{
		multigraphData: makeGraph({
			nodeCount: 5,
			edges: [
				[0, 1],
				[1, 2],
				[3, 4]
			],
			pinHistory: { 1: 4 },
			posByNodeId: {
				n0: { x: -480, y: 0 },
				n1: { x: -240, y: 0 },
				n2: { x: 0, y: 0 },
				n3: { x: 360, y: 0 },
				n4: { x: 600, y: 0 }
			}
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: {
			displayedLayers: 3,
			scaleFalloff: 0.7,
			minScale: 0.1,
			relaxIterations: 1
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();

		// One beacon per pinless component: n1 by pin history, n3 by the
		// deterministic fallback (equal degree, lowest node id).
		expect(canvasElement.querySelectorAll('.node-wrapper')).toHaveLength(2);
		const historyBeacon = getNodeWrapper(canvasElement, 'n1');
		const fallbackBeacon = getNodeWrapper(canvasElement, 'n3');
		expect(Number(historyBeacon.dataset.scale)).toBeCloseTo(0.7);
		expect(Number(fallbackBeacon.dataset.scale)).toBeCloseTo(0.7);
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
			pinHistory: { 2: 1 },
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
		layoutSettings: {
			relaxIterations: 1,
			edgeSpringStrength: 1,
			enterExitDurationMs: 0,
			scaleAnimationDurationMs: 120,
			postScaleChangeSettleMaxFrames: 0
		},
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
		expect(lastChangedGraph(args).edges).toEqual([]);

		// The removal severed n1 from the pinned side, so the reveal wave plays:
		// the removed edge keeps rendering while it fades out with the wave.
		const wavingEdge = canvasElement.querySelector('[data-edge-id="e0"]') as HTMLElement | null;
		expect(wavingEdge).toBeInTheDocument();
		expect(wavingEdge!.dataset.edgeRevealBuffer).toBe('true');

		// After the wave, the edge is gone but n1 survives as its component's
		// beacon: unpinned-neighbor size, no pinned styling.
		await waitFor(() => {
			expect(canvasElement.querySelector('[data-edge-id="e0"]')).not.toBeInTheDocument();
		});
		const beacon = getNodeWrapper(canvasElement, 'n1');
		expect(Number(beacon.dataset.scale)).toBeCloseTo(0.7);
		expect(canvasElement.querySelector('[data-node-id="n1"] .node')).not.toHaveAttribute(
			'data-pinned'
		);
		expect(Number(getNodeWrapper(canvasElement, 'n0').dataset.scale)).toBe(1);
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

		titleInput!.value = '>#abc @rel The displayed title';
		titleInput!.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
		);
		await sleep();

		expect(canvasElement.querySelector('.title-input')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('[data-node-id="n1"] .node')).not.toHaveAttribute(
			'data-pinned'
		);
		expect(canvasElement).toHaveTextContent('The displayed title');
		expect(canvasElement).not.toHaveTextContent('>#abc @rel');
		const changedGraph = lastChangedGraph(args);
		expect(changedGraph.nodes.find((node) => node.id === 'n1')).toMatchObject({
			title: 'The displayed title',
			tags: ['abc'],
			pinned: false
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
	name="UserAuthorsAMathTitleInlineAlongsideATag"
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
		const bgX = stageRect.right - 20;
		const bgY = stageRect.top + stageRect.height / 2;

		await dispatchDoubleClickDrag(sourceCircle, sourceCenter.x, sourceCenter.y, stage, bgX, bgY);
		await sleep();
		await waitForLayout();

		const titleInput = canvasElement.querySelector('.title-input') as HTMLInputElement | null;
		expect(titleInput).toBeInTheDocument();

		// Tag syntax and math share one line. `$` is not a tag marker and `#` is not
		// a math delimiter, but the two parsers running over the same string is
		// exactly where an interaction would hide.
		titleInput!.value = '#kinematics $v = a t$';
		titleInput!.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
		);
		await sleep();

		expect(canvasElement.querySelector('.title-input')).not.toBeInTheDocument();

		// Stored as source, so the author gets back what they typed on the next edit.
		const changedGraph = lastChangedGraph(args);
		expect(changedGraph.nodes.find((node) => node.id === 'n1')).toMatchObject({
			title: '$v = a t$',
			tags: ['kinematics']
		});

		// Displayed as math. Seeing the delimiters would mean the commit path
		// bypassed the renderer.
		const newTitle = canvasElement.querySelector('[data-node-id="n1"] .title') as HTMLElement;
		await waitFor(() => {
			expect(newTitle.querySelector('math')).not.toBeNull();
		});
		expect(newTitle.textContent).not.toContain('$');
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
		layoutSettings: { relaxIterations: 1 },
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
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
		expect(canvasElement.querySelector('[data-node-id="n1"] .node')).not.toHaveAttribute(
			'data-pinned'
		);
		expect(canvasElement).toHaveTextContent('New Node');
		expect(lastChangedGraph(args).nodes.find((node) => node.id === 'n1')?.pinned).toBe(false);
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
			pinned: ['n2'],
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
	name="ToolbarButtonsShareVisualStyle"
	args={{
		multigraphData: makeGraph({
			nodes: [{ id: 'n0', title: 'Topic', description: '', tags: [] }]
		}),
		defaultPrimaryNodeId: 'n0'
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const canvas = within(canvasElement);
		const tagColorButton = canvas.getByRole('button', { name: 'Tag colors' });
		const graphQueryButton = canvas.getByRole('button', { name: 'Find / Filter' });

		const tagColorStyle = getComputedStyle(tagColorButton);
		const graphQueryStyle = getComputedStyle(graphQueryButton);
		expect(tagColorStyle.backgroundColor).toBe(graphQueryStyle.backgroundColor);
		expect(tagColorStyle.color).toBe(graphQueryStyle.color);
		expect(tagColorStyle.borderRadius).toBe(graphQueryStyle.borderRadius);
		expect(tagColorStyle.padding).toBe(graphQueryStyle.padding);
	}}
/>

<Story
	name="UserClosesGraphQueryPanelFromToolbarButton"
	args={{
		multigraphData: makeGraph({
			nodes: [{ id: 'n0', title: 'Topic', description: '', tags: [] }]
		}),
		defaultPrimaryNodeId: 'n0'
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const canvas = within(canvasElement);
		const graphQueryButton = canvas.getByRole('button', { name: 'Find / Filter' });

		graphQueryButton.click();
		await sleep();
		expect(canvas.getByLabelText('Graph query')).toBeInTheDocument();
		expect(graphQueryButton).toHaveAttribute('aria-expanded', 'true');

		graphQueryButton.click();
		await sleep();
		expect(canvas.queryByLabelText('Graph query')).not.toBeInTheDocument();
		expect(graphQueryButton).toHaveAttribute('aria-expanded', 'false');
	}}
/>

<Story
	name="UserFiltersGraphByNodeTag"
	args={{
		multigraphData: makeGraph({
			nodes: [
				{ id: 'n0', title: 'Topic', description: '', tags: ['topic'] },
				{ id: 'n1', title: 'Urgent', description: '', tags: ['urgent', 'topic'] },
				{ id: 'n2', title: 'Plain', description: '', tags: [] }
			],
			pinned: ['n1'],
			edges: [
				{ source: 'n0', target: 'n1', tags: ['rel'] },
				{ source: 'n1', target: 'n2', tags: [] }
			],
			posByNodeId: { n0: { x: -220, y: 0 }, n1: { x: 0, y: 0 }, n2: { x: 220, y: 0 } },
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
		const canvas = within(canvasElement);
		canvas.getByRole('button', { name: 'Find / Filter' }).click();
		await sleep();

		const input = canvas.getByLabelText('Graph query') as HTMLInputElement;
		input.value = '#topic';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await sleep();

		expect(getNodeWrapper(canvasElement, 'n0')).toHaveAttribute('data-query-role', 'focus');
		expect(getNodeWrapper(canvasElement, 'n1')).toHaveAttribute('data-query-role', 'focus');
		expect(getNodeWrapper(canvasElement, 'n2')).toHaveAttribute('data-query-role', 'background');
		expect(nodeOpacity(canvasElement, 'n2')).toBeLessThan(1);
	}}
/>

<Story
	name="UserSpotlightsNodeTagWithMatchedColor"
	args={{
		multigraphData: makeGraph({
			nodes: [{ id: 'n0', title: 'Mixed', description: '', tags: ['topic', 'urgent'] }],
			tagColorConfig: { nodeTags: { topic: '#ff0000', urgent: '#00ff00' }, edgeTags: {} }
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { relaxIterations: 0 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const canvas = within(canvasElement);
		canvas.getByRole('button', { name: 'Find / Filter' }).click();
		await sleep();

		const input = canvas.getByLabelText('Graph query') as HTMLInputElement;
		input.value = '+#urgent';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await sleep();

		expect(getNodeWrapper(canvasElement, 'n0')).toHaveAttribute('data-query-role', 'spotlight');
		const node = canvasElement.querySelector('[data-node-id="n0"] .node') as HTMLElement;
		expect(node).toHaveAttribute('data-tag-border', 'true');
		expect(node).toHaveAttribute('data-spotlight', 'true');
		expect(node.style.getPropertyValue('--node-spotlight-color').trim()).toBe('#00ff00');
	}}
/>

<Story
	name="UserSpotlightsEdgeTagWithMatchedColor"
	args={{
		multigraphData: makeGraph({
			nodes: [
				{ id: 'n0', title: 'Source', description: '', tags: [] },
				{ id: 'n1', title: 'Target', description: '', tags: [] }
			],
			pinned: ['n0'],
			edges: [{ source: 'n0', target: 'n1', tags: ['link', 'edgy'] }],
			posByNodeId: { n0: { x: -180, y: 0 }, n1: { x: 180, y: 0 } },
			tagColorConfig: { nodeTags: {}, edgeTags: { link: '#0000ff', edgy: '#ff0000' } }
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { relaxIterations: 0 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const canvas = within(canvasElement);
		canvas.getByRole('button', { name: 'Find / Filter' }).click();
		await sleep();

		const input = canvas.getByLabelText('Graph query') as HTMLInputElement;
		input.value = '+@edgy';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await sleep();

		const edge = getEdge(canvasElement, 'e0');
		expect(edge).toHaveAttribute('data-query-role', 'spotlight');
		expect(edge.style.getPropertyValue('--edge-background').trim()).toBe('#ff0000');
		expect(edge.style.getPropertyValue('--edge-spotlight-color').trim()).toBe('#ff0000');
		expect(getNodeWrapper(canvasElement, 'n0')).toHaveAttribute('data-query-role', 'context');
		expect(getNodeWrapper(canvasElement, 'n1')).toHaveAttribute('data-query-role', 'context');
	}}
/>

<Story
	name="UserExcludesNodeTagWithoutRelayout"
	args={{
		multigraphData: makeGraph({
			nodes: [
				{ id: 'n0', title: 'Keep', description: '', tags: ['keep'] },
				{ id: 'n1', title: 'Hide', description: '', tags: ['hide'] },
				{ id: 'n2', title: 'Other', description: '', tags: [] }
			],
			pinned: ['n0', 'n2'],
			edges: [
				{ source: 'n0', target: 'n1', tags: ['rel'] },
				{ source: 'n1', target: 'n2', tags: ['rel'] }
			],
			posByNodeId: { n0: { x: -240, y: 0 }, n1: { x: 0, y: 0 }, n2: { x: 240, y: 0 } },
			tagColorConfig: {
				nodeTags: { hide: '#ff0000', keep: '#00ff00' },
				edgeTags: { rel: '#0000ff' }
			}
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { relaxIterations: 0 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const n0XBefore = getNodeWrapper(canvasElement, 'n0').dataset.x;
		const canvas = within(canvasElement);
		canvas.getByRole('button', { name: 'Find / Filter' }).click();
		await sleep();

		const input = canvas.getByLabelText('Graph query') as HTMLInputElement;
		input.value = '-#hide';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await sleep();

		expect(canvasElement.querySelector('[data-node-id="n1"].node-wrapper')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('[data-edge-id="e0"]')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('[data-edge-id="e1"]')).not.toBeInTheDocument();
		expect(nodeOpacity(canvasElement, 'n0')).toBe(1);
		expect(nodeOpacity(canvasElement, 'n2')).toBe(1);
		expect(getNodeWrapper(canvasElement, 'n0').dataset.x).toBe(n0XBefore);
	}}
/>

<Story
	name="UserNavigatesQueryRegions"
	args={{
		multigraphData: makeGraph({
			nodes: [
				{ id: 'n0', title: 'First topic', description: '', tags: ['topic'] },
				{ id: 'n1', title: 'Bridge', description: '', tags: [] },
				{ id: 'n2', title: 'Second topic', description: '', tags: ['topic'] }
			],
			pinned: ['n1'],
			edges: [
				{ source: 'n0', target: 'n1', tags: [] },
				{ source: 'n1', target: 'n2', tags: [] }
			],
			posByNodeId: { n0: { x: -500, y: 0 }, n1: { x: 0, y: 0 }, n2: { x: 500, y: 0 } },
			tagColorConfig: { nodeTags: { topic: '#ff0000' }, edgeTags: {} }
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { relaxIterations: 0 },
		onViewStateChange: fn()
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const canvas = within(canvasElement);
		canvas.getByRole('button', { name: 'Find / Filter' }).click();
		await sleep();

		const input = canvas.getByLabelText('Graph query') as HTMLInputElement;
		input.value = '#topic';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await sleep();

		const before = getStageTransform(canvasElement);
		canvas.getByRole('button', { name: 'Next' }).click();
		await sleep();

		expect(getStageTransform(canvasElement)).not.toBe(before);
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
		await dispatchLongPress(circle, center.x, center.y);

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
	name="ThreeParallelEdgesRenderAsCenteredFan"
	args={{
		multigraphData: SAME_DIRECTION_PARALLEL_EDGES_WITH_UNRELATED_EDGE,
		defaultPrimaryNodeId: 'parallel-a',
		layoutSettings: { relaxIterations: 0 }
	}}
	play={async ({ canvasElement }) => {
		await waitForLayout();

		const firstEdge = getEdge(canvasElement, 'parallel-same-01');
		const middleEdge = getEdge(canvasElement, 'parallel-same-02');
		const lastEdge = getEdge(canvasElement, 'parallel-same-03');
		const unrelatedEdge = getEdge(canvasElement, 'parallel-unrelated-a-to-c');

		expectParallelEdgeMetadata(firstEdge, 3, -1);
		expectParallelEdgeMetadata(middleEdge, 3, 0);
		expectParallelEdgeMetadata(lastEdge, 3, 1);
		expectParallelEdgeMetadata(unrelatedEdge, 1, 0);
		const arrowHalfHeight = EDGE_ARROW_HALF_HEIGHT * Number(firstEdge.dataset.edgeArrowScale);
		expect(Math.abs(Number(firstEdge.dataset.edgeParallelOffset))).toBeGreaterThanOrEqual(
			arrowHalfHeight * 2 + APP_CONFIG.multigraph.layout.parallelEdgeClearancePx
		);

		expect(firstEdge).toHaveAttribute('data-arrow-target-node-id', 'parallel-b');
		expect(middleEdge).toHaveAttribute('data-arrow-target-node-id', 'parallel-b');
		expect(lastEdge).toHaveAttribute('data-arrow-target-node-id', 'parallel-b');
		expect(unrelatedEdge).not.toHaveAttribute('data-arrow-target-node-id');
		expect(firstEdge.style.getPropertyValue('--edge-background').trim()).toBe('#2563eb');
		expect(middleEdge.style.getPropertyValue('--edge-background').trim()).toBe('#dc2626');
		expect(lastEdge.style.getPropertyValue('--edge-background').trim()).toBe('#16a34a');
		expect(unrelatedEdge.style.getPropertyValue('--edge-background').trim()).toBe('#7c3aed');
	}}
/>

<Story
	name="OppositeDirectionParallelEdgesKeepOppositeArrows"
	args={{
		multigraphData: OPPOSITE_DIRECTION_PARALLEL_EDGES_WITH_COLORS,
		defaultPrimaryNodeId: 'parallel-a',
		layoutSettings: { relaxIterations: 0 }
	}}
	play={async ({ canvasElement }) => {
		await waitForLayout();

		const outgoingEdge = getEdge(canvasElement, 'parallel-opposite-a-to-b');
		const incomingEdge = getEdge(canvasElement, 'parallel-opposite-b-to-a');

		expectParallelEdgeMetadata(outgoingEdge, 2, -0.5);
		expectParallelEdgeMetadata(incomingEdge, 2, 0.5);
		expect(outgoingEdge).toHaveAttribute('data-arrow-target-node-id', 'parallel-b');
		expect(incomingEdge).toHaveAttribute('data-arrow-target-node-id', 'parallel-a');
		expectEdgeBetweenHorizontalNodeRims(
			canvasElement,
			'parallel-opposite-a-to-b',
			'parallel-a',
			'parallel-b'
		);
		expectEdgeBetweenHorizontalNodeRims(
			canvasElement,
			'parallel-opposite-b-to-a',
			'parallel-a',
			'parallel-b'
		);
		expect(outgoingEdge.style.getPropertyValue('--edge-background').trim()).toBe('#0f766e');
		expect(incomingEdge.style.getPropertyValue('--edge-background').trim()).toBe('#ea580c');
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

		// Immediately after the drop, the new node's enter animation continues
		// from the creation preview's scale. Check mid-animation state.
		await waitForFrames(2);

		const newNodeWrapper = canvasElement.querySelector(
			'[data-node-id="n1"].node-wrapper'
		) as HTMLElement | null;
		expect(newNodeWrapper).toBeInTheDocument();

		const newNodeScale = Number(newNodeWrapper!.dataset.scale);
		expect(newNodeScale).toBeGreaterThan(0);
		expect(newNodeScale).toBeLessThan(1);

		// The preview edge was already drawn at full opacity during the drag, so
		// the real edge appears without a fade-in (seamless handoff).
		const newEdge = canvasElement.querySelector(
			'.edge[data-source-node-id="n0"][data-target-node-id="n1"]'
		) as HTMLElement | null;
		expect(newEdge).toBeInTheDocument();
		expect(newEdge!.dataset.edgeExiting).toBeUndefined();
	}}
/>

<Story
	name="RemovedEdgeFadesOutAfterDuplicateConfirm"
	args={{
		multigraphData: makeGraph({
			nodeCount: 2,
			pinned: [0],
			// Parallel edges keep the graph connected after removal, so the
			// exiting-buffer fade path runs (severing removals use the reveal wave).
			edges: [
				[0, 1],
				[0, 1]
			],
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
		expect(canvasElement.querySelector('[data-edge-id="e1"]')).toBeInTheDocument();
		expect(lastChangedGraph(args).edges.map((edge) => edge.id)).toEqual(['e1']);
	}}
/>

<Story
	name="DerivedEdgeDoesNotBlockAuthoringOverTheSamePair"
	args={{
		multigraphData: makeGraph({
			nodes: [
				{
					id: 'n0',
					title: 'Gravity',
					description: '$$g = 9.8$$',
					outputs: designations('g')
				},
				{
					id: 'n1',
					title: 'Weight',
					description: '$$w = m g$$',
					inputs: designations('g'),
					outputs: designations('w')
				}
			],
			pinned: [0],
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
		// The pair already carries an inferred dataflow edge.
		expect(canvasElement.querySelector('[data-edge-id="dataflow:n0->n1"]')).toBeInTheDocument();

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

		// Duplicate detection runs against authored data, so the derived edge must
		// not be mistaken for an existing one.
		expect(canvasElement.querySelector('.duplicate-edge-dialog-confirm')).not.toBeInTheDocument();

		const persistedEdgeIds = lastChangedGraph(args).edges.map((edge) => edge.id);
		expect(persistedEdgeIds).toHaveLength(1);
		expect(persistedEdgeIds.some((id) => id.startsWith('dataflow:'))).toBe(false);
	}}
/>

<Story
	name="DefineButtonInFocusCreatesTheMissingNode"
	args={{
		multigraphData: makeGraph({
			// Confirmed inputs, because an unresolved quantity is now a claim the
			// author made — "this node needs a value for m" — rather than a letter
			// the parser noticed in their prose.
			nodes: [
				{
					id: 'n0',
					title: 'Energy',
					description: 'Energy is $E = m c^2$.',
					inputs: designations('m'),
					outputs: designations('E')
				}
			],
			pinned: ['n0'],
			posByNodeId: { n0: { x: 0, y: 0 } }
		}),
		defaultPrimaryNodeId: 'n0',
		initialViewState: { panX: 0, panY: 0, scale: APP_CONFIG.multigraph.zoom.maxScale },
		layoutSettings: { relaxIterations: 0 },
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const center = getCenter(getCircle(canvasElement, 'n0'));

		dispatchWheel(stage, -800, center.x, center.y);
		await within(canvasElement).findByRole('dialog');

		const defineButton = await waitFor(() => {
			const button = canvasElement.querySelector('[data-create-defining-node]');
			expect(button).toBeInTheDocument();
			return button as HTMLElement;
		});

		// A button the pointer cannot reach is the same as no button at all, so
		// assert reachability rather than just presence.
		const rect = defineButton.getBoundingClientRect();
		expect(rect.width).toBeGreaterThan(0);
		expect(rect.height).toBeGreaterThan(0);
		const topElement = document.elementFromPoint(
			rect.left + rect.width / 2,
			rect.top + rect.height / 2
		);
		expect(defineButton.contains(topElement)).toBe(true);

		const quantity = defineButton.getAttribute('data-create-defining-node');

		// Drive the real pointer sequence rather than calling .click(). A synthetic
		// click skips pointerdown, which is exactly where a swallowed gesture hides.
		const point = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
		for (const type of ['pointerdown', 'pointerup', 'click']) {
			defineButton.dispatchEvent(
				new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, ...point })
			);
		}

		// Focus must give way, or the new node is created behind a full-screen
		// overlay and a working button looks like a dead one.
		await waitFor(() => {
			expect(canvasElement.querySelector('[role="dialog"]')).not.toBeInTheDocument();
		});

		// The node does not merely appear — it appears with the cursor in it. The
		// author asked for a definition of m, so what lands is the beginning of the
		// equation that defines it, open for editing with the caret in the gap
		// where the right-hand side goes.
		const titleInput = await openTitleInput(canvasElement);
		expect(titleInput.value).toBe(`$${quantity} = $`);
		const caret = titleInput.value.length - 1;
		expect(titleInput.selectionStart).toBe(caret);
		expect(titleInput.selectionEnd).toBe(caret);

		// The equation lives in the title, so the description arrives empty: a
		// second copy of the same statement is a second place to keep it true.
		const created = lastChangedGraph(args).nodes.find((node) => node.id !== 'n0');
		expect(created?.description).toBe('');

		// Asking for the node IS the confirmation that it defines the quantity, so
		// its arrow is there on arrival. Without the seeded output the repair flow
		// would end in a node whose edge never appears, and a second trip through
		// the edit sheet to say what the button already said.
		await waitFor(() => {
			expect(
				canvasElement.querySelector('[data-edge-derived="true"][data-target-node-id="n0"]')
			).toBeInTheDocument();
		});
	}}
/>

<Story
	name="MathTitleIsTypesetOnCanvasAndSpokenAsTextInFocus"
	args={{
		multigraphData: makeGraph({
			nodes: [{ id: 'n0', title: '$E = mc^2$', description: 'Mass-energy equivalence.' }],
			pinned: ['n0'],
			posByNodeId: { n0: { x: 0, y: 0 } }
		}),
		defaultPrimaryNodeId: 'n0',
		initialViewState: { panX: 0, panY: 0, scale: APP_CONFIG.multigraph.zoom.maxScale },
		layoutSettings: { relaxIterations: 0 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();

		// On the canvas the title is typeset. Seeing a dollar sign here would mean
		// the author's LaTeX leaked through as source.
		const canvasTitle = canvasElement.querySelector('.node .title') as HTMLElement;
		expect(canvasTitle.querySelector('math')).not.toBeNull();
		expect(canvasTitle.textContent).not.toContain('$');

		const stage = getStage(canvasElement);
		dispatchWheel(stage, -800, getCenter(getCircle(canvasElement, 'n0')).x, 0);
		const dialog = await within(canvasElement).findByRole('dialog');

		// The heading names the dialog, so the name a screen reader announces is
		// stated outright rather than left to how it chooses to walk the MathML.
		const heading = canvasElement.querySelector('.details-title') as HTMLElement;
		expect(heading.querySelector('math')).not.toBeNull();
		expect(heading.getAttribute('aria-label')).toBe('E=mc2');
		expect(dialog.getAttribute('aria-labelledby')).toBe(heading.id);
	}}
/>

<Story
	name="JumpFromAPeekRevealsTheDefinerWithoutPinningIt"
	args={{
		multigraphData: JUMP_TO_DEFINER,
		defaultPrimaryNodeId: 'reader',
		initialViewState: { panX: 0, panY: 0, scale: APP_CONFIG.multigraph.zoom.maxScale },
		layoutSettings: NO_REVEALS,
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		// Two authored hops out with one layer on show, and no derived budget to
		// bring it in — the reader can see that g comes from somewhere and not where.
		expect(canvasElement.querySelector('[data-node-id="gravity"]')).not.toBeInTheDocument();

		await enterFocusOn(canvasElement, 'reader');
		await jumpFromPeek(canvasElement, 'g', 'gravity');

		// The definer arrives on the canvas underneath, and the reader arrives in its
		// details: the seed lands before the overlay opens, so closing the details
		// later morphs back down onto a node that is really there.
		await waitFor(() => {
			expect(canvasElement.querySelector('[data-node-id="gravity"]')).toBeInTheDocument();
		});
		await expectFocusOn(canvasElement, 'gravity');

		// The invariant this whole flow exists for: following a reference is
		// reading, not editing. Nothing was written to the graph, so nothing was
		// pinned, and the node is held on screen by the nav stack alone.
		const changeSpy = args.onMultigraphChange as unknown as ChangeSpy;
		expect(changeSpy.mock.calls).toHaveLength(0);
		expect(
			canvasElement.querySelector('[data-node-id="gravity"] [data-pinned="true"]')
		).not.toBeInTheDocument();
		expect(
			canvasElement.querySelector('[data-node-id="reader"] [data-pinned="true"]')
		).toBeInTheDocument();

		// The trail reads as the route the reader took, ending where they are.
		expect(navTrail(canvasElement)).toEqual(['Weight', 'Gravity']);
		// And it is the only way back while they are in the details: the floating
		// button would be a second control for one of the moves the trail offers,
		// and one that has to out-stack the overlay to be clickable at all.
		expect(canvasElement.querySelector('[data-nav-back]')).not.toBeInTheDocument();
	}}
/>

<Story
	name="BackFromAJumpRestoresTheExactPriorView"
	args={{
		multigraphData: JUMP_TO_DEFINER,
		defaultPrimaryNodeId: 'reader',
		initialViewState: { panX: 0, panY: 0, scale: APP_CONFIG.multigraph.zoom.maxScale },
		layoutSettings: NO_REVEALS,
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		await enterFocusOn(canvasElement, 'reader');
		const before = getStageTransform(canvasElement);

		await jumpFromPeek(canvasElement, 'g', 'gravity');
		await waitFor(() => {
			expect(canvasElement.querySelector('[data-node-id="gravity"]')).toBeInTheDocument();
		});
		// The camera moved to the definer, so returning is a real restore rather
		// than a no-op that would pass whatever back did.
		expect(getStageTransform(canvasElement)).not.toEqual(before);

		await clickCrumb(canvasElement, 'reader');
		await waitForLayout();

		// Verbatim pan and scale, not a fit: a fit clamps to what it can frame and
		// would drop the reader somewhere near where they were.
		expect(getStageTransform(canvasElement)).toEqual(before);
		// And back into what they were reading, since that is what they left.
		await expectFocusOn(canvasElement, 'reader');
		// The seed goes back out with the entry that carried it — the graph never
		// held it, so there is nothing to undo.
		await waitFor(() => {
			expect(canvasElement.querySelector('[data-node-id="gravity"]')).not.toBeInTheDocument();
		});
		// One crumb left is no trail: it would name where the reader is standing.
		expect(canvasElement.querySelector('[data-nav-breadcrumbs]')).not.toBeInTheDocument();
		const changeSpy = args.onMultigraphChange as unknown as ChangeSpy;
		expect(changeSpy.mock.calls).toHaveLength(0);
	}}
/>

<Story
	name="TwoJumpsUnwindInTheOrderTheyWereMade"
	args={{
		multigraphData: JUMP_TWICE_TO_DEFINERS,
		defaultPrimaryNodeId: 'reader',
		initialViewState: { panX: 0, panY: 0, scale: APP_CONFIG.multigraph.zoom.maxScale },
		layoutSettings: NO_REVEALS,
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();

		await enterFocusOn(canvasElement, 'reader');
		await jumpFromPeek(canvasElement, 'g', 'gravity');
		await waitFor(() => {
			expect(navTrail(canvasElement)).toEqual(['Weight', 'Gravity']);
		});

		// `gravity` needs h in turn, and the first jump already left the reader
		// inside its details — so the second reference is followed from there, with
		// no trip back out to the canvas to re-enter what they are already reading.
		await jumpFromPeek(canvasElement, 'h', 'scale');
		await waitFor(() => {
			expect(navTrail(canvasElement)).toEqual(['Weight', 'Gravity', 'Scale']);
		});
		expect(canvasElement.querySelector('[data-node-id="scale"]')).toBeInTheDocument();

		// Clicking the crumb one back unwinds one hop, in the order the reader made
		// them, and lands in the details the jump before it was made from.
		await clickCrumb(canvasElement, 'gravity');
		await waitFor(() => {
			expect(navTrail(canvasElement)).toEqual(['Weight', 'Gravity']);
		});
		await expectFocusOn(canvasElement, 'gravity');
		expect(canvasElement.querySelector('[data-node-id="scale"]')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('[data-node-id="gravity"]')).toBeInTheDocument();

		await clickCrumb(canvasElement, 'reader');
		await waitFor(() => {
			expect(canvasElement.querySelector('[data-nav-breadcrumbs]')).not.toBeInTheDocument();
		});
		await expectFocusOn(canvasElement, 'reader');
		expect(canvasElement.querySelector('[data-node-id="gravity"]')).not.toBeInTheDocument();

		const changeSpy = args.onMultigraphChange as unknown as ChangeSpy;
		expect(changeSpy.mock.calls).toHaveLength(0);
	}}
/>

<Story
	name="BreadcrumbUnwindsSeveralJumpsInOneStep"
	args={{
		multigraphData: JUMP_THRICE_TO_DEFINERS,
		defaultPrimaryNodeId: 'reader',
		initialViewState: { panX: 0, panY: 0, scale: APP_CONFIG.multigraph.zoom.maxScale },
		layoutSettings: NO_REVEALS,
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();

		await enterFocusOn(canvasElement, 'reader');
		const atReader = getStageTransform(canvasElement);

		await jumpFromPeek(canvasElement, 'g', 'gravity');
		const atGravity = getStageTransform(canvasElement);
		await jumpFromPeek(canvasElement, 'h', 'scale');
		const atScale = getStageTransform(canvasElement);
		await jumpFromPeek(canvasElement, 'r', 'radius');

		await waitFor(() => {
			expect(navTrail(canvasElement)).toEqual(['Weight', 'Gravity', 'Scale', 'Radius']);
		});

		// The trail shares the overlay's top edge with Close, at the phone width
		// these stories run at. Four crumbs is the deepest it draws before it
		// collapses its middle, so this is the widest it ever gets.
		const trailRect = (
			canvasElement.querySelector('[data-nav-breadcrumbs]') as HTMLElement
		).getBoundingClientRect();
		const closeRect = within(canvasElement)
			.getByRole('button', { name: 'Close node focus' })
			.getBoundingClientRect();
		expect(trailRect.right).toBeLessThanOrEqual(closeRect.left);

		// One click on the oldest crumb, not three on Back. Unwinding several jumps
		// is a single restore of the camera recorded at that crumb — stepping
		// through the entries in between would fly the reader along the route they
		// are explicitly asking to skip.
		await clickCrumb(canvasElement, 'reader');
		await waitForLayout();

		expect(getStageTransform(canvasElement)).toEqual(atReader);
		expect(getStageTransform(canvasElement)).not.toEqual(atGravity);
		expect(getStageTransform(canvasElement)).not.toEqual(atScale);
		await expectFocusOn(canvasElement, 'reader');

		// Every seed the dropped entries were holding goes with them, so the canvas
		// is back to what it looked like before the first jump.
		await waitFor(() => {
			for (const nodeId of ['gravity', 'scale', 'radius']) {
				expect(canvasElement.querySelector(`[data-node-id="${nodeId}"]`)).not.toBeInTheDocument();
			}
		});
		expect(canvasElement.querySelector('[data-nav-breadcrumbs]')).not.toBeInTheDocument();

		// Reading is still not editing, however many jumps deep it went.
		const changeSpy = args.onMultigraphChange as unknown as ChangeSpy;
		expect(changeSpy.mock.calls).toHaveLength(0);
	}}
/>

<Story
	name="TheFloatingBackButtonReturnsOnTheCanvas"
	args={{
		multigraphData: JUMP_TO_DEFINER,
		defaultPrimaryNodeId: 'reader',
		initialViewState: { panX: 0, panY: 0, scale: APP_CONFIG.multigraph.zoom.maxScale },
		layoutSettings: NO_REVEALS,
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();

		await enterFocusOn(canvasElement, 'reader');
		const before = getStageTransform(canvasElement);
		await jumpFromPeek(canvasElement, 'g', 'gravity');

		// In the details the trail is the way back and the floating button stands
		// down; on the canvas there is no trail, so it comes back as the single-step
		// affordance it was.
		expect(canvasElement.querySelector('[data-nav-back]')).not.toBeInTheDocument();
		within(canvasElement).getByRole('button', { name: 'Close node focus' }).click();

		await waitFor(() => {
			expect(canvasElement.querySelector('[data-nav-breadcrumbs]')).not.toBeInTheDocument();
			expect(canvasElement.querySelector('[data-nav-back="reader"]')).toBeInTheDocument();
		});

		(canvasElement.querySelector('[data-nav-back]') as HTMLElement).click();
		await waitForLayout();

		expect(getStageTransform(canvasElement)).toEqual(before);
		await expectFocusOn(canvasElement, 'reader');
		await waitFor(() => {
			expect(canvasElement.querySelector('[data-nav-back]')).not.toBeInTheDocument();
		});
	}}
/>

<Story
	name="DefineFromDeepZoomLandsInTheEquationTitleReadyToType"
	args={{
		multigraphData: DEFINE_FROM_A_NESTED_PEEK,
		defaultPrimaryNodeId: 'reader',
		initialViewState: { panX: 0, panY: 0, scale: APP_CONFIG.multigraph.zoom.maxScale },
		layoutSettings: { relaxIterations: 0 },
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		await enterFocusOn(canvasElement, 'reader');

		// Two levels down: the reader asked what g is, the answer named gravity, and
		// gravity turns out to need an h that nothing defines.
		const card = await openPeekCard(canvasElement, 'g');
		const underH = await drillIntoPeek(card, 'gravity', 'h');
		expect(underH).toHaveTextContent('Nothing defines h yet.');
		(underH.querySelector('[data-create-defining-node="h"]') as HTMLElement).click();

		await waitFor(() => {
			expect(canvasElement.querySelector('[role="dialog"]')).not.toBeInTheDocument();
		});

		// The offer belongs to the card that made it, so what lands is the equation
		// for h — not for g, the quantity the reader started from two levels up.
		const titleInput = await openTitleInput(canvasElement);
		expect(titleInput.value).toBe('$h = $');
		const caret = titleInput.value.length - 1;
		expect(titleInput.selectionStart).toBe(caret);
		expect(titleInput.selectionEnd).toBe(caret);

		const created = lastChangedGraph(args).nodes.find(
			(node) => node.id !== 'reader' && node.id !== 'gravity'
		);
		expect(created?.title).toBe('$h = $');
		expect(created?.description).toBe('');

		// The way back is to where the reader was, which is the node whose details
		// were on screen — not `gravity`, the consumer this definition was made for
		// and a node the reader never opened.
		await waitFor(() => {
			expect(canvasElement.querySelector('[data-nav-back="reader"]')).toBeInTheDocument();
		});
	}}
/>

<Story
	name="BackAfterDefineReturnsToTheConsumersDetails"
	args={{
		multigraphData: makeGraph({
			nodes: [
				{
					id: 'n0',
					title: 'Energy',
					description: 'Energy is $E = m c^2$.',
					inputs: designations('m'),
					outputs: designations('E')
				}
			],
			pinned: ['n0'],
			posByNodeId: { n0: { x: 0, y: 0 } }
		}),
		defaultPrimaryNodeId: 'n0',
		initialViewState: { panX: 0, panY: 0, scale: APP_CONFIG.multigraph.zoom.maxScale },
		layoutSettings: { relaxIterations: 0 },
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		await enterFocusOn(canvasElement, 'n0');
		const atReader = getStageTransform(canvasElement);

		(canvasElement.querySelector('[data-create-defining-node="m"]') as HTMLElement).click();

		await waitFor(() => {
			expect(canvasElement.querySelector('[role="dialog"]')).not.toBeInTheDocument();
		});
		await openTitleInput(canvasElement);

		// Defining something takes the reader out of the details and flies the camera
		// to the new node — so there has to be a way back, and it is the same one a
		// jump leaves behind.
		expect(getStageTransform(canvasElement)).not.toEqual(atReader);
		const back = await waitFor(() => {
			const button = canvasElement.querySelector('[data-nav-back="n0"]');
			expect(button).toBeInTheDocument();
			return button as HTMLElement;
		});

		back.click();
		await waitForLayout();

		expect(getStageTransform(canvasElement)).toEqual(atReader);
		await expectFocusOn(canvasElement, 'n0');
		await waitFor(() => {
			expect(canvasElement.querySelector('[data-nav-back]')).not.toBeInTheDocument();
		});
	}}
/>

<Story
	name="CyclingAChipInDeepZoomDrawsTheEdge"
	args={{
		multigraphData: cycleInDeepZoom([]),
		defaultPrimaryNodeId: 'reader',
		layoutSettings: NO_REVEALS,
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		await enterFocusOn(canvasElement, 'reader');

		// The parser noticed g; nobody has said it is an input, so nothing is drawn.
		const ghost = await viewChip(canvasElement, 'g');
		expect(ghost).toHaveAttribute('data-designation-role', 'suggestion');
		expect(canvasElement.querySelector('[data-edge-derived="true"]')).not.toBeInTheDocument();

		ghost.click();

		// Confirming a ghost used to mean leaving the node, opening the edit sheet
		// and saving. One tap on the chip already in front of the reader commits it,
		// and a designation is what draws a derived edge.
		await waitFor(() => {
			const reader = lastChangedGraph(args).nodes.find((node) => node.id === 'reader');
			expect(reader?.inputs?.map((input) => input.base)).toEqual(['g']);
		});
		expect(await viewChip(canvasElement, 'g')).toHaveAttribute('data-designation-role', 'input');

		within(canvasElement).getByRole('button', { name: 'Close node focus' }).click();
		await waitForLayout();
		await waitFor(() => {
			expect(
				canvasElement.querySelector('[data-edge-derived="true"][data-target-node-id="reader"]')
			).toBeInTheDocument();
		});
	}}
/>

<Story
	name="CyclingAChipInDeepZoomOffTakesTheEdgeAway"
	args={{
		multigraphData: cycleInDeepZoom(designations('g')),
		defaultPrimaryNodeId: 'reader',
		layoutSettings: NO_REVEALS,
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		expect(
			canvasElement.querySelector('[data-edge-derived="true"][data-target-node-id="reader"]')
		).toBeInTheDocument();

		await enterFocusOn(canvasElement, 'reader');

		// Input, then output, then unassigned: the cycle the edit sheet has always
		// had, which is what makes committing on every tap safe without an undo —
		// whatever a stray tap did is at most two taps from where it started.
		(await viewChip(canvasElement, 'g')).click();
		await waitFor(async () => {
			expect(await viewChip(canvasElement, 'g')).toHaveAttribute('data-designation-role', 'output');
		});
		(await viewChip(canvasElement, 'g')).click();

		await waitFor(() => {
			const reader = lastChangedGraph(args).nodes.find((node) => node.id === 'reader');
			expect(reader?.inputs ?? []).toHaveLength(0);
			expect(reader?.outputs?.map((output) => output.base)).toEqual(['w']);
		});

		within(canvasElement).getByRole('button', { name: 'Close node focus' }).click();
		await waitForLayout();
		await waitFor(() => {
			expect(
				canvasElement.querySelector('[data-edge-derived="true"][data-target-node-id="reader"]')
			).not.toBeInTheDocument();
		});
	}}
/>

<Story
	name="TheNodesOwnEquationAnswersItsOwnPeek"
	args={{
		multigraphData: ITS_OWN_DEFINER,
		defaultPrimaryNodeId: 'reader',
		layoutSettings: NO_REVEALS,
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		await enterFocusOn(canvasElement, 'reader');

		// The reported bug, end to end. A node titled `$y = 1$` asked what defines y
		// and was told nothing did — by the card hanging under its own equation —
		// and then offered to define it, which would have made a second node saying
		// the same thing.
		const card = await openPeekCard(canvasElement, 'y');
		expect(card).not.toHaveTextContent('Nothing defines y yet.');
		expect(card.querySelector('[data-create-defining-node]')).not.toBeInTheDocument();

		const row = card.querySelector('[data-peek-definer="reader"]') as HTMLElement;
		expect(row).toHaveAttribute('data-peek-definer-state', 'unconfirmed');
		expect(row.querySelector('math')).not.toBeNull();
		// Nowhere to go: this is the node the reader is already in.
		expect(row.querySelector('[data-peek-goto]')).toBeNull();
	}}
/>

<Story
	name="AMislabeledQuantityIsRepairedOnTheNodeThatWroteIt"
	args={{
		multigraphData: ITS_OWN_DEFINER_LABELED_INPUT,
		defaultPrimaryNodeId: 'reader',
		layoutSettings: NO_REVEALS,
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		await enterFocusOn(canvasElement, 'reader');

		const item = canvasElement.querySelector('[data-diagnostic-quantity="y"]') as HTMLElement;
		expect(item).toHaveAttribute('data-diagnostic-state', 'self-unconfirmed');

		// The reported bug. This row used to name the node it was rendered in —
		// "not confirmed by `$y = 1$`" — so the only offered way out of a mislabel
		// was a jump to the page the reader was already on, which pushed that page
		// into its own trail.
		expect(item.querySelector('[data-reveal-node]')).toBeNull();

		(item.querySelector('[data-confirm-definer="reader"]') as HTMLElement).click();

		// The label moves rather than being added: a quantity in both columns at
		// once is what the reader was trying to stop saying.
		await waitFor(() => {
			const reader = lastChangedGraph(args).nodes.find((node) => node.id === 'reader');
			expect(reader?.outputs?.map((output) => output.base)).toEqual(['y']);
			expect(reader?.inputs ?? []).toEqual([]);
		});

		// Still on the node, with nothing to walk back out of.
		await expectFocusOn(canvasElement, 'reader');
		expect(canvasElement.querySelector('[data-nav-breadcrumbs]')).not.toBeInTheDocument();
		await waitFor(() => {
			expect(canvasElement.querySelector('[data-diagnostic-quantity="y"]')).toBeNull();
		});
	}}
/>

<Story
	name="ConfirmingFromAPeekWiresTheEdgeWithoutLeavingTheNode"
	args={{
		multigraphData: CONFIRM_FROM_A_PEEK,
		defaultPrimaryNodeId: 'reader',
		layoutSettings: NO_REVEALS,
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		expect(canvasElement.querySelector('[data-edge-derived="true"]')).not.toBeInTheDocument();

		await enterFocusOn(canvasElement, 'reader');
		const card = await openPeekCard(canvasElement, 'g');

		(card.querySelector('[data-peek-confirm="gravity"]') as HTMLElement).click();

		// The designation lands on the node that wrote the equation — the first
		// affordance here that edits a node the reader is not focused on, which is
		// the whole point: agreeing with an answer should not cost a journey.
		await waitFor(() => {
			const gravity = lastChangedGraph(args).nodes.find((node) => node.id === 'gravity');
			expect(gravity?.outputs?.map((output) => output.base)).toEqual(['g']);
		});

		// The row it was tapped on becomes a fact, in place, and the reader keeps
		// the card and the node they were reading.
		await waitFor(() => {
			expect(canvasElement.querySelector('[data-peek-definer="gravity"]')).toHaveAttribute(
				'data-peek-definer-state',
				'confirmed'
			);
		});
		expect(canvasElement.querySelector('[data-peek-path=""]')).toBeInTheDocument();
		await expectFocusOn(canvasElement, 'reader');

		// And a confirmed output against a confirmed input is an edge.
		within(canvasElement).getByRole('button', { name: 'Close node focus' }).click();
		await waitForLayout();
		await waitFor(() => {
			expect(
				canvasElement.querySelector('[data-edge-derived="true"][data-target-node-id="reader"]')
			).toBeInTheDocument();
		});
	}}
/>

<Story
	name="ConfirmingADefinerDoesNotCreateASecondNode"
	args={{
		multigraphData: CONFIRM_FROM_A_PEEK,
		defaultPrimaryNodeId: 'reader',
		layoutSettings: NO_REVEALS,
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		await enterFocusOn(canvasElement, 'reader');
		const card = await openPeekCard(canvasElement, 'g');

		(card.querySelector('[data-peek-confirm="gravity"]') as HTMLElement).click();

		await waitFor(() => {
			expect(lastChangedGraph(args).nodes.map((node) => node.id)).toEqual(['reader', 'gravity']);
		});

		// The bug this replaced: the card said nothing defined g and offered to
		// define it, so the repair for an unconfirmed equation was a duplicate node
		// and a title editor. Confirming adds neither.
		expect(canvasElement.querySelector('.title-input')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('[data-create-defining-node]')).not.toBeInTheDocument();
	}}
/>
