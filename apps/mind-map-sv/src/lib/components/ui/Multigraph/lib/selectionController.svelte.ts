/**
 * The nodes the reader has marked on the canvas.
 *
 * Session state, never document state: nothing here reaches `graph`, the saved
 * file or an undo entry, so selecting is not an edit and undo cannot bring a
 * selection back. The one rule tying it to the graph is `prune` — an id that no
 * longer names a node is dropped the moment the graph changes, so a deletion, an
 * undo or a restore never leaves the canvas claiming a selection it cannot draw.
 *
 * Reactive through a `SvelteSet`: a `has` on a present id watches that entry,
 * while one on an absent id watches the whole set, so every unselected node
 * re-checks on any add or delete. Cheap — one lookup each — and the canvas
 * passes each node's flag down rather than reading the set in every child.
 */

import { SvelteSet } from 'svelte/reactivity';
import type { MultigraphData } from '../../types/multigraph';

/**
 * A throwaway lookup that nothing renders, so a plain `Set`. Kept out of the
 * exported class, where the reactivity lint asks for a `SvelteSet` of every
 * set built inside it, needed or not.
 */
function nodeIdsOf(graph: Pick<MultigraphData, 'nodes'>): ReadonlySet<string> {
	return new Set(graph.nodes.map((node) => node.id));
}

export class SelectionController {
	readonly #ids = new SvelteSet<string>();

	get size(): number {
		return this.#ids.size;
	}

	/** A snapshot in the order the ids were selected; changing it changes nothing. */
	get ids(): readonly string[] {
		return [...this.#ids];
	}

	has(id: string): boolean {
		return this.#ids.has(id);
	}

	/** What a box with no modifier does: the selection becomes exactly `ids`. */
	replace(ids: Iterable<string>): void {
		this.#ids.clear();
		for (const id of ids) this.#ids.add(id);
	}

	/** What a box with Shift held does: `ids` join whatever was already selected. */
	add(ids: Iterable<string>): void {
		for (const id of ids) this.#ids.add(id);
	}

	toggle(id: string): void {
		if (this.#ids.has(id)) {
			this.#ids.delete(id);
			return;
		}
		this.#ids.add(id);
	}

	clear(): void {
		this.#ids.clear();
	}

	/**
	 * Drop every id that names no node in `graph`. Free when nothing is selected,
	 * since it runs on every graph change.
	 */
	prune(graph: Pick<MultigraphData, 'nodes'>): void {
		if (this.#ids.size === 0) return;
		const liveIds = nodeIdsOf(graph);
		// Over a copy: deleting from the set being iterated would be safe for a
		// native Set, but the copy says so without relying on it.
		for (const id of [...this.#ids]) {
			if (!liveIds.has(id)) this.#ids.delete(id);
		}
	}
}
