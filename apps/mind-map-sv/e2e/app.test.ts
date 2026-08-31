import { readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { expect, test, type Page } from '@playwright/test';
import { APP_CONFIG } from '../src/lib/appConfig';
import { DEFAULT_ZOOM_SENSITIVITY } from '../src/lib/components/ui/Multigraph/lib/graphMath';
// Imported, never restated: a second copy of this number goes stale the next
// time the schema is bumped, and the tests that assert it are the ones that
// would have caught the bump. It last drifted at 45c4e86 (v5 -> v6).
import { CURRENT_SCHEMA_VERSION } from '../src/lib/migrations';
const GRAPH_HTML_PAYLOAD_SCRIPT_ID = 'mind-map-embedded-graph';

const { preInscribeZoneFraction, subFitExitZoneFraction } = APP_CONFIG.multigraph.focus;

// Headroom over the computed requirement: absorbs rounding and the odd event
// lost to animation timing without letting a budget become a magic number.
const SCRUB_BUDGET_SLACK = 1.5;
// Scale ratio a scrub may have to climb before the view locks onto the entry
// boundary. Geometry (node radius vs. viewport), not config, sets the real
// number; this is a generous bound for the graphs these tests seed.
const ENTRY_APPROACH_SCALE_RATIO = 8;
// Hard stop so a nonsensical zone fraction fails fast instead of looping.
const MAX_SCRUB_EVENTS = 200;

/**
 * Wheel events a focus-entry scrub may need: the climb up to the entry boundary
 * plus the events the pre-inscribe zone requires at it. Each event at the
 * boundary adds `(|deltaY| * sensitivity) / preInscribeZoneFraction` to
 * boundaryProgress (see `boundaryProgressDelta` in lib/focusEntryBoundary.ts),
 * which commits at 1 — one such event at deltaY -600 with the shipped 0.88.
 */
function entryScrubBudget(deltaY: number): number {
	const factor = 1 + Math.abs(deltaY) * DEFAULT_ZOOM_SENSITIVITY;
	const approachEvents = Math.ceil(Math.log(ENTRY_APPROACH_SCALE_RATIO) / Math.log(factor));
	const commitEvents = Math.ceil(preInscribeZoneFraction / (factor - 1));
	return Math.min(
		MAX_SCRUB_EVENTS,
		Math.ceil((approachEvents + commitEvents) * SCRUB_BUDGET_SLACK)
	);
}

/**
 * Wheel notches an exit scrub needs. Each wheel-out event past fit advances the
 * exit amount by `next = k / f + (1 - k) * a`, with `k = |deltaY| * sensitivity`
 * and `f = subFitExitZoneFraction` (see `wheelExitBoundaryAmount` in
 * lib/zoomWorldController.ts), so reaching 1 takes `ceil(ln(1 - f) / ln(1 - k))`
 * events — 21 notches at deltaY 30 with the shipped 0.72.
 */
function exitScrubBudget(deltaY: number): number {
	const k = Math.abs(deltaY) * DEFAULT_ZOOM_SENSITIVITY;
	// A single event overshooting the whole zone ends the scrub outright.
	const events = k >= 1 ? 1 : Math.ceil(Math.log(1 - subFitExitZoneFraction) / Math.log(1 - k));
	return Math.min(MAX_SCRUB_EVENTS, Math.max(1, Math.ceil(events * SCRUB_BUDGET_SLACK)));
}

function graphUrl(graphId: string): string {
	return `/#/?${new URLSearchParams({ graph: graphId }).toString()}`;
}

function documentDraftGraphId(documentId: string): string {
	return `document:${documentId}`;
}

// Focus entry crosses a wide scrub zone (preInscribeZoneFraction), so no
// single wheel event can complete it; scrub with repeated events like a
// real gesture until the graph reports focus-active.
async function scrubFocusEntry(
	page: Page,
	point: { x: number; y: number },
	{ deltaY = -600, maxEvents }: { deltaY?: number; maxEvents?: number } = {}
): Promise<void> {
	const budget = maxEvents ?? entryScrubBudget(deltaY);
	const stage = page.locator('.stage');
	const graph = page.locator('.graph');
	for (let i = 0; i < budget; i += 1) {
		if (((await graph.getAttribute('class')) ?? '').includes('focus-active')) return;
		await stage.dispatchEvent('wheel', {
			deltaY,
			clientX: point.x,
			clientY: point.y,
			bubbles: true,
			cancelable: true
		});
		await page.waitForTimeout(20);
	}
	if (((await graph.getAttribute('class')) ?? '').includes('focus-active')) return;
	throw new Error(
		`Focus entry did not commit after ${budget} wheel events of deltaY ${deltaY} at ` +
			`(${point.x}, ${point.y}) (preInscribeZoneFraction ${preInscribeZoneFraction})`
	);
}

test('home page renders the graph entrypoint', async ({ page }) => {
	await page.goto('/');

	await expect(page.locator('.title-input')).toHaveValue('Root');
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
	await expect(page.getByRole('status')).toContainText(
		'Draft cached in this browser. Save to keep it.'
	);

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
	await expect(page.getByRole('status')).toContainText(
		'Draft cached in this browser. Save to keep it.'
	);
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
	await waitForStageScale(page, { differentFrom: 1 });

	// Capture the saved file artifact.
	const downloadPromise = page.waitForEvent('download');
	await toolbarSaveButton(page).click();
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
	await expect(page.getByRole('status')).toHaveText(`Saved ${graphId}.html. Check your downloads.`);
});

test('downloaded HTML documents propagate a clean live shell to descendants', async ({ page }) => {
	const graphId = `e2e-descendant-${Date.now()}`;

	await page.goto('/');
	await page.evaluate(() => localStorage.clear());
	await page.goto(graphUrl(graphId));
	await expect(page.getByText('Root')).toBeVisible();

	await editFirstNodeTitle(page, 'Descendant Node');
	await waitForStoredTitle(page, graphId, 'Descendant Node');

	const firstDownload = await downloadHtml(page);
	expectCleanExportedHtml(firstDownload.html);
	const firstFile = join(tmpdir(), `e2e-first-download-${Date.now()}.html`);
	await writeFile(firstFile, firstDownload.html);

	await page.goto(pathToFileURL(firstFile).href);
	await expect(page.getByText('Descendant Node')).toBeVisible();

	const descendantDownload = await downloadHtml(page);
	expectCleanExportedHtml(descendantDownload.html);
	expect(extractGraphHtmlPayload(descendantDownload.html).data.nodes).toContainEqual(
		expect.objectContaining({ title: 'Descendant Node' })
	);

	const descendantFile = join(tmpdir(), `e2e-descendant-download-${Date.now()}.html`);
	await writeFile(descendantFile, descendantDownload.html);
	await page.goto(pathToFileURL(descendantFile).href);
	await expect(page.getByText('Descendant Node')).toBeVisible();

	await downloadHtml(page);

	const openPopupPromise = page.waitForEvent('popup');
	await page.getByRole('button', { name: 'Open' }).click();
	const openPopup = await openPopupPromise;
	await openPopup.waitForLoadState('domcontentloaded');
	await expect(openPopup.getByRole('button', { name: 'Choose graph file' })).toBeVisible();
	// The Open page names the app the reader is currently in, so they can tell
	// which of two .html files holds the newer app before picking one. Served
	// from the dev server here, which injects no build stamp.
	await expect(openPopup.locator('.app-version')).toHaveText(/^version /);
	await openPopup.close();

	const newPopupPromise = page.waitForEvent('popup');
	await page.getByRole('button', { name: 'New' }).click();
	const newPopup = await newPopupPromise;
	await newPopup.waitForLoadState('domcontentloaded');
	await expect(newPopup.locator('.title-input')).toHaveValue('Root');
	await newPopup.close();
});

test('a fixed document can open a broken document and download a clean replacement', async ({
	page
}) => {
	const fixedDocumentId = `doc-fixed-${Date.now()}`;
	const brokenDocumentId = `doc-broken-${Date.now()}`;
	const fixedFile = join(tmpdir(), `e2e-fixed-save-${Date.now()}.html`);
	const brokenFile = join(tmpdir(), `e2e-broken-save-${Date.now()}.html`);

	await writeFile(
		fixedFile,
		await selfContainedGraphHtml(
			graphDocumentPayload({ documentId: fixedDocumentId, title: 'Fixed Shell Node' })
		)
	);
	await writeFile(
		brokenFile,
		await brokenSelfContainedGraphHtml(
			graphDocumentPayload({ documentId: brokenDocumentId, title: 'Recovered Broken Node' })
		)
	);

	await page.goto(pathToFileURL(fixedFile).href);
	await expect(page.getByText('Fixed Shell Node')).toBeVisible();

	const popupPromise = page.waitForEvent('popup');
	await page.getByRole('button', { name: 'Open' }).click();
	const popup = await popupPromise;
	await popup.waitForLoadState('domcontentloaded');
	const fileChooserPromise = popup.waitForEvent('filechooser');
	await popup.getByRole('button', { name: 'Choose graph file' }).click();
	const fileChooser = await fileChooserPromise;
	await fileChooser.setFiles(brokenFile);
	await popup.waitForLoadState('domcontentloaded');

	await expect(popup.getByText('Recovered Broken Node')).toBeVisible();
	const replacementDownload = await downloadHtml(popup);
	expectCleanExportedHtml(replacementDownload.html);
	expect(extractGraphHtmlPayload(replacementDownload.html).data.nodes).toContainEqual(
		expect.objectContaining({ title: 'Recovered Broken Node' })
	);

	const replacementFile = join(tmpdir(), `e2e-recovered-save-${Date.now()}.html`);
	await writeFile(replacementFile, replacementDownload.html);
	await page.goto(pathToFileURL(replacementFile).href);
	await expect(page.getByText('Recovered Broken Node')).toBeVisible();
	await downloadHtml(page);
});

test('self-contained build artifact opens from disk without sibling app assets', async ({
	page
}) => {
	const requests: string[] = [];
	page.on('request', (request) => {
		requests.push(request.url());
	});

	await page.goto(pathToFileURL(join(process.cwd(), 'build', 'index.html')).href);

	await expect(page.locator('.title-input')).toHaveValue('Root');
	expect(requests.filter((url) => url.includes('/_app/'))).toEqual([]);
});

test('typeset math renders from a self-contained file opened from disk', async ({ page }) => {
	const documentId = `doc-math-${Date.now()}`;
	const tmpFile = join(tmpdir(), `e2e-offline-math-${Date.now()}.html`);
	const failedRequests: string[] = [];
	page.on('requestfailed', (request) => {
		failedRequests.push(request.url());
	});

	await writeFile(
		tmpFile,
		await selfContainedGraphHtml(
			graphDocumentPayload({
				documentId,
				title: 'Math Node',
				// \mathscr is deliberate: it is one of the few constructs that actually
				// uses Temml's bundled woff2, so this exercises the inlined font rather
				// than the OS math face that covers ordinary symbols.
				description: 'Constant acceleration gives $$v = v_0 + a t$$ for flux $\\mathscr{F}$.'
			})
		)
	);
	await page.goto(pathToFileURL(tmpFile).href);
	await expect(page.getByText('Math Node')).toBeVisible();

	const circle = page.locator('.node-wrapper .circle').first();
	const nodeBox = await circle.boundingBox();
	if (!nodeBox) throw new Error('Node .circle element not found');
	await scrubFocusEntry(page, {
		x: nodeBox.x + nodeBox.width / 2,
		y: nodeBox.y + nodeBox.height / 2
	});

	await expect(page.getByRole('dialog')).toBeVisible();
	await expect(page.locator('[data-segment="display-math"] math')).toHaveCount(1);
	await expect(page.locator('[data-segment="inline-math"] math')).toHaveCount(1);
	await expect(page.locator('math .mathscr')).toHaveCount(1);

	// The math font is inlined as a data URI; a fetch here would mean it escaped
	// the single-file build and would silently fall back for offline readers.
	expect(failedRequests).toEqual([]);
	expect(
		await page.evaluate(async () => {
			await document.fonts.ready;
			return document.fonts.check('16px Temml');
		})
	).toBe(true);
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
	await expect(page.getByRole('status')).toHaveText('Recovered cached edits. Save to keep them.');
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

test('still renders the graph when the browser blocks site data', async ({ page }) => {
	// Chrome's "Don't allow sites to save data" and Safari's "Block all cookies"
	// make the window.localStorage GETTER itself throw, which used to abort the
	// whole startup and leave a permanently blank "Loading graph..." page.
	await page.addInitScript(() => {
		Object.defineProperty(window, 'localStorage', {
			configurable: true,
			get() {
				throw new Error('Access is denied for this document.');
			}
		});
	});

	await page.goto('/');

	await expect(page.locator('.title-input')).toHaveValue('Root');
	const alert = page.getByRole('alert');
	await expect(alert).toHaveText('Caching is blocked here. Save to a file to keep it.');
	await expect(toolbarSaveButton(page)).toBeVisible();
});

test('single-document toolbar omits graph library controls', async ({ page }) => {
	await page.goto('/');

	await expect(page.getByRole('button', { name: 'New' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Open' })).toBeVisible();
	await expect(toolbarSaveButton(page)).toBeVisible();
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
	await expect(popup).not.toHaveURL(/^blob:/);
	await expect(popup.getByText('Loaded File Node')).toBeVisible();
	await expect(popup.getByText('Cached edits found')).not.toBeVisible();
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
	await expect(popup).not.toHaveURL(/^blob:/);
	await expect(popup.getByText('Cached edits found')).toBeVisible();
	await popup.getByRole('button', { name: 'Open selected file' }).click();

	await expect(popup.getByText('Fresh Loaded Node')).toBeVisible();
	await expect(popup.getByText('Stale Local Draft Node')).not.toBeVisible();
	await waitForStoredTitle(popup, documentDraftGraphId(documentId), 'Fresh Loaded Node');
});

test('load can recover cached edits instead of opening selected HTML file', async ({ page }) => {
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
	await expect(popup).not.toHaveURL(/^blob:/);
	await expect(popup.getByText('Cached edits found')).toBeVisible();
	await popup.getByRole('button', { name: 'Recover cached edits' }).click();

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

	// Zoom with a wheel event to create a non-default viewState. Zooming does not
	// write to the cache by itself; leaving the page is what flushes the camera.
	await page.locator('.stage').dispatchEvent('wheel', { deltaY: -300 });
	const zoomedScale = await waitForStageScale(page, { differentFrom: 1 });

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

	// The camera the user left with reached the cache on unload...
	const storedScale = (restoredPayload as { viewState?: { scale?: number } } | null)?.viewState
		?.scale;
	expect(storedScale).toBeCloseTo(zoomedScale, 5);

	// ...and the reloaded stage is rendering it. The rendered transform is
	// rounded for the style attribute, so compare numbers rather than strings.
	expect(await readStageScale(page)).toBeCloseTo(zoomedScale, 4);
});

test('deep zoom enters node focus and exits by wheel gestures', async ({ page }) => {
	const graphId = `e2e-deep-zoom-${Date.now()}`;
	const assetId = 'deep-zoom-image';
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480">
		<rect width="640" height="480" fill="#e0f2fe"/>
		<circle cx="220" cy="230" r="120" fill="#fb7185"/>
		<rect x="330" y="145" width="190" height="190" rx="26" fill="#22c55e"/>
	</svg>`;

	await page.goto('/');
	await page.evaluate(() => localStorage.clear());
	await seedImageGraph(page, {
		graphId,
		assetId,
		svg,
		title: 'Deep Zoom Image Node'
	});
	await page.goto(graphUrl(graphId));
	await expect(page.getByText('Deep Zoom Image Node')).toBeVisible();

	const circle = page.locator('.node-wrapper .circle').first();
	const nodeBox = await circle.boundingBox();
	if (!nodeBox) throw new Error('Node .circle element not found');
	const nodeCenter = {
		x: nodeBox.x + nodeBox.width / 2,
		y: nodeBox.y + nodeBox.height / 2
	};
	const stage = page.locator('.stage');
	await scrubFocusEntry(page, nodeCenter);

	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible();
	await expect(page.locator('.graph')).toHaveClass(/focus-active/);
	await expect(page.locator('.node-wrapper.focus-owned')).toHaveCount(1);

	const image = page.locator('.focus-image').first();
	await expect(image).toBeVisible();
	await expect(page.locator('.image-frame').first()).not.toHaveAttribute(
		'data-image-focused',
		'true'
	);
	await expect(image).not.toHaveAttribute('data-image-zoom-scale', /.+/);

	const imageBox = await image.boundingBox();
	if (!imageBox) throw new Error('Focused image did not have a bounding box');
	const imageCenter = {
		x: imageBox.x + imageBox.width / 2,
		y: imageBox.y + imageBox.height / 2
	};

	const world = page.locator('.zoom-world').first();
	const surface = page.locator('.focus-surface').first();
	const initialSurfaceWidth = await surface.evaluate((el) => el.getBoundingClientRect().width);

	await page.waitForTimeout(220);
	await world.dispatchEvent('wheel', {
		deltaY: -700,
		clientX: imageCenter.x,
		clientY: imageCenter.y,
		bubbles: true,
		cancelable: true
	});
	await expect(world).toHaveAttribute('data-zoom-world-scale', /^(?!1(?:\.0*)?$).+/);
	await expect
		.poll(async () => surface.evaluate((el) => el.getBoundingClientRect().width))
		.toBeGreaterThan(initialSurfaceWidth);

	const stageContent = page.locator('.stage-content');
	const stageTransformBeforeFocusExit = await stageContent.getAttribute('style');

	for (let attempt = 0; attempt < 12; attempt += 1) {
		if (!((await page.locator('.graph').getAttribute('class')) ?? '').includes('focus-active')) {
			break;
		}
		await world.dispatchEvent('wheel', {
			deltaY: 5000,
			clientX: imageCenter.x,
			clientY: imageCenter.y,
			bubbles: true,
			cancelable: true
		});
		await page.waitForTimeout(30);
	}
	await expect(page.locator('.graph')).not.toHaveClass(/focus-active/);

	await stage.dispatchEvent('wheel', {
		deltaY: 5000,
		clientX: imageCenter.x,
		clientY: imageCenter.y,
		bubbles: true,
		cancelable: true
	});
	await page.waitForTimeout(20);
	expect(await stageContent.getAttribute('style')).toBe(stageTransformBeforeFocusExit);

	// Past entryGestureIdleMs the gate must re-open: the same wheel now moves the
	// stage again (a permanently-armed gate would leave the transform frozen).
	await page.waitForTimeout(220);
	const stageTransformBeforeFreshWheel = await stageContent.getAttribute('style');
	await stage.dispatchEvent('wheel', {
		deltaY: 5000,
		clientX: imageCenter.x,
		clientY: imageCenter.y,
		bubbles: true,
		cancelable: true
	});
	await expect
		.poll(async () => stageContent.getAttribute('style'))
		.not.toBe(stageTransformBeforeFreshWheel);
	await expect(dialog).not.toBeVisible();
});

test('deep zoom nests a node image as a second level and pops back to the node', async ({
	page
}) => {
	const graphId = `e2e-nested-image-${Date.now()}`;
	const assetId = 'nested-zoom-image';
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480">
		<rect width="640" height="480" fill="#e0f2fe"/>
		<circle cx="220" cy="230" r="120" fill="#fb7185"/>
		<rect x="330" y="145" width="190" height="190" rx="26" fill="#22c55e"/>
	</svg>`;

	await page.goto('/');
	await page.evaluate(() => localStorage.clear());
	await seedImageGraph(page, { graphId, assetId, svg, title: 'Nested Image Node' });
	await page.goto(graphUrl(graphId));
	await expect(page.getByText('Nested Image Node')).toBeVisible();

	const circle = page.locator('.node-wrapper .circle').first();
	const nodeBox = await circle.boundingBox();
	if (!nodeBox) throw new Error('Node .circle element not found');
	const nodeCenter = { x: nodeBox.x + nodeBox.width / 2, y: nodeBox.y + nodeBox.height / 2 };
	await scrubFocusEntry(page, nodeCenter);

	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible();

	const image = page.locator('.focus-image').first();
	await expect(image).toBeVisible();
	const imageBox = await image.boundingBox();
	if (!imageBox) throw new Error('Focused image did not have a bounding box');
	const imageCenter = { x: imageBox.x + imageBox.width / 2, y: imageBox.y + imageBox.height / 2 };

	const stack = page.locator('.deep-zoom-stack');
	await expect(stack).toHaveAttribute('data-depth', '1');

	// Wait out the entry gesture gate, then zoom the node world in over the image.
	await page.waitForTimeout(220);
	const nodeWorld = page.locator('.zoom-world').first();
	await nodeWorld.dispatchEvent('wheel', {
		deltaY: -3000,
		clientX: imageCenter.x,
		clientY: imageCenter.y,
		bubbles: true,
		cancelable: true
	});
	await expect(nodeWorld).toHaveAttribute('data-zoom-world-scale', /^(?!1(?:\.0*)?$).+/);

	// Bold zoom-in past max, cursor over the image, scrubs the child entry
	// zone and descends to depth 2. deltaY -4000 requests far more than
	// maxScale * (1 + preInscribeZoneFraction), so descend pressure saturates on
	// the first event (see descendBoundaryDelta in lib/zoomWorldController.ts);
	// the second attempt only covers an event lost to the entry morph.
	for (let attempt = 0; attempt < 2; attempt += 1) {
		if ((await stack.getAttribute('data-depth')) === '2') break;
		await nodeWorld.dispatchEvent('wheel', {
			deltaY: -4000,
			clientX: imageCenter.x,
			clientY: imageCenter.y,
			bubbles: true,
			cancelable: true
		});
		await page.waitForTimeout(30);
	}
	await expect(stack).toHaveAttribute('data-depth', '2');
	await expect(page.locator('[data-subject-kind="image"]')).toBeVisible();
	await expect(page.locator('.focus-image-full')).toBeVisible();
	await expect(page.getByRole('dialog')).toHaveAttribute('data-focus-depth', '2');

	// Let the entry morph settle so the nested image world mounts, then zoom in
	// and pan it to prove it is its own interactive zoom level.
	await page.waitForTimeout(700);
	const imageWorld = page.locator('.zoom-world').first();
	await imageWorld.dispatchEvent('wheel', {
		deltaY: -2000,
		clientX: imageCenter.x,
		clientY: imageCenter.y,
		bubbles: true,
		cancelable: true
	});
	await expect(imageWorld).toHaveAttribute('data-zoom-world-scale', /^(?!1(?:\.0*)?$).+/);
	const panBefore = await imageWorld.getAttribute('data-zoom-world-pan-x');
	await imageWorld.dispatchEvent('pointerdown', {
		pointerId: 1,
		isPrimary: true,
		button: 0,
		buttons: 1,
		clientX: imageCenter.x,
		clientY: imageCenter.y,
		bubbles: true,
		cancelable: true
	});
	await imageWorld.dispatchEvent('pointermove', {
		pointerId: 1,
		isPrimary: true,
		buttons: 1,
		clientX: imageCenter.x - 80,
		clientY: imageCenter.y,
		bubbles: true,
		cancelable: true
	});
	await imageWorld.dispatchEvent('pointerup', {
		pointerId: 1,
		isPrimary: true,
		button: 0,
		buttons: 0,
		clientX: imageCenter.x - 80,
		clientY: imageCenter.y,
		bubbles: true,
		cancelable: true
	});
	await expect
		.poll(async () => imageWorld.getAttribute('data-zoom-world-pan-x'))
		.not.toBe(panBefore);

	// Zoom out past fit in the image world POPS back to the node (depth 1) — it
	// does not close focus.
	for (let attempt = 0; attempt < 12; attempt += 1) {
		if ((await stack.getAttribute('data-depth')) === '1') break;
		await imageWorld.dispatchEvent('wheel', {
			deltaY: 8000,
			clientX: imageCenter.x,
			clientY: imageCenter.y,
			bubbles: true,
			cancelable: true
		});
		await page.waitForTimeout(120);
	}
	await expect(stack).toHaveAttribute('data-depth', '1');
	await expect(dialog).toBeVisible();
	await expect(page.getByRole('dialog')).toHaveAttribute('data-focus-depth', '1');
});

test('deep zoom entry keeps driving focus after boundary steering slides the node off-cursor', async ({
	page
}) => {
	const graphId = `e2e-entry-steering-${Date.now()}`;
	await page.goto('/');
	await page.evaluate(() => localStorage.clear());
	await page.goto(graphUrl(graphId));
	await expect(page.getByText('Root')).toBeVisible();

	// Drag the node off-center (toward the bottom-right) so that boundary
	// steering must translate the view to center it — which slides the node
	// out from under the cursor mid-scrub.
	await page.mouse.move(640, 360);
	await page.mouse.down();
	await page.mouse.move(940, 520, { steps: 8 });
	await page.mouse.up();
	await page.waitForTimeout(100);

	const circle = page.locator('.node-wrapper .circle').first();
	const box = await circle.boundingBox();
	if (!box) throw new Error('Node .circle element not found');
	await page.mouse.move(Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2));

	// Fine trackpad-like wheel steps: the entry boundary is crossed gradually,
	// so the morph surface is mounted mid-scrub UNDER THE CURSOR for several
	// events. Those wheels must keep falling through to the stage (the surface
	// content must not swallow them) for the scrub to reach commit.
	const graph = page.locator('.graph');
	for (let i = 0; i < entryScrubBudget(-40); i += 1) {
		if (((await graph.getAttribute('class')) ?? '').includes('focus-active')) break;
		await page.mouse.wheel(0, -40);
		await page.waitForTimeout(20);
	}
	await expect(graph).toHaveClass(/focus-active/);
	await expect(page.getByRole('dialog')).toBeVisible();

	// Continued wheel-in past the entry gate must deepen the focused world.
	await page.waitForTimeout(500);
	const world = page.locator('.zoom-world').first();
	await page.mouse.wheel(0, -400);
	await expect(world).toHaveAttribute('data-zoom-world-scale', /^(?!1(?:\.0*)?$).+/);
});

test('deep zoom exit keeps scrubbing when the cursor leaves the shrinking frame', async ({
	page
}) => {
	const graphId = `e2e-exit-scrub-${Date.now()}`;
	await page.goto('/');
	await page.evaluate(() => localStorage.clear());
	await page.goto(graphUrl(graphId));
	await expect(page.getByText('Root')).toBeVisible();

	// Enter focus by scrubbing wheel-in over the centered node.
	await page.mouse.move(640, 360);
	const graph = page.locator('.graph');
	for (let i = 0; i < entryScrubBudget(-600); i += 1) {
		if (((await graph.getAttribute('class')) ?? '').includes('focus-active')) break;
		await page.mouse.wheel(0, -600);
		await page.waitForTimeout(20);
	}
	await expect(graph).toHaveClass(/focus-active/);

	// Begin a partial exit over the frame, past the entry gesture gate.
	await page.waitForTimeout(500);
	await page.mouse.wheel(0, 30);
	await expect(page.locator('.focus-root')).toHaveAttribute('data-exit-scrub', 'true');

	// The frame is shrinking; move the cursor to a corner it no longer covers.
	// Continued wheel-out must keep driving the exit rather than being lost to
	// the stage or the page.
	await page.mouse.move(5, 5);
	for (let i = 0; i < exitScrubBudget(30); i += 1) {
		if (!((await graph.getAttribute('class')) ?? '').includes('focus-active')) break;
		await page.mouse.wheel(0, 30);
		await page.waitForTimeout(30);
	}
	await expect(graph).not.toHaveClass(/focus-active/);
	await expect(page.getByRole('dialog')).not.toBeVisible();
});

async function editFirstNodeTitle(page: Page, title: string) {
	// .stage-content has pointer-events:none; all clicks pass to the stage handler.
	// The editor opens via right-click (contextmenu), then action menu, then Edit.
	// A real right-click at the first node's screen coordinates fires the native
	// contextmenu event on the stage, whose hit-test finds the node.
	const circle = page.locator('.node-wrapper .circle').first();
	const box = await circle.boundingBox();
	if (!box) throw new Error('Node .circle element not found');
	const cx = Math.round(box.x + box.width / 2);
	const cy = Math.round(box.y + box.height / 2);

	await page.mouse.click(cx, cy, { button: 'right' });

	// NodeActionMenu buttons have role="menuitem" (not "button").
	await page.getByRole('menuitem', { name: 'Edit' }).click();
	await expect(page.getByLabel('Title')).toBeVisible();
	await page.getByLabel('Title').fill(title);
	await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
	await expect(page.getByText(title)).toBeVisible();
}

async function seedImageGraph(
	page: Page,
	{
		graphId,
		assetId,
		svg,
		title
	}: {
		graphId: string;
		assetId: string;
		svg: string;
		title: string;
	}
) {
	await page.evaluate(
		async ({ graphId, assetId, svg, title, schemaVersion }) => {
			localStorage.setItem(
				`mind-map:graph:${encodeURIComponent(graphId)}`,
				JSON.stringify({
					schemaVersion,
					data: {
						nodes: [
							{
								id: 'image-node',
								title,
								description: 'Deep zoom e2e image node',
								tags: [],
								pinned: true,
								content: [
									{
										type: 'image',
										assetId,
										alt: 'Color blocks',
										caption: 'Deep zoom test image'
									}
								]
							}
						],
						edges: [],
						posByNodeId: { 'image-node': { x: 0, y: 0 } },
						tagColorConfig: { nodeTags: {}, edgeTags: {} },
						assets: {
							[assetId]: {
								id: assetId,
								kind: 'image',
								mimeType: 'image/svg+xml',
								name: 'deep-zoom.svg',
								size: svg.length,
								createdAt: Date.now()
							}
						}
					},
					viewState: { panX: 0, panY: 0, scale: 1 },
					updatedAt: Date.now()
				})
			);
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open('mind-map-assets', 1);
				request.onupgradeneeded = () => {
					const db = request.result;
					const store = db.objectStoreNames.contains('assets')
						? request.transaction?.objectStore('assets')
						: db.createObjectStore('assets', { keyPath: 'key' });
					if (store && !store.indexNames.contains('scope')) {
						store.createIndex('scope', 'scope', { unique: false });
					}
				};
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction('assets', 'readwrite');
				tx.objectStore('assets').put({
					key: `${encodeURIComponent(graphId)}:${encodeURIComponent(assetId)}`,
					scope: graphId,
					assetId,
					blob: new Blob([svg], { type: 'image/svg+xml' }),
					mimeType: 'image/svg+xml',
					name: 'deep-zoom.svg',
					size: svg.length,
					updatedAt: Date.now()
				});
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});
			db.close();
		},
		{ graphId, assetId, svg, title, schemaVersion: CURRENT_SCHEMA_VERSION }
	);
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

/**
 * The live camera scale off the stage transform. Panning and zooming are not
 * document edits, so they no longer write to the cache on their own: the DOM,
 * not localStorage, is where a fresh camera shows up first.
 */
async function readStageScale(page: Page): Promise<number> {
	const transform = await page
		.locator('.stage-content')
		.evaluate((el) => (el as HTMLElement).style.transform);
	const scale = Number(/scale\(([-0-9.e]+)\)/.exec(transform)?.[1]);
	if (!Number.isFinite(scale)) throw new Error(`No scale in stage transform: "${transform}"`);
	return scale;
}

async function waitForStageScale(page: Page, opts: { differentFrom: number }): Promise<number> {
	await expect.poll(async () => readStageScale(page)).not.toBeCloseTo(opts.differentFrom, 5);
	return readStageScale(page);
}

/** The toolbar's Save writes the file; the node edit sheet has a Save of its own. */
function toolbarSaveButton(page: Page) {
	return page.getByLabel('Graph persistence controls').getByRole('button', { name: 'Save' });
}

async function downloadHtml(page: Page): Promise<{ html: string; suggestedFilename: string }> {
	const downloadPromise = page.waitForEvent('download');
	await toolbarSaveButton(page).click();
	const download = await downloadPromise;
	const downloadedPath = await download.path();
	if (!downloadedPath) throw new Error('Download did not produce a file');
	return {
		html: await readFile(downloadedPath, 'utf-8'),
		suggestedFilename: download.suggestedFilename()
	};
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

async function brokenSelfContainedGraphHtml(payload: unknown): Promise<string> {
	const html = await selfContainedGraphHtml(payload);
	const scriptEnd = html.toLowerCase().lastIndexOf('</script>');
	if (scriptEnd === -1) throw new Error('Expected a boot script before </body>');
	const insertAt = scriptEnd + '</script>'.length;
	return `${html.slice(0, insertAt)}
<!----><div class="page-shell"><div class="graph-toolbar"><button type="button">New</button><button type="button">Open</button><button type="button">Save</button></div><div class="graph">stale rendered graph</div></div><div id="svelte-announcer" aria-live="assertive"></div>
${html.slice(insertAt)}`;
}

function graphDocumentPayload({
	documentId,
	title,
	description = 'Embedded description'
}: {
	documentId: string;
	title: string;
	description?: string;
}) {
	return {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		data: {
			nodes: [{ id: 'n0', title, description, tags: [] }],
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

function expectCleanExportedHtml(html: string) {
	expect(html.match(new RegExp(`id="${GRAPH_HTML_PAYLOAD_SCRIPT_ID}"`, 'g')) ?? []).toHaveLength(1);
	const markup = htmlWithoutScriptsAndStyles(html);
	expect(markup).not.toContain('<div class="page-shell"');
	expect(markup).not.toContain('<div class="graph-toolbar"');
	expect(markup).not.toContain('<div class="graph"');
	expect(markup).not.toContain('id="svelte-announcer"');
	expect(markup).not.toContain('<!----><div');
	expect(html).not.toMatch(/<script\b(?=[^>]*\btype=(["'])module\1)(?=[^>]*\bsrc=)/i);
	expect(html).not.toContain('/@fs/');
}

function htmlWithoutScriptsAndStyles(html: string): string {
	return html
		.replace(/<script\b[\s\S]*?<\/script>/gi, '')
		.replace(/<style\b[\s\S]*?<\/style>/gi, '');
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
