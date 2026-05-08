/**
 * lint-staged config for this monorepo.
 *
 * Files inside `apps/mind-map-sv/` are formatted/linted by that package's
 * own prettier + eslint installs (so the per-app config — .prettierrc,
 * .prettierignore, eslint.config.js — is the source of truth). We strip
 * the path prefix and invoke through `pnpm --filter` because pnpm exec
 * sets cwd to the filtered package.
 *
 * Files outside the app (docs/, repo-root markdown) use the root-level
 * prettier install with default settings.
 */

const APP = 'apps/mind-map-sv';

const stripAppPrefix = (files) =>
	files.map((f) => f.replace(new RegExp(`^.*${APP}/`), '')).join(' ');

export default {
	// App: prettier on every formattable file type
	[`${APP}/**/*.{ts,svelte,js,mjs,cjs,json,jsonc,md,yml,yaml,html,css,scss,svg}`]: (
		files
	) => `pnpm --filter mind-map-sv exec prettier --write ${stripAppPrefix(files)}`,

	// App: eslint on lintable file types only
	[`${APP}/**/*.{ts,svelte,js,mjs,cjs}`]: (files) =>
		`pnpm --filter mind-map-sv exec eslint --fix ${stripAppPrefix(files)}`,

	// Root + docs: prettier with root install (markdown only for now —
	// .cursor/rules/*.mdc has a custom format prettier doesn't parse)
	'(docs/**/*.md|*.md|AGENTS.md)': 'prettier --write'
};
