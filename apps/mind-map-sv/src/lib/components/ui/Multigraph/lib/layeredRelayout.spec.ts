import { describe, expect, it } from 'vitest';
import { togglePinned } from './graph';
import { hopsFromPinned } from './layout';
import { makeGraph } from './testFixtures';
import {
	advanceLayeredRelayout,
	bulkUnpinRelayoutState,
	fibonacciHopBatchMaxes,
	ghostNodeIds,
	initialLayeredRelayoutSettleMaxFrames,
	initialLayeredRelayoutState,
	maxFiniteHop,
	mobilityBumpsForHop,
	participatingNodeIds,
	relayoutBatchKey,
	relayoutMobilityByNodeId,
	settleMaxFramesForNextBatch,
	shouldClearLayeredRelayoutState,
	shouldUseLayeredRelayout,
	targetLayoutOpacityByNodeId
} from './layeredRelayout';

function chainEdges(count: number): Array<[number, number]> {
	return Array.from({ length: count - 1 }, (_, index) => [index, index + 1]);
}

const SETTLE_MAX_FRAMES = 8;
const SETTLE_MAX_FRAMES_FINAL = 48;

const SETTLE_INPUT = {
	maxPositionDelta: 0,
	settleEpsilonPx: 0.25,
	settleMaxFrames: SETTLE_MAX_FRAMES,
	settleMaxFramesFinal: SETTLE_MAX_FRAMES_FINAL
} as const;

function initialState(hops: Record<string, number>, pinned: ReadonlySet<string>) {
	return initialLayeredRelayoutState(hops, pinned, SETTLE_MAX_FRAMES, SETTLE_MAX_FRAMES_FINAL);
}

const MOBILITY_SETTINGS = {
	layeredRelayoutMobilityStep: 0.2,
	layeredRelayoutMobilityFloor: 0.05
} as const;

describe('layeredRelayout', () => {
	describe('fibonacciHopBatchMaxes', () => {
		it('returns cumulative fibonacci hop maxes', () => {
			expect(fibonacciHopBatchMaxes(1)).toEqual([1]);
			expect(fibonacciHopBatchMaxes(4)).toEqual([1, 2, 4]);
			expect(fibonacciHopBatchMaxes(20)).toEqual([1, 2, 4, 7, 12, 20]);
		});

		it('caps batches for large hop depths without one batch per hop', () => {
			expect(fibonacciHopBatchMaxes(100)).toEqual([1, 2, 4, 7, 12, 20, 33, 54, 88, 100]);
		});

		it('returns an empty schedule when nothing is reachable', () => {
			expect(fibonacciHopBatchMaxes(0)).toEqual([]);
		});
	});

	describe('maxFiniteHop', () => {
		it('ignores unreachable nodes', () => {
			expect(maxFiniteHop({ n0: 0, n1: 3, n2: Infinity })).toBe(3);
		});
	});

	describe('shouldUseLayeredRelayout', () => {
		it('runs hop batches only when pinned nodes remain', () => {
			expect(shouldUseLayeredRelayout(true)).toBe(true);
			expect(shouldUseLayeredRelayout(false)).toBe(false);
		});
	});

	describe('participatingNodeIds', () => {
		const hops = { n0: 0, n1: 1, n2: 2, n3: 4, n4: Infinity };
		const nodeIds = ['n0', 'n1', 'n2', 'n3', 'n4'];
		const pinned = new Set(['n0']);

		it('includes pinned nodes and nodes within the active hop batch', () => {
			const state = initialState(hops, pinned);

			expect(participatingNodeIds(hops, nodeIds, state)).toEqual(new Set(['n0', 'n1']));
		});

		it('expands participation as batches advance', () => {
			let state = initialState(hops, pinned);
			state = advanceLayeredRelayout(state, SETTLE_INPUT);

			expect(participatingNodeIds(hops, nodeIds, state)).toEqual(new Set(['n0', 'n1', 'n2']));
		});

		it('includes every node during bulk unpin', () => {
			expect(participatingNodeIds(hops, nodeIds, bulkUnpinRelayoutState(24))).toEqual(
				new Set(nodeIds)
			);
		});
	});

	describe('targetLayoutOpacityByNodeId', () => {
		const hops = { n0: 0, n1: 1, n2: 4, n3: Infinity };
		const nodeIds = ['n0', 'n1', 'n2', 'n3'];
		const pinned = new Set(['n0']);

		it('keeps pinned nodes at full opacity during relayout', () => {
			const state = initialState(hops, pinned);

			expect(targetLayoutOpacityByNodeId(nodeIds, hops, pinned, state, 0.5)).toEqual({
				n0: 1,
				n1: 1,
				n2: 0.5,
				n3: 0.5
			});
		});

		it('dims every node during bulk unpin before restore', () => {
			expect(
				targetLayoutOpacityByNodeId(nodeIds, hops, new Set(), bulkUnpinRelayoutState(24), 0.5)
			).toEqual({
				n0: 0.5,
				n1: 0.5,
				n2: 0.5,
				n3: 0.5
			});
		});

		it('restores full opacity after bulk unpin settle', () => {
			const state = { ...bulkUnpinRelayoutState(24), restoreOpacity: true };

			expect(targetLayoutOpacityByNodeId(nodeIds, hops, new Set(), state, 0.5)).toEqual({
				n0: 1,
				n1: 1,
				n2: 1,
				n3: 1
			});
		});
	});

	describe('ghostNodeIds', () => {
		const hops = { n0: 0, n1: 1, n2: 2, n3: 4, n4: Infinity };
		const nodeIds = ['n0', 'n1', 'n2', 'n3', 'n4'];
		const pinned = new Set(['n0']);

		it('returns unrevealed nodes during hop batches', () => {
			const state = initialState(hops, pinned);

			expect(ghostNodeIds(hops, nodeIds, state)).toEqual(new Set(['n2', 'n3', 'n4']));
		});

		it('returns undefined outside layered relayout', () => {
			expect(ghostNodeIds(hops, nodeIds, null)).toBeUndefined();
		});

		it('returns undefined during bulk unpin and unreachable batches', () => {
			expect(ghostNodeIds(hops, nodeIds, bulkUnpinRelayoutState(24))).toBeUndefined();
			expect(
				ghostNodeIds(hops, nodeIds, {
					...initialState(hops, pinned),
					unreachableBatchActive: true
				})
			).toBeUndefined();
		});
	});

	describe('mobilityBumpsForHop', () => {
		const batchMaxes = [1, 2, 4];

		it('counts completed batches where the node was revealed', () => {
			expect(mobilityBumpsForHop(1, batchMaxes, 0)).toBe(0);
			expect(mobilityBumpsForHop(1, batchMaxes, 1)).toBe(1);
			expect(mobilityBumpsForHop(1, batchMaxes, 2)).toBe(2);
			expect(mobilityBumpsForHop(2, batchMaxes, 2)).toBe(1);
			expect(mobilityBumpsForHop(4, batchMaxes, 2)).toBe(0);
		});

		it('uses settled batch count for unreachable nodes', () => {
			expect(mobilityBumpsForHop(Infinity, batchMaxes, 3)).toBe(3);
		});
	});

	describe('relayoutMobilityByNodeId', () => {
		const hops = { n0: 0, n1: 1, n2: 2, n3: 4 };
		const nodeIds = ['n0', 'n1', 'n2', 'n3'];
		const pinned = new Set(['n0']);

		it('returns undefined outside layered relayout', () => {
			expect(
				relayoutMobilityByNodeId(nodeIds, hops, pinned, null, MOBILITY_SETTINGS)
			).toBeUndefined();
		});

		it('returns undefined during bulk unpin', () => {
			expect(
				relayoutMobilityByNodeId(
					nodeIds,
					hops,
					new Set(),
					bulkUnpinRelayoutState(24),
					MOBILITY_SETTINGS
				)
			).toBeUndefined();
		});

		it('reduces mobility for earlier hops as batches settle', () => {
			let state = initialState(hops, pinned);
			expect(relayoutMobilityByNodeId(nodeIds, hops, pinned, state, MOBILITY_SETTINGS)).toEqual({
				n0: 0,
				n1: 1,
				n2: 1,
				n3: 1
			});

			state = advanceLayeredRelayout(state, SETTLE_INPUT);
			expect(relayoutMobilityByNodeId(nodeIds, hops, pinned, state, MOBILITY_SETTINGS)).toEqual({
				n0: 0,
				n1: 0.8,
				n2: 1,
				n3: 1
			});

			state = advanceLayeredRelayout(state, SETTLE_INPUT);
			expect(relayoutMobilityByNodeId(nodeIds, hops, pinned, state, MOBILITY_SETTINGS)).toEqual({
				n0: 0,
				n1: 0.6,
				n2: 0.8,
				n3: 1
			});
		});

		it('clamps mobility at the configured floor', () => {
			const state = {
				...initialLayeredRelayoutState(
					{ n0: 0, n1: 1 },
					pinned,
					SETTLE_MAX_FRAMES,
					SETTLE_MAX_FRAMES_FINAL
				),
				batchMaxes: [1, 2, 3, 4, 5],
				settledBatchCount: 5
			};
			const mobility = relayoutMobilityByNodeId(
				['n0', 'n1'],
				{ n0: 0, n1: 1 },
				pinned,
				state,
				MOBILITY_SETTINGS
			);

			expect(mobility?.n1).toBe(0.05);
		});
	});

	describe('layered relayout settle frames', () => {
		it('uses final settle frames for a single finite batch', () => {
			expect(initialLayeredRelayoutSettleMaxFrames([1], false, 8, 48)).toBe(48);
		});

		it('uses regular settle frames when more batches follow', () => {
			expect(initialLayeredRelayoutSettleMaxFrames([1, 2], false, 8, 48)).toBe(8);
			expect(initialLayeredRelayoutSettleMaxFrames([1], true, 8, 48)).toBe(8);
		});

		it('uses final settle frames when entering the last finite batch', () => {
			expect(settleMaxFramesForNextBatch([1, 2, 4], false, 2, false, 8, 48)).toBe(48);
			expect(settleMaxFramesForNextBatch([1, 2, 4], true, 2, false, 8, 48)).toBe(8);
		});

		it('uses final settle frames when entering the unreachable batch', () => {
			expect(settleMaxFramesForNextBatch([1], true, 1, true, 8, 48)).toBe(48);
		});

		it('applies final settle budget when advancing to the last layer', () => {
			const hops = { n0: 0, n1: 1, n2: 2, n3: 3 };
			const pinned = new Set(['n0']);
			let state = initialState(hops, pinned);

			expect(state.settleFramesRemaining).toBe(SETTLE_MAX_FRAMES);
			state = advanceLayeredRelayout(state, SETTLE_INPUT);
			expect(state.batchIndex).toBe(1);
			expect(state.settleFramesRemaining).toBe(SETTLE_MAX_FRAMES);
			state = advanceLayeredRelayout(state, SETTLE_INPUT);
			expect(relayoutBatchKey(state)).toBe('batch-2');
			expect(state.settleFramesRemaining).toBe(SETTLE_MAX_FRAMES_FINAL);
		});

		it('applies final settle budget when only one finite batch exists', () => {
			const state = initialState({ n0: 0, n1: 1 }, new Set(['n0']));

			expect(state.settleFramesRemaining).toBe(SETTLE_MAX_FRAMES_FINAL);
		});
	});

	describe('advanceLayeredRelayout', () => {
		it('advances through fibonacci batches and finishes with unreachable nodes', () => {
			const hops = { n0: 0, n1: 1, n2: Infinity };
			const pinned = new Set(['n0']);
			let state = initialState(hops, pinned);

			expect(relayoutBatchKey(state)).toBe('batch-0');
			expect(state.settledBatchCount).toBe(0);
			state = advanceLayeredRelayout(state, SETTLE_INPUT);
			expect(relayoutBatchKey(state)).toBe('unreachable');
			expect(state.settledBatchCount).toBe(1);
			expect(state.settleFramesRemaining).toBe(SETTLE_MAX_FRAMES_FINAL);
			state = advanceLayeredRelayout(state, SETTLE_INPUT);
			expect(state.active).toBe(false);
			expect(state.settledBatchCount).toBe(2);
		});

		it('uses bulk unpin mode without hop batches', () => {
			let state = bulkUnpinRelayoutState(24);

			expect(relayoutBatchKey(state)).toBe('bulk-dim');
			state = advanceLayeredRelayout(state, SETTLE_INPUT);
			expect(relayoutBatchKey(state)).toBe('bulk-restore');
			expect(participatingNodeIds({}, ['n0', 'n1'], state)).toEqual(new Set(['n0', 'n1']));
		});
	});

	describe('pin chain graph', () => {
		it('dims distant nodes on the first fibonacci batch after pin', () => {
			const graph = togglePinned(
				makeGraph({
					nodeCount: 5,
					edges: chainEdges(5)
				}),
				'n0'
			);
			const hops = hopsFromPinned(graph);
			const pinned = new Set(['n0']);
			const state = initialLayeredRelayoutState(hops, pinned, 90, 90);

			expect(maxFiniteHop(hops)).toBe(4);
			expect(fibonacciHopBatchMaxes(4)).toEqual([1, 2, 4]);
			expect(
				targetLayoutOpacityByNodeId(['n0', 'n1', 'n2', 'n3', 'n4'], hops, pinned, state, 0.5)
			).toEqual({
				n0: 1,
				n1: 1,
				n2: 0.5,
				n3: 0.5,
				n4: 0.5
			});
		});
	});

	describe('shouldClearLayeredRelayoutState', () => {
		it('clears after relayout and opacity animations finish', () => {
			const finished = {
				...initialLayeredRelayoutState(
					{ n0: 0, n1: 1 },
					new Set(['n0']),
					SETTLE_MAX_FRAMES,
					SETTLE_MAX_FRAMES_FINAL
				),
				active: false
			};

			expect(shouldClearLayeredRelayoutState(finished, false)).toBe(true);
			expect(shouldClearLayeredRelayoutState(finished, true)).toBe(false);
		});
	});
});
