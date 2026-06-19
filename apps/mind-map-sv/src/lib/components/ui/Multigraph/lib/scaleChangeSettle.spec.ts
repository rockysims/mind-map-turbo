import { describe, expect, it } from 'vitest';
import {
	scaleChangeLayoutAnchoredNodeIds,
	settleStateAfterScaleAnimationsEnd,
	settleStateForScaleChange,
	shouldClearScaleChangeFocalNode
} from './scaleChangeSettle';

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

	it('anchors only the focal node through scale animation and post-scale settle', () => {
		const settling = {
			pendingPostScaleSettle: false,
			settleFramesRemaining: 4,
			hasActiveScaleAnimations: false
		};

		expect(
			scaleChangeLayoutAnchoredNodeIds('n0', {
				pendingPostScaleSettle: true,
				settleFramesRemaining: 0,
				hasActiveScaleAnimations: true
			})
		).toEqual(['n0']);
		expect(scaleChangeLayoutAnchoredNodeIds('n0', settling)).toEqual(['n0']);
		expect(
			scaleChangeLayoutAnchoredNodeIds('n0', { ...settling, settleFramesRemaining: 0 })
		).toEqual([]);
		expect(scaleChangeLayoutAnchoredNodeIds(null, settling)).toEqual([]);
	});

	it('clears the focal node once scale change layout is fully settled', () => {
		const done = {
			pendingPostScaleSettle: false,
			settleFramesRemaining: 0,
			hasActiveScaleAnimations: false
		};

		expect(shouldClearScaleChangeFocalNode('n0', done)).toBe(true);
		expect(shouldClearScaleChangeFocalNode('n0', { ...done, settleFramesRemaining: 2 })).toBe(
			false
		);
		expect(shouldClearScaleChangeFocalNode(null, done)).toBe(false);
	});
});
