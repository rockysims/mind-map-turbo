export const OFFLINE_APP_SHELL_PATH = '/offline-app-shell.html';
export const EXPORT_HTML_SHELL_WINDOW_KEY = '__MIND_MAP_EXPORT_HTML_SHELL__';

const DEV_ONLY_MODULE_REFERENCE =
	/\b(?:import\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)?|from\s*)(["'])(?:\/@fs\/|\/node_modules\/|[^"']*\/\.svelte-kit\/generated\/|[^"']*vite\/client)/;
const MODULE_SCRIPT_WITH_SRC = /<script\b(?=[^>]*\btype=(["'])module\1)(?=[^>]*\bsrc=)[^>]*>/i;
const INLINE_SCRIPT = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
const EMBEDDED_GRAPH_PAYLOAD_SCRIPT =
	/<script\b(?=[^>]*\bid=(["'])mind-map-embedded-graph\1)(?=[^>]*\btype=(["'])application\/json\2)[^>]*>[\s\S]*?<\/script>\s*/i;

export function isSelfContainedHtmlShell(html: string): boolean {
	if (MODULE_SCRIPT_WITH_SRC.test(html)) return false;

	for (const match of html.matchAll(INLINE_SCRIPT)) {
		const scriptText = match[1] ?? '';
		if (DEV_ONLY_MODULE_REFERENCE.test(scriptText)) return false;
	}

	return true;
}

export function cleanExportHtmlShell(html: string): string {
	return html.replace(EMBEDDED_GRAPH_PAYLOAD_SCRIPT, '');
}
