/**
 * What must and must not be inside the committed offline shell.
 *
 * The shell is the product: one HTML file that has to run from `file://` with
 * no network. Two of its properties are worth a gate rather than a review,
 * because both regress silently — a bundler change that pulls a runtime
 * dependency in, or an inlining change that drops the worker source, still
 * builds, still passes every other test, and is only noticed by a reader whose
 * saved file no longer works.
 *
 * This reads the committed `static/offline-app-shell.html`, not a fresh build:
 * that file is what a download actually carries, and
 * `check-offline-shell-fresh.mjs` is what keeps it in step with the source.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const shell = readFileSync(new URL('../../static/offline-app-shell.html', import.meta.url), {
	encoding: 'utf8'
});

describe('the committed offline shell', () => {
	it('carries the Python worker source, so a run can start with no network', () => {
		// The worker is a blob built from a string in `pyWorker.ts`, and the one
		// thing that string must name is the runtime module it imports. If the
		// source stopped being inlined, every AI run would fail at load.
		expect(shell).toContain('pyodide.mjs');
	});

	it('carries no Anthropic SDK runtime code', () => {
		// `@anthropic-ai/sdk` is a devDependency for `import type` only: its
		// browser build is 188 KB minified against a ~630 KB shell, and the client
		// is a raw fetch precisely so none of it ships. A real import would leave
		// a module path behind in the bundle; a mention in prose or a comment
		// would not.
		expect(shell).not.toMatch(/anthropic-ai\/sdk\/\S/);
		// A minifier can erase module paths, so also look for something only the
		// SDK's runtime emits: the platform headers it puts on every request.
		expect(shell.toLowerCase()).not.toContain('x-stainless-lang');
	});

	it('states its content security policy, which travels with every download', () => {
		// The shell holds an API key in browser storage and renders model output,
		// and a downloaded copy opens from `file://` where every local file shares
		// one storage. The policy is the app's own, not the host's, so it has to
		// be in the document.
		expect(shell).toMatch(/http-equiv="Content-Security-Policy"/i);
		for (const directive of [
			"default-src 'self'",
			"script-src 'self' 'unsafe-inline' blob: https://cdn.jsdelivr.net 'wasm-unsafe-eval'",
			'worker-src blob:',
			"connect-src 'self' https://api.anthropic.com https://cdn.jsdelivr.net",
			"img-src 'self' blob: data:",
			"font-src 'self' data:",
			"style-src 'self' 'unsafe-inline'"
		]) {
			expect(shell).toContain(directive);
		}
	});
});
