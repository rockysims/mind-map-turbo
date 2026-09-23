import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_EXAMPLE_FILENAME, createAiExampleHtml } from './example-save-file.mjs';
import {
	offlineShellSourceFingerprint,
	OFFLINE_SHELL_FINGERPRINT_META_NAME,
	readOfflineShellFingerprint
} from './offline-shell-fingerprint.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const offlineShellPath = join(appRoot, 'static', 'offline-app-shell.html');
const aiExamplePath = join(appRoot, 'examples', AI_EXAMPLE_FILENAME);

const [expected, shell, aiExample] = await Promise.all([
	offlineShellSourceFingerprint({ appRoot }),
	readFile(offlineShellPath, 'utf8'),
	readFile(aiExamplePath, 'utf8')
]);
const actual = readOfflineShellFingerprint(shell);

if (actual !== expected) {
	console.error(
		[
			'Offline app shell is stale.',
			`Expected ${OFFLINE_SHELL_FINGERPRINT_META_NAME}=${expected}, found ${actual ?? 'missing'}.`,
			'Run `pnpm --filter mind-map-sv build` or `pnpm dev:downloadable` before downloading propagated HTML files.'
		].join('\n')
	);
	process.exit(1);
}

const expectedAiExample = createAiExampleHtml(shell);
if (aiExample !== expectedAiExample) {
	console.error(
		[
			`AI example save is stale: examples/${AI_EXAMPLE_FILENAME}.`,
			'Run `pnpm --filter mind-map-sv build` to regenerate it from the current offline shell and tutorial graph.'
		].join('\n')
	);
	process.exit(1);
}

console.log(`Offline shell fingerprint is fresh: ${actual}`);
console.log(`AI example save is fresh: examples/${AI_EXAMPLE_FILENAME}`);
