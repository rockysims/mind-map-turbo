export interface LayeredRelayoutState {
	active: boolean;
	settleFramesRemaining: number;
	pinnedNodeIds: ReadonlySet<string>;
}

export function initialLayeredRelayoutState(
	pinnedNodeIds: ReadonlySet<string>,
	settleMaxFrames: number
): LayeredRelayoutState {
	return {
		active: true,
		settleFramesRemaining: settleMaxFrames,
		pinnedNodeIds
	};
}

export function relayoutStateKey(state: LayeredRelayoutState | null): string | null {
	if (!state?.active) return null;
	return 'visible-set';
}

export function participatingNodeIds(
	nodeIds: readonly string[],
	state: LayeredRelayoutState | null
): Set<string> | undefined {
	if (!state?.active) return undefined;
	return new Set(nodeIds);
}

export interface LayeredRelayoutAdvanceInput {
	maxPositionDelta: number;
	settleEpsilonPx: number;
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

	return { ...state, active: false, settleFramesRemaining: 0 };
}

export function shouldClearLayeredRelayoutState(state: LayeredRelayoutState | null): boolean {
	if (state === null) return false;
	return !state.active;
}
