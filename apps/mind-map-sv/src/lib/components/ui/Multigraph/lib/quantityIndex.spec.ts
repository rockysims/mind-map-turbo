import { describe, expect, it, vi } from 'vitest';
import {
	buildQuantityIndex,
	createQuantityIndexer,
	isTracked,
	trackedQuantities,
	type IndexableNode,
	type QuantityIndex
} from './quantityIndex';
import { nodeQuantities } from './nodeQuantities';

function node(id: string, description: string, tags: string[] = []): IndexableNode {
	return { id, description, tags };
}

function definersOf(index: QuantityIndex, label: string): string[] {
	const entry = [...index.entries.values()].find((candidate) => candidate.symbol.label === label);
	return entry?.definerNodeIds ?? [];
}

function consumersOf(index: QuantityIndex, label: string): string[] {
	const entry = [...index.entries.values()].find((candidate) => candidate.symbol.label === label);
	return entry?.consumerNodeIds ?? [];
}

const chain: IndexableNode[] = [
	node('a', '$$v_0 = 3$$'),
	node('b', '$$a = 9.8$$'),
	node('c', '$$v = v_0 + a t$$')
];

describe('buildQuantityIndex', () => {
	it('records which node defines a quantity', () => {
		expect(definersOf(buildQuantityIndex(chain), 'v_0')).toEqual(['a']);
	});

	it('records which nodes consume a quantity', () => {
		expect(consumersOf(buildQuantityIndex(chain), 'v_0')).toEqual(['c']);
	});

	it('records a quantity defined by one node and consumed by several', () => {
		const index = buildQuantityIndex([
			node('def', '$$g = 9.8$$'),
			node('one', '$$x = g$$'),
			node('two', '$$y = g$$')
		]);
		expect(consumersOf(index, 'g')).toEqual(['one', 'two']);
	});

	it('records several definers for a conflicting quantity', () => {
		const index = buildQuantityIndex([node('one', '$$g = 9.8$$'), node('two', '$$g = 10$$')]);
		expect(definersOf(index, 'g')).toEqual(['one', 'two']);
	});

	it('exposes what each node defines and references', () => {
		const index = buildQuantityIndex(chain);
		expect(index.byNodeId.get('c')?.defines.map((symbol) => symbol.label)).toEqual(['v']);
		expect(index.byNodeId.get('c')?.references.map((symbol) => symbol.label)).toEqual([
			'v_0',
			'a',
			't'
		]);
	});

	it('is independent of node order', () => {
		const forward = buildQuantityIndex(chain);
		const reversed = buildQuantityIndex([...chain].reverse());
		expect(definersOf(reversed, 'v_0')).toEqual(definersOf(forward, 'v_0'));
		expect(consumersOf(reversed, 'v_0')).toEqual(consumersOf(forward, 'v_0'));
		expect([...reversed.entries.keys()].sort()).toEqual([...forward.entries.keys()].sort());
	});

	it('yields an empty index for a graph with no nodes', () => {
		const index = buildQuantityIndex([]);
		expect(index.entries.size).toBe(0);
	});

	it('yields no entries for a graph with no math', () => {
		expect(buildQuantityIndex([node('a', 'Plain prose.')]).entries.size).toBe(0);
	});
});

describe('promotion rule', () => {
	it('does not track a symbol nobody defines', () => {
		const index = buildQuantityIndex([node('solo', '$$E = m c^2$$')]);
		expect(trackedQuantities(index).map((entry) => entry.symbol.label)).toEqual(['E']);
	});

	it('still records the undefined symbols so diagnostics can offer them', () => {
		// The canvas stays quiet, but focus mode needs to know m and c exist.
		const index = buildQuantityIndex([node('solo', '$$E = m c^2$$')]);
		expect(consumersOf(index, 'm')).toEqual(['solo']);
		expect(consumersOf(index, 'c')).toEqual(['solo']);
	});

	it('marks an undefined symbol as untracked', () => {
		const index = buildQuantityIndex([node('solo', '$$E = m c^2$$')]);
		const m = [...index.entries.values()].find((entry) => entry.symbol.label === 'm');
		expect(m && isTracked(m)).toBe(false);
	});

	it('promotes a symbol once another node defines it', () => {
		const index = buildQuantityIndex([node('solo', '$$E = m c^2$$'), node('mass', '$$m = 5$$')]);
		expect(
			trackedQuantities(index)
				.map((entry) => entry.symbol.label)
				.sort()
		).toEqual(['E', 'm']);
	});
});

describe('opt-out', () => {
	it('excludes an opted-out node from the index', () => {
		const index = buildQuantityIndex([node('a', '$$g = 9.8$$', ['no-dataflow'])]);
		expect(index.entries.size).toBe(0);
	});

	it('leaves a quantity untracked when only the opted-out node defined it', () => {
		const index = buildQuantityIndex([
			node('def', '$$g = 9.8$$', ['no-dataflow']),
			node('use', '$$x = g$$')
		]);
		expect(trackedQuantities(index).map((entry) => entry.symbol.label)).toEqual(['x']);
	});
});

describe('memoization', () => {
	function countingIndexer() {
		const extract = vi.fn((candidate: { description: string; tags: string[] }) =>
			nodeQuantities(candidate)
		);
		return { extract, build: createQuantityIndexer({ extract }) };
	}

	it('extracts each node once on a first pass', () => {
		const { extract, build } = countingIndexer();
		build(chain);
		expect(extract).toHaveBeenCalledTimes(3);
	});

	it('extracts nothing again when nothing changed', () => {
		const { extract, build } = countingIndexer();
		build(chain);
		extract.mockClear();
		build(chain);
		expect(extract).not.toHaveBeenCalled();
	});

	it('re-extracts exactly the node whose description changed', () => {
		const { extract, build } = countingIndexer();
		build(chain);
		extract.mockClear();
		build([chain[0], chain[1], node('c', '$$v = a t$$')]);
		expect(extract).toHaveBeenCalledTimes(1);
		expect(extract.mock.calls[0][0].description).toBe('$$v = a t$$');
	});

	it('re-extracts a node whose tags changed, since the opt-out is a tag', () => {
		const { extract, build } = countingIndexer();
		build(chain);
		extract.mockClear();
		build([chain[0], chain[1], node('c', '$$v = v_0 + a t$$', ['no-dataflow'])]);
		expect(extract).toHaveBeenCalledTimes(1);
	});

	it('extracts only the added node when a graph grows', () => {
		const { extract, build } = countingIndexer();
		build(chain);
		extract.mockClear();
		build([...chain, node('d', '$$p = m v$$')]);
		expect(extract).toHaveBeenCalledTimes(1);
	});

	it('reflects an edit in the rebuilt index', () => {
		const { build } = countingIndexer();
		build(chain);
		const after = build([chain[0], chain[1], node('c', '$$v = a t$$')]);
		expect(consumersOf(after, 'v_0')).toEqual([]);
	});

	it('re-extracts a removed and re-added node rather than serving a stale entry', () => {
		const { extract, build } = countingIndexer();
		build(chain);
		build([chain[0], chain[1]]);
		extract.mockClear();
		build(chain);
		expect(extract).toHaveBeenCalledTimes(1);
	});
});
