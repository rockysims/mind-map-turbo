import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';
import type { PageProps } from './$types';

// Minimal stand-in for SvelteKit's PageProps so we can render the page in
// isolation. The page reads `data.appName`; everything else is unused here.
const props: PageProps = {
	data: { appName: 'test' },
	params: {},
	form: null
};

describe('/+page.svelte', () => {
	it('should render h1', async () => {
		render(Page, props);

		const heading = page.getByRole('heading', { level: 1 });
		await expect.element(heading).toBeInTheDocument();
	});
});
