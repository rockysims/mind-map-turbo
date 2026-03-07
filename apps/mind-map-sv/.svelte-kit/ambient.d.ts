
// this file is generated — do not edit it


/// <reference types="@sveltejs/kit" />

/**
 * Environment variables [loaded by Vite](https://vitejs.dev/guide/env-and-mode.html#env-files) from `.env` files and `process.env`. Like [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private), this module cannot be imported into client-side code. This module only includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://svelte.dev/docs/kit/configuration#env) (if configured).
 * 
 * _Unlike_ [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private), the values exported from this module are statically injected into your bundle at build time, enabling optimisations like dead code elimination.
 * 
 * ```ts
 * import { API_KEY } from '$env/static/private';
 * ```
 * 
 * Note that all environment variables referenced in your code should be declared (for example in an `.env` file), even if they don't have a value until the app is deployed:
 * 
 * ```
 * MY_FEATURE_FLAG=""
 * ```
 * 
 * You can override `.env` values from the command line like so:
 * 
 * ```sh
 * MY_FEATURE_FLAG="enabled" npm run dev
 * ```
 */
declare module '$env/static/private' {
	export const NVM_INC: string;
	export const npm_package_devDependencies__tailwindcss_typography: string;
	export const npm_package_scripts_test_e2e: string;
	export const npm_package_devDependencies__eslint_compat: string;
	export const npm_package_devDependencies_prettier: string;
	export const TERM_PROGRAM: string;
	export const npm_package_devDependencies_eslint_plugin_svelte: string;
	export const npm_package_devDependencies_typescript_eslint: string;
	export const NODE: string;
	export const NVM_CD_FLAGS: string;
	export const npm_package_devDependencies_prettier_plugin_svelte: string;
	export const npm_package_devDependencies_typescript: string;
	export const INIT_CWD: string;
	export const TERM: string;
	export const SHELL: string;
	export const npm_package_devDependencies_vite: string;
	export const npm_package_devDependencies__lucide_svelte: string;
	export const TMPDIR: string;
	export const npm_package_devDependencies_clsx: string;
	export const CONDA_SHLVL: string;
	export const npm_package_scripts_lint: string;
	export const TERM_PROGRAM_VERSION: string;
	export const CONDA_PROMPT_MODIFIER: string;
	export const npm_package_scripts_dev: string;
	export const TERM_SESSION_ID: string;
	export const npm_package_private: string;
	export const npm_package_devDependencies__sveltejs_kit: string;
	export const npm_config_registry: string;
	export const PNPM_HOME: string;
	export const npm_package_devDependencies_globals: string;
	export const USER: string;
	export const NVM_DIR: string;
	export const npm_package_devDependencies_tailwind_variants: string;
	export const npm_package_scripts_check_watch: string;
	export const npm_package_devDependencies__eslint_js: string;
	export const npm_package_scripts_build_storybook: string;
	export const CONDA_EXE: string;
	export const PNPM_SCRIPT_SRC_DIR: string;
	export const npm_package_devDependencies__tailwindcss_vite: string;
	export const SSH_AUTH_SOCK: string;
	export const npm_package_devDependencies_eslint_plugin_storybook: string;
	export const __CF_USER_TEXT_ENCODING: string;
	export const npm_package_devDependencies__storybook_sveltekit: string;
	export const npm_package_devDependencies_eslint: string;
	export const npm_package_devDependencies_svelte_sonner: string;
	export const npm_execpath: string;
	export const npm_package_devDependencies_svelte: string;
	export const npm_package_devDependencies__storybook_addon_vitest: string;
	export const _CE_CONDA: string;
	export const npm_config_frozen_lockfile: string;
	export const npm_package_devDependencies_vitest_browser_svelte: string;
	export const PATH: string;
	export const npm_package_devDependencies_bits_ui: string;
	export const npm_package_devDependencies__sveltejs_adapter_node: string;
	export const __CFBundleIdentifier: string;
	export const CONDA_PREFIX: string;
	export const npm_package_scripts_chromatic: string;
	export const PWD: string;
	export const npm_package_devDependencies__storybook_addon_svelte_csf: string;
	export const npm_package_devDependencies_tailwindcss: string;
	export const npm_command: string;
	export const npm_package_scripts_preview: string;
	export const npm_lifecycle_event: string;
	export const LANG: string;
	export const npm_package_name: string;
	export const npm_package_devDependencies__sveltejs_vite_plugin_svelte: string;
	export const npm_package_devDependencies_storybook: string;
	export const NODE_PATH: string;
	export const npm_package_scripts_build: string;
	export const npm_package_devDependencies__vitest_coverage_v8: string;
	export const XPC_FLAGS: string;
	export const npm_package_devDependencies_tw_animate_css: string;
	export const npm_package_devDependencies_vitest: string;
	export const npm_package_devDependencies__chromatic_com_storybook: string;
	export const npm_package_devDependencies_mode_watcher: string;
	export const npm_package_devDependencies_tailwind_merge: string;
	export const npm_config_manage_package_manager_versions: string;
	export const npm_package_devDependencies_chromatic: string;
	export const npm_package_devDependencies_eslint_config_prettier: string;
	export const npm_config_node_gyp: string;
	export const XPC_SERVICE_NAME: string;
	export const _CE_M: string;
	export const npm_package_version: string;
	export const npm_package_devDependencies__sveltejs_adapter_auto: string;
	export const npm_package_devDependencies_svelte_check: string;
	export const HOME: string;
	export const SHLVL: string;
	export const npm_package_type: string;
	export const npm_package_devDependencies_playwright: string;
	export const npm_package_scripts_test: string;
	export const npm_package_scripts_storybook: string;
	export const npm_package_devDependencies__internationalized_date: string;
	export const LOGNAME: string;
	export const CONDA_PYTHON_EXE: string;
	export const npm_package_scripts_format: string;
	export const npm_lifecycle_script: string;
	export const npm_package_devDependencies_prettier_plugin_tailwindcss: string;
	export const CONDA_DEFAULT_ENV: string;
	export const NVM_BIN: string;
	export const npm_package_devDependencies__storybook_addon_docs: string;
	export const npm_config_user_agent: string;
	export const npm_package_devDependencies__playwright_test: string;
	export const npm_package_devDependencies__storybook_addon_a11y: string;
	export const npm_package_devDependencies__types_node: string;
	export const npm_package_devDependencies__vitest_browser_playwright: string;
	export const npm_package_scripts_prepare: string;
	export const npm_package_scripts_check: string;
	export const npm_package_scripts_test_unit: string;
	export const npm_node_execpath: string;
}

/**
 * Similar to [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private), except that it only includes environment variables that begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) (which defaults to `PUBLIC_`), and can therefore safely be exposed to client-side code.
 * 
 * Values are replaced statically at build time.
 * 
 * ```ts
 * import { PUBLIC_BASE_URL } from '$env/static/public';
 * ```
 */
declare module '$env/static/public' {
	
}

/**
 * This module provides access to runtime environment variables, as defined by the platform you're running on. For example if you're using [`adapter-node`](https://github.com/sveltejs/kit/tree/main/packages/adapter-node) (or running [`vite preview`](https://svelte.dev/docs/kit/cli)), this is equivalent to `process.env`. This module only includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://svelte.dev/docs/kit/configuration#env) (if configured).
 * 
 * This module cannot be imported into client-side code.
 * 
 * ```ts
 * import { env } from '$env/dynamic/private';
 * console.log(env.DEPLOYMENT_SPECIFIC_VARIABLE);
 * ```
 * 
 * > [!NOTE] In `dev`, `$env/dynamic` always includes environment variables from `.env`. In `prod`, this behavior will depend on your adapter.
 */
declare module '$env/dynamic/private' {
	export const env: {
		NVM_INC: string;
		npm_package_devDependencies__tailwindcss_typography: string;
		npm_package_scripts_test_e2e: string;
		npm_package_devDependencies__eslint_compat: string;
		npm_package_devDependencies_prettier: string;
		TERM_PROGRAM: string;
		npm_package_devDependencies_eslint_plugin_svelte: string;
		npm_package_devDependencies_typescript_eslint: string;
		NODE: string;
		NVM_CD_FLAGS: string;
		npm_package_devDependencies_prettier_plugin_svelte: string;
		npm_package_devDependencies_typescript: string;
		INIT_CWD: string;
		TERM: string;
		SHELL: string;
		npm_package_devDependencies_vite: string;
		npm_package_devDependencies__lucide_svelte: string;
		TMPDIR: string;
		npm_package_devDependencies_clsx: string;
		CONDA_SHLVL: string;
		npm_package_scripts_lint: string;
		TERM_PROGRAM_VERSION: string;
		CONDA_PROMPT_MODIFIER: string;
		npm_package_scripts_dev: string;
		TERM_SESSION_ID: string;
		npm_package_private: string;
		npm_package_devDependencies__sveltejs_kit: string;
		npm_config_registry: string;
		PNPM_HOME: string;
		npm_package_devDependencies_globals: string;
		USER: string;
		NVM_DIR: string;
		npm_package_devDependencies_tailwind_variants: string;
		npm_package_scripts_check_watch: string;
		npm_package_devDependencies__eslint_js: string;
		npm_package_scripts_build_storybook: string;
		CONDA_EXE: string;
		PNPM_SCRIPT_SRC_DIR: string;
		npm_package_devDependencies__tailwindcss_vite: string;
		SSH_AUTH_SOCK: string;
		npm_package_devDependencies_eslint_plugin_storybook: string;
		__CF_USER_TEXT_ENCODING: string;
		npm_package_devDependencies__storybook_sveltekit: string;
		npm_package_devDependencies_eslint: string;
		npm_package_devDependencies_svelte_sonner: string;
		npm_execpath: string;
		npm_package_devDependencies_svelte: string;
		npm_package_devDependencies__storybook_addon_vitest: string;
		_CE_CONDA: string;
		npm_config_frozen_lockfile: string;
		npm_package_devDependencies_vitest_browser_svelte: string;
		PATH: string;
		npm_package_devDependencies_bits_ui: string;
		npm_package_devDependencies__sveltejs_adapter_node: string;
		__CFBundleIdentifier: string;
		CONDA_PREFIX: string;
		npm_package_scripts_chromatic: string;
		PWD: string;
		npm_package_devDependencies__storybook_addon_svelte_csf: string;
		npm_package_devDependencies_tailwindcss: string;
		npm_command: string;
		npm_package_scripts_preview: string;
		npm_lifecycle_event: string;
		LANG: string;
		npm_package_name: string;
		npm_package_devDependencies__sveltejs_vite_plugin_svelte: string;
		npm_package_devDependencies_storybook: string;
		NODE_PATH: string;
		npm_package_scripts_build: string;
		npm_package_devDependencies__vitest_coverage_v8: string;
		XPC_FLAGS: string;
		npm_package_devDependencies_tw_animate_css: string;
		npm_package_devDependencies_vitest: string;
		npm_package_devDependencies__chromatic_com_storybook: string;
		npm_package_devDependencies_mode_watcher: string;
		npm_package_devDependencies_tailwind_merge: string;
		npm_config_manage_package_manager_versions: string;
		npm_package_devDependencies_chromatic: string;
		npm_package_devDependencies_eslint_config_prettier: string;
		npm_config_node_gyp: string;
		XPC_SERVICE_NAME: string;
		_CE_M: string;
		npm_package_version: string;
		npm_package_devDependencies__sveltejs_adapter_auto: string;
		npm_package_devDependencies_svelte_check: string;
		HOME: string;
		SHLVL: string;
		npm_package_type: string;
		npm_package_devDependencies_playwright: string;
		npm_package_scripts_test: string;
		npm_package_scripts_storybook: string;
		npm_package_devDependencies__internationalized_date: string;
		LOGNAME: string;
		CONDA_PYTHON_EXE: string;
		npm_package_scripts_format: string;
		npm_lifecycle_script: string;
		npm_package_devDependencies_prettier_plugin_tailwindcss: string;
		CONDA_DEFAULT_ENV: string;
		NVM_BIN: string;
		npm_package_devDependencies__storybook_addon_docs: string;
		npm_config_user_agent: string;
		npm_package_devDependencies__playwright_test: string;
		npm_package_devDependencies__storybook_addon_a11y: string;
		npm_package_devDependencies__types_node: string;
		npm_package_devDependencies__vitest_browser_playwright: string;
		npm_package_scripts_prepare: string;
		npm_package_scripts_check: string;
		npm_package_scripts_test_unit: string;
		npm_node_execpath: string;
		[key: `PUBLIC_${string}`]: undefined;
		[key: `${string}`]: string | undefined;
	}
}

/**
 * Similar to [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private), but only includes variables that begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) (which defaults to `PUBLIC_`), and can therefore safely be exposed to client-side code.
 * 
 * Note that public dynamic environment variables must all be sent from the server to the client, causing larger network requests — when possible, use `$env/static/public` instead.
 * 
 * ```ts
 * import { env } from '$env/dynamic/public';
 * console.log(env.PUBLIC_DEPLOYMENT_SPECIFIC_VARIABLE);
 * ```
 */
declare module '$env/dynamic/public' {
	export const env: {
		[key: `PUBLIC_${string}`]: string | undefined;
	}
}
