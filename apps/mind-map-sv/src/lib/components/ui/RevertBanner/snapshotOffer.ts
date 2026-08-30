/**
 * The words the revert offer is made in: what the operation did, and when.
 *
 * A snapshot outlives a reload, so "Revert" on its own is a promise with no
 * stated size — the reader may be looking at this banner five minutes or two
 * days after the import that wrote it. The phrase is coarse on purpose: the only
 * decision it supports is "is this recent enough that I know what I would lose",
 * and a second-by-second countdown would invite re-rendering forever to answer a
 * question nobody asks that precisely.
 */

/** How often the banner should re-derive its age phrase, in ms. */
export const SNAPSHOT_AGE_REFRESH_MS = 30_000;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * A phrase for the elapsed time between `createdAt` and `now`, e.g.
 * `'5 minutes ago'`. Reads as `'moments ago'` under a minute, and for a
 * `createdAt` in the future — a clock that moved backwards is not worth a
 * separate sentence, and "in -3 minutes" would be worse than vague.
 */
export function formatSnapshotAge(createdAt: number, now: number): string {
	const elapsedMs = now - createdAt;
	if (!Number.isFinite(elapsedMs) || elapsedMs < MINUTE_MS) return 'moments ago';
	if (elapsedMs < HOUR_MS) return countedPhrase(Math.floor(elapsedMs / MINUTE_MS), 'minute');
	if (elapsedMs < DAY_MS) return countedPhrase(Math.floor(elapsedMs / HOUR_MS), 'hour');
	return countedPhrase(Math.floor(elapsedMs / DAY_MS), 'day');
}

function countedPhrase(count: number, unit: string): string {
	return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

/**
 * What the operation behind the snapshot did, as a headline.
 *
 * The snapshot itself only records a label, so the size of an import is
 * recovered by subtracting the node count it captured from the graph on screen.
 * That arithmetic stops being true the moment the reader adds or deletes a node,
 * and the banner outlives reloads, so anything but a plain positive difference
 * falls back to the honest vague answer rather than stating a number that is
 * quietly wrong.
 */
export function snapshotOfferHeadline(
	label: string,
	snapshotNodeCount: number,
	currentNodeCount: number
): string {
	const addedNodeCount = currentNodeCount - snapshotNodeCount;
	if (label !== 'import' || addedNodeCount <= 0) return 'Graph changed';
	return `Imported ${addedNodeCount} ${addedNodeCount === 1 ? 'node' : 'nodes'}`;
}
