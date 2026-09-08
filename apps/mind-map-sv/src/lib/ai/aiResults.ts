/**
 * Named numbers a run reported, read out of stdout and rendered as LaTeX.
 *
 * The system prompt asks for `RESULT <symbol> = <value> [unit]` on its own
 * line, and this module is the whole contract for what that means: what counts
 * as one, and the single string both the workbench and the dataflow extractor
 * read. One renderer rather than two means the number a reader sees on the node
 * and the number the quantity index parses can never be two different strings.
 *
 * The input is model-authored text that has been through a Python script over
 * data nobody vetted, so everything here refuses rather than repairs: a symbol
 * outside a small allowlist, a value that is not a finite number, or a line
 * that merely mentions results is skipped, and nothing is guessed at.
 *
 * Pure throughout. No clock, no randomness, no DOM.
 */

import { APP_CONFIG } from '$lib/appConfig';

/**
 * One named number a run reported.
 *
 * `value` is the string the script printed rather than a parsed number: it has
 * already been checked to parse as a finite number, and keeping the script's
 * own digits means the node shows what the analysis said instead of what a
 * round trip through IEEE 754 made of it. `unit` is free text — nothing in the
 * app checks or converts it — and is absent when the line carried none.
 */
export interface AiResult {
	/** The quantity's symbol, in LaTeX: `R_{th}`, `\tau`, `v_0`. */
	symbol: string;
	/** The value exactly as the script printed it. */
	value: string;
	/** Free text, absent when the line gave none. */
	unit?: string;
}

/**
 * Not exported: callers pass an object literal, and the two tunables are
 * parameters so a spec can pin the number it is testing rather than the number
 * the app happens to ship with.
 */
interface ParseResultLinesOptions {
	/** Distinct symbols one run may report; defaults to `APP_CONFIG.ai.maxResultsPerRun`. */
	maxResults?: number;
	/** Characters a unit may run to; defaults to `APP_CONFIG.ai.resultUnitMaxChars`. */
	unitMaxChars?: number;
}

/**
 * `RESULT`, the symbol, `=`, the value, and optionally a unit.
 *
 * Anchored at both ends of a trimmed line so a sentence *about* results
 * (`# RESULT lines follow`) cannot be mistaken for one, and so does a line that
 * carries a result plus commentary — a script that wants to say more can print
 * a second line. The symbol and value are non-space runs, which is what makes
 * `RESULT R th = 1` fail here rather than parse as a symbol of `R`.
 */
const RESULT_LINE = /^RESULT[ \t]+(\S+)[ \t]*=[ \t]*(\S+)(?:[ \t]+(.*))?$/;

/**
 * What a symbol may contain: ASCII letters and digits, and the four characters
 * LaTeX needs to write a subscript, a superscript or a command.
 *
 * Deliberately small. The symbol goes straight into an expression the math
 * engine parses and the quantity index reads, so the cost of being generous is
 * an arbitrary macro from a data file reaching the renderer; the cost of being
 * strict is a skipped line the reader can see was skipped.
 */
const ALLOWED_SYMBOL = /^[A-Za-z0-9\\^_{}]+$/;

/**
 * Every `RESULT` line in `stdout`, in the order a reader would meet them.
 *
 * A repeated symbol keeps its *last* value: a script that prints a running
 * figure as it iterates should report the one it finished with. It keeps its
 * *first* position, so a re-print does not shuffle the list. The cap counts
 * distinct symbols rather than lines, for the same reason — thirty prints of
 * one running value must not crowd out the twenty-ninth quantity.
 */
export function parseResultLines(
	stdout: string,
	options: ParseResultLinesOptions = {}
): AiResult[] {
	const {
		maxResults = APP_CONFIG.ai.maxResultsPerRun,
		unitMaxChars = APP_CONFIG.ai.resultUnitMaxChars
	} = options;

	// Insertion-ordered, and an overwrite keeps the original position — which is
	// exactly the "last value, first place" rule above, for free.
	const bySymbol = new Map<string, AiResult>();

	for (const rawLine of stdout.split('\n')) {
		const match = RESULT_LINE.exec(rawLine.trim());
		if (match === null) continue;

		const [, symbol, value, rest] = match;
		if (!ALLOWED_SYMBOL.test(symbol)) continue;
		if (!Number.isFinite(Number(value))) continue;

		const unit = (rest ?? '').trim().slice(0, unitMaxChars);
		bySymbol.set(symbol, { symbol, value, ...(unit === '' ? {} : { unit }) });
	}

	return [...bySymbol.values()].slice(0, Math.max(0, maxResults));
}

/**
 * One result as the LaTeX everything downstream reads: `R_{th} = 12.3\ \text{K/W}`.
 *
 * The unit sits inside `\text{}` after a `\ ` so it is set upright and spaced
 * off the number the way a unit is written, and it is escaped on the way in
 * because it is free text from a script — a `%` would comment out the rest of
 * the expression and a stray `\` would be read as a command.
 */
export function renderResultTex(result: AiResult): string {
	const head = `${result.symbol} = ${result.value}`;
	if (result.unit === undefined || result.unit === '') return head;
	return `${head}\\ \\text{${escapeForText(result.unit)}}`;
}

/**
 * The TeX characters that cannot appear literally inside `\text{}`.
 *
 * Applied in one pass rather than as a chain of `replace` calls: escaping the
 * backslash first would then have its own `{}` escaped by a later pass, and a
 * chain that happens to be in the right order today is a chain someone reorders
 * tomorrow.
 */
const TEXT_ESCAPES: Record<string, string> = {
	'\\': '\\textbackslash{}',
	'{': '\\{',
	'}': '\\}',
	$: '\\$',
	'&': '\\&',
	'#': '\\#',
	'%': '\\%',
	_: '\\_',
	'~': '\\textasciitilde{}',
	'^': '\\textasciicircum{}'
};

function escapeForText(unit: string): string {
	return unit.replace(/[\\{}$&#%_~^]/g, (character) => TEXT_ESCAPES[character]);
}
