import { readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { expect, test, type Page } from '@playwright/test';

const CURRENT_SCHEMA_VERSION = 3;
const GRAPH_HTML_PAYLOAD_SCRIPT_ID = 'mind-map-embedded-graph';

function graphUrl(graphId: string): string {
	return `/#/?${new URLSearchParams({ graph: graphId }).toString()}`;
}

function documentDraftGraphId(documentId: string): string {
	return `document:${documentId}`;
}

test('home page renders the graph entrypoint', async ({ page }) => {
	await page.goto('/');

	await expect(page.getByText('Root')).toBeVisible();
});

test('persists edited nodes across reloads in one document tab', async ({ page }) => {
	const firstGraphId = `e2e-${Date.now()}`;

	await page.goto('/');
	await page.evaluate(() => localStorage.clear());
	await page.goto(graphUrl(firstGraphId));
	await expect(page.getByText('Root')).toBeVisible();

	await editFirstNodeTitle(page, 'Persisted Node');
	await waitForStoredTitle(page, firstGraphId, 'Persisted Node');

	await page.reload();
	await expect(page.getByText('Persisted Node')).toBeVisible();
	await expect(page.getByRole('status')).toContainText('Download needed');

	const storedPayload = await page.evaluate((graphId) => {
		const key = `mind-map:graph:${encodeURIComponent(graphId)}`;
		const item = localStorage.getItem(key);
		return item ? JSON.parse(item) : null;
	}, firstGraphId);
	expect(storedPayload).toMatchObject({ schemaVersion: CURRENT_SCHEMA_VERSION });

	const newGraphPromise = page.waitForEvent('popup');
	await page.getByRole('button', { name: 'New' }).click();
	const newGraphPage = await newGraphPromise;
	await newGraphPage.waitForLoadState('domcontentloaded');
	const rootTitleInput = newGraphPage.locator('.title-input');
	await expect(rootTitleInput).toHaveValue('Root');
	await expect(rootTitleInput).toBeFocused();
	await expect(newGraphPage).toHaveURL(/graph=graph-/);

	await expect(page.getByText('Persisted Node')).toBeVisible();
	await expect(page.getByRole('status')).toContainText('Download needed');
});

test('exports HTML graph document containing schemaVersion, graph data, and viewState', async ({
	page
}) => {
	const graphId = `e2e-export-${Date.now()}`;

	await page.goto('/');
	await page.evaluate(() => localStorage.clear());
	await page.goto(graphUrl(graphId));
	await expect(page.getByText('Root')).toBeVisible();

	await editFirstNodeTitle(page, 'Exported Node');
	await waitForStoredTitle(page, graphId, 'Exported Node');

	// Dispatch a wheel event directly on the stage to trigger a zoom and produce
	// a non-default viewState before exporting.
	await page.locator('.stage').dispatchEvent('wheel', { deltaY: -300 });
	await waitForStoredViewState(page, graphId, { scaleDifferentFrom: 1 });

	// Capture the Download artifact.
	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Download' }).click();
	const download = await downloadPromise;
	const downloadedPath = await download.path();
	if (!downloadedPath) throw new Error('Download did not produce a file');
	expect(download.suggestedFilename()).toBe(`${graphId}.html`);
	const html = await readFile(downloadedPath, 'utf-8');
	expect(html).not.toContain('/@fs/');
	expect(html).not.toMatch(/<script\b(?=[^>]*\btype=(["'])module\1)(?=[^>]*\bsrc=)/i);

	const doc = extractGraphHtmlPayload(html);
	expect(doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
	expect(doc.data.nodes.some((n) => n.title === 'Exported Node')).toBe(true);
	expect(doc.viewState).toMatchObject({
		panX: expect.any(Number),
		panY: expect.any(Number),
		scale: expect.any(Number)
	});
	// Wheel zoom should have changed scale away from the neutral value of 1.
	expect(doc.viewState.scale).not.toBe(1);
	await expect(page.getByRole('status')).toHaveText('Matches downloaded file.');
});

test('self-contained build artifact opens from disk without sibling app assets', async ({
	page
}) => {
	const requests: string[] = [];
	page.on('request', (request) => {
		requests.push(request.url());
	});

	await page.goto(pathToFileURL(join(process.cwd(), 'build', 'index.html')).href);

	await expect(page.getByText('Root')).toBeVisible();
	expect(requests.filter((url) => url.includes('/_app/'))).toEqual([]);
});

test('opened HTML save file data wins when no local draft exists', async ({ page }) => {
	const documentId = `doc-stale-${Date.now()}`;
	const tmpFile = join(tmpdir(), `e2e-open-save-${Date.now()}.html`);

	await writeFile(
		tmpFile,
		await selfContainedGraphHtml(graphDocumentPayload({ documentId, title: 'Stale Embedded Node' }))
	);
	await page.goto(pathToFileURL(tmpFile).href);
	await expect(page.getByText('Stale Embedded Node')).toBeVisible();

	await writeFile(
		tmpFile,
		await selfContainedGraphHtml(graphDocumentPayload({ documentId, title: 'Fresh Embedded Node' }))
	);
	await page.goto(pathToFileURL(tmpFile).href);

	await expect(page.getByText('Fresh Embedded Node')).toBeVisible();
	await expect(page.getByText('Stale Embedded Node')).not.toBeVisible();
});

test('opened HTML save file recovers dirty local draft before embedded data', async ({ page }) => {
	const documentId = `doc-dirty-${Date.now()}`;
	const tmpFile = join(tmpdir(), `e2e-open-dirty-save-${Date.now()}.html`);
	const graphId = documentDraftGraphId(documentId);

	await writeFile(
		tmpFile,
		await selfContainedGraphHtml(graphDocumentPayload({ documentId, title: 'Embedded Node' }))
	);
	await page.goto(pathToFileURL(tmpFile).href);
	await expect(page.getByText('Embedded Node')).toBeVisible();

	await editFirstNodeTitle(page, 'Recovered Draft Node');
	await waitForStoredTitle(page, graphId, 'Recovered Draft Node');

	await writeFile(
		tmpFile,
		await selfContainedGraphHtml(graphDocumentPayload({ documentId, title: 'Fresh File Node' }))
	);
	await page.goto(pathToFileURL(tmpFile).href);

	await expect(page.getByText('Recovered Draft Node')).toBeVisible();
	await expect(page.getByText('Fresh File Node')).not.toBeVisible();
	await expect(page.getByRole('status')).toHaveText('Recovered local edits. Download needed.');
});

test('new opens a fresh graph from an opened HTML save file', async ({ page }) => {
	const documentId = `doc-new-from-file-${Date.now()}`;
	const tmpFile = join(tmpdir(), `e2e-new-from-save-${Date.now()}.html`);
	await writeFile(
		tmpFile,
		await selfContainedGraphHtml(graphDocumentPayload({ documentId, title: 'Saved File Node' }))
	);

	await page.goto(pathToFileURL(tmpFile).href);
	await expect(page.getByText('Saved File Node')).toBeVisible();

	const popupPromise = page.waitForEvent('popup');
	await page.getByRole('button', { name: 'New' }).click();
	const popup = await popupPromise;
	await popup.waitForLoadState('domcontentloaded');

	const rootTitleInput = popup.locator('.title-input');
	await expect(rootTitleInput).toHaveValue('Root');
	await expect(rootTitleInput).toBeFocused();
	await expect(popup.getByText('Saved File Node')).not.toBeVisible();
	await expect(page.getByText('Saved File Node')).toBeVisible();
});

test('browser back restores embedded graph after opened file hash route', async ({ page }) => {
	const documentId = `doc-file-back-${Date.now()}`;
	const tmpFile = join(tmpdir(), `e2e-file-back-${Date.now()}.html`);
	await writeFile(
		tmpFile,
		await selfContainedGraphHtml(graphDocumentPayload({ documentId, title: 'Original File Node' }))
	);

	const fileUrl = pathToFileURL(tmpFile).href;
	await page.goto(fileUrl);
	await expect(page.getByText('Original File Node')).toBeVisible();

	const routedUrl = `${fileUrl}#/?${new URLSearchParams({ graph: `graph-${Date.now()}` }).toString()}`;
	await page.evaluate((url) => {
		window.location.href = url;
	}, routedUrl);
	await expect(page).toHaveURL(routedUrl);
	await expect(page.getByText('Root')).toBeVisible();
	await expect(page.getByText('Original File Node')).not.toBeVisible();

	await page.goBack();
	await expect(page).toHaveURL(fileUrl);
	await expect(page.getByText('Original File Node')).toBeVisible();
	await expect(page.getByText('Root')).not.toBeVisible();
});

test('single-document toolbar omits graph library controls', async ({ page }) => {
	await page.goto('/');

	await expect(page.getByRole('button', { name: 'New' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Open' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Download' })).toBeVisible();
	await expect(page.getByLabel('Load graph', { exact: true })).toHaveCount(0);
	await expect(page.getByLabel('Import graph from file')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Delete graph' })).toHaveCount(0);
});

test('load opens an HTML save file in a new tab', async ({ page }) => {
	const documentId = `doc-load-${Date.now()}`;
	const tmpFile = join(tmpdir(), `e2e-load-save-${Date.now()}.html`);
	await writeFile(
		tmpFile,
		await selfContainedGraphHtml(graphDocumentPayload({ documentId, title: 'Loaded File Node' }))
	);

	await page.goto('/');
	const popupPromise = page.waitForEvent('popup');
	await page.getByText('Open').click();
	const popup = await popupPromise;
	await popup.waitForLoadState('domcontentloaded');
	await expect(popup.getByRole('button', { name: 'Choose graph file' })).toBeVisible();

	const fileChooserPromise = popup.waitForEvent('filechooser');
	await popup.getByRole('button', { name: 'Choose graph file' }).click();
	const fileChooser = await fileChooserPromise;
	await fileChooser.setFiles(tmpFile);
	await popup.waitForLoadState('domcontentloaded');

	await expect(popup).not.toHaveURL('about:blank');
	await expect(popup.getByText('Loaded File Node')).toBeVisible();
	await expect(popup.getByText('Local edits found')).not.toBeVisible();
	await expect(page.getByText('Root')).toBeVisible();
});

test('load opens selected HTML file instead of stale local document draft', async ({ page }) => {
	const documentId = `doc-load-stale-${Date.now()}`;
	const tmpFile = join(tmpdir(), `e2e-load-stale-save-${Date.now()}.html`);
	const freshFilePayload = graphDocumentPayload({ documentId, title: 'Fresh Loaded Node' });
	const staleDraftPayload = graphDocumentPayload({ documentId, title: 'Stale Local Draft Node' });
	await writeFile(tmpFile, await selfContainedGraphHtml(freshFilePayload));

	await page.goto('/');
	await page.evaluate(
		({ graphId, payload }) => {
			localStorage.setItem(
				`mind-map:graph:${encodeURIComponent(graphId)}`,
				JSON.stringify({
					schemaVersion: payload.schemaVersion,
					data: payload.data,
					viewState: payload.viewState,
					updatedAt: Date.now()
				})
			);
		},
		{
			graphId: documentDraftGraphId(documentId),
			payload: staleDraftPayload
		}
	);

	const popupPromise = page.waitForEvent('popup');
	await page.getByText('Open').click();
	const popup = await popupPromise;
	await popup.waitForLoadState('domcontentloaded');
	const fileChooserPromise = popup.waitForEvent('filechooser');
	await popup.getByRole('button', { name: 'Choose graph file' }).click();
	const fileChooser = await fileChooserPromise;
	await fileChooser.setFiles(tmpFile);
	await popup.waitForLoadState('domcontentloaded');
	await expect(popup).not.toHaveURL('about:blank');
	await expect(popup.getByText('Local edits found')).toBeVisible();
	await popup.getByRole('button', { name: 'Open selected file' }).click();

	await expect(popup.getByText('Fresh Loaded Node')).toBeVisible();
	await expect(popup.getByText('Stale Local Draft Node')).not.toBeVisible();
	await waitForStoredTitle(popup, documentDraftGraphId(documentId), 'Fresh Loaded Node');
});

test('load can recover local edits instead of opening selected HTML file', async ({ page }) => {
	const documentId = `doc-load-recover-${Date.now()}`;
	const tmpFile = join(tmpdir(), `e2e-load-recover-save-${Date.now()}.html`);
	const filePayload = graphDocumentPayload({ documentId, title: 'Selected File Node' });
	const draftPayload = graphDocumentPayload({ documentId, title: 'Recovered Draft Node' });
	await writeFile(tmpFile, await selfContainedGraphHtml(filePayload));

	await page.goto('/');
	await page.evaluate(
		({ graphId, payload }) => {
			localStorage.setItem(
				`mind-map:graph:${encodeURIComponent(graphId)}`,
				JSON.stringify({
					schemaVersion: payload.schemaVersion,
					data: payload.data,
					viewState: payload.viewState,
					updatedAt: Date.now()
				})
			);
		},
		{
			graphId: documentDraftGraphId(documentId),
			payload: draftPayload
		}
	);

	const popupPromise = page.waitForEvent('popup');
	await page.getByText('Open').click();
	const popup = await popupPromise;
	await popup.waitForLoadState('domcontentloaded');
	const fileChooserPromise = popup.waitForEvent('filechooser');
	await popup.getByRole('button', { name: 'Choose graph file' }).click();
	const fileChooser = await fileChooserPromise;
	await fileChooser.setFiles(tmpFile);
	await popup.waitForLoadState('domcontentloaded');
	await expect(popup).not.toHaveURL('about:blank');
	await expect(popup.getByText('Local edits found')).toBeVisible();
	await popup.getByRole('button', { name: 'Recover local edits' }).click();

	await expect(popup.getByText('Recovered Draft Node')).toBeVisible();
	await expect(popup.getByText('Selected File Node')).not.toBeVisible();
	await waitForStoredTitle(popup, documentDraftGraphId(documentId), 'Recovered Draft Node');
});

test('reload restores graph data and viewState from localStorage without file import', async ({
	page
}) => {
	const graphId = `e2e-refresh-vs-${Date.now()}`;

	await page.goto('/');
	await page.evaluate(() => localStorage.clear());
	await page.goto(graphUrl(graphId));
	await expect(page.getByText('Root')).toBeVisible();

	await editFirstNodeTitle(page, 'Refresh Test Node');
	await waitForStoredTitle(page, graphId, 'Refresh Test Node');

	// Zoom with a wheel event to create a non-default viewState.
	await page.locator('.stage').dispatchEvent('wheel', { deltaY: -300 });
	await waitForStoredViewState(page, graphId, { scaleDifferentFrom: 1 });

	// Capture the saved viewState before reloading.
	const savedViewState = await page.evaluate((id) => {
		const item = localStorage.getItem(`mind-map:graph:${encodeURIComponent(id)}`);
		if (!item) return null;
		return (
			(JSON.parse(item) as { viewState?: { panX: number; panY: number; scale: number } })
				.viewState ?? null
		);
	}, graphId);
	if (!savedViewState) throw new Error('viewState was not saved to localStorage before reload');

	// Reload without any file import; localStorage is the only source of truth.
	await page.reload();
	await expect(page.getByText('Refresh Test Node')).toBeVisible();

	// Graph data should be restored from localStorage.
	const restoredPayload = await page.evaluate((id) => {
		const item = localStorage.getItem(`mind-map:graph:${encodeURIComponent(id)}`);
		return item ? JSON.parse(item) : null;
	}, graphId);
	expect(
		(restoredPayload?.data?.nodes as Array<{ title: string }> | undefined)?.some(
			(n) => n.title === 'Refresh Test Node'
		)
	).toBe(true);

	// viewState should also be restored from localStorage.
	expect(restoredPayload?.viewState).toMatchObject(savedViewState);

	// Stage transform should reflect the restored viewState.
	const transform = await page
		.locator('.stage-content')
		.evaluate((el) => (el as HTMLElement).style.transform);
	expect(transform).toContain(`scale(${savedViewState.scale})`);
});

async function editFirstNodeTitle(page: Page, title: string) {
	// .stage-content has pointer-events:none; all clicks pass to the stage handler.
	// The editor opens via long-press (>1000ms), then action menu, then Edit.
	// Dispatch synthetic pointer events directly on the stage at the first node's
	// screen coordinates so the stage's hit-test finds the node.
	const circle = page.locator('.node-wrapper .circle').first();
	const box = await circle.boundingBox();
	if (!box) throw new Error('Node .circle element not found');
	const cx = Math.round(box.x + box.width / 2);
	const cy = Math.round(box.y + box.height / 2);

	const stage = page.locator('.stage');
	await stage.dispatchEvent('pointerdown', {
		pointerId: 1,
		isPrimary: true,
		button: 0,
		buttons: 1,
		clientX: cx,
		clientY: cy,
		bubbles: true,
		cancelable: true
	});
	// LONG_PRESS_MS = 1000 ms; wait longer to ensure the long-press timer fires.
	await page.waitForTimeout(1300);
	await stage.dispatchEvent('pointerup', {
		pointerId: 1,
		isPrimary: true,
		button: 0,
		buttons: 0,
		clientX: cx,
		clientY: cy,
		bubbles: true,
		cancelable: true
	});

	// NodeActionMenu buttons have role="menuitem" (not "button").
	await page.getByRole('menuitem', { name: 'Edit' }).click();
	await expect(page.getByLabel('Title')).toBeVisible();
	await page.getByLabel('Title').fill(title);
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByText(title)).toBeVisible();
}

async function waitForStoredTitle(page: Page, graphId: string, title: string) {
	await page.waitForFunction(
		({ graphId, title }) => {
			const item = localStorage.getItem(`mind-map:graph:${encodeURIComponent(graphId)}`);
			if (!item) return false;
			const payload = JSON.parse(item) as { data?: { nodes?: Array<{ title?: string }> } };
			return payload.data?.nodes?.some((node) => node.title === title) ?? false;
		},
		{ graphId, title }
	);
}

async function waitForStoredViewState(
	page: Page,
	graphId: string,
	opts: { scaleDifferentFrom: number }
) {
	await page.waitForFunction(
		({ graphId, scaleDifferentFrom }) => {
			const item = localStorage.getItem(`mind-map:graph:${encodeURIComponent(graphId)}`);
			if (!item) return false;
			const payload = JSON.parse(item) as { viewState?: { scale?: number } };
			const scale = payload.viewState?.scale;
			return scale !== undefined && scale !== scaleDifferentFrom;
		},
		{ graphId, scaleDifferentFrom: opts.scaleDifferentFrom }
	);
}

function graphHtmlFile(payload: unknown): string {
	return `<!doctype html><html><body><script id="${GRAPH_HTML_PAYLOAD_SCRIPT_ID}" type="application/json">${JSON.stringify(
		payload,
		null,
		2
	).replaceAll('<', '\\u003c')}</script></body></html>`;
}

async function selfContainedGraphHtml(payload: unknown): Promise<string> {
	const shell = await readFile(join(process.cwd(), 'build', 'index.html'), 'utf-8');
	const payloadScript = graphHtmlFile(payload).match(
		new RegExp(`<script\\b[\\s\\S]*?<\\/script>`, 'i')
	)?.[0];
	if (!payloadScript) throw new Error('Expected graphHtmlFile to produce a payload script');
	const bootScriptIndex = shell.search(/<script\b(?![^>]*\btype=(["'])application\/json\1)[^>]*>/i);
	if (bootScriptIndex === -1) throw new Error('Self-contained shell is missing app script');
	return `${shell.slice(0, bootScriptIndex)}${payloadScript}\n${shell.slice(bootScriptIndex)}`;
}

function graphDocumentPayload({ documentId, title }: { documentId: string; title: string }) {
	return {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		data: {
			nodes: [{ id: 'n0', title, description: 'Embedded description', tags: [] }],
			edges: [],
			posByNodeId: { n0: { x: 0, y: 0 } },
			tagColorConfig: { nodeTags: {}, edgeTags: {} }
		},
		viewState: { panX: 0, panY: 0, scale: 1 },
		documentId,
		htmlDocumentVersion: 1,
		minReaderVersion: 1
	};
}

function extractGraphHtmlPayload(html: string): {
	schemaVersion: unknown;
	data: { nodes: Array<{ title: string }> };
	viewState: { panX: number; panY: number; scale: number };
} {
	const match = html.match(
		new RegExp(
			`<script\\b(?=[^>]*\\bid=(["'])${GRAPH_HTML_PAYLOAD_SCRIPT_ID}\\1)(?=[^>]*\\btype=(["'])application/json\\2)[^>]*>([\\s\\S]*?)<\\/script>`,
			'i'
		)
	);
	if (!match?.[3]) throw new Error('Embedded graph payload not found');
	return JSON.parse(match[3]) as {
		schemaVersion: unknown;
		data: { nodes: Array<{ title: string }> };
		viewState: { panX: number; panY: number; scale: number };
	};
}
