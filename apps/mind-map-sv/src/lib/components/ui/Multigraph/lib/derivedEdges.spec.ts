import { describe, expect, it } from 'vitest';
import {
	deriveDataflowEdges,
	derivedEdgeId,
	isDerivedEdgeId,
	DERIVED_EDGE_ID_PREFIX,
	type DerivedEdge
} from './derivedEdges';
import { buildQuantityIndex, type IndexableNode } from './quantityIndex';

function node(id: string, description: string, tags: string[] = []): IndexableNode {
	return { id, description, tags };
}

function edgesFor(nodes: readonly IndexableNode[]): DerivedEdge[] {
	return deriveDataflowEdges(buildQuantityIndex(nodes));
}

function pairsOf(nodes: readonly IndexableNode[]): string[] {
	return edgesFor(nodes).map((edge) => `${edge.sourceNodeId}->${edge.targetNodeId}`);
}

const chain: IndexableNode[] = [
	node('a', '$$v_0 = 3$$'),
	node('b', '$$g = 9.8$$'),
	node('c', '$$v = v_0 + g t$$')
];

describe('deriveDataflowEdges direction and shape', () => {
	it('points from the definer to the consumer', () => {
		expect(pairsOf([node('def', '$$g = 9.8$$'), node('use', '$$w = m g$$')])).toEqual(['def->use']);
	});

	it('always marks a derived edge directed', () => {
		expect(edgesFor(chain).every((edge) => edge.directed)).toBe(true);
	});

	it('gives derived edges no tags, leaving styling to the renderer', () => {
		expect(edgesFor(chain).every((edge) => edge.tags.length === 0)).toBe(true);
	});

	it('produces an edge from each definer in a chain', () => {
		expect(pairsOf(chain).sort()).toEqual(['a->c', 'b->c']);
	});

	it('produces nothing when no node defines anything', () => {
		expect(edgesFor([node('a', 'prose'), node('b', '$w$')])).toEqual([]);
	});

	it('produces nothing for a definition nobody consumes', () => {
		expect(edgesFor([node('a', '$$g = 9.8$$')])).toEqual([]);
	});

	it('produces nothing for a graph with no math', () => {
		expect(edgesFor([node('a', 'prose'), node('b', 'more prose')])).toEqual([]);
	});
});

describe('deriveDataflowEdges bundling', () => {
	it('bundles several quantities onto one edge', () => {
		const edges = edgesFor([node('src', '$$g = 9.8$$ and $$m = 5$$'), node('dst', '$$w = m g$$')]);
		expect(edges).toHaveLength(1);
		expect(edges[0].quantities.map((symbol) => symbol.label).sort()).toEqual(['g', 'm']);
	});

	it('keeps separate edges for separate pairs', () => {
		expect(
			pairsOf([
				node('one', '$$g = 9.8$$'),
				node('two', '$$m = 5$$'),
				node('dst', '$$w = m g$$')
			]).sort()
		).toEqual(['one->dst', 'two->dst']);
	});

	it('orders bundled quantities deterministically', () => {
		const forward = edgesFor([
			node('src', '$$b = 1$$ and $$a = 2$$'),
			node('dst', '$$y = a + b$$')
		]);
		const reversed = edgesFor([
			node('src', '$$a = 2$$ and $$b = 1$$'),
			node('dst', '$$y = b + a$$')
		]);
		expect(forward[0].quantities.map((symbol) => symbol.key)).toEqual(
			reversed[0].quantities.map((symbol) => symbol.key)
		);
	});
});

describe('deriveDataflowEdges self-reference', () => {
	it('produces no edge from a node to itself', () => {
		expect(edgesFor([node('solo', '$$v = v + 1$$')])).toEqual([]);
	});

	it('produces no self edge when a node defines and reuses across segments', () => {
		expect(edgesFor([node('solo', '$$g = 9.8$$ so $$w = m g$$')])).toEqual([]);
	});

	it('still links other consumers of a self-reusing node', () => {
		expect(pairsOf([node('src', '$$g = 9.8$$ so $$w = m g$$'), node('dst', '$$x = g$$')])).toEqual([
			'src->dst'
		]);
	});
});

describe('deriveDataflowEdges conflicts', () => {
	it('draws an edge from every competing definer', () => {
		expect(
			pairsOf([
				node('one', '$$g = 9.8$$'),
				node('two', '$$g = 10$$'),
				node('use', '$$w = m g$$')
			]).sort()
		).toEqual(['one->use', 'two->use']);
	});
});

describe('derived edge identity', () => {
	it('marks derived ids distinguishably from authored ids', () => {
		expect(edgesFor(chain).every((edge) => isDerivedEdgeId(edge.id))).toBe(true);
		expect(isDerivedEdgeId('e1')).toBe(false);
	});

	it('builds an id from the pair alone', () => {
		expect(derivedEdgeId('a', 'b')).toBe(`${DERIVED_EDGE_ID_PREFIX}a->b`);
	});

	it('distinguishes the two directions of a pair', () => {
		expect(derivedEdgeId('a', 'b')).not.toBe(derivedEdgeId('b', 'a'));
	});

	it('keeps ids identical when an unrelated node is added', () => {
		const before = edgesFor(chain).map((edge) => edge.id);
		const after = edgesFor([...chain, node('unrelated', 'Prose about nothing.')]).map(
			(edge) => edge.id
		);
		expect(after).toEqual(before);
	});

	it('keeps ids identical when an unrelated node defines a new quantity', () => {
		const before = edgesFor(chain).map((edge) => edge.id);
		const after = edgesFor([...chain, node('other', '$$q = 7$$')]).map((edge) => edge.id);
		expect(after).toEqual(before);
	});

	it('keeps an id identical when the quantities on that edge change', () => {
		const before = edgesFor([node('src', '$$g = 9.8$$'), node('dst', '$$w = m g$$')]);
		const after = edgesFor([node('src', '$$g = 9.8$$ and $$m = 5$$'), node('dst', '$$w = m g$$')]);
		expect(after[0].id).toBe(before[0].id);
		expect(after[0].quantities.length).toBeGreaterThan(before[0].quantities.length);
	});

	it('returns edges in a deterministic order regardless of node order', () => {
		expect(edgesFor([...chain].reverse()).map((edge) => edge.id)).toEqual(
			edgesFor(chain).map((edge) => edge.id)
		);
	});
});
