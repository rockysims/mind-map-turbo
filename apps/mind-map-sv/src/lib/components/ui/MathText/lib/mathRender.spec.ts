import { beforeEach, describe, expect, it } from 'vitest';
import temml from 'temml';
import { clearMathRenderCache, mathRenderCacheSize, renderMath, type MathNode } from './mathRender';

beforeEach(() => {
	clearMathRenderCache();
});

/** Collect leaf token types and text, the way milestone 09's extractor will. */
function collectTokens(node: MathNode): Array<[string, string]> {
	const tokens: Array<[string, string]> = [];
	function walk(current: MathNode): void {
		if (current.type === 'mi' || current.type === 'mn' || current.type === 'mo') {
			const text = (current.children ?? []).map((child) => child.text ?? '').join('');
			tokens.push([current.type, text]);
		}
		for (const child of current.children ?? []) {
			walk(child);
		}
	}
	walk(node);
	return tokens;
}

describe('renderMath', () => {
	it('renders valid input to a math element', () => {
		const result = renderMath('v = v_0 + a t', { displayMode: true });
		expect(result.ok).toBe(true);
		expect(result.markup).toContain('<math');
	});

	it('returns a tree rooted at a math node', () => {
		const result = renderMath('F = ma', { displayMode: true });
		expect(result.ok && result.tree.type).toBe('math');
	});

	it('produces markup byte-identical to the public renderToString API', () => {
		// Pins __renderToMathMLTree, a __-prefixed internal, so a Temml upgrade that
		// changes it fails here rather than silently degrading milestone 09.
		const expression = '\\sum_{i=1}^{n} \\sqrt{\\alpha_i^2 + \\beta_i^2}';
		const result = renderMath(expression, { displayMode: true });
		const viaPublicApi = temml.renderToString(expression, {
			displayMode: true,
			throwOnError: false,
			trust: false,
			maxSize: [10, 100],
			maxExpand: 1000
		});
		expect(result.markup).toBe(viaPublicApi);
	});

	it('distinguishes display mode from inline mode for the same source', () => {
		const display = renderMath('x', { displayMode: true });
		const inline = renderMath('x', { displayMode: false });
		expect(display.markup).not.toBe(inline.markup);
	});
});

describe('renderMath tree traversal', () => {
	it('walks without a DOM, so milestone 09 can extract symbols in the node project', () => {
		expect(typeof DOMParser).toBe('undefined');
	});

	it('exposes identifiers, numbers, and operators as walkable nodes', () => {
		const result = renderMath('v_0 = a t', { displayMode: true });
		expect(result.ok && collectTokens(result.tree)).toEqual([
			['mi', 'v'],
			['mn', '0'],
			['mo', '='],
			['mi', 'a'],
			['mi', 't']
		]);
	});

	it('canonicalizes subscript spelling so v_0 and v_{0} are indistinguishable', () => {
		const bare = renderMath('v_0', { displayMode: true });
		const braced = renderMath('v_{0}', { displayMode: true });
		expect(bare.markup).toBe(braced.markup);
	});

	it('canonicalizes a Greek command and its literal character', () => {
		const command = renderMath('\\alpha', { displayMode: true });
		const literal = renderMath('α', { displayMode: true });
		expect(command.markup).toBe(literal.markup);
	});
});

describe('renderMath error handling', () => {
	it('returns the error branch instead of throwing on invalid LaTeX', () => {
		const result = renderMath('\\frac{1}{', { displayMode: true });
		expect(result.ok).toBe(false);
	});

	it('carries the parse message without the echoed source', () => {
		const result = renderMath('\\frac{1}{', { displayMode: true });
		expect(!result.ok && result.message).toContain('ParseError');
	});

	it('keeps error markup renderable so callers need no fallback of their own', () => {
		const result = renderMath('\\frac{1}{', { displayMode: true });
		expect(result.markup).toContain('temml-error');
	});

	it('renders an unknown command inline in the error color, still producing math', () => {
		// A soft error: the rest of the expression survives, so a typo mid-edit does
		// not blank the whole description. MathText relies on this staying true.
		const result = renderMath('\\notarealcommand{x}', { displayMode: true });
		expect(result.ok && result.markup).toContain('\\notarealcommand');
	});

	it('keeps an unknown command out of the hard error branch', () => {
		const result = renderMath('\\notarealcommand{x}', { displayMode: true });
		expect(result.ok).toBe(true);
	});
});

describe('renderMath safety', () => {
	it('escapes a script tag inside a text span', () => {
		const result = renderMath('\\text{<script>alert(1)</script>}', { displayMode: true });
		expect(result.markup).not.toContain('<script');
	});

	it('rejects an untrusted includegraphics payload outright', () => {
		const result = renderMath('\\includegraphics{https://evil.example/x.png}', {
			displayMode: true
		});
		expect(result.ok).toBe(false);
	});

	it.each([
		['href', '\\href{https://evil.example}{x}'],
		['includegraphics', '\\includegraphics{https://evil.example/x.png}'],
		['url', '\\url{https://evil.example}']
	])('emits no fetchable attribute for a %s payload, since trust is off', (_name, expression) => {
		// The URL may still appear as escaped text — echoing bad input back to the
		// author is fine. What must never appear is an attribute the browser acts on.
		const result = renderMath(expression, { displayMode: true });
		expect(result.markup).not.toMatch(/(?:src|href|xlink:href)\s*=/);
	});

	it('terminates a recursive macro rather than hanging, proving maxExpand applies', () => {
		const result = renderMath('\\def\\x{\\x}\\x', { displayMode: true, maxExpand: 100 });
		expect(result.ok).toBe(false);
	});
});

describe('renderMath cache', () => {
	it('returns the identical result object for a repeated call', () => {
		const first = renderMath('a + b', { displayMode: true });
		const second = renderMath('a + b', { displayMode: true });
		expect(second).toBe(first);
	});

	it('does not share a cache entry across display modes', () => {
		const display = renderMath('a + b', { displayMode: true });
		const inline = renderMath('a + b', { displayMode: false });
		expect(inline).not.toBe(display);
	});

	it('does not share a cache entry across differing safety tunables', () => {
		const lenient = renderMath('a + b', { displayMode: true, maxExpand: 1000 });
		const strict = renderMath('a + b', { displayMode: true, maxExpand: 10 });
		expect(strict).not.toBe(lenient);
	});

	it('evicts oldest entries once past its bound', () => {
		for (let i = 0; i < 12; i += 1) {
			renderMath(`x_{${i}}`, { displayMode: true, cacheMaxEntries: 5 });
		}
		expect(mathRenderCacheSize()).toBe(5);
	});

	it('retains the most recent entry after eviction', () => {
		for (let i = 0; i < 12; i += 1) {
			renderMath(`x_{${i}}`, { displayMode: true, cacheMaxEntries: 5 });
		}
		const sizeBefore = mathRenderCacheSize();
		renderMath('x_{11}', { displayMode: true, cacheMaxEntries: 5 });
		expect(mathRenderCacheSize()).toBe(sizeBefore);
	});

	it('clears fully on request', () => {
		renderMath('a', { displayMode: true });
		clearMathRenderCache();
		expect(mathRenderCacheSize()).toBe(0);
	});
});
