import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { sveltekit } from '@sveltejs/kit/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
const dirname =
	typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
	plugins: [sveltekit()],
	build: {
		// Temml's 9.4 KB woff2 must exceed the 4 KB default to be inlined, because
		// the offline build inlines stylesheet text but deletes sibling asset files.
		assetsInlineLimit: 16384
	},
	server: {
		fs: {
			// `dirname` (computed above), not the bare `__dirname` this used to read:
			// the guarded constant exists precisely because `__dirname` is not
			// defined when this config is loaded as ESM, and using both left one of
			// the two paths depending on how Vite happened to transpile the file.
			allow: [path.resolve(dirname, '..'), path.resolve(dirname, '../../node_modules/.pnpm')]
		}
	},
	test: {
		expect: {
			requireAssertions: true
		},
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [
							{
								browser: 'chromium',
								headless: true
							}
						]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			},
			{
				extends: true,
				plugins: [
					// The plugin will run tests for the stories defined in your Storybook config
					// See options at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon#storybooktest
					storybookTest({
						configDir: path.join(dirname, '.storybook')
					})
				],
				test: {
					name: 'storybook',
					browser: {
						enabled: true,
						headless: true,
						provider: playwright({}),
						instances: [
							{
								browser: 'chromium'
							}
						]
					},
					// Kept despite the "you can safely remove this" notice the addon
					// prints on every run: the automatic provisioning it describes
					// landed in Storybook 10.3, and dropping the file against the
					// version pinned here loses `preview.ts` — which imports the global
					// stylesheet — and fails every story test.
					setupFiles: ['.storybook/vitest.setup.ts']
				}
			}
		]
	}
});
