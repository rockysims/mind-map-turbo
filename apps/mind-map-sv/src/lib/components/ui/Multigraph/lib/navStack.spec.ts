import { describe, expect, it } from 'vitest';
import {
	NAV_STACK_LIMIT,
	prunedNavStack,
	pushNavStackEntry,
	revealedNodeIdsOf,
	type NavStackEntry
} from './navStack';

function entry(
	originNodeId: string,
	revealedNodeId: string | null = null,
	scale = 1,
	originFocused = true
): NavStackEntry {
	return {
		originNodeId,
		viewState: { panX: 10, panY: -20, scale },
		revealedNodeId,
		originFocused
	};
}

describe('pushNavStackEntry', () => {
	it('appends without touching the input array', () => {
		const entries = [entry('a')];
		const next = pushNavStackEntry(entries, entry('b'));

		expect(entries).toHaveLength(1);
		expect(next.map((item) => item.originNodeId)).toEqual(['a', 'b']);
	});

	it('drops the oldest entry once the cap is exceeded', () => {
		let entries: NavStackEntry[] = [];
		for (let index = 0; index < NAV_STACK_LIMIT + 3; index += 1) {
			entries = pushNavStackEntry(entries, entry(`n${index}`));
		}

		expect(entries).toHaveLength(NAV_STACK_LIMIT);
		expect(entries[0].originNodeId).toBe('n3');
		expect(entries[entries.length - 1].originNodeId).toBe(`n${NAV_STACK_LIMIT + 2}`);
	});

	it('honors a caller-supplied cap', () => {
		const entries = pushNavStackEntry([entry('a'), entry('b')], entry('c'), 2);

		expect(entries.map((item) => item.originNodeId)).toEqual(['b', 'c']);
	});

	it('carries where the reader was reading, so back can put them back there', () => {
		const entries = pushNavStackEntry([], entry('a', null, 1, false));

		expect(entries[0].originFocused).toBe(false);
	});
});

describe('prunedNavStack', () => {
	it('drops entries whose origin is gone', () => {
		const entries = [entry('a', 'x'), entry('b', 'y')];

		expect(prunedNavStack(entries, new Set(['b', 'x', 'y']))).toEqual([entry('b', 'y')]);
	});

	it('drops entries whose revealed node is gone', () => {
		const entries = [entry('a', 'x'), entry('b', null)];

		expect(prunedNavStack(entries, new Set(['a', 'b']))).toEqual([entry('b', null)]);
	});

	it('returns the same array when nothing is missing, so the reveal memo survives', () => {
		const entries = [entry('a', 'x')];

		expect(prunedNavStack(entries, new Set(['a', 'x']))).toBe(entries);
	});
});

describe('revealedNodeIdsOf', () => {
	it('collects only entries that created a seed', () => {
		const revealed = revealedNodeIdsOf([entry('a', 'x'), entry('b', null), entry('c', 'y')]);

		expect([...revealed].sort()).toEqual(['x', 'y']);
	});

	it('collapses repeats so a node revealed twice is held once', () => {
		expect(revealedNodeIdsOf([entry('a', 'x'), entry('b', 'x')]).size).toBe(1);
	});

	it('shares one empty set so the hop map allocates nothing per frame', () => {
		expect(revealedNodeIdsOf([])).toBe(revealedNodeIdsOf([entry('a', null)]));
	});
});
