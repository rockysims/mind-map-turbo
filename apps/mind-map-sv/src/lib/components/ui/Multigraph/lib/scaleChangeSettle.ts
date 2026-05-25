export type ScaleChangeSettleState = {
	pendingPostScaleSettle: boolean;
	settleFramesRemaining: number;
};

export function settleStateForScaleChange(
	hasScaleAnimations: boolean,
	postScaleChangeSettleMaxFrames: number
): ScaleChangeSettleState {
	if (hasScaleAnimations) {
		return { pendingPostScaleSettle: true, settleFramesRemaining: 0 };
	}

	return {
		pendingPostScaleSettle: false,
		settleFramesRemaining: postScaleChangeSettleMaxFrames
	};
}

export function settleStateAfterScaleAnimationsEnd(
	pendingPostScaleSettle: boolean,
	postScaleChangeSettleMaxFrames: number
): ScaleChangeSettleState | null {
	if (!pendingPostScaleSettle) return null;

	return {
		pendingPostScaleSettle: false,
		settleFramesRemaining: postScaleChangeSettleMaxFrames
	};
}
