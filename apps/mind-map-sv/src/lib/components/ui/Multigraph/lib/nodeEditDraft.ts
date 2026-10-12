import type { NodeData, QuantityDesignation } from '../../types/node';

/**
 * What the edit sheet's Save hands the canvas: the drafted fields, already
 * normalized the way the save stores them.
 */
export type NodeEditDraft = {
	title: string;
	description: string;
	tags: string[];
	inputs: QuantityDesignation[];
	outputs: QuantityDesignation[];
	/** A number sets it, `null` removes it, absent leaves it alone (see `weightFromDraft`). */
	weight?: number | null;
};

/**
 * True when saving `draft` would change something on `node`.
 *
 * Clicking away from the sheet saves, so a reader who opened it only to look
 * and then tapped the canvas would otherwise commit an edit nobody made — an
 * undo entry for nothing, and a layout relax with it. The click-away asks this
 * first and simply closes when the answer is no.
 *
 * Compares what the save would store, not what the fields show: the title is
 * the normalized one, so a cleared title on a node already holding the
 * fallback is no change, and a weight the field could not read (absent from
 * the draft) leaves the stored weight alone, which is no change either.
 */
export function draftChangesNode(node: NodeData, draft: NodeEditDraft): boolean {
	return (
		draft.title !== node.title ||
		draft.description !== node.description ||
		!sameList(draft.tags, node.tags, (a, b) => a === b) ||
		!sameList(draft.inputs, node.inputs ?? [], sameDesignation) ||
		!sameList(draft.outputs, node.outputs ?? [], sameDesignation) ||
		weightChanges(draft.weight, node.weight)
	);
}

function weightChanges(draft: number | null | undefined, stored: number | undefined): boolean {
	if (draft === undefined) return false;
	if (draft === null) return stored !== undefined;
	return draft !== stored;
}

function sameDesignation(a: QuantityDesignation, b: QuantityDesignation): boolean {
	return a.base === b.base && a.subscript === b.subscript;
}

/** Order counts: the sheet keeps the reader's order, so a reorder is an edit. */
function sameList<T>(a: readonly T[], b: readonly T[], same: (x: T, y: T) => boolean): boolean {
	return a.length === b.length && a.every((item, index) => same(item, b[index]));
}
