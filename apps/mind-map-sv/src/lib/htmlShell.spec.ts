import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GRAPH_HTML_PAYLOAD_SCRIPT_ID, serializeGraphHtmlFile } from './graphFile';
import { cleanExportHtmlShell, isSelfContainedHtmlShell } from './htmlShell';

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

	it('removes an embedded graph payload from a captured export shell', () => {
		const shell = serializeGraphHtmlFile({
			data: {
				nodes: [{ id: 'n0', title: 'Old', description: '', tags: [] }],
				edges: [],
				posByNodeId: { n0: { x: 0, y: 0 } },
				tagColorConfig: { nodeTags: {}, edgeTags: {} }
			},
			viewState: { panX: 0, panY: 0, scale: 1 },
			documentId: 'old-doc'
		});

		const cleaned = cleanExportHtmlShell(shell);

		expect(cleaned).not.toContain(`id="${GRAPH_HTML_PAYLOAD_SCRIPT_ID}"`);
		expect(cleaned).toContain('<title>Mind Map</title>');
	});

	it('keeps the static offline shell current with the graph query controls', () => {
		const shell = readFileSync(new URL('../../static/offline-app-shell.html', import.meta.url), {
			encoding: 'utf8'
		});

		expect(shell).toContain('graph-query-button');
		expect(shell).toContain('Find / Filter');
	});
});
