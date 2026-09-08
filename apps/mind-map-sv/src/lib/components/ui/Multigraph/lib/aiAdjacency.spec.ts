import { describe, expect, it } from 'vitest';
import type { EdgeData } from '../../types/edge';
import type { MultigraphData } from '../../types/multigraph';
import { feedingNeighborId, feedingNodeIds } from './aiAdjacency';
import { makeGraph } from './testFixtures';

function edge(
	source: string,
	target: string,
	directed: boolean,
	id = `${source}-${target}`
): EdgeData {
	return {
		id,
		sourceNodeId: source,
		targetNodeId: target,
		tags: [],
		...(directed ? { directed } : {})
	};
}

function graph(edges: EdgeData[]): MultigraphData {
	return {
		...makeGraph({ nodes: ['a', 'b', 'c'].map((id) => ({ id, title: id, description: '' })) }),
		edges
	};
}

describe('feedingNeighborId', () => {
	it.each([
		['an incoming directed edge', edge('a', 'b', true), 'a'],
		['an undirected edge from the node', edge('b', 'a', false), 'a'],
		['an undirected edge to the node', edge('a', 'b', false), 'a'],
		['an outgoing directed edge', edge('b', 'a', true), undefined],
		['a directed self-loop', edge('b', 'b', true), undefined],
		['an undirected self-loop', edge('b', 'b', false), undefined],
		['an edge that never touches the node', edge('a', 'c', true), undefined]
	])('%s', (_name, candidate, expected) => {
		expect(feedingNeighborId(candidate, 'b')).toBe(expected);
	});
});

describe('feedingNodeIds', () => {
	it('lists each feeding node once, in graph.nodes order rather than edge order', () => {
		const data = graph([
			edge('c', 'b', true, 'e1'),
			edge('a', 'b', false, 'e2'),
			edge('c', 'b', false, 'e3'),
			edge('b', 'a', true, 'e4')
		]);
		expect(feedingNodeIds(data, 'b')).toEqual(['a', 'c']);
	});

	it('is empty for a node nothing feeds', () => {
		expect(feedingNodeIds(graph([edge('b', 'a', true)]), 'b')).toEqual([]);
	});
});
