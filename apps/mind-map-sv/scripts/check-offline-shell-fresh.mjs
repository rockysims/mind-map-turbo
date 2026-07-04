import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	offlineShellSourceFingerprint,
	OFFLINE_SHELL_FINGERPRINT_META_NAME,
	readOfflineShellFingerprint
} from './offline-shell-fingerprint.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const offlineShellPath = join(appRoot, 'static', 'offline-app-shell.html');

const [expected, shell] = await Promise.all([
	offlineShellSourceFingerprint({ appRoot }),
	readFile(offlineShellPath, 'utf8')
]);
const actual = readOfflineShellFingerprint(shell);

if (actual === expected) {
	console.log(`Offline shell fingerprint is fresh: ${actual}`);
	process.exit(0);
}

console.error(
	[
		'Offline app shell is stale.',
		`Expected ${OFFLINE_SHELL_FINGERPRINT_META_NAME}=${expected}, found ${actual ?? 'missing'}.`,
		'Run `pnpm --filter mind-map-sv build` or `pnpm dev:downloadable` before downloading propagated HTML files.'
	].join('\n')
);
process.exit(1);
