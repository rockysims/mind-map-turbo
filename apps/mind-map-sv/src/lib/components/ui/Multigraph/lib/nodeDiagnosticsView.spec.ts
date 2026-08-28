import { describe, expect, it } from 'vitest';
import { nodeDiagnosticsView } from './nodeDiagnosticsView';
import { computeDataflowDiagnostics } from './dataflowDiagnostics';
import { deriveDataflowEdges } from './derivedEdges';
import { buildQuantityIndex, type IndexableNode } from './quantityIndex';

function node(id: string, description: string): IndexableNode {
	return { id, description, tags: [] };
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

	it('orders unresolved before out-of-view before conflict', () => {
		const view = viewFor(
			[
				node('def', '$$p = 1$$'),
				node('one', '$$q = 1$$'),
				node('two', '$$q = 2$$'),
				node('use', '$$w = p + q + u + v$$')
			],
			'use',
			new Set(['use'])
		);
		expect(view.items.map((item) => item.state)).toEqual([
			'unresolved',
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
