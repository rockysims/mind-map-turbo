/**
 * Read one node's math and report which quantities it defines and which it
 * merely mentions.
 *
 * This is a *suggestion provider*, not the dataflow itself. Nothing here draws an
 * edge: what a node actually consumes and produces is the designations the user
 * confirmed on it, which the quantity index reads. This module answers two
 * narrower questions — what should be offered as a chip to confirm, and, for a
 * quantity already confirmed as an output, what the node's text says it equals so
 * a reader elsewhere can be shown the definition.
 *
 * The rule is deliberately narrow so it is predictable without documentation: a
 * definition is exactly one top-level equality with a single symbol on its left.
 * An author who writes an equation gets the behavior they expect; an author who
 * writes prose with a stray letter in it gets nothing, because a bare mention
 * has no equality.
 *
 * Delimiter choice does not decide this. Requiring `$$` to define looked tidy
 * from inside the parser, but `$x = 1$` reads as a definition to anyone writing
 * it, and treating it as a reference made the quantity it introduced report as
 * undefined — the node blamed itself for not defining what it had just defined.
 * Whether math is set inline or on its own line is a typographic choice, not a
 * semantic one.
 */

import { renderMath, type MathNode } from '../../MathText/lib/mathRender';
import { splitMathSegments } from '../../MathText/lib/mathSegments';
import {
	canonicalExpressionKey,
	collectSymbolsFromNodes,
	singleSymbolOf,
	topLevelChildren,
	type QuantitySymbol,
	type SymbolExtractionOptions
} from '../../MathText/lib/mathSymbols';

/**
 * Tag that excludes a node from the dataflow layer entirely: no suggestions here,
 * and no edges from its confirmed designations either — the index applies the
 * same tag to those. One tag, one meaning: this node does not participate.
 */
export const DEFAULT_DATAFLOW_OPT_OUT_TAG = 'no-dataflow';

export interface QuantityDefinition {
	symbol: QuantitySymbol;
	/**
	 * Identifies what this definition says, so two statements about one quantity
	 * can be told apart. Restating a definition is ordinary writing; stating it
	 * two different ways is a contradiction, and only the body distinguishes them.
	 */
	bodyKey: string;
	/**
	 * The LaTeX the author wrote, delimiters stripped. `bodyKey` is a canonical
	 * identity with whitespace and invisible operators thrown away — useful for
	 * telling two claims apart, unusable for showing one to a reader. This is what
	 * a peek card renders.
	 */
	sourceTex: string;
	/** Whether the author set this math on its own line, so it re-renders as written. */
	displayMode: boolean;
}

export interface NodeQuantities {
	/**
	 * Quantities this node introduces, in document order.
	 *
	 * A quantity appears more than once only when the node defines it in more than
	 * one way, which is the node contradicting itself.
	 */
	defines: QuantityDefinition[];
	/** Quantities this node consumes but does not define. */
	references: QuantitySymbol[];
}

export interface NodeQuantitiesOptions extends SymbolExtractionOptions {
	optOutTag?: string;
}

export interface QuantityBearingNode {
	/**
	 * Read on the same terms as the description. A node titled `$x = 1$` has
	 * defined `x` by any reading, and a rule that says otherwise gets discovered
	 * as a bug rather than learned.
	 */
	title?: string;
	description: string;
	tags: string[];
	/**
	 * LaTeX this node states that is in neither its title nor its description —
	 * today, the numbers an `!ai` run reported, rendered by the add-on that owns
	 * them.
	 *
	 * Bare expressions, already rendered: no `$` delimiters, because there is no
	 * prose around them to delimit. Each is read as one display-mode segment on
	 * exactly the terms a written equation gets, which is what makes a reported
	 * `R_{th} = 12.3` a definition without this module knowing an add-on exists.
	 * Producers hand over strings; nothing here asks where they came from.
	 */
	derivedMath?: readonly string[];
}

const EMPTY: NodeQuantities = { defines: [], references: [] };

function isEquality(node: MathNode | undefined): boolean {
	if (node?.type !== 'mo') {
		return false;
	}
	return (node.children ?? []).map((child) => child.text ?? '').join('') === '=';
}

function dedupe(symbols: readonly QuantitySymbol[]): QuantitySymbol[] {
	const seen = new Set<string>();
	return symbols.filter((symbol) => {
		if (seen.has(symbol.key)) {
			return false;
		}
		seen.add(symbol.key);
		return true;
	});
}

/**
 * Collapse restatements, keep contradictions.
 *
 * Writing `$x = 1$` in the title and again in the description is one claim made
 * twice, so it collapses. Writing `$x = 1$` and `$x = 2$` is two claims, and both
 * survive so the conflict is visible downstream.
 *
 * Identity is the symbol and the canonical body, deliberately not `sourceTex`:
 * restating one claim with different spacing is still one claim, and the first
 * spelling is the one that gets rendered.
 */
function dedupeDefinitions(definitions: readonly QuantityDefinition[]): QuantityDefinition[] {
	const seen = new Set<string>();
	return definitions.filter((definition) => {
		const identity = `${definition.symbol.key}\u0000${definition.bodyKey}`;
		if (seen.has(identity)) {
			return false;
		}
		seen.add(identity);
		return true;
	});
}

/**
 * Split an expression into the symbol it defines and the symbols it consumes,
 * or null when it defines nothing.
 */
function definitionOf(
	children: readonly MathNode[],
	options: SymbolExtractionOptions
): { defined: QuantitySymbol; bodyKey: string; consumed: QuantitySymbol[] } | null {
	const equalityIndices = children.reduce<number[]>((indices, node, index) => {
		if (isEquality(node)) {
			indices.push(index);
		}
		return indices;
	}, []);

	// `x = y = z` states a chain rather than introducing one quantity, so it
	// defines nothing rather than arbitrarily picking the first left-hand side.
	if (equalityIndices.length !== 1) {
		return null;
	}

	const splitAt = equalityIndices[0];
	const defined = singleSymbolOf(children.slice(0, splitAt), options);
	if (defined === null) {
		return null;
	}

	const body = children.slice(splitAt + 1);
	return {
		defined,
		bodyKey: canonicalExpressionKey(body),
		consumed: collectSymbolsFromNodes(body, options)
	};
}

/** One expression to read, and how it was set. */
interface MathExpression {
	/** The LaTeX between the delimiters, or a `derivedMath` entry verbatim. */
	content: string;
	displayMode: boolean;
}

/**
 * Every expression this node states, in the order a reader meets them.
 *
 * Title first, so a node that defines a quantity in its title and elaborates in
 * its description reports them in the order they are read; `derivedMath` last,
 * because it is what the node turned out to say rather than what the author
 * wrote — a written definition should be the one whose spelling gets rendered
 * when the two agree.
 *
 * `derivedMath` entries skip the delimiter scan entirely: they are already
 * expressions, so wrapping them in `$$` only to split them back out would make
 * a `$` inside a rendered unit change what the whole entry means.
 */
function mathExpressionsOf(node: QuantityBearingNode): MathExpression[] {
	const texts = node.title ? [node.title, node.description] : [node.description];
	const written = texts
		.flatMap(splitMathSegments)
		.flatMap((segment) =>
			segment.kind === 'text'
				? []
				: [{ content: segment.content, displayMode: segment.kind === 'display-math' }]
		);

	return [
		...written,
		...(node.derivedMath ?? []).map((content) => ({ content, displayMode: true }))
	];
}

/**
 * Quantities defined and referenced by one node — its title, its description,
 * and whatever `derivedMath` an add-on produced for it, all on the same terms.
 *
 * A node never references what it defines: a definition that mentions its own
 * symbol on the right, as in `v = v + 1`, is a statement about that quantity
 * rather than a dependency on another node.
 */
export function nodeQuantities(
	node: QuantityBearingNode,
	options: NodeQuantitiesOptions = {}
): NodeQuantities {
	const { optOutTag = DEFAULT_DATAFLOW_OPT_OUT_TAG, ...symbolOptions } = options;

	if (node.tags.includes(optOutTag)) {
		return EMPTY;
	}

	const defines: QuantityDefinition[] = [];
	const references: QuantitySymbol[] = [];

	for (const expression of mathExpressionsOf(node)) {
		const { content, displayMode } = expression;
		const rendered = renderMath(content, { displayMode });
		// Invalid math contributes nothing rather than guessing at the author's
		// intent; the edit sheet preview is where they find out it did not parse.
		if (!rendered.ok) {
			continue;
		}

		const children = topLevelChildren(rendered.tree);

		const definition = definitionOf(children, symbolOptions);
		if (definition !== null) {
			defines.push({
				symbol: definition.defined,
				bodyKey: definition.bodyKey,
				sourceTex: content,
				displayMode
			});
			references.push(...definition.consumed);
			continue;
		}

		references.push(...collectSymbolsFromNodes(children, symbolOptions));
	}

	const definedKeys = new Set(defines.map((definition) => definition.symbol.key));
	return {
		defines: dedupeDefinitions(defines),
		references: dedupe(references).filter((symbol) => !definedKeys.has(symbol.key))
	};
}
