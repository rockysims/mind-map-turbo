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

function graphIdFromPageUrl(rawUrl: string): string | null {
	const url = new URL(rawUrl);
	const hashRoute = url.hash.startsWith('#/') ? new URL(url.hash.slice(1), url.origin) : null;
	return hashRoute?.searchParams.get('graph') ?? url.searchParams.get('graph');
}

test('home page renders the graph entrypoint', async ({ page }) => {
	await page.goto('/');

	await expect(page.getByText('Node 0')).toBeVisible();
});

test('persists edited nodes across reloads and graph switches', async ({ page }) => {
	const firstGraphId = `e2e-${Date.now()}`;

	await page.goto('/');
	await page.evaluate(() => localStorage.clear());
	await page.goto(graphUrl(firstGraphId));
	await expect(page.getByText('Node 0')).toBeVisible();

	await editFirstNodeTitle(page, 'Persisted Node');
	await waitForStoredTitle(page, firstGraphId, 'Persisted Node');

	await page.reload();
	await expect(page.getByText('Persisted Node')).toBeVisible();

	const storedPayload = await page.evaluate((graphId) => {
		const key = `mind-map:graph:${encodeURIComponent(graphId)}`;
		const item = localStorage.getItem(key);
		return item ? JSON.parse(item) : null;
	}, firstGraphId);
	expect(storedPayload).toMatchObject({ schemaVersion: CURRENT_SCHEMA_VERSION });

	await page.getByRole('button', { name: 'New graph' }).click();
	await expect(page).toHaveURL(/graph=graph-/);
	const secondGraphId = graphIdFromPageUrl(page.url());
	if (!secondGraphId) throw new Error('Expected New graph to route to a generated graph id');
	await expect(page.getByText('Node 0')).toBeVisible();

	await editFirstNodeTitle(page, 'Second Graph Node');
	await waitForStoredTitle(page, secondGraphId, 'Second Graph Node');

	await page.getByLabel('Load graph').selectOption(firstGraphId);
	await expect(page.getByText('Persisted Node')).toBeVisible();

	await page.getByLabel('Load graph').selectOption(secondGraphId ?? '');
	await expect(page.getByText('Second Graph Node')).toBeVisible();
});

test('deletes the selected graph without recreating it when another graph exists', async ({
	page
}) => {
	const firstGraphId = `delete-first-${Date.now()}`;
	const secondGraphId = `delete-second-${Date.now()}`;

	await page.goto('/');
	await page.evaluate(() => localStorage.clear());
	await page.goto(graphUrl(firstGraphId));
	await expect(page.getByText('Node 0')).toBeVisible();
	await editFirstNodeTitle(page, 'Remaining Graph');
	await waitForStoredTitle(page, firstGraphId, 'Remaining Graph');

	await page.goto(graphUrl(secondGraphId));
	await expect(page.getByText('Node 0')).toBeVisible();
	await editFirstNodeTitle(page, 'Deleted Graph');
	await waitForStoredTitle(page, secondGraphId, 'Deleted Graph');

	await page.getByRole('button', { name: 'Delete graph' }).click();

	await expect(page).toHaveURL(new RegExp(`graph=${firstGraphId}`));
	await expect(page.getByText('Remaining Graph')).toBeVisible();
	await expect(page.getByLabel('Load graph')).not.toContainText(secondGraphId);
	await expectStoredGraphMissing(page, secondGraphId);
});

test('exports HTML graph document containing schemaVersion, graph data, and viewState', async ({
	page
}) => {
	const graphId = `e2e-export-${Date.now()}`;

	await page.goto('/');
	await page.evaluate(() => localStorage.clear());
	await page.goto(graphUrl(graphId));
	await expect(page.getByText('Node 0')).toBeVisible();

	await editFirstNodeTitle(page, 'Exported Node');
	await waitForStoredTitle(page, graphId, 'Exported Node');

	// Dispatch a wheel event directly on the stage to trigger a zoom and produce
	// a non-default viewState before exporting.
	await page.locator('.stage').dispatchEvent('wheel', { deltaY: -300 });
	await waitForStoredViewState(page, graphId, { scaleDifferentFrom: 1 });

	// Capture the Export download.
	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Export' }).click();
	const download = await downloadPromise;
	const downloadedPath = await download.path();
	if (!downloadedPath) throw new Error('Export download did not produce a file');
	expect(download.suggestedFilename()).toBe(`${graphId}.html`);
	const html = await readFile(downloadedPath, 'utf-8');

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
});

test('imports graph document and restores graph data and viewState', async ({ page }) => {
	const graphId = `e2e-import-${Date.now()}`;
	const importedTitle = 'Imported Node Title';
	const knownViewState = { panX: 80, panY: 40, scale: 1.5 };
	const knownDoc = {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		data: {
			nodes: [{ id: 'n0', title: importedTitle, description: 'Imported description', tags: [] }],
			edges: [],
			posByNodeId: { n0: { x: 0, y: 0 } },
			tagColorConfig: { nodeTags: {}, edgeTags: {} }
		},
		viewState: knownViewState,
		documentId: `doc-${Date.now()}`,
		htmlDocumentVersion: 1,
		minReaderVersion: 1
	};
	const tmpFile = join(tmpdir(), `e2e-import-${Date.now()}.html`);
	await writeFile(tmpFile, graphHtmlFile(knownDoc));

	await page.goto('/');
	await page.evaluate(() => localStorage.clear());
	await page.goto(graphUrl(graphId));
	await expect(page.getByText('Node 0')).toBeVisible();

	// The default graph is unchanged, so no confirm dialog fires on import.
	await page.getByLabel('Import graph from file').setInputFiles(tmpFile);

	// Wait for the import success notice.
	await expect(page.getByRole('status')).toContainText(`Imported graph into "${graphId}"`);

	// Graph should now display the imported node title.
	await expect(page.getByText(importedTitle)).toBeVisible();

	// Verify viewState was persisted to localStorage.
	const storedPayload = await page.evaluate((id) => {
		const item = localStorage.getItem(`mind-map:graph:${encodeURIComponent(id)}`);
		return item
			? (JSON.parse(item) as { viewState?: { panX: number; panY: number; scale: number } })
			: null;
	}, graphId);
	expect(storedPayload?.viewState).toMatchObject(knownViewState);

	// Stage transform should reflect the imported viewState (graphGeneration bump remounts Stage).
	const transform = await page
		.locator('.stage-content')
		.evaluate((el) => (el as HTMLElement).style.transform);
	expect(transform).toContain(`scale(${knownViewState.scale})`);
});

test('imports legacy JSON graph documents', async ({ page }) => {
	const graphId = `e2e-json-import-${Date.now()}`;
	const importedTitle = 'Legacy JSON Import';
	const tmpFile = join(tmpdir(), `e2e-import-${Date.now()}.json`);
	await writeFile(
		tmpFile,
		JSON.stringify(
			{
				schemaVersion: 1,
				data: {
					nodes: [{ id: 'n0', title: importedTitle, description: 'Imported description' }],
					edges: [],
					posByNodeId: { n0: { x: 0, y: 0 } }
				},
				viewState: { panX: 0, panY: 0, scale: 1 }
			},
			null,
			2
		)
	);

	await page.goto('/');
	await page.evaluate(() => localStorage.clear());
	await page.goto(graphUrl(graphId));
	await expect(page.getByText('Node 0')).toBeVisible();

	await page.getByLabel('Import graph from file').setInputFiles(tmpFile);

	await expect(page.getByRole('status')).toContainText(`Imported graph into "${graphId}"`);
	await expect(page.getByText(importedTitle)).toBeVisible();
});

test('self-contained build artifact opens from disk without sibling app assets', async ({
	page
}) => {
	const requests: string[] = [];
	page.on('request', (request) => {
		requests.push(request.url());
	});

	await page.goto(pathToFileURL(join(process.cwd(), 'build', 'index.html')).href);

	await expect(page.getByText('Node 0')).toBeVisible();
	expect(requests.filter((url) => url.includes('/_app/'))).toEqual([]);
});

test('reload restores graph data and viewState from localStorage without file import', async ({
	page
}) => {
	const graphId = `e2e-refresh-vs-${Date.now()}`;

	await page.goto('/');
	await page.evaluate(() => localStorage.clear());
	await page.goto(graphUrl(graphId));
	await expect(page.getByText('Node 0')).toBeVisible();

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

async function expectStoredGraphMissing(page: Page, graphId: string) {
	await expect
		.poll(async () =>
			page.evaluate(
				(graphId) => localStorage.getItem(`mind-map:graph:${encodeURIComponent(graphId)}`),
				graphId
			)
		)
		.toBeNull();
}

function graphHtmlFile(payload: unknown): string {
	return `<!doctype html><html><body><script id="${GRAPH_HTML_PAYLOAD_SCRIPT_ID}" type="application/json">${JSON.stringify(
		payload,
		null,
		2
	).replaceAll('<', '\\u003c')}</script></body></html>`;
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
