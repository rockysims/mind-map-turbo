import { expect, test, type Page } from '@playwright/test';

test('home page renders the graph entrypoint', async ({ page }) => {
	await page.goto('/');

	await expect(page.getByText('Node 0')).toBeVisible();
});

test('persists edited nodes across reloads and graph switches', async ({ page }) => {
	const firstGraphId = `e2e-${Date.now()}`;

	await page.goto('/');
	await page.evaluate(() => localStorage.clear());
	await page.goto(`/?graph=${firstGraphId}`);
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
	expect(storedPayload).toMatchObject({ schemaVersion: 1 });

	await page.getByRole('button', { name: 'New graph' }).click();
	await expect(page).toHaveURL(/graph=graph-/);
	const secondGraphId = new URL(page.url()).searchParams.get('graph');
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
	await page.goto(`/?graph=${firstGraphId}`);
	await expect(page.getByText('Node 0')).toBeVisible();
	await editFirstNodeTitle(page, 'Remaining Graph');
	await waitForStoredTitle(page, firstGraphId, 'Remaining Graph');

	await page.goto(`/?graph=${secondGraphId}`);
	await expect(page.getByText('Node 0')).toBeVisible();
	await editFirstNodeTitle(page, 'Deleted Graph');
	await waitForStoredTitle(page, secondGraphId, 'Deleted Graph');

	await page.getByRole('button', { name: 'Delete graph' }).click();

	await expect(page).toHaveURL(new RegExp(`graph=${firstGraphId}`));
	await expect(page.getByText('Remaining Graph')).toBeVisible();
	await expect(page.getByLabel('Load graph')).not.toContainText(secondGraphId);
	await expectStoredGraphMissing(page, secondGraphId);
});

async function editFirstNodeTitle(page: Page, title: string) {
	await page.getByText(/Node 0|Persisted Node/).click();
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
