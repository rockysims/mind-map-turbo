import { describe, expect, it } from 'vitest';
import {
	advanceLayeredRelayout,
	initialLayeredRelayoutState,
	participatingNodeIds,
	relayoutStateKey,
	shouldClearLayeredRelayoutState
} from './layeredRelayout';

const SETTLE_MAX_FRAMES = 8;
const SETTLE_INPUT = {
	maxPositionDelta: 0,
	settleEpsilonPx: 0.25
} as const;

describe('layeredRelayout', () => {
	it('starts one visible-set settle pass', () => {
		const state = initialLayeredRelayoutState(new Set(['n0']), SETTLE_MAX_FRAMES);

		expect(state).toEqual({
			active: true,
			settleFramesRemaining: SETTLE_MAX_FRAMES,
			pinnedNodeIds: new Set(['n0'])
		});
		expect(relayoutStateKey(state)).toBe('visible-set');
	});

	it('participates every rendered node during the settle pass', () => {
		const state = initialLayeredRelayoutState(new Set(['n0']), SETTLE_MAX_FRAMES);

		expect(participatingNodeIds(['n0', 'n1', 'n2'], state)).toEqual(new Set(['n0', 'n1', 'n2']));
		expect(participatingNodeIds(['n0'], null)).toBeUndefined();
	});

	it('finishes the settle pass once movement is below epsilon', () => {
		const state = advanceLayeredRelayout(
			initialLayeredRelayoutState(new Set(['n0']), SETTLE_MAX_FRAMES),
			SETTLE_INPUT
		);

		expect(state.active).toBe(false);
		expect(state.settleFramesRemaining).toBe(0);
		expect(shouldClearLayeredRelayoutState(state)).toBe(true);
	});

	it('counts down while visible positions are still moving', () => {
		const state = advanceLayeredRelayout(initialLayeredRelayoutState(new Set(), 2), {
			maxPositionDelta: 10,
			settleEpsilonPx: 0.25
		});

		expect(state.active).toBe(true);
		expect(state.settleFramesRemaining).toBe(1);
	});
});
