/**
 * The back-stack behind "go read that node", as pure data.
 *
 * A jump must not pin: pinning is how a reader says "this belongs in my
 * neighborhood", and passing through to check a definition is not that. So a
 * jump records where the reader was and — when the target was out of view —
 * which node it had to surface to get them there. None of this reaches
 * `MultigraphData`: nothing here is saved, and popping an entry takes the
 * surfaced node back out exactly the way it came in.
 *
 * `revealedNodeIdsOf` feeds the hop map (unioned into the beacon set), so it is
 * read on every layout frame — hence the shared empty set for the common case
 * where no jump is in flight.
 */

import type { ViewState } from '../../../../migrations';

export interface NavStackEntry {
	/** The node the reader jumped *from* — what "Back" is named after. */
	originNodeId: string;
	/** Exact pan/scale at the moment of the jump, restored verbatim on back. */
	viewState: ViewState;
	/**
	 * The node this jump had to surface, or null when the target was already on
	 * screen. Only a jump that created a seed removes one when it pops.
	 */
	revealedNodeId: string | null;
	/**
	 * Whether the reader was reading the origin's details when they left. Back
	 * returns them to what they were doing, and today every jump starts from the
	 * focus view — but recorded rather than assumed, so a jump launched from the
	 * canvas would come back to the canvas instead of opening an overlay the
	 * reader never had.
	 */
	originFocused: boolean;
}

/**
 * Depth beyond which the oldest entry is dropped. A back-stack is a convenience
 * for retracing a few hops, not a session history; an unbounded one would keep
 * stale view states (and stale seeds) alive for a whole session.
 */
export const NAV_STACK_LIMIT = 8;

/** Shared so a stack with nothing to reveal allocates nothing per frame. */
export const NO_REVEALED_NODE_IDS: ReadonlySet<string> = new Set<string>();

/** Pushes with the oldest entries dropped once the cap is exceeded. */
export function pushNavStackEntry(
	entries: readonly NavStackEntry[],
	entry: NavStackEntry,
	limit: number = NAV_STACK_LIMIT
): NavStackEntry[] {
	const next = [...entries, entry];
	return next.length > limit ? next.slice(next.length - limit) : next;
}

/**
 * Drops entries that can no longer be honored: a back whose origin is gone has
 * nowhere to return to, and a seed for a deleted node would hold a hop open for
 * an id the graph does not have. Returns the input array untouched when nothing
 * is dropped, so the revealed-set memo survives an unrelated deletion.
 */
export function prunedNavStack(
	entries: readonly NavStackEntry[],
	liveNodeIds: ReadonlySet<string>
): readonly NavStackEntry[] {
	const kept = entries.filter(
		(entry) =>
			liveNodeIds.has(entry.originNodeId) &&
			(entry.revealedNodeId === null || liveNodeIds.has(entry.revealedNodeId))
	);
	return kept.length === entries.length ? entries : kept;
}

/** The nodes the stack is holding on screen; empty is the shared constant. */
export function revealedNodeIdsOf(entries: readonly NavStackEntry[]): ReadonlySet<string> {
	const revealed = new Set<string>();
	for (const entry of entries) {
		if (entry.revealedNodeId !== null) revealed.add(entry.revealedNodeId);
	}
	return revealed.size === 0 ? NO_REVEALED_NODE_IDS : revealed;
}
