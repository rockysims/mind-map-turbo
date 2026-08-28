import { describe, expect, it } from 'vitest';
import {
	computeDataflowDiagnostics,
	referencesForNode,
	type DataflowDiagnostics,
	type DataflowDiagnosticsOptions
} from './dataflowDiagnostics';
import { deriveDataflowEdges } from './derivedEdges';
import { buildQuantityIndex, type IndexableNode } from './quantityIndex';

function node(id: string, description: string, tags: string[] = []): IndexableNode {
	return { id, description, tags };
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

	it('reports nothing for a graph with no math', () => {
		expect(diagnose([node('a', 'prose')])).toEqual({
			references: [],
			conflicts: [],
			cycles: []
		});
	});
});

describe('conflicts', () => {
	it('flags a quantity defined by two nodes', () => {
		const diagnostics = diagnose([node('one', '$$g = 9.8$$'), node('two', '$$g = 10$$')]);
		expect(diagnostics.conflicts.map((conflict) => conflict.symbol.label)).toEqual(['g']);
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
			{ id: 'a', title: '$x = 1$', description: 'Restated: $x = 1$', tags: [] }
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
