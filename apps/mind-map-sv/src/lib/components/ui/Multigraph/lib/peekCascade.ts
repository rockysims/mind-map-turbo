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

/**
 * Which way a cascade reads the graph.
 *
 * A card answers the question its chip's column implies: an input asks who
 * defines this, an output asks who consumes it. The direction belongs to the
 * whole cascade rather than to a row, because a tree that flips halfway leaves a
 * reader three levels down unable to say what they are looking at.
 */
export type PeekDirection = 'upstream' | 'downstream';

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
	/**
	 * Identity and open order in one number. A quantity key cannot serve: keys
	 * embed a NUL, which `CSS.escape` replaces with U+FFFD rather than escaping,
	 * so a key is unusable in the selector that has to find this cascade's cards.
	 * Increasing with each open is also what lets dismissal find the newest
	 * without a second timestamp.
	 */
	id: number;
	/** The quantity the root card answers — the chip the reader tapped. */
	rootKey: string;
	direction: PeekDirection;
	children: PeekBranch[];
}

/** A cascade showing one quantity and nothing drilled yet. */
export function openCascade(id: number, rootKey: string, direction: PeekDirection): PeekCascade {
	return { id, rootKey, direction, children: [] };
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

/**
 * Every cascade a reader has open, in the order they opened them.
 *
 * Open order is what dismissal needs — a press outside closes the newest — and
 * chip order is what rendering needs, so cards sit under the chips they came
 * from. Only one of the two is stored: deriving the other is what stops them
 * disagreeing after a designation moves a chip between columns.
 */
export type PeekCascades = readonly PeekCascade[];

/** Whether this quantity already has a card open in this direction. */
export function findCascade(
	cascades: PeekCascades,
	rootKey: string,
	direction: PeekDirection
): PeekCascade | undefined {
	return cascades.find((cascade) => cascade.rootKey === rootKey && cascade.direction === direction);
}

/**
 * Add a card for this quantity, or leave the set alone if it already has one.
 *
 * Idempotent per `(key, direction)` rather than per key: a quantity confirmed as
 * both an input and an output is two chips asking two different questions, and
 * collapsing them to one card would make the second chip close the first.
 */
export function openCascadeIn(
	cascades: PeekCascades,
	nextId: number,
	rootKey: string,
	direction: PeekDirection
): PeekCascades {
	if (findCascade(cascades, rootKey, direction) !== undefined) return cascades;
	return [...cascades, openCascade(nextId, rootKey, direction)];
}

/** Drop one cascade by id. An id that is not open is a no-op. */
export function closeCascadeIn(cascades: PeekCascades, id: number): PeekCascades {
	const index = cascades.findIndex((cascade) => cascade.id === id);
	if (index === -1) return cascades;
	return [...cascades.slice(0, index), ...cascades.slice(index + 1)];
}

/**
 * Drop the most recently opened cascade — what a press outside the section does.
 *
 * Newest first so the reader unwinds the way they built the comparison up, and
 * one at a time so a stray press costs one card rather than the whole set.
 */
export function closeNewestCascade(cascades: PeekCascades): PeekCascades {
	if (cascades.length === 0) return cascades;
	const newest = cascades.reduce((latest, cascade) => (cascade.id > latest.id ? cascade : latest));
	return closeCascadeIn(cascades, newest.id);
}

/** Replace one cascade with a rebuilt version of itself, matched by id. */
export function replaceCascade(cascades: PeekCascades, next: PeekCascade): PeekCascades {
	return cascades.map((cascade) => (cascade.id === next.id ? next : cascade));
}

/**
 * The cascades of one direction, ordered to match the chips above them.
 *
 * A cascade whose quantity is no longer among the chips keeps its place rather
 * than disappearing: the reader asked the question, and a designation cycled off
 * elsewhere is not them withdrawing it. Ordering is stable for those orphans —
 * they sort after the chips, by open order — so nothing jumps as the columns
 * change around them.
 */
export function cascadesInChipOrder(
	cascades: PeekCascades,
	direction: PeekDirection,
	chipKeys: readonly string[]
): PeekCascade[] {
	const rank = new Map(chipKeys.map((key, index) => [key, index]));
	return cascades
		.filter((cascade) => cascade.direction === direction)
		.map((cascade) => ({ cascade, rank: rank.get(cascade.rootKey) ?? Number.MAX_SAFE_INTEGER }))
		.sort((a, b) => (a.rank === b.rank ? a.cascade.id - b.cascade.id : a.rank - b.rank))
		.map((entry) => entry.cascade);
}
