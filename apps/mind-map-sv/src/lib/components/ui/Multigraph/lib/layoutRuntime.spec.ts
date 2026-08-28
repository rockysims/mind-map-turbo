import { describe, expect, it } from 'vitest';
import type { MultigraphData } from '../../types/multigraph';
import { togglePinned } from './graph';
import type { LayoutRuntimeScheduler } from './layoutRuntime.svelte';
import { LayoutRuntime } from './layoutRuntime.svelte';
import type { LayoutSettings } from './layoutSettings';
import type { EdgeEndpointIds } from './physics';
import { makeGraph } from './testFixtures';

class TestScheduler implements LayoutRuntimeScheduler {
	nowMs = 0;
	requests = 0;
	cancellations = 0;

	requestFrame(): number {
		this.requests += 1;
		return this.requests;
	}

	cancelFrame(): void {
		this.cancellations += 1;
	}

	now(): number {
		return this.nowMs;
	}
}

interface RuntimeFixture {
	runtime: LayoutRuntime;
	scheduler: TestScheduler;
	getGraph: () => MultigraphData;
	setGraph: (nextGraph: MultigraphData) => void;
	setActiveDragNodeId: (nodeId: string | null) => void;
}

function createRuntimeFixture(
	initialGraph = makeGraph({
		nodeCount: 3,
		edges: [
			[0, 1],
			[1, 2]
		]
	}),
	settings: Partial<LayoutSettings> = {}
): RuntimeFixture {
	let graph = initialGraph;
	let activeDragNodeId: string | null = null;
	const scheduler = new TestScheduler();
	const runtime = new LayoutRuntime({
		getGraph: () => graph,
		getLayoutSettings: () => ({
			relaxIterations: 0,
			displayedLayers: 2,
			layeredRelayoutSettleMaxFrames: 2,
			layeredRelayoutSettleEpsilonPx: 0.25,
			postDragSettleEpsilonPx: 0.25,
			postDragSettleMaxFrames: 2,
			postScaleChangeSettleMaxFrames: 2,
			scaleAnimationDurationMs: 100,
			...settings
		}),
		getActiveDragNodeId: () => activeDragNodeId,
		getPreferredBeaconNodeIds: () => [],
		applyGraph: (nextGraph) => {
			graph = nextGraph;
		},
		scheduler
	});

	return {
		runtime,
		scheduler,
		getGraph: () => graph,
		setGraph: (nextGraph) => {
			graph = nextGraph;
		},
		setActiveDragNodeId: (nodeId) => {
			activeDragNodeId = nodeId;
		}
	};
}

describe('LayoutRuntime', () => {
	it('counts post-drag settle frames down to zero', () => {
		const { runtime } = createRuntimeFixture(undefined, {
			postDragSettleEpsilonPx: -1,
			postDragSettleMaxFrames: 2
		});

		runtime.settleAfterDrag();
		expect(runtime.settleFramesRemaining).toBe(2);

		runtime.step(1);
		expect(runtime.settleFramesRemaining).toBe(1);

		runtime.step(2);
		expect(runtime.settleFramesRemaining).toBe(0);
		expect(runtime.isSettling).toBe(false);
	});

	it('transitions pending post-scale settle into settle frames on the next step', () => {
		const { runtime, scheduler, getGraph, setGraph } = createRuntimeFixture();
		scheduler.nowMs = 10;

		const graphAfterScaleChange = runtime.beginScaleChange(togglePinned(getGraph(), 'n0'), 'n0');
		setGraph(graphAfterScaleChange);

		expect(runtime.pendingPostScaleSettle).toBe(true);
		expect(runtime.settleFramesRemaining).toBe(0);

		runtime.step(20);

		expect(runtime.pendingPostScaleSettle).toBe(false);
		expect(runtime.settleFramesRemaining).toBe(2);
		expect(runtime.scaleAnchoredNodeIds).toEqual(['n0']);
	});

	it('prunes scale animations at their end time', () => {
		const { runtime, scheduler, getGraph, setGraph } = createRuntimeFixture();
		scheduler.nowMs = 10;

		const graphAfterScaleChange = runtime.beginScaleChange(togglePinned(getGraph(), 'n0'), 'n0');
		setGraph(graphAfterScaleChange);
		expect(runtime.hasActiveScaleAnimations).toBe(true);

		runtime.step(110);

		expect(runtime.scaleAnimations).toEqual({});
		expect(runtime.hasActiveScaleAnimations).toBe(false);
	});

	it('advances and clears layered relayout state', () => {
		const { runtime, getGraph } = createRuntimeFixture(
			togglePinned(makeGraph({ nodeCount: 2 }), 'n0'),
			{
				layeredRelayoutSettleMaxFrames: 1,
				layeredRelayoutSettleEpsilonPx: 999
			}
		);

		runtime.startLayeredRelayout(getGraph(), 0);
		expect(runtime.isLayeredRelayoutActive).toBe(true);
		expect(runtime.relayoutStateKey).toBe('visible-set');

		runtime.step(1);

		expect(runtime.isLayeredRelayoutActive).toBe(false);
		expect(runtime.relayoutStateKey).toBeNull();
	});

	it('keeps post-drag settle unanchored and post-scale settle anchored to the focal node', () => {
		const dragFixture = createRuntimeFixture(undefined, {
			postDragSettleEpsilonPx: -1,
			postDragSettleMaxFrames: 1
		});

		dragFixture.runtime.settleAfterDrag();
		expect(dragFixture.runtime.scaleAnchoredNodeIds).toEqual([]);
		dragFixture.runtime.step(1);
		expect(dragFixture.runtime.scaleAnchoredNodeIds).toEqual([]);

		const scaleFixture = createRuntimeFixture(undefined, {
			postDragSettleEpsilonPx: -1,
			postScaleChangeSettleMaxFrames: 1,
			scaleAnimationDurationMs: 0
		});
		const graphAfterScaleChange = scaleFixture.runtime.beginScaleChange(
			togglePinned(scaleFixture.getGraph(), 'n0'),
			'n0'
		);
		scaleFixture.setGraph(graphAfterScaleChange);

		expect(scaleFixture.runtime.pendingPostScaleSettle).toBe(false);
		expect(scaleFixture.runtime.settleFramesRemaining).toBe(1);
		expect(scaleFixture.runtime.scaleAnchoredNodeIds).toEqual(['n0']);

		scaleFixture.runtime.step(1);

		expect(scaleFixture.runtime.settleFramesRemaining).toBe(0);
		expect(scaleFixture.runtime.scaleAnchoredNodeIds).toEqual([]);
	});

	it('exposes previous-only reveal entries during unpin and clears them at p=1', () => {
		const graph = makeGraph({
			nodeCount: 6,
			pinned: [1, 4],
			edges: [
				[0, 1],
				[1, 2],
				[2, 3],
				[3, 4],
				[4, 5]
			]
		});
		const { runtime, scheduler, setGraph, getGraph } = createRuntimeFixture(graph, {
			displayedLayers: 1,
			scaleAnimationDurationMs: 100,
			postScaleChangeSettleMaxFrames: 0,
			relaxIterations: 0
		});
		scheduler.nowMs = 10;

		const graphAfterScaleChange = runtime.beginScaleChange(togglePinned(getGraph(), 'n4'), 'n4');
		setGraph(graphAfterScaleChange);

		expect(runtime.revealWavePreviousOnlyNodeIds).toEqual(['n3', 'n4', 'n5']);
		runtime.step(60);
		expect(runtime.revealWaveNodeOpacityByNodeId.n4).toBeGreaterThan(
			runtime.revealWaveNodeOpacityByNodeId.n3
		);
		expect(runtime.revealWavePreviousOnlyEdgeVisibility.map((entry) => entry.edge.id)).toEqual([
			'e3',
			'e4'
		]);

		runtime.step(110);

		expect(runtime.revealWavePreviousOnlyNodeIds).toEqual([]);
		expect(runtime.revealWavePreviousOnlyEdgeVisibility).toEqual([]);
		expect(runtime.revealWaveNodeOpacityByNodeId).toEqual({});
		expect(runtime.revealWaveEdgeOpacityByEdgeId).toEqual({});
	});

	it('keeps the beacon visible at BEACON_HOP when the last pin of a component is removed', () => {
		const graph = makeGraph({
			nodeCount: 3,
			pinned: [0],
			edges: [
				[0, 1],
				[1, 2]
			]
		});
		const { runtime, scheduler, setGraph, getGraph } = createRuntimeFixture(graph, {
			displayedLayers: 1,
			scaleAnimationDurationMs: 100,
			postScaleChangeSettleMaxFrames: 0,
			relaxIterations: 0
		});
		scheduler.nowMs = 10;

		// Unpinning n0 stamps its recency, so it becomes the component's beacon.
		const graphAfterScaleChange = runtime.beginScaleChange(togglePinned(getGraph(), 'n0'), 'n0');
		setGraph(graphAfterScaleChange);

		const revealState = runtime.scaleChangeRevealState;
		expect(revealState?.nextVisibleNodeIds).toEqual(['n0']);
		expect(revealState?.nextHopsByNodeId.n0).toBe(1);
		expect([...(revealState?.previousVisibleNodeIds ?? [])].sort()).toEqual(['n0', 'n1']);
	});

	it('does not wedge layered relayout when no nodes are pinned', () => {
		const graph = makeGraph({ nodeCount: 2, edges: [[0, 1]] });
		const { runtime, getGraph } = createRuntimeFixture(graph, {
			layeredRelayoutSettleMaxFrames: 1,
			layeredRelayoutSettleEpsilonPx: 999
		});

		runtime.startLayeredRelayout(getGraph(), 0);
		expect(runtime.isLayeredRelayoutActive).toBe(true);

		runtime.step(1);

		expect(runtime.isLayeredRelayoutActive).toBe(false);
	});

	it('restarts reveal-wave state when a second pin happens mid-flight', () => {
		const graph = makeGraph({
			nodeCount: 6,
			pinned: [0],
			edges: [
				[0, 1],
				[1, 2],
				[2, 3],
				[3, 4],
				[4, 5]
			]
		});
		const { runtime, scheduler, setGraph, getGraph } = createRuntimeFixture(graph, {
			displayedLayers: 1,
			scaleAnimationDurationMs: 120,
			postScaleChangeSettleMaxFrames: 0,
			relaxIterations: 0
		});
		scheduler.nowMs = 0;

		const firstGraph = runtime.beginScaleChange(togglePinned(getGraph(), 'n1'), 'n1');
		setGraph(firstGraph);
		runtime.step(60);
		expect(runtime.revealWaveProgress).toBeCloseTo(0.5);

		scheduler.nowMs = 60;
		const secondGraph = runtime.beginScaleChange(togglePinned(getGraph(), 'n4'), 'n4');
		setGraph(secondGraph);

		expect(runtime.scaleChangeFocalNodeId).toBe('n4');
		expect(runtime.revealWaveProgress).toBe(0);
		expect(runtime.revealWaveNodeOpacityByNodeId.n4).toBeGreaterThan(0);
		expect(runtime.revealWaveNodeOpacityByNodeId.n5 ?? 1).toBeLessThan(1);
	});

	describe('composeSpringEdges', () => {
		const graph = makeGraph({ nodeCount: 3, edges: [[0, 1]] });

		function runtimeWith(
			composeSpringEdges?: (visibleGraph: MultigraphData) => readonly EdgeEndpointIds[]
		): LayoutRuntime {
			return new LayoutRuntime({
				getGraph: () => graph,
				getLayoutSettings: () => ({ relaxIterations: 0 }),
				getActiveDragNodeId: () => null,
				getPreferredBeaconNodeIds: () => [],
				applyGraph: () => {},
				composeSpringEdges,
				scheduler: new TestScheduler()
			});
		}

		it('leaves the layout on the graph edges when no hook is given', () => {
			expect(runtimeWith().layoutOptions(graph).springEdges).toBeUndefined();
		});

		it('leaves the layout on the graph edges when the hook adds nothing', () => {
			// Not an empty array: the layout should keep reading data.edges directly
			// rather than a copy of it, on every frame, for every graph.
			expect(runtimeWith(() => []).layoutOptions(graph).springEdges).toBeUndefined();
		});

		it('appends the extra edges to the authored ones rather than replacing them', () => {
			const runtime = runtimeWith(() => [{ sourceNodeId: 'n0', targetNodeId: 'n2' }]);

			expect(runtime.layoutOptions(graph).springEdges).toEqual([
				...graph.edges,
				{ sourceNodeId: 'n0', targetNodeId: 'n2' }
			]);
		});

		it('offers the layout graph so the caller can drop off-screen endpoints', () => {
			const seen: MultigraphData[] = [];
			runtimeWith((visibleGraph) => {
				seen.push(visibleGraph);
				return [];
			}).layoutOptions(graph);

			expect(seen).toEqual([graph]);
		});
	});

	describe('composeRevealEdges', () => {
		// n4 is four authored hops from the pin with only two layers shown, and it
		// starts sitting on top of the pinned node. Overlap resolution will shove it
		// clear, but only if it is in the graph physics runs over at all.
		const graph = makeGraph({
			nodeCount: 5,
			pinned: [0],
			edges: [
				[0, 1],
				[1, 2],
				[2, 3],
				[3, 4]
			],
			posByNodeId: {
				n0: { x: 0, y: 0 },
				n1: { x: 400, y: 0 },
				n2: { x: 800, y: 0 },
				n3: { x: 1200, y: 0 },
				n4: { x: 5, y: 0 }
			}
		});

		function relaxedN4(composeRevealEdges?: (graph: MultigraphData) => readonly EdgeEndpointIds[]) {
			const runtime = new LayoutRuntime({
				getGraph: () => graph,
				getLayoutSettings: () => ({ displayedLayers: 2 }),
				getActiveDragNodeId: () => null,
				getPreferredBeaconNodeIds: () => [],
				applyGraph: () => {},
				composeRevealEdges,
				scheduler: new TestScheduler()
			});
			return runtime.relaxAfterMutation(graph, null, 4).posByNodeId.n4;
		}

		it('leaves a node beyond the displayed layers out of the physics', () => {
			expect(relaxedN4()).toEqual(graph.posByNodeId.n4);
		});

		it('places a revealed node along with everything else', () => {
			// Without this the node would be drawn on the canvas and then never
			// moved, sitting stale on top of whatever it happened to overlap.
			expect(relaxedN4(() => [{ sourceNodeId: 'n0', targetNodeId: 'n4' }])).not.toEqual(
				graph.posByNodeId.n4
			);
		});

		it('does not reveal a node whose partner is hidden too', () => {
			// n3 and n4 are both out of view, so there is nothing to hang n4 off.
			expect(relaxedN4(() => [{ sourceNodeId: 'n3', targetNodeId: 'n4' }])).toEqual(
				graph.posByNodeId.n4
			);
		});
	});
});
