import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import type { StorybookConfig } from '@storybook/sveltekit';

const config: StorybookConfig = {
	stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|ts|svelte)'],
	addons: [
		getAbsolutePath('@storybook/addon-svelte-csf'),
		getAbsolutePath('@chromatic-com/storybook'),
		getAbsolutePath('@storybook/addon-vitest'),
		getAbsolutePath('@storybook/addon-a11y'),
		getAbsolutePath('@storybook/addon-docs'),
		getAbsolutePath('@storybook/addon-viewport')
	],
	framework: getAbsolutePath('@storybook/sveltekit')
};
export default config;

function getAbsolutePath(value: string): string {
	return dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)));
}
