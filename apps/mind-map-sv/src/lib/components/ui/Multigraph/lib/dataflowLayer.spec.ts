import { describe, expect, it } from 'vitest';
import { composeEdgesForRender, createDataflowModel, hasDerivedEdges } from './dataflowLayer';
import type { MultigraphData } from '../../types/multigraph';
import type { NodeData } from '../../types/node';

function node(id: string, description: string, tags: string[] = []): NodeData {
	return { id, title: id, description, tags };
}

function graphOf(nodes: NodeData[], edges: MultigraphData['edges'] = []): MultigraphData {
	return {
		nodes,
		edges,
		posByNodeId: Object.fromEntries(nodes.map((entry, index) => [entry.id, { x: index, y: 0 }])),
		tagColorConfig: { nodeTags: {}, edgeTags: {} }
	};
}

const chain = graphOf([node('a', '$$g = 9.8$$'), node('b', '$$w = m g$$')]);

describe('createDataflowModel', () => {
	it('derives an edge for a definer/consumer pair', () => {
		const model = createDataflowModel()(chain);
		expect(model.edges.map((edge) => `${edge.sourceNodeId}->${edge.targetNodeId}`)).toEqual([
			'a->b'
		]);
	});

	it('derives nothing when the layer is disabled', () => {
		expect(createDataflowModel()(chain, false).edges).toEqual([]);
	});

	it('derives nothing for a graph with no math', () => {
		expect(createDataflowModel()(graphOf([node('a', 'prose')])).edges).toEqual([]);
	});

	it('reuses its index across calls, so repeated renders are cheap', () => {
		const model = createDataflowModel();
		const first = model(chain);
		const second = model(chain);
		expect(second.edges.map((edge) => edge.id)).toEqual(first.edges.map((edge) => edge.id));
	});
});

describe('composeEdgesForRender', () => {
	it('appends derived edges to authored ones', () => {
		const authored = graphOf(chain.nodes, [
			{ id: 'e1', sourceNodeId: 'a', targetNodeId: 'b', tags: [] }
		]);
		const derived = createDataflowModel()(authored).edges;
		expect(composeEdgesForRender(authored, derived).edges.map((edge) => edge.id)).toEqual([
			'e1',
			'dataflow:a->b'
		]);
	});

	it('returns the identical object when there is nothing to add', () => {
		// Identity, not just equality: downstream derived state must not invalidate
		// for a graph that contains no math.
		const authored = graphOf([node('a', 'prose')]);
		expect(composeEdgesForRender(authored, [])).toBe(authored);
	});

	it('does not mutate the authored graph', () => {
		const authored = graphOf(chain.nodes);
		const derived = createDataflowModel()(authored).edges;
		composeEdgesForRender(authored, derived);
		expect(authored.edges).toEqual([]);
	});

	it('leaves the authored graph free of derived edges', () => {
		const authored = graphOf(chain.nodes);
		composeEdgesForRender(authored, createDataflowModel()(authored).edges);
		expect(hasDerivedEdges(authored)).toBe(false);
	});

	it('keeps an authored edge between the same pair distinct from the derived one', () => {
		const authored = graphOf(chain.nodes, [
			{ id: 'e1', sourceNodeId: 'a', targetNodeId: 'b', tags: [] }
		]);
		const composed = composeEdgesForRender(authored, createDataflowModel()(authored).edges);
		expect(new Set(composed.edges.map((edge) => edge.id)).size).toBe(2);
	});

	it('preserves everything else about the graph', () => {
		const derived = createDataflowModel()(chain).edges;
		const composed = composeEdgesForRender(chain, derived);
		expect(composed.nodes).toBe(chain.nodes);
		expect(composed.posByNodeId).toBe(chain.posByNodeId);
	});
});

describe('hasDerivedEdges', () => {
	it('detects a derived edge in a composed graph', () => {
		expect(hasDerivedEdges(composeEdgesForRender(chain, createDataflowModel()(chain).edges))).toBe(
			true
		);
	});

	it('reports none for a purely authored graph', () => {
		expect(
			hasDerivedEdges(
				graphOf(chain.nodes, [{ id: 'e1', sourceNodeId: 'a', targetNodeId: 'b', tags: [] }])
			)
		).toBe(false);
	});
});
