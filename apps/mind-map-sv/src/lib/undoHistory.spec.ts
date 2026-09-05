import { describe, expect, it } from 'vitest';
import {
	allEntries,
	canRedo,
	canUndo,
	clear,
	createUndoHistory,
	currentEntry,
	push,
	redo,
	redoTarget,
	replaceTop,
	undo,
	undoEntries,
	undoTarget,
	type HistoryEviction,
	type UndoHistory
} from './undoHistory';

/** Entries are opaque to the stack, so a spec entry only needs a name and a weight. */
type Entry = { name: string; weight?: number };

const entry = (name: string, weight = 1): Entry => ({ name, weight });

const eviction = (ceiling = Number.POSITIVE_INFINITY): HistoryEviction<Entry> => ({
	costOf: (candidate) => candidate.weight ?? 1,
	ceiling
});

const names = (history: UndoHistory<Entry>): string[] =>
	history.entries.map((candidate) => candidate.name);

describe('undoHistory', () => {
	it('seeds with the loaded state, which the first edit undoes back to', () => {
		const seeded = createUndoHistory(entry('loaded'));

		expect(currentEntry(seeded).name).toBe('loaded');
		expect(canUndo(seeded)).toBe(false);
		expect(canRedo(seeded)).toBe(false);
	});

	it('pushes, undoes and redoes back to where it started', () => {
		const pushed = push(createUndoHistory(entry('loaded')), entry('edited'), eviction());

		expect(pushed.dropped).toEqual([]);
		expect(canUndo(pushed.history)).toBe(true);
		expect(undoTarget(pushed.history)?.name).toBe('loaded');

		const undone = undo(pushed.history);
		expect(currentEntry(undone).name).toBe('loaded');
		expect(canRedo(undone)).toBe(true);
		expect(redoTarget(undone)?.name).toBe('edited');

		expect(currentEntry(redo(undone)).name).toBe('edited');
	});

	it('discards the redo tail on a new push, and reports what it discarded', () => {
		const first = push(createUndoHistory(entry('loaded')), entry('a'), eviction());
		const second = push(first.history, entry('b'), eviction());
		const rewound = undo(undo(second.history));

		const replaced = push(rewound, entry('c'), eviction());

		expect(names(replaced.history)).toEqual(['loaded', 'c']);
		expect(replaced.dropped.map((candidate) => candidate.name)).toEqual(['a', 'b']);
		expect(canRedo(replaced.history)).toBe(false);
	});

	it('replaces the top without growing the stack or touching the redo side', () => {
		const pushed = push(createUndoHistory(entry('loaded')), entry('scrub-1'), eviction());

		const coalesced = replaceTop(pushed.history, entry('scrub-2'), eviction());

		expect(names(coalesced.history)).toEqual(['loaded', 'scrub-2']);
		expect(coalesced.history.pointer).toBe(1);
		// The run's before-state is still the entry the first push landed on.
		expect(undoTarget(coalesced.history)?.name).toBe('loaded');
		expect(coalesced.dropped.map((candidate) => candidate.name)).toEqual(['scrub-1']);
	});

	it('leaves entries ahead of the pointer alone when replacing', () => {
		const first = push(createUndoHistory(entry('loaded')), entry('a'), eviction());
		const second = push(first.history, entry('b'), eviction());
		const rewound = undo(second.history);

		const coalesced = replaceTop(rewound, entry('a-again'), eviction());

		expect(names(coalesced.history)).toEqual(['loaded', 'a-again', 'b']);
		expect(canRedo(coalesced.history)).toBe(true);
	});

	it('evicts oldest-first on the cost ceiling, not an entry count', () => {
		const heavy = eviction(10);
		const first = push(createUndoHistory(entry('loaded', 4)), entry('a', 4), heavy);
		expect(first.dropped).toEqual([]);

		const second = push(first.history, entry('b', 4), heavy);

		expect(names(second.history)).toEqual(['a', 'b']);
		expect(second.dropped.map((candidate) => candidate.name)).toEqual(['loaded']);
		expect(second.history.pointer).toBe(1);
	});

	it('counts entries, not their number, when deciding what fits', () => {
		const budget = eviction(10);
		let history = createUndoHistory(entry('loaded', 1));
		for (const name of ['a', 'b', 'c', 'd', 'e']) {
			history = push(history, entry(name, 1), budget).history;
		}

		// Six one-unit entries fit under a ten-unit ceiling; a count cap would not.
		expect(names(history)).toEqual(['loaded', 'a', 'b', 'c', 'd', 'e']);
	});

	it('never evicts the state the document is in', () => {
		const tiny = eviction(1);
		const first = push(createUndoHistory(entry('loaded', 5)), entry('a', 5), tiny);

		expect(names(first.history)).toEqual(['a']);
		expect(currentEntry(first.history).name).toBe('a');
		expect(canUndo(first.history)).toBe(false);
	});

	it('treats undo at the bottom and redo at the top as no-ops', () => {
		const seeded = createUndoHistory(entry('loaded'));

		expect(undo(seeded)).toBe(seeded);
		expect(redo(seeded)).toBe(seeded);
	});

	it('orders undoEntries newest-first and excludes the redo side', () => {
		const first = push(createUndoHistory(entry('loaded')), entry('a'), eviction());
		const second = push(first.history, entry('b'), eviction());
		const rewound = undo(second.history);

		expect(undoEntries(rewound).map((candidate) => candidate.name)).toEqual(['a', 'loaded']);
		expect(allEntries(rewound).map((candidate) => candidate.name)).toEqual(['loaded', 'a', 'b']);
	});

	it('clears back to a fresh seed and reports everything it held', () => {
		const first = push(createUndoHistory(entry('loaded')), entry('a'), eviction());

		const cleared = clear(first.history, entry('other-document'));

		expect(names(cleared.history)).toEqual(['other-document']);
		expect(canUndo(cleared.history)).toBe(false);
		expect(cleared.dropped.map((candidate) => candidate.name)).toEqual(['loaded', 'a']);
	});
});
