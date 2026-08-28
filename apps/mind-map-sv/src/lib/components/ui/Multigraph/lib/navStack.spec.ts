import { describe, expect, it } from 'vitest';
import {
	NAV_BREADCRUMB_MAX,
	NAV_STACK_LIMIT,
	navBreadcrumbs,
	prunedNavStack,
	pushNavStackEntry,
	revealedNodeIdsOf,
	unwindNavStackTo,
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

describe('unwindNavStackTo', () => {
	it('drops the target and everything after it, and names where to go', () => {
		const entries = [entry('a', 'x'), entry('b', 'y'), entry('c', 'z')];
		const unwound = unwindNavStackTo(entries, 0);

		expect(unwound?.target.originNodeId).toBe('a');
		expect(unwound?.entries).toEqual([]);
		expect(entries).toHaveLength(3);
	});

	it('keeps exactly the entries whose seeds hold the target on screen', () => {
		const entries = [entry('a', 'x'), entry('b', 'y'), entry('c', 'z')];
		const unwound = unwindNavStackTo(entries, 1);

		// Unwinding to `b` means landing where `b` was read, which the first jump's
		// seed is what put on screen. Its own seed and every later one go.
		expect(unwound?.entries.map((item) => item.originNodeId)).toEqual(['a']);
		expect([...revealedNodeIdsOf(unwound?.entries ?? [])]).toEqual(['x']);
	});

	it('unwinding to the last entry is exactly a pop', () => {
		const entries = [entry('a'), entry('b'), entry('c')];
		const unwound = unwindNavStackTo(entries, entries.length - 1);

		expect(unwound?.target.originNodeId).toBe('c');
		expect(unwound?.entries.map((item) => item.originNodeId)).toEqual(['a', 'b']);
	});

	it('reports out of range rather than clamping to a neighbour', () => {
		const entries = [entry('a'), entry('b')];

		// A stale crumb click must do nothing; unwinding to some other entry would
		// move the reader somewhere they did not point at.
		expect(unwindNavStackTo(entries, 2)).toBeNull();
		expect(unwindNavStackTo(entries, -1)).toBeNull();
		expect(unwindNavStackTo([], 0)).toBeNull();
	});

	it('unwinds a stack that pruning shortened, without renumbering it', () => {
		const pruned = prunedNavStack(
			[entry('a', 'x'), entry('gone', 'y'), entry('c', 'z')],
			new Set(['a', 'x', 'c', 'z'])
		);

		// The middle entry's node was deleted, so the trail the reader sees is
		// already the pruned one and index 1 is `c`.
		expect(unwindNavStackTo(pruned, 1)?.target.originNodeId).toBe('c');
	});
});

describe('navBreadcrumbs', () => {
	it('is just the current node when nothing has been jumped from', () => {
		expect(navBreadcrumbs([], 'here')).toEqual([{ kind: 'current', nodeId: 'here' }]);
	});

	it('is empty when nothing is focused, so there is no trail to render', () => {
		expect(navBreadcrumbs([], null)).toEqual([]);
	});

	it('reads origin then current for a single jump', () => {
		expect(navBreadcrumbs([entry('a')], 'b')).toEqual([
			{ kind: 'entry', index: 0, nodeId: 'a' },
			{ kind: 'current', nodeId: 'b' }
		]);
	});

	it('shows every crumb at exactly the cap', () => {
		const entries = [entry('a'), entry('b'), entry('c')];

		expect(navBreadcrumbs(entries, 'd', 4)).toHaveLength(NAV_BREADCRUMB_MAX);
		expect(navBreadcrumbs(entries, 'd', 4).map((crumb) => crumb.kind)).toEqual([
			'entry',
			'entry',
			'entry',
			'current'
		]);
	});

	it('collapses the middle one crumb over the cap, keeping the head and the tail', () => {
		const entries = [entry('a'), entry('b'), entry('c'), entry('d')];

		expect(navBreadcrumbs(entries, 'e', 4)).toEqual([
			{ kind: 'entry', index: 0, nodeId: 'a' },
			{ kind: 'ellipsis', hiddenCount: 1 },
			{ kind: 'entry', index: 2, nodeId: 'c' },
			{ kind: 'entry', index: 3, nodeId: 'd' },
			{ kind: 'current', nodeId: 'e' }
		]);
	});

	it('numbers a tail crumb by its place in the stack, not in the rendered trail', () => {
		const entries = [entry('a'), entry('b'), entry('c'), entry('d'), entry('e')];
		const crumbs = navBreadcrumbs(entries, 'f', 3);

		// Renumbering here would send a click on the last visible crumb to whichever
		// entry happens to sit at that position in the truncated array.
		expect(crumbs).toEqual([
			{ kind: 'entry', index: 0, nodeId: 'a' },
			{ kind: 'ellipsis', hiddenCount: 3 },
			{ kind: 'entry', index: 4, nodeId: 'e' },
			{ kind: 'current', nodeId: 'f' }
		]);
	});

	it('honors a caller-supplied cap', () => {
		const entries = [entry('a'), entry('b'), entry('c')];

		expect(navBreadcrumbs(entries, 'd', 2)).toEqual([
			{ kind: 'entry', index: 0, nodeId: 'a' },
			{ kind: 'ellipsis', hiddenCount: 2 },
			{ kind: 'current', nodeId: 'd' }
		]);
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
