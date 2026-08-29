/**
 * Writing a quantity back into the text it came from.
 *
 * Two questions, both answerable without a DOM. What LaTeX spells this symbol?
 * And, given where the caret is, does that source need delimiters around it?
 *
 * Serialization is verified rather than assumed. A chip's identity is read off
 * rendered MathML, so its `base` is whatever the engine printed — usually one
 * character, but `\mathrm{Re}` prints two, and writing `Re` back produces two
 * symbols instead of one. Since the whole point is that the inserted text names
 * the same quantity the chip did, the only honest way to produce it is to render
 * the candidate and check. A symbol that survives no candidate is not writable,
 * and the caller is expected to say so rather than insert something that means
 * something else.
 */

import { renderMath } from '../../MathText/lib/mathRender';
import { splitMathSegments, type MathSegment } from '../../MathText/lib/mathSegments';
import {
	collectSymbolsFromNodes,
	topLevelChildren,
	type QuantitySymbol,
	type SymbolExtractionOptions
} from '../../MathText/lib/mathSymbols';

/** A caret, or a selected range, in source offsets. */
export interface TextSelection {
	start: number;
	end: number;
}

export interface InsertionPlan {
	/** Exactly what to put in the text, delimiters included when they are needed. */
	insert: string;
	/** Whether the caret sat inside existing math, so no delimiters were added. */
	insideMath: boolean;
}

export interface AppliedInsertion {
	text: string;
	/** Where the caret belongs afterwards: immediately after what was inserted. */
	caret: number;
}

/**
 * The command each symbol character is written as, keyed by what the engine
 * prints for it.
 *
 * Derived by rendering every command through the real engine and recording the
 * character it produced, rather than written from memory — the `var` pairs are
 * exactly where memory fails. `\epsilon` is U+03F5 while `\varepsilon` is U+03B5;
 * `\phi` is U+03D5 while `\varphi` is U+03C6. Getting either backwards would emit
 * source naming a different quantity than the chip did.
 */
const LATEX_COMMAND_BY_CHARACTER: ReadonlyMap<string, string> = new Map([
	['α', 'alpha'],
	['β', 'beta'],
	['γ', 'gamma'],
	['δ', 'delta'],
	['ϵ', 'epsilon'],
	['ε', 'varepsilon'],
	['ζ', 'zeta'],
	['η', 'eta'],
	['θ', 'theta'],
	['ϑ', 'vartheta'],
	['ι', 'iota'],
	['κ', 'kappa'],
	['λ', 'lambda'],
	['μ', 'mu'],
	['ν', 'nu'],
	['ξ', 'xi'],
	['π', 'pi'],
	['ϖ', 'varpi'],
	['ρ', 'rho'],
	['ϱ', 'varrho'],
	['σ', 'sigma'],
	['ς', 'varsigma'],
	['τ', 'tau'],
	['υ', 'upsilon'],
	['ϕ', 'phi'],
	['φ', 'varphi'],
	['χ', 'chi'],
	['ψ', 'psi'],
	['ω', 'omega'],
	['Γ', 'Gamma'],
	['Δ', 'Delta'],
	['Θ', 'Theta'],
	['Λ', 'Lambda'],
	['Ξ', 'Xi'],
	['Π', 'Pi'],
	['Σ', 'Sigma'],
	['Υ', 'Upsilon'],
	['Φ', 'Phi'],
	['Ψ', 'Psi'],
	['Ω', 'Omega'],
	['ℓ', 'ell'],
	['ℏ', 'hbar'],
	['ı', 'imath'],
	['ȷ', 'jmath'],
	['℘', 'wp'],
	['ℜ', 'Re'],
	['ℑ', 'Im'],
	['ℵ', 'aleph'],
	['∞', 'infty'],
	['∂', 'partial']
]);

/**
 * The same text with every character that has a command written as one.
 *
 * A command inside a longer run is braced, because `\alpha x` needs the space
 * that `{\alpha}x` does not, and `\alphax` is a different — undefined — command.
 * A run that is exactly one command needs neither.
 */
function toCommandForm(text: string): string {
	const characters = [...text];
	const alone = characters.length === 1;
	return characters
		.map((character) => {
			const command = LATEX_COMMAND_BY_CHARACTER.get(character);
			if (command === undefined) return character;
			return alone ? `\\${command}` : `{\\${command}}`;
		})
		.join('');
}

/**
 * The spellings to try, best first.
 *
 * The command form leads because that is what an author types and reads back:
 * `\Delta` survives being retyped, searched for, and pasted between editors in a
 * way a bare `Δ` does not, and a keyboard that cannot produce the character can
 * still produce the command. The literal character remains the fallback, so a
 * symbol with no command is unaffected.
 *
 * Braces around every subscript, not just multi-character ones. `v_0` and `v_{0}`
 * render identically, so the choice is free at the point of writing and only one
 * of them survives an author later extending the subscript in place: `v_{0}`
 * becomes `v_{01}` by typing one character, where `v_0` would have become `v_01`
 * — a different quantity.
 */
function candidateSources(symbol: QuantitySymbol): string[] {
	const withSubscript = (base: string, subscript: string | null) =>
		subscript === null ? base : `${base}_{${subscript}}`;

	const commanded = withSubscript(
		toCommandForm(symbol.base),
		symbol.subscript === null ? null : toCommandForm(symbol.subscript)
	);
	const literal = withSubscript(symbol.base, symbol.subscript);
	// `\mathrm` is the last retry, not the default: it is what recovers a base the
	// engine printed as several characters, and wrapping a one-character base in
	// it would add upright styling the author never asked for.
	const upright = withSubscript(`\\mathrm{${symbol.base}}`, symbol.subscript);

	// Deduped because an ASCII symbol's command form is just its literal form, and
	// rendering the same candidate twice to compare it twice is waste.
	return [...new Set([commanded, literal, upright])];
}

/** The symbols one expression names, read the same way the chips were. */
function symbolsIn(source: string, options: SymbolExtractionOptions): QuantitySymbol[] {
	const rendered = renderMath(source);
	if (!rendered.ok) return [];
	return collectSymbolsFromNodes(topLevelChildren(rendered.tree), options);
}

/**
 * LaTeX that names this quantity and nothing else, or null when none does.
 *
 * The check is the definition of correctness here: the source must round-trip to
 * exactly one symbol, and that symbol must be this one. Anything weaker lets a
 * chip write text that the parser will read back as a different quantity — or as
 * two — which is worse than declining, because the author has no way to see it
 * happened.
 */
export function serializeSymbol(
	symbol: QuantitySymbol,
	options: SymbolExtractionOptions = {}
): string | null {
	for (const candidate of candidateSources(symbol)) {
		const found = symbolsIn(candidate, options);
		if (found.length === 1 && found[0].key === symbol.key) return candidate;
	}
	return null;
}

/**
 * The span of one segment's *content* within the whole string, in source
 * offsets — i.e. what lies strictly between its delimiters.
 *
 * Source offsets throughout, never content offsets. `\$` is two source
 * characters and one content character, so the two coordinate systems come apart
 * in any text holding an escaped dollar, and a caret is only ever expressed in
 * the first.
 */
function contentSpanOf(segment: MathSegment, sourceStart: number): TextSelection {
	const delimiter = segment.kind === 'display-math' ? 2 : 1;
	return {
		start: sourceStart + delimiter,
		end: sourceStart + segment.source.length - delimiter
	};
}

/**
 * Whether the selection lies wholly inside one math segment's content.
 *
 * The boundary that matters is the delimiter's outer edge. A caret between the
 * delimiter and the content — `$|w$` — is inside by any reading, and inserting
 * bare there puts the symbol where the author pointed. A caret on the other side
 * of the same delimiter — `|$w$` — is prose, and reading it as inside would put
 * the symbol outside the `$` it was supposed to join, producing math that does
 * not parse. A selection spanning segments is prose for the same reason: there
 * is no one segment it is inside of.
 */
function selectionIsInsideMath(text: string, selection: TextSelection): boolean {
	let sourceStart = 0;
	for (const segment of splitMathSegments(text)) {
		if (segment.kind !== 'text') {
			const span = contentSpanOf(segment, sourceStart);
			if (selection.start >= span.start && selection.end <= span.end) return true;
		}
		sourceStart += segment.source.length;
	}
	return false;
}

/**
 * What to write for this source at this caret.
 *
 * Inside existing math the symbol goes in bare; anywhere else it brings its own
 * inline segment, so an insertion into prose is always self-contained and never
 * depends on a delimiter somewhere else in the string staying where it is.
 */
export function insertionFor(
	text: string,
	selection: TextSelection,
	source: string
): InsertionPlan {
	const insideMath = selectionIsInsideMath(text, selection);
	return { insert: insideMath ? source : `$${source}$`, insideMath };
}

/**
 * The text after an insertion, and where the caret lands.
 *
 * The fallback path only. Insertion normally goes through the field's own
 * editing command so the browser keeps its undo stack, and this exists for the
 * case where that command reports failure. Offsets are UTF-16 code units, the
 * same units `selectionStart` speaks, so a surrogate pair needs no special
 * handling as long as nothing here counts characters.
 */
export function applyInsertion(
	text: string,
	selection: TextSelection,
	insert: string
): AppliedInsertion {
	const start = Math.max(0, Math.min(selection.start, text.length));
	const end = Math.max(start, Math.min(selection.end, text.length));
	return {
		text: `${text.slice(0, start)}${insert}${text.slice(end)}`,
		caret: start + insert.length
	};
}
