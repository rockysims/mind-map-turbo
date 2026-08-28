/**
 * Flatten text containing math into a plain string.
 *
 * A title is drawn on the canvas but it is also the node's accessible name, two
 * sheet headings, a menu label, and what text search matches. Those all need a
 * string, and rendered math is not one — leaving LaTeX source in them would have
 * a screen reader announce "dollar v underscore zero dollar".
 *
 * The projection reads the rendered MathML rather than the source because Temml
 * has already resolved `\alpha` to `α`, which is what a person would say. The
 * source is the least readable of the available forms, and the dataflow layer's
 * canonical label is built for identity rather than for reading.
 */

import { renderMath } from './mathRender';
import type { MathNode } from './mathRender';
import { splitMathSegments } from './mathSegments';

/**
 * MathML marks function application and implicit multiplication with characters
 * that render as nothing. They would survive into an accessible name and into
 * search text as invisible junk that makes an exact match mysteriously fail.
 */
const INVISIBLE_OPERATORS = /[\u2061\u2062\u2063\u2064]/g;

function treeText(node: MathNode): string {
	if (typeof node.text === 'string') {
		return node.text;
	}
	return (node.children ?? []).map(treeText).join('');
}

/**
 * The plain-text form of text that may contain math.
 *
 * Returns the input unchanged, by identity, when there is no math at all. Every
 * visible node draws a title, so this runs far more often than the description
 * path ever did and the common case has to cost nothing.
 */
export function mathPlainText(text: string): string {
	if (!text.includes('$')) {
		return text;
	}

	return splitMathSegments(text)
		.map((segment) => {
			if (segment.kind === 'text') {
				return segment.content;
			}

			const rendered = renderMath(segment.content, {
				displayMode: segment.kind === 'display-math'
			});
			// Unparseable math falls back to its source. It is not readable, but it
			// is what the author typed, so it stays findable and self-explanatory
			// rather than vanishing from the title.
			if (!rendered.ok) {
				return segment.content;
			}

			return treeText(rendered.tree).replace(INVISIBLE_OPERATORS, '');
		})
		.join('');
}
