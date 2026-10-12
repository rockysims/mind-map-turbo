<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Multigraph from '$lib/components/ui/Multigraph/Multigraph.svelte';
	import MultigraphSettingsHarness from './MultigraphSettingsHarness.svelte';
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
	import { wheelDeltaForZoomFactor } from './lib/graphMath';
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
	import type { AiRun, NodeContentBlock, NodeData, QuantityDesignation } from '../types/node';
	import type { GraphCommitIntent } from '../types/history';
	import type { ViewState } from '$lib/migrations';
	import type { ExitingBuffer } from './lib/elementTransitions';
	import type Anthropic from '@anthropic-ai/sdk';
	import type { AiClient, AiTurn } from '$lib/ai/aiClient';
	import { createFakeAiClient } from '$lib/ai/fakeClient';
	import { createFakeExecutor } from '$lib/ai/fakeExecutor';
	import type { PyExecutor } from '$lib/ai/pyExecutor';
	import {
		MemoryGraphAssetStore,
		type GraphAssetStore,
		type StoredGraphAsset
	} from '$lib/assets/assetStore';

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
			graphGeneration?: number;
			onMultigraphChange?: (
				data: MultigraphData,
				generation: number,
				intent: GraphCommitIntent
			) => void;
			onViewStateChange?: (state: ViewState) => void;
		};
	};

	type ChangeSpy = {
		mock: { calls: Array<[MultigraphData, number]> };
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

	/**
	 * A wheel delta that means "zoom by this factor", rather than a magic number.
	 *
	 * The deltas in this file used to be hand-derived from the linear zoom curve
	 * `scaleFromWheelDelta` once used, which is exactly why fixing that curve
	 * broke these stories. Said as a factor, a step keeps meaning what it meant
	 * through any retuning. `WHEEL_SLAM` stays a raw number on purpose: those
	 * steps mean "past the clamp, whatever the clamp is", not a particular factor.
	 */
	const wheelFactor = wheelDeltaForZoomFactor;
	/** Far enough past either clamp that the boundary logic, not the factor, decides. */
	const WHEEL_SLAM_IN = -6000;
	const WHEEL_SLAM_OUT = 6000;

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

	/**
	 * One wheel, answering the only question the focus surface's wheel policy
	 * turns on: did the world take it (`preventDefault`), or is it the browser's
	 * to scroll with? Note that a synthetic wheel carries no default action, so a
	 * story that wants the scroll itself has to move `scrollTop` by hand.
	 */
	function wheelWasTaken(
		target: HTMLElement,
		deltaY: number,
		clientX?: number,
		clientY?: number
	): boolean {
		const center = getCenter(target);
		const event = new WheelEvent('wheel', {
			clientX: clientX ?? center.x,
			clientY: clientY ?? center.y,
			deltaY,
			bubbles: true,
			cancelable: true
		});
		target.dispatchEvent(event);
		return event.defaultPrevented;
	}

	/** A block of nothing, tall enough to overflow whatever box it is put in. */
	function appendTallFiller(host: HTMLElement, heightPx = 3000): HTMLElement {
		const filler = document.createElement('div');
		filler.dataset.storyFiller = 'true';
		filler.style.height = `${heightPx}px`;
		host.appendChild(filler);
		return filler;
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

	/** The generation an edit was stamped with: which loaded graph it belongs to. */
	function lastChangeGeneration(args: PlayContext['args']): number {
		const spy = args.onMultigraphChange as ChangeSpy | undefined;
		const call = spy?.mock.calls.at(-1);
		if (!call) throw new Error('Expected onMultigraphChange to have been called');
		return call[1];
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

	/**
	 * Open Find / Filter (unless it is already open) and type a whole query into
	 * it, the way the reader does. Resolves once Svelte has flushed the change,
	 * and before the next animation frame, so a caller sees the first render
	 * under the new query.
	 */
	async function typeGraphQuery(el: HTMLElement, text: string): Promise<void> {
		const canvas = within(el);
		if (!canvas.queryByLabelText('Graph query')) {
			canvas.getByRole('button', { name: 'Find / Filter' }).click();
			await sleep();
		}
		const input = canvas.getByLabelText('Graph query');
		if (!(input instanceof HTMLInputElement)) throw new Error('Graph query is not an input');
		input.value = text;
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();
	}

	function nodeIsDrawn(el: HTMLElement, nodeId: string): boolean {
		return el.querySelector(`[data-node-id="${nodeId}"].node-wrapper`) !== null;
	}

	/** Bare `F`, from nowhere a letter would be typed into. */
	function pressFitKey(): void {
		const active = document.activeElement;
		if (active instanceof HTMLElement) active.blur();
		dispatchKeydown(document.body, 'f');
	}

	/** Exclusions in these stories land at once: no exit fade to wait out. */
	const EXCLUSION_STORY_LAYOUT = { relaxIterations: 0, enterExitDurationMs: 0 };

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

	/* ---------------------------------------------------------------------- *
	 * The `!ai` workbench, run end to end with the fakes.
	 *
	 * Nothing here is a network or a Python runtime: the client replays two
	 * scripted turns and the executor answers with a fixed PNG, which is what
	 * makes "press Run and an output lands in the grid" a deterministic
	 * assertion rather than a wait on a model.
	 * ---------------------------------------------------------------------- */

	const AI_SCOPE = 'ai-story';
	const AI_CSV_ASSET_ID = 'ai-csv-asset';
	const AI_CSV_TEXT = 't,ch2\n0,1.0\n1,1.4\n2,1.9\n';
	/** A stub PNG: the bytes only have to survive a round trip through a Blob. */
	const AI_PLOT_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);

	const AI_WORKBENCH_GRAPH: MultigraphData = {
		...makeGraph({
			nodes: [
				{
					id: 'ai',
					title: 'Drift analysis',
					description: '',
					addons: { ai: { prompt: 'Plot channel 2 against time.', runs: [], promoted: {} } }
				},
				{
					id: 'sweep',
					title: 'Bench sweep',
					description: 'Taken at 21 °C.',
					content: [{ type: 'file', assetId: AI_CSV_ASSET_ID, name: 'sweep.csv' }]
				}
			],
			edges: [{ source: 'sweep', target: 'ai', directed: true, tags: ['baseline'] }],
			pinned: ['ai', 'sweep'],
			posByNodeId: { ai: { x: 0, y: 0 }, sweep: { x: 320, y: 0 } }
		}),
		assets: {
			[AI_CSV_ASSET_ID]: {
				id: AI_CSV_ASSET_ID,
				kind: 'file',
				mimeType: 'text/csv',
				name: 'sweep.csv',
				size: AI_CSV_TEXT.length,
				createdAt: 0
			}
		}
	};

	/** A store with the input CSV already in it; the run writes its outputs here. */
	function aiAssetStore(): GraphAssetStore {
		const store = new MemoryGraphAssetStore();
		void store.put({
			scope: AI_SCOPE,
			assetId: AI_CSV_ASSET_ID,
			blob: new Blob([AI_CSV_TEXT], { type: 'text/csv' }),
			mimeType: 'text/csv',
			name: 'sweep.csv',
			size: AI_CSV_TEXT.length,
			updatedAt: 0
		});
		return store;
	}

	/** Ask for one script run, then finish with a summary. */
	function aiStoryClient(): AiClient {
		const toolUse: Anthropic.ToolUseBlock = {
			type: 'tool_use',
			id: 'toolu_story',
			name: 'run_analysis',
			caller: { type: 'direct' },
			input: { script: 'plt.savefig("outputs/drift.png")\n' }
		};
		const turns: AiTurn[] = [
			{
				content: [{ type: 'text', text: 'Reading the sweep.', citations: null }, toolUse],
				stopReason: 'tool_use',
				usage: { inputTokens: 120, outputTokens: 30 },
				model: 'claude-opus-5'
			},
			{
				content: [
					{ type: 'text', text: 'Channel 2 rises steadily across the sweep.', citations: null }
				],
				stopReason: 'end_turn',
				usage: { inputTokens: 240, outputTokens: 45 },
				model: 'claude-opus-5'
			}
		];
		return createFakeAiClient(turns);
	}

	function aiStoryExecutor(): PyExecutor {
		return createFakeExecutor(
			() => ({
				exitCode: 0,
				stdout: 'saved outputs/drift.png\n',
				stderr: '',
				durationMs: 40,
				outputs: [{ name: 'drift.png', mimeType: 'image/png', bytes: AI_PLOT_BYTES }]
			}),
			[
				{
					name: 'sweep.csv',
					size: AI_CSV_TEXT.length,
					kind: 'table',
					columns: ['t', 'ch2'],
					dtypes: ['int64', 'float64'],
					rows: 3,
					head: [['0', '1.0']]
				}
			]
		);
	}

	/* ---------------------------------------------------------------------- *
	 * The same node, one run later: a finished analysis with a figure to file.
	 * ---------------------------------------------------------------------- */

	const AI_PLOT_ASSET_ID = 'ai-plot-asset';
	const AI_PLOT_NAME = 'drift.png';
	const AI_SCRIPT = 'plt.savefig("outputs/drift.png")\n';

	const AI_DONE_RUN: AiRun = {
		id: 'run-1',
		startedAt: 1_700_000_000_000,
		finishedAt: 1_700_000_012_000,
		status: 'done',
		mode: 'analyse',
		prompt: 'Plot channel 2 against time.',
		model: 'claude-opus-5',
		runtime: APP_CONFIG.ai.runtime.version,
		inputs: [],
		summary: 'Channel 2 rises steadily across the sweep.',
		outputs: [{ name: AI_PLOT_NAME, assetId: AI_PLOT_ASSET_ID, mimeType: 'image/png' }],
		toolCalls: 1
	};

	const AI_PROMOTE_GRAPH: MultigraphData = {
		...makeGraph({
			nodes: [
				{
					id: 'ai',
					title: 'Drift analysis',
					description: '',
					addons: {
						ai: {
							prompt: 'Plot channel 2 against time.',
							script: AI_SCRIPT,
							runs: [AI_DONE_RUN],
							promoted: {}
						}
					}
				}
			],
			pinned: ['ai'],
			posByNodeId: { ai: { x: 0, y: 0 } }
		}),
		assets: {
			[AI_PLOT_ASSET_ID]: {
				id: AI_PLOT_ASSET_ID,
				kind: 'image',
				mimeType: 'image/png',
				name: AI_PLOT_NAME,
				size: AI_PLOT_BYTES.length,
				createdAt: 1
			}
		}
	};

	/** The store the finished run left behind: one figure, ready to be filed. */
	function aiPlotStore(): GraphAssetStore {
		const store = new MemoryGraphAssetStore();
		void store.put({
			scope: AI_SCOPE,
			assetId: AI_PLOT_ASSET_ID,
			blob: new Blob([AI_PLOT_BYTES], { type: 'image/png' }),
			mimeType: 'image/png',
			name: AI_PLOT_NAME,
			size: AI_PLOT_BYTES.length,
			updatedAt: 1
		});
		return store;
	}

	/* ---------------------------------------------------------------------- *
	 * The state a bug report arrived in.
	 *
	 * A reader pressed Replace on a neighbour's CSV and said everything inside
	 * the deep zoom went blank. What their tab did that a story does not is lose
	 * the window while the native file dialog was up: `document.visibilityState`
	 * goes `hidden`, `window` takes a `blur`, and the page's own
	 * `visibilitychange` handler flushes the pending save. So the fixture is as
	 * close to their node as fixtures reach — a finished run with two figures,
	 * one of them promoted to a node of its own — and the story does the losing
	 * and regaining of the window before it does the Replace.
	 * ---------------------------------------------------------------------- */

	const AI_RESIDUALS_ASSET_ID = 'ai-residuals-asset';
	const AI_RESIDUALS_NAME = 'residuals.png';
	const AI_PROMOTED_NODE_ID = 'drift-plot';

	const AI_TWO_OUTPUT_RUN: AiRun = {
		...AI_DONE_RUN,
		inputs: [{ nodeId: 'sweep', assetId: AI_CSV_ASSET_ID, name: 'sweep.csv' }],
		summary: 'Channel 2 rises steadily across the sweep. The residuals stay inside the band.',
		outputs: [
			{ name: AI_PLOT_NAME, assetId: AI_PLOT_ASSET_ID, mimeType: 'image/png' },
			{ name: AI_RESIDUALS_NAME, assetId: AI_RESIDUALS_ASSET_ID, mimeType: 'image/png' }
		]
	};

	const AI_REPLACE_GRAPH: MultigraphData = {
		...makeGraph({
			nodes: [
				{
					id: 'ai',
					title: 'Drift analysis',
					description: '',
					addons: {
						ai: {
							prompt: 'Plot channel 2 against time.',
							script: AI_SCRIPT,
							runs: [AI_TWO_OUTPUT_RUN],
							promoted: { [AI_PLOT_NAME]: AI_PROMOTED_NODE_ID }
						}
					}
				},
				{
					id: 'sweep',
					title: 'Bench sweep',
					description: 'Taken at 21 °C.',
					content: [{ type: 'file', assetId: AI_CSV_ASSET_ID, name: 'sweep.csv' }]
				},
				{
					id: AI_PROMOTED_NODE_ID,
					title: AI_PLOT_NAME,
					description: '',
					content: [{ type: 'image', assetId: AI_PLOT_ASSET_ID, alt: AI_PLOT_NAME }]
				}
			],
			edges: [
				{ source: 'sweep', target: 'ai', directed: true, tags: ['baseline'] },
				{ source: 'ai', target: AI_PROMOTED_NODE_ID, directed: true }
			],
			pinned: ['ai', 'sweep', AI_PROMOTED_NODE_ID],
			posByNodeId: {
				ai: { x: 0, y: 0 },
				sweep: { x: 320, y: 0 },
				[AI_PROMOTED_NODE_ID]: { x: 0, y: 320 }
			}
		}),
		assets: {
			[AI_CSV_ASSET_ID]: {
				id: AI_CSV_ASSET_ID,
				kind: 'file',
				mimeType: 'text/csv',
				name: 'sweep.csv',
				size: AI_CSV_TEXT.length,
				createdAt: 0
			},
			[AI_PLOT_ASSET_ID]: {
				id: AI_PLOT_ASSET_ID,
				kind: 'image',
				mimeType: 'image/png',
				name: AI_PLOT_NAME,
				size: AI_PLOT_BYTES.length,
				createdAt: 1
			},
			[AI_RESIDUALS_ASSET_ID]: {
				id: AI_RESIDUALS_ASSET_ID,
				kind: 'image',
				mimeType: 'image/png',
				name: AI_RESIDUALS_NAME,
				size: AI_PLOT_BYTES.length,
				createdAt: 1
			}
		}
	};

	/** The bytes behind all three: the input the reader replaces, and both figures. */
	function aiReplaceStore(): GraphAssetStore {
		const store = new MemoryGraphAssetStore();
		void store.put({
			scope: AI_SCOPE,
			assetId: AI_CSV_ASSET_ID,
			blob: new Blob([AI_CSV_TEXT], { type: 'text/csv' }),
			mimeType: 'text/csv',
			name: 'sweep.csv',
			size: AI_CSV_TEXT.length,
			updatedAt: 0
		});
		for (const [assetId, name] of [
			[AI_PLOT_ASSET_ID, AI_PLOT_NAME],
			[AI_RESIDUALS_ASSET_ID, AI_RESIDUALS_NAME]
		]) {
			void store.put({
				scope: AI_SCOPE,
				assetId,
				blob: new Blob([AI_PLOT_BYTES], { type: 'image/png' }),
				mimeType: 'image/png',
				name,
				size: AI_PLOT_BYTES.length,
				updatedAt: 1
			});
		}
		return store;
	}

	/**
	 * Lose the window, then get it back — what a native file dialog does to the
	 * page under it. `visibilityState` lives on `Document.prototype`, so an own
	 * property shadows it for as long as the story needs and is deleted after.
	 */
	async function withDocumentHidden(during: () => Promise<void> | void): Promise<void> {
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get: () => 'hidden'
		});
		document.dispatchEvent(new Event('visibilitychange'));
		window.dispatchEvent(new Event('blur'));
		await during();
		Reflect.deleteProperty(document, 'visibilityState');
		document.dispatchEvent(new Event('visibilitychange'));
		window.dispatchEvent(new Event('focus'));
		await tick();
	}

	/**
	 * Pick a file in a file input the way the browser does: a `DataTransfer`'s
	 * list assigned to `files`, then the `change` the handler is listening for.
	 */
	function pickFileInto(input: HTMLInputElement, file: File): void {
		const transfer = new DataTransfer();
		transfer.items.add(file);
		input.files = transfer.files;
		input.dispatchEvent(new Event('change', { bubbles: true }));
	}

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

	/**
	 * One quantity chip in the details view, once the overlay has drawn it.
	 *
	 * Found by reading `data-designation-key` rather than by selector, for the
	 * reason `drillIntoPeek` gives below: a subscripted key embeds a NUL, and a
	 * selector cannot carry one.
	 */
	async function viewChip(canvasElement: HTMLElement, quantityKey: string): Promise<HTMLElement> {
		return await waitFor(() => {
			const found =
				Array.from(
					canvasElement.querySelectorAll('[data-designation-chips="view"] [data-designation-key]')
				).find((candidate) => candidate.getAttribute('data-designation-key') === quantityKey) ??
				null;
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
	 * subscripted key embeds a NUL, which no attribute selector can carry. Opened
	 * by right-click, the same way the card above it was: a drill chip takes the
	 * chip gesture, not a plain click.
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
		const center = getCenter(chip);
		dispatchContextMenu(chip, center.x, center.y);

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
		canvas.getByRole('button', { name: 'Done' }).click();
		// A microtask flush, not a frame: the settle kick has to be observable
		// before the first animation frame could have consumed it.
		await tick();
	}

	/** Play context for the stories that render `MultigraphSettingsHarness`. */
	type HarnessPlayContext = {
		canvasElement: HTMLElement;
	};

	function getSettingsHarness(el: HTMLElement): HTMLElement {
		const harness = el.querySelector('.harness');
		if (!(harness instanceof HTMLElement)) throw new Error('Settings harness not found');
		return harness;
	}

	function getGraphElement(el: HTMLElement): HTMLElement {
		const graph = el.querySelector('.graph');
		if (!(graph instanceof HTMLElement)) throw new Error('Graph element not found');
		return graph;
	}

	function harnessSettings(el: HTMLElement): Record<string, unknown> {
		return JSON.parse(getSettingsHarness(el).dataset.settings ?? '{}') as Record<string, unknown>;
	}

	function settingsSlider(el: HTMLElement, label: string): HTMLInputElement {
		const slider = within(el).getByRole('slider', { name: label });
		if (!(slider instanceof HTMLInputElement)) throw new Error(`Slider "${label}" not found`);
		return slider;
	}

	/**
	 * The event sequence a real pointer drag produces on a range input: one
	 * `input` per movement, then a single `change` on release. Omitting the
	 * release models a drag still under the finger, which is exactly the state
	 * these stories are about.
	 */
	function dragSettingsSlider(slider: HTMLInputElement, steps: number[], release = true): void {
		for (const step of steps) {
			slider.value = String(step);
			slider.dispatchEvent(new Event('input', { bubbles: true }));
		}
		if (release) slider.dispatchEvent(new Event('change', { bubbles: true }));
	}

	function nodeScale(el: HTMLElement, nodeId: string): number {
		return Number(getNodeWrapper(el, nodeId).dataset.scale);
	}

	/** The node's rendered text size, straight off the custom property it is set through. */
	function nodeTextFontSize(el: HTMLElement, nodeId: string): string {
		const styled = el.querySelector(`[data-node-id="${nodeId}"] [style*="--node-text-font-size"]`);
		if (!(styled instanceof HTMLElement)) throw new Error(`No sized content for ${nodeId}`);
		return styled.style.getPropertyValue('--node-text-font-size').trim();
	}

	/** A pinned root with two hops off it, so hop scaling has something to show. */
	const SETTINGS_HOP_CHAIN = makeGraph({
		nodeCount: 3,
		pinned: [0],
		edges: chainEdges(3),
		posByNodeId: {
			n0: { x: -420, y: 0 },
			n1: { x: 0, y: 0 },
			n2: { x: 420, y: 0 }
		}
	});

	/**
	 * Two nodes far apart with the springs switched off in the graph's own
	 * settings, so the ingest settle leaves them where they are put and the graph
	 * is genuinely at rest before the story touches anything.
	 */
	const SETTINGS_SPRING_PAIR = makeGraph({
		nodeCount: 2,
		pinned: [0],
		edges: [[0, 1]],
		posByNodeId: {
			n0: { x: -600, y: 0 },
			n1: { x: 600, y: 0 }
		}
	});

	const SETTINGS_SINGLE_NODE = makeGraph({ nodeCount: 1, pinned: [0] });

	/** No physics at all: what moves in these stories is only what the story moved. */
	const SETTINGS_STILL_LAYOUT = {
		relaxIterations: 0,
		hopRepulsionStrength: 0,
		edgeSpringStrength: 0
	};

	const KIB = 1024;
	const MIB = 1024 * KIB;

	/**
	 * A pinned, sizeless hub with four unpinned spokes one hop out: 10 KiB, 1 MiB
	 * (the shipped reference size), 100 MiB, and one with no size at all.
	 */
	const SIZED_SPOKES = makeGraph({
		nodeCount: 5,
		pinned: [0],
		edges: [
			[0, 1],
			[0, 2],
			[0, 3],
			[0, 4]
		],
		sizeBytes: { 1: 10 * KIB, 2: MIB, 3: 100 * MIB },
		posByNodeId: {
			n0: { x: 0, y: 0 },
			n1: { x: -480, y: -480 },
			n2: { x: 480, y: -480 },
			n3: { x: 480, y: 480 },
			n4: { x: -480, y: 480 }
		}
	});

	/**
	 * What a node's `.circle` was told to draw and what it draws: the width set
	 * inline by `NodeChrome` (pinned or not, there is only one), and the computed
	 * border it actually renders.
	 */
	function nodeBorderWidths(el: HTMLElement, nodeId: string): { asked: number; rendered: number } {
		const circle = getCircle(el, nodeId);
		return {
			asked: parseFloat(circle.style.getPropertyValue('--node-border-width')),
			rendered: parseFloat(getComputedStyle(circle).borderTopWidth)
		};
	}

	/**
	 * Chromium snaps a border width down to whole device pixels, so a sized
	 * border of 15.97 px renders as 15 px at a device pixel ratio of 1. What
	 * the reader sees is the asked width, floored by less than one device pixel.
	 */
	function expectDrawnBorder(rendered: number, asked: number): void {
		expect(rendered).toBeLessThanOrEqual(asked + 0.01);
		expect(rendered).toBeGreaterThan(asked - 1 / window.devicePixelRatio - 0.01);
	}

	/** The settings key that picks what a node's border width shows. */
	const BORDER_SOURCE = 'multigraph.borderWeight.source';

	/**
	 * The shipped curve with an 8 px base, written out independently of
	 * `borderWidthFactorForValue` so the stories pin the numbers the plan
	 * promises: `8 × (1 + 0.15 × log2(value / reference))`. Only called with
	 * values whose factor lies inside the ×0.5..×3 clamp.
	 */
	function curveWidth(value: number, reference: number): number {
		return 8 * (1 + 0.15 * Math.log2(value / reference));
	}

	/** A node with an empty description, so no source reads anything by accident. */
	function bareNode(id: string): NodeData {
		return { id, title: id, description: '', tags: [] };
	}

	/**
	 * A pinned hub with one unpinned spoke per entry, each one hop out on its own
	 * spot of a 480 px ring, so nothing overlaps and every spoke draws at one scale.
	 */
	function hubWithSpokes(
		hub: NodeData,
		spokes: NodeData[],
		assets?: MultigraphData['assets']
	): MultigraphData {
		const posByNodeId: Record<string, Point> = { [hub.id]: { x: 0, y: 0 } };
		spokes.forEach((spoke, i) => {
			const angle = (2 * Math.PI * i) / spokes.length;
			posByNodeId[spoke.id] = { x: 480 * Math.cos(angle), y: 480 * Math.sin(angle) };
		});
		const graph = makeGraph({
			nodes: [hub, ...spokes],
			pinned: [hub.id],
			edges: spokes.map((spoke) => ({ source: hub.id, target: spoke.id })),
			posByNodeId
		});
		return assets === undefined ? graph : { ...graph, assets };
	}

	/**
	 * A pinned hub with five leaves, plus a pinned node with no edges far off to
	 * one side. Under "Edge count" the hub (5) draws thicker than the reference
	 * (3), each leaf (1) thinner, and the loner (0) on the ×0.5 floor.
	 */
	const DEGREE_HUB: MultigraphData = (() => {
		const graph = hubWithSpokes(bareNode('hub'), ['a', 'b', 'c', 'd', 'e'].map(bareNode));
		return {
			...graph,
			nodes: [...graph.nodes, { ...bareNode('loner'), pinned: true }],
			posByNodeId: { ...graph.posByNodeId, loner: { x: 1400, y: 0 } }
		};
	})();

	/** `count` file blocks for a node; the asset ids are what `ATTACHMENT_SPOKES` registers. */
	function fileBlocks(nodeId: string, count: number): NodeContentBlock[] {
		return Array.from({ length: count }, (_, i) => ({
			type: 'file',
			assetId: `${nodeId}-file-${i}`,
			name: `${nodeId}-${i}.txt`
		}));
	}

	const ATTACHMENT_COUNTS: Record<string, number> = { none: 0, one: 1, four: 4 };

	/**
	 * Spokes carrying 0, 1 (the reference) and 4 file blocks, with matching
	 * `assets` metadata so the canvas renders them as it would a real graph.
	 */
	const ATTACHMENT_SPOKES: MultigraphData = hubWithSpokes(
		bareNode('hub'),
		Object.entries(ATTACHMENT_COUNTS).map(([id, count]) =>
			count === 0 ? bareNode(id) : { ...bareNode(id), content: fileBlocks(id, count) }
		),
		Object.fromEntries(
			Object.entries(ATTACHMENT_COUNTS).flatMap(([id, count]) =>
				fileBlocks(id, count).map((block) => [
					block.assetId,
					{
						id: block.assetId,
						kind: 'file' as const,
						mimeType: 'text/plain',
						name: `${id}.txt`,
						size: 16,
						createdAt: 0
					}
				])
			)
		)
	);

	/** Spokes whose descriptions run 0, 50, 200 (the reference) and 800 characters. */
	const DESCRIPTION_SPOKES: MultigraphData = hubWithSpokes(
		bareNode('hub'),
		[0, 50, 200, 800].map((length) => ({
			...bareNode(`d${length}`),
			description: 'x'.repeat(length)
		}))
	);

	/** Spokes with no weight, and weights 0, 1 (the reference) and 8. */
	const WEIGHT_SPOKES: MultigraphData = hubWithSpokes(bareNode('hub'), [
		bareNode('absent'),
		{ ...bareNode('w0'), weight: 0 },
		{ ...bareNode('w1'), weight: 1 },
		{ ...bareNode('w8'), weight: 8 }
	]);

	function borderSourceSelect(el: HTMLElement): HTMLSelectElement {
		const select = within(el).getByRole('combobox', { name: 'Border shows' });
		if (!(select instanceof HTMLSelectElement)) throw new Error('"Border shows" is not a select');
		return select;
	}

	/**
	 * Scrub into focus on `nodeId` and back to progress 0, then commit and flick
	 * out to progress 0, and at both handoffs check that the morph surface starts
	 * from the border the node itself draws. `aboveDefaultPx` is how far, in
	 * on-screen pixels, that border must clear the default node border, so a
	 * story cannot pass by the morph ignoring the weighting altogether.
	 */
	async function expectMorphStartsFromTheNodesBorder(
		canvasElement: HTMLElement,
		nodeId: string,
		aboveDefaultPx: number
	): Promise<void> {
		const stage = getStage(canvasElement);
		const center = getCenter(getCircle(canvasElement, nodeId));

		const assertHandoff = () => {
			const morph = morphRectOf(getFocusLayer(canvasElement));
			expect(morph.progress).toBe(0);
			const inStage = getCircle(canvasElement, nodeId);
			const nodeRect = inStage.getBoundingClientRect();
			expect(morph.width).toBeCloseTo(nodeRect.width, 0);
			const visualScale = nodeRect.width / inStage.offsetWidth;
			// Against the width the node was told to draw, so the comparison is
			// exact rather than at the mercy of the browser's border snapping...
			const asked = nodeBorderWidths(canvasElement, nodeId).asked;
			expect(asked * visualScale).toBeCloseTo(morph.borderWidth, 1);
			// ...and against what it draws, the existing story's check, within the
			// device pixel the browser's snapping takes off a fractional border.
			const localBorder = parseFloat(getComputedStyle(inStage).borderTopWidth);
			expectDrawnBorder(localBorder * visualScale, morph.borderWidth);
			// Not the unweighted default: the story would pass vacuously otherwise.
			expect(morph.borderWidth).toBeGreaterThan(
				APP_CONFIG.multigraph.nodeBorderWidthPx * visualScale + aboveDefaultPx
			);
		};

		// Entry: scrub in a little, then back to 0 while the surface is mounted.
		dispatchWheel(stage, wheelFactor(1.16), center.x, center.y);
		await waitFor(() => {
			expect(morphRectOf(getFocusLayer(canvasElement)).progress).toBeGreaterThan(0);
		});
		dispatchWheel(stage, wheelFactor(0.6), center.x, center.y);
		await waitFor(() => {
			expect(morphRectOf(getFocusLayer(canvasElement)).progress).toBe(0);
		});
		assertHandoff();

		await sleep(APP_CONFIG.multigraph.focus.entryGestureIdleMs + 40);
		await waitFor(() => {
			expect(canvasElement.querySelector('.deep-zoom-layer')).not.toBeInTheDocument();
		});

		// Exit: commit, then flick out to progress 0.
		dispatchWheel(stage, wheelFactor(3), center.x, center.y);
		await within(canvasElement).findByRole('dialog');
		const world = canvasElement.querySelector('.zoom-world');
		if (!(world instanceof HTMLElement)) throw new Error('Zoom world not found');
		dispatchWheel(world, WHEEL_SLAM_OUT, center.x, center.y);
		await waitFor(() => {
			expect(morphRectOf(getFocusLayer(canvasElement)).progress).toBe(0);
		});
		assertHandoff();
	}

	/** What picking an option does to a native select: the value moves, then one `change`. */
	function chooseOption(select: HTMLSelectElement, value: string): void {
		select.value = value;
		select.dispatchEvent(new Event('change', { bubbles: true }));
	}
	/* ---------------------------------------------------------------------- *
	 * Follow-ups: composing one on the node the reader is reading, and the
	 * node the submit makes.
	 * ---------------------------------------------------------------------- */

	/**
	 * The finished analysis with nothing pinned on it.
	 *
	 * The pin transfer has nothing to move here, which is what earns it a story
	 * of its own: an unpinned parent must make an unpinned child rather than the
	 * follow-up inventing a pin nobody asked for.
	 */
	const AI_UNPINNED_PARENT_GRAPH: MultigraphData = {
		...AI_PROMOTE_GRAPH,
		nodes: AI_PROMOTE_GRAPH.nodes.map((node) => {
			const unpinned = { ...node };
			delete unpinned.pinned;
			return unpinned;
		})
	};

	/** The intent every commit carries, which is the label an Undo would name. */
	type IntentSpy = {
		mock: { calls: Array<[MultigraphData, number, GraphCommitIntent]> };
	};

	/** Every graph committed under one undo label, oldest first. */
	function commitsLabelled(args: PlayContext['args'], label: string): MultigraphData[] {
		const spy = args.onMultigraphChange as unknown as IntentSpy | undefined;
		return (spy?.mock.calls ?? [])
			.filter((call) => call[2]?.label === label)
			.map((call) => call[0]);
	}

	/** The `!ai` workbench, once the focus surface has drawn it. */
	async function aiWorkbench(canvasElement: HTMLElement): Promise<HTMLElement> {
		return await waitFor(() => {
			const found = canvasElement.querySelector('[data-ai-workbench]');
			expect(found).toBeInTheDocument();
			return found as HTMLElement;
		});
	}

	/** Press "Ask a follow-up" and get the composer's field back. */
	async function openFollowUpComposer(canvasElement: HTMLElement): Promise<HTMLTextAreaElement> {
		const workbench = await aiWorkbench(canvasElement);
		(workbench.querySelector('[data-ai-ask-follow-up]') as HTMLElement).click();
		return await waitFor(() => {
			const found = canvasElement.querySelector('[data-ai-follow-up-prompt]');
			expect(found).toBeInTheDocument();
			return found as HTMLTextAreaElement;
		});
	}

	/** Type into the composer the way a reader does: a value and the `input`. */
	async function typeFollowUp(field: HTMLTextAreaElement, prompt: string): Promise<void> {
		field.value = prompt;
		field.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();
	}

	/** Open the composer, write a prompt, and press Ask. */
	async function askFollowUp(canvasElement: HTMLElement, prompt: string): Promise<void> {
		const field = await openFollowUpComposer(canvasElement);
		await typeFollowUp(field, prompt);
		(canvasElement.querySelector('[data-ai-follow-up-submit]') as HTMLElement).click();
	}

	/** The node the follow-up made: the only one the fixture did not start with. */
	function newNodeId(graph: MultigraphData, existingIds: string[]): string {
		const created = graph.nodes.find((node) => !existingIds.includes(node.id));
		if (!created) throw new Error('Expected a follow-up node in the committed graph');
		return created.id;
	}

	/* ---------------------------------------------------------------------- *
	 * The chain: a parent whose finished run wrote a table, and the follow-up
	 * that reads it.
	 *
	 * Nobody promoted anything and nobody attached anything. The child's inputs
	 * are its parent's *latest done run's* outputs, reaching it by the same
	 * proximity rule an attachment would — which is the whole of "two steps
	 * work" in one fixture.
	 * ---------------------------------------------------------------------- */

	const AI_CLEAN_NAME = 'clean.csv';
	const AI_CLEAN_ASSET_ID = 'ai-clean-asset';
	/** The same file after the parent ran again: one name, new bytes, new id. */
	const AI_CLEAN_RERUN_ASSET_ID = 'ai-clean-asset-2';
	const AI_CLEAN_TEXT = 't,ch2\n0,1.0\n1,1.4\n2,1.9\n';
	const AI_PARENT_PROMPT = 'Drop the dropouts and write a clean table.';
	const AI_CHILD_PROMPT = 'Fit the decay in the clean table.';
	const AI_CHILD_SCRIPT = 'pd.read_csv("clean.csv")\n';

	/** The parent's finished run, writing `clean.csv` under whichever id it got. */
	function cleanedRun(assetId: string): AiRun {
		return {
			id: `parent-run-${assetId}`,
			startedAt: 1_700_000_000_000,
			finishedAt: 1_700_000_020_000,
			status: 'done',
			mode: 'analyse',
			prompt: AI_PARENT_PROMPT,
			model: 'claude-opus-5',
			runtime: APP_CONFIG.ai.runtime.version,
			inputs: [],
			summary: 'Dropped four dropout rows and wrote the clean table.',
			outputs: [{ name: AI_CLEAN_NAME, assetId, mimeType: 'text/csv' }],
			toolCalls: 1
		};
	}

	/**
	 * The child's own finished run, recorded against the *first* `clean.csv`.
	 *
	 * `prompt` matches the node's, so nothing but the file can move the mode off
	 * Run — which is what makes the re-run story about the file.
	 */
	const AI_CHILD_RUN: AiRun = {
		id: 'child-run-1',
		startedAt: 1_700_000_030_000,
		finishedAt: 1_700_000_040_000,
		status: 'done',
		mode: 'refine',
		prompt: AI_CHILD_PROMPT,
		model: 'claude-opus-5',
		runtime: APP_CONFIG.ai.runtime.version,
		inputs: [{ nodeId: 'ai', assetId: AI_CLEAN_ASSET_ID, name: AI_CLEAN_NAME }],
		summary: 'A single exponential fits the decay.',
		outputs: [],
		toolCalls: 1
	};

	/**
	 * Parent and follow-up on a directed edge, with the parent's run output the
	 * only file anywhere in the graph.
	 */
	function aiChainGraph(
		outputAssetId: string,
		child: { runs: AiRun[]; script?: string }
	): MultigraphData {
		return {
			...makeGraph({
				nodes: [
					{
						id: 'ai',
						title: 'Clean the sweep',
						description: '',
						addons: {
							ai: {
								prompt: AI_PARENT_PROMPT,
								script: AI_SCRIPT,
								runs: [cleanedRun(outputAssetId)],
								promoted: {}
							}
						}
					},
					{
						id: 'child',
						title: 'Decay fit',
						description: '',
						addons: {
							ai: {
								prompt: AI_CHILD_PROMPT,
								...(child.script === undefined ? {} : { script: child.script }),
								runs: child.runs,
								promoted: {}
							}
						}
					}
				],
				edges: [{ source: 'ai', target: 'child', directed: true }],
				pinned: ['ai', 'child'],
				posByNodeId: { ai: { x: 0, y: 0 }, child: { x: 320, y: 0 } }
			}),
			assets: {
				[outputAssetId]: {
					id: outputAssetId,
					kind: 'file',
					mimeType: 'text/csv',
					name: AI_CLEAN_NAME,
					size: AI_CLEAN_TEXT.length,
					createdAt: 2
				}
			}
		};
	}

	/** Before the parent ran again: the child has read nothing yet. */
	const AI_CHAIN_GRAPH = aiChainGraph(AI_CLEAN_ASSET_ID, { runs: [] });

	/**
	 * After it: the parent's latest run wrote `clean.csv` under a new id, the old
	 * one went with the run it belonged to, and the child's stored script was
	 * written against the id that is gone.
	 */
	const AI_RERUN_CHAIN_GRAPH = aiChainGraph(AI_CLEAN_RERUN_ASSET_ID, {
		runs: [AI_CHILD_RUN],
		script: AI_CHILD_SCRIPT
	});

	/** The bytes behind whichever `clean.csv` the graph is holding. */
	function aiCleanStore(assetId: string): GraphAssetStore {
		const store = new MemoryGraphAssetStore();
		void store.put({
			scope: AI_SCOPE,
			assetId,
			blob: new Blob([AI_CLEAN_TEXT], { type: 'text/csv' }),
			mimeType: 'text/csv',
			name: AI_CLEAN_NAME,
			size: AI_CLEAN_TEXT.length,
			updatedAt: 2
		});
		return store;
	}

	/* ---------------------------------------------------------------------- *
	 * Results as quantities: a run that printed a named number, and the node
	 * whose equation uses it.
	 * ---------------------------------------------------------------------- */

	/**
	 * `R_{th}`'s canonical key. It embeds a NUL, which no attribute selector can
	 * carry — hence `viewChip` finding chips by reading the attribute.
	 */
	const R_TH_KEY = 'R\u0000th';
	const R_TH_LABEL = 'R_th';

	/** One done run, one `RESULT` line: `RESULT R_{th} = 12.3 K/W`. */
	const AI_MEASURED_RUN: AiRun = {
		id: 'measure-1',
		startedAt: 1_700_000_050_000,
		finishedAt: 1_700_000_060_000,
		status: 'done',
		mode: 'analyse',
		prompt: 'Fit the thermal step and report the resistance.',
		model: 'claude-opus-5',
		runtime: APP_CONFIG.ai.runtime.version,
		inputs: [],
		summary: 'The step settles at 12.3 K/W.',
		outputs: [],
		toolCalls: 1,
		results: [{ symbol: 'R_{th}', value: '12.3', unit: 'K/W' }]
	};

	/**
	 * The measuring node and the node that uses what it measured, with the
	 * designations confirmed on both — only designations draw dataflow, so a
	 * fixture that left them off would be testing nothing.
	 *
	 * `aiDescription` is the one thing the two stories differ by: empty, the run
	 * is the node's only claim about `R_{th}`; carrying an equation of its own, it
	 * is a node saying two different things.
	 */
	function aiMeasuredGraph(aiDescription: string): MultigraphData {
		return makeGraph({
			nodes: [
				{
					id: 'ai',
					title: 'Thermal step',
					description: aiDescription,
					addons: {
						ai: {
							prompt: AI_MEASURED_RUN.prompt ?? '',
							script: AI_SCRIPT,
							runs: [AI_MEASURED_RUN],
							promoted: {}
						}
					},
					outputs: designations(R_TH_LABEL)
				},
				{
					id: 'consumer',
					title: 'Junction rise',
					description: '$$T = R_{th} P$$',
					inputs: designations(R_TH_LABEL)
				}
			],
			pinned: ['ai', 'consumer'],
			posByNodeId: { ai: { x: 0, y: 0 }, consumer: { x: 400, y: 0 } }
		});
	}

	/** The one derived edge a pair should have, or nothing. */
	function derivedEdgeBetween(
		canvasElement: HTMLElement,
		sourceNodeId: string,
		targetNodeId: string
	): HTMLElement | null {
		return canvasElement.querySelector(
			`[data-edge-derived="true"][data-source-node-id="${sourceNodeId}"][data-target-node-id="${targetNodeId}"]`
		);
	}

	/** Long-press a node and take Delete from its menu. */
	async function deleteNode(canvasElement: HTMLElement, nodeId: string): Promise<void> {
		const circle = getCircle(canvasElement, nodeId);
		const center = getCenter(circle);
		await dispatchLongPress(circle, center.x, center.y);
		within(canvasElement).getByRole('menuitem', { name: 'Delete' }).click();
		await sleep();
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

		dispatchWheel(stage, wheelFactor(1.4));
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
		dispatchWheel(image, wheelFactor(2), imageCenter.x, imageCenter.y);
		await waitFor(() => {
			expect(Number(world.dataset.zoomWorldScale)).toBeGreaterThan(1);
			expect(surface.getBoundingClientRect().width).toBeGreaterThan(initialSurfaceRect.width);
		});

		const frame = image.closest('.image-frame') as HTMLElement;
		dispatchWheel(image, wheelFactor(3), imageCenter.x, imageCenter.y);
		await waitFor(() => {
			expect(Number(world.dataset.zoomWorldScale)).toBeGreaterThan(1);
		});
		expect(frame.dataset.imageFocused).toBeUndefined();
		expect(image.dataset.imageZoomScale).toBeUndefined();

		dispatchWheel(world, WHEEL_SLAM_OUT, imageCenter.x, imageCenter.y);
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
		dispatchWheel(image, wheelFactor(7), imageCenter.x, imageCenter.y);
		await waitFor(() => {
			expect(Number(nodeWorld.dataset.zoomWorldScale)).toBeGreaterThan(1);
		});

		// A bold zoom-in past max, cursor over the image, descends to depth 2.
		dispatchWheel(image, WHEEL_SLAM_IN, imageCenter.x, imageCenter.y);
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
		dispatchWheel(imageWorld, WHEEL_SLAM_OUT, imageCenter.x, imageCenter.y);
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

			dispatchWheel(image, wheelFactor(7), imageCenter.x, imageCenter.y);
			await waitFor(() => {
				expect(Number(nodeWorld.dataset.zoomWorldScale)).toBeGreaterThan(1);
			});

			dispatchWheel(image, WHEEL_SLAM_IN, imageCenter.x, imageCenter.y);
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

		dispatchWheel(stage, wheelFactor(2.6), center.x, center.y);

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

		dispatchWheel(world, wheelFactor(2.6), center.x, center.y);
		await sleep();
		expect(Number(world.dataset.zoomWorldScale)).toBe(1);

		await sleep(APP_CONFIG.multigraph.focus.entryGestureIdleMs + 20);
		dispatchWheel(world, wheelFactor(2.6), center.x, center.y);
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
		dispatchWheel(world, WHEEL_SLAM_OUT, center.x, center.y);
		await waitFor(() => {
			expect(canvasElement.querySelector('.graph')).not.toHaveClass('focus-active');
		});

		dispatchWheel(stage, WHEEL_SLAM_OUT, center.x, center.y);
		await sleep();
		expect(getStageTransform(canvasElement)).toBe(stageTransformBeforeExit);

		await sleep(Math.max(0, APP_CONFIG.multigraph.focus.entryGestureIdleMs - 30));
		dispatchWheel(stage, WHEEL_SLAM_OUT, center.x, center.y);
		await sleep();
		expect(getStageTransform(canvasElement)).toBe(stageTransformBeforeExit);

		await sleep(APP_CONFIG.multigraph.focus.entryGestureIdleMs + 20);
		dispatchWheel(stage, WHEEL_SLAM_OUT, center.x, center.y);
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
		dispatchWheel(stage, wheelFactor(1.16), center.x, center.y);
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
		dispatchWheel(stage, wheelFactor(0.68), center.x, center.y);
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

		dispatchWheel(stage, wheelFactor(2.6), center.x, center.y);
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
		dispatchWheel(world, WHEEL_SLAM_OUT, center.x, center.y);
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
		dispatchWheel(stage, wheelFactor(1.16), center.x, center.y);
		await waitFor(() => {
			expect(morphRectOf(getFocusLayer(canvasElement)).progress).toBeGreaterThan(0);
		});
		dispatchWheel(stage, wheelFactor(0.6), center.x, center.y);
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
		dispatchWheel(stage, wheelFactor(3), center.x, center.y);
		await within(canvasElement).findByRole('dialog');
		const world = canvasElement.querySelector('.zoom-world') as HTMLElement;
		dispatchWheel(world, WHEEL_SLAM_OUT, center.x, center.y);
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
		dispatchWheel(stage, wheelFactor(1.16), center.x, center.y);
		await waitFor(() => {
			const p = morphRectOf(getFocusLayer(canvasElement)).progress;
			expect(p).toBeGreaterThan(0);
			expect(p).toBeLessThan(1);
		});
		const surfaceEl = getFocusLayer(canvasElement);

		// Commit (bold flick): the SAME element reaches progress 1.
		dispatchWheel(stage, wheelFactor(3), center.x, center.y);
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
			dispatchWheel(stage, wheelFactor(2.6), center.x, center.y);
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
		dispatchWheel(world, WHEEL_SLAM_OUT, center.x, center.y);
		await assertUnfocused();
	}}
/>

<Story
	name="UserEditsTitleInSheet"
	args={{
		multigraphData: makeGraph({ nodeCount: 1 }),
		defaultPrimaryNodeId: 'n0',
		graphGeneration: 3,
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
		canvas.getByRole('button', { name: 'Done' }).click();
		await sleep();

		expect(canvas.getByText('Updated mobile title')).toBeInTheDocument();
		expect(lastChangedGraph(args).nodes[0].title).toBe('Updated mobile title');
		expect(lastChangedGraph(args).nodes[0].tags).toEqual(['abc', 'urgent']);
		// Stamped with the graph load it was made to, so a commit that lands while
		// the canvas is being replaced can be told apart from a live edit.
		expect(lastChangeGeneration(args)).toBe(3);
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
		expect(canvas.getByRole('menuitem', { name: 'Merge' })).toBeInTheDocument();
		expect(canvas.getByRole('menuitem', { name: 'Pin' })).toBeInTheDocument();
		expect(canvas.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
		expect(canvas.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();

		// Every item explains itself beyond its label, and the label still names
		// the button — `title` is the description, so the role query above by name
		// keeps working. Merge is the one that prompted these: it has to say which
		// node is left standing.
		for (const item of canvas.getAllByRole('menuitem')) {
			expect(item).toHaveAttribute('title');
			expect(item.getAttribute('title')).not.toBe('');
		}
		expect(canvas.getByRole('menuitem', { name: 'Merge' })).toHaveAttribute(
			'title',
			'Drag onto the node this one should merge into; the other node survives'
		);
		expect(canvas.getByRole('menuitem', { name: 'Pin' })).toHaveAttribute(
			'title',
			'Anchor the node here; nearby nodes stay large and visible'
		);
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
	name="UserDeletesTheOnlyPinnedNode"
	args={{
		multigraphData: makeGraph({
			nodeCount: 5,
			pinned: [0],
			// Deleting n0 leaves nothing pinned anywhere, so every node is orphaned at
			// once and there is no survivor to play a reveal wave from. The beacon
			// election still has to land next to the deletion: n2 is both the
			// highest-degree node and the one with pin history, so it would win the
			// component outright on the ordinary rules — off to the side of the node
			// the reader just deleted.
			edges: [
				[0, 1],
				[1, 2],
				[2, 3],
				[2, 4]
			],
			pinHistory: { 2: 4 },
			posByNodeId: {
				n0: { x: -400, y: 0 },
				n1: { x: -200, y: 0 },
				n2: { x: 0, y: 0 },
				n3: { x: 200, y: 160 },
				n4: { x: 200, y: -160 }
			}
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { relaxIterations: 0, enterExitDurationMs: 0 },
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);

		await dispatchLongPress(circle, center.x, center.y);
		within(canvasElement).getByRole('menuitem', { name: 'Delete' }).click();
		await sleep();
		await waitForLayout();

		expect(lastChangedGraph(args).nodes.map((node) => node.id)).toEqual(['n1', 'n2', 'n3', 'n4']);

		// The component stays on screen as its beacon, and the beacon is the
		// neighbour of the deletion — one hop from where the reader is already
		// looking — rather than the node pin recency and degree would have picked.
		expect(canvasElement.querySelectorAll('.node-wrapper')).toHaveLength(1);
		expect(getNodeWrapper(canvasElement, 'n1')).toBeInTheDocument();
		expect(canvasElement.querySelector('[data-node-id="n1"] .node')).not.toHaveAttribute(
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
		expect(canvas.getByRole('menuitem', { name: 'Merge' })).toBeInTheDocument();
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
		expect(activeElementText()).toBe('Merge');
		dispatchKeydown(document.activeElement, 'ArrowDown');
		expect(activeElementText()).toBe('Pin');
		dispatchKeydown(document.activeElement, 'ArrowLeft');
		expect(activeElementText()).toBe('Merge');
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
	name="UserLeavesActionMenuWithTab"
	args={{
		multigraphData: makeGraph({ nodeCount: 1 }),
		defaultPrimaryNodeId: 'n0'
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const toolbarButton = within(canvasElement).getByRole('button', { name: 'Tags' });
		toolbarButton.focus();
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);

		dispatchContextMenu(circle, center.x, center.y);
		await tick();
		expect(activeElementText()).toBe('Add node/edge');

		// Roving tabindex means the browser would otherwise tab clean out of the
		// page, leaving the menu layer up: Tab must close the menu itself.
		const event = dispatchKeydown(document.activeElement, 'Tab');
		await tick();

		expect(event.defaultPrevented).toBe(true);
		expect(within(canvasElement).queryByRole('menu')).not.toBeInTheDocument();
		expect(document.activeElement).toBe(toolbarButton);
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
		const toolbarButton = within(canvasElement).getByRole('button', { name: 'Tags' });
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
	name="MergingANodeOntoAnotherLeavesOneNodeCarryingBothTagSets"
	args={{
		multigraphData: makeGraph({
			nodes: [
				{ id: 'n0', title: 'Node 0', description: '', tags: ['alpha'] },
				{ id: 'n1', title: 'Node 1', description: '', tags: ['beta'] }
			],
			pinned: ['n0', 'n1'],
			posByNodeId: {
				n0: { x: -160, y: 0 },
				n1: { x: 160, y: 0 }
			}
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { enterExitDurationMs: 0, relaxIterations: 1 },
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const absorbedCircle = getCircle(canvasElement, 'n0');
		const absorbedCenter = getCenter(absorbedCircle);
		const survivorCenter = getCenter(getCircle(canvasElement, 'n1'));

		dispatchContextMenu(absorbedCircle, absorbedCenter.x, absorbedCenter.y);
		await sleep();
		within(canvasElement).getByRole('menuitem', { name: 'Merge' }).click();
		await sleep();

		// The merge preview reads as "absorb into", not "connect to": no preview
		// node is ever offered, and the node about to swallow n0 wears the ring.
		dispatchPointer(stage, 'pointermove', survivorCenter.x, survivorCenter.y);
		await sleep();
		expect(canvasElement.querySelector('[data-creation-preview-node]')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('[data-creation-preview-edge]')).toHaveAttribute(
			'data-creation-preview-mode',
			'merge'
		);
		expect(getNodeWrapper(canvasElement, 'n1')).toHaveAttribute('data-merge-target', 'true');

		dispatchPointer(stage, 'pointerdown', survivorCenter.x, survivorCenter.y);
		dispatchPointer(stage, 'pointerup', survivorCenter.x, survivorCenter.y);
		await sleep();
		await waitForLayout();

		// Nothing lossy happened, so the merge committed without stopping to ask.
		expect(canvasElement.querySelector('[role="dialog"]')).not.toBeInTheDocument();

		const changedGraph = lastChangedGraph(args);
		expect(changedGraph.nodes.map((node) => node.id)).toEqual(['n1']);
		// The survivor keeps its own title and leads with its own tags.
		expect(changedGraph.nodes[0].title).toBe('Node 1');
		expect(changedGraph.nodes[0].tags).toEqual(['beta', 'alpha']);
		expect(changedGraph.posByNodeId.n0).toBeUndefined();
		expect(canvasElement.querySelector('[data-node-id="n0"]')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('[data-creation-preview-edge]')).not.toBeInTheDocument();
	}}
/>

<Story
	name="ReleasingAMergeOverBackgroundChangesNothing"
	args={{
		multigraphData: makeGraph({
			nodes: [
				{ id: 'n0', title: 'Node 0', description: '', tags: ['alpha'] },
				{ id: 'n1', title: 'Node 1', description: '', tags: ['beta'] }
			],
			pinned: ['n0', 'n1'],
			posByNodeId: {
				n0: { x: -160, y: 0 },
				n1: { x: 160, y: 0 }
			}
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { enterExitDurationMs: 0, relaxIterations: 1 },
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const stageRect = stage.getBoundingClientRect();
		const absorbedCircle = getCircle(canvasElement, 'n0');
		const absorbedCenter = getCenter(absorbedCircle);
		const bgX = stageRect.right - 20;
		const bgY = stageRect.bottom - 20;

		dispatchContextMenu(absorbedCircle, absorbedCenter.x, absorbedCenter.y);
		await sleep();
		within(canvasElement).getByRole('menuitem', { name: 'Merge' }).click();
		await sleep();

		// Empty canvas holds nothing to absorb into, so nothing is offered there.
		dispatchPointer(stage, 'pointermove', bgX, bgY);
		await sleep();
		expect(canvasElement.querySelector('[data-creation-preview-node]')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('[data-merge-target]')).not.toBeInTheDocument();

		dispatchPointer(stage, 'pointerdown', bgX, bgY);
		dispatchPointer(stage, 'pointerup', bgX, bgY);
		await sleep();
		await waitForLayout();

		expect(canvasElement.querySelector('[data-creation-preview-edge]')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('[data-node-id="n0"]')).toBeInTheDocument();
		expect(canvasElement.querySelector('[data-node-id="n1"]')).toBeInTheDocument();
		const changeSpy = args.onMultigraphChange as ChangeSpy | undefined;
		expect(changeSpy?.mock.calls).toHaveLength(0);
	}}
/>

<Story
	name="CancelingAMergeThatWouldOverwriteEdgeDirectionChangesNothing"
	args={{
		multigraphData: makeGraph({
			nodes: [
				{ id: 'n0', title: 'Node 0', description: '', tags: [] },
				{ id: 'n1', title: 'Node 1', description: '', tags: [] },
				{ id: 'n2', title: 'Node 2', description: '', tags: [] },
				{ id: 'n3', title: 'Node 3', description: '', tags: [] }
			],
			// Both of n0's edges point the opposite way from n1's edge to the same
			// neighbour, so folding n0 into n1 discards two direction assertions.
			edges: [
				{ id: 'e0', source: 'n0', target: 'n2', directed: true },
				{ id: 'e1', source: 'n2', target: 'n1', directed: true },
				{ id: 'e2', source: 'n0', target: 'n3', directed: true },
				{ id: 'e3', source: 'n3', target: 'n1', directed: true }
			],
			pinned: ['n0', 'n1', 'n2', 'n3'],
			posByNodeId: {
				n0: { x: -160, y: 0 },
				n1: { x: 160, y: 0 },
				n2: { x: 0, y: -200 },
				n3: { x: 0, y: 200 }
			}
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { enterExitDurationMs: 0, relaxIterations: 1 },
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const absorbedCircle = getCircle(canvasElement, 'n0');
		const absorbedCenter = getCenter(absorbedCircle);
		const survivorCenter = getCenter(getCircle(canvasElement, 'n1'));

		dispatchContextMenu(absorbedCircle, absorbedCenter.x, absorbedCenter.y);
		await sleep();
		within(canvasElement).getByRole('menuitem', { name: 'Merge' }).click();
		await sleep();

		dispatchPointer(stage, 'pointermove', survivorCenter.x, survivorCenter.y);
		await sleep();
		dispatchPointer(stage, 'pointerdown', survivorCenter.x, survivorCenter.y);
		dispatchPointer(stage, 'pointerup', survivorCenter.x, survivorCenter.y);
		await sleep();

		// The count is the plan's own, so it is the number of edges a confirm
		// would rewrite — not an estimate made separately from the merge.
		const dialog = canvasElement.querySelector('[role="dialog"]');
		expect(dialog).toBeInTheDocument();
		expect(dialog?.querySelector('.merge-confirm-dialog-message')).toHaveTextContent(
			'Merge nodes?'
		);
		expect(dialog?.querySelector('.merge-confirm-dialog-detail')).toHaveTextContent(
			'2 edges will lose their direction.'
		);
		expect(
			Array.from(dialog!.querySelectorAll('button')).map((button) => button.textContent?.trim())
		).toEqual(['Cancel', 'Merge']);
		expect(canvasElement.querySelector('[data-node-id="n0"]')).toBeInTheDocument();

		(canvasElement.querySelector('.merge-confirm-dialog-cancel') as HTMLElement).click();
		await sleep();
		await waitForLayout();

		// Cancel mutated nothing: the plan was only ever held, never committed.
		expect(canvasElement.querySelector('[role="dialog"]')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('[data-node-id="n0"]')).toBeInTheDocument();
		expect(canvasElement.querySelector('[data-edge-id="e0"]')).toBeInTheDocument();
		expect(canvasElement.querySelector('[data-edge-id="e2"]')).toBeInTheDocument();
		const changeSpy = args.onMultigraphChange as ChangeSpy | undefined;
		expect(changeSpy?.mock.calls ?? []).toHaveLength(0);
	}}
/>

<Story
	name="ConfirmingAMergeThatOverwritesEdgeDirectionCommitsTheMerge"
	args={{
		multigraphData: makeGraph({
			nodes: [
				{ id: 'n0', title: 'Node 0', description: '', tags: [] },
				{ id: 'n1', title: 'Node 1', description: '', tags: [] },
				{ id: 'n2', title: 'Node 2', description: '', tags: [] },
				{ id: 'n3', title: 'Node 3', description: '', tags: [] }
			],
			edges: [
				{ id: 'e0', source: 'n0', target: 'n2', directed: true },
				{ id: 'e1', source: 'n2', target: 'n1', directed: true },
				{ id: 'e2', source: 'n0', target: 'n3', directed: true },
				{ id: 'e3', source: 'n3', target: 'n1', directed: true }
			],
			pinned: ['n0', 'n1', 'n2', 'n3'],
			posByNodeId: {
				n0: { x: -160, y: 0 },
				n1: { x: 160, y: 0 },
				n2: { x: 0, y: -200 },
				n3: { x: 0, y: 200 }
			}
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { enterExitDurationMs: 0, relaxIterations: 1 },
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const absorbedCircle = getCircle(canvasElement, 'n0');
		const absorbedCenter = getCenter(absorbedCircle);
		const survivorCenter = getCenter(getCircle(canvasElement, 'n1'));

		dispatchContextMenu(absorbedCircle, absorbedCenter.x, absorbedCenter.y);
		await sleep();
		within(canvasElement).getByRole('menuitem', { name: 'Merge' }).click();
		await sleep();

		dispatchPointer(stage, 'pointermove', survivorCenter.x, survivorCenter.y);
		await sleep();
		dispatchPointer(stage, 'pointerdown', survivorCenter.x, survivorCenter.y);
		dispatchPointer(stage, 'pointerup', survivorCenter.x, survivorCenter.y);
		await sleep();

		const dialog = canvasElement.querySelector('[role="dialog"]');
		expect(dialog?.querySelector('.merge-confirm-dialog-detail')).toHaveTextContent(
			'2 edges will lose their direction.'
		);

		(canvasElement.querySelector('.merge-confirm-dialog-confirm') as HTMLElement).click();
		await sleep();
		await waitForLayout();

		expect(canvasElement.querySelector('[role="dialog"]')).not.toBeInTheDocument();
		const changedGraph = lastChangedGraph(args);
		expect(changedGraph.nodes.map((node) => node.id)).toEqual(['n1', 'n2', 'n3']);
		// Exactly the two edges the dialog counted collapsed, and the survivor's
		// direction is what remains on each.
		expect(
			changedGraph.edges.map((edge) => [edge.id, edge.sourceNodeId, edge.targetNodeId])
		).toEqual([
			['e1', 'n2', 'n1'],
			['e3', 'n3', 'n1']
		]);
		expect(canvasElement.querySelector('[data-node-id="n0"]')).not.toBeInTheDocument();
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
		// And each one is long enough to be seen fading. The nodes on the far end of
		// these two are hidden, so the settle this graph got on the way in sized them
		// at `minScale` and parked them right beside the beacon — halfway to one is
		// inside the beacon's own circle. The reader gets the same hint here as after
		// pinning and unpinning the beacon, which is what they used to have to do.
		for (const edgeId of ['e1', 'e2']) {
			const boundaryEdge = getEdge(canvasElement, edgeId);
			const fadeRadius = Number(boundaryEdge.dataset.boundaryFadeRadius);
			expect(fadeRadius).toBeGreaterThan(0);
			expect(Number.parseFloat(boundaryEdge.style.width)).toBeGreaterThanOrEqual(fadeRadius * 2);
		}

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
		canvas.getByRole('button', { name: 'Tags' }).click();
		await sleep();

		const colorInput = canvas.getByLabelText('Color for node tag topic') as HTMLInputElement;
		colorInput.value = '#00ff00';
		colorInput.dispatchEvent(new Event('input', { bubbles: true }));
		await sleep();

		expect(lastChangedGraph(args).tagColorConfig.nodeTags.topic).toBe('#00ff00');
	}}
/>

<Story
	name="UserLengthensAnEdgeTagFromLegend"
	args={{
		// Pinned at one end and started inside the default band, so the pair is at
		// rest from the first frame and only the slider can move it.
		multigraphData: makeGraph({
			nodeCount: 2,
			pinned: [0],
			edges: [{ source: 'n0', target: 'n1', tags: ['rel'] }],
			posByNodeId: { n0: { x: -280, y: 0 }, n1: { x: 280, y: 0 } }
		}),
		defaultPrimaryNodeId: 'n0',
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		const canvas = within(canvasElement);
		const endpointDistance = () =>
			distanceBetween(nodePosition(canvasElement, 'n0'), nodePosition(canvasElement, 'n1'));

		// Spring strength would show nothing here — inside the band its correction
		// is zero — which is why the slider moves the band instead. Establish rest
		// first, or a settle already running could pass for the slider's work.
		await waitFor(() => expect(isSettling(canvasElement)).toBe(false));
		const before = endpointDistance();
		await waitForFrames(4);
		expect(endpointDistance()).toBe(before);

		canvas.getByRole('button', { name: 'Tags' }).click();
		await sleep();
		const slider = canvas.getByLabelText('Edge length for edge tag rel') as HTMLInputElement;

		// A drag: scrub frames with the graph following, then the release.
		for (const position of [0.25, 0.5, 0.75, 1]) {
			slider.value = String(position);
			slider.dispatchEvent(new Event('input', { bubbles: true }));
			await waitForFrames(2);
		}
		expect(isSettling(canvasElement)).toBe(true);
		slider.dispatchEvent(new Event('change', { bubbles: true }));

		await waitFor(() => expect(isSettling(canvasElement)).toBe(false), { timeout: 5000 });

		// ×2 lifts the band's lower edge past where the pair sat, so the free end
		// walks out to it and stays there.
		const after = endpointDistance();
		expect(after).toBeGreaterThan(before + 40);
		await waitForFrames(4);
		expect(endpointDistance()).toBeCloseTo(after, 1);
		expect(lastChangedGraph(args).tagPhysicsConfig?.edgeTags.rel).toBe(2);
	}}
/>

<Story
	name="UserSpacesOutANodeTagFromLegend"
	args={{
		// A bent chain: `n0` and `n2` are two hops apart, so only hop repulsion
		// (not a spring) decides how far apart they sit.
		multigraphData: makeGraph({
			nodes: [
				{ id: 'n0', title: 'Root', description: '' },
				{ id: 'n1', title: 'Middle', description: '' },
				{ id: 'n2', title: 'Far', description: '', tags: ['far'] }
			],
			pinned: ['n0'],
			edges: [
				['n0', 'n1'],
				['n1', 'n2']
			],
			posByNodeId: { n0: { x: 0, y: 0 }, n1: { x: 520, y: 0 }, n2: { x: 300, y: 420 } }
		}),
		defaultPrimaryNodeId: 'n0',
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		const canvas = within(canvasElement);
		const outerDistance = () =>
			distanceBetween(nodePosition(canvasElement, 'n0'), nodePosition(canvasElement, 'n2'));

		await waitFor(() => expect(isSettling(canvasElement)).toBe(false));
		const before = outerDistance();
		await waitForFrames(4);
		expect(outerDistance()).toBe(before);

		canvas.getByRole('button', { name: 'Tags' }).click();
		await sleep();
		const slider = canvas.getByLabelText('Node spacing for node tag far') as HTMLInputElement;

		for (const position of [0.5, 1, 1.5, 2]) {
			slider.value = String(position);
			slider.dispatchEvent(new Event('input', { bubbles: true }));
			await waitForFrames(2);
		}
		slider.dispatchEvent(new Event('change', { bubbles: true }));

		await waitFor(() => expect(isSettling(canvasElement)).toBe(false), { timeout: 5000 });

		// ×4 on `far` alone is a pair factor of max(4, 1) = 4 on the clearance the
		// non-adjacent pair holds open, so the chain straightens and they part.
		expect(outerDistance()).toBeGreaterThan(before + 40);
		expect(lastChangedGraph(args).tagPhysicsConfig?.nodeTags.far).toBe(4);
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
		const tagColorButton = canvas.getByRole('button', { name: 'Tags' });
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
	name="UserCyclesNodeTagButtonIntoQuery"
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
		layoutSettings: EXCLUSION_STORY_LAYOUT
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const canvas = within(canvasElement);
		canvas.getByRole('button', { name: 'Find / Filter' }).click();
		await sleep();

		const topicButton = () => canvas.getByRole('button', { name: /^Node tag topic,/ });
		const input = canvas.getByLabelText('Graph query') as HTMLInputElement;

		// One click puts the tag into the query as a spotlight: plain focus is not
		// a stop on the cycle.
		topicButton().click();
		await sleep();
		expect(input).toHaveValue('+#topic');
		expect(topicButton()).toHaveAttribute('data-mode', 'spotlight');
		expect(getNodeWrapper(canvasElement, 'n0')).toHaveAttribute('data-query-role', 'spotlight');
		expect(getNodeWrapper(canvasElement, 'n1')).toHaveAttribute('data-query-role', 'spotlight');
		expect(nodeIsDrawn(canvasElement, 'n2')).toBe(true);

		// A second click excludes the tag, and its nodes leave the canvas.
		topicButton().click();
		await sleep();
		expect(input).toHaveValue('-#topic');
		expect(topicButton()).toHaveAttribute('data-mode', 'exclude');
		await waitForLayout();
		expect(nodeIsDrawn(canvasElement, 'n0')).toBe(false);
		expect(nodeIsDrawn(canvasElement, 'n1')).toBe(false);
		expect(nodeIsDrawn(canvasElement, 'n2')).toBe(true);

		// A third click forgets the tag, and they come back.
		topicButton().click();
		await sleep();
		expect(input).toHaveValue('');
		expect(topicButton()).toHaveAttribute('data-mode', 'none');
		await waitForLayout();
		expect(nodeIsDrawn(canvasElement, 'n0')).toBe(true);
		expect(nodeIsDrawn(canvasElement, 'n1')).toBe(true);
	}}
/>

<Story
	name="UserFiltersGraphByNodeAddon"
	args={{
		multigraphData: makeGraph({
			nodes: [
				{
					id: 'n0',
					title: 'Chore',
					description: '',
					tags: [],
					addons: { task: { done: false } }
				},
				{ id: 'n1', title: 'Plain', description: '', tags: [] }
			],
			pinned: ['n0'],
			edges: [{ source: 'n0', target: 'n1', tags: [] }],
			posByNodeId: { n0: { x: -220, y: 0 }, n1: { x: 220, y: 0 } }
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
		expect(input.placeholder).toContain('!task');

		input.value = '!task';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await sleep();

		expect(getNodeWrapper(canvasElement, 'n0')).toHaveAttribute('data-query-role', 'focus');
		expect(getNodeWrapper(canvasElement, 'n1')).toHaveAttribute('data-query-role', 'background');

		const chips = within(canvas.getByLabelText('Parsed query tokens'));
		expect(chips.getByText('!task')).toBeInTheDocument();
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
	name="UserExcludesNodeTagAndTheRestResettles"
	args={{
		multigraphData: makeGraph({
			nodes: [
				{ id: 'n0', title: 'Keep', description: '', tags: ['keep'] },
				{ id: 'n1', title: 'Hide', description: '', tags: ['hide'] },
				{ id: 'n2', title: 'Other', description: '', tags: [] }
			],
			// n2 is strung between two pins too far apart for both springs to rest:
			// n1's spring holds it out past where n0's alone would leave it. It hangs
			// off n0 directly, so it stays on the canvas when n1 goes.
			pinned: ['n0', 'n1'],
			edges: [
				{ source: 'n0', target: 'n1', tags: ['rel'] },
				{ source: 'n1', target: 'n2', tags: ['rel'] },
				{ source: 'n0', target: 'n2', tags: ['rel'] }
			],
			posByNodeId: { n0: { x: -800, y: 0 }, n1: { x: 800, y: 0 }, n2: { x: 0, y: 0 } },
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
		const n2XBefore = getNodeWrapper(canvasElement, 'n2').dataset.x;
		// Control: nothing moves on its own, so a move below is the exclusion's.
		await waitForFrames(5);
		expect(getNodeWrapper(canvasElement, 'n2').dataset.x).toBe(n2XBefore);

		const canvas = within(canvasElement);
		canvas.getByRole('button', { name: 'Find / Filter' }).click();
		await sleep();

		const input = canvas.getByLabelText('Graph query') as HTMLInputElement;
		input.value = '-#hide';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		// The excluded node and its edges fade out rather than vanish.
		await sleep(APP_CONFIG.multigraph.layout.enterExitDurationMs + 40);
		await waitForLayout();

		expect(canvasElement.querySelector('[data-node-id="n1"].node-wrapper')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('[data-node-id="n1"]')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('[data-edge-id="e0"]')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('[data-edge-id="e1"]')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('[data-edge-id="e2"]')).toBeInTheDocument();
		expect(nodeOpacity(canvasElement, 'n0')).toBe(1);
		expect(nodeOpacity(canvasElement, 'n2')).toBe(1);
		// Without n1 pulling and pushing on it, n2 settles somewhere else.
		await waitFor(() => expect(getNodeWrapper(canvasElement, 'n2').dataset.x).not.toBe(n2XBefore));
	}}
/>

<Story
	name="UserExcludesAPinnedNodesTagAndABeaconTakesOver"
	args={{
		multigraphData: makeGraph({
			nodes: [
				{ id: 'hub', title: 'Hub', description: '', tags: ['hub'] },
				{ id: 'a', title: 'Neighbour', description: '', tags: [] },
				{ id: 'b', title: 'Past it, up', description: '', tags: [] },
				{ id: 'c', title: 'Past it, down', description: '', tags: [] }
			],
			// `a` is reachable only through the hub, and has the most edges left once
			// the hub goes, so it is the beacon the remaining component elects.
			pinned: ['hub'],
			edges: [
				['hub', 'a'],
				['a', 'b'],
				['a', 'c']
			],
			posByNodeId: {
				hub: { x: -400, y: 0 },
				a: { x: 0, y: 0 },
				b: { x: 400, y: -200 },
				c: { x: 400, y: 200 }
			},
			tagColorConfig: { nodeTags: { hub: '#ff0000' }, edgeTags: {} }
		}),
		defaultPrimaryNodeId: 'hub',
		layoutSettings: {
			...EXCLUSION_STORY_LAYOUT,
			displayedLayers: 2,
			scaleFalloff: 0.5,
			minScale: 0.1
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		// The hub anchors everything: `b` and `c` sit two hops out, on screen.
		expect(nodeIsDrawn(canvasElement, 'b')).toBe(true);
		expect(nodeIsDrawn(canvasElement, 'c')).toBe(true);

		await typeGraphQuery(canvasElement, '-#hub');
		await waitForLayout();

		// What is left has no pin, so it collapses to its beacon...
		const beacon = getNodeWrapper(canvasElement, 'a');
		expect(Number(beacon.dataset.scale)).toBeCloseTo(0.5);
		expect(canvasElement.querySelector('[data-node-id="a"] .node')).not.toHaveAttribute(
			'data-pinned'
		);
		// ...and the nodes past it leave with the hub that was holding them up.
		expect(nodeIsDrawn(canvasElement, 'b')).toBe(false);
		expect(nodeIsDrawn(canvasElement, 'c')).toBe(false);
		expect(nodeIsDrawn(canvasElement, 'hub')).toBe(false);
	}}
/>

<Story
	name="UserClearsAnExclusionAndTheNodeReturnsWhereItWas"
	args={{
		multigraphData: makeGraph({
			nodes: [
				{ id: 'n0', title: 'Keep', description: '', tags: [] },
				{ id: 'pin', title: 'Hidden pin', description: '', tags: ['hide'] },
				{ id: 'n2', title: 'Other', description: '', tags: [] },
				{ id: 'leaf', title: 'Hidden leaf', description: '', tags: ['hide'] }
			],
			// `n2` is strung between two pins too far apart for both springs to rest,
			// so it moves once the hidden pin goes and the settle has work to do.
			// `leaf` is the one under test: unpinned, so it is only still where it
			// was afterwards because the settle never touched it.
			pinned: ['n0', 'pin'],
			edges: [
				['n0', 'n2'],
				['pin', 'n2'],
				['pin', 'leaf']
			],
			posByNodeId: {
				n0: { x: -800, y: 0 },
				pin: { x: 800, y: 0 },
				n2: { x: 0, y: 0 },
				leaf: { x: 800, y: 300 }
			},
			tagColorConfig: { nodeTags: { hide: '#ff0000' }, edgeTags: {} }
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { ...EXCLUSION_STORY_LAYOUT, postDragSettleMaxFrames: 30 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const leafBefore = nodePosition(canvasElement, 'leaf');
		const n2Before = nodePosition(canvasElement, 'n2');
		// Control: nothing moves on its own, so a move below is the exclusion's.
		await waitForFrames(5);
		expect(nodePosition(canvasElement, 'leaf')).toEqual(leafBefore);
		expect(nodePosition(canvasElement, 'n2')).toEqual(n2Before);

		await typeGraphQuery(canvasElement, '-#hide');
		await waitForLayout();
		expect(nodeIsDrawn(canvasElement, 'leaf')).toBe(false);
		expect(nodeIsDrawn(canvasElement, 'pin')).toBe(false);

		// The rest settles without them, all the way to rest.
		await waitFor(() => expect(nodePosition(canvasElement, 'n2')).not.toEqual(n2Before));
		await waitFor(
			() => expect(canvasElement.querySelector('.graph')).not.toHaveAttribute('data-settling'),
			{ timeout: 3000 }
		);

		// The first frame it is drawn again, it is exactly where it left from.
		await typeGraphQuery(canvasElement, '');
		expect(nodeIsDrawn(canvasElement, 'leaf')).toBe(true);
		expect(nodePosition(canvasElement, 'leaf')).toEqual(leafBefore);
	}}
/>

<Story
	name="UserHoversATagSuggestionWithAnExclusionActive"
	args={{
		multigraphData: makeGraph({
			nodes: [
				{ id: 'n0', title: 'Keep', description: '', tags: ['keep'] },
				{ id: 'n1', title: 'Hide', description: '', tags: ['hide'] },
				{ id: 'n2', title: 'Other', description: '', tags: [] }
			],
			pinned: ['n0', 'n1'],
			edges: [
				{ source: 'n0', target: 'n1', tags: ['rel'] },
				{ source: 'n1', target: 'n2', tags: ['rel'] },
				{ source: 'n0', target: 'n2', tags: ['rel'] }
			],
			posByNodeId: { n0: { x: -800, y: 0 }, n1: { x: 800, y: 0 }, n2: { x: 0, y: 0 } },
			tagColorConfig: {
				nodeTags: { hide: '#ff0000', keep: '#00ff00' },
				edgeTags: { rel: '#0000ff' }
			}
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { ...EXCLUSION_STORY_LAYOUT, postDragSettleMaxFrames: 30 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		await typeGraphQuery(canvasElement, '-#hide');
		await waitForLayout();
		expect(nodeIsDrawn(canvasElement, 'n1')).toBe(false);
		await waitFor(
			() => expect(canvasElement.querySelector('.graph')).not.toHaveAttribute('data-settling'),
			{ timeout: 3000 }
		);
		const restingPositions = nodePositions(canvasElement, ['n0', 'n2']);

		// `keep` is not in the query, so hovering it previews `+#keep`: a spotlight
		// cannot un-exclude anything, so the excluded set and the layout stay put.
		const keepButton = within(canvasElement).getByRole('button', { name: /^Node tag keep,/ });
		keepButton.dispatchEvent(new MouseEvent('mouseenter'));
		await tick();
		// The preview landed: the hovered tag is spotlighted...
		expect(getNodeWrapper(canvasElement, 'n0')).toHaveAttribute('data-query-role', 'spotlight');
		// ...and nothing reflows under the pointer.
		expect(canvasElement.querySelector('.graph')).not.toHaveAttribute('data-settling');
		await waitForFrames(5);
		expect(canvasElement.querySelector('.graph')).not.toHaveAttribute('data-settling');
		expect(nodePositions(canvasElement, ['n0', 'n2'])).toEqual(restingPositions);
		expect(nodeIsDrawn(canvasElement, 'n1')).toBe(false);

		keepButton.dispatchEvent(new MouseEvent('mouseleave'));
		await tick();
		await waitForFrames(3);
		expect(canvasElement.querySelector('.graph')).not.toHaveAttribute('data-settling');
		expect(nodePositions(canvasElement, ['n0', 'n2'])).toEqual(restingPositions);
	}}
/>

<Story
	name="UserHoversAnExcludedTagAndPreviewsItsRemoval"
	args={{
		multigraphData: makeGraph({
			nodes: [
				{ id: 'n0', title: 'Keep', description: '', tags: ['keep'] },
				{ id: 'n1', title: 'Hide', description: '', tags: ['hide'] },
				{ id: 'n2', title: 'Other', description: '', tags: [] }
			],
			pinned: ['n0', 'n1'],
			edges: [
				{ source: 'n0', target: 'n1', tags: ['rel'] },
				{ source: 'n1', target: 'n2', tags: ['rel'] },
				{ source: 'n0', target: 'n2', tags: ['rel'] }
			],
			posByNodeId: { n0: { x: -800, y: 0 }, n1: { x: 800, y: 0 }, n2: { x: 0, y: 0 } },
			tagColorConfig: {
				nodeTags: { hide: '#ff0000', keep: '#00ff00' },
				edgeTags: { rel: '#0000ff' }
			}
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { ...EXCLUSION_STORY_LAYOUT, postDragSettleMaxFrames: 30 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		await typeGraphQuery(canvasElement, '-#hide');
		await waitForLayout();
		expect(nodeIsDrawn(canvasElement, 'n1')).toBe(false);

		const canvas = within(canvasElement);
		const hideButton = canvas.getByRole('button', { name: /^Node tag hide,/ });
		expect(hideButton).toHaveAttribute('data-mode', 'exclude');

		// Hovering previews what the click would do — drop `-#hide` — so the
		// hidden node comes back while the pointer is there...
		hideButton.dispatchEvent(new MouseEvent('mouseenter'));
		await waitFor(() => expect(nodeIsDrawn(canvasElement, 'n1')).toBe(true));
		// ...without committing anything.
		expect(canvas.getByLabelText('Graph query')).toHaveValue('-#hide');
		expect(hideButton).toHaveAttribute('data-mode', 'exclude');

		// Leaving drops the preview, and the node leaves again.
		hideButton.dispatchEvent(new MouseEvent('mouseleave'));
		await waitFor(() => expect(nodeIsDrawn(canvasElement, 'n1')).toBe(false));
		expect(canvas.getByLabelText('Graph query')).toHaveValue('-#hide');
	}}
/>

<Story
	name="UserExcludesTheOnlyRouteToANode"
	args={{
		multigraphData: makeGraph({
			nodes: [
				{ id: 'p', title: 'Pin', description: '', tags: [] },
				{ id: 'a', title: 'Near', description: '', tags: [] },
				{ id: 'b', title: 'Subtree root', description: '', tags: [] },
				{ id: 'c', title: 'Far, up', description: '', tags: [] },
				{ id: 'd', title: 'Far, down', description: '', tags: [] }
			],
			pinned: ['p'],
			edges: [
				{ source: 'p', target: 'a', tags: ['link'] },
				{ source: 'a', target: 'b', tags: ['bridge'] },
				{ source: 'b', target: 'c', tags: ['link'] },
				{ source: 'b', target: 'd', tags: ['link'] }
			],
			posByNodeId: {
				p: { x: -600, y: 0 },
				a: { x: -200, y: 0 },
				b: { x: 200, y: 0 },
				c: { x: 600, y: -200 },
				d: { x: 600, y: 200 }
			},
			tagColorConfig: { nodeTags: {}, edgeTags: { link: '#0000ff', bridge: '#ff0000' } }
		}),
		defaultPrimaryNodeId: 'p',
		layoutSettings: {
			...EXCLUSION_STORY_LAYOUT,
			displayedLayers: 3,
			scaleFalloff: 0.5,
			minScale: 0.1
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		// Every node routes to the pin through the bridge: all on screen.
		for (const nodeId of ['p', 'a', 'b', 'c', 'd']) {
			expect(nodeIsDrawn(canvasElement, nodeId)).toBe(true);
		}
		expect(Number(getNodeWrapper(canvasElement, 'b').dataset.scale)).toBeCloseTo(0.25);

		await typeGraphQuery(canvasElement, '-@bridge');
		await waitForLayout();

		// The subtree is cut off: it shrinks to its own beacon, and its far side
		// leaves the canvas.
		expect(Number(getNodeWrapper(canvasElement, 'b').dataset.scale)).toBeCloseTo(0.5);
		expect(nodeIsDrawn(canvasElement, 'c')).toBe(false);
		expect(nodeIsDrawn(canvasElement, 'd')).toBe(false);
		// The pinned side is untouched.
		expect(nodeIsDrawn(canvasElement, 'p')).toBe(true);
		expect(nodeIsDrawn(canvasElement, 'a')).toBe(true);
		expect(canvasElement.querySelector('[data-edge-id="e1"]')).not.toBeInTheDocument();
	}}
/>

<Story
	name="AnExcludedNodeStopsFadingTheEdgeItLiesAcross"
	args={{
		multigraphData: makeGraph({
			nodes: [
				{ id: 'n0', title: 'Left', description: '', tags: [] },
				{ id: 'n1', title: 'Right', description: '', tags: [] },
				{ id: 'n2', title: 'In the way', description: '', tags: ['hide'] }
			],
			pinned: ['n0', 'n1', 'n2'],
			edges: [['n0', 'n1']],
			posByNodeId: { n0: { x: -200, y: 0 }, n1: { x: 200, y: 0 }, n2: { x: 0, y: 0 } },
			tagColorConfig: { nodeTags: { hide: '#ff0000' }, edgeTags: {} }
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { ...EXCLUSION_STORY_LAYOUT, baseRadius: 20, edgeOcclusionFadeWidthPx: 12 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		expect(getEdge(canvasElement, 'e0')).toHaveAttribute('data-edge-occlusion-count', '1');

		await typeGraphQuery(canvasElement, '-#hide');
		await waitForLayout();

		const edge = getEdge(canvasElement, 'e0');
		expect(edge).toHaveAttribute('data-edge-occlusion-count', '0');
		expect(edge.style.getPropertyValue('--edge-background')).not.toContain('linear-gradient');
		expect(nodeIsDrawn(canvasElement, 'n2')).toBe(false);
	}}
/>

<Story
	name="ExcludingOneOfTwoParallelEdgesCentresTheOther"
	args={{
		multigraphData: makeGraph({
			nodes: [
				{ id: 'a', title: 'A', description: '', tags: [] },
				{ id: 'b', title: 'B', description: '', tags: [] }
			],
			pinned: ['a', 'b'],
			edges: [
				{ id: 'kept', source: 'a', target: 'b', tags: ['main'], directed: true },
				{ id: 'aside', source: 'a', target: 'b', tags: ['aside'], directed: true }
			],
			posByNodeId: { a: { x: -200, y: 0 }, b: { x: 200, y: 0 } },
			tagColorConfig: { nodeTags: {}, edgeTags: { main: '#2563eb', aside: '#dc2626' } }
		}),
		defaultPrimaryNodeId: 'a',
		layoutSettings: EXCLUSION_STORY_LAYOUT
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		expectParallelEdgeMetadata(getEdge(canvasElement, 'aside'), 2, -0.5);
		expectParallelEdgeMetadata(getEdge(canvasElement, 'kept'), 2, 0.5);

		await typeGraphQuery(canvasElement, '-@aside');
		await waitForLayout();

		expectParallelEdgeMetadata(getEdge(canvasElement, 'kept'), 1, 0);
		expect(canvasElement.querySelector('[data-edge-id="aside"]')).not.toBeInTheDocument();
		// Both endpoints stay: only the edge carried the tag.
		expect(nodeIsDrawn(canvasElement, 'a')).toBe(true);
		expect(nodeIsDrawn(canvasElement, 'b')).toBe(true);
	}}
/>

<Story
	name="ADeepZoomWhereAnExcludedNodeWasFocusesNothing"
	args={{
		multigraphData: makeGraph({
			nodes: [
				{ id: 'n0', title: 'Hide', description: '', tags: ['hide'] },
				{ id: 'n1', title: 'Elsewhere', description: '', tags: [] }
			],
			pinned: ['n0', 'n1'],
			posByNodeId: { n0: { x: 0, y: 0 }, n1: { x: 2000, y: 0 } },
			tagColorConfig: { nodeTags: { hide: '#ff0000' }, edgeTags: {} }
		}),
		defaultPrimaryNodeId: 'n0',
		initialViewState: { panX: 0, panY: 0, scale: APP_CONFIG.multigraph.zoom.maxScale },
		layoutSettings: EXCLUSION_STORY_LAYOUT
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		// Where it was: the same overzoom here would have opened it in focus.
		const formerCenter = getCenter(getCircle(canvasElement, 'n0'));

		await typeGraphQuery(canvasElement, '-#hide');
		await waitForLayout();

		dispatchWheel(stage, wheelFactor(2.6), formerCenter.x, formerCenter.y);
		await sleep(APP_CONFIG.multigraph.focus.entryTransitionMs + 40);

		expect(canvasElement.querySelector('[data-focus-subject-id="n0"]')).not.toBeInTheDocument();
		expect(within(canvasElement).queryByRole('dialog')).not.toBeInTheDocument();
		expect(canvasElement.querySelector('.graph')).not.toHaveClass('focus-active');
		expect(nodeIsDrawn(canvasElement, 'n0')).toBe(false);
	}}
/>

<Story
	name="FitFramesOnlyWhatTheExclusionLeaves"
	args={{
		multigraphData: makeGraph({
			nodes: [
				{ id: 'n0', title: 'Left', description: '', tags: [] },
				{ id: 'n1', title: 'Right', description: '', tags: [] },
				{ id: 'far', title: 'Parked far away', description: '', tags: ['hide'] }
			],
			pinned: ['n0', 'n1', 'far'],
			edges: [['n0', 'n1']],
			posByNodeId: { n0: { x: -100, y: 0 }, n1: { x: 100, y: 0 }, far: { x: 4000, y: 0 } },
			tagColorConfig: { nodeTags: { hide: '#ff0000' }, edgeTags: {} }
		}),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: EXCLUSION_STORY_LAYOUT,
		onViewStateChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		pressFitKey();
		await tick();
		const scaleWithFarNode = lastViewState(args).scale;

		await typeGraphQuery(canvasElement, '-#hide');
		await waitForLayout();

		pressFitKey();
		await tick();
		// Framing two nodes 200 apart, not a span of four thousand.
		expect(lastViewState(args).scale).toBeGreaterThan(scaleWithFarNode * 4);
		expect(nodeIsDrawn(canvasElement, 'far')).toBe(false);
	}}
/>

<Story
	name="PanningToWhereOnlyAnExcludedNodeWasShowsTheLostGraphHint"
	args={{
		multigraphData: makeGraph({
			nodes: [
				{ id: 'n0', title: 'Hide', description: '', tags: ['hide'] },
				{ id: 'n1', title: 'Elsewhere', description: '', tags: [] }
			],
			pinned: ['n0', 'n1'],
			posByNodeId: { n0: { x: 0, y: 0 }, n1: { x: 3000, y: 0 } },
			tagColorConfig: { nodeTags: { hide: '#ff0000' }, edgeTags: {} }
		}),
		defaultPrimaryNodeId: 'n0',
		// Centred on `n0`, with `n1` far off screen.
		initialViewState: { panX: 0, panY: 0, scale: 1 },
		layoutSettings: EXCLUSION_STORY_LAYOUT
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		expect(nodeIsDrawn(canvasElement, 'n0')).toBe(true);
		expect(canvasElement.querySelector('.lost-graph-hint')).not.toBeInTheDocument();

		await typeGraphQuery(canvasElement, '-#hide');
		await waitForLayout();

		// The only thing in view has left the graph, so the reader has lost it.
		expect(canvasElement.querySelector('.lost-graph-hint')).toBeInTheDocument();
		expect(nodeIsDrawn(canvasElement, 'n0')).toBe(false);
	}}
/>

<Story
	name="RightClickingWhereAnExcludedNodeWasOpensNoMenu"
	args={{
		multigraphData: makeGraph({
			nodes: [
				{ id: 'n0', title: 'Hide', description: '', tags: ['hide'] },
				{ id: 'n1', title: 'Keep', description: '', tags: [] }
			],
			pinned: ['n0', 'n1'],
			// Stacked vertically so n1's pill (which floats above it) never covers n0.
			posByNodeId: { n0: { x: 0, y: -100 }, n1: { x: 0, y: 140 } },
			tagColorConfig: { nodeTags: { hide: '#ff0000' }, edgeTags: {} }
		}),
		defaultPrimaryNodeId: 'n1',
		initialViewState: { panX: 0, panY: 0, scale: 1 },
		layoutSettings: EXCLUSION_STORY_LAYOUT,
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		const stage = getStage(canvasElement);
		const formerCenter = getCenter(getCircle(canvasElement, 'n0'));
		const keptCenter = getCenter(getCircle(canvasElement, 'n1'));

		await typeGraphQuery(canvasElement, '-#hide');
		await waitForLayout();

		// Nothing is there to hit any more, so the right-click opens nothing.
		const event = dispatchContextMenu(stage, formerCenter.x, formerCenter.y);
		await tick();
		expect(event.defaultPrevented).toBe(true);
		expect(within(canvasElement).queryByRole('menu')).not.toBeInTheDocument();
		expect(args.onMultigraphChange).not.toHaveBeenCalled();
		expect(nodeIsDrawn(canvasElement, 'n0')).toBe(false);

		// Control: the same gesture on a node that is still there does open one.
		dispatchContextMenu(stage, keptCenter.x, keptCenter.y);
		await tick();
		expect(within(canvasElement).getByRole('menu')).toHaveAttribute(
			'aria-label',
			'Actions for Keep'
		);
	}}
/>

<Story
	name="ExcludingOneEndOfAQuantityTakesItsDerivedEdgeAway"
	args={{
		multigraphData: makeGraph({
			nodes: [
				{
					id: 'n0',
					title: 'Gravity',
					description: '$$g = 9.8$$',
					tags: ['hide'],
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
			pinned: ['n0', 'n1'],
			posByNodeId: { n0: { x: -200, y: 0 }, n1: { x: 200, y: 0 } },
			tagColorConfig: { nodeTags: { hide: '#ff0000' }, edgeTags: {} }
		}),
		defaultPrimaryNodeId: 'n1',
		layoutSettings: EXCLUSION_STORY_LAYOUT
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		expect(canvasElement.querySelector('[data-edge-id="dataflow:n0->n1"]')).toBeInTheDocument();

		await typeGraphQuery(canvasElement, '-#hide');
		await waitForLayout();

		// An excluded node defines nothing, so no arrow is left pointing at nothing.
		expect(canvasElement.querySelector('[data-edge-derived="true"]')).not.toBeInTheDocument();
		expect(nodeIsDrawn(canvasElement, 'n0')).toBe(false);
		expect(nodeIsDrawn(canvasElement, 'n1')).toBe(true);
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
		canvas.getByRole('button', { name: 'Tags' }).click();
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

		dispatchWheel(stage, wheelFactor(0.5));
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

		dispatchWheel(stage, wheelFactor(2.6), center.x, center.y);
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
		dispatchWheel(stage, wheelFactor(2.6), getCenter(getCircle(canvasElement, 'n0')).x, 0);
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
		// the same thing. `y` is what this node produces, so its chip sits in the
		// outputs and its card looks downstream: neither the false claim nor the
		// offer that followed from it is made at all.
		const card = await openPeekCard(canvasElement, 'y');
		expect(card).not.toHaveTextContent('Nothing defines y yet.');
		expect(card.querySelector('[data-create-defining-node]')).not.toBeInTheDocument();

		expect(card).toHaveAttribute('data-peek-direction', 'downstream');
		expect(card).toHaveTextContent('Nothing uses y yet.');
		// The reader's own definition is on screen above the chips; repeating it as
		// an answer to "what uses this" is what the direction rule removes.
		expect(card.querySelector('[data-peek-definer="reader"]')).toBeNull();
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

<!--
	The `!ai` add-on's whole loop, from the map: focus the node, see what a run
	would send, press Run, and read what came back. The fakes stand in for the
	model and the runtime, so what this pins is the wiring — the workbench is
	chosen over the details view, the collected inputs are the neighbours', and
	one press ends with an output asset on the node.
-->
<Story
	name="RunningAnAiNodeFromFocusLandsAnOutputInTheGrid"
	args={{
		multigraphData: AI_WORKBENCH_GRAPH,
		defaultPrimaryNodeId: 'ai',
		layoutSettings: { relaxIterations: 0 },
		assetStore: aiAssetStore(),
		assetScope: AI_SCOPE,
		aiClient: aiStoryClient(),
		aiExecutor: aiStoryExecutor(),
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		await enterFocusOn(canvasElement, 'ai');

		// The workbench, not the details view.
		const workbench = await waitFor(() => {
			const found = canvasElement.querySelector('[data-ai-workbench]');
			expect(found).toBeInTheDocument();
			return found as HTMLElement;
		});

		// The inputs a run would send: the neighbour's text and its CSV, with the
		// digest the request will carry. Grouped by node now, so the edge's tag is
		// on the neighbour's header rather than repeated on each of its files.
		const inputs = workbench.querySelectorAll('[data-ai-input]');
		expect(inputs).toHaveLength(2);
		expect(inputs[0].querySelector('[data-ai-input-name]')).toHaveTextContent('Bench sweep');
		expect(inputs[0].querySelector('[data-ai-input-label]')).toHaveTextContent('baseline');
		expect(inputs[1].querySelector('[data-ai-input-name]')).toHaveTextContent('sweep.csv');
		await waitFor(() => {
			expect(workbench.querySelector('[data-ai-digest]')).toHaveTextContent(
				't (int64), ch2 (float64)'
			);
		});

		// In the real focus frame, not just a story stage: the workbench is a
		// scroller whose `max-height: 100%` actually resolves, which is the whole
		// reason a tall one keeps its Run controls reachable. `none` here would
		// mean the layer above it never handed down a definite height.
		expect(getComputedStyle(workbench).overflowY).toBe('auto');
		expect(getComputedStyle(workbench).maxHeight).not.toBe('none');
		expect(workbench).toHaveAttribute('data-zoom-scroll');

		(workbench.querySelector('[data-ai-run]') as HTMLElement).click();

		// One run, committed once as a placeholder and once finished, with the
		// script the executor actually ran and the figure it drew.
		await waitFor(() => {
			const ai = lastChangedGraph(args).nodes.find((node) => node.id === 'ai')?.addons?.ai;
			expect(ai?.runs).toHaveLength(1);
			expect(ai?.runs[0].status).toBe('done');
			expect(ai?.script).toBe('plt.savefig("outputs/drift.png")\n');
		});

		await waitFor(() => {
			expect(canvasElement.querySelector('[data-ai-output="drift.png"]')).toBeInTheDocument();
		});
		// The reply the reader watched stream in is still on screen beside it.
		expect(canvasElement.querySelector('[data-ai-stream-text]')).toHaveTextContent(
			'Channel 2 rises steadily'
		);
	}}
/>

<!--
	Escape means "close what I am in", and a text field is one of the things a
	reader can be in. The workbench put a prompt inside the focus surface, and the
	first press used to take the surface and the deep zoom with it, from under a
	half-typed prompt. It leaves the field first now; the blur commits what was
	typed, and a second press leaves the surface.
-->
<Story
	name="EscapeLeavesTheWorkbenchPromptBeforeItLeavesTheFocus"
	args={{
		multigraphData: AI_WORKBENCH_GRAPH,
		defaultPrimaryNodeId: 'ai',
		layoutSettings: { relaxIterations: 0 },
		assetStore: aiAssetStore(),
		assetScope: AI_SCOPE,
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const dialog = await enterFocusOn(canvasElement, 'ai');
		const prompt = await waitFor(() => {
			const found = dialog.querySelector('[data-ai-prompt]');
			expect(found).toBeInTheDocument();
			return found as HTMLTextAreaElement;
		});

		prompt.focus();
		expect(document.activeElement).toBe(prompt);

		// Out of the field, still in the workbench: the narrower thing goes first.
		dispatchKeydown(prompt, 'Escape');
		expect(document.activeElement).not.toBe(prompt);
		expect(dialog.querySelector('[data-ai-workbench]')).toBeInTheDocument();
		expect(canvasElement.querySelector('[role="dialog"]')).toBeInTheDocument();

		// With no field under it, the same key means the surface.
		dispatchKeydown(document.activeElement, 'Escape');
		await waitFor(() => {
			expect(canvasElement.querySelector('[role="dialog"]')).not.toBeInTheDocument();
		});
	}}
/>

<!--
	Reading a workbench taller than the frame, in the real frame.

	The bug: `.zoom-world` had no grid template, so its one row was sized by the
	subject and the subject by its content. A tall workbench therefore made the
	world tall, `max-height: 100%` on the scroller resolved against the very
	content it was meant to bound, and the scroller had no ends — so every wheel
	went to the zoom and the reader could not scroll at all. The subject is now
	exactly the frame, and what the reader feels is the policy above the
	scroller: scroll while there is room, and nothing at either end. Leaving a
	surface you are reading is the Close button's job, not a wheel's.
-->
<Story
	name="ATallWorkbenchScrollsBeforeAWheelReachesTheZoom"
	args={{
		multigraphData: AI_WORKBENCH_GRAPH,
		defaultPrimaryNodeId: 'ai',
		layoutSettings: { relaxIterations: 0 },
		assetStore: aiAssetStore(),
		assetScope: AI_SCOPE,
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const dialog = await enterFocusOn(canvasElement, 'ai');
		const workbench = await waitFor(() => {
			const found = dialog.querySelector('[data-ai-workbench]');
			expect(found).toBeInTheDocument();
			return found as HTMLElement;
		});
		const world = dialog.querySelector('.zoom-world') as HTMLElement;
		const subject = dialog.querySelector('.zoom-world-subject') as HTMLElement;

		// The sizing everything below depends on: the subject is the frame, not
		// whatever its content grew to.
		expect(subject.offsetHeight).toBe(world.clientHeight);

		// Taller than the frame — added here rather than fixtured, so the story
		// says out loud what it is testing.
		appendTallFiller(workbench);
		await waitFor(() => {
			expect(workbench.scrollHeight).toBeGreaterThan(workbench.clientHeight);
		});
		// ...and still bounded by it, which is what gives the scroller ends.
		expect(workbench.clientHeight).toBeLessThanOrEqual(world.clientHeight);
		expect(subject.offsetHeight).toBe(world.clientHeight);

		// With room below, the wheel is the browser's: the world does not take it
		// and does not move.
		expect(wheelWasTaken(workbench, 120)).toBe(false);
		expect(world.dataset.zoomWorldScale).toBe('1');
		// The scroll a real wheel would have done; a synthetic one does nothing.
		workbench.scrollTop = 240;
		expect(workbench.scrollTop).toBeGreaterThan(0);

		// Back at the top, a wheel-in is not a request to magnify a page of
		// controls: the world takes it and does nothing with it.
		workbench.scrollTop = 0;
		expect(wheelWasTaken(workbench, -120)).toBe(true);
		expect(world.dataset.zoomWorldScale).toBe('1');

		// At the bottom the wheel-out is not an exit: however many arrive, and
		// however hard, the world takes each one and does nothing with it. The
		// reader is reading, and reading is not leaving.
		workbench.scrollTop = workbench.scrollHeight;
		for (let attempt = 0; attempt < 8; attempt += 1) {
			expect(wheelWasTaken(workbench, WHEEL_SLAM_OUT)).toBe(true);
			await sleep(60);
		}
		expect(world.dataset.zoomWorldScale).toBe('1');
		await expectFocusOn(canvasElement, 'ai');

		// Close is the way out, and it works from exactly here.
		(dialog.querySelector('.focus-close-button') as HTMLElement).click();
		await waitFor(() => {
			expect(canvasElement.querySelector('.focus-surface')).not.toBeInTheDocument();
		});
	}}
/>

<!--
	A disclosure inside deep zoom, pressed the way a reader presses one.

	The bug: `ZoomWorld` captures the pointer to pan with it, and a capture
	retargets the `pointerup` — and so the `click` — at the world. Only controls
	were exempt, and a `<summary>` was not on that list, so "What Claude will see"
	could not be opened from inside focus at all. The exemption now covers
	disclosures and labels too (`lib/interactiveContent.ts`).
-->
<Story
	name="ADisclosureInsideDeepZoomOpensToAPress"
	args={{
		multigraphData: AI_WORKBENCH_GRAPH,
		defaultPrimaryNodeId: 'ai',
		layoutSettings: { relaxIterations: 0 },
		assetStore: aiAssetStore(),
		assetScope: AI_SCOPE,
		aiExecutor: aiStoryExecutor(),
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const dialog = await enterFocusOn(canvasElement, 'ai');
		const world = dialog.querySelector('.zoom-world') as HTMLElement;

		// The digest's disclosure, once the probe has measured the file.
		const summary = await waitFor(() => {
			const found = dialog.querySelector('[data-ai-input-kind="file"] details summary');
			expect(found).toBeInTheDocument();
			return found as HTMLElement;
		});
		const details = summary.closest('details') as HTMLDetailsElement;
		expect(details.open).toBe(false);

		// The press first — this is the half that used to be swallowed — and then
		// the click it should have been allowed to become.
		const center = getCenter(summary);
		summary.dispatchEvent(
			new PointerEvent('pointerdown', {
				bubbles: true,
				cancelable: true,
				pointerId: 1,
				clientX: center.x,
				clientY: center.y
			})
		);
		summary.click();

		await waitFor(() => expect(details.open).toBe(true));
		// And the world never claimed the press — the half a synthetic pointer
		// cannot show, since it carries no real capture to retarget the click with.
		expect(world.dataset.zoomWorldPointers).toBe('0');
		expect(world.dataset.zoomWorldScale).toBe('1');
		expect(world.dataset.zoomWorldPanX).toBe('0');
		expect(world.dataset.zoomWorldPanY).toBe('0');
	}}
/>

<!--
	The other content the same frame holds: the plain details view, which has no
	scroller on purpose (it reads by zooming) and is simply clipped where the
	frame ends. Binding the subject to the frame must not have changed that —
	and the one scroller the details view does carry, the peek card's cascade,
	still takes its own wheel.
-->
<Story
	name="TheDetailsViewStillClipsToTheFrameWhileThePeekCardScrolls"
	args={{
		multigraphData: CONFIRM_FROM_A_PEEK,
		defaultPrimaryNodeId: 'reader',
		layoutSettings: NO_REVEALS,
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const dialog = await enterFocusOn(canvasElement, 'reader');
		const world = dialog.querySelector('.zoom-world') as HTMLElement;
		const subject = dialog.querySelector('.zoom-world-subject') as HTMLElement;
		const content = dialog.querySelector('.focus-content') as HTMLElement;

		// Nothing here is a scroll container — checked before the peek card, which
		// deliberately adds the only one this surface ever has.
		for (const element of [content, ...content.querySelectorAll('*')]) {
			const { overflowX, overflowY } = getComputedStyle(element);
			expect([overflowX, overflowY]).not.toContain('scroll');
			expect([overflowX, overflowY]).not.toContain('auto');
		}

		// Content taller than the frame overflows it and is clipped, exactly as
		// before — what it must not do any more is make the frame taller.
		expect(subject.offsetHeight).toBe(world.clientHeight);
		appendTallFiller(content);
		await waitFor(() => {
			expect(content.getBoundingClientRect().bottom).toBeGreaterThan(
				world.getBoundingClientRect().bottom
			);
		});
		expect(subject.offsetHeight).toBe(world.clientHeight);

		// The peek card's cascade is a marked scroller, so a wheel with room left
		// in it belongs to the browser and the world stays put.
		const card = await openPeekCard(canvasElement, 'g');
		const scroller = card.querySelector('[data-peek-scroll]') as HTMLElement;
		appendTallFiller(scroller, 800);
		await waitFor(() => {
			expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
		});
		scroller.scrollTop = 0;
		expect(wheelWasTaken(scroller, 120)).toBe(false);
		expect(world.dataset.zoomWorldScale).toBe('1');

		// And a wheel over the description, which is inside no scroller at all,
		// still zooms the world.
		const description = content.querySelector('.description') as HTMLElement;
		expect(wheelWasTaken(description, wheelFactor(2))).toBe(true);
		await waitFor(() => {
			expect(Number(world.dataset.zoomWorldScale)).toBeGreaterThan(1);
		});
	}}
/>

<!--
	Promote, from the map: an output the reader wants to keep becomes a node of
	its own, joined to the analysis that drew it. The commit goes through the
	same write path every other edit takes, so what this pins is the shape of
	what lands — a node titled by the filename, carrying the figure, on a
	directed edge out of the AI node — and that the reader stays where they were.
-->
<Story
	name="PromotingAnOutputGivesItANodeOfItsOwn"
	args={{
		multigraphData: AI_PROMOTE_GRAPH,
		defaultPrimaryNodeId: 'ai',
		layoutSettings: { relaxIterations: 0 },
		assetStore: aiPlotStore(),
		assetScope: AI_SCOPE,
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		await enterFocusOn(canvasElement, 'ai');

		const workbench = await waitFor(() => {
			const found = canvasElement.querySelector('[data-ai-workbench]');
			expect(found).toBeInTheDocument();
			return found as HTMLElement;
		});
		(workbench.querySelector(`[data-ai-promote="${AI_PLOT_NAME}"]`) as HTMLElement).click();

		// A node titled by the filename, holding the run's figure, and a directed
		// edge saying which way the data went.
		const promotedNodeId = await waitFor(() => {
			const graph = lastChangedGraph(args);
			const node = graph.nodes.find((candidate) => candidate.title === AI_PLOT_NAME);
			expect(node?.content).toEqual([
				{ type: 'image', assetId: AI_PLOT_ASSET_ID, alt: AI_PLOT_NAME }
			]);
			expect(graph.edges).toEqual([
				expect.objectContaining({
					sourceNodeId: 'ai',
					targetNodeId: node?.id,
					directed: true,
					tags: []
				})
			]);
			return node?.id ?? '';
		});
		// And the binding, which is what the next run refreshes in place.
		const ai = lastChangedGraph(args).nodes.find((node) => node.id === 'ai')?.addons?.ai;
		expect(ai?.promoted).toEqual({ [AI_PLOT_NAME]: promotedNodeId });

		// The reader has not gone anywhere: they are still in the workbench, and
		// the row they pressed now names where the figure lives.
		await expectFocusOn(canvasElement, 'ai');
		await waitFor(() => {
			const row = canvasElement.querySelector(`[data-ai-output="${AI_PLOT_NAME}"]`);
			expect(row?.querySelector('[data-ai-promote]')).toBeNull();
			expect(row?.querySelector(`[data-ai-jump="${promotedNodeId}"]`)).toHaveTextContent(
				AI_PLOT_NAME
			);
		});
	}}
/>

<!--
	The reported blank, chased in the real focus frame.

	A reader pressed Replace on a neighbour's CSV and everything inside the deep
	zoom went blank. The one thing their browser did that no story had done is
	take the window away while the native dialog was up — `visibilityState` goes
	`hidden`, `window` takes a `blur`, and the page's `visibilitychange` handler
	flushes the pending save on the way. So this does all of that, in order, and
	checks the surface after every step: the workbench root with its groups, its
	outputs and its prose disclosure, the details layer still fully opaque, and
	nothing on `console.error`.

	It does not reproduce. What it pins instead is that none of those events can
	blank this surface — so the next report has somewhere narrower to start.

	One thing a component story cannot cover: the `visibilitychange` handler that
	flushes the pending save lives in `routes/+page.svelte`, which is not mounted
	here. What that handler reaches is `flushPendingSave`, and the only path out
	of it that can take a focus surface away is a `storage` event — which is
	raised in *other* tabs, never in the one that wrote.
-->
<Story
	name="LosingTheWindowToAFileDialogLeavesTheWorkbenchOnScreen"
	args={{
		multigraphData: AI_REPLACE_GRAPH,
		defaultPrimaryNodeId: 'ai',
		layoutSettings: { relaxIterations: 0 },
		assetStore: aiReplaceStore(),
		assetScope: AI_SCOPE,
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		const errors: string[] = [];
		const realConsoleError = console.error;
		console.error = (...parts: unknown[]) => {
			errors.push(parts.map((part) => String(part)).join(' '));
		};

		try {
			await waitForLayout();
			const dialog = await enterFocusOn(canvasElement, 'ai');

			/** Everything the reader says went blank, checked in one place. */
			const expectStillDrawn = async (step: string): Promise<void> => {
				const workbench = dialog.querySelector('[data-ai-workbench]');
				expect(workbench, step).toBeInTheDocument();
				const root = workbench as HTMLElement;
				// The two input groups: this node, and the neighbour whose file it is.
				expect(root.querySelectorAll('[data-ai-input-group]'), step).toHaveLength(2);
				// Both figures the run drew, and the prose fold above them. The images
				// are checked as images, not as rows: `AiNodeContent` falls back to a
				// name-only placeholder when its object URL is gone, and a placeholder
				// where a plot was is one of the things "went blank" could mean.
				expect(root.querySelectorAll('[data-ai-output]'), step).toHaveLength(2);
				const figures = [...root.querySelectorAll('[data-ai-output] img[data-asset-id]')];
				expect(figures, step).toHaveLength(2);
				for (const figure of figures) {
					expect(figure.getAttribute('src') ?? '', step).toMatch(/^blob:/u);
				}
				expect(root.querySelector('[data-ai-prose]'), step).toBeInTheDocument();
				// The promoted figure's binding, which is the row that names a node.
				expect(
					root.querySelector(`[data-ai-jump="${AI_PROMOTED_NODE_ID}"]`),
					step
				).toBeInTheDocument();
				// And the layer it is all drawn on, at full opacity: a details layer
				// faded to 0 is exactly what "blank inside the frame" would look like.
				const layer = dialog.querySelector('[data-morph-layer="details"]') as HTMLElement;
				expect(getComputedStyle(layer).opacity, step).toBe('1');
				expect(errors, step).toEqual([]);
			};

			await waitFor(() => {
				expect(dialog.querySelector('[data-ai-output] img[data-asset-id]')).toBeInTheDocument();
			});
			await expectStillDrawn('opened');

			// The window goes, and comes back — twice, because a reader who cancels
			// a dialog and opens it again does it twice too.
			await withDocumentHidden(async () => {
				await tick();
				await expectStillDrawn('hidden');
			});
			await expectStillDrawn('visible again');
			await withDocumentHidden(() => tick());
			await expectStillDrawn('hidden and back a second time');

			// And now the press itself, with the window lost across it exactly as a
			// native dialog loses it: opened hidden, the file chosen, the window back.
			// The picker is the hidden input the Replace button clicks, which is
			// where the browser delivers the file (see `.file-picker`).
			const replace = dialog.querySelector(
				`[data-ai-replace-file-input="${AI_CSV_ASSET_ID}"]`
			) as HTMLInputElement;
			expect(replace).toBeInTheDocument();
			await withDocumentHidden(() => {
				pickFileInto(replace, new File(['t,ch2\n0,9.9\n'], 'sweep.csv', { type: 'text/csv' }));
			});

			// The commit lands — the block keeps its name over a new asset id — and
			// the surface the reader is standing on is still the one they were on.
			const replacedAssetId = await waitFor(() => {
				const block = lastChangedGraph(args)
					.nodes.find((node) => node.id === 'sweep')
					?.content?.find((entry) => entry.type === 'file');
				expect(block?.name).toBe('sweep.csv');
				expect(block?.assetId).not.toBe(AI_CSV_ASSET_ID);
				return block?.assetId ?? '';
			});
			await expectFocusOn(canvasElement, 'ai');
			await waitFor(() => {
				expect(
					dialog.querySelector(`[data-ai-input-asset-id="${replacedAssetId}"]`)
				).toBeInTheDocument();
			});
			await expectStillDrawn('replaced');
		} finally {
			console.error = realConsoleError;
		}
	}}
/>

<!--
	The blank itself, from the mechanism rather than from the gesture.

	The reader pressed Replace and everything inside the deep zoom went blank.
	Their DOM said what had happened: the frame was exactly where it belonged,
	and the content layer inside it sat at `top: -1863` — an `overflow: hidden`
	box had been scrolled. That is what focusing the hidden file input under the
	old `<label>` did: the browser brings a newly focused element into view by
	scrolling every scrollable ancestor, `overflow: hidden` stops the *reader*
	scrolling and nothing else, and inside a transform-scaled content layer the
	arithmetic lands a long way off. It depended on the window's size, which is
	why no other machine ever saw it.

	Two halves, both pinned here. The frame is scrolled the way the browser
	scrolled it and puts itself back (`lib/pinScroll.ts`), and the picker is
	focused outright — which now moves nothing, because it is a `position: fixed`
	input behind a real button instead of a label the press focuses.
-->
<Story
	name="AFocusInsideTheFrameCannotScrollItsContentOffScreen"
	args={{
		multigraphData: AI_REPLACE_GRAPH,
		defaultPrimaryNodeId: 'ai',
		layoutSettings: { relaxIterations: 0 },
		assetStore: aiReplaceStore(),
		assetScope: AI_SCOPE,
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const dialog = await enterFocusOn(canvasElement, 'ai');
		// The frame is `NodeChrome`'s `.circle`, the one bordered box of the level.
		const frame = dialog.querySelector('.deep-zoom-layer .circle') as HTMLElement;
		const layer = dialog.querySelector('[data-morph-layer="details"]') as HTMLElement;
		await waitFor(() => {
			expect(dialog.querySelector('[data-ai-workbench]')).toBeInTheDocument();
		});

		// Scroll anchoring is the other thing that moves a box nobody scrolled.
		expect(getComputedStyle(frame).overflowAnchor).toBe('none');

		/** How far the content layer sits from the top of the frame that clips it. */
		const contentOffset = (): number =>
			layer.getBoundingClientRect().top - frame.getBoundingClientRect().top;
		expect(contentOffset()).toBeCloseTo(0, 0);

		// "It does not scroll" says nothing until there is somewhere to scroll to:
		// the reader's window had room below the content and a headless one need
		// not. A tall block inside the content layer overflows the frame the same
		// way their workbench did.
		const filler = appendTallFiller(layer, 2400);
		await waitFor(() => {
			expect(frame.scrollHeight).toBeGreaterThan(frame.clientHeight);
		});

		// Exactly what their browser did, in one line, at the distance it chose.
		frame.scrollTop = 1863;
		await waitFor(() => expect(frame.scrollTop).toBe(0));
		expect(contentOffset()).toBeCloseTo(0, 0);

		// And the focus that asked for it. Nothing should move — the picker is out
		// of the surface's flow behind a button now — and if a browser still tries,
		// the pin above is what catches it.
		const picker = dialog.querySelector(
			`[data-ai-replace-file-input="${AI_CSV_ASSET_ID}"]`
		) as HTMLInputElement;
		expect(picker).toBeInTheDocument();
		picker.focus();
		await waitFor(() => expect(frame.scrollTop).toBe(0));
		expect(frame.scrollLeft).toBe(0);
		expect(contentOffset()).toBeCloseTo(0, 0);

		// Which is to say: the workbench is still on screen, which is the whole
		// report.
		expect(dialog.querySelector('[data-ai-workbench]')).toBeInTheDocument();
		expect(getComputedStyle(layer).opacity).toBe('1');
		filler.remove();
	}}
/>

<Story
	name="DraggingScaleFalloffResizesNodesUnderTheFinger"
	play={async ({ canvasElement }: HarnessPlayContext) => {
		await waitForLayout();
		const harness = getSettingsHarness(canvasElement);
		const shippedFalloff = APP_CONFIG.multigraph.layout.scaleFalloff;

		// One hop off the pin, so the node's size is exactly the falloff.
		expect(nodeScale(canvasElement, 'n1')).toBeCloseTo(shippedFalloff, 5);

		const slider = settingsSlider(canvasElement, 'Scale falloff per hop');
		dragSettingsSlider(slider, [0.55, 0.4, 0.3], false);

		// The point of the whole preview channel: the graph is already drawn at the
		// new value while the pointer is still down, so the reader is choosing by
		// looking rather than by releasing and undoing.
		await waitFor(() => expect(nodeScale(canvasElement, 'n1')).toBeCloseTo(0.3, 5));
		expect(getNodeWrapper(canvasElement, 'n1').style.transform).toContain('scale(0.3)');

		// Nothing has been persisted yet: three moves, no save.
		expect(harness.dataset.settingsChangeCount).toBe('0');
		expect(harnessSettings(canvasElement)).toEqual({});

		slider.dispatchEvent(new Event('change', { bubbles: true }));

		await waitFor(() => expect(harness.dataset.settingsChangeCount).toBe('1'));
		expect(harnessSettings(canvasElement)).toEqual({ 'multigraph.layout.scaleFalloff': 0.3 });
		// The handoff from the transient preview to the committed override is
		// invisible: the size the reader chose is the size that stays.
		expect(nodeScale(canvasElement, 'n1')).toBeCloseTo(0.3, 5);
	}}
>
	{#snippet template()}
		<MultigraphSettingsHarness
			multigraphData={SETTINGS_HOP_CHAIN}
			defaultPrimaryNodeId="n0"
			layoutSettings={SETTINGS_STILL_LAYOUT}
			panelOpenAtMount
		/>
	{/snippet}
</Story>

<Story
	name="DraggingEdgeSpringStrengthStartsTheFrameLoop"
	play={async ({ canvasElement }: HarnessPlayContext) => {
		await waitForLayout();
		const harness = getSettingsHarness(canvasElement);
		const graph = getGraphElement(canvasElement);
		const nodeIds = ['n0', 'n1'];

		// A physics setting shows nothing at rest, so the story has to establish
		// that the graph really was at rest — otherwise the movement it asserts
		// later could be a settle that was already running.
		expect(graph.dataset.settling).toBeUndefined();
		const before = nodePositions(canvasElement, nodeIds);
		await waitForFrames(4);
		expect(nodePositions(canvasElement, nodeIds)).toEqual(before);

		const slider = settingsSlider(canvasElement, 'Edge spring strength');
		dragSettingsSlider(slider, [0.5, 1], false);

		// The settle kick: `physics` fields are read per frame, so without the loop
		// running a change to one of them would be invisible until the next drag.
		await waitFor(() => expect(graph.dataset.settling).toBe('true'));
		await waitForFrames(20);

		const after = nodePositions(canvasElement, nodeIds);
		// n0 is pinned, so the spring can only pull the free end toward it.
		expect(distanceBetween(before.n0, after.n0)).toBe(0);
		expect(distanceBetween(before.n1, after.n1)).toBeGreaterThan(0);
		// The spring pulls: whatever else moved, the two ends are closer.
		expect(distanceBetween(after.n0, after.n1)).toBeLessThan(distanceBetween(before.n0, before.n1));

		// Still nothing persisted — the pointer never came up.
		expect(harness.dataset.settingsChangeCount).toBe('0');
		expect(harnessSettings(canvasElement)).toEqual({
			'multigraph.layout.edgeSpringStrength': 0
		});
	}}
>
	{#snippet template()}
		<MultigraphSettingsHarness
			multigraphData={SETTINGS_SPRING_PAIR}
			defaultPrimaryNodeId="n0"
			layoutSettings={{ hopRepulsionStrength: 0 }}
			initialSettings={{ 'multigraph.layout.edgeSpringStrength': 0 }}
			panelOpenAtMount
		/>
	{/snippet}
</Story>

<Story
	name="ASliderDragPersistsOnceOnRelease"
	play={async ({ canvasElement }: HarnessPlayContext) => {
		await waitForLayout();
		const harness = getSettingsHarness(canvasElement);
		const slider = settingsSlider(canvasElement, 'Scale falloff per hop');

		// Sixty of these a second reach the canvas; none of them may reach the save
		// scheduler, which is the whole reason preview and commit are two channels.
		dragSettingsSlider(slider, [0.65, 0.6, 0.55, 0.5, 0.45], false);
		await waitFor(() => expect(nodeScale(canvasElement, 'n1')).toBeCloseTo(0.45, 5));
		expect(harness.dataset.settingsChangeCount).toBe('0');

		slider.dispatchEvent(new Event('change', { bubbles: true }));
		await waitFor(() => expect(harness.dataset.settingsChangeCount).toBe('1'));

		// `pointerup` after `change` is the other half of a real release, and the
		// commit is idempotent across the pair.
		slider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
		await waitForFrames(2);
		expect(harness.dataset.settingsChangeCount).toBe('1');
		expect(harnessSettings(canvasElement)).toEqual({ 'multigraph.layout.scaleFalloff': 0.45 });
	}}
>
	{#snippet template()}
		<MultigraphSettingsHarness
			multigraphData={SETTINGS_HOP_CHAIN}
			defaultPrimaryNodeId="n0"
			layoutSettings={SETTINGS_STILL_LAYOUT}
			panelOpenAtMount
		/>
	{/snippet}
</Story>

<Story
	name="ASettingsChangeDoesNotRemountTheCanvas"
	play={async ({ canvasElement }: HarnessPlayContext) => {
		await waitForLayout();
		const harness = getSettingsHarness(canvasElement);
		const stage = getStage(canvasElement);
		const circle = getCircle(canvasElement, 'n0');
		const center = getCenter(circle);
		const moveToX = center.x + NODE_RADIUS + 20;
		const moveToY = center.y - 40;

		// Put the node somewhere only this reader would have put it, with the panel
		// still closed so nothing overlays the canvas during the gesture.
		dispatchPointer(circle, 'pointerdown', center.x, center.y);
		dispatchPointer(stage, 'pointermove', moveToX, moveToY);
		dispatchPointer(stage, 'pointerup', moveToX, moveToY);
		await waitForFrames(4);

		const graphBefore = getGraphElement(canvasElement);
		const wrapperBefore = getNodeWrapper(canvasElement, 'n0');
		const positionBefore = nodePosition(canvasElement, 'n0');
		expect(positionBefore.x).toBeGreaterThan(0);

		within(canvasElement).getByRole('button', { name: 'Settings' }).click();
		await waitFor(() => expect(harness.dataset.settingsPanelOpen).toBe('true'));

		dragSettingsSlider(settingsSlider(canvasElement, 'Node text size'), [72]);
		await waitFor(() => expect(harness.dataset.settingsChangeCount).toBe('1'));
		await waitFor(() => expect(nodeTextFontSize(canvasElement, 'n0')).toBe('72px'));

		// Settings ride beside `viewState`, never inside `MultigraphData`, and
		// `notifySettingsChanged` leaves `graphGeneration` alone — so the canvas
		// this reader arranged is the same canvas, not a fresh one at a fresh
		// layout. Element identity is the strongest available witness to that.
		expect(getGraphElement(canvasElement)).toBe(graphBefore);
		expect(getNodeWrapper(canvasElement, 'n0')).toBe(wrapperBefore);
		expect(nodePosition(canvasElement, 'n0')).toEqual(positionBefore);
	}}
>
	{#snippet template()}
		<MultigraphSettingsHarness
			multigraphData={SETTINGS_SINGLE_NODE}
			defaultPrimaryNodeId="n0"
			layoutSettings={SETTINGS_STILL_LAYOUT}
		/>
	{/snippet}
</Story>
<!--
	Node size as border width. With the shipped `borderWeight` defaults (1 MiB
	reference, 0.15 per doubling, ×0.5..×3) and an 8 px border: 10 KiB sits on
	the ×0.5 floor (4 px), 1 MiB draws the configured 8 px, 100 MiB draws
	8 × (1 + 0.15 × log2 100) ≈ 15.97 px, and a node with no size draws 8 px.
-->
<Story
	name="NodesWithLargerSizesDrawThickerBorders"
	args={{
		multigraphData: SIZED_SPOKES,
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { relaxIterations: 0 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const small = nodeBorderWidths(canvasElement, 'n1');
		const reference = nodeBorderWidths(canvasElement, 'n2');
		const large = nodeBorderWidths(canvasElement, 'n3');
		const sizeless = nodeBorderWidths(canvasElement, 'n4');

		expect(small.asked).toBeCloseTo(4, 5);
		expect(reference.asked).toBeCloseTo(8, 5);
		expect(large.asked).toBeCloseTo(15.97, 1);
		expect(sizeless.asked).toBeCloseTo(8, 5);

		// What the reader sees, not just what was asked for.
		expect(small.rendered).toBeLessThan(reference.rendered);
		expect(reference.rendered).toBeLessThan(large.rendered);
		expectDrawnBorder(small.rendered, 4);
		expectDrawnBorder(reference.rendered, 8);
		expectDrawnBorder(large.rendered, large.asked);
		expectDrawnBorder(sizeless.rendered, 8);

		// Size is border only: every spoke is one hop out and drawn at one scale.
		const scales = ['n1', 'n2', 'n3', 'n4'].map((id) => nodeScale(canvasElement, id));
		expect(new Set(scales).size).toBe(1);
	}}
/>

<Story
	name="APinnedSizedNodeScalesItsBorderLikeAnyOther"
	args={{
		multigraphData: makeGraph({ nodeCount: 1, pinned: [0], sizeBytes: { 0: 100 * MIB } }),
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { relaxIterations: 0 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const circle = getCircle(canvasElement, 'n0');
		expect(circle).toHaveAttribute('data-pinned', 'true');

		// Pinned nodes share the node border width (no separate pinned width), so
		// the size factor lands on `--node-border-width` and the drawn border.
		const widths = nodeBorderWidths(canvasElement, 'n0');
		expect(widths.asked).toBeCloseTo(15.97, 1);
		expectDrawnBorder(widths.rendered, widths.asked);
		// The pin still reads as a pin: darker border, white halo.
		expect(getComputedStyle(circle).borderTopColor).toBe('rgb(85, 85, 85)');
		expect(getComputedStyle(circle).boxShadow).toContain('rgb(255, 255, 255)');
	}}
/>

<Story
	name="TagColoursFillASizedBorder"
	args={{
		multigraphData: makeGraph({
			nodes: [
				{ id: 'hub', title: 'Hub', description: '', tags: [] },
				{ id: 'big', title: 'Big', description: '', tags: ['topic'] }
			],
			pinned: ['hub'],
			edges: [{ source: 'hub', target: 'big' }],
			sizeBytes: { big: 100 * MIB },
			posByNodeId: { hub: { x: -240, y: 0 }, big: { x: 240, y: 0 } },
			tagColorConfig: { nodeTags: { topic: '#ff0000' }, edgeTags: {} }
		}),
		defaultPrimaryNodeId: 'hub',
		layoutSettings: { relaxIterations: 0 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const circle = getCircle(canvasElement, 'big');
		expect(circle).toHaveAttribute('data-tag-border', 'true');
		expect(circle.style.getPropertyValue('--node-tag-border')).toContain('#ff0000');

		const widths = nodeBorderWidths(canvasElement, 'big');
		expect(widths.asked).toBeCloseTo(15.97, 1);
		expectDrawnBorder(widths.rendered, widths.asked);
		// The colour is painted into the border box, so a wider border is a wider
		// ring: the border itself stays transparent over the gradient.
		expect(getComputedStyle(circle).borderTopColor).toBe('rgba(0, 0, 0, 0)');
	}}
/>

<!--
	`nodeChromeFor` reads `cfg` per render, so the "Border weight" sliders are
	instant: 0.15 → 0.25 per doubling takes the 100 MiB node from ≈ 15.97 px to
	8 × (1 + 0.25 × log2 100) ≈ 21.3 px while the pointer is still down.
-->
<Story
	name="DraggingWidthPerDoublingRedrawsBordersLive"
	play={async ({ canvasElement }: HarnessPlayContext) => {
		await waitForLayout();
		const harness = getSettingsHarness(canvasElement);
		expect(nodeBorderWidths(canvasElement, 'n3').asked).toBeCloseTo(15.97, 1);

		const slider = settingsSlider(canvasElement, 'Width per doubling');
		dragSettingsSlider(slider, [0.2, 0.25], false);

		await waitFor(() => expect(nodeBorderWidths(canvasElement, 'n3').asked).toBeCloseTo(21.3, 1));
		const live = nodeBorderWidths(canvasElement, 'n3');
		expectDrawnBorder(live.rendered, live.asked);
		// The reference-sized and sizeless nodes do not move with the slope.
		expect(nodeBorderWidths(canvasElement, 'n2').asked).toBeCloseTo(8, 5);
		expect(nodeBorderWidths(canvasElement, 'n4').asked).toBeCloseTo(8, 5);
		expect(harness.dataset.settingsChangeCount).toBe('0');
		expect(harnessSettings(canvasElement)).toEqual({});

		slider.dispatchEvent(new Event('change', { bubbles: true }));
		await waitFor(() => expect(harness.dataset.settingsChangeCount).toBe('1'));
		expect(harnessSettings(canvasElement)).toEqual({
			'multigraph.borderWeight.widthPerDoubling': 0.25
		});
		expect(nodeBorderWidths(canvasElement, 'n3').asked).toBeCloseTo(21.3, 1);
	}}
>
	{#snippet template()}
		<MultigraphSettingsHarness
			multigraphData={SIZED_SPOKES}
			defaultPrimaryNodeId="n0"
			layoutSettings={SETTINGS_STILL_LAYOUT}
			panelOpenAtMount
		/>
	{/snippet}
</Story>

<!--
	The sized twin of `MorphSurfaceMatchesInStageNodeAtProgressZero`: the morph
	starts from the subject's own sized border, so entering and leaving focus on
	a 100 MiB node does not jump between ≈ 15.97 px and the default 8 px.
-->
<Story
	name="SizedMorphSurfaceMatchesInStageNodeAtProgressZero"
	args={{
		multigraphData: makeGraph({
			nodeCount: 1,
			pinned: [0],
			sizeBytes: { 0: 100 * MIB },
			posByNodeId: { n0: { x: 0, y: 0 } }
		}),
		defaultPrimaryNodeId: 'n0',
		initialViewState: { panX: 0, panY: 0, scale: 0.95 },
		layoutSettings: { relaxIterations: 0 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		expect(nodeBorderWidths(canvasElement, 'n0').asked).toBeCloseTo(15.97, 1);
		await expectMorphStartsFromTheNodesBorder(canvasElement, 'n0', 4);
	}}
/>

<!--
	The morph reads the same per-node border as the canvas whatever the source:
	under "Edge count" the five-edge (pinned) hub's border is
	8 × (1 + 0.15 × log2(5/3)) ≈ 8.88 px, and the surface starts from that rather
	than from the default 8 px.
-->
<Story
	name="TheMorphStartsFromADegreeWeightedBorder"
	args={{
		multigraphData: DEGREE_HUB,
		defaultPrimaryNodeId: 'hub',
		initialViewState: { panX: 0, panY: 0, scale: 0.95 },
		layoutSettings: { relaxIterations: 0 },
		settings: { [BORDER_SOURCE]: 'degree' }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		expect(nodeBorderWidths(canvasElement, 'hub').asked).toBeCloseTo(curveWidth(5, 3), 5);
		// 0.88 px above the default before scaling; half a pixel clears it at any
		// visual scale this story reaches, and still fails on the unweighted 8 px.
		await expectMorphStartsFromTheNodesBorder(canvasElement, 'hub', 0.5);
	}}
/>

<!--
	Border width sources. Each story picks one through the graph's settings and
	asserts both the width each `.circle` is told to draw and what it draws.
	With the shipped curve (0.15 per doubling, ×0.5..×3) and an 8 px base.
-->
<Story
	name="AHubDrawsAThickerBorderThanItsLeavesUnderEdgeCount"
	args={{
		multigraphData: DEGREE_HUB,
		defaultPrimaryNodeId: 'hub',
		layoutSettings: { relaxIterations: 0 },
		settings: { [BORDER_SOURCE]: 'degree' }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		// Five edges against a reference of three: 8 × (1 + 0.15 × log2(5/3)) ≈ 8.88 px.
		const hub = nodeBorderWidths(canvasElement, 'hub');
		expect(hub.asked).toBeCloseTo(curveWidth(5, 3), 5);
		expectDrawnBorder(hub.rendered, hub.asked);

		// One edge each: 8 × (1 + 0.15 × log2(1/3)) ≈ 6.10 px.
		for (const id of ['a', 'b', 'c', 'd', 'e']) {
			const leaf = nodeBorderWidths(canvasElement, id);
			expect(leaf.asked).toBeCloseTo(curveWidth(1, 3), 5);
			expectDrawnBorder(leaf.rendered, leaf.asked);
			expect(leaf.rendered).toBeLessThan(hub.rendered);
		}

		// No edges is a real count of 0, so the loner sits on the ×0.5 floor rather
		// than drawing the configured border a node with no value would.
		const loner = nodeBorderWidths(canvasElement, 'loner');
		expect(loner.asked).toBeCloseTo(4, 5);
		expectDrawnBorder(loner.rendered, 4);
	}}
/>

<Story
	name="NodesWithMoreAttachmentsDrawThickerBorders"
	args={{
		multigraphData: ATTACHMENT_SPOKES,
		defaultPrimaryNodeId: 'hub',
		layoutSettings: { relaxIterations: 0 },
		settings: { [BORDER_SOURCE]: 'attachments' }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		const none = nodeBorderWidths(canvasElement, 'none');
		const one = nodeBorderWidths(canvasElement, 'one');
		const four = nodeBorderWidths(canvasElement, 'four');

		// 0 → the floor, 1 → the reference, 4 → 8 × (1 + 0.15 × 2) = 10.4 px.
		expect(none.asked).toBeCloseTo(4, 5);
		expect(one.asked).toBeCloseTo(8, 5);
		expect(four.asked).toBeCloseTo(10.4, 5);
		expectDrawnBorder(none.rendered, 4);
		expectDrawnBorder(one.rendered, 8);
		expectDrawnBorder(four.rendered, 10.4);
		expect(none.rendered).toBeLessThan(one.rendered);
		expect(one.rendered).toBeLessThan(four.rendered);
		// The hub has nothing attached either.
		expect(nodeBorderWidths(canvasElement, 'hub').asked).toBeCloseTo(4, 5);
	}}
/>

<Story
	name="LongerDescriptionsDrawThickerBorders"
	args={{
		multigraphData: DESCRIPTION_SPOKES,
		defaultPrimaryNodeId: 'hub',
		layoutSettings: { relaxIterations: 0 },
		settings: { [BORDER_SOURCE]: 'descriptionLength' }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		// Against a 200-character reference: 0 → floor, 50 → ×0.7, 200 → ×1, 800 → ×1.3.
		const expected: Array<[string, number]> = [
			['d0', 4],
			['d50', 5.6],
			['d200', 8],
			['d800', 10.4]
		];
		let previous = 0;
		for (const [id, width] of expected) {
			const widths = nodeBorderWidths(canvasElement, id);
			expect(widths.asked).toBeCloseTo(width, 5);
			expectDrawnBorder(widths.rendered, width);
			expect(widths.rendered).toBeGreaterThan(previous);
			previous = widths.rendered;
		}
	}}
/>

<Story
	name="NodeWeightDrawsTheBorderAndZeroIsTheThinnest"
	args={{
		multigraphData: WEIGHT_SPOKES,
		defaultPrimaryNodeId: 'hub',
		layoutSettings: { relaxIterations: 0 },
		settings: { [BORDER_SOURCE]: 'weight' }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		// No weight is "unknown" and draws the configured border; 0 is a real
		// weight and lands on the floor; 8 against a reference of 1 is ×1.45.
		const expected: Array<[string, number]> = [
			['absent', 8],
			['w0', 4],
			['w1', 8],
			['w8', 11.6]
		];
		for (const [id, width] of expected) {
			const widths = nodeBorderWidths(canvasElement, id);
			expect(widths.asked).toBeCloseTo(width, 5);
			expectDrawnBorder(widths.rendered, width);
		}
		// The hub has no weight, so it draws the configured border.
		expect(nodeBorderWidths(canvasElement, 'hub').asked).toBeCloseTo(8, 5);
	}}
/>

<Story
	name="ChoosingNothingDrawsEveryBorderTheSame"
	args={{
		multigraphData: SIZED_SPOKES,
		defaultPrimaryNodeId: 'n0',
		layoutSettings: { relaxIterations: 0 },
		settings: { [BORDER_SOURCE]: 'none' }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		// The same spokes that draw 4 / 8 / 15.97 / 8 px under "Size".
		for (const id of ['n1', 'n2', 'n3', 'n4']) {
			const widths = nodeBorderWidths(canvasElement, id);
			expect(widths.asked).toBeCloseTo(8, 5);
			expectDrawnBorder(widths.rendered, 8);
		}
		expect(nodeBorderWidths(canvasElement, 'n0').asked).toBeCloseTo(8, 5);
	}}
/>

<!--
	The "Border shows" select commits on change, with no preview, and the canvas
	redraws on that commit. On `SIZED_SPOKES` the 100 MiB spoke n3 draws ≈ 15.97 px
	under "Size", 8 × (1 + 0.15 × log2(1/3)) ≈ 6.10 px under "Edge count" (it has
	one edge), and 8 px under "Nothing"; the hub n0 has no size and four edges,
	so 8 px, 8 × (1 + 0.15 × log2(4/3)) ≈ 8.50 px, then 8 px.
-->
<Story
	name="ChoosingASourceInSettingsRedrawsBordersAtOnce"
	play={async ({ canvasElement }: HarnessPlayContext) => {
		await waitForLayout();
		const harness = getSettingsHarness(canvasElement);
		const sizeWidth = curveWidth(100 * MIB, MIB);
		const select = borderSourceSelect(canvasElement);
		expect(select.value).toBe('size');
		expect(nodeBorderWidths(canvasElement, 'n3').asked).toBeCloseTo(sizeWidth, 5);
		expect(nodeBorderWidths(canvasElement, 'n0').asked).toBeCloseTo(8, 5);

		chooseOption(select, 'degree');
		await waitFor(() => expect(harness.dataset.settingsChangeCount).toBe('1'));
		expect(harnessSettings(canvasElement)).toEqual({ [BORDER_SOURCE]: 'degree' });
		await waitFor(() =>
			expect(nodeBorderWidths(canvasElement, 'n3').asked).toBeCloseTo(curveWidth(1, 3), 5)
		);
		const leaf = nodeBorderWidths(canvasElement, 'n3');
		expectDrawnBorder(leaf.rendered, leaf.asked);
		const hub = nodeBorderWidths(canvasElement, 'n0');
		expect(hub.asked).toBeCloseTo(curveWidth(4, 3), 5);
		expectDrawnBorder(hub.rendered, hub.asked);

		chooseOption(borderSourceSelect(canvasElement), 'none');
		await waitFor(() => expect(harness.dataset.settingsChangeCount).toBe('2'));
		expect(harnessSettings(canvasElement)).toEqual({ [BORDER_SOURCE]: 'none' });
		await waitFor(() => expect(nodeBorderWidths(canvasElement, 'n3').asked).toBeCloseTo(8, 5));
		expectDrawnBorder(nodeBorderWidths(canvasElement, 'n3').rendered, 8);
		expect(nodeBorderWidths(canvasElement, 'n0').asked).toBeCloseTo(8, 5);

		// Back to the shipped source: the override is dropped, not stored as "size".
		chooseOption(borderSourceSelect(canvasElement), 'size');
		await waitFor(() => expect(harness.dataset.settingsChangeCount).toBe('3'));
		expect(harnessSettings(canvasElement)).toEqual({});
		await waitFor(() =>
			expect(nodeBorderWidths(canvasElement, 'n3').asked).toBeCloseTo(sizeWidth, 5)
		);
		const sized = nodeBorderWidths(canvasElement, 'n3');
		expectDrawnBorder(sized.rendered, sized.asked);
	}}
>
	{#snippet template()}
		<MultigraphSettingsHarness
			multigraphData={SIZED_SPOKES}
			defaultPrimaryNodeId="n0"
			layoutSettings={SETTINGS_STILL_LAYOUT}
			panelOpenAtMount
		/>
	{/snippet}
</Story>

<!--
	Composing is not committing. The composer opens inside the workbench the
	reader is already in, and nothing about the graph moves until they press Ask
	— so Cancel and Escape both leave the map exactly as they found it
	(`docs/ui-decisions/2026-09-07--editing--compose-a-follow-up-where-you-are-and-commit-on-submit.md`).
-->
<Story
	name="ComposingAFollowUpCommitsNothingUntilItIsSubmitted"
	args={{
		multigraphData: AI_PROMOTE_GRAPH,
		defaultPrimaryNodeId: 'ai',
		layoutSettings: { relaxIterations: 0 },
		assetStore: aiPlotStore(),
		assetScope: AI_SCOPE,
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		await enterFocusOn(canvasElement, 'ai');

		const cancelled = await openFollowUpComposer(canvasElement);
		await typeFollowUp(cancelled, 'Now fit the decay and report the time constant.');
		(canvasElement.querySelector('[data-ai-follow-up-cancel]') as HTMLElement).click();
		await waitFor(() => {
			expect(canvasElement.querySelector('[data-ai-follow-up]')).not.toBeInTheDocument();
		});

		// A discarded draft is not persisted, so the second visit starts empty.
		const escaped = await openFollowUpComposer(canvasElement);
		expect(escaped.value).toBe('');
		await typeFollowUp(escaped, 'And now the residuals.');
		escaped.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await waitFor(() => {
			expect(canvasElement.querySelector('[data-ai-follow-up]')).not.toBeInTheDocument();
		});

		// Escape closed the composer and stopped there: the surface under it is
		// still the reader's, which is the whole reason that handler calls
		// `stopPropagation`.
		await expectFocusOn(canvasElement, 'ai');

		// Nothing was created, nothing was joined, and there is nothing to undo:
		// the component never called back at all.
		const changeSpy = args.onMultigraphChange as unknown as ChangeSpy;
		expect(changeSpy.mock.calls).toHaveLength(0);
		// By id rather than by element count: the deep-zoom stack draws the focused
		// node's frame as well as its circle, so one node is two elements.
		const nodeIds = new Set(
			Array.from(canvasElement.querySelectorAll('[data-node-id]')).map(
				(element) => (element as HTMLElement).dataset.nodeId
			)
		);
		expect([...nodeIds]).toEqual(['ai']);
	}}
/>

<!--
	The submit, end to end. One press makes the node, joins it, moves the reader
	into it and starts its run — the shape the owner ruled for on 2026-09-07
	(`docs/ui-decisions/2026-09-07--editing--submitting-a-follow-up-also-starts-its-run.md`).
-->
<Story
	name="SubmittingAFollowUpFocusesTheNewNodeWithItsPromptAlreadyRunning"
	args={{
		multigraphData: AI_PROMOTE_GRAPH,
		defaultPrimaryNodeId: 'ai',
		layoutSettings: { relaxIterations: 0 },
		assetStore: aiPlotStore(),
		assetScope: AI_SCOPE,
		aiClient: aiStoryClient(),
		aiExecutor: aiStoryExecutor(),
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		await enterFocusOn(canvasElement, 'ai');

		const prompt = 'Now fit the decay and report the time constant.';
		await askFollowUp(canvasElement, prompt);

		// Exactly one graph change under this label — node, add-on, prompt and edge
		// together — so one Undo takes the whole follow-up back.
		const asked = commitsLabelled(args, 'ask a follow-up');
		expect(asked).toHaveLength(1);
		const committed = asked[0];
		const childId = newNodeId(committed, ['ai']);
		expect(committed.nodes.find((node) => node.id === childId)?.addons?.ai?.prompt).toBe(prompt);
		expect(committed.edges).toEqual([
			expect.objectContaining({
				sourceNodeId: 'ai',
				targetNodeId: childId,
				directed: true,
				tags: []
			})
		]);

		// The run started on the press, not on a second one the reader has to find:
		// the placeholder record is committed before the loop's first `await`.
		const child = committed.nodes.find((node) => node.id === childId);
		expect(child?.addons?.ai?.runs).toHaveLength(0);
		await waitFor(() => {
			const live = lastChangedGraph(args).nodes.find((node) => node.id === childId);
			expect(live?.addons?.ai?.runs.length).toBeGreaterThan(0);
		});

		// And the reader is in the child's workbench, with the prompt they wrote
		// already in it — there is nothing left to type, so nothing takes the caret.
		await expectFocusOn(canvasElement, childId);
		const workbench = await aiWorkbench(canvasElement);
		expect(workbench.querySelector('[data-ai-prompt]')).toHaveValue(prompt);

		// The way back names the node they came from. Inside the details that is
		// the trail; the floating button is the canvas's version of the same entry.
		await waitFor(() => {
			expect(canvasElement.querySelector('[data-nav-crumb-node="ai"]')).toBeInTheDocument();
		});
		within(canvasElement).getByRole('button', { name: 'Close node focus' }).click();
		await waitFor(() => {
			expect(canvasElement.querySelector('[data-nav-back="ai"]')).toBeInTheDocument();
		});
	}}
/>

<!--
	The round trip, modelled on `BackAfterDefineReturnsToTheConsumersDetails`: a
	follow-up takes the reader somewhere, so the entry it pushes has to bring
	them back to the workbench and the camera they left.
-->
<Story
	name="BackFromAFollowUpReturnsToTheParentsWorkbench"
	args={{
		multigraphData: AI_PROMOTE_GRAPH,
		defaultPrimaryNodeId: 'ai',
		initialViewState: { panX: 0, panY: 0, scale: APP_CONFIG.multigraph.zoom.maxScale },
		layoutSettings: { relaxIterations: 0 },
		assetStore: aiPlotStore(),
		assetScope: AI_SCOPE,
		aiClient: aiStoryClient(),
		aiExecutor: aiStoryExecutor(),
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		await enterFocusOn(canvasElement, 'ai');
		const atParent = getStageTransform(canvasElement);

		await askFollowUp(canvasElement, 'And now the residuals.');

		const childId = newNodeId(commitsLabelled(args, 'ask a follow-up')[0], ['ai']);
		await expectFocusOn(canvasElement, childId);
		await waitForLayout();
		expect(getStageTransform(canvasElement)).not.toEqual(atParent);

		await clickCrumb(canvasElement, 'ai');
		await waitForLayout();

		// The camera recorded at the departure, and the workbench they were in.
		expect(getStageTransform(canvasElement)).toEqual(atParent);
		await expectFocusOn(canvasElement, 'ai');
		expect(await aiWorkbench(canvasElement)).toBeInTheDocument();
		await waitFor(() => {
			expect(canvasElement.querySelector('[data-nav-breadcrumbs]')).not.toBeInTheDocument();
		});
	}}
/>

<!--
	The pin transfer, from the map
	(`docs/ui-decisions/2026-09-07--layout--a-follow-up-takes-the-pin-from-its-parent.md`).
	A pin is the visibility budget the reader spent on where they were working,
	and a follow-up moves where they are working — so it moves with them rather
	than accumulating one pin per question.
-->
<Story
	name="AFollowUpTakesThePinFromItsParent"
	args={{
		multigraphData: AI_PROMOTE_GRAPH,
		defaultPrimaryNodeId: 'ai',
		layoutSettings: { relaxIterations: 0 },
		assetStore: aiPlotStore(),
		assetScope: AI_SCOPE,
		aiClient: aiStoryClient(),
		aiExecutor: aiStoryExecutor(),
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		await enterFocusOn(canvasElement, 'ai');
		// What an Undo would put back: the parent pinned, and no second node.
		expect(AI_PROMOTE_GRAPH.nodes.find((node) => node.id === 'ai')?.pinned).toBe(true);

		await askFollowUp(canvasElement, 'Now fit the decay.');

		// Both pin changes and the node and the edge are in the one entry, so the
		// Undo that removes the child is the same one that gives the pin back.
		const asked = commitsLabelled(args, 'ask a follow-up');
		expect(asked).toHaveLength(1);
		const committed = asked[0];
		const childId = newNodeId(committed, ['ai']);
		const parent = committed.nodes.find((node) => node.id === 'ai');
		const child = committed.nodes.find((node) => node.id === childId);

		expect(parent?.pinned).toBe(false);
		expect(child?.pinned).toBe(true);
		// The beacon rule reads the highest stamp, so the node that still holds the
		// pin has to be the more recently touched of the two.
		expect(child?.lastPinnedSeq ?? 0).toBeGreaterThan(parent?.lastPinnedSeq ?? 0);
	}}
/>

<!--
	And the other half of the same rule: nothing to transfer means nothing is
	pinned. A follow-up must not invent a beacon the reader never asked for.
-->
<Story
	name="AFollowUpFromAnUnpinnedParentPinsNothing"
	args={{
		multigraphData: AI_UNPINNED_PARENT_GRAPH,
		defaultPrimaryNodeId: 'ai',
		layoutSettings: { relaxIterations: 0 },
		assetStore: aiPlotStore(),
		assetScope: AI_SCOPE,
		aiClient: aiStoryClient(),
		aiExecutor: aiStoryExecutor(),
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		await enterFocusOn(canvasElement, 'ai');

		await askFollowUp(canvasElement, 'Now fit the decay.');

		const asked = commitsLabelled(args, 'ask a follow-up');
		expect(asked).toHaveLength(1);
		const committed = asked[0];
		const childId = newNodeId(committed, ['ai']);

		// One entry again — child and edge together, so one Undo removes both —
		// and the pin counter is untouched, because a map with no pins in it does
		// not acquire one by being asked a question.
		expect(committed.nodes.find((node) => node.id === 'ai')?.pinned).toBeUndefined();
		expect(committed.nodes.find((node) => node.id === childId)?.pinned).toBeUndefined();
		expect(committed.nodes.every((node) => node.lastPinnedSeq === undefined)).toBe(true);
		expect(committed.pinSequence).toBeUndefined();
		expect(committed.edges).toHaveLength(1);
	}}
/>

<!--
	The missing key, which is the one way this flow can end somewhere the reader
	did not picture. `startAiRun` opens the settings sheet when a run comes back
	`needs-key`, so a reader with no key lands on a brand-new node with the sheet
	over it. That is the right outcome — the run is what they asked for and the
	key is what it needs — but only if the node is theirs regardless.
-->
<Story
	name="AFollowUpWithNoKeyStillLandsTheReaderOnTheChild"
	args={{
		multigraphData: AI_PROMOTE_GRAPH,
		defaultPrimaryNodeId: 'ai',
		layoutSettings: { relaxIterations: 0 },
		assetStore: aiPlotStore(),
		assetScope: AI_SCOPE,
		aiExecutor: aiStoryExecutor(),
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement, args }: PlayContext) => {
		await waitForLayout();
		await enterFocusOn(canvasElement, 'ai');

		await askFollowUp(canvasElement, 'Now fit the decay.');

		const asked = commitsLabelled(args, 'ask a follow-up');
		expect(asked).toHaveLength(1);
		const childId = newNodeId(asked[0], ['ai']);

		// The node was made and the reader is in it. A run that cannot start
		// commits nothing at all, so the follow-up is still the only entry.
		await expectFocusOn(canvasElement, childId);
		expect(await aiWorkbench(canvasElement)).toBeInTheDocument();
		expect(asked[0].nodes.find((node) => node.id === childId)?.addons?.ai?.runs).toEqual([]);
		expect(commitsLabelled(args, 'run AI node')).toHaveLength(0);
	}}
/>

<!--
	The chain, from the map: the child reads what the parent's run wrote, with
	nobody having promoted a file or drawn anything but the one edge that was
	already there. `clean.csv` is the parent's output, so it reaches the child as
	an ordinary input — and the three file actions are absent from its row,
	because there is nothing behind them to act on.
-->
<Story
	name="AFollowUpNodeReadsItsParentsOutputs"
	args={{
		multigraphData: AI_CHAIN_GRAPH,
		defaultPrimaryNodeId: 'child',
		layoutSettings: { relaxIterations: 0 },
		assetStore: aiCleanStore(AI_CLEAN_ASSET_ID),
		assetScope: AI_SCOPE,
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		await enterFocusOn(canvasElement, 'child');
		const workbench = await aiWorkbench(canvasElement);

		const parentGroup = await waitFor(() => {
			const found = workbench.querySelector('[data-ai-input-group="ai"]');
			expect(found).toBeInTheDocument();
			return found as HTMLElement;
		});
		expect(parentGroup).toHaveAttribute('data-ai-input-group-kind', 'neighbour');
		expect(parentGroup.querySelector('[data-ai-input-outputs-caption]')).toHaveTextContent(
			'From its last run'
		);

		// One row, under the parent, at the asset id the parent's run wrote — which
		// is what says it came from the run rather than from anyone's attachment.
		const outputs = parentGroup.querySelectorAll('[data-ai-input-kind="output"]');
		expect(outputs).toHaveLength(1);
		const row = outputs[0] as HTMLElement;
		expect(row).toHaveAttribute('data-ai-input-asset-id', AI_CLEAN_ASSET_ID);
		expect(row.querySelector('[data-ai-input-name]')).toHaveTextContent(AI_CLEAN_NAME);

		// Nothing acts on a produced file, so nothing offers to. The parent has no
		// attachments of its own, so this list is the only one it has.
		expect(row.querySelector('[data-ai-replace-file]')).toBeNull();
		expect(row.querySelector('[data-ai-remove-file]')).toBeNull();
		expect(parentGroup.querySelector('[data-ai-input-kind="file"]')).toBeNull();
		expect(parentGroup.querySelector('[data-ai-add-file]')).toBeNull();

		// And Add file is still on this node's own group, where it always was.
		expect(
			workbench.querySelector('[data-ai-input-group="child"] [data-ai-add-file]')
		).not.toBeNull();
	}}
/>

<!--
	A file input can now change without anyone touching a file: the parent ran
	again, and the bytes behind the child's input moved under it. The graph is
	built in the state that re-run leaves — the same filename over a new asset id,
	the old one gone with the run it belonged to — because what this story is
	about is what the child says next, not how the parent got there.

	Same name, new bytes is a *replacement*, and the wording has to survive being
	read by someone who did not press Replace: it names the file and says what
	each mode would do with it. The default stays Run, because the stored script
	opens `clean.csv` and `clean.csv` is still what it will find.
-->
<Story
	name="RerunningTheParentMarksTheChildsInputsChanged"
	args={{
		multigraphData: AI_RERUN_CHAIN_GRAPH,
		defaultPrimaryNodeId: 'child',
		layoutSettings: { relaxIterations: 0 },
		assetStore: aiCleanStore(AI_CLEAN_RERUN_ASSET_ID),
		assetScope: AI_SCOPE,
		aiClient: aiStoryClient(),
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		await enterFocusOn(canvasElement, 'child');
		const workbench = await aiWorkbench(canvasElement);

		// The amber line, naming the file and both ways out of it.
		await waitFor(() => {
			expect(workbench.querySelector('[data-ai-inputs-changed]')?.textContent?.trim()).toBe(
				'clean.csv was replaced since the last run. ' +
					'Run re-runs the script on the new data; Change lets Claude adjust it.'
			);
		});

		// The row it is about: the parent's output, at the id the re-run gave it.
		expect(
			workbench.querySelector('[data-ai-input-group="ai"] [data-ai-input-kind="output"]')
		).toHaveAttribute('data-ai-input-asset-id', AI_CLEAN_RERUN_ASSET_ID);

		// New bytes under a name the script already opens is not a new question, so
		// the switch stays on the mode that costs nothing.
		expect(workbench.querySelector('[data-ai-mode="rerun"]')).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		expect(workbench.querySelector('[data-ai-mode="refine"]')).toHaveAttribute(
			'aria-pressed',
			'false'
		);
		// ...and the button beside the switch agrees about what a press would do.
		expect(workbench.querySelector('[data-ai-run]')).toHaveTextContent('Run');
	}}
/>

<!--
	The end of the wire: a run printed `RESULT R_{th} = 12.3 K/W`, so the node
	that printed it defines `R_{th}` and milestone 09 draws the arrow to whoever's
	equation uses it. Nobody drew that edge and nobody can move it — deleting the
	node that measured the number takes it away again.

	Where the definition is *read* is the consumer's card, not the AI node's own
	surface: an `!ai` node's focus surface is the workbench, which draws the run's
	results and no quantity chips. So the definer reads from the two places a
	reader meets it — the arrow on the map, and the card that asks what defines
	this.
-->
<Story
	name="ARecordedResultMakesTheNodeADefiner"
	args={{
		multigraphData: aiMeasuredGraph(''),
		defaultPrimaryNodeId: 'consumer',
		layoutSettings: { ...NO_REVEALS, enterExitDurationMs: 0 },
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();

		// The number, on the node that reported it.
		await enterFocusOn(canvasElement, 'ai');
		const workbench = await aiWorkbench(canvasElement);
		expect(workbench.querySelector('[data-ai-results] [data-ai-result="R_{th}"]')).toBeVisible();
		within(canvasElement).getByRole('button', { name: 'Close node focus' }).click();
		await waitForLayout();

		// The arrow nobody drew.
		await waitFor(() => {
			expect(derivedEdgeBetween(canvasElement, 'ai', 'consumer')).toBeInTheDocument();
		});

		// And the answer the consumer gets when it asks what defines its input: the
		// AI node, quoting the number its run measured.
		await enterFocusOn(canvasElement, 'consumer');
		expect(await viewChip(canvasElement, R_TH_KEY)).toHaveAttribute(
			'data-designation-role',
			'input'
		);
		const card = await openPeekCard(canvasElement, R_TH_KEY);
		const definer = card.querySelector('[data-peek-definer="ai"]') as HTMLElement;
		expect(definer).toHaveAttribute('data-peek-definer-state', 'confirmed');
		expect(definer).toHaveTextContent('12.3');
		expect(definer).toHaveTextContent('K/W');

		within(canvasElement).getByRole('button', { name: 'Close node focus' }).click();
		await waitForLayout();

		// Results ride on their run and the run rides on its node, so removing the
		// node removes the claim and the arrow with it.
		await deleteNode(canvasElement, 'ai');
		await waitFor(() => {
			expect(canvasElement.querySelector('[data-edge-derived="true"]')).not.toBeInTheDocument();
		});
	}}
/>

<!--
	The reader wrote one number and the machine measured another, and being told
	so is the point: one node now defines `R_{th}` two different ways, which is
	milestone 09's within-node conflict reached by a second route. Nothing about
	it is new — the diagnostic is the one milestone 09 shipped, and both claims
	stay real, so the arrow stays drawn until the author resolves them.

	Read from the consumer, because that is where this graph draws a diagnostics
	panel at all: the AI node's own surface is the workbench.
-->
<Story
	name="AResultThatContradictsTheNodesOwnEquationReadsAsAConflict"
	args={{
		multigraphData: aiMeasuredGraph('The datasheet says $R_{th} = 15$.'),
		defaultPrimaryNodeId: 'consumer',
		layoutSettings: NO_REVEALS,
		onMultigraphChange: fn()
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForLayout();
		await enterFocusOn(canvasElement, 'consumer');

		const item = await waitFor(() => {
			const found = canvasElement.querySelector(`[data-diagnostic-quantity="${R_TH_LABEL}"]`);
			expect(found).toBeInTheDocument();
			return found as HTMLElement;
		});
		expect(item).toHaveAttribute('data-diagnostic-state', 'conflict');
		expect(item).toHaveTextContent('is defined differently by');
		expect(item.querySelector('[data-reveal-node="ai"]')).toHaveTextContent('Thermal step');

		// The contradiction itself, in one row: one node, two statements — the
		// number the reader wrote down and the number its run measured.
		const card = await openPeekCard(canvasElement, R_TH_KEY);
		const definer = card.querySelector('[data-peek-definer="ai"]') as HTMLElement;
		expect(definer).toHaveTextContent('15');
		expect(definer).toHaveTextContent('12.3');
		expect(card.querySelectorAll('[data-peek-definer]')).toHaveLength(1);

		// Both claims are real until the author picks one, so the edge is still
		// there — hiding it would misrepresent the graph.
		expect(derivedEdgeBetween(canvasElement, 'ai', 'consumer')).toBeInTheDocument();
	}}
/>
