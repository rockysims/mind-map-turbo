import { expect, test } from '@playwright/test';

test('home page renders the graph entrypoint', async ({ page }) => {
	await page.goto('/');

	await expect(page.getByText('Node 0')).toBeVisible();
});
