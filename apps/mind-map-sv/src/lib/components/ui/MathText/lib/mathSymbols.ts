/**
 * Identify the quantities an expression mentions by walking the MathML tree the
 * render adapter produces.
 *
 * Working from rendered MathML rather than LaTeX source is what makes symbol
 * identity a structural comparison instead of string normalization: the engine
 * already collapses `v_0` and `v_{0}` to the same tree and turns `\alpha` into a
 * single identifier, so this module never has to know those spellings exist.
 */

import type { MathNode } from './mathRender';

/** U+2061 FUNCTION APPLICATION, emitted directly after a function name. */
const FUNCTION_APPLICATION = '\u2061';

/**
 * Separates base from subscript in a canonical key. A NUL cannot appear in an
 * identifier, so `v` with subscript `0` can never collide with a base literally
 * named `v_0`.
 */
const KEY_SEPARATOR = '\u0000';

/**
 * Symbols excluded by default.
 *
 * Deliberately tiny. The real defence against constants is the promotion rule
 * in the quantity index — a symbol becomes a tracked quantity only once some
 * node defines it, and nobody writes `e = …` meaning Euler's number. This list
 * is only for symbols that would otherwise be defined by accident.
 */
export const DEFAULT_CONSTANT_STOPLIST: readonly string[] = ['π', '∞'];

export interface QuantitySymbol {
	/** The identifier itself, e.g. `v`. */
	base: string;
	/** Subscript text, e.g. `0` in `v_0`, or null for a bare identifier. */
	subscript: string | null;
	/** Canonical identity for comparison and indexing. Not human-facing. */
	key: string;
	/** Human-readable form, e.g. `v` or `v_0`. */
	label: string;
}

export interface SymbolExtractionOptions {
	stoplist?: readonly string[];
}

function textOf(node: MathNode): string {
	if (typeof node.text === 'string') {
		return node.text;
	}
	return (node.children ?? []).map(textOf).join('');
}

function makeSymbol(base: string, subscript: string | null): QuantitySymbol {
	return {
		base,
		subscript,
		key: subscript === null ? base : `${base}${KEY_SEPARATOR}${subscript}`,
		label: subscript === null ? base : `${base}_${subscript}`
	};
}

/**
 * Symbol for a structural identity that arrived without an expression to parse —
 * a persisted designation whose equation no longer appears in the node's text.
 * Produces the same key/label extraction would, so identities always compare.
 */
export function symbolFor(base: string, subscript: string | null): QuantitySymbol {
	return makeSymbol(base, subscript);
}

/** True when this node is the invisible operator marking the previous `mi` as a function. */
function isFunctionApplication(node: MathNode | undefined): boolean {
	return node?.type === 'mo' && textOf(node) === FUNCTION_APPLICATION;
}

/**
 * Flatten a subscript to text, or null when it is not a plain identifier or
 * number. `v_{a+b}` is not a subscripted symbol in any useful sense, so it falls
 * back to ordinary traversal and contributes `v`, `a`, and `b` instead.
 */
function flattenSubscript(node: MathNode): string | null {
	if (node.type === 'mi' || node.type === 'mn') {
		return textOf(node);
	}
	if (node.type === 'mrow' || node.type === undefined) {
		const parts = (node.children ?? []).map(flattenSubscript);
		return parts.every((part) => part !== null) ? parts.join('') : null;
	}
	return null;
}

/**
 * The operands the author wrote, rather than the engine's grouping.
 *
 * Temml wraps a multi-token expression in an untyped fragment containing a
 * single `mrow`; a single-token expression gets neither. Descending through
 * both is what makes "exactly one top-level equality" mean what an author would
 * expect.
 */
export function topLevelChildren(tree: MathNode): readonly MathNode[] {
	let children = tree.children ?? [];
	for (;;) {
		if (children.length !== 1) {
			return children;
		}
		const only = children[0];
		const isTransparentFragment = only.type === undefined && only.children !== undefined;
		if (isTransparentFragment || only.type === 'mrow') {
			children = only.children ?? [];
			continue;
		}
		return children;
	}
}

function collectInto(nodes: readonly MathNode[], found: QuantitySymbol[]): void {
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];

		// A function name is marked structurally by the operator that follows it,
		// which is far more reliable than inspecting identifier length or styling.
		if (node.type === 'mi' && isFunctionApplication(nodes[index + 1])) {
			continue;
		}

		switch (node.type) {
			// Prose inside an expression must never manufacture references. This also
			// covers the error-coloured mtext Temml emits for an unknown command.
			case 'mtext':
			case 'mn':
			case 'mo':
			case 'mspace':
				continue;
			case 'mi':
				found.push(makeSymbol(textOf(node), null));
				continue;
			case 'msub': {
				const [base, subscript] = node.children ?? [];
				if (base?.type === 'mi' && subscript !== undefined) {
					const flattened = flattenSubscript(subscript);
					if (flattened !== null) {
						found.push(makeSymbol(textOf(base), flattened));
						continue;
					}
				}
				collectInto(node.children ?? [], found);
				continue;
			}
			default:
				collectInto(node.children ?? [], found);
		}
	}
}

function dedupeByKey(
	symbols: readonly QuantitySymbol[],
	stoplist: readonly string[]
): QuantitySymbol[] {
	const excluded = new Set(stoplist);
	const seen = new Set<string>();
	const result: QuantitySymbol[] = [];
	for (const symbol of symbols) {
		if (excluded.has(symbol.label) || seen.has(symbol.key)) {
			continue;
		}
		seen.add(symbol.key);
		result.push(symbol);
	}
	return result;
}

/** Symbols mentioned across a list of nodes, in document order, deduped by identity. */
export function collectSymbolsFromNodes(
	nodes: readonly MathNode[],
	options: SymbolExtractionOptions = {}
): QuantitySymbol[] {
	const found: QuantitySymbol[] = [];
	collectInto(nodes, found);
	return dedupeByKey(found, options.stoplist ?? DEFAULT_CONSTANT_STOPLIST);
}

/** Symbols mentioned anywhere in a rendered expression. */
export function collectSymbols(
	tree: MathNode,
	options: SymbolExtractionOptions = {}
): QuantitySymbol[] {
	return collectSymbolsFromNodes(tree.children ?? [], options);
}

/**
 * The single symbol these nodes denote, or null.
 *
 * Requires exactly one node so that `v v = 3` and `2 v = 3` are rejected: they
 * mention one distinct symbol after deduping but are not a bare left-hand side.
 */
export function singleSymbolOf(
	nodes: readonly MathNode[],
	options: SymbolExtractionOptions = {}
): QuantitySymbol | null {
	if (nodes.length !== 1) {
		return null;
	}
	const symbols = collectSymbolsFromNodes(nodes, options);
	return symbols.length === 1 ? symbols[0] : null;
}

/**
 * A stable string identifying what an expression says, for comparing two
 * statements about the same quantity.
 *
 * This answers "are these the same definition?", not "are these equal?". It is a
 * structural comparison and deliberately not an evaluation: `1` and `1.0` differ
 * here, as do `a + b` and `b + a`. Deciding those are the same would mean
 * implementing algebra, which this milestone explicitly does not do, and being
 * wrong about it quietly is worse than asking the author to restate consistently.
 *
 * Reading the MathML rather than the source is what makes `v_0` and `v_{0}` agree
 * without any special handling — Temml has already normalized the two spellings
 * into the same tree.
 */
export function canonicalExpressionKey(nodes: readonly MathNode[]): string {
	const text: string[] = [];

	function walk(node: MathNode) {
		if (typeof node.text === 'string') {
			text.push(node.text);
			return;
		}
		for (const child of node.children ?? []) {
			walk(child);
		}
	}

	for (const node of nodes) {
		walk(node);
	}

	// Whitespace and invisible operators are typography, not content: `a+b` and
	// `a + b` are one statement written twice, and flagging them would make the
	// warning fire on formatting.
	return text
		.join('')
		.replace(/[\s\u2061\u2062\u2063\u2064]/g, '')
		.normalize('NFC');
}
