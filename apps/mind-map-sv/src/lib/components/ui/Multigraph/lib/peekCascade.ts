/**
 * Which branches of a peek cascade are open, as pure data.
 *
 * A peek answers "what is this quantity?" with the definers' equations, and the
 * next question is almost always "and what is *that* symbol?". Drilling one of a
 * definer's own inputs opens another card under that row, and the same question
 * can be asked again from there — so what is open is a tree, not a stack.
 *
 * A tree rather than an accordion because the reader is comparing: two definers
 * of the same quantity are exactly what the card exists to show, and collapsing
 * one to look at the other would take away the comparison. Closing a branch
 * therefore drops that branch and its descendants and nothing else.
 *
 * There is deliberately no prune: the renderer walks the definers' *live* inputs
 * and asks `isBranchOpen` about each, so a branch whose chip has vanished from
 * the graph simply stops being rendered, and reappears where the reader left it
 * if the designation comes back. Nothing here has to watch the graph.
 */

/** One drill: the row it was taken from, and the quantity its chip named. */
export interface PeekStep {
	definerNodeId: string;
	key: string;
}

/** A card's address inside the cascade — empty is the root card. */
export type PeekPath = readonly PeekStep[];

/** An open nested card, plus whatever is open beneath it. */
export interface PeekBranch extends PeekStep {
	children: PeekBranch[];
}

/** Every card open under one root quantity. */
export interface PeekCascade {
	/** The quantity the root card answers — the chip the reader tapped. */
	rootKey: string;
	children: PeekBranch[];
}

/** A cascade showing one quantity and nothing drilled yet. */
export function openCascade(rootKey: string): PeekCascade {
	return { rootKey, children: [] };
}

function indexOfStep(branches: readonly PeekBranch[], step: PeekStep): number {
	return branches.findIndex(
		(branch) => branch.definerNodeId === step.definerNodeId && branch.key === step.key
	);
}

/**
 * Whether the card at this path is open. The empty path is the root card, which
 * exists for as long as the cascade does.
 */
export function isBranchOpen(cascade: PeekCascade, path: PeekPath): boolean {
	let branches = cascade.children;
	for (const step of path) {
		const found = branches[indexOfStep(branches, step)];
		if (found === undefined) return false;
		branches = found.children;
	}
	return true;
}

/**
 * Rebuild `branches` with the last step of `path` opened or closed.
 *
 * A path whose parent is not open returns the input untouched: the chip that
 * would have been toggled is not on screen, so the click that reports it is
 * stale and moving something else would be worse than doing nothing.
 */
function toggleIn(branches: PeekBranch[], path: PeekPath): PeekBranch[] {
	const [step, ...rest] = path;
	const index = indexOfStep(branches, step);

	if (rest.length === 0) {
		// Closing drops the subtree with it. The reader closed the question these
		// answers hang off, so keeping them would leave orphans on screen.
		if (index === -1) return [...branches, { ...step, children: [] }];
		return [...branches.slice(0, index), ...branches.slice(index + 1)];
	}

	if (index === -1) return branches;
	const parent = branches[index];
	return [
		...branches.slice(0, index),
		{ ...parent, children: toggleIn(parent.children, rest) },
		...branches.slice(index + 1)
	];
}

/** Open the card at this path if it is closed, close it (and its subtree) if not. */
export function toggleBranch(cascade: PeekCascade, path: PeekPath): PeekCascade {
	// The root card is closed by closing the cascade, not by toggling a branch.
	if (path.length === 0) return cascade;
	return { ...cascade, children: toggleIn(cascade.children, path) };
}

function closeIn(branches: PeekBranch[], path: PeekPath): PeekBranch[] {
	const [step, ...rest] = path;
	const index = indexOfStep(branches, step);
	if (index === -1) return branches;

	if (rest.length === 0) {
		return [...branches.slice(0, index), ...branches.slice(index + 1)];
	}
	const parent = branches[index];
	const children = closeIn(parent.children, rest);
	if (children === parent.children) return branches;
	return [...branches.slice(0, index), { ...parent, children }, ...branches.slice(index + 1)];
}

/** Close the card at this path and everything under it. Already-closed is a no-op. */
export function closeBranch(cascade: PeekCascade, path: PeekPath): PeekCascade {
	if (path.length === 0) return cascade;
	const children = closeIn(cascade.children, path);
	if (children === cascade.children) return cascade;
	return { ...cascade, children };
}

/**
 * Whether drilling `key` from the card at `path` would re-ask a question already
 * open above it.
 *
 * Per-path on purpose. Two different definers of one quantity both consuming `m`
 * is ordinary — the reader wants to see both — so a repeat only counts as a loop
 * when it lies on the chip's *own* ancestry, where following it would produce
 * the same card forever.
 */
export function isLoop(cascade: PeekCascade, path: PeekPath, key: string): boolean {
	return key === cascade.rootKey || path.some((step) => step.key === key);
}

/**
 * Separators for the serialized form. Both are percent-encoded out of the
 * segments they join, so neither can occur inside one.
 */
const STEP_SEPARATOR = '/';
const FIELD_SEPARATOR = ':';

/**
 * A path as one DOM-attribute-safe string, which is how a card is addressed from
 * a story selector and from the Escape handler.
 *
 * Every segment is percent-encoded because quantity keys embed a NUL between
 * base and subscript (`mathSymbols.KEY_SEPARATOR`) and node ids are not
 * constrained at all — either would be illegal raw in the attribute selectors
 * that find a card, and `CSS.escape` mangles a NUL into U+FFFD rather than
 * escaping it. The root card's path is the empty string.
 */
export function serializePath(path: PeekPath): string {
	return path
		.map(
			(step) =>
				`${encodeURIComponent(step.definerNodeId)}${FIELD_SEPARATOR}${encodeURIComponent(step.key)}`
		)
		.join(STEP_SEPARATOR);
}

/** Inverse of `serializePath`. An empty string is the root path. */
export function parsePath(serialized: string): PeekStep[] {
	if (serialized === '') return [];
	return serialized.split(STEP_SEPARATOR).map((segment) => {
		const separator = segment.indexOf(FIELD_SEPARATOR);
		// A segment with no separator cannot have come from `serializePath`; read it
		// as a row with no quantity rather than silently dropping its last character.
		if (separator === -1) return { definerNodeId: decodeURIComponent(segment), key: '' };
		return {
			definerNodeId: decodeURIComponent(segment.slice(0, separator)),
			key: decodeURIComponent(segment.slice(separator + 1))
		};
	});
}
