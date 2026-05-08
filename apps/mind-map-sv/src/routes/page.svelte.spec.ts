import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';

// Minimal stand-in for SvelteKit's PageData so we can render the page in
// isolation. The page reads `data.appName`; everything else is unused here.
const data = { appName: 'test' } as unknown as Parameters<typeof Page>[0]['data'];

describe('/+page.svelte', () => {
	it('should render h1', async () => {
		render(Page, { data });

		const heading = page.getByRole('heading', { level: 1 });
		await expect.element(heading).toBeInTheDocument();
	});
});
