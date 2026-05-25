import { describe, expect, it } from 'vitest';
import { togglePinned } from './graph';
import { hopsFromPinned } from './layout';
import { makeGraph } from './testFixtures';
import {
	advanceLayeredRelayout,
	bulkUnpinRelayoutState,
	fibonacciHopBatchMaxes,
	initialLayeredRelayoutState,
	maxFiniteHop,
	participatingNodeIds,
	relayoutBatchKey,
	shouldClearLayeredRelayoutState,
	shouldUseLayeredRelayout,
	targetLayoutOpacityByNodeId
} from './layeredRelayout';

function chainEdges(count: number): Array<[number, number]> {
	return Array.from({ length: count - 1 }, (_, index) => [index, index + 1]);
}

const SETTLE_INPUT = {
	maxPositionDelta: 0,
	settleEpsilonPx: 0.25,
	settleMaxFrames: 24
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
			const state = initialLayeredRelayoutState(hops, pinned, 24);

			expect(participatingNodeIds(hops, nodeIds, state)).toEqual(new Set(['n0', 'n1']));
		});

		it('expands participation as batches advance', () => {
			let state = initialLayeredRelayoutState(hops, pinned, 24);
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
			const state = initialLayeredRelayoutState(hops, pinned, 24);

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

	describe('advanceLayeredRelayout', () => {
		it('advances through fibonacci batches and finishes with unreachable nodes', () => {
			const hops = { n0: 0, n1: 1, n2: Infinity };
			const pinned = new Set(['n0']);
			let state = initialLayeredRelayoutState(hops, pinned, 24);

			expect(relayoutBatchKey(state)).toBe('batch-0');
			state = advanceLayeredRelayout(state, SETTLE_INPUT);
			expect(relayoutBatchKey(state)).toBe('unreachable');
			state = advanceLayeredRelayout(state, SETTLE_INPUT);
			expect(state.active).toBe(false);
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
			const state = initialLayeredRelayoutState(hops, pinned, 90);

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
				...initialLayeredRelayoutState({ n0: 0, n1: 1 }, new Set(['n0']), 24),
				active: false
			};

			expect(shouldClearLayeredRelayoutState(finished, false)).toBe(true);
			expect(shouldClearLayeredRelayoutState(finished, true)).toBe(false);
		});
	});
});
