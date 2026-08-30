import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import type { StorybookConfig } from '@storybook/sveltekit';

const config: StorybookConfig = {
	// No `*.mdx` glob: there are no docs pages in this project, and listing the
	// pattern made Storybook warn "No story files found" on every test run.
	stories: ['../src/**/*.stories.@(js|ts|svelte)'],
	addons: [
		getAbsolutePath('@storybook/addon-svelte-csf'),
		getAbsolutePath('@chromatic-com/storybook'),
		getAbsolutePath('@storybook/addon-vitest'),
		getAbsolutePath('@storybook/addon-a11y'),
		getAbsolutePath('@storybook/addon-docs'),
		'storybook/viewport'
	],
	framework: getAbsolutePath('@storybook/sveltekit')
};
export default config;

function getAbsolutePath(value: string): string {
	return dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)));
}
