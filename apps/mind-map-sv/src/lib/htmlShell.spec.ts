import { describe, expect, it } from 'vitest';
import { isSelfContainedHtmlShell } from './htmlShell';

describe('HTML shell helpers', () => {
	it('accepts inline module scripts as self-contained', () => {
		expect(isSelfContainedHtmlShell('<script type="module">console.log("offline")</script>')).toBe(
			true
		);
	});

	it('rejects external module scripts from dev or split builds', () => {
		expect(
			isSelfContainedHtmlShell('<script type="module" src="/@fs/example/entry.js"></script>')
		).toBe(false);
		expect(
			isSelfContainedHtmlShell('<script src="/_app/immutable/bundle.js" type="module"></script>')
		).toBe(false);
	});

	it('rejects inline Vite dev module loaders', () => {
		expect(
			isSelfContainedHtmlShell(
				'<script type="module">import("/node_modules/.pnpm/@sveltejs/kit/src/runtime/client/entry.js")</script>'
			)
		).toBe(false);
		expect(
			isSelfContainedHtmlShell(
				'<script type="module">import("/@fs/Users/rocky/dev/mindMap/mind-map-turbo/apps/mind-map-sv/.svelte-kit/generated/client/app.js")</script>'
			)
		).toBe(false);
		expect(
			isSelfContainedHtmlShell(
				'<script>Promise.all([import("/@fs/app/.svelte-kit/generated/client/app.js")])</script>'
			)
		).toBe(false);
	});

	it('accepts offline app code that mentions dev paths without importing them', () => {
		expect(
			isSelfContainedHtmlShell(
				'<script type="module">const devOnly = ["/@fs/", "/node_modules/", "/.svelte-kit/generated/"];</script>'
			)
		).toBe(true);
	});
});
