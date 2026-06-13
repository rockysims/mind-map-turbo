import type { MultigraphData } from '../../types/multigraph';
import {
	graphWithVisibleNodes,
	pinnedNodeIds,
	visibleNodeIdsForPinnedNeighborhood
} from './boundedVisibility';
import {
	deriveGraphLayout,
	relaxGraphPositionsStep,
	withRelaxedGraphPositions,
	type GraphLayoutOptions
} from './graphLayout';
import { hopsFromPinned } from './layout';
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
}

export class LayoutRuntime {
	scaleAnimations = $state<Record<string, NodeScaleAnimation>>({});
	animationNowMs = $state(0);
	settleFramesRemaining = $state(0);
	pendingPostScaleSettle = $state(false);
	scaleChangeFocalNodeId = $state<string | null>(null);
	layeredRelayoutState = $state<LayeredRelayoutState | null>(null);
	lastRelayoutStateKey = $state<string | null>(null);

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
		const currentVisibleGraph = this.#visibleGraphFor(this.#options.getGraph());
		const nextVisibleGraph = this.#visibleGraphFor(nextGraph);
		const fromLayout = deriveGraphLayout(
			currentVisibleGraph,
			this.layoutOptions(currentVisibleGraph, { relaxIterations: 0 })
		);
		const targetLayout = deriveGraphLayout(
			nextVisibleGraph,
			this.layoutOptions(nextVisibleGraph, { relaxIterations: 0 })
		);
		const nowMs = this.#scheduler.now();
		const nextAnimations =
			this.#resolvedSettings().scaleAnimationDurationMs > 0
				? createScaleAnimations(
						fromLayout.scaleByNodeId,
						targetLayout.scaleByNodeId,
						nowMs,
						this.#resolvedSettings().scaleAnimationDurationMs
					)
				: {};

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
		}

		if (shouldClearLayeredRelayoutState(this.layeredRelayoutState)) {
			this.layeredRelayoutState = null;
			this.lastRelayoutStateKey = null;
		}

		if (
			this.#options.getActiveDragNodeId() !== null ||
			this.settleFramesRemaining > 0 ||
			hasActiveScaleAnimations(this.scaleAnimations, nowMs) ||
			this.layeredRelayoutState?.active
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

	#resolvedSettings(): LayoutSettings {
		return withDefaultLayoutSettings(this.#options.getLayoutSettings());
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
