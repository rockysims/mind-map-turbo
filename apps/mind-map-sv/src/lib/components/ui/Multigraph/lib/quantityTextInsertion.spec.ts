import { describe, expect, it } from 'vitest';
import {
	applyInsertion,
	insertionFor,
	serializeSymbol,
	type TextSelection
} from './quantityTextInsertion';
import { nodeQuantities } from './nodeQuantities';
import { symbolFor } from '../../MathText/lib/mathSymbols';

function at(offset: number): TextSelection {
	return { start: offset, end: offset };
}

/** Where `marker` sits in `text`, as a caret. Keeps the offsets out of the tests. */
function caretAfter(text: string, marker: string): TextSelection {
	const index = text.indexOf(marker);
	if (index === -1) throw new Error(`no ${marker} in ${text}`);
	return at(index + marker.length);
}

/** The symbols a node would report if its description were exactly this source. */
function symbolLabelsOf(description: string): string[] {
	const parsed = nodeQuantities({ description, tags: [] });
	return [...parsed.defines.map((d) => d.symbol.label), ...parsed.references.map((s) => s.label)];
}

describe('serializeSymbol', () => {
	it('writes a bare identifier as itself', () => {
		expect(serializeSymbol(symbolFor('v', null))).toBe('v');
	});

	it('braces every subscript, so extending one in place stays one subscript', () => {
		expect(serializeSymbol(symbolFor('v', '0'))).toBe('v_{0}');
	});

	it('writes a symbol as its command rather than as a raw character', () => {
		// What an author types and reads back. A bare `Δ` needs a keyboard that can
		// produce it, and survives copying between editors less well.
		expect(serializeSymbol(symbolFor('α', null))).toBe('\\alpha');
		expect(serializeSymbol(symbolFor('Δ', null))).toBe('\\Delta');
		expect(serializeSymbol(symbolFor('ℓ', null))).toBe('\\ell');
		expect(serializeSymbol(symbolFor('ℏ', null))).toBe('\\hbar');
	});

	it('keeps the var pairs apart, which is where a remembered map goes wrong', () => {
		// U+03F5 and U+03B5 are different characters and different quantities.
		expect(serializeSymbol(symbolFor('ϵ', null))).toBe('\\epsilon');
		expect(serializeSymbol(symbolFor('ε', null))).toBe('\\varepsilon');
		expect(serializeSymbol(symbolFor('ϕ', null))).toBe('\\phi');
		expect(serializeSymbol(symbolFor('φ', null))).toBe('\\varphi');
	});

	it('writes a command in the base and in the subscript', () => {
		expect(serializeSymbol(symbolFor('θ', 'max'))).toBe('\\theta_{max}');
		expect(serializeSymbol(symbolFor('α', 'β'))).toBe('\\alpha_{\\beta}');
		expect(serializeSymbol(symbolFor('v', 'θ'))).toBe('v_{\\theta}');
	});

	it('braces a command sharing a subscript with other characters', () => {
		// `\alpha x` would need the space that `{\alpha}x` does not, and `\alphax`
		// is a different, undefined command.
		expect(serializeSymbol(symbolFor('v', 'αx'))).toBe('v_{{\\alpha}x}');
	});

	it('leaves a character with no command as itself', () => {
		// A bold identifier is a single astral-plane character, not a command.
		expect(serializeSymbol(symbolFor('𝐯', null))).toBe('𝐯');
	});

	it('never writes the canonical key, which embeds a NUL', () => {
		const source = serializeSymbol(symbolFor('v', '0'));
		expect(source).not.toContain('\u0000');
	});

	it('retries upright for a base the engine printed as several characters', () => {
		// `\mathrm{Re}` renders one identifier whose text is `Re`, so that is the
		// chip's base — but writing `Re` back names two symbols, R and e.
		expect(symbolLabelsOf('$Re$')).toEqual(['R', 'e']);
		expect(serializeSymbol(symbolFor('Re', null))).toBe('\\mathrm{Re}');
		expect(symbolLabelsOf('$\\mathrm{Re}$')).toEqual(['Re']);
	});

	it('declines a symbol no candidate recovers', () => {
		// A multi-character base *with* a subscript survives neither spelling: the
		// bare form splits into letters, and the upright form loses the subscript.
		expect(serializeSymbol(symbolFor('Re', '0'))).toBeNull();
	});

	it('round-trips everything it does produce back to the same key', () => {
		for (const symbol of [
			symbolFor('v', null),
			symbolFor('v', '0'),
			symbolFor('α', null),
			symbolFor('ϵ', null),
			symbolFor('ε', null),
			symbolFor('ϕ', null),
			symbolFor('φ', null),
			symbolFor('Δ', null),
			symbolFor('θ', 'max'),
			symbolFor('α', 'β'),
			symbolFor('v', 'αx'),
			symbolFor('𝐯', null),
			symbolFor('ℓ', null),
			symbolFor('ℏ', null),
			symbolFor('Re', null)
		]) {
			const source = serializeSymbol(symbol);
			expect(source).not.toBeNull();
			expect(symbolLabelsOf(`$${source}$`)).toEqual([symbol.label]);
		}
	});

	it('honours a stoplist passed in rather than pinning one', () => {
		expect(serializeSymbol(symbolFor('α', null), { stoplist: ['α'] })).toBeNull();
	});
});

describe('insertionFor', () => {
	it('adds an inline segment in prose', () => {
		const text = 'Weight is what it is.';
		expect(insertionFor(text, caretAfter(text, 'Weight is '), 'w')).toEqual({
			insert: '$w$',
			insideMath: false
		});
	});

	it('inserts bare inside inline math', () => {
		const text = 'Weight is $w = m$ here.';
		expect(insertionFor(text, caretAfter(text, '$w = '), 'g')).toEqual({
			insert: 'g',
			insideMath: true
		});
	});

	it('inserts bare inside display math', () => {
		const text = 'Weight is $$w = m$$ here.';
		expect(insertionFor(text, caretAfter(text, '$$w = '), 'g')).toEqual({
			insert: 'g',
			insideMath: true
		});
	});

	it('replaces a range inside math without adding delimiters', () => {
		const text = 'Weight is $w = m$ here.';
		const start = text.indexOf('m');
		expect(insertionFor(text, { start, end: start + 1 }, 'g').insert).toBe('g');
	});

	it('counts the inner edge of a delimiter as inside the math', () => {
		// `$|w$` and `$w|$` are both within the content, and inserting bare there is
		// what the author asked for: the symbol lands beside `w`, inside the math.
		const text = 'Weight is $w$ here.';
		const open = text.indexOf('$');
		expect(insertionFor(text, at(open + 1), 'g').insert).toBe('g');
		expect(insertionFor(text, at(open + 2), 'g').insert).toBe('g');
	});

	it('counts the outer edge of a delimiter as prose', () => {
		// `|$w$` and `$w$|` are outside. Reading them as inside would put the symbol
		// on the wrong side of a `$` and produce math that does not parse.
		const text = 'Weight is $w$ here.';
		const open = text.indexOf('$');
		expect(insertionFor(text, at(open), 'g').insert).toBe('$g$');
		expect(insertionFor(text, at(open + 3), 'g').insert).toBe('$g$');
	});

	it('treats a selection spanning a delimiter as prose', () => {
		const text = 'Weight is $w$ here.';
		const start = text.indexOf('is');
		expect(insertionFor(text, { start, end: text.indexOf('here') }, 'g').insert).toBe('$g$');
	});

	it('treats an unterminated delimiter as prose', () => {
		// A stray dollar stays literal text rather than swallowing the rest, so a
		// caret after it is not inside anything.
		const text = 'Costs $5 and rising';
		expect(insertionFor(text, caretAfter(text, '$5 '), 'w').insert).toBe('$w$');
	});

	it('works in source offsets, so an escaped dollar does not shift the math', () => {
		// `\$` is two source characters and one content character. Counting content
		// would put this caret inside the following math segment by one.
		const text = 'Costs \\$5 then $w = m$ here.';
		expect(insertionFor(text, caretAfter(text, 'Costs \\$5 '), 'g').insert).toBe('$g$');
		expect(insertionFor(text, caretAfter(text, '$w = '), 'g').insert).toBe('g');
	});

	it('does not pair a new delimiter with an escaped one', () => {
		const text = 'Costs \\$5';
		const { insert } = insertionFor(text, at(text.length), 'w');
		const next = applyInsertion(text, at(text.length), insert).text;
		expect(next).toBe('Costs \\$5$w$');
		expect(symbolLabelsOf(next)).toEqual(['w']);
	});
});

describe('applyInsertion', () => {
	it('inserts at a caret and reports the offset after it', () => {
		expect(applyInsertion('ab', at(1), '$w$')).toEqual({ text: 'a$w$b', caret: 4 });
	});

	it('replaces a selected range', () => {
		expect(applyInsertion('a XX b', { start: 2, end: 4 }, 'w')).toEqual({
			text: 'a w b',
			caret: 3
		});
	});

	it('counts UTF-16 code units, the units selectionStart speaks', () => {
		// `𝐯` is a surrogate pair, so a caret after it is at 2, not 1.
		const applied = applyInsertion('𝐯', at(2), '$w$');
		expect(applied).toEqual({ text: '𝐯$w$', caret: 5 });
		expect(applied.text.slice(0, applied.caret)).toBe('𝐯$w$');
	});

	it('clamps a selection that outruns the text', () => {
		expect(applyInsertion('ab', { start: 9, end: 9 }, 'w')).toEqual({ text: 'abw', caret: 3 });
	});

	it('does not mutate its argument', () => {
		const text = 'ab';
		applyInsertion(text, at(1), 'w');
		expect(text).toBe('ab');
	});
});
