/**
 * Per-worktree dev-server ports.
 *
 * Several Claude Code sessions run at once in sibling worktrees under
 * `<repo>/.claude/worktrees/<name>/`. Every one of them used to serve Vite on
 * 5199, the e2e preview on 4173 and Storybook on 6006, so a session's browser
 * preview — or, worse, Playwright's `reuseExistingServer` — could silently
 * attach to another session's server running different code.
 *
 * Each port here is derived from the worktree's absolute root path, so it is:
 *   - stable across commits, because the path does not change when HEAD does
 *     (a commit hash would, and would also collide between same-tip worktrees);
 *   - different for every worktree, because every worktree has its own path.
 *
 * Consumers:
 *   - `.claude/launch.json` — rewritten by this script's CLI, which runs from
 *     the root `postinstall`, so `pnpm install` configures a fresh worktree.
 *   - `apps/mind-map-sv/playwright.config.ts` — imports `devPorts.preview`.
 *   - the app's `storybook` script — `-p $(node ../../scripts/dev-ports.mjs --print storybook)`.
 *
 * Run `pnpm dev-ports` at any time to re-derive and print them.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** @typedef {'dev' | 'preview' | 'storybook'} PortRole */

/**
 * One band per locally-run server, disjoint so two roles can never meet, all
 * inside 1024-9999 and clear of the crowded 3000/4000/5000/8000/9000 blocks
 * where an unrelated tool is most likely to already be listening.
 *
 * @type {Record<PortRole, { start: number; size: number }>}
 */
export const PORT_BANDS = {
	dev: { start: 6100, size: 500 },
	preview: { start: 7300, size: 500 },
	storybook: { start: 8100, size: 500 }
};

/** Well-known services that fall inside the bands above; skipped when derived. */
const RESERVED_PORTS = new Set([
	6379, // redis
	6443, // kubernetes api
	7474, // neo4j http
	7687, // neo4j bolt
	8443, // https alternate
	8500 // consul http
]);

/** Separates the role from the path in the hashed string. */
const HASH_SEPARATOR = '::';

/**
 * 32-bit FNV-1a. Chosen over a crypto hash because it needs no import, is a few
 * lines, and only has to spread paths evenly across a 500-wide band.
 *
 * @param {string} text
 * @returns {number}
 */
export const fnv1a32 = (text) => {
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		// `Math.imul` keeps the FNV prime multiply in 32 bits without BigInt.
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
};

/**
 * @param {string} worktreeRoot absolute path to the worktree root
 * @param {PortRole} role
 * @returns {number}
 */
const derivePort = (worktreeRoot, role) => {
	const band = PORT_BANDS[role];
	// The role is part of the hashed text, so the three ports move independently
	// rather than sitting at a fixed distance from one another.
	const hash = fnv1a32(role + HASH_SEPARATOR + worktreeRoot);
	// FNV's own xor-folding step, applied before the modulo. Sibling worktree
	// paths differ only in their last few characters, and reducing those weak
	// low bits alone clustered the result; folding the high bits down first
	// spreads 2000 sample paths over ~491 of the 500 slots instead of ~425.
	const offset = ((hash ^ (hash >>> 16)) >>> 0) % band.size;
	for (let step = 0; step < band.size; step += 1) {
		const port = band.start + ((offset + step) % band.size);
		if (!RESERVED_PORTS.has(port)) return port;
	}
	// Unreachable: every band is far wider than the reserved list.
	throw new Error(`No free port left in the ${role} band.`);
};

/**
 * @param {string} worktreeRoot absolute path to the worktree root
 * @returns {Record<PortRole, number>}
 */
export const derivePorts = (worktreeRoot) => ({
	dev: derivePort(worktreeRoot, 'dev'),
	preview: derivePort(worktreeRoot, 'preview'),
	storybook: derivePort(worktreeRoot, 'storybook')
});

/**
 * This file lives at `<worktree>/scripts/`, so its own location identifies the
 * worktree no matter which package a consumer is running from.
 */
export const WORKTREE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The ports for the worktree this copy of the script belongs to. */
export const devPorts = derivePorts(WORKTREE_ROOT);

/**
 * @param {number} devPort
 * @returns {string}
 */
const launchJson = (devPort) =>
	`${JSON.stringify(
		{
			version: '0.0.1',
			configurations: [
				{
					name: 'mind-map-sv',
					runtimeExecutable: 'pnpm',
					// `--strictPort` on purpose: a taken port must fail loudly instead of
					// drifting to a neighbour the preview pane is not pointed at.
					runtimeArgs: ['--filter', 'mind-map-sv', 'dev', '--port', String(devPort), '--strictPort'],
					port: devPort
				}
			]
		},
		null,
		'\t'
	)}\n`;

const writeLaunchJson = async () => {
	const path = join(WORKTREE_ROOT, '.claude', 'launch.json');
	const wanted = launchJson(devPorts.dev);
	const current = await readFile(path, 'utf8').catch(() => null);
	if (current === wanted) return { path, outcome: 'Up to date' };
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, wanted);
	return { path, outcome: current === null ? 'Created' : 'Updated' };
};

const main = async () => {
	const printFlagIndex = process.argv.indexOf('--print');
	if (printFlagIndex !== -1) {
		const role = process.argv[printFlagIndex + 1];
		if (role !== 'dev' && role !== 'preview' && role !== 'storybook') {
			const got = role ?? 'nothing';
			console.error(`dev-ports: --print takes dev, preview or storybook (got ${got}).`);
			process.exit(1);
		}
		// A bare number on stdout: this branch exists to be read by `$(...)`.
		console.log(devPorts[role]);
		return;
	}

	const { path, outcome } = await writeLaunchJson();
	console.log(`Dev ports for ${WORKTREE_ROOT}`);
	console.log(`  vite dev   ${devPorts.dev}`);
	console.log(`  preview    ${devPorts.preview}  (playwright webServer)`);
	console.log(`  storybook  ${devPorts.storybook}`);
	console.log(`${outcome}: ${path}`);
};

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
	await main();
}
