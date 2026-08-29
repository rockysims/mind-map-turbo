import { describe, expect, it } from 'vitest';
import {
	computeDataflowDiagnostics,
	referencesForNode,
	type DataflowDiagnostics,
	type DataflowDiagnosticsOptions
} from './dataflowDiagnostics';
import { deriveDataflowEdges } from './derivedEdges';
import { buildQuantityIndex, type IndexableNode } from './quantityIndex';
import { nodeQuantities } from './nodeQuantities';
import type { QuantitySymbol } from '../../MathText/lib/mathSymbols';
import type { QuantityDesignation } from '../../types/node';

function designationOf(symbol: QuantitySymbol): QuantityDesignation {
	return { base: symbol.base, subscript: symbol.subscript };
}

/**
 * A node whose designations say what its text says, standing in for an author who
 * confirmed every suggestion.
 *
 * Diagnostics are about confirmed inputs and outputs now, so a fixture that only
 * wrote math would report nothing at all. Confirming everything keeps each
 * scenario below saying what it always said.
 */
function designated(node: IndexableNode): IndexableNode {
	const parsed = nodeQuantities(node);
	return {
		...node,
		inputs: parsed.references.map(designationOf),
		outputs: parsed.defines.map((definition) => designationOf(definition.symbol))
	};
}

function node(id: string, description: string, tags: string[] = []): IndexableNode {
	return designated({ id, description, tags });
}

function diagnose(
	nodes: readonly IndexableNode[],
	options?: DataflowDiagnosticsOptions
): DataflowDiagnostics {
	const index = buildQuantityIndex(nodes);
	return computeDataflowDiagnostics(index, deriveDataflowEdges(index), options);
}

function stateOf(diagnostics: DataflowDiagnostics, nodeId: string, label: string) {
	return referencesForNode(diagnostics, nodeId).find(
		(reference) => reference.symbol.label === label
	)?.state;
}

const chain: IndexableNode[] = [
	node('def', '$$g = 9.8$$'),
	node('use', '$$w = m g$$'),
	node('mass', '$$m = 5$$')
];

describe('reference states', () => {
	it('resolves a reference whose definer exists', () => {
		expect(stateOf(diagnose(chain), 'use', 'g')).toBe('resolved');
	});

	it('marks a reference with no definer anywhere as unresolved', () => {
		expect(stateOf(diagnose([node('solo', '$$E = m c^2$$')]), 'solo', 'm')).toBe('unresolved');
	});

	it('reports no definers for an unresolved reference', () => {
		const reference = referencesForNode(diagnose([node('solo', '$$E = m c^2$$')]), 'solo').find(
			(candidate) => candidate.symbol.label === 'm'
		);
		expect(reference?.definerNodeIds).toEqual([]);
	});

	it('marks a reference as out of view when its only definer is hidden', () => {
		const visibleNodeIds = new Set(['use', 'mass']);
		expect(stateOf(diagnose(chain, { visibleNodeIds }), 'use', 'g')).toBe('out-of-view');
	});

	it('keeps out of view distinct from unresolved', () => {
		const visibleNodeIds = new Set(['use', 'mass']);
		const diagnostics = diagnose(chain, { visibleNodeIds });
		expect(stateOf(diagnostics, 'use', 'g')).not.toBe('unresolved');
	});

	it('names the hidden definer so the user can reach it', () => {
		const visibleNodeIds = new Set(['use', 'mass']);
		const reference = referencesForNode(diagnose(chain, { visibleNodeIds }), 'use').find(
			(candidate) => candidate.symbol.label === 'g'
		);
		expect(reference?.definerNodeIds).toEqual(['def']);
	});

	it('resolves when at least one of several definers is visible', () => {
		const nodes = [node('one', '$$g = 9.8$$'), node('two', '$$g = 10$$'), node('use', '$$w = g$$')];
		const visibleNodeIds = new Set(['two', 'use']);
		expect(stateOf(diagnose(nodes, { visibleNodeIds }), 'use', 'g')).toBe('resolved');
	});

	it('treats every node as visible when no visible set is given', () => {
		expect(stateOf(diagnose(chain), 'use', 'g')).toBe('resolved');
	});

	// The affordance the render rule leans on: a derived edge is drawn only
	// between two visible endpoints, so when the definer is off screen there is no
	// arrow left and this is the only thing saying where the quantity comes from.
	// It reads the visible set and never edge visibility, so the rule cannot
	// quietly take it away too.
	it('still names a hidden definer that no arrow can point at', () => {
		// The chained-equation shape from the dataflow stories: `h1` and `h4` are on
		// screen a derived step out from `v`, and the `h3` between them is a second
		// step the budget did not pay for.
		const nodes = [
			node('v', '$$x = 3$$'),
			node('h1', '$$y = x$$'),
			node('h3', '$$z = y$$'),
			node('h4', '$$w = x + z$$')
		];
		const diagnostics = diagnose(nodes, { visibleNodeIds: new Set(['v', 'h1', 'h4']) });

		expect(stateOf(diagnostics, 'h4', 'z')).toBe('out-of-view');
		expect(
			referencesForNode(diagnostics, 'h4').find((reference) => reference.symbol.label === 'z')
				?.definerNodeIds
		).toEqual(['h3']);
		// The one it can follow on screen reads as it always did.
		expect(stateOf(diagnostics, 'h4', 'x')).toBe('resolved');
	});

	/**
	 * The in-between state. `use` needs g and `writer` writes it down without
	 * having confirmed it: reporting that as "not defined anywhere" is false, and
	 * the offer that came with it produced a second node saying the same thing.
	 */
	describe('a quantity written down but not confirmed', () => {
		const written = [
			node('use', '$$w = m g$$'),
			{ id: 'writer', description: '$$g = 9.8$$', tags: [] }
		];

		it('reads as unconfirmed rather than unresolved', () => {
			expect(stateOf(diagnose(written), 'use', 'g')).toBe('unconfirmed');
		});

		it('names the node whose text states it', () => {
			const reference = referencesForNode(diagnose(written), 'use').find(
				(candidate) => candidate.symbol.label === 'g'
			);
			expect(reference?.textDefinerNodeIds).toEqual(['writer']);
			// Nobody confirmed the output, so there is still nothing that draws.
			expect(reference?.definerNodeIds).toEqual([]);
		});

		it('goes back to unresolved once nothing states it at all', () => {
			expect(stateOf(diagnose([node('use', '$$w = m g$$')]), 'use', 'g')).toBe('unresolved');
		});

		it('becomes resolved once the writer confirms the output', () => {
			const confirmed = [node('use', '$$w = m g$$'), node('writer', '$$g = 9.8$$')];
			expect(stateOf(diagnose(confirmed), 'use', 'g')).toBe('resolved');
		});

		// The repair is a confirmation the reader makes from where they are, so
		// whether the writer happens to be on screen changes nothing about it.
		it('does not split on visibility the way a resolved reference does', () => {
			expect(stateOf(diagnose(written, { visibleNodeIds: new Set(['use']) }), 'use', 'g')).toBe(
				'unconfirmed'
			);
		});

		// A conflict needs two confirmed bodies, so it cannot co-occur with this
		// state — but the reference should still be reported plainly either way.
		it('reports no conflict, since nobody has claimed anything', () => {
			expect(diagnose(written).conflicts).toEqual([]);
		});
	});

	it('reports nothing for a graph with no math', () => {
		expect(diagnose([node('a', 'prose')])).toEqual({
			references: [],
			conflicts: [],
			cycles: []
		});
	});
});

describe('conflicts', () => {
	it('flags a quantity two nodes define differently', () => {
		const diagnostics = diagnose([node('one', '$$g = 9.8$$'), node('two', '$$g = 10$$')]);
		expect(diagnostics.conflicts.map((conflict) => conflict.symbol.label)).toEqual(['g']);
	});

	// A conflict is disagreement, not duplication. Warning when two nodes say the
	// same thing would fire on ordinary authoring and teach people to ignore it.
	it('does not flag two nodes that state the same definition', () => {
		expect(diagnose([node('one', '$$g = 9.8$$'), node('two', '$$g = 9.8$$')]).conflicts).toEqual(
			[]
		);
	});

	it('does not flag two nodes whose definitions differ only in spacing', () => {
		expect(diagnose([node('one', '$$w = m g$$'), node('two', '$$w = mg$$')]).conflicts).toEqual([]);
	});

	it('flags a node that defines the same quantity two different ways', () => {
		const diagnostics = diagnose([
			designated({ id: 'a', title: '$x = 1$', description: 'But also $x = 2$.', tags: [] })
		]);
		expect(diagnostics.conflicts.map((conflict) => conflict.symbol.label)).toEqual(['x']);
	});

	// There is no second node to name, so the panel has to be able to describe a
	// conflict whose only participant is the node reading it.
	it('names only the one node when it contradicts itself', () => {
		const diagnostics = diagnose([
			designated({ id: 'a', title: '$x = 1$', description: 'But also $x = 2$.', tags: [] })
		]);
		expect(diagnostics.conflicts[0].definerNodeIds).toEqual(['a']);
	});

	it('flags a contradiction stated entirely within one description', () => {
		expect(diagnose([node('a', '$$x = 1$$ and $$x = 2$$')]).conflicts).toHaveLength(1);
	});

	it('names every competing node, not just the first', () => {
		const diagnostics = diagnose([
			node('one', '$$g = 9.8$$'),
			node('two', '$$g = 10$$'),
			node('three', '$$g = 11$$')
		]);
		expect(diagnostics.conflicts[0].definerNodeIds).toEqual(['one', 'three', 'two']);
	});

	it('does not flag a quantity defined once', () => {
		expect(diagnose(chain).conflicts).toEqual([]);
	});

	// A conflict is two nodes disagreeing. One node stating the same definition in
	// its title and its description is the ordinary way to write a node about a
	// quantity, and warning about it would make the feature feel broken.
	it('does not flag a node that defines the same quantity in its title and description', () => {
		const diagnostics = diagnose([
			designated({ id: 'a', title: '$x = 1$', description: 'Restated: $x = 1$', tags: [] })
		]);
		expect(diagnostics.conflicts).toEqual([]);
	});

	it('does not flag a quantity referenced by many but defined once', () => {
		expect(
			diagnose([node('def', '$$g = 9.8$$'), node('a', '$$x = g$$'), node('b', '$$y = g$$')])
				.conflicts
		).toEqual([]);
	});
});

describe('cycles', () => {
	it('detects a two-node loop', () => {
		expect(diagnose([node('a', '$$x = y$$'), node('b', '$$y = x$$')]).cycles).toEqual([
			{ nodeIds: ['a', 'b'] }
		]);
	});

	it('detects a three-node loop', () => {
		expect(
			diagnose([node('a', '$$x = z$$'), node('b', '$$y = x$$'), node('c', '$$z = y$$')]).cycles
		).toEqual([{ nodeIds: ['a', 'b', 'c'] }]);
	});

	it('does not report a straight chain', () => {
		expect(diagnose(chain).cycles).toEqual([]);
	});

	it('does not report a diamond, where two paths merge without looping', () => {
		const diamond = [
			node('top', '$$a = 1$$'),
			node('left', '$$b = a$$'),
			node('right', '$$c = a$$'),
			node('bottom', '$$d = b + c$$')
		];
		expect(diagnose(diamond).cycles).toEqual([]);
	});

	it('reports two independent loops separately', () => {
		const nodes = [
			node('a', '$$p = q$$'),
			node('b', '$$q = p$$'),
			node('c', '$$s = t$$'),
			node('d', '$$t = s$$')
		];
		expect(diagnose(nodes).cycles).toEqual([{ nodeIds: ['a', 'b'] }, { nodeIds: ['c', 'd'] }]);
	});

	it('does not report a node that merely reuses its own definition', () => {
		expect(diagnose([node('solo', '$$v = v + 1$$')]).cycles).toEqual([]);
	});

	it('terminates on a long chain without overflowing the stack', () => {
		// Recursive Tarjan would risk a stack overflow here; this pins the
		// iterative implementation.
		const long = Array.from({ length: 5000 }, (_, position) =>
			position === 0
				? node('n0', '$$x_{0} = x_{4999}$$')
				: node(`n${position}`, `$$x_{${position}} = x_{${position - 1}}$$`)
		);
		const cycles = diagnose(long).cycles;
		expect(cycles).toHaveLength(1);
		expect(cycles[0].nodeIds).toHaveLength(5000);
	});

	it('reports cycles independently of node order', () => {
		const nodes = [node('a', '$$x = y$$'), node('b', '$$y = x$$')];
		expect(diagnose([...nodes].reverse()).cycles).toEqual(diagnose(nodes).cycles);
	});
});
