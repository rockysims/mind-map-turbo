/**
 * Decide which quantities a single node defines and which it merely references.
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
	collectSymbolsFromNodes,
	singleSymbolOf,
	topLevelChildren,
	type QuantitySymbol,
	type SymbolExtractionOptions
} from '../../MathText/lib/mathSymbols';

/** Tag that excludes a node from the dataflow layer entirely. */
export const DEFAULT_DATAFLOW_OPT_OUT_TAG = 'no-dataflow';

export interface NodeQuantities {
	/** Quantities this node introduces, in document order. */
	defines: QuantitySymbol[];
	/** Quantities this node consumes but does not define. */
	references: QuantitySymbol[];
}

export interface NodeQuantitiesOptions extends SymbolExtractionOptions {
	optOutTag?: string;
}

export interface QuantityBearingNode {
	description: string;
	tags: string[];
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
 * Split an expression into the symbol it defines and the symbols it consumes,
 * or null when it defines nothing.
 */
function definitionOf(
	children: readonly MathNode[],
	options: SymbolExtractionOptions
): { defined: QuantitySymbol; consumed: QuantitySymbol[] } | null {
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

	return { defined, consumed: collectSymbolsFromNodes(children.slice(splitAt + 1), options) };
}

/**
 * Quantities defined and referenced by one node's description.
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

	const defines: QuantitySymbol[] = [];
	const references: QuantitySymbol[] = [];

	for (const segment of splitMathSegments(node.description)) {
		if (segment.kind === 'text') {
			continue;
		}

		const rendered = renderMath(segment.content, {
			displayMode: segment.kind === 'display-math'
		});
		// Invalid math contributes nothing rather than guessing at the author's
		// intent; the edit sheet preview is where they find out it did not parse.
		if (!rendered.ok) {
			continue;
		}

		const children = topLevelChildren(rendered.tree);

		const definition = definitionOf(children, symbolOptions);
		if (definition !== null) {
			defines.push(definition.defined);
			references.push(...definition.consumed);
			continue;
		}

		references.push(...collectSymbolsFromNodes(children, symbolOptions));
	}

	const definedKeys = new Set(defines.map((symbol) => symbol.key));
	return {
		defines: dedupe(defines),
		references: dedupe(references).filter((symbol) => !definedKeys.has(symbol.key))
	};
}
