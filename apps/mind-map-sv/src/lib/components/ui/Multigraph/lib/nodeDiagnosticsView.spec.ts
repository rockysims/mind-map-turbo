import { describe, expect, it } from 'vitest';
import { nodeDiagnosticsView } from './nodeDiagnosticsView';
import { computeDataflowDiagnostics } from './dataflowDiagnostics';
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
 * confirmed every suggestion. Nothing below is reported about a node until it has
 * claimed the quantity, so every fixture has to claim what it writes.
 */
function designated(node: IndexableNode): IndexableNode {
	const parsed = nodeQuantities(node);
	return {
		...node,
		inputs: parsed.references.map(designationOf),
		outputs: parsed.defines.map((definition) => designationOf(definition.symbol))
	};
}

function node(id: string, description: string): IndexableNode {
	return designated({ id, description, tags: [] });
}

function viewFor(
	nodes: readonly IndexableNode[],
	nodeId: string,
	visibleNodeIds?: ReadonlySet<string>
) {
	const index = buildQuantityIndex(nodes);
	const diagnostics = computeDataflowDiagnostics(index, deriveDataflowEdges(index), {
		visibleNodeIds
	});
	return nodeDiagnosticsView(diagnostics, nodeId);
}

describe('nodeDiagnosticsView', () => {
	it('reports nothing for a node whose references all resolve', () => {
		const view = viewFor([node('def', '$$g = 9.8$$'), node('use', '$$w = m g$$')], 'def');
		expect(view).toEqual({ items: [], cycleNodeIds: [] });
	});

	it('reports an unresolved reference', () => {
		const view = viewFor([node('solo', '$$E = m c^2$$')], 'solo');
		expect(view.items.map((item) => [item.label, item.state])).toEqual([
			['c', 'unresolved'],
			['m', 'unresolved']
		]);
	});

	it('names no nodes for an unresolved reference, since none exist', () => {
		const view = viewFor([node('solo', '$$E = m c^2$$')], 'solo');
		expect(view.items[0].nodeIds).toEqual([]);
	});

	it('reports an out-of-view reference and names the definer to reach', () => {
		const view = viewFor(
			[node('def', '$$g = 9.8$$'), node('use', '$$w = g$$')],
			'use',
			new Set(['use'])
		);
		expect(view.items).toEqual([{ key: 'g', label: 'g', state: 'out-of-view', nodeIds: ['def'] }]);
	});

	it('reports a conflict on the referencing node, naming every definer', () => {
		const view = viewFor(
			[node('one', '$$g = 9.8$$'), node('two', '$$g = 10$$'), node('use', '$$w = g$$')],
			'use'
		);
		expect(view.items).toEqual([
			{ key: 'g', label: 'g', state: 'conflict', nodeIds: ['one', 'two'] }
		]);
	});

	it('reports a conflict on a competing definer too', () => {
		const view = viewFor([node('one', '$$g = 9.8$$'), node('two', '$$g = 10$$')], 'one');
		expect(view.items.map((item) => item.state)).toEqual(['conflict']);
	});

	it('names the other definer but not the node being read', () => {
		// A button offering to reveal the node you are already looking at is a dead
		// control that looks like a working one.
		const view = viewFor([node('one', '$$g = 9.8$$'), node('two', '$$g = 10$$')], 'one');
		expect(view.items[0].nodeIds).toEqual(['two']);
	});

	describe('a node that contradicts itself', () => {
		const selfContradicting = [
			designated({ id: 'a', title: '$x = 1$', description: 'But also $x = 2$.', tags: [] })
		];

		it('reports it as its own state rather than as a conflict with someone', () => {
			expect(viewFor(selfContradicting, 'a').items.map((item) => item.state)).toEqual([
				'self-conflict'
			]);
		});

		it('offers nowhere to navigate, since the contradiction is here', () => {
			expect(viewFor(selfContradicting, 'a').items[0].nodeIds).toEqual([]);
		});

		// Reconciling with another node is meaningless until this node states one
		// thing, and it is the half the reader can fix without leaving.
		it('takes precedence when another node also disagrees', () => {
			const view = viewFor(
				[
					designated({ id: 'a', title: '$x = 1$', description: 'But also $x = 2$.', tags: [] }),
					node('b', '$$x = 3$$')
				],
				'a'
			);
			expect(view.items.map((item) => item.state)).toEqual(['self-conflict']);
		});

		it('still reads as an ordinary conflict from the other node', () => {
			const view = viewFor(
				[
					designated({ id: 'a', title: '$x = 1$', description: 'But also $x = 2$.', tags: [] }),
					node('b', '$$x = 3$$')
				],
				'b'
			);
			expect(view.items.map((item) => item.state)).toEqual(['conflict']);
			expect(view.items[0].nodeIds).toEqual(['a']);
		});

		it('sorts before a conflict with another node', () => {
			const view = viewFor(
				[
					designated({
						id: 'a',
						title: '$x = 1$',
						description: 'Also $x = 2$, and $w = y$.',
						tags: []
					}),
					node('b', '$$y = 1$$'),
					node('c', '$$y = 2$$')
				],
				'a'
			);
			expect(view.items.map((item) => item.state)).toEqual(['self-conflict', 'conflict']);
		});
	});

	it('does not report a conflict to an uninvolved node', () => {
		const view = viewFor(
			[node('one', '$$g = 9.8$$'), node('two', '$$g = 10$$'), node('other', '$$z = 1$$')],
			'other'
		);
		expect(view.items).toEqual([]);
	});

	it('prefers conflict over out-of-view for the same quantity', () => {
		// Which definer applies is the open question; reaching one of them is moot
		// until that is answered.
		const view = viewFor(
			[node('one', '$$g = 9.8$$'), node('two', '$$g = 10$$'), node('use', '$$w = g$$')],
			'use',
			new Set(['use'])
		);
		expect(view.items.map((item) => item.state)).toEqual(['conflict']);
	});

	/**
	 * Someone has written the equation and nobody confirmed it. The old report —
	 * "is not defined anywhere", with an offer to define it — was both wrong and
	 * a trap: taking the offer produced a second node saying the same thing.
	 */
	describe('a quantity written down but not confirmed', () => {
		const written = [
			node('use', '$$w = g$$'),
			{ id: 'writer', description: '$$g = 9.8$$', tags: [] }
		];

		it('reports it as unconfirmed rather than unresolved', () => {
			expect(viewFor(written, 'use').items.map((item) => [item.label, item.state])).toEqual([
				['g', 'unconfirmed']
			]);
		});

		it('names the node to confirm', () => {
			expect(viewFor(written, 'use').items[0].nodeIds).toEqual(['writer']);
		});

		it('names every node that wrote it down', () => {
			const view = viewFor(
				[
					node('use', '$$w = g$$'),
					{ id: 'earth', description: '$$g = 9.8$$', tags: [] },
					{ id: 'moon', description: '$$g = 1.6$$', tags: [] }
				],
				'use'
			);
			expect(view.items[0].nodeIds).toEqual(['earth', 'moon']);
		});

		it('reports nothing once the writer confirms it', () => {
			expect(
				viewFor([node('use', '$$w = g$$'), node('writer', '$$g = 9.8$$')], 'use').items
			).toEqual([]);
		});

		// Confirming is the cheapest repair anything here offers: the answer is
		// already in the graph and one tap from being said.
		it('sorts before an unresolved quantity', () => {
			const view = viewFor(
				[node('use', '$$w = g + z$$'), { id: 'writer', description: '$$g = 9.8$$', tags: [] }],
				'use'
			);
			expect(view.items.map((item) => item.state)).toEqual(['unconfirmed', 'unresolved']);
		});
	});

	it('orders unconfirmed before unresolved before out-of-view before conflict', () => {
		const view = viewFor(
			[
				node('def', '$$p = 1$$'),
				node('one', '$$q = 1$$'),
				node('two', '$$q = 2$$'),
				{ id: 'writer', description: '$$u = 1$$', tags: [] },
				node('use', '$$w = p + q + u + v$$')
			],
			'use',
			new Set(['use'])
		);
		expect(view.items.map((item) => item.state)).toEqual([
			'unconfirmed',
			'unresolved',
			'out-of-view',
			'conflict'
		]);
	});

	it('reports the other nodes in a cycle', () => {
		const view = viewFor([node('a', '$$x = y$$'), node('b', '$$y = x$$')], 'a');
		expect(view.cycleNodeIds).toEqual(['b']);
	});

	it('excludes the node itself from its cycle list', () => {
		const view = viewFor([node('a', '$$x = y$$'), node('b', '$$y = x$$')], 'b');
		expect(view.cycleNodeIds).toEqual(['a']);
	});

	it('reports no cycle for a straight chain', () => {
		const view = viewFor([node('a', '$$g = 1$$'), node('b', '$$w = g$$')], 'b');
		expect(view.cycleNodeIds).toEqual([]);
	});

	it('reports nothing for a node with no math', () => {
		expect(viewFor([node('a', 'prose')], 'a')).toEqual({ items: [], cycleNodeIds: [] });
	});

	it('reports nothing for an unknown node id', () => {
		expect(viewFor([node('a', '$$g = 1$$')], 'missing')).toEqual({
			items: [],
			cycleNodeIds: []
		});
	});
});
