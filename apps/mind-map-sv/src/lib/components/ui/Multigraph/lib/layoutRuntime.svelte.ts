import type { EdgeData } from '../../types/edge';
import type { MultigraphData } from '../../types/multigraph';
import { beaconNodeIds } from './beacons';
import {
	composeVisibleLayoutGraph,
	computeBoundedHops,
	edgeVisibilityForPinnedNeighborhood,
	pinnedNodeIds,
	visibleNodeIdsForPinnedNeighborhood
} from './boundedVisibility';
import type { EdgeVisibility } from './boundedVisibility';
import { isDerivedEdgeId } from './derivedEdges';
import {
	deriveGraphLayout,
	relaxGraphPositionsStep,
	withRelaxedGraphPositions,
	type GraphLayoutOptions
} from './graphLayout';
import { scaleByHops } from './layout';
import {
	advanceLayeredRelayout,
	initialLayeredRelayoutState,
	participatingNodeIds,
	relayoutStateKey,
	shouldClearLayeredRelayoutState,
	type LayeredRelayoutState
} from './layeredRelayout';
import type { LayoutSettings } from './layoutSettings';
import { withDefaultLayoutSettings } from './layoutSettings';
import {
	animatedScalesAt,
	createScaleAnimations,
	hasActiveScaleAnimations,
	pruneFinishedScaleAnimations,
	type NodeScaleAnimation
} from './scaleAnimation';
import {
	scaleChangeLayoutAnchoredNodeIds,
	settleStateAfterScaleAnimationsEnd,
	settleStateForScaleChange,
	shouldClearScaleChangeFocalNode
} from './scaleChangeSettle';
import {
	revealWaveEdgeOpacity,
	revealWaveNodeOpacities,
	revealWaveProgressFromFocalAnimation
} from './revealWave';

type RenderableEdgeVisibility = Exclude<EdgeVisibility, { kind: 'hidden' }>;

interface ScaleChangeRevealState {
	previousHopsByNodeId: Record<string, number>;
	nextHopsByNodeId: Record<string, number>;
	previousVisibleNodeIds: readonly string[];
	nextVisibleNodeIds: readonly string[];
	previousRenderableEdges: readonly RenderableEdgeVisibility[];
	nextRenderableEdges: readonly RenderableEdgeVisibility[];
	nextRenderableEdgeIds: readonly string[];
}

export interface LayoutRuntimeScheduler {
	requestFrame(callback: (nowMs: number) => void): number;
	cancelFrame(frameId: number): void;
	now(): number;
}

interface LayoutRuntimeOptions {
	getGraph: () => MultigraphData;
	getLayoutSettings: () => Partial<LayoutSettings>;
	getActiveDragNodeId: () => string | null;
	/** Session-transient beacon hints (e.g. endpoints of a just-removed edge). */
	getPreferredBeaconNodeIds: () => readonly string[];
	applyGraph: (data: MultigraphData) => void;
	/**
	 * The one hop map, computed by whoever owns the graph — in the app, the same
	 * `computeBoundedHops` call the renderer draws from. Visibility, node scale,
	 * the reveal wave, and physics distance all read the result, so a node on the
	 * canvas is in the physics graph by construction rather than by two chains
	 * being kept in step.
	 *
	 * Takes the graph as an argument because the runtime asks about graphs that
	 * do not exist yet: the mutation being relaxed, and the before/after pair a
	 * reveal wave cross-fades. Always a whole graph, never a visible subgraph —
	 * inside one, a beacon or a node an equation revealed has no edges left to be
	 * measured along.
	 *
	 * Defaults to authored hops plus beacons, which is every graph with no math
	 * in it.
	 */
	computeHops?: (graph: MultigraphData) => Record<string, number>;
	/**
	 * The derived edges of a graph — in the app, the dataflow layer — which
	 * `visibleGraphFor` joins to the visible layout graph as ordinary edges.
	 * Takes the whole graph, like `computeHops`, and returns every derived edge
	 * it has; the composition drops the ones reaching off screen.
	 *
	 * Defaults to none, which is every graph with no math in it.
	 */
	composeDerivedEdges?: (graph: MultigraphData) => readonly EdgeData[];
	scheduler?: LayoutRuntimeScheduler;
	/** Returns true while enter/exit animations are active; keeps the frame loop running. */
	getHasActiveTransitions?: () => boolean;
	/** Called at the start of each frame tick (after animationNowMs is updated). */
	onFrame?: (nowMs: number) => void;
}

export class LayoutRuntime {
	scaleAnimations = $state<Record<string, NodeScaleAnimation>>({});
	animationNowMs = $state(0);
	settleFramesRemaining = $state(0);
	pendingPostScaleSettle = $state(false);
	scaleChangeFocalNodeId = $state<string | null>(null);
	layeredRelayoutState = $state<LayeredRelayoutState | null>(null);
	lastRelayoutStateKey = $state<string | null>(null);
	scaleChangeRevealState = $state<ScaleChangeRevealState | null>(null);

	#frameId: number | null = null;
	#options: LayoutRuntimeOptions;
	#scheduler: LayoutRuntimeScheduler;

	constructor(options: LayoutRuntimeOptions) {
		this.#options = options;
		this.#scheduler = options.scheduler ?? browserAnimationFrameScheduler();
	}

	get animatedScaleByNodeId(): Record<string, number> {
		return animatedScalesAt(this.scaleAnimations, this.animationNowMs);
	}

	get scaleAnchoredNodeIds(): readonly string[] {
		return scaleChangeLayoutAnchoredNodeIds(this.scaleChangeFocalNodeId, {
			pendingPostScaleSettle: this.pendingPostScaleSettle,
			settleFramesRemaining: this.settleFramesRemaining,
			hasActiveScaleAnimations: this.hasActiveScaleAnimations
		});
	}

	get hasActiveScaleAnimations(): boolean {
		return hasActiveScaleAnimations(this.scaleAnimations, this.animationNowMs);
	}

	get isSettling(): boolean {
		return this.settleFramesRemaining > 0;
	}

	get isLayeredRelayoutActive(): boolean {
		return this.layeredRelayoutState?.active === true;
	}

	get relayoutStateKey(): string | null {
		return this.lastRelayoutStateKey;
	}

	reset(): void {
		this.stop();
		this.scaleAnimations = {};
		this.animationNowMs = 0;
		this.settleFramesRemaining = 0;
		this.pendingPostScaleSettle = false;
		this.scaleChangeFocalNodeId = null;
		this.layeredRelayoutState = null;
		this.lastRelayoutStateKey = null;
		this.scaleChangeRevealState = null;
	}

	now(): number {
		return this.#scheduler.now();
	}

	start(): void {
		if (this.#frameId !== null) return;
		this.#frameId = this.#scheduler.requestFrame((nowMs) => this.step(nowMs));
	}

	stop(): void {
		if (this.#frameId === null) return;
		this.#scheduler.cancelFrame(this.#frameId);
		this.#frameId = null;
	}

	beginDrag(): void {
		this.settleFramesRemaining = 0;
		this.start();
	}

	settleAfterDrag(): void {
		this.settleFramesRemaining = this.#resolvedSettings().postDragSettleMaxFrames;
		this.start();
	}

	/**
	 * A layout setting just changed under a graph that may well be sitting still.
	 * Physics reads its tunables per frame, so nothing has to be recomputed here —
	 * what is missing is frames. This buys some, and the nodes walk to the rest
	 * positions the new numbers describe instead of holding the ones the old
	 * numbers left them in, overlapping wherever a resize made them bigger.
	 *
	 * The budget is topped up rather than assigned because this fires on every
	 * pointermove of a slider drag: a plain assignment would hand back the full
	 * budget on each of them, and the settle could never count down to a stop
	 * while the pointer was still holding the slider.
	 */
	settleAfterSettingsChange(): void {
		// A drag owns the budget while it lasts: `beginDrag` zeroes it deliberately,
		// keeping the loop alive off the drag itself so the settle only begins when
		// the finger lifts. Funding a settle here would run one against a node the
		// pointer is still moving.
		if (this.#options.getActiveDragNodeId() === null) {
			this.settleFramesRemaining = Math.max(
				this.settleFramesRemaining,
				this.#resolvedSettings().postDragSettleMaxFrames
			);
		}
		this.start();
	}

	relaxAfterMutation(
		nextGraph: MultigraphData,
		dragNodeId: string | null = this.#options.getActiveDragNodeId(),
		relaxIterations = this.#options.getLayoutSettings().relaxIterations
	): MultigraphData {
		const hopsByNodeId = this.#hopsFor(nextGraph);
		const nextVisibleGraph = this.visibleGraphFor(nextGraph, hopsByNodeId);
		const relaxedVisibleGraph = withRelaxedGraphPositions(
			nextVisibleGraph,
			this.layoutOptions(nextVisibleGraph, {
				hopsByNodeId,
				activeDragNodeId: dragNodeId,
				relaxIterations
			})
		);

		return mergeVisiblePositions(nextGraph, relaxedVisibleGraph);
	}

	beginScaleChange(nextGraph: MultigraphData, focalNodeId: string): MultigraphData {
		this.scaleChangeFocalNodeId = focalNodeId;
		const currentGraph = this.#options.getGraph();
		const currentHopsByNodeId = this.#hopsFor(currentGraph);
		const nextHopsByNodeId = this.#hopsFor(nextGraph);
		const currentVisibleGraph = this.visibleGraphFor(currentGraph, currentHopsByNodeId);
		const nextVisibleGraph = this.visibleGraphFor(nextGraph, nextHopsByNodeId);
		this.scaleChangeRevealState = this.#createScaleChangeRevealState(
			currentGraph,
			nextGraph,
			currentHopsByNodeId,
			nextHopsByNodeId
		);
		const fromLayout = deriveGraphLayout(
			currentVisibleGraph,
			this.layoutOptions(currentVisibleGraph, {
				hopsByNodeId: currentHopsByNodeId,
				relaxIterations: 0
			})
		);
		const targetLayout = deriveGraphLayout(
			nextVisibleGraph,
			this.layoutOptions(nextVisibleGraph, { hopsByNodeId: nextHopsByNodeId, relaxIterations: 0 })
		);
		const nowMs = this.#scheduler.now();
		const scaleAnimationDurationMs = this.#resolvedSettings().scaleAnimationDurationMs;
		let nextAnimations =
			scaleAnimationDurationMs > 0
				? createScaleAnimations(
						fromLayout.scaleByNodeId,
						targetLayout.scaleByNodeId,
						nowMs,
						scaleAnimationDurationMs
					)
				: {};
		if (scaleAnimationDurationMs > 0 && !nextAnimations[focalNodeId]) {
			const focalScale =
				fromLayout.scaleByNodeId[focalNodeId] ?? targetLayout.scaleByNodeId[focalNodeId] ?? 1;
			nextAnimations = {
				...nextAnimations,
				[focalNodeId]: {
					fromScale: focalScale,
					toScale: focalScale,
					startedAtMs: nowMs,
					durationMs: scaleAnimationDurationMs
				}
			};
		}

		this.scaleAnimations = nextAnimations;
		this.animationNowMs = nowMs;
		this.startLayeredRelayout(nextGraph, nowMs);
		const settleState = settleStateForScaleChange(
			Object.keys(nextAnimations).length > 0,
			this.#resolvedSettings().postScaleChangeSettleMaxFrames
		);
		this.pendingPostScaleSettle = settleState.pendingPostScaleSettle;
		this.settleFramesRemaining = settleState.settleFramesRemaining;

		if (
			Object.keys(nextAnimations).length > 0 ||
			this.settleFramesRemaining > 0 ||
			this.layeredRelayoutState?.active
		) {
			this.start();
		}

		const relaxedVisibleGraph = withRelaxedGraphPositions(
			nextVisibleGraph,
			this.layoutOptions(nextVisibleGraph, {
				hopsByNodeId: nextHopsByNodeId,
				relaxIterations: this.#options.getLayoutSettings().relaxIterations,
				scaleByNodeId: animatedScalesAt(nextAnimations, nowMs),
				scaleAnchoredNodeIds: [focalNodeId]
			})
		);

		return mergeVisiblePositions(nextGraph, relaxedVisibleGraph);
	}

	startLayeredRelayout(nextGraph: MultigraphData, nowMs: number): void {
		const pinnedIds = pinnedNodeIds(nextGraph);
		this.layeredRelayoutState = initialLayeredRelayoutState(
			pinnedIds,
			this.#resolvedSettings().layeredRelayoutSettleMaxFrames
		);
		this.lastRelayoutStateKey = relayoutStateKey(this.layeredRelayoutState);
		this.animationNowMs = nowMs;
	}

	/**
	 * `layoutGraph` is the composed visible graph; `hopsByNodeId` must be the map for
	 * the whole graph it came out of, so a beacon or an equation-revealed node —
	 * both edgeless once the hidden nodes are gone — keeps the distance it was
	 * actually measured at. Beacons stay unanchored: overlap resolution and
	 * (bounded) hop repulsion must be able to move them off other clusters.
	 *
	 * Required, and the one member of this bag that is not an override: the only
	 * map it could have fallen back to is a fresh BFS over `layoutGraph`, which is
	 * the measurement the paragraph above rules out. A caller with no hop map to
	 * hand does not want a quietly worse one computed for it — it wants the type
	 * error. `GraphLayoutOptions` has required this all along; this is the last
	 * place that was manufacturing a value to satisfy it.
	 */
	layoutOptions(
		layoutGraph: MultigraphData,
		overrides: {
			hopsByNodeId: Record<string, number>;
			activeDragNodeId?: string | null;
			relaxIterations?: number;
			scaleByNodeId?: Record<string, number>;
			scaleAnchoredNodeIds?: readonly string[];
			participatingNodeIds?: ReadonlySet<string>;
			mobilityByNodeId?: Record<string, number>;
		}
	): GraphLayoutOptions {
		const nodeIds = layoutGraph.nodes.map((node) => node.id);
		const relayoutParticipating =
			overrides.participatingNodeIds ?? participatingNodeIds(nodeIds, this.layeredRelayoutState);

		return {
			settings: this.#options.getLayoutSettings(),
			activeDragNodeId: overrides.activeDragNodeId ?? this.#options.getActiveDragNodeId(),
			scaleAnchoredNodeIds: overrides.scaleAnchoredNodeIds ?? this.scaleAnchoredNodeIds,
			hopsByNodeId: overrides.hopsByNodeId,
			relaxIterations: overrides.relaxIterations,
			scaleByNodeId: overrides.scaleByNodeId ?? this.animatedScaleByNodeId,
			participatingNodeIds: relayoutParticipating,
			mobilityByNodeId: overrides.mobilityByNodeId
		};
	}

	step(nowMs: number): void {
		this.#frameId = null;
		this.animationNowMs = nowMs;
		this.#options.onFrame?.(nowMs);

		const nextScaleByNodeId = animatedScalesAt(this.scaleAnimations, nowMs);
		const shouldRelax =
			this.#options.getActiveDragNodeId() !== null ||
			this.settleFramesRemaining > 0 ||
			Object.keys(nextScaleByNodeId).length > 0 ||
			this.layeredRelayoutState?.active === true;

		if (shouldRelax) {
			const currentGraph = this.#options.getGraph();
			const hopsByNodeId = this.#hopsFor(currentGraph);
			const currentVisibleGraph = this.visibleGraphFor(currentGraph, hopsByNodeId);
			const step = relaxGraphPositionsStep(
				currentVisibleGraph,
				this.layoutOptions(currentVisibleGraph, {
					hopsByNodeId,
					relaxIterations: 1,
					scaleByNodeId: nextScaleByNodeId
				})
			);
			this.#options.applyGraph(mergeVisiblePositions(currentGraph, step.data));

			if (this.#options.getActiveDragNodeId() === null && this.settleFramesRemaining > 0) {
				this.settleFramesRemaining -= 1;
				if (step.maxPositionDelta <= this.#resolvedSettings().postDragSettleEpsilonPx) {
					this.settleFramesRemaining = 0;
				}
			}

			if (this.#options.getActiveDragNodeId() === null && this.layeredRelayoutState?.active) {
				const previousStateKey = this.lastRelayoutStateKey;
				this.layeredRelayoutState = advanceLayeredRelayout(this.layeredRelayoutState, {
					maxPositionDelta: step.maxPositionDelta,
					settleEpsilonPx: this.#resolvedSettings().layeredRelayoutSettleEpsilonPx
				});
				const nextStateKey = relayoutStateKey(this.layeredRelayoutState);
				if (nextStateKey !== previousStateKey) {
					this.lastRelayoutStateKey = nextStateKey;
				}
			}
		}

		this.scaleAnimations = pruneFinishedScaleAnimations(this.scaleAnimations, nowMs);

		const postScaleSettle = settleStateAfterScaleAnimationsEnd(
			this.pendingPostScaleSettle,
			this.#resolvedSettings().postScaleChangeSettleMaxFrames
		);
		if (postScaleSettle !== null) {
			this.pendingPostScaleSettle = postScaleSettle.pendingPostScaleSettle;
			this.settleFramesRemaining = postScaleSettle.settleFramesRemaining;
		}

		if (
			shouldClearScaleChangeFocalNode(this.scaleChangeFocalNodeId, {
				pendingPostScaleSettle: this.pendingPostScaleSettle,
				settleFramesRemaining: this.settleFramesRemaining,
				hasActiveScaleAnimations: hasActiveScaleAnimations(this.scaleAnimations, nowMs)
			})
		) {
			this.scaleChangeFocalNodeId = null;
			this.scaleChangeRevealState = null;
		}

		if (shouldClearLayeredRelayoutState(this.layeredRelayoutState)) {
			this.layeredRelayoutState = null;
			this.lastRelayoutStateKey = null;
		}

		if (
			this.#options.getActiveDragNodeId() !== null ||
			this.settleFramesRemaining > 0 ||
			hasActiveScaleAnimations(this.scaleAnimations, nowMs) ||
			this.layeredRelayoutState?.active ||
			this.#options.getHasActiveTransitions?.()
		) {
			this.start();
		}
	}

	/**
	 * The hop map for a whole graph. One call, one answer, read by visibility,
	 * sizing, and the reveal wave alike.
	 */
	#hopsFor(graph: MultigraphData): Record<string, number> {
		const computeHops = this.#options.computeHops;
		if (computeHops) return computeHops(graph);

		const settings = this.#resolvedSettings();
		return computeBoundedHops(
			graph,
			[],
			beaconNodeIds(graph, { preferredNodeIds: this.#options.getPreferredBeaconNodeIds() }),
			{
				displayedLayers: settings.displayedLayers,
				dataflowDisplayedLayers: settings.dataflowDisplayedLayers
			}
		);
	}

	/**
	 * The graph physics runs over: exactly the nodes the canvas draws, because
	 * both sides filter the same hop map by the same budget, plus the derived
	 * edges between them. Public so a spec can hold it against the renderer's
	 * visible set — a node drawn without taking part in the physics that places
	 * it would sit stale while everything else moves around and through it.
	 *
	 * Every consumer of the visible graph — the relax step, `deriveGraphLayout`
	 * through `layoutOptions`, the scale-change layouts — reads the composition
	 * from here, so there is one place where a derived edge becomes a layout edge
	 * and no way for two of them to disagree.
	 */
	visibleGraphFor(
		graph: MultigraphData,
		hopsByNodeId: Record<string, number> = this.#hopsFor(graph)
	): MultigraphData {
		const visibleNodeIds = visibleNodeIdsForPinnedNeighborhood(graph, hopsByNodeId, {
			displayedLayers: this.#resolvedSettings().displayedLayers
		});
		return composeVisibleLayoutGraph(
			graph,
			visibleNodeIds,
			this.#options.composeDerivedEdges?.(graph)
		);
	}

	get revealWaveProgress(): number {
		return revealWaveProgressFromFocalAnimation(
			this.scaleAnimations,
			this.scaleChangeFocalNodeId,
			this.animationNowMs
		);
	}

	get revealWaveNodeOpacityByNodeId(): Record<string, number> {
		const revealState = this.scaleChangeRevealState;
		if (!revealState) return {};
		const progress = this.revealWaveProgress;
		if (progress >= 1) return {};
		const settings = this.#resolvedSettings();
		const revealNodeOpacityByNodeId = revealWaveNodeOpacities(
			revealState.nextHopsByNodeId,
			settings.displayedLayers,
			progress,
			{ frontWidthHops: settings.revealFrontWidthHops }
		);
		const hideNodeOpacityByNodeId = revealWaveNodeOpacities(
			revealState.previousHopsByNodeId,
			settings.displayedLayers,
			progress,
			{ frontWidthHops: settings.revealFrontWidthHops, direction: 'hide' }
		);
		const previousVisibleNodeIdLookup = Object.fromEntries(
			revealState.previousVisibleNodeIds.map((nodeId) => [nodeId, true])
		);
		const nextVisibleNodeIdLookup = Object.fromEntries(
			revealState.nextVisibleNodeIds.map((nodeId) => [nodeId, true])
		);
		const combinedNodeIdLookup = {
			...previousVisibleNodeIdLookup,
			...nextVisibleNodeIdLookup
		};

		return Object.fromEntries(
			Object.keys(combinedNodeIdLookup).map((nodeId) => {
				if (previousVisibleNodeIdLookup[nodeId] && nextVisibleNodeIdLookup[nodeId]) {
					return [nodeId, 1];
				}
				if (nextVisibleNodeIdLookup[nodeId])
					return [nodeId, revealNodeOpacityByNodeId[nodeId] ?? 0];
				return [nodeId, hideNodeOpacityByNodeId[nodeId] ?? 0];
			})
		);
	}

	get revealWaveEdgeOpacityByEdgeId(): Record<string, number> {
		const revealState = this.scaleChangeRevealState;
		if (!revealState) return {};
		const progress = this.revealWaveProgress;
		if (progress >= 1) return {};
		const settings = this.#resolvedSettings();
		const revealNodeOpacityByNodeId = revealWaveNodeOpacities(
			revealState.nextHopsByNodeId,
			settings.displayedLayers,
			progress,
			{ frontWidthHops: settings.revealFrontWidthHops }
		);
		const hideNodeOpacityByNodeId = revealWaveNodeOpacities(
			revealState.previousHopsByNodeId,
			settings.displayedLayers,
			progress,
			{ frontWidthHops: settings.revealFrontWidthHops, direction: 'hide' }
		);
		const previousEdgesById = Object.fromEntries(
			revealState.previousRenderableEdges.map((visibility) => [visibility.edge.id, visibility])
		) as Record<string, RenderableEdgeVisibility>;
		const nextEdgesById = Object.fromEntries(
			revealState.nextRenderableEdges.map((visibility) => [visibility.edge.id, visibility])
		) as Record<string, RenderableEdgeVisibility>;
		const nextEdgeIdLookup = Object.fromEntries(
			revealState.nextRenderableEdgeIds.map((edgeId) => [edgeId, true])
		);
		const opacityByEdgeId: Record<string, number> = {};

		for (const [edgeId, previousVisibility] of Object.entries(previousEdgesById)) {
			if (nextEdgeIdLookup[edgeId]) {
				opacityByEdgeId[edgeId] = 1;
				continue;
			}

			opacityByEdgeId[edgeId] = revealWaveEdgeOpacity(
				previousVisibility.edge,
				revealState.previousHopsByNodeId,
				hideNodeOpacityByNodeId,
				settings.displayedLayers
			);
		}

		for (const [edgeId, nextVisibility] of Object.entries(nextEdgesById)) {
			if (previousEdgesById[edgeId]) continue;
			opacityByEdgeId[edgeId] = revealWaveEdgeOpacity(
				nextVisibility.edge,
				revealState.nextHopsByNodeId,
				revealNodeOpacityByNodeId,
				settings.displayedLayers
			);
		}

		return opacityByEdgeId;
	}

	get revealWavePreviousOnlyNodeIds(): readonly string[] {
		const revealState = this.scaleChangeRevealState;
		if (!revealState || this.revealWaveProgress >= 1) return [];
		const nextVisibleNodeIdLookup = Object.fromEntries(
			revealState.nextVisibleNodeIds.map((nodeId) => [nodeId, true])
		);
		return revealState.previousVisibleNodeIds.filter((nodeId) => !nextVisibleNodeIdLookup[nodeId]);
	}

	get revealWavePreviousOnlyEdgeVisibility(): readonly RenderableEdgeVisibility[] {
		const revealState = this.scaleChangeRevealState;
		if (!revealState || this.revealWaveProgress >= 1) return [];
		const nextEdgeIdLookup = Object.fromEntries(
			revealState.nextRenderableEdgeIds.map((edgeId) => [edgeId, true])
		);
		return revealState.previousRenderableEdges.filter(
			(visibility) => !nextEdgeIdLookup[visibility.edge.id]
		);
	}

	/**
	 * The size each node had when the wave started, for the ones still drawn on
	 * their way out. `scaleByHops` of the previous hop map — the same map, through
	 * the same function, that `deriveGraphLayout` sized them with — so a node an
	 * equation put on screen exits from the size it was actually drawn at instead
	 * of jumping to the one a second, visibility-only measure implied.
	 */
	get revealWavePreviousScaleByNodeId(): Record<string, number> {
		const revealState = this.scaleChangeRevealState;
		if (!revealState || this.revealWaveProgress >= 1) return {};
		return scaleByHops(revealState.previousHopsByNodeId, this.#resolvedSettings());
	}

	#resolvedSettings(): LayoutSettings {
		return withDefaultLayoutSettings(this.#options.getLayoutSettings());
	}

	#createScaleChangeRevealState(
		currentGraph: MultigraphData,
		nextGraph: MultigraphData,
		previousHopsByNodeId: Record<string, number>,
		nextHopsByNodeId: Record<string, number>
	): ScaleChangeRevealState {
		const settings = this.#resolvedSettings();
		const previousVisibleNodeIds = Array.from(
			visibleNodeIdsForPinnedNeighborhood(currentGraph, previousHopsByNodeId, {
				displayedLayers: settings.displayedLayers
			})
		);
		const nextVisibleNodeIds = Array.from(
			visibleNodeIdsForPinnedNeighborhood(nextGraph, nextHopsByNodeId, {
				displayedLayers: settings.displayedLayers
			})
		);
		const previousRenderableEdges = this.#renderableEdgesFor(
			currentGraph,
			previousHopsByNodeId,
			settings.displayedLayers
		);
		const nextRenderableEdges = this.#renderableEdgesFor(
			nextGraph,
			nextHopsByNodeId,
			settings.displayedLayers
		);
		const nextRenderableEdgeIds = nextRenderableEdges.map((visibility) => visibility.edge.id);

		return {
			previousHopsByNodeId,
			nextHopsByNodeId,
			previousVisibleNodeIds,
			nextVisibleNodeIds,
			previousRenderableEdges,
			nextRenderableEdges,
			nextRenderableEdgeIds
		};
	}

	/**
	 * The edges a graph would draw: authored plus derived, classified against the
	 * one hop map.
	 *
	 * The wave cross-fades what is drawn, and what is drawn is the composed render
	 * graph — so the sets it diffs have to be composed too. Built from the
	 * authored edges alone, a derived arrow was in neither set: the renderer's
	 * `?? 1` fallback snapped it to full opacity while everything around it swept
	 * in, and on the way out it disappeared on the first frame with no exit fade.
	 */
	#renderableEdgesFor(
		graph: MultigraphData,
		hopsByNodeId: Record<string, number>,
		displayedLayers: number
	): RenderableEdgeVisibility[] {
		const derivedEdges = this.#options.composeDerivedEdges?.(graph) ?? [];
		const composedGraph =
			derivedEdges.length === 0 ? graph : { ...graph, edges: [...graph.edges, ...derivedEdges] };

		return edgeVisibilityForPinnedNeighborhood(composedGraph, hopsByNodeId, {
			displayedLayers
		}).filter((visibility): visibility is RenderableEdgeVisibility => {
			if (visibility.kind === 'hidden') return false;
			// A derived edge renders only when both its endpoints are visible — an
			// arrow toward somewhere the reader cannot go is worse than no arrow — so
			// a derived edge at the boundary is not on the canvas to be faded. An
			// authored edge keeps its boundary fade in the wave exactly as before.
			return !(visibility.kind === 'boundary' && isDerivedEdgeId(visibility.edge.id));
		});
	}
}

/**
 * Positions and nothing else come back from the layout graph. That is what keeps
 * the composed derived edges out of the authored graph the app mutates, checks
 * for duplicates, and saves: the spread is over `graph`, so `visibleGraph`
 * contributes only coordinates.
 */
function mergeVisiblePositions(
	graph: MultigraphData,
	visibleGraph: MultigraphData
): MultigraphData {
	return {
		...graph,
		posByNodeId: {
			...graph.posByNodeId,
			...visibleGraph.posByNodeId
		}
	};
}

function browserAnimationFrameScheduler(): LayoutRuntimeScheduler {
	return {
		requestFrame: (callback) => requestAnimationFrame(callback),
		cancelFrame: (frameId) => cancelAnimationFrame(frameId),
		now: () => performance.now()
	};
}
