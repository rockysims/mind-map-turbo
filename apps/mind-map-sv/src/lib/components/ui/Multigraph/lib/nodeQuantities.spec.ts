import { describe, expect, it } from 'vitest';
import {
	nodeQuantities,
	DEFAULT_DATAFLOW_OPT_OUT_TAG,
	type NodeQuantitiesOptions,
	type QuantityBearingNode
} from './nodeQuantities';

function node(description: string, tags: string[] = []): QuantityBearingNode {
	return { description, tags };
}

function defines(description: string, options?: NodeQuantitiesOptions): string[] {
	return nodeQuantities(node(description), options).defines.map(
		(definition) => definition.symbol.label
	);
}

function references(description: string, options?: NodeQuantitiesOptions): string[] {
	return nodeQuantities(node(description), options).references.map((symbol) => symbol.label);
}

describe('nodeQuantities definitions', () => {
	it('defines the left side of a display equation', () => {
		expect(defines('$$F = ma$$')).toEqual(['F']);
	});

	it('references the right side of a display equation', () => {
		expect(references('$$F = ma$$')).toEqual(['m', 'a']);
	});

	it('defines a subscripted symbol', () => {
		expect(defines('$$v_0 = 3$$')).toEqual(['v_0']);
	});

	it('defines nothing when the left side has several symbols', () => {
		expect(defines('$$a + b = c$$')).toEqual([]);
	});

	it('references everything when the left side is not a single symbol', () => {
		expect(references('$$a + b = c$$')).toEqual(['a', 'b', 'c']);
	});

	it('defines nothing for a chained equality', () => {
		expect(defines('$$x = y = z$$')).toEqual([]);
	});

	it('defines nothing for a display expression with no equality', () => {
		expect(defines('$$a + b$$')).toEqual([]);
	});

	it('defines each of several display equations independently', () => {
		expect(defines('$$F = ma$$ and $$E = mc^2$$')).toEqual(['F', 'E']);
	});

	it('ignores an equality nested under summation limits', () => {
		expect(defines('$$S = \\sum_{i=1}^{n} x_i$$')).toEqual(['S']);
	});

	it('does not define from a multi-letter left side, which math mode reads as a product', () => {
		// `acc` is a·c·c in math mode, not one identifier. Quantity names are
		// therefore single letters, optionally subscripted; `\mathrm{acc}` is the
		// way to write a multi-letter name.
		expect(defines('$$acc = 9.8$$')).toEqual([]);
	});

	it('defines a multi-letter name written as an upright identifier', () => {
		expect(defines('$$\\mathrm{acc} = 9.8$$')).toEqual(['acc']);
	});
});

describe('nodeQuantities inline math', () => {
	// Delimiters are a typographic choice, not a semantic one. Requiring `$$` to
	// define made `$x = 1$` report the quantity it introduced as undefined.
	it('defines from inline math on the same terms as display math', () => {
		expect(defines('$F = ma$')).toEqual(['F']);
	});

	it('references only the right side of an inline definition', () => {
		expect(references('$F = ma$')).toEqual(['m', 'a']);
	});

	it('reads the same equation identically inline and in display', () => {
		expect(defines('$x = 1$')).toEqual(defines('$$x = 1$$'));
		expect(references('$y = x$')).toEqual(references('$$y = x$$'));
	});

	it('references a bare inline symbol without defining it', () => {
		expect(defines('velocity $v$ matters')).toEqual([]);
		expect(references('velocity $v$ matters')).toEqual(['v']);
	});

	// The prose guard is the equality, not the delimiter: a mention has none.
	it('defines nothing from an inline expression with no equality', () => {
		expect(defines('the product $ma$ appears')).toEqual([]);
		expect(references('the product $ma$ appears')).toEqual(['m', 'a']);
	});
});

describe('nodeQuantities self-reference', () => {
	it('does not reference a quantity it defines in the same equation', () => {
		expect(references('$$v = v + 1$$')).toEqual([]);
	});

	it('does not reference a quantity it defines in another segment', () => {
		expect(references('$$F = ma$$ where $F$ is force')).toEqual(['m', 'a']);
	});

	it('still defines the quantity that appears on both sides', () => {
		expect(defines('$$v = v + 1$$')).toEqual(['v']);
	});
});

describe('nodeQuantities exclusions', () => {
	it('yields nothing for a description with no math', () => {
		expect(nodeQuantities(node('Just prose about velocity.'))).toEqual({
			defines: [],
			references: []
		});
	});

	it('yields nothing for an empty description', () => {
		expect(nodeQuantities(node(''))).toEqual({ defines: [], references: [] });
	});

	it('ignores math that fails to parse', () => {
		expect(nodeQuantities(node('$$\\frac{1}{$$'))).toEqual({ defines: [], references: [] });
	});

	it('keeps parsing later segments after an invalid one', () => {
		expect(defines('$$\\frac{1}{$$ then $$F = ma$$')).toEqual(['F']);
	});

	it('never reads prose inside a text span', () => {
		expect(references('$$\\text{speed} = d$$')).toEqual(['d']);
	});

	it('does not define from a text-span left side', () => {
		expect(defines('$$\\text{speed} = d$$')).toEqual([]);
	});

	it('excludes stoplisted constants', () => {
		expect(references('$$C = 2 \\pi r$$')).toEqual(['r']);
	});

	it('excludes function names', () => {
		expect(references('$$y = \\sin x$$')).toEqual(['x']);
	});
});

describe('nodeQuantities opt-out', () => {
	it('yields nothing for an opted-out node', () => {
		expect(nodeQuantities(node('$$F = ma$$', [DEFAULT_DATAFLOW_OPT_OUT_TAG]))).toEqual({
			defines: [],
			references: []
		});
	});

	it('honours a custom opt-out tag', () => {
		expect(nodeQuantities(node('$$F = ma$$', ['scratch']), { optOutTag: 'scratch' })).toEqual({
			defines: [],
			references: []
		});
	});

	it('does not opt out a node carrying the default tag when the tag is overridden', () => {
		expect(
			nodeQuantities(node('$$F = ma$$', [DEFAULT_DATAFLOW_OPT_OUT_TAG]), {
				optOutTag: 'scratch'
			}).defines.map((definition) => definition.symbol.label)
		).toEqual(['F']);
	});
});

describe('nodeQuantities deduplication', () => {
	it('lists a repeated reference once', () => {
		expect(references('$$y = a x + a z$$')).toEqual(['a', 'x', 'z']);
	});

	it('lists a definition restated identically once', () => {
		expect(defines('$$v = 1$$ and again $$v = 1$$')).toEqual(['v']);
	});

	// Both survive so the contradiction is visible downstream. Collapsing them
	// silently discarded the second statement, which is how `$x = 1$` and
	// `$x = 2$` in one node used to report no conflict at all.
	it('keeps both statements when a node defines a symbol two different ways', () => {
		expect(defines('$$v = 1$$ and again $$v = 2$$')).toEqual(['v', 'v']);
	});

	it('distinguishes the two statements by their bodies', () => {
		const bodies = nodeQuantities(node('$$v = 1$$ and again $$v = 2$$')).defines.map(
			(definition) => definition.bodyKey
		);
		expect(new Set(bodies).size).toBe(2);
	});

	it('treats spacing differences as one statement rather than a contradiction', () => {
		expect(defines('$$v = a+b$$ and again $$v = a + b$$')).toEqual(['v']);
	});
});

// `bodyKey` says whether two definitions agree; it cannot be rendered. A reader
// looking at a consumer node is shown the definition itself, which means keeping
// the LaTeX the author wrote and how they set it.
describe('nodeQuantities definition source', () => {
	it('keeps the inner LaTeX of an inline definition', () => {
		const [definition] = nodeQuantities(node('$x = 1$')).defines;
		expect(definition.sourceTex).toBe('x = 1');
		expect(definition.displayMode).toBe(false);
	});

	it('keeps the inner LaTeX of a display definition', () => {
		const [definition] = nodeQuantities(node('$$x = 1$$')).defines;
		expect(definition.sourceTex).toBe('x = 1');
		expect(definition.displayMode).toBe(true);
	});

	it('keeps the source of a definition written in a title', () => {
		const [definition] = nodeQuantities({ title: '$$F = ma$$', description: '', tags: [] }).defines;
		expect(definition.sourceTex).toBe('F = ma');
		expect(definition.displayMode).toBe(true);
	});

	it('keeps spacing the author wrote, which bodyKey discards', () => {
		const [definition] = nodeQuantities(node('$$v = a + b$$')).defines;
		expect(definition.sourceTex).toBe('v = a + b');
		expect(definition.bodyKey).toBe('a+b');
	});

	it('gives each of two contradicting statements its own source', () => {
		expect(
			nodeQuantities(node('$$v = 1$$ and again $$v = 2$$')).defines.map(
				(definition) => definition.sourceTex
			)
		).toEqual(['v = 1', 'v = 2']);
	});
});

describe('nodeQuantities titles', () => {
	function titled(title: string, description = '') {
		return nodeQuantities({ title, description, tags: [] });
	}

	function labels(entries: ({ label: string } | { symbol: { label: string } })[]): string[] {
		return entries.map((entry) => ('symbol' in entry ? entry.symbol.label : entry.label));
	}

	// A title is read on the same terms as a description. Giving titles their own
	// rule would repeat the mistake that made `$x = 1$` in a description define
	// nothing and then report itself undefined.
	it('defines from a title', () => {
		expect(labels(titled('$x = 1$').defines)).toEqual(['x']);
	});

	it('reads a title identically to the same text in a description', () => {
		expect(labels(titled('$y = x$').defines)).toEqual(
			labels(nodeQuantities({ description: '$y = x$', tags: [] }).defines)
		);
	});

	it('references from a title', () => {
		expect(labels(titled('$w = m g$').references)).toEqual(['m', 'g']);
	});

	it('combines a title definition with description references', () => {
		const quantities = titled('$w$ is weight', 'where $w = m g$');
		expect(labels(quantities.defines)).toEqual(['w']);
		expect(labels(quantities.references)).toEqual(['m', 'g']);
	});

	// The guard against decorative math is the equality, exactly as for
	// descriptions. A title naming a quantity is not a claim about its value.
	it('defines nothing from a decorative title', () => {
		expect(labels(titled('Energy $E$').defines)).toEqual([]);
		expect(labels(titled('Energy $E$').references)).toEqual(['E']);
	});

	it('ignores a title with no math', () => {
		expect(labels(titled('Kinematics', '$$a = 2$$').defines)).toEqual(['a']);
	});

	it('honours the opt-out tag for titles too', () => {
		const quantities = nodeQuantities({
			title: '$x = 1$',
			description: '',
			tags: [DEFAULT_DATAFLOW_OPT_OUT_TAG]
		});
		expect(quantities.defines).toEqual([]);
	});

	it('treats a missing title as no title', () => {
		expect(nodeQuantities({ description: '$$a = 1$$', tags: [] }).defines).toHaveLength(1);
	});

	// Restating the definition in the title and the description is how a person
	// writes a node about one quantity, not a claim that there are two of them.
	it('defines a quantity once when the title and description agree', () => {
		expect(labels(titled('$x = 1$', 'Restated: $x = 1$').defines)).toEqual(['x']);
	});

	it('defines a quantity once even when the two forms differ', () => {
		// `x_0` and `x_{0}` canonicalize to the same symbol, so restating one as the
		// other must not look like a second definition either.
		expect(labels(titled('$x_0 = 1$', '$x_{0} = 1$').defines)).toHaveLength(1);
	});

	it('does not count a title definition as a reference in the description', () => {
		expect(labels(titled('$x = 1$', 'and $x$ again').references)).toEqual([]);
	});
});

// `derivedMath` is the third source: LaTeX a node states that its author never
// typed — today, the numbers an `!ai` run reported. It is read on exactly the
// terms the other two are, which is the point: nothing in this module knows an
// add-on exists, and a produced equation is as good as a written one.
describe('nodeQuantities derived math', () => {
	function derived(derivedMath: string[], description = '', tags: string[] = []) {
		return nodeQuantities({ description, tags, derivedMath });
	}

	function labelsOf(quantities: { defines: { symbol: { label: string } }[] }): string[] {
		return quantities.defines.map((definition) => definition.symbol.label);
	}

	it('defines a quantity from a derived entry', () => {
		expect(labelsOf(derived(['R_{th} = 12.3']))).toEqual(['R_th']);
	});

	it('references the right side of a derived definition', () => {
		expect(derived(['w = m g']).references.map((symbol) => symbol.label)).toEqual(['m', 'g']);
	});

	it('reads a derived entry as display math, so it re-renders as one', () => {
		const [definition] = derived(['R_{th} = 12.3']).defines;
		expect(definition.displayMode).toBe(true);
		expect(definition.sourceTex).toBe('R_{th} = 12.3');
	});

	it('reads a bare entry, without delimiters, the way a delimited one reads', () => {
		expect(labelsOf(derived(['x = 1']))).toEqual(labelsOf(nodeQuantities(node('$$x = 1$$'))));
	});

	// The quantity a run reported is a quantity this node defines, so a
	// description that goes on to talk about it is elaborating rather than
	// depending on somebody else — the same rule a title definition already gets.
	it('does not count a description mention of a derived definition as a reference', () => {
		const quantities = derived(['R_{th} = 12.3'], 'The measured $R_{th}$ is high.');
		expect(labelsOf(quantities)).toEqual(['R_th']);
		expect(quantities.references).toEqual([]);
	});

	it('lets a description reference a symbol the derived entry consumes', () => {
		const quantities = derived(['w = m g'], 'Mass $m$ comes from the bench sheet.');
		expect(quantities.references.map((symbol) => symbol.label)).toEqual(['m', 'g']);
	});

	it('reads derived entries after the title and the description', () => {
		const quantities = nodeQuantities({
			title: '$a = 1$',
			description: '$b = 2$',
			tags: [],
			derivedMath: ['c = 3']
		});
		expect(labelsOf(quantities)).toEqual(['a', 'b', 'c']);
	});

	it('defines each of several derived entries', () => {
		expect(labelsOf(derived(['x = 1', 'y = 2']))).toEqual(['x', 'y']);
	});

	it('ignores a derived entry that does not parse', () => {
		expect(labelsOf(derived(['\\frac{1}{', 'x = 1']))).toEqual(['x']);
	});

	it('ignores a derived entry with no equality', () => {
		expect(labelsOf(derived(['12.3']))).toEqual([]);
	});

	it('treats a missing derivedMath as none', () => {
		expect(nodeQuantities({ description: '$$a = 1$$', tags: [] }).defines).toHaveLength(1);
	});

	// Milestone 09's within-node conflict, now reachable a second way: what the
	// author wrote and what the run measured are two claims about one quantity,
	// and collapsing them would hide the disagreement this state exists to show.
	it('keeps both statements when the text and a derived entry disagree', () => {
		expect(labelsOf(derived(['R = 2'], '$$R = 1$$'))).toEqual(['R', 'R']);
	});

	it('distinguishes the disagreeing statements by their bodies', () => {
		const bodies = derived(['R = 2'], '$$R = 1$$').defines.map((definition) => definition.bodyKey);
		expect(new Set(bodies).size).toBe(2);
	});

	// Restating is not disagreeing: a run reporting what the node already says is
	// one claim made twice, exactly as a title and a description agreeing are.
	it('collapses a derived entry that restates what the text says', () => {
		expect(labelsOf(derived(['R = 1'], '$$R = 1$$'))).toEqual(['R']);
	});

	// One tag, one meaning. A node opted out of the dataflow layer contributes
	// nothing, and a source it did not type is not an exception to that.
	it('suppresses derived entries for an opted-out node', () => {
		expect(derived(['R_{th} = 12.3'], '', [DEFAULT_DATAFLOW_OPT_OUT_TAG])).toEqual({
			defines: [],
			references: []
		});
	});

	it('honours a custom opt-out tag for derived entries too', () => {
		expect(
			nodeQuantities(
				{ description: '', tags: ['scratch'], derivedMath: ['R_{th} = 12.3'] },
				{ optOutTag: 'scratch' }
			)
		).toEqual({ defines: [], references: [] });
	});

	// The unit a run reports arrives inside `\text{}`, which the symbol reader
	// already refuses to look into — so a definition survives its own unit.
	it('defines from a rendered result carrying a unit', () => {
		expect(labelsOf(derived(['R_{th} = 12.3\\ \\text{K/W}']))).toEqual(['R_th']);
	});
});
