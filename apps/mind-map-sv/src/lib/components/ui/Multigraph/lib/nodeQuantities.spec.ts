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
});

describe('nodeQuantities inline math', () => {
	it('never defines from inline math', () => {
		expect(defines('$F = ma$')).toEqual([]);
	});

	it('references every symbol in inline math, including the left side', () => {
		expect(references('$F = ma$')).toEqual(['F', 'm', 'a']);
	});

	it('references a bare inline symbol', () => {
		expect(references('velocity $v$ matters')).toEqual(['v']);
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
