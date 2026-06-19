import type { MultigraphData } from '../../types/multigraph';
import {
	edgeVisibilityForPinnedNeighborhood,
	graphWithVisibleNodes,
	pinnedNodeIds,
	visibleNodeIdsForPinnedNeighborhood
} from './boundedVisibility';
import type { EdgeVisibility } from './boundedVisibility';
import {
	deriveGraphLayout,
	relaxGraphPositionsStep,
	withRelaxedGraphPositions,
	type GraphLayoutOptions
} from './graphLayout';
import { hopsFromPinned, scaleByHops } from './layout';
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

export interface LayoutRuntimeOptions {
	getGraph: () => MultigraphData;
	getLayoutSettings: () => Partial<LayoutSettings>;
	getActiveDragNodeId: () => string | null;
	getFallbackAnchorNodeId: () => string | null;
	applyGraph: (data: MultigraphData) => void;
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

	relaxAfterMutation(
		nextGraph: MultigraphData,
		dragNodeId: string | null = this.#options.getActiveDragNodeId(),
		relaxIterations = this.#options.getLayoutSettings().relaxIterations
	): MultigraphData {
		const nextVisibleGraph = this.#visibleGraphFor(nextGraph);
		const relaxedVisibleGraph = withRelaxedGraphPositions(
			nextVisibleGraph,
			this.layoutOptions(nextVisibleGraph, {
				activeDragNodeId: dragNodeId,
				relaxIterations
			})
		);

		return mergeVisiblePositions(nextGraph, relaxedVisibleGraph);
	}

	beginScaleChange(nextGraph: MultigraphData, focalNodeId: string): MultigraphData {
		this.scaleChangeFocalNodeId = focalNodeId;
		const currentGraph = this.#options.getGraph();
		const currentVisibleGraph = this.#visibleGraphFor(currentGraph);
		const nextVisibleGraph = this.#visibleGraphFor(nextGraph);
		this.scaleChangeRevealState = this.#createScaleChangeRevealState(currentGraph, nextGraph);
		const fromLayout = deriveGraphLayout(
			currentVisibleGraph,
			this.layoutOptions(currentVisibleGraph, { relaxIterations: 0 })
		);
		const targetLayout = deriveGraphLayout(
			nextVisibleGraph,
			this.layoutOptions(nextVisibleGraph, { relaxIterations: 0 })
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

	layoutOptions(
		layoutGraph: MultigraphData,
		overrides: {
			activeDragNodeId?: string | null;
			relaxIterations?: number;
			scaleByNodeId?: Record<string, number>;
			scaleAnchoredNodeIds?: readonly string[];
			participatingNodeIds?: ReadonlySet<string>;
			mobilityByNodeId?: Record<string, number>;
		} = {}
	): GraphLayoutOptions {
		const nodeIds = layoutGraph.nodes.map((node) => node.id);
		const relayoutParticipating =
			overrides.participatingNodeIds ?? participatingNodeIds(nodeIds, this.layeredRelayoutState);

		return {
			settings: this.#options.getLayoutSettings(),
			activeDragNodeId: overrides.activeDragNodeId ?? this.#options.getActiveDragNodeId(),
			scaleAnchoredNodeIds: overrides.scaleAnchoredNodeIds ?? this.scaleAnchoredNodeIds,
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
			const currentVisibleGraph = this.#visibleGraphFor(currentGraph);
			const step = relaxGraphPositionsStep(
				currentVisibleGraph,
				this.layoutOptions(currentVisibleGraph, {
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

	#visibleGraphFor(graph: MultigraphData): MultigraphData {
		const visibleNodeIds = visibleNodeIdsForPinnedNeighborhood(graph, hopsFromPinned(graph), {
			displayedLayers: this.#resolvedSettings().displayedLayers,
			fallbackAnchorNodeId: this.#options.getFallbackAnchorNodeId()
		});
		return graphWithVisibleNodes(graph, visibleNodeIds);
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
		nextGraph: MultigraphData
	): ScaleChangeRevealState {
		const settings = this.#resolvedSettings();
		const fallbackAnchorNodeId = this.#options.getFallbackAnchorNodeId();
		const previousHopsByNodeId = hopsFromPinned(currentGraph);
		const nextHopsByNodeId = hopsFromPinned(nextGraph);
		const previousVisibleNodeIds = Array.from(
			visibleNodeIdsForPinnedNeighborhood(currentGraph, previousHopsByNodeId, {
				displayedLayers: settings.displayedLayers,
				fallbackAnchorNodeId
			})
		);
		const nextVisibleNodeIds = Array.from(
			visibleNodeIdsForPinnedNeighborhood(nextGraph, nextHopsByNodeId, {
				displayedLayers: settings.displayedLayers,
				fallbackAnchorNodeId
			})
		);
		const previousRenderableEdges = edgeVisibilityForPinnedNeighborhood(
			currentGraph,
			previousHopsByNodeId,
			{
				displayedLayers: settings.displayedLayers,
				fallbackAnchorNodeId
			}
		).filter((visibility): visibility is RenderableEdgeVisibility => visibility.kind !== 'hidden');
		const nextRenderableEdges = edgeVisibilityForPinnedNeighborhood(nextGraph, nextHopsByNodeId, {
			displayedLayers: settings.displayedLayers,
			fallbackAnchorNodeId
		}).filter((visibility): visibility is RenderableEdgeVisibility => visibility.kind !== 'hidden');
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
}

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
