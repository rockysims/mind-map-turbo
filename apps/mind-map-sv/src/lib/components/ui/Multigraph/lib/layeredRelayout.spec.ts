import { describe, expect, it } from 'vitest';
import {
	advanceLayeredRelayout,
	initialLayeredRelayoutState,
	participatingNodeIds,
	relayoutMobilityByNodeId,
	relayoutStateKey,
	shouldClearLayeredRelayoutState
} from './layeredRelayout';

const SETTLE_MAX_FRAMES = 8;
const SETTLE_INPUT = {
	maxPositionDelta: 0,
	settleEpsilonPx: 0.25
} as const;
const MOBILITY_SETTINGS = {
	layeredRelayoutMobilityStep: 0.2,
	layeredRelayoutMobilityFloor: 0.05
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

	it('keeps pinned nodes immobile while visible neighbors settle together', () => {
		const state = initialLayeredRelayoutState(new Set(['n0']), SETTLE_MAX_FRAMES);

		expect(
			relayoutMobilityByNodeId(['n0', 'n1', 'n2'], new Set(['n0']), state, MOBILITY_SETTINGS)
		).toEqual({
			n0: 0,
			n1: 1,
			n2: 1
		});
		expect(
			relayoutMobilityByNodeId(['n0'], new Set(['n0']), null, MOBILITY_SETTINGS)
		).toBeUndefined();
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
