import { describe, expect, it } from 'vitest';
import { renderMath, type MathNode } from './mathRender';
import {
	collectSymbols,
	singleSymbolOf,
	topLevelChildren,
	DEFAULT_CONSTANT_STOPLIST,
	type SymbolExtractionOptions
} from './mathSymbols';

/**
 * Every case goes through the real engine rather than a hand-built tree, so the
 * extractor is pinned to what Temml actually emits. A hand-written fixture would
 * happily keep passing after an engine upgrade changed the shape underneath it.
 */
function treeOf(expression: string): MathNode {
	const result = renderMath(expression, { displayMode: true });
	if (!result.ok) {
		throw new Error(`fixture failed to render: ${expression}`);
	}
	return result.tree;
}

function labelsOf(expression: string, options?: SymbolExtractionOptions): string[] {
	return collectSymbols(treeOf(expression), options).map((symbol) => symbol.label);
}

function keyOf(expression: string): string {
	const [symbol] = collectSymbols(treeOf(expression));
	return symbol.key;
}

describe('collectSymbols canonicalization', () => {
	it('treats a bare identifier as one symbol', () => {
		expect(labelsOf('v')).toEqual(['v']);
	});

	it('gives the same key to v_0 and v_{0}', () => {
		expect(keyOf('v_0')).toBe(keyOf('v_{0}'));
	});

	it('gives the same key to a Greek command and its literal character', () => {
		expect(keyOf('\\theta')).toBe(keyOf('θ'));
	});

	it('distinguishes a subscripted symbol from its bare base', () => {
		expect(keyOf('v_0')).not.toBe(keyOf('v'));
	});

	it('keeps a multi-character subscript together', () => {
		expect(labelsOf('v_{ij}')).toEqual(['v_ij']);
	});

	it('does not emit a subscript as a symbol in its own right', () => {
		expect(labelsOf('x_i')).toEqual(['x_i']);
	});

	it('reads an accented identifier as its base symbol', () => {
		expect(labelsOf('\\vec{v}')).toEqual(['v']);
	});

	it('reads a primed identifier as its base symbol', () => {
		expect(labelsOf("f'")).toEqual(['f']);
	});

	it('dedupes a symbol repeated across an expression', () => {
		expect(labelsOf('v = v + v')).toEqual(['v']);
	});

	it('returns symbols in document order', () => {
		expect(labelsOf('v = v_0 + a t')).toEqual(['v', 'v_0', 'a', 't']);
	});

	it('falls back to plain traversal for a compound subscript', () => {
		// `v_{a+b}` is not a subscripted symbol in any useful sense.
		expect(labelsOf('v_{a+b}')).toEqual(['v', 'a', 'b']);
	});
});

describe('collectSymbols exclusions', () => {
	it('excludes numbers', () => {
		expect(labelsOf('2 x')).toEqual(['x']);
	});

	it('excludes an exponent that is a number while keeping the base', () => {
		expect(labelsOf('x^2')).toEqual(['x']);
	});

	it('excludes a function name via the function-application operator', () => {
		expect(labelsOf('\\sin x')).toEqual(['x']);
	});

	it.each([
		['\\sin(x)', ['x']],
		['\\log y', ['y']],
		['\\cos\\theta', ['θ']]
	])('excludes the function name in %s', (expression, expected) => {
		expect(labelsOf(expression)).toEqual(expected);
	});

	it('keeps an ordinary identifier applied to parentheses, which carries no operator', () => {
		// `f(x)` gets no U+2061, so f reads as a variable rather than a function.
		expect(labelsOf('f(x)')).toEqual(['f', 'x']);
	});

	it('never scans inside a text span', () => {
		expect(labelsOf('\\text{speed} = d')).toEqual(['d']);
	});

	it('never scans the error-marked token Temml emits for an unknown command', () => {
		// Soft failure: valid MathML with the bad token in mtext. It must not read
		// as an identifier.
		expect(labelsOf('\\notarealcommand + y')).toEqual(['y']);
	});

	it('excludes stoplisted constants by default', () => {
		expect(labelsOf('2 \\pi r')).toEqual(['r']);
	});

	it('accepts an overridden stoplist', () => {
		expect(labelsOf('E = m c^2', { stoplist: ['c'] })).toEqual(['E', 'm']);
	});

	it('keeps a symbol the default stoplist happens to exclude when overridden empty', () => {
		expect(labelsOf('2 \\pi r', { stoplist: [] })).toEqual(['π', 'r']);
	});

	it('has a default stoplist that stays small, since promotion handles constants', () => {
		expect(DEFAULT_CONSTANT_STOPLIST.length).toBeLessThanOrEqual(4);
	});
});

describe('topLevelChildren', () => {
	it('descends the fragment and mrow the engine wraps a multi-token expression in', () => {
		expect(topLevelChildren(treeOf('F = ma')).map((node) => node.type)).toEqual([
			'mi',
			'mo',
			'mi',
			'mi'
		]);
	});

	it('returns a single-token expression without descending into it', () => {
		expect(topLevelChildren(treeOf('v_0')).map((node) => node.type)).toEqual(['msub']);
	});

	it('does not descend into a fraction', () => {
		expect(topLevelChildren(treeOf('\\frac{a}{b}')).map((node) => node.type)).toEqual(['mfrac']);
	});

	it('keeps a nested equality out of the top level', () => {
		// The `i = 1` under the summation limits must not read as a definition.
		const topLevelEqualities = topLevelChildren(treeOf('\\sum_{i=1}^{n} x_i')).filter(
			(node) => node.type === 'mo'
		);
		expect(topLevelEqualities).toHaveLength(0);
	});
});

describe('singleSymbolOf', () => {
	function leftOfEquals(expression: string): readonly MathNode[] {
		const children = topLevelChildren(treeOf(expression));
		const index = children.findIndex(
			(node) =>
				node.type === 'mo' && (node.children ?? []).map((c) => c.text ?? '').join('') === '='
		);
		return index === -1 ? [] : children.slice(0, index);
	}

	it('accepts a bare identifier on the left', () => {
		expect(singleSymbolOf(leftOfEquals('F = ma'))?.label).toBe('F');
	});

	it('accepts a subscripted identifier on the left', () => {
		expect(singleSymbolOf(leftOfEquals('v_0 = 3'))?.label).toBe('v_0');
	});

	it('accepts an accented identifier on the left', () => {
		expect(singleSymbolOf(leftOfEquals('\\vec{p} = m v'))?.label).toBe('p');
	});

	it('rejects a multi-symbol left side', () => {
		expect(singleSymbolOf(leftOfEquals('a + b = c'))).toBeNull();
	});

	it('rejects a scaled identifier on the left', () => {
		expect(singleSymbolOf(leftOfEquals('2 v = 3'))).toBeNull();
	});

	it('rejects a repeated identifier on the left, despite deduping to one symbol', () => {
		expect(singleSymbolOf(leftOfEquals('v v = 3'))).toBeNull();
	});

	it('rejects prose on the left', () => {
		expect(singleSymbolOf(leftOfEquals('\\text{speed} = d'))).toBeNull();
	});

	it('rejects an empty left side', () => {
		expect(singleSymbolOf([])).toBeNull();
	});
});
