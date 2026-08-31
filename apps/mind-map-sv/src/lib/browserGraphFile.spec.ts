import { describe, expect, it } from 'vitest';
import { filePickerTabHtml } from './browserGraphFile';

const APP_URL = 'https://example.test/app.html';

describe('filePickerTabHtml', () => {
	it('names the app version the reader is currently in', () => {
		expect(filePickerTabHtml(APP_URL, '2026-08-30 21:41 · efa2bbc')).toContain(
			'version 2026-08-30 21:41 · efa2bbc'
		);
	});

	it('says dev when there is no build stamp, which is what the dev server serves', () => {
		expect(filePickerTabHtml(APP_URL, 'dev')).toContain('version dev');
	});

	it('keeps the version with the heading rather than loose in the page', () => {
		const html = filePickerTabHtml(APP_URL, 'dev');
		const titles = /<div class="titles">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';

		expect(titles).toMatch(/<h1>Open graph file<\/h1>[\s\S]*app-version/);
	});

	it('escapes a version that would otherwise close a tag', () => {
		// The stamp comes from a meta tag in the running document, which is a
		// file the reader may have edited by hand. Nothing about that markup is
		// ours to trust.
		const html = filePickerTabHtml(APP_URL, '</p><script>alert(1)</script>');

		expect(html).toContain('&lt;/p&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
	});

	it('still carries the app url the picker navigates to', () => {
		expect(filePickerTabHtml(APP_URL, 'dev')).toContain(JSON.stringify(APP_URL));
	});
});
