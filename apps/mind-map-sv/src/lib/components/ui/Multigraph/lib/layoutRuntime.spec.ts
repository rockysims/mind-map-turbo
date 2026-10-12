import { describe, expect, it } from 'vitest';
import type { EdgeData } from '../../types/edge';
import type { MultigraphData } from '../../types/multigraph';
import { beaconNodeIds } from './beacons';
import { hasDerivedEdges } from './dataflowLayer';
import {
	computeBoundedHops,
	visibleNodeIdsForPinnedNeighborhood,
	type BoundedHopsOptions
} from './boundedVisibility';
import { derivedEdgeId } from './derivedEdges';
import { createLayoutSourceReducer, excludedGraphElements } from './excludedElements';
import { togglePinned } from './graph';
import { deriveGraphLayout } from './graphLayout';
import { evaluateGraphQuery } from './graphQuery';
import type { LayoutRuntimeScheduler } from './layoutRuntime.svelte';
import { LayoutRuntime } from './layoutRuntime.svelte';
import { DEFAULT_LAYOUT_SETTINGS, type LayoutSettings } from './layoutSettings';
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

/**
 * The `computeHops` the app hands the runtime, with the dataflow layer standing
 * in as a fixed list of derived edges. Beacons come off the authored edges, as
 * they do in `Multigraph.svelte`.
 */
function hopsThrough(
	derivedEdges: readonly EdgeEndpointIds[],
	options: BoundedHopsOptions
): (graph: MultigraphData) => Record<string, number> {
	return (graph) => computeBoundedHops(graph, derivedEdges, beaconNodeIds(graph), options);
}

/**
 * The `reduceLayoutSource` the app hands the runtime, over one fixed query: the
 * real memoized reducer, so these specs exercise the same identity and
 * idempotence the app relies on rather than a stand-in for it.
 */
function reducerFor(queryText: string): (graph: MultigraphData) => MultigraphData {
	const reduce = createLayoutSourceReducer();
	return (graph) => reduce(graph, queryText);
}

/** A copy of `graph` with these tags on these nodes. */
function withNodeTags(
	graph: MultigraphData,
	tagsByNodeId: Record<string, readonly string[]>
): MultigraphData {
	return {
		...graph,
		nodes: graph.nodes.map((node) =>
			tagsByNodeId[node.id] ? { ...node, tags: [...tagsByNodeId[node.id]] } : node
		)
	};
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
	settings: Partial<LayoutSettings> = {},
	reduceLayoutSource?: (graph: MultigraphData) => MultigraphData
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
		reduceLayoutSource,
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

	describe('settleAfterSettingsChange', () => {
		it('starts the frame loop from idle', () => {
			// A setting changed under a graph at rest. Physics reads the new numbers
			// per frame, so the settle only shows up if something asks for frames.
			const { runtime, scheduler } = createRuntimeFixture(undefined, {
				postDragSettleEpsilonPx: -1,
				postDragSettleMaxFrames: 2
			});
			expect(scheduler.requests).toBe(0);

			runtime.settleAfterSettingsChange();

			expect(scheduler.requests).toBe(1);
			expect(runtime.settleFramesRemaining).toBe(2);
			expect(runtime.isSettling).toBe(true);
		});

		it('tops the budget up instead of restarting or shortening it', () => {
			const { runtime } = createRuntimeFixture(undefined, {
				postDragSettleEpsilonPx: -1,
				postDragSettleMaxFrames: 2
			});

			// Three pointermoves of one slider drag buy two frames, not six: the
			// budget is capped, so a held pointer cannot inflate it.
			runtime.settleAfterSettingsChange();
			runtime.settleAfterSettingsChange();
			runtime.settleAfterSettingsChange();
			expect(runtime.settleFramesRemaining).toBe(2);

			// Frames already spent are refunded — a slider that keeps moving keeps
			// its full budget ahead of it — but the count still counts down.
			runtime.step(1);
			expect(runtime.settleFramesRemaining).toBe(1);
			runtime.settleAfterSettingsChange();
			expect(runtime.settleFramesRemaining).toBe(2);

			// And a longer settle already in flight — a scale change's, say — is not
			// cut short to the smaller post-drag budget.
			runtime.settleFramesRemaining = 5;
			runtime.settleAfterSettingsChange();
			expect(runtime.settleFramesRemaining).toBe(5);
		});

		it('leaves the budget at zero while a node drag is active', () => {
			// `beginDrag` zeroes it on purpose: the loop runs off the drag, and the
			// settle is meant to start when the finger lifts, not against a node the
			// pointer is still moving.
			const { runtime, scheduler, setActiveDragNodeId } = createRuntimeFixture(undefined, {
				postDragSettleEpsilonPx: -1,
				postDragSettleMaxFrames: 2
			});
			setActiveDragNodeId('n0');
			runtime.beginDrag();
			expect(runtime.settleFramesRemaining).toBe(0);
			expect(scheduler.requests).toBe(1);

			runtime.settleAfterSettingsChange();

			expect(runtime.settleFramesRemaining).toBe(0);
			// The loop was already scheduled, so no second frame is queued for it.
			expect(scheduler.requests).toBe(1);
		});
	});

	describe('settleAfterVisibilityChange', () => {
		// The same three cases as `settleAfterSettingsChange`: the two share one
		// budget rule, and a query typed a key at a time is the slider drag of
		// visibility changes.
		it('starts the frame loop from idle', () => {
			// The exclusion changed under a graph at rest. The layout reads the new
			// source per frame, so the settle only shows up if something asks for
			// frames.
			const { runtime, scheduler } = createRuntimeFixture(undefined, {
				postDragSettleEpsilonPx: -1,
				postDragSettleMaxFrames: 2
			});
			expect(scheduler.requests).toBe(0);

			runtime.settleAfterVisibilityChange();

			expect(scheduler.requests).toBe(1);
			expect(runtime.settleFramesRemaining).toBe(2);
			expect(runtime.isSettling).toBe(true);
		});

		it('tops the budget up instead of restarting or shortening it', () => {
			const { runtime } = createRuntimeFixture(undefined, {
				postDragSettleEpsilonPx: -1,
				postDragSettleMaxFrames: 2
			});

			// Three keystrokes that each change the exclusion buy two frames, not six.
			runtime.settleAfterVisibilityChange();
			runtime.settleAfterVisibilityChange();
			runtime.settleAfterVisibilityChange();
			expect(runtime.settleFramesRemaining).toBe(2);

			// Spent frames are refunded, and the count still counts down.
			runtime.step(1);
			expect(runtime.settleFramesRemaining).toBe(1);
			runtime.settleAfterVisibilityChange();
			expect(runtime.settleFramesRemaining).toBe(2);

			// A longer settle already in flight is not cut short.
			runtime.settleFramesRemaining = 5;
			runtime.settleAfterVisibilityChange();
			expect(runtime.settleFramesRemaining).toBe(5);
		});

		it('leaves the budget at zero while a node drag is active', () => {
			const { runtime, scheduler, setActiveDragNodeId } = createRuntimeFixture(undefined, {
				postDragSettleEpsilonPx: -1,
				postDragSettleMaxFrames: 2
			});
			setActiveDragNodeId('n0');
			runtime.beginDrag();
			expect(runtime.settleFramesRemaining).toBe(0);
			expect(scheduler.requests).toBe(1);

			runtime.settleAfterVisibilityChange();

			expect(runtime.settleFramesRemaining).toBe(0);
			expect(scheduler.requests).toBe(1);
		});
	});

	describe('reduceLayoutSource', () => {
		// n3 is excluded by tag and sits right on top of the pinned n0, so physics
		// would shove it clear if it were in the layout at all. e1 is excluded by
		// tag too, which leaves n2 a component of its own and so its own beacon.
		//
		//   n0(pin) ── n1 ─[e1 #cut]─ n2        n0 ── n3(#hidden)
		const QUERY = '-#hidden -@cut';
		const graph = withNodeTags(
			makeGraph({
				nodeCount: 4,
				pinned: [0],
				edges: [[0, 1], { source: 1, target: 2, tags: ['cut'] }, [0, 3]],
				posByNodeId: {
					n0: { x: 0, y: 0 },
					n1: { x: 400, y: 0 },
					n2: { x: 800, y: 0 },
					n3: { x: 3, y: 1 }
				}
			}),
			{ n3: ['hidden'] }
		);
		const excluded = excludedGraphElements(evaluateGraphQuery(graph, QUERY));
		const settings: Partial<LayoutSettings> = {
			displayedLayers: 2,
			postDragSettleEpsilonPx: -1,
			postDragSettleMaxFrames: 5,
			relaxIterations: 4
		};

		it('excludes what the fixture says it does', () => {
			// Guards every spec below against a fixture that quietly excludes nothing.
			expect([...excluded.nodeIds]).toEqual(['n3']);
			expect([...excluded.edgeIds].sort()).toEqual(['e1', 'e2']);
		});

		it('leaves an excluded node exactly where it was across a run of frames', () => {
			// Exclusion is UI state, not a graph edit: the node keeps its place in the
			// stored graph so that it can come back to it when the token goes.
			const { runtime, getGraph } = createRuntimeFixture(graph, settings, reducerFor(QUERY));
			runtime.settleAfterVisibilityChange();
			for (let frame = 1; frame <= 5; frame += 1) runtime.step(frame);

			const settled = getGraph();
			expect(settled.posByNodeId.n3).toStrictEqual(graph.posByNodeId.n3);
			expect(settled.nodes).toBe(graph.nodes);
			expect(settled.edges).toBe(graph.edges);
			// Teeth: the frames did run, and moved what is still in the layout.
			expect(settled.posByNodeId.n1).not.toEqual(graph.posByNodeId.n1);
		});

		it('would have shoved the same node clear without the reducer', () => {
			// The other half of the spec above: n3 stays put because it is out of the
			// layout, not because nothing pushes on it.
			const { runtime, getGraph } = createRuntimeFixture(graph, settings);
			runtime.settleAfterVisibilityChange();
			for (let frame = 1; frame <= 5; frame += 1) runtime.step(frame);

			expect(getGraph().posByNodeId.n3).not.toEqual(graph.posByNodeId.n3);
		});

		it('returns the whole graph from relaxAfterMutation, excluded elements kept in place', () => {
			const { runtime } = createRuntimeFixture(graph, settings, reducerFor(QUERY));

			const relaxed = runtime.relaxAfterMutation(graph);

			expect(relaxed.nodes).toBe(graph.nodes);
			expect(relaxed.edges).toBe(graph.edges);
			expect(relaxed.posByNodeId.n3).toStrictEqual(graph.posByNodeId.n3);
			expect(relaxed.posByNodeId.n1).not.toEqual(graph.posByNodeId.n1);
		});

		it('returns the whole graph from beginScaleChange and keeps excluded ids out of the wave', () => {
			const { runtime } = createRuntimeFixture(graph, settings, reducerFor(QUERY));
			const nextGraph = togglePinned(graph, 'n1');

			const changed = runtime.beginScaleChange(nextGraph, 'n1');

			expect(changed.nodes).toBe(nextGraph.nodes);
			expect(changed.edges).toBe(nextGraph.edges);
			expect(changed.posByNodeId.n3).toStrictEqual(graph.posByNodeId.n3);

			const revealState = runtime.scaleChangeRevealState;
			expect(revealState).not.toBeNull();
			const waveNodeIds = [
				...(revealState?.previousVisibleNodeIds ?? []),
				...(revealState?.nextVisibleNodeIds ?? [])
			];
			const waveEdges = [
				...(revealState?.previousRenderableEdges ?? []),
				...(revealState?.nextRenderableEdges ?? [])
			].map((visibility) => visibility.edge);
			// Teeth: the wave is not empty, so "no excluded id" says something.
			expect(waveNodeIds).toContain('n0');
			expect(waveEdges.map((edge) => edge.id)).toContain('e0');
			for (const nodeId of waveNodeIds) expect(excluded.nodeIds.has(nodeId)).toBe(false);
			for (const edge of waveEdges) {
				expect(excluded.edgeIds.has(edge.id)).toBe(false);
				expect(excluded.nodeIds.has(edge.sourceNodeId)).toBe(false);
				expect(excluded.nodeIds.has(edge.targetNodeId)).toBe(false);
			}
			for (const edgeId of revealState?.nextRenderableEdgeIds ?? []) {
				expect(excluded.edgeIds.has(edgeId)).toBe(false);
			}
		});

		it('puts the excluded node in the wave without the reducer', () => {
			// Teeth for the spec above: n3 sits one hop from the pin on both sides.
			const { runtime } = createRuntimeFixture(graph, settings);

			runtime.beginScaleChange(togglePinned(graph, 'n1'), 'n1');

			expect(runtime.scaleChangeRevealState?.previousVisibleNodeIds).toContain('n3');
			expect(runtime.scaleChangeRevealState?.nextVisibleNodeIds).toContain('n3');
		});

		describe('layered relayout', () => {
			// n0 is the only pin, and it is excluded.
			const onlyPinExcluded = withNodeTags(
				makeGraph({
					nodeCount: 3,
					pinned: [0],
					edges: [
						[0, 1],
						[1, 2]
					]
				}),
				{ n0: ['hidden'] }
			);

			it('seeds no layer from an excluded pin', () => {
				const { runtime, getGraph } = createRuntimeFixture(
					onlyPinExcluded,
					{},
					reducerFor('-#hidden')
				);

				runtime.startLayeredRelayout(getGraph(), 0);

				expect(runtime.layeredRelayoutState?.pinnedNodeIds).toEqual(new Set());
			});

			it('seeds only the pins that remain when a scale change starts one', () => {
				const { runtime, getGraph } = createRuntimeFixture(
					onlyPinExcluded,
					{},
					reducerFor('-#hidden')
				);

				runtime.beginScaleChange(togglePinned(getGraph(), 'n2'), 'n2');

				expect(runtime.layeredRelayoutState?.pinnedNodeIds).toEqual(new Set(['n2']));
			});

			it('seeds from the pin without the reducer', () => {
				const { runtime, getGraph } = createRuntimeFixture(onlyPinExcluded);

				runtime.startLayeredRelayout(getGraph(), 0);

				expect(runtime.layeredRelayoutState?.pinnedNodeIds).toEqual(new Set(['n0']));
			});
		});
	});

	describe('composeDerivedEdges', () => {
		// n2 hangs off nothing, so with one layer shown it is off screen while n0
		// and n1 are on it.
		const graph = {
			...makeGraph({ nodeCount: 3, pinned: [0], edges: [[0, 1]] }),
			posByNodeId: {
				n0: { x: 0, y: 0 },
				n1: { x: 700, y: 0 },
				n2: { x: 1400, y: 0 }
			}
		};

		function derivedEdge(sourceNodeId: string, targetNodeId: string): EdgeData {
			return {
				id: `dataflow:${sourceNodeId}->${targetNodeId}`,
				sourceNodeId,
				targetNodeId,
				tags: [],
				directed: true,
				springFactor: 1
			};
		}

		const ALL_VISIBLE = { n0: 0, n1: 1, n2: 1 };

		function runtimeWith(
			composeDerivedEdges?: (graph: MultigraphData) => readonly EdgeData[],
			hopsByNodeId: Record<string, number> = ALL_VISIBLE,
			applyGraph: (nextGraph: MultigraphData) => void = () => {}
		): LayoutRuntime {
			return new LayoutRuntime({
				getGraph: () => graph,
				getLayoutSettings: () => ({ relaxIterations: 0, displayedLayers: 3 }),
				getActiveDragNodeId: () => null,
				getPreferredBeaconNodeIds: () => [],
				applyGraph,
				computeHops: () => hopsByNodeId,
				composeDerivedEdges,
				scheduler: new TestScheduler()
			});
		}

		it('leaves the layout graph on the authored edges when no hook is given', () => {
			expect(runtimeWith().visibleGraphFor(graph).edges).toEqual(graph.edges);
		});

		it('joins a derived edge between two visible nodes as an ordinary edge', () => {
			// One composition point: the same graph the relax step, the scale-change
			// layouts, and the renderer's `graphLayout` all read.
			const edge = derivedEdge('n0', 'n2');

			expect(runtimeWith(() => [edge]).visibleGraphFor(graph).edges).toEqual([
				...graph.edges,
				edge
			]);
		});

		it('drops a derived edge whose far end is off screen', () => {
			// An off-screen node has no position or radius for physics to use, and the
			// edge would still count toward n1's degree, weakening every pull it feels.
			const layoutGraph = runtimeWith(() => [derivedEdge('n1', 'n2')], {
				n0: 0,
				n1: 1,
				n2: Infinity
			}).visibleGraphFor(graph);

			expect(layoutGraph.nodes.map((node) => node.id)).toEqual(['n0', 'n1']);
			expect(layoutGraph.edges).toEqual(graph.edges);
		});

		it('asks about the whole graph, not the visible subgraph', () => {
			// Same contract as `computeHops`: inside a visible subgraph the hidden half
			// of a derived edge is simply not there to be filtered.
			const seen: MultigraphData[] = [];
			runtimeWith((asked) => {
				seen.push(asked);
				return [];
			}).visibleGraphFor(graph);

			expect(seen).toEqual([graph]);
		});

		it('keeps derived edges out of the graph it hands back', () => {
			// The layout graph is for placing nodes, never for keeping. Only positions
			// come back, or a derived edge would reach mutations and persistence.
			const applied: MultigraphData[] = [];
			const runtime = runtimeWith(
				() => [derivedEdge('n0', 'n2')],
				ALL_VISIBLE,
				(nextGraph) => applied.push(nextGraph)
			);
			runtime.settleFramesRemaining = 1;
			runtime.step(0);

			const kept = [
				runtime.relaxAfterMutation(graph),
				runtime.beginScaleChange(graph, 'n0'),
				...applied
			];

			expect(kept).not.toHaveLength(0);
			for (const nextGraph of kept) {
				expect(hasDerivedEdges(nextGraph)).toBe(false);
				expect(nextGraph.edges).toEqual(graph.edges);
			}
		});

		it('pulls a derived pair together instead of standing it off', () => {
			// The whole point of composing rather than side-channelling: with the pair
			// unreachable in `data.edges`, hop repulsion pushed at full strength
			// against the spring that was pulling them, and they came to rest much
			// further apart than an authored pair would.
			function settledGapToN2(composeDerivedEdges?: () => readonly EdgeData[]): number {
				const relaxed = runtimeWith(composeDerivedEdges).relaxAfterMutation(graph, null, 400);
				const source = relaxed.posByNodeId.n1;
				const target = relaxed.posByNodeId.n2;
				return Math.hypot(target.x - source.x, target.y - source.y);
			}

			expect(settledGapToN2(() => [derivedEdge('n1', 'n2')])).toBeLessThan(settledGapToN2());
		});
	});

	describe('computeHops', () => {
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

		function relaxedN4(derivedEdges: readonly EdgeEndpointIds[] = []) {
			const runtime = new LayoutRuntime({
				getGraph: () => graph,
				getLayoutSettings: () => ({ displayedLayers: 2 }),
				getActiveDragNodeId: () => null,
				getPreferredBeaconNodeIds: () => [],
				applyGraph: () => {},
				computeHops: hopsThrough(derivedEdges, { displayedLayers: 2 }),
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
			expect(relaxedN4([{ sourceNodeId: 'n0', targetNodeId: 'n4' }])).not.toEqual(
				graph.posByNodeId.n4
			);
		});

		it('scales a revealed node like an authored neighbor of the same anchor', () => {
			// n2 and n3 both hang off the pin by a dataflow edge and are joined to
			// each other, so inside the visible graph they form one pinless component
			// and a fresh measure would call them unreachable. The layout is handed
			// the hops the whole graph was measured at instead, where n3 is the same
			// one step from the pin as the authored n1.
			const paired = makeGraph({
				nodeCount: 4,
				pinned: [0],
				edges: [
					[0, 1],
					[2, 3]
				]
			});
			const computeHops = hopsThrough(
				[
					{ sourceNodeId: 'n0', targetNodeId: 'n2' },
					{ sourceNodeId: 'n0', targetNodeId: 'n3' }
				],
				{ displayedLayers: 2 }
			);
			const runtime = new LayoutRuntime({
				getGraph: () => paired,
				getLayoutSettings: () => ({ displayedLayers: 2 }),
				getActiveDragNodeId: () => null,
				getPreferredBeaconNodeIds: () => [],
				applyGraph: () => {},
				computeHops,
				scheduler: new TestScheduler()
			});
			const hopsByNodeId = computeHops(paired);
			const visible = runtime.visibleGraphFor(paired, hopsByNodeId);
			const layout = deriveGraphLayout(
				visible,
				runtime.layoutOptions(visible, { hopsByNodeId, relaxIterations: 0 })
			);

			expect(layout.scaleByNodeId.n3).toBe(layout.scaleByNodeId.n1);
		});

		it('keeps the drawn neighbor of a dataflow-linked node off the canvas and out of the physics', () => {
			// root -dataflow-> n1 -authored-> n2. Crossing the derived edge spends the
			// authored budget, so n1 arrives and the n2 it was drawn to does not —
			// sizing and visibility saying the same thing, rather than one of them
			// holding n2 at a flat hop nothing relates to.
			const behind = makeGraph({ nodeCount: 3, pinned: [0], edges: [[1, 2]] });
			const computeHops = hopsThrough([{ sourceNodeId: 'n0', targetNodeId: 'n1' }], {
				displayedLayers: 3
			});
			const runtime = new LayoutRuntime({
				getGraph: () => behind,
				getLayoutSettings: () => ({ displayedLayers: 3 }),
				getActiveDragNodeId: () => null,
				getPreferredBeaconNodeIds: () => [],
				applyGraph: () => {},
				computeHops,
				scheduler: new TestScheduler()
			});
			const hopsByNodeId = computeHops(behind);

			expect(hopsByNodeId.n1).toBe(1);
			expect(hopsByNodeId.n2).toBe(Infinity);
			expect(runtime.visibleGraphFor(behind, hopsByNodeId).nodes.map((node) => node.id)).toEqual([
				'n0',
				'n1'
			]);
		});

		it('sizes by distance with nothing pinned at all', () => {
			// Same chain, no pin anywhere. Each authored cluster keeps its own anchor
			// — an equation must not be able to make one of them mostly vanish — so
			// n0 and n2 both start reading at the beacon hop, and n1, the one the
			// equation reaches out of n0, sits a step past it.
			const unpinned = makeGraph({ nodeCount: 3, edges: [[1, 2]] });
			const withHistory = {
				...unpinned,
				nodes: unpinned.nodes.map((node) =>
					node.id === 'n0'
						? { ...node, lastPinnedSeq: 2 }
						: node.id === 'n2'
							? { ...node, lastPinnedSeq: 1 }
							: node
				)
			};
			const computeHops = hopsThrough([{ sourceNodeId: 'n0', targetNodeId: 'n1' }], {
				displayedLayers: 3
			});
			const runtime = new LayoutRuntime({
				getGraph: () => withHistory,
				getLayoutSettings: () => ({ displayedLayers: 3 }),
				getActiveDragNodeId: () => null,
				getPreferredBeaconNodeIds: () => [],
				applyGraph: () => {},
				computeHops,
				scheduler: new TestScheduler()
			});
			const hopsByNodeId = computeHops(withHistory);
			const visible = runtime.visibleGraphFor(withHistory, hopsByNodeId);
			const layout = deriveGraphLayout(
				visible,
				runtime.layoutOptions(visible, { hopsByNodeId, relaxIterations: 0 })
			);

			expect(layout.scaleByNodeId.n1).toBeLessThan(layout.scaleByNodeId.n0);
			expect(layout.scaleByNodeId.n2).toBe(layout.scaleByNodeId.n0);
		});

		it('does not reveal a node whose partner is hidden too', () => {
			// n3 and n4 are both out of view, so there is nothing to hang n4 off.
			expect(relaxedN4([{ sourceNodeId: 'n3', targetNodeId: 'n4' }])).toEqual(graph.posByNodeId.n4);
		});
	});

	describe('the reveal wave over the composed render edges', () => {
		function derivedEdge(sourceNodeId: string, targetNodeId: string): EdgeData {
			return {
				id: derivedEdgeId(sourceNodeId, targetNodeId),
				sourceNodeId,
				targetNodeId,
				tags: [],
				directed: true,
				springFactor: 1
			};
		}

		/**
		 * A runtime wired the way `Multigraph.svelte` wires one: the same derived
		 * edges feed the hop map and the composition, so what the wave diffs is
		 * what the canvas draws.
		 */
		function waveFixture(
			graph: MultigraphData,
			derivedEdges: readonly EdgeData[],
			settings: Partial<LayoutSettings> = {}
		) {
			const resolved: Partial<LayoutSettings> = {
				relaxIterations: 0,
				displayedLayers: 1,
				scaleAnimationDurationMs: 100,
				postScaleChangeSettleMaxFrames: 0,
				...settings
			};
			let current = graph;
			const scheduler = new TestScheduler();
			const computeHops = hopsThrough(derivedEdges, {
				displayedLayers: resolved.displayedLayers,
				dataflowDisplayedLayers: resolved.dataflowDisplayedLayers
			});
			const runtime = new LayoutRuntime({
				getGraph: () => current,
				getLayoutSettings: () => resolved,
				getActiveDragNodeId: () => null,
				getPreferredBeaconNodeIds: () => [],
				applyGraph: (nextGraph) => {
					current = nextGraph;
				},
				computeHops,
				composeDerivedEdges: () => derivedEdges,
				scheduler
			});

			return {
				runtime,
				computeHops,
				getGraph: () => current,
				beginScaleChangeAt: (nowMs: number, focalNodeId: string, nextGraph: MultigraphData) => {
					scheduler.nowMs = nowMs;
					current = runtime.beginScaleChange(nextGraph, focalNodeId);
				}
			};
		}

		it('fades a derived arrow out with the wave when its endpoints leave', () => {
			// n3 and n5 are on screen only because n4 is pinned. Unpinning it takes
			// the equation between them off the canvas too, and an arrow that
			// vanished on the first frame while the authored edges swept out would
			// read as a glitch rather than as the same movement.
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
			const fadingArrow = derivedEdge('n3', 'n5');
			const { runtime, getGraph, beginScaleChangeAt } = waveFixture(graph, [fadingArrow]);

			beginScaleChangeAt(10, 'n4', togglePinned(getGraph(), 'n4'));

			expect(runtime.revealWavePreviousOnlyEdgeVisibility.map((entry) => entry.edge.id)).toContain(
				fadingArrow.id
			);

			runtime.step(30);
			const midFade = runtime.revealWaveEdgeOpacityByEdgeId[fadingArrow.id];
			expect(midFade).toBeGreaterThan(0);
			expect(midFade).toBeLessThan(1);

			runtime.step(60);
			expect(runtime.revealWaveEdgeOpacityByEdgeId[fadingArrow.id]).toBeLessThan(midFade);
		});

		it('fades a derived arrow in with the wave when its endpoints arrive', () => {
			// Pinning n2 brings n2 and n3 on screen, and the equation between them
			// with them. Without an entry in the wave the renderer falls back to
			// full opacity, so the arrow snapped in ahead of everything it connects.
			const graph = makeGraph({
				nodeCount: 4,
				pinned: [0],
				edges: [
					[0, 1],
					[1, 2],
					[2, 3]
				]
			});
			const arrivingArrow = derivedEdge('n2', 'n3');
			const { runtime, getGraph, beginScaleChangeAt } = waveFixture(graph, [arrivingArrow]);

			beginScaleChangeAt(10, 'n2', togglePinned(getGraph(), 'n2'));

			runtime.step(30);
			const midFade = runtime.revealWaveEdgeOpacityByEdgeId[arrivingArrow.id];
			expect(midFade).toBeGreaterThan(0);
			expect(midFade).toBeLessThan(1);

			runtime.step(60);
			expect(runtime.revealWaveEdgeOpacityByEdgeId[arrivingArrow.id]).toBeGreaterThan(midFade);
		});

		it('keeps a derived edge at the visibility boundary out of the wave', () => {
			// A derived edge renders only when both endpoints are visible, so a
			// boundary one is not on the canvas to be cross-faded. With no derived
			// budget n2 stays hidden, and the arrow into it is a stub the renderer
			// drops — while the authored edge alongside it keeps its boundary fade.
			const graph = makeGraph({
				nodeCount: 4,
				pinned: [0],
				edges: [
					[0, 1],
					[1, 2],
					[2, 3]
				]
			});
			const stubArrow = derivedEdge('n1', 'n2');
			const { runtime, getGraph, beginScaleChangeAt } = waveFixture(graph, [stubArrow], {
				dataflowDisplayedLayers: 0
			});

			beginScaleChangeAt(10, 'n2', togglePinned(getGraph(), 'n2'));

			const revealState = runtime.scaleChangeRevealState;
			const previousEdgeIds = (revealState?.previousRenderableEdges ?? []).map(
				(entry) => entry.edge.id
			);
			expect(previousEdgeIds).toContain('e1');
			expect(previousEdgeIds).not.toContain(stubArrow.id);
			// Both endpoints arrive with the pin, so it joins the wave on the way in.
			expect(revealState?.nextRenderableEdgeIds).toContain(stubArrow.id);
		});

		it('snapshots a dataflow-sized node at the scale it was drawn at', () => {
			// n4 is four authored hops out — off screen on its own account — and on
			// screen only because an equation reaches it from n1, one hop past its
			// anchor. The wave's previous-scale snapshot reads the same hop map the
			// layout sized it with, so it enters the wave at the size it was drawn
			// rather than at the flat hop a separate visibility measure handed it.
			const graph = makeGraph({
				nodeCount: 5,
				pinned: [0],
				edges: [
					[0, 1],
					[1, 2],
					[2, 3],
					[3, 4]
				]
			});
			const { runtime, computeHops, getGraph, beginScaleChangeAt } = waveFixture(
				graph,
				[derivedEdge('n1', 'n4')],
				{ displayedLayers: 3, dataflowDisplayedLayers: 1 }
			);
			const previousHopsByNodeId = computeHops(graph);
			const previousVisibleGraph = runtime.visibleGraphFor(graph, previousHopsByNodeId);
			const drawnLayout = deriveGraphLayout(
				previousVisibleGraph,
				runtime.layoutOptions(previousVisibleGraph, {
					hopsByNodeId: previousHopsByNodeId,
					relaxIterations: 0
				})
			);

			expect(previousHopsByNodeId.n4).toBe(2);

			beginScaleChangeAt(10, 'n1', togglePinned(getGraph(), 'n1'));
			runtime.step(30);

			expect(runtime.revealWavePreviousScaleByNodeId.n4).toBe(drawnLayout.scaleByNodeId.n4);
			// Teeth: the one-hop scale is ~43% larger, which is the jump this pins shut.
			expect(runtime.revealWavePreviousScaleByNodeId.n4).toBeCloseTo(
				DEFAULT_LAYOUT_SETTINGS.scaleFalloff ** 2
			);
			expect(runtime.revealWavePreviousScaleByNodeId.n4).toBeLessThan(drawnLayout.scaleByNodeId.n1);
		});
	});

	describe('renderer and runtime agree on who is on screen', () => {
		// The guarantee one hop map buys: a node on the canvas is in the physics
		// graph and a node in the physics graph is on the canvas. The renderer
		// filters the map itself; the runtime is handed the same function. Before
		// this, two hand-synchronized chains computed the two answers, and a node
		// drawn without physics sat stale while everything moved around and
		// through it.
		const derived = (sourceNodeId: string, targetNodeId: string) => ({
			sourceNodeId,
			targetNodeId
		});

		const fixtures: {
			name: string;
			graph: MultigraphData;
			derivedEdges: readonly EdgeEndpointIds[];
			displayedLayers: number;
			/**
			 * Query text whose exclusions leave the layout. Both sides reduce by it
			 * first, as Multigraph does; absent means nothing is excluded.
			 */
			excluded?: string;
			/**
			 * Exactly who is on screen under the exclusion, and not without it — so
			 * an exclusion fixture fails if the reduction stops reaching either side.
			 */
			onScreen?: readonly string[];
		}[] = [
			{
				name: 'a pinned chain running past the displayed layers',
				graph: makeGraph({
					nodeCount: 5,
					pinned: [0],
					edges: [
						[0, 1],
						[1, 2],
						[2, 3],
						[3, 4]
					]
				}),
				derivedEdges: [],
				displayedLayers: 2
			},
			{
				name: 'nothing pinned, two authored clusters on their beacons',
				graph: makeGraph({
					nodeCount: 5,
					edges: [
						[0, 1],
						[2, 3]
					],
					pinHistory: { 0: 2, 2: 1 }
				}),
				derivedEdges: [],
				displayedLayers: 2
			},
			{
				name: 'a derived edge revealing a node past the layers',
				graph: makeGraph({
					nodeCount: 5,
					pinned: [0],
					edges: [
						[0, 1],
						[1, 2],
						[2, 3],
						[3, 4]
					]
				}),
				derivedEdges: [derived('n0', 'n4')],
				displayedLayers: 2
			},
			{
				// n4 arrives across one equation; n5, a second derived step behind it,
				// does not — the case that used to leave a stub arrow pointing at
				// somewhere the reader cannot go.
				name: 'a chained equation whose far end is past the derived budget',
				graph: makeGraph({
					nodeCount: 6,
					pinned: [0],
					edges: [
						[0, 1],
						[1, 2],
						[2, 3],
						[3, 4],
						[4, 5]
					]
				}),
				derivedEdges: [derived('n2', 'n4'), derived('n4', 'n5')],
				displayedLayers: 2
			},
			{
				name: 'a derived edge between two nodes that are already visible',
				graph: makeGraph({
					nodeCount: 5,
					pinned: [0],
					edges: [
						[0, 1],
						[1, 2],
						[2, 3],
						[3, 4]
					]
				}),
				derivedEdges: [derived('n0', 'n2')],
				displayedLayers: 3
			},
			{
				name: 'a mix of pins, beacons and equations',
				graph: makeGraph({
					nodeCount: 7,
					pinned: [0],
					edges: [
						[0, 1],
						[1, 2],
						[3, 4],
						[5, 6]
					],
					pinHistory: { 3: 1 }
				}),
				derivedEdges: [derived('n1', 'n5'), derived('n4', 'n6')],
				displayedLayers: 2
			},
			{
				// n2 is the only way from the pin to n3 and n4. With it gone they are a
				// pinless component of their own: n3 is elected its beacon and stays,
				// while the far end, n4, has no route left to it.
				name: 'a pinned chain whose middle node is excluded',
				graph: withNodeTags(
					makeGraph({
						nodeCount: 5,
						pinned: [0],
						edges: [
							[0, 1],
							[1, 2],
							[2, 3],
							[3, 4]
						]
					}),
					{ n2: ['hidden'] }
				),
				derivedEdges: [],
				displayedLayers: 4,
				excluded: '-#hidden',
				onScreen: ['n0', 'n1', 'n3']
			},
			{
				// The pin itself is excluded, so its component has no pin left and
				// elects a beacon: n1, its best-connected node, drawn alone.
				name: 'an excluded pinned node whose neighbour becomes a beacon',
				graph: withNodeTags(
					makeGraph({
						nodeCount: 4,
						pinned: [0],
						edges: [
							[0, 1],
							[1, 2],
							[1, 3]
						]
					}),
					{ n0: ['hidden'] }
				),
				derivedEdges: [],
				displayedLayers: 2,
				excluded: '-#hidden',
				onScreen: ['n1']
			},
			{
				// Only the edge goes; both its ends stay. n2 and n3 are cut off from the
				// pin, n2 becomes their beacon, and n3 has no route left to it.
				name: 'an edge excluded by tag that was the only route to a node',
				graph: makeGraph({
					nodeCount: 4,
					pinned: [0],
					edges: [[0, 1], { source: 1, target: 2, tags: ['bridge'] }, [2, 3]]
				}),
				derivedEdges: [],
				displayedLayers: 3,
				excluded: '-@bridge',
				onScreen: ['n0', 'n1', 'n2']
			},
			{
				// The equation reaches n4 past the layers. With n4 excluded it defines
				// nothing, so there is no derived edge to it and nothing to reveal.
				name: 'a derived edge into an excluded node',
				graph: withNodeTags(
					makeGraph({
						nodeCount: 5,
						pinned: [0],
						edges: [
							[0, 1],
							[1, 2],
							[2, 3],
							[3, 4]
						]
					}),
					{ n4: ['hidden'] }
				),
				derivedEdges: [derived('n0', 'n4')],
				displayedLayers: 2,
				excluded: '-#hidden',
				onScreen: ['n0', 'n1', 'n2']
			}
		];

		function derivedLayoutEdge({ sourceNodeId, targetNodeId }: EdgeEndpointIds): EdgeData {
			return {
				id: derivedEdgeId(sourceNodeId, targetNodeId),
				sourceNodeId,
				targetNodeId,
				tags: [],
				directed: true,
				springFactor: 1
			};
		}

		/**
		 * The derived edges a graph has, standing in for the dataflow layer: in the
		 * app it reads the layout source, so an excluded node defines nothing and
		 * no equation reaches it.
		 */
		function derivedEdgesOf(
			fixture: (typeof fixtures)[number],
			graph: MultigraphData
		): EdgeEndpointIds[] {
			const nodeIds = new Set(graph.nodes.map((node) => node.id));
			return fixture.derivedEdges.filter(
				(edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId)
			);
		}

		function onScreenWith(
			fixture: (typeof fixtures)[number],
			reduceLayoutSource?: (graph: MultigraphData) => MultigraphData
		) {
			const computeHops = (graph: MultigraphData) =>
				hopsThrough(derivedEdgesOf(fixture, graph), {
					displayedLayers: fixture.displayedLayers
				})(graph);
			const runtime = new LayoutRuntime({
				getGraph: () => fixture.graph,
				getLayoutSettings: () => ({ displayedLayers: fixture.displayedLayers }),
				getActiveDragNodeId: () => null,
				getPreferredBeaconNodeIds: () => [],
				applyGraph: () => {},
				computeHops,
				composeDerivedEdges: (graph) => derivedEdgesOf(fixture, graph).map(derivedLayoutEdge),
				reduceLayoutSource,
				scheduler: new TestScheduler()
			});

			// The renderer's side, as Multigraph computes it: reduce, then measure.
			const layoutSource = reduceLayoutSource?.(fixture.graph) ?? fixture.graph;
			const drawnNodeIds = visibleNodeIdsForPinnedNeighborhood(
				layoutSource,
				computeHops(layoutSource),
				{ displayedLayers: fixture.displayedLayers }
			);
			// The runtime is handed the whole graph and reduces it itself.
			const physicsGraph = runtime.visibleGraphFor(fixture.graph);

			return { runtime, layoutSource, drawnNodeIds, physicsGraph };
		}

		for (const fixture of fixtures) {
			it(`draws exactly the nodes physics places: ${fixture.name}`, () => {
				const { runtime, layoutSource, drawnNodeIds, physicsGraph } = onScreenWith(
					fixture,
					reducerFor(fixture.excluded ?? '')
				);
				const physicsNodeIds = new Set(physicsGraph.nodes.map((node) => node.id));

				expect([...physicsNodeIds].sort()).toEqual([...drawnNodeIds].sort());
				// A fixture that shows everything would pass without saying anything.
				expect(physicsNodeIds.size).toBeLessThan(fixture.graph.nodes.length);
				// Handing the runtime the already-reduced graph changes nothing.
				expect(runtime.visibleGraphFor(layoutSource)).toEqual(physicsGraph);

				if (fixture.onScreen === undefined) return;
				expect([...physicsNodeIds].sort()).toEqual([...fixture.onScreen].sort());
				// Nothing in the physics graph touches an excluded element, derived
				// edges included.
				const excluded = excludedGraphElements(
					evaluateGraphQuery(fixture.graph, fixture.excluded ?? '')
				);
				for (const edge of physicsGraph.edges) {
					expect(excluded.edgeIds.has(edge.id)).toBe(false);
					expect(excluded.nodeIds.has(edge.sourceNodeId)).toBe(false);
					expect(excluded.nodeIds.has(edge.targetNodeId)).toBe(false);
				}
				// Teeth: without the exclusion a different set is on screen.
				const unreduced = new Set(onScreenWith(fixture).drawnNodeIds);
				expect([...unreduced].sort()).not.toEqual([...fixture.onScreen].sort());
			});
		}
	});
});
