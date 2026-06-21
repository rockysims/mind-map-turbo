export const OFFLINE_APP_SHELL_PATH = '/offline-app-shell.html';

export function isSelfContainedHtmlShell(html: string): boolean {
	return !/<script\b(?=[^>]*\btype=(["'])module\1)(?=[^>]*\bsrc=)/i.test(html);
}
