export type LayeredRelayoutMode = 'hop-batches' | 'bulk-unpin';

export interface LayeredRelayoutState {
	active: boolean;
	mode: LayeredRelayoutMode;
	batchIndex: number;
	batchMaxes: readonly number[];
	unreachableBatchActive: boolean;
	hasUnreachableBatch: boolean;
	settleFramesRemaining: number;
	pinnedNodeIds: ReadonlySet<string>;
	restoreOpacity: boolean;
}

export function fibonacciHopBatchMaxes(maxFiniteHop: number): number[] {
	if (maxFiniteHop <= 0) return [];

	const maxes: number[] = [];
	let cumulative = 0;
	let fibA = 1;
	let fibB = 1;

	while (cumulative < maxFiniteHop) {
		const increment = fibA;
		cumulative = Math.min(cumulative + increment, maxFiniteHop);
		maxes.push(cumulative);
		[fibA, fibB] = [fibB, fibA + fibB];
	}

	return maxes;
}

export function maxFiniteHop(hopsByNodeId: Record<string, number>): number {
	return Object.values(hopsByNodeId).reduce((maxHop, hopCount) => {
		if (!Number.isFinite(hopCount)) return maxHop;
		return Math.max(maxHop, hopCount);
	}, 0);
}

export function hasUnreachableNodes(hopsByNodeId: Record<string, number>): boolean {
	return Object.values(hopsByNodeId).some((hopCount) => !Number.isFinite(hopCount));
}

export function shouldUseLayeredRelayout(hasPinnedNodes: boolean): boolean {
	return hasPinnedNodes;
}

export function initialLayeredRelayoutState(
	hopsByNodeId: Record<string, number>,
	pinnedNodeIds: ReadonlySet<string>,
	settleMaxFrames: number
): LayeredRelayoutState {
	return {
		active: true,
		mode: 'hop-batches',
		batchIndex: 0,
		batchMaxes: fibonacciHopBatchMaxes(maxFiniteHop(hopsByNodeId)),
		unreachableBatchActive: false,
		hasUnreachableBatch: hasUnreachableNodes(hopsByNodeId),
		settleFramesRemaining: settleMaxFrames,
		pinnedNodeIds,
		restoreOpacity: false
	};
}

export function bulkUnpinRelayoutState(settleMaxFrames: number): LayeredRelayoutState {
	return {
		active: true,
		mode: 'bulk-unpin',
		batchIndex: 0,
		batchMaxes: [],
		unreachableBatchActive: false,
		hasUnreachableBatch: false,
		settleFramesRemaining: settleMaxFrames,
		pinnedNodeIds: new Set(),
		restoreOpacity: false
	};
}

export function activeMaxHopForRelayout(state: LayeredRelayoutState): number {
	if (state.mode === 'bulk-unpin' || state.unreachableBatchActive) return Infinity;
	return state.batchMaxes[state.batchIndex] ?? 0;
}

export function relayoutBatchKey(state: LayeredRelayoutState | null): string | null {
	if (!state?.active) return null;
	if (state.mode === 'bulk-unpin') {
		return state.restoreOpacity ? 'bulk-restore' : 'bulk-dim';
	}
	if (state.unreachableBatchActive) return 'unreachable';
	return `batch-${state.batchIndex}`;
}

export function participatingNodeIds(
	hopsByNodeId: Record<string, number>,
	nodeIds: readonly string[],
	state: LayeredRelayoutState | null
): Set<string> | undefined {
	if (!state?.active) return undefined;

	if (state.mode === 'bulk-unpin' || state.unreachableBatchActive) {
		return new Set(nodeIds);
	}

	const activeMaxHop = activeMaxHopForRelayout(state);

	return new Set(
		nodeIds.filter((nodeId) => {
			if (state.pinnedNodeIds.has(nodeId)) return true;
			const hopCount = hopsByNodeId[nodeId];
			return Number.isFinite(hopCount) && hopCount <= activeMaxHop;
		})
	);
}

export function targetLayoutOpacityByNodeId(
	nodeIds: readonly string[],
	hopsByNodeId: Record<string, number>,
	pinnedNodeIds: ReadonlySet<string>,
	state: LayeredRelayoutState | null,
	dimOpacity: number
): Record<string, number> {
	if (!state?.active) {
		return Object.fromEntries(nodeIds.map((nodeId) => [nodeId, 1]));
	}

	if (state.mode === 'bulk-unpin') {
		const opacity = state.restoreOpacity ? 1 : dimOpacity;
		return Object.fromEntries(nodeIds.map((nodeId) => [nodeId, opacity]));
	}

	const activeMaxHop = activeMaxHopForRelayout(state);

	return Object.fromEntries(
		nodeIds.map((nodeId) => {
			if (pinnedNodeIds.has(nodeId)) return [nodeId, 1];
			if (state.unreachableBatchActive) return [nodeId, 1];

			const hopCount = hopsByNodeId[nodeId];
			if (Number.isFinite(hopCount) && hopCount <= activeMaxHop) return [nodeId, 1];
			return [nodeId, dimOpacity];
		})
	);
}

export interface LayeredRelayoutAdvanceInput {
	maxPositionDelta: number;
	settleEpsilonPx: number;
	settleMaxFrames: number;
}

export function advanceLayeredRelayout(
	state: LayeredRelayoutState,
	input: LayeredRelayoutAdvanceInput
): LayeredRelayoutState {
	if (!state.active || state.settleFramesRemaining <= 0) return state;

	const nextSettleFrames =
		input.maxPositionDelta <= input.settleEpsilonPx ? 0 : state.settleFramesRemaining - 1;

	if (nextSettleFrames > 0) {
		return { ...state, settleFramesRemaining: nextSettleFrames };
	}

	return advanceAfterBatchSettle(state, input.settleMaxFrames);
}

function advanceAfterBatchSettle(
	state: LayeredRelayoutState,
	settleMaxFrames: number
): LayeredRelayoutState {
	if (state.mode === 'bulk-unpin') {
		return { ...state, restoreOpacity: true, settleFramesRemaining: 0, active: true };
	}

	const nextBatchIndex = state.batchIndex + 1;

	if (nextBatchIndex >= state.batchMaxes.length) {
		if (state.hasUnreachableBatch && !state.unreachableBatchActive) {
			return {
				...state,
				unreachableBatchActive: true,
				settleFramesRemaining: settleMaxFrames
			};
		}

		return { ...state, active: false, settleFramesRemaining: 0 };
	}

	return {
		...state,
		batchIndex: nextBatchIndex,
		settleFramesRemaining: settleMaxFrames
	};
}

export function shouldClearLayeredRelayoutState(
	state: LayeredRelayoutState | null,
	hasActiveOpacityAnimations: boolean
): boolean {
	if (state === null) return false;
	if (hasActiveOpacityAnimations) return false;
	if (!state.active) return true;
	if (state.mode === 'bulk-unpin' && state.restoreOpacity) return true;
	return false;
}
