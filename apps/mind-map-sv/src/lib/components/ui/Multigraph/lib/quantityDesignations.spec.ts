import { describe, expect, it } from 'vitest';
import {
	cycleDesignation,
	designateAs,
	designationView,
	type DesignationChip
} from './quantityDesignations';
import { nodeQuantities, type NodeQuantities } from './nodeQuantities';
import { symbolFor } from '../../MathText/lib/mathSymbols';
import type { QuantityDesignation } from '../../types/node';

function parse(description: string, tags: string[] = []): NodeQuantities {
	return nodeQuantities({ description, tags });
}

function designation(base: string, subscript: string | null = null): QuantityDesignation {
	return { base, subscript };
}

function labels(chips: readonly DesignationChip[]): string[] {
	return chips.map((chip) => chip.symbol.label);
}

const EMPTY: NodeQuantities = { defines: [], references: [] };

describe('designationView', () => {
	it('puts a confirmed output in the output column', () => {
		const view = designationView(parse('$$F = m a$$'), undefined, [designation('F')]);

		expect(labels(view.outputs)).toEqual(['F']);
		expect(view.outputs[0].role).toBe('output');
		expect(view.inputs).toEqual([]);
	});

	it('puts a confirmed input in the input column', () => {
		const view = designationView(parse('$$F = m a$$'), [designation('m')], undefined);

		expect(labels(view.inputs)).toEqual(['m']);
		expect(view.inputs[0].role).toBe('input');
	});

	it('offers everything undesignated as a suggestion', () => {
		const view = designationView(parse('$$F = m a$$'), undefined, undefined);

		expect(labels(view.suggestions)).toEqual(['F', 'm', 'a']);
		expect(view.suggestions.every((chip) => chip.role === 'suggestion')).toBe(true);
	});

	it('suggests a parsed definition as an output', () => {
		const view = designationView(parse('$$F = m a$$'), undefined, undefined);

		expect(view.suggestions.find((chip) => chip.symbol.label === 'F')?.suggestedRole).toBe(
			'output'
		);
	});

	it('suggests a parsed mention as an input', () => {
		const view = designationView(parse('$$F = m a$$'), undefined, undefined);

		expect(view.suggestions.find((chip) => chip.symbol.label === 'm')?.suggestedRole).toBe('input');
	});

	it('drops a symbol from the suggestions once it is designated either way', () => {
		const view = designationView(parse('$$F = m a$$'), [designation('m')], [designation('F')]);

		expect(labels(view.suggestions)).toEqual(['a']);
	});

	it('does not flag a designation the text still supports', () => {
		const view = designationView(parse('$$F = m a$$'), undefined, [designation('F')]);

		expect(view.outputs[0].stale).toBe(false);
	});

	it('flags a designation whose symbol the text no longer mentions', () => {
		const view = designationView(parse('Reworded, no math left.'), undefined, [designation('F')]);

		expect(view.outputs[0].stale).toBe(true);
	});

	it('keeps a stale designation in its own column', () => {
		const view = designationView(EMPTY, [designation('m')], [designation('F')]);

		expect(labels(view.inputs)).toEqual(['m']);
		expect(labels(view.outputs)).toEqual(['F']);
	});

	it('gives a stale designation a symbol with the key extraction would have produced', () => {
		const view = designationView(EMPTY, undefined, [designation('v', '0')]);

		expect(view.outputs[0].symbol.key).toBe(symbolFor('v', '0').key);
		expect(view.outputs[0].symbol.label).toBe('v_0');
	});

	it('reuses the parsed symbol object for a designation the text supports', () => {
		const parsed = parse('$$F = m a$$');
		const view = designationView(parsed, undefined, [designation('F')]);

		expect(view.outputs[0].symbol).toBe(parsed.defines[0].symbol);
	});

	it('collapses a designation repeated in one column', () => {
		const view = designationView(EMPTY, [designation('m'), designation('m')], undefined);

		expect(labels(view.inputs)).toEqual(['m']);
	});

	it('preserves the order designations were confirmed in', () => {
		const view = designationView(
			parse('$$F = m a$$'),
			[designation('a'), designation('m')],
			undefined
		);

		expect(labels(view.inputs)).toEqual(['a', 'm']);
	});

	it('keeps a quantity designated both ways in both columns', () => {
		const view = designationView(EMPTY, [designation('x')], [designation('x')]);

		expect(labels(view.inputs)).toEqual(['x']);
		expect(labels(view.outputs)).toEqual(['x']);
		expect(view.suggestions).toEqual([]);
	});

	it('tells a subscripted quantity apart from a base that looks like it', () => {
		const view = designationView(parse('$$v_0 = 3$$'), undefined, [designation('v_0')]);

		// `v_0` as a bare base is a different quantity from `v` subscript `0`, so
		// the designation is stale and the parsed symbol is still on offer.
		expect(view.outputs[0].stale).toBe(true);
		expect(labels(view.suggestions)).toEqual(['v_0']);
		expect(view.suggestions[0].symbol.subscript).toBe('0');
	});

	it('matches a subscripted designation against the parsed subscripted symbol', () => {
		const view = designationView(parse('$$v_0 = 3$$'), undefined, [designation('v', '0')]);

		expect(view.outputs[0].stale).toBe(false);
		expect(view.suggestions).toEqual([]);
	});

	it('offers nothing for a node excluded from dataflow', () => {
		const view = designationView(parse('$$F = m a$$', ['no-dataflow']), undefined, undefined);

		expect(view.suggestions).toEqual([]);
	});
});

describe('designateAs', () => {
	it('assigns an unassigned quantity to the named column', () => {
		const next = designateAs({}, symbolFor('g', null), 'output');

		expect(next.outputs).toEqual([designation('g')]);
		expect(next.inputs).toEqual([]);
	});

	it('moves a confirmed input into the output column', () => {
		const next = designateAs({ inputs: [designation('g')] }, symbolFor('g', null), 'output');

		expect(next.inputs).toEqual([]);
		expect(next.outputs).toEqual([designation('g')]);
	});

	it('moves a confirmed output into the input column', () => {
		const next = designateAs({ outputs: [designation('g')] }, symbolFor('g', null), 'input');

		expect(next.outputs).toEqual([]);
		expect(next.inputs).toEqual([designation('g')]);
	});

	/**
	 * The reason this function exists rather than a call to the cycle. "Confirm
	 * this node as the definer" has to mean the same thing however the node got
	 * where it is — and from an input, which is two taps away from any ghost chip,
	 * the cycle's next stop is unassigned. A confirm built on it would sometimes
	 * unconfirm the thing it was pointed at.
	 */
	it('is idempotent exactly where the cycle would unassign', () => {
		const fromInput = { inputs: [designation('g')], outputs: [] };

		expect(designateAs(fromInput, symbolFor('g', null), 'output').outputs).toEqual([
			designation('g')
		]);
		expect(cycleDesignation(fromInput, symbolFor('g', null), 'output').outputs).toEqual([]);
	});

	it('says the same thing twice when pressed twice', () => {
		const once = designateAs({}, symbolFor('g', null), 'output');
		const twice = designateAs(once, symbolFor('g', null), 'output');

		expect(twice).toEqual(once);
	});

	it('collapses a quantity designated both ways into the named column', () => {
		const next = designateAs(
			{ inputs: [designation('x')], outputs: [designation('x')] },
			symbolFor('x', null),
			'output'
		);

		expect(next.inputs).toEqual([]);
		expect(next.outputs).toEqual([designation('x')]);
	});

	it('collapses a repeated designation into one entry', () => {
		const next = designateAs(
			{ outputs: [designation('x'), designation('x')] },
			symbolFor('x', null),
			'output'
		);

		expect(next.outputs).toEqual([designation('x')]);
	});

	it('leaves untouched entries in their order', () => {
		const next = designateAs(
			{
				inputs: [designation('a'), designation('m'), designation('t')],
				outputs: [designation('F')]
			},
			symbolFor('m', null),
			'output'
		);

		expect(next.inputs).toEqual([designation('a'), designation('t')]);
		expect(next.outputs).toEqual([designation('F'), designation('m')]);
	});

	it('confirms a subscripted quantity by its structural identity', () => {
		const next = designateAs({ inputs: [designation('v', '0')] }, symbolFor('v', '0'), 'output');

		expect(next.inputs).toEqual([]);
		expect(next.outputs).toEqual([designation('v', '0')]);
	});
});

describe('cycleDesignation', () => {
	it('makes an unassigned quantity an input', () => {
		const next = cycleDesignation({}, symbolFor('F', null));

		expect(next.inputs).toEqual([designation('F')]);
		expect(next.outputs).toEqual([]);
	});

	it('promotes an input to an output', () => {
		const next = cycleDesignation({ inputs: [designation('F')] }, symbolFor('F', null));

		expect(next.inputs).toEqual([]);
		expect(next.outputs).toEqual([designation('F')]);
	});

	it('releases an output back to unassigned', () => {
		const next = cycleDesignation({ outputs: [designation('F')] }, symbolFor('F', null));

		expect(next.inputs).toEqual([]);
		expect(next.outputs).toEqual([]);
	});

	it('returns to the starting state after three taps', () => {
		const start = { inputs: [designation('m')], outputs: [designation('F')] };
		let io = cycleDesignation(start, symbolFor('t', null));
		io = cycleDesignation(io, symbolFor('t', null));
		io = cycleDesignation(io, symbolFor('t', null));

		expect(io.inputs).toEqual(start.inputs);
		expect(io.outputs).toEqual(start.outputs);
	});

	it('releases a quantity designated both ways at once', () => {
		const next = cycleDesignation(
			{ inputs: [designation('x')], outputs: [designation('x')] },
			symbolFor('x', null)
		);

		expect(next.inputs).toEqual([]);
		expect(next.outputs).toEqual([]);
	});

	it('leaves untouched entries in their order', () => {
		const next = cycleDesignation(
			{ inputs: [designation('a'), designation('m'), designation('t')], outputs: [] },
			symbolFor('m', null)
		);

		expect(next.inputs).toEqual([designation('a'), designation('t')]);
		expect(next.outputs).toEqual([designation('m')]);
	});

	it('appends a newly promoted quantity after the outputs already confirmed', () => {
		const next = cycleDesignation(
			{ inputs: [designation('m')], outputs: [designation('F')] },
			symbolFor('m', null)
		);

		expect(next.outputs).toEqual([designation('F'), designation('m')]);
	});

	it('accepts a designation as well as a symbol', () => {
		const next = cycleDesignation({}, designation('v', '0'));

		expect(next.inputs).toEqual([designation('v', '0')]);
	});

	it('stores the structural identity rather than the symbol key', () => {
		const next = cycleDesignation({}, symbolFor('v', '0'));

		expect(next.inputs[0]).toEqual({ base: 'v', subscript: '0' });
	});

	it('cycles a subscripted quantity without touching a lookalike base', () => {
		const next = cycleDesignation({ inputs: [designation('v_0')] }, symbolFor('v', '0'));

		expect(next.inputs).toEqual([designation('v_0'), designation('v', '0')]);
	});

	it('does not mutate the designations it was given', () => {
		const inputs = [designation('m')];
		const io = { inputs, outputs: [] };
		cycleDesignation(io, symbolFor('m', null));

		expect(io.inputs).toEqual([designation('m')]);
		expect(io.inputs).toBe(inputs);
	});

	// The cycle enters at the suggested role: a ghost sitting in the output
	// column must land there on its first tap, not in the opposite column.
	it('confirms a suggested output in one tap', () => {
		const next = cycleDesignation({}, symbolFor('F', null), 'output');

		expect(next.outputs).toEqual([designation('F')]);
		expect(next.inputs).toEqual([]);
	});

	it('moves a confirmed suggested output to input on the second tap', () => {
		const next = cycleDesignation({ outputs: [designation('F')] }, symbolFor('F', null), 'output');

		expect(next.inputs).toEqual([designation('F')]);
		expect(next.outputs).toEqual([]);
	});

	it('returns an output-suggested quantity to unassigned after three taps', () => {
		let io = cycleDesignation({}, symbolFor('F', null), 'output');
		io = cycleDesignation(io, symbolFor('F', null), 'output');
		io = cycleDesignation(io, symbolFor('F', null), 'output');

		expect(io.inputs).toEqual([]);
		expect(io.outputs).toEqual([]);
	});
});

describe('designationView suggested roles on confirmed chips', () => {
	it('carries the parsed role so the cycle knows its entry point', () => {
		const view = designationView(parse('$$F = m a$$'), [designation('m')], [designation('F')]);

		expect(view.outputs[0].suggestedRole).toBe('output');
		expect(view.inputs[0].suggestedRole).toBe('input');
	});

	it('leaves the suggested role off a stale designation', () => {
		const view = designationView(EMPTY, [designation('m')], undefined);

		expect(view.inputs[0].suggestedRole).toBeUndefined();
	});
});
