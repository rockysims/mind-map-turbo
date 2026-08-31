import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const OFFLINE_SHELL_FINGERPRINT_META_NAME = 'mind-map-offline-shell-source';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultAppRoot = resolve(scriptDir, '..');
const defaultRepoRoot = resolve(defaultAppRoot, '../..');
const offlineShellPath = 'static/offline-app-shell.html';

const appInputs = [
	'package.json',
	'svelte.config.js',
	'tsconfig.json',
	'vite.config.ts',
	'scripts/build-stamp.mjs',
	'scripts/inline-static-build.mjs',
	'scripts/offline-shell-fingerprint.mjs',
	'src',
	'static'
];

const repoInputs = ['pnpm-lock.yaml'];
const ignoredDirectoryNames = new Set(['.svelte-kit', 'build', 'node_modules', 'test-results']);

export async function offlineShellSourceFingerprint({
	appRoot = defaultAppRoot,
	repoRoot = defaultRepoRoot
} = {}) {
	const hash = createHash('sha256');
	for (const input of appInputs) {
		await hashPath(hash, appRoot, input, appRoot);
	}
	for (const input of repoInputs) {
		await hashPath(hash, repoRoot, input, repoRoot);
	}
	return hash.digest('hex').slice(0, 16);
}

export function withOfflineShellFingerprint(html, fingerprint) {
	const meta = `<meta name="${OFFLINE_SHELL_FINGERPRINT_META_NAME}" content="${fingerprint}">`;
	const existing = offlineShellFingerprintMetaPattern();
	if (existing.test(html)) return html.replace(existing, meta);

	const headCloseIndex = html.toLowerCase().indexOf('</head>');
	if (headCloseIndex === -1) return `${meta}\n${html}`;
	return `${html.slice(0, headCloseIndex)}\t\t${meta}\n${html.slice(headCloseIndex)}`;
}

export function readOfflineShellFingerprint(html) {
	const match = offlineShellFingerprintMetaPattern().exec(html);
	return match?.[3] ?? null;
}

function offlineShellFingerprintMetaPattern() {
	return new RegExp(
		`<meta\\b(?=[^>]*\\bname=(["'])${OFFLINE_SHELL_FINGERPRINT_META_NAME}\\1)(?=[^>]*\\bcontent=(["'])([^"']+)\\2)[^>]*>`,
		'i'
	);
}

async function hashPath(hash, root, input, labelRoot) {
	const absolutePath = join(root, input);
	let entryStat;
	try {
		entryStat = await stat(absolutePath);
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
			return;
		}
		throw error;
	}

	if (entryStat.isDirectory()) {
		if (ignoredDirectoryNames.has(input.split('/').at(-1) ?? '')) return;
		const entries = await readdir(absolutePath, { withFileTypes: true });
		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			await hashPath(hash, absolutePath, entry.name, labelRoot);
		}
		return;
	}

	if (!entryStat.isFile()) return;
	const relativePath = relative(labelRoot, absolutePath).replaceAll('\\', '/');
	if (relativePath === offlineShellPath) return;

	hash.update(relativePath);
	hash.update('\0');
	hash.update(await readFile(absolutePath));
	hash.update('\0');
}
