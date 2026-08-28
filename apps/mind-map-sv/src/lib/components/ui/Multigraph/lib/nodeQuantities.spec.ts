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
	return nodeQuantities(node(description), options).defines.map((symbol) => symbol.label);
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
			}).defines.map((symbol) => symbol.label)
		).toEqual(['F']);
	});
});

describe('nodeQuantities deduplication', () => {
	it('lists a repeated reference once', () => {
		expect(references('$$y = a x + a z$$')).toEqual(['a', 'x', 'z']);
	});

	it('lists a symbol defined twice once', () => {
		expect(defines('$$v = 1$$ and again $$v = 2$$')).toEqual(['v']);
	});
});

describe('nodeQuantities titles', () => {
	function titled(title: string, description = '') {
		return nodeQuantities({ title, description, tags: [] });
	}

	function labels(symbols: { label: string }[]): string[] {
		return symbols.map((symbol) => symbol.label);
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
