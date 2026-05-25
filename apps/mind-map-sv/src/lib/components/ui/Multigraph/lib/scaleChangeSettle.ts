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

/** Keep only the toggled node fixed while pin/unpin scale and post-scale settle run. */
export function scaleChangeLayoutAnchoredNodeIds(
	focalNodeId: string | null,
	options: {
		pendingPostScaleSettle: boolean;
		settleFramesRemaining: number;
		hasActiveScaleAnimations: boolean;
	}
): readonly string[] {
	if (focalNodeId === null) return [];
	if (
		options.hasActiveScaleAnimations ||
		options.pendingPostScaleSettle ||
		options.settleFramesRemaining > 0
	) {
		return [focalNodeId];
	}
	return [];
}

export function shouldClearScaleChangeFocalNode(
	focalNodeId: string | null,
	options: {
		pendingPostScaleSettle: boolean;
		settleFramesRemaining: number;
		hasActiveScaleAnimations: boolean;
	}
): boolean {
	return (
		focalNodeId !== null &&
		!options.pendingPostScaleSettle &&
		options.settleFramesRemaining === 0 &&
		!options.hasActiveScaleAnimations
	);
}
