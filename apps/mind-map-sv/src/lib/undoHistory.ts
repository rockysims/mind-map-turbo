/**
 * The undo/redo stack, as a pure structure over an opaque entry type.
 *
 * An entry is a *state*, not a transition: the stack is a list of states with a
 * pointer at the one the document is currently in. Undo moves the pointer back
 * and hands the caller the state it landed on; redo moves it forward. Recording
 * whole states rather than operations is what lets the caller restore without
 * keeping inverse bookkeeping — see the plan's "alternatives considered".
 *
 * Nothing here knows what a graph is. Eviction is driven by a `costOf` callback
 * and a ceiling supplied by the caller, so the ceiling can be stated in whatever
 * unit actually predicts memory (for graphs: retained node + edge pointers).
 *
 * Every operation that loses entries reports them in `dropped`, because the only
 * thing that can tell an asset it is finally unreachable is an entry leaving the
 * stack. Over-reporting there is safe and under-reporting is not, so a replaced
 * entry counts as dropped too: the caller re-derives what is still referenced
 * from the surviving entries, and uses `dropped` only as the signal to look.
 */

/** A stack of states with a pointer at the current one. Never empty. */
export type UndoHistory<TEntry> = {
	readonly entries: readonly TEntry[];
	/** Index of the state the document is in right now. */
	readonly pointer: number;
};

/** The stack after an operation, plus whatever left it for good. */
export type HistoryChange<TEntry> = {
	readonly history: UndoHistory<TEntry>;
	readonly dropped: readonly TEntry[];
};

/**
 * How much an entry retains and how much the stack may retain in total.
 *
 * A ceiling rather than a depth cap: what threatens a tab is bytes, and two
 * sessions at the same depth over graphs of different sizes are nothing like
 * each other. Eviction takes from the oldest end and never touches the current
 * state or the redo side — it shortens how far back you can go, never where you
 * are or where you were.
 */
export type HistoryEviction<TEntry> = {
	costOf: (entry: TEntry) => number;
	ceiling: number;
};

/** A stack holding just the loaded state, which the first edit's undo returns to. */
export function createUndoHistory<TEntry>(seed: TEntry): UndoHistory<TEntry> {
	return { entries: [seed], pointer: 0 };
}

export function canUndo<TEntry>(history: UndoHistory<TEntry>): boolean {
	return history.pointer > 0;
}

export function canRedo<TEntry>(history: UndoHistory<TEntry>): boolean {
	return history.pointer < history.entries.length - 1;
}

/** The state the document is in. Always defined: the stack is seeded and never emptied. */
export function currentEntry<TEntry>(history: UndoHistory<TEntry>): TEntry {
	return history.entries[history.pointer];
}

/** The entry an undo would land on, or `null` at the bottom. */
export function undoTarget<TEntry>(history: UndoHistory<TEntry>): TEntry | null {
	return canUndo(history) ? history.entries[history.pointer - 1] : null;
}

/** The entry a redo would land on, or `null` at the top. */
export function redoTarget<TEntry>(history: UndoHistory<TEntry>): TEntry | null {
	return canRedo(history) ? history.entries[history.pointer + 1] : null;
}

/**
 * The undo side, newest first: the current state, then everything behind it.
 *
 * This is what the persisted tail serializes. The redo side is deliberately
 * absent — a tail is a chain of deltas walking backwards from the graph the
 * draft holds, and no chain of backwards deltas can reach a state in front of
 * it.
 */
export function undoEntries<TEntry>(history: UndoHistory<TEntry>): TEntry[] {
	return history.entries.slice(0, history.pointer + 1).reverse();
}

/** Every entry the stack still holds, both sides of the pointer. */
export function allEntries<TEntry>(history: UndoHistory<TEntry>): TEntry[] {
	return [...history.entries];
}

/**
 * Record a new state. Anything ahead of the pointer is discarded — editing after
 * an undo is what makes a redo unreachable — and reported, since a blob named
 * only by a discarded redo entry has just become collectable.
 */
export function push<TEntry>(
	history: UndoHistory<TEntry>,
	entry: TEntry,
	eviction: HistoryEviction<TEntry>
): HistoryChange<TEntry> {
	const kept = history.entries.slice(0, history.pointer + 1);
	const truncated = history.entries.slice(history.pointer + 1);
	return evict({ entries: [...kept, entry], pointer: kept.length }, eviction, truncated);
}

/**
 * Swap the current state for a newer one, keeping the entry behind it.
 *
 * The coalescing primitive: a run of commits sharing an intent — a colour swatch
 * scrubbing through `oninput` — pushes once and then replaces, so the run's
 * before-state stays where the first push put it and the run lands as one entry
 * whose after-state is wherever the finger stopped.
 *
 * The redo side is left alone. A run only ever continues a push that already
 * truncated it, so in practice there is nothing there; saying so explicitly is
 * what keeps a future caller from discovering otherwise.
 */
export function replaceTop<TEntry>(
	history: UndoHistory<TEntry>,
	entry: TEntry,
	eviction: HistoryEviction<TEntry>
): HistoryChange<TEntry> {
	const entries = [...history.entries];
	const replaced = entries[history.pointer];
	entries[history.pointer] = entry;
	return evict({ entries, pointer: history.pointer }, eviction, [replaced]);
}

/** Step back one state. A no-op at the bottom, so a held key cannot fall off the end. */
export function undo<TEntry>(history: UndoHistory<TEntry>): UndoHistory<TEntry> {
	if (!canUndo(history)) return history;
	return { entries: history.entries, pointer: history.pointer - 1 };
}

/** Step forward one state. A no-op at the top. */
export function redo<TEntry>(history: UndoHistory<TEntry>): UndoHistory<TEntry> {
	if (!canRedo(history)) return history;
	return { entries: history.entries, pointer: history.pointer + 1 };
}

/**
 * Start over from `seed` — a different document arrived, so nothing recorded
 * about the last one means anything. Everything the stack held is reported
 * dropped, including the state that was current: the caller's keep-set is built
 * from the live graph and the surviving entries, so naming the seed's own assets
 * here would be wrong only if `dropped` were the authority, and it is not.
 */
export function clear<TEntry>(history: UndoHistory<TEntry>, seed: TEntry): HistoryChange<TEntry> {
	return { history: createUndoHistory(seed), dropped: [...history.entries] };
}

/**
 * Drop oldest entries until the stack fits under the ceiling.
 *
 * Stops at the pointer whatever the ceiling says. A ceiling low enough to evict
 * the present would leave the caller holding a stack that does not describe the
 * document, which is worse than briefly exceeding a number the caller chose.
 */
function evict<TEntry>(
	history: UndoHistory<TEntry>,
	eviction: HistoryEviction<TEntry>,
	alreadyDropped: readonly TEntry[]
): HistoryChange<TEntry> {
	let entries = history.entries;
	let pointer = history.pointer;
	let total = entries.reduce((sum, entry) => sum + eviction.costOf(entry), 0);
	const evicted: TEntry[] = [];

	while (pointer > 0 && total > eviction.ceiling) {
		const [oldest, ...rest] = entries;
		evicted.push(oldest);
		total -= eviction.costOf(oldest);
		entries = rest;
		pointer -= 1;
	}

	return { history: { entries, pointer }, dropped: [...alreadyDropped, ...evicted] };
}
