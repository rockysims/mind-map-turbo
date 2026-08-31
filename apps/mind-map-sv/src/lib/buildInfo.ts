/**
 * Reading the build stamp that `scripts/build-stamp.mjs` injects into the
 * offline shell as `<meta name="mind-map-build">`.
 *
 * The stamp exists so a reader can tell which app a self-contained `.html`
 * document holds. File modification time cannot answer that: downloading from
 * an old document reuses that document's own app code as the export shell, so
 * the result is a fresh mtime wrapped around old code.
 */

export const BUILD_STAMP_META_NAME = 'mind-map-build';

export type BuildStamp = {
	/**
	 * ISO 8601 instant, keeping whatever UTC offset the build recorded it with.
	 * Rendered verbatim so the value in the UI and the value `grep` finds in the
	 * file are recognisably the same one.
	 */
	readonly iso: string;
	/** Short commit SHA, or null when the build had no git checkout to name. */
	readonly commit: string | null;
	/** The build carried work that was not in `commit`, so `iso` understates it. */
	readonly dirty: boolean;
};

/** `2026-08-30T21:41:32-07:00` or `2026-08-30T12:00:00Z`. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
const COMMIT = /^([0-9a-f]{7,40})(-dirty)?$/;

/**
 * Parse a stamp of the form `<instant> <short-sha>[-dirty]`, where the sha is
 * absent on a build with no git checkout.
 *
 * Returns null for anything not fully understood, including a well-formed
 * instant followed by a malformed commit token. Callers treat null as "no
 * version", which is the safe reading: `compareBuildStamps` refuses to order it
 * rather than guessing, so an unreadable stamp never produces a wrong warning.
 */
export function parseBuildStamp(content: string | null | undefined): BuildStamp | null {
	if (typeof content !== 'string') return null;

	const parts = content.trim().split(/\s+/);
	if (parts.length > 2) return null;

	const iso = parts[0] ?? '';
	if (!INSTANT.test(iso) || Number.isNaN(Date.parse(iso))) return null;

	const commitToken = parts[1];
	if (commitToken === undefined) return { iso, commit: null, dirty: false };

	const commitMatch = COMMIT.exec(commitToken);
	if (commitMatch === null) return null;

	return { iso, commit: commitMatch[1] ?? null, dirty: commitMatch[2] !== undefined };
}

/**
 * Render a stamp for display: `2026-08-30 21:41 · efa2bbc`, or `dev` when there
 * is no stamp to show — which is what the dev server serves, since the meta is
 * only injected by the production build.
 *
 * Slices the instant rather than reformatting it through `Date`, so the date
 * shown is the wall clock the commit was made on. Converting to the reader's
 * timezone would push an evening commit onto the next day and read as a
 * different build from the one `grep` reports.
 */
export function formatBuildStamp(stamp: BuildStamp | null): string {
	if (stamp === null) return 'dev';

	const when = `${stamp.iso.slice(0, 10)} ${stamp.iso.slice(11, 16)}`;
	if (stamp.commit === null) return when;
	return `${when} · ${stamp.commit}${stamp.dirty ? '-dirty' : ''}`;
}

/**
 * Order two stamps by their absolute instant, parsing each one's offset so
 * builds recorded in different timezones still compare correctly.
 *
 * Returns null when either side is unorderable, so callers cannot accidentally
 * read "unknown" as "older".
 */
export function compareBuildStamps(
	left: BuildStamp | null,
	right: BuildStamp | null
): number | null {
	if (left === null || right === null) return null;

	const leftTime = Date.parse(left.iso);
	const rightTime = Date.parse(right.iso);
	if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) return null;

	return Math.sign(leftTime - rightTime);
}
