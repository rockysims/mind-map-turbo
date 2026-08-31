import { readFile } from 'fs/promises';
import { expect, test, type Page } from '@playwright/test';

const GRAPH_HTML_PAYLOAD_SCRIPT_ID = 'mind-map-embedded-graph';
const SCALE_FALLOFF_PATH = 'multigraph.layout.scaleFalloff';
const COMMITTED_SCALE_FALLOFF = 0.35;
const GRAPH_STORAGE_NAMESPACE = 'mind-map';
const CURRENT_SCHEMA_VERSION = 6;

function graphUrl(graphId: string): string {
	return `/#/?${new URLSearchParams({ graph: graphId }).toString()}`;
}

function graphUrlWithResetSettings(graphId: string): string {
	return `/#/?${new URLSearchParams({ graph: graphId, resetSettings: '1' }).toString()}`;
}

function graphStorageKey(graphId: string): string {
	return `${GRAPH_STORAGE_NAMESPACE}:graph:${encodeURIComponent(graphId)}`;
}

/**
 * Seeds a graph directly in `localStorage`, bypassing the app entirely, so a
 * hostile settings combination can be in place *before* the first load rather
 * than reached by dragging a slider. Mirrors `createDefaultGraph` in
 * `src/lib/defaultGraph.ts` for the graph shape.
 */
async function seedGraphWithSettings(
	page: Page,
	graphId: string,
	settings: Record<string, unknown>
): Promise<void> {
	await page.evaluate(
		({ key, settings, schemaVersion }) => {
			const record = {
				schemaVersion,
				data: {
					nodes: [
						{
							id: 'n0',
							title: 'Root',
							description: '',
							tags: [],
							pinned: true,
							content: []
						}
					],
					edges: [],
					posByNodeId: { n0: { x: 0, y: 0 } },
					tagColorConfig: { nodeTags: {}, edgeTags: {} },
					assets: {}
				},
				settings,
				viewState: { panX: 0, panY: 0, scale: 1 },
				updatedAt: Date.now()
			};
			localStorage.setItem(key, JSON.stringify(record));
		},
		{ key: graphStorageKey(graphId), settings, schemaVersion: CURRENT_SCHEMA_VERSION }
	);
}

async function readStoredSettings(
	page: Page,
	graphId: string
): Promise<Record<string, unknown> | undefined> {
	return page.evaluate((key) => {
		const item = localStorage.getItem(key);
		if (!item) return undefined;
		const payload = JSON.parse(item) as { settings?: Record<string, unknown> };
		return payload.settings;
	}, graphStorageKey(graphId));
}

/**
 * Commits a value through the settings panel's paired numeric box, the same
 * path a keyboard-only user takes: typing a number and pressing Enter, rather
 * than dragging the slider. `SettingRange.commitNumber` fires `onCommit`
 * immediately, with no intervening preview.
 */
async function commitScaleFalloffViaNumberBox(page: Page, value: number): Promise<void> {
	await page.getByRole('button', { name: 'Settings' }).click();
	const numberBox = page.getByRole('spinbutton', { name: 'Scale falloff per hop value' });
	await expect(numberBox).toBeVisible();
	await numberBox.fill(String(value));
	await numberBox.press('Enter');
}

async function waitForStoredSettings(
	page: Page,
	graphId: string,
	expected: Record<string, unknown>
): Promise<void> {
	await page.waitForFunction(
		({ graphId, expected }) => {
			const item = localStorage.getItem(`mind-map:graph:${encodeURIComponent(graphId)}`);
			if (!item) return false;
			const payload = JSON.parse(item) as { settings?: Record<string, unknown> };
			if (!payload.settings) return false;
			return Object.entries(expected).every(([key, val]) => payload.settings?.[key] === val);
		},
		{ graphId, expected }
	);
}

function extractGraphHtmlPayload(html: string): {
	schemaVersion: unknown;
	data: { nodes: Array<{ title: string }> };
	viewState: { panX: number; panY: number; scale: number };
	settings?: Record<string, unknown>;
} {
	const match = html.match(
		new RegExp(
			`<script\\b(?=[^>]*\\bid=(["'])${GRAPH_HTML_PAYLOAD_SCRIPT_ID}\\1)(?=[^>]*\\btype=(["'])application/json\\2)[^>]*>([\\s\\S]*?)<\\/script>`,
			'i'
		)
	);
	if (!match?.[3]) throw new Error('Embedded graph payload not found');
	return JSON.parse(match[3]);
}

async function downloadHtml(page: Page): Promise<string> {
	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Save' }).click();
	const download = await downloadPromise;
	const downloadedPath = await download.path();
	if (!downloadedPath) throw new Error('Download did not produce a file');
	return readFile(downloadedPath, 'utf-8');
}

test('a settings change committed through the panel survives a reload', async ({ page }) => {
	const graphId = `e2e-settings-reload-${Date.now()}`;

	await page.goto('/');
	await page.evaluate(() => localStorage.clear());
	await page.goto(graphUrl(graphId));
	await expect(page.getByText('Root')).toBeVisible();

	await commitScaleFalloffViaNumberBox(page, COMMITTED_SCALE_FALLOFF);
	await waitForStoredSettings(page, graphId, { [SCALE_FALLOFF_PATH]: COMMITTED_SCALE_FALLOFF });

	// Confirm the panel actually reflects the committed value before reloading,
	// so a failure after reload can only be about persistence, not the commit.
	const numberBoxBeforeReload = page.getByRole('spinbutton', {
		name: 'Scale falloff per hop value'
	});
	await expect(numberBoxBeforeReload).toHaveValue(String(COMMITTED_SCALE_FALLOFF));

	await page.reload();
	await expect(page.getByText('Root')).toBeVisible();

	await page.getByRole('button', { name: 'Settings' }).click();
	const numberBoxAfterReload = page.getByRole('spinbutton', {
		name: 'Scale falloff per hop value'
	});
	await expect(numberBoxAfterReload).toHaveValue(String(COMMITTED_SCALE_FALLOFF));

	const storedPayload = await page.evaluate((id) => {
		const item = localStorage.getItem(`mind-map:graph:${encodeURIComponent(id)}`);
		return item ? JSON.parse(item) : null;
	}, graphId);
	expect(storedPayload).toMatchObject({
		settings: { [SCALE_FALLOFF_PATH]: COMMITTED_SCALE_FALLOFF }
	});
});

test('a committed settings change rides along in the exported HTML file', async ({ page }) => {
	const graphId = `e2e-settings-export-${Date.now()}`;

	await page.goto('/');
	await page.evaluate(() => localStorage.clear());
	await page.goto(graphUrl(graphId));
	await expect(page.getByText('Root')).toBeVisible();

	await commitScaleFalloffViaNumberBox(page, COMMITTED_SCALE_FALLOFF);
	await waitForStoredSettings(page, graphId, { [SCALE_FALLOFF_PATH]: COMMITTED_SCALE_FALLOFF });

	// The panel is left open deliberately: its "Close" button sits under the
	// fixed, higher-z-index `GraphToolbar` at this viewport size (a pre-existing
	// overlap shared with `GraphQueryPanel`, unrelated to settings), so a real
	// pointer cannot reach it here. Downloading does not require the panel to be
	// closed, so the export step below does not depend on it.
	const html = await downloadHtml(page);
	const doc = extractGraphHtmlPayload(html);
	expect(doc.settings).toMatchObject({ [SCALE_FALLOFF_PATH]: COMMITTED_SCALE_FALLOFF });
});

const HOSTILE_SETTINGS = {
	'multigraph.layout.minScale': 0.001,
	'multigraph.layout.displayedLayers': 0
};

test("?resetSettings=1 clears a hostile graph's overrides and the app recovers", async ({
	page
}) => {
	const graphId = `e2e-reset-settings-${Date.now()}`;
	const otherGraphId = `e2e-reset-settings-other-${Date.now()}`;

	await page.goto('/');
	await page.evaluate(() => localStorage.clear());
	await seedGraphWithSettings(page, graphId, HOSTILE_SETTINGS);
	// A second, unrelated graph with its own overrides: the param must reach
	// only the graph it loads.
	await seedGraphWithSettings(page, otherGraphId, HOSTILE_SETTINGS);

	await page.goto(graphUrlWithResetSettings(graphId));
	await expect(page.getByText('Root')).toBeVisible();

	await expect.poll(() => readStoredSettings(page, graphId)).toBeUndefined();
	// The flag strips itself from the URL rather than surviving a later reload —
	// polled, not asserted once, because the strip deliberately waits out the save
	// debounce (see `applyResetSettingsFromUrlIfRequested`) and the clear above can
	// land first.
	await expect.poll(() => page.url()).not.toContain('resetSettings');
	// The other graph's overrides are untouched.
	await expect(readStoredSettings(page, otherGraphId)).resolves.toEqual(HOSTILE_SETTINGS);
});

test("loading without ?resetSettings=1 leaves a graph's overrides intact", async ({ page }) => {
	const graphId = `e2e-keep-settings-${Date.now()}`;

	await page.goto('/');
	await page.evaluate(() => localStorage.clear());
	await seedGraphWithSettings(page, graphId, HOSTILE_SETTINGS);

	await page.goto(graphUrl(graphId));
	await expect(page.getByText('Root')).toBeVisible();

	await expect.poll(() => readStoredSettings(page, graphId)).toEqual(HOSTILE_SETTINGS);
});
