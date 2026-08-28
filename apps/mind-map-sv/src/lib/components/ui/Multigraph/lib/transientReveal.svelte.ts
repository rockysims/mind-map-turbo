/**
 * Session state for transient reveals: the nav stack a jump pushes onto, and
 * the set of nodes it is currently holding on screen.
 *
 * The rules live in `navStack.ts`; this is the reactive shell around them. The
 * one thing it adds is the identity guarantee on `revealedNodeIds`: the hop map
 * reads it on every layout frame, so an unchanged stack must hand back the same
 * set object rather than an equal one.
 */

import {
	NO_REVEALED_NODE_IDS,
	prunedNavStack,
	pushNavStackEntry,
	revealedNodeIdsOf,
	unwindNavStackTo,
	type NavStackEntry
} from './navStack';

export type { NavStackEntry } from './navStack';

export class TransientRevealController {
	#entries = $state<readonly NavStackEntry[]>([]);
	/**
	 * Memo keyed on the entries array's identity. Plain fields on purpose: this
	 * is filled during a read that happens inside the layout's derived chain, and
	 * a reactive cache would make that read a write.
	 */
	#revealedFor: readonly NavStackEntry[] | null = null;
	#revealed: ReadonlySet<string> = NO_REVEALED_NODE_IDS;

	get entries(): readonly NavStackEntry[] {
		return this.#entries;
	}

	get depth(): number {
		return this.#entries.length;
	}

	/** Where "Back" would go next, without popping. */
	get top(): NavStackEntry | undefined {
		return this.#entries[this.#entries.length - 1];
	}

	get revealedNodeIds(): ReadonlySet<string> {
		const entries = this.#entries;
		if (this.#revealedFor !== entries) {
			this.#revealedFor = entries;
			this.#revealed = revealedNodeIdsOf(entries);
		}
		return this.#revealed;
	}

	push(entry: NavStackEntry): void {
		this.#entries = pushNavStackEntry(this.#entries, entry);
	}

	/**
	 * Unwind to one entry, returning where the reader should land. Out of range
	 * leaves the stack alone and returns undefined.
	 */
	unwindTo(index: number): NavStackEntry | undefined {
		const unwound = unwindNavStackTo(this.#entries, index);
		if (unwound === null) return undefined;
		this.#entries = unwound.entries;
		return unwound.target;
	}

	/** Back is unwinding to the newest entry — one path, so they cannot diverge. */
	pop(): NavStackEntry | undefined {
		return this.unwindTo(this.#entries.length - 1);
	}

	clear(): void {
		if (this.#entries.length === 0) return;
		this.#entries = [];
	}

	pruneMissing(liveNodeIds: ReadonlySet<string>): void {
		this.#entries = prunedNavStack(this.#entries, liveNodeIds);
	}
}
