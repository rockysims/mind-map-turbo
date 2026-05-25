import { describe, expect, it } from 'vitest';
import { settleStateAfterScaleAnimationsEnd, settleStateForScaleChange } from './scaleChangeSettle';

describe('scaleChangeSettle', () => {
	it('defers settle frames until scale animations finish', () => {
		expect(settleStateForScaleChange(true, 12)).toEqual({
			pendingPostScaleSettle: true,
			settleFramesRemaining: 0
		});
	});

	it('starts settle immediately when there is no scale animation', () => {
		expect(settleStateForScaleChange(false, 12)).toEqual({
			pendingPostScaleSettle: false,
			settleFramesRemaining: 12
		});
	});

	it('arms post-scale settle once animations complete', () => {
		expect(settleStateAfterScaleAnimationsEnd(true, 12)).toEqual({
			pendingPostScaleSettle: false,
			settleFramesRemaining: 12
		});
		expect(settleStateAfterScaleAnimationsEnd(false, 12)).toBeNull();
	});
});
