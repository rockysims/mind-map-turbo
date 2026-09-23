import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUILD_STAMP_META_NAME = 'mind-map-build';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultAppRoot = resolve(scriptDir, '..');
const defaultRepoRoot = resolve(defaultAppRoot, '../..');

/**
 * Build outputs, never build inputs. Without these exclusions, regenerating
 * either tracked HTML product dirties the tree with the build's own output, so
 * the next build would stamp `-dirty` and claim uncommitted source that does
 * not exist.
 */
const generatedHtmlRepoPaths = new Set([
	'apps/mind-map-sv/static/offline-app-shell.html',
	'apps/mind-map-sv/examples/ai-mind-map.html'
]);

/**
 * Identify the app build going into the offline shell, as
 * `<iso-instant> <short-sha>[-dirty]`.
 *
 * The instant is HEAD's committer date rather than the build clock so two
 * builds of the same clean commit produce a byte-identical shell — the shell is
 * tracked in git, and a wall-clock stamp would dirty 581 KB on every build.
 * Without a usable git checkout there is no commit to name, so the stamp falls
 * back to the build clock alone and readers see an instant with no sha.
 *
 * Git's own UTC offset is kept rather than normalized to Z, so the displayed
 * date is the wall clock the commit was made on. Normalizing would push an
 * evening commit onto the next day and read as the wrong build. Ordering is
 * unaffected: comparison parses the offset back to an absolute instant.
 *
 * @param {{ repoRoot?: string; now?: () => Date }} [options]
 * @returns {string}
 */
export function resolveBuildStamp({ repoRoot = defaultRepoRoot, now = () => new Date() } = {}) {
	const commit = git(repoRoot, ['rev-parse', '--short', 'HEAD']);
	const committedAt = git(repoRoot, ['log', '-1', '--format=%cI']);
	if (commit === null || committedAt === null) return buildClockInstant(now());

	const status = git(repoRoot, ['status', '--porcelain']);
	const dirty = status !== null && hasSourceChanges(status);
	return `${committedAt} ${commit}${dirty ? '-dirty' : ''}`;
}

/**
 * @param {string} html
 * @param {string} stamp
 * @returns {string}
 */
export function withBuildStamp(html, stamp) {
	const meta = `<meta name="${BUILD_STAMP_META_NAME}" content="${stamp}">`;
	const existing = buildStampMetaPattern();
	if (existing.test(html)) return html.replace(existing, meta);

	const headCloseIndex = html.toLowerCase().indexOf('</head>');
	if (headCloseIndex === -1) return `${meta}\n${html}`;
	return `${html.slice(0, headCloseIndex)}\t\t${meta}\n${html.slice(headCloseIndex)}`;
}

/**
 * @param {string} html
 * @returns {string | null}
 */
export function readBuildStamp(html) {
	const match = buildStampMetaPattern().exec(html);
	return match?.[3] ?? null;
}

function buildStampMetaPattern() {
	return new RegExp(
		`<meta\\b(?=[^>]*\\bname=(["'])${BUILD_STAMP_META_NAME}\\1)(?=[^>]*\\bcontent=(["'])([^"']+)\\2)[^>]*>`,
		'i'
	);
}

/**
 * Whether `git status --porcelain` output names anything but generated HTML.
 *
 * Exported for its spec: this is the difference between `-dirty` meaning
 * "built from uncommitted source" and meaning nothing at all.
 *
 * @param {string} status
 * @returns {boolean}
 */
export function hasSourceChanges(status) {
	return status
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line !== '')
		.some((line) => !generatedHtmlRepoPaths.has(statusPath(line)));
}

/**
 * The path out of one `--porcelain` line, tolerating a trimmed leading space —
 * `git()` trims, so ` M path` reaches here as `M path` and a fixed-width slice
 * would eat the first character of the path.
 *
 * @param {string} line
 * @returns {string}
 */
function statusPath(line) {
	return /^\S{1,2}\s+(.*)$/.exec(line)?.[1] ?? line;
}

/**
 * Seconds precision, matching the shape of git's `%cI` so one parser reads both.
 *
 * @param {Date} date
 * @returns {string}
 */
function buildClockInstant(date) {
	if (Number.isNaN(date.getTime())) return buildClockInstant(new Date(0));
	return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Trimmed stdout, or null if git is missing, errors, or this is not a checkout.
 *
 * @param {string} repoRoot
 * @param {string[]} args
 * @returns {string | null}
 */
function git(repoRoot, args) {
	try {
		return execFileSync('git', args, {
			cwd: repoRoot,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore']
		}).trim();
	} catch {
		return null;
	}
}
