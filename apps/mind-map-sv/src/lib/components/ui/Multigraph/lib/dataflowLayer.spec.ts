import { describe, expect, it, vi } from 'vitest';
import { composeEdgesForRender, createDataflowModel, hasDerivedEdges } from './dataflowLayer';
import { nodeQuantities } from './nodeQuantities';
import type { MultigraphData } from '../../types/multigraph';
import type { NodeData, QuantityDesignation } from '../../types/node';
import type { QuantitySymbol } from '../../MathText/lib/mathSymbols';

function designationOf(symbol: QuantitySymbol): QuantityDesignation {
	return { base: symbol.base, subscript: symbol.subscript };
}

/**
 * A node whose designations say what its text says: the author confirmed every
 * suggestion. Edges follow designations, so the fixtures here have to carry them
 * for the model to have anything to compose.
 */
function node(id: string, description: string, tags: string[] = []): NodeData {
	const parsed = nodeQuantities({ title: id, description, tags });
	return {
		id,
		title: id,
		description,
		tags,
		inputs: parsed.references.map(designationOf),
		outputs: parsed.defines.map((definition) => designationOf(definition.symbol))
	};
}

function graphOf(
	nodes: NodeData[],
	edges: MultigraphData['edges'] = [],
	frame = 0
): MultigraphData {
	return {
		nodes,
		edges,
		posByNodeId: Object.fromEntries(
			nodes.map((entry, index) => [entry.id, { x: index + frame, y: frame }])
		),
		tagColorConfig: { nodeTags: {}, edgeTags: {} }
	};
}

/**
 * A graph as the physics loop hands it over one frame later: the same nodes with
 * the same content, in a new graph object, at new positions.
 */
function nextFrame(data: MultigraphData, frame: number): MultigraphData {
	return graphOf(
		data.nodes.map((each) => ({ ...each })),
		data.edges,
		frame
	);
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

/**
 * The model depends only on node content, but it is derived from the graph,
 * which gets a new identity on every animation frame of a drag or a settle. If a
 * moved position produced a new model, the render graph, chips, labels, and
 * diagnostics hanging off it would all rebuild several times a frame.
 */
describe('dataflow model identity across frames', () => {
	function countingModel() {
		const extract = vi.fn((candidate: { description: string; tags: string[] }) =>
			nodeQuantities(candidate)
		);
		return { extract, model: createDataflowModel({ extract }) };
	}

	it('extracts nothing when only positions moved', () => {
		const { extract, model } = countingModel();
		model(chain);
		extract.mockClear();
		model(nextFrame(chain, 1));
		expect(extract).not.toHaveBeenCalled();
	});

	it('returns the identical model when only positions moved', () => {
		const { model } = countingModel();
		const first = model(chain);
		expect(model(nextFrame(chain, 1))).toBe(first);
	});

	it('returns the identical index and edges array when only positions moved', () => {
		const { model } = countingModel();
		const first = model(chain);
		const second = model(nextFrame(chain, 1));
		expect(second.index).toBe(first.index);
		expect(second.edges).toBe(first.edges);
	});

	// Ids alone are not enough: the each-block keys stay put while every edge
	// object underneath them is replaced, so anything comparing edge objects — or
	// any derived state keyed on one — still churns.
	it('keeps derived edge objects identical across unrelated frames', () => {
		const { model } = countingModel();
		const first = model(chain);
		const later = model(nextFrame(nextFrame(chain, 1), 2));
		expect(later.edges[0]).toBe(first.edges[0]);
	});

	it('re-extracts exactly the edited node and returns a fresh model', () => {
		const { extract, model } = countingModel();
		const first = model(chain);
		extract.mockClear();
		const edited = model(graphOf([chain.nodes[0], node('b', '$$w = g / 2$$')]));
		expect(extract).toHaveBeenCalledTimes(1);
		expect(edited).not.toBe(first);
		expect(edited.index).not.toBe(first.index);
		expect(edited.edges).not.toBe(first.edges);
	});

	it('returns a fresh model when a node is removed', () => {
		const { model } = countingModel();
		const first = model(chain);
		expect(model(graphOf([chain.nodes[0]]))).not.toBe(first);
	});

	it('returns a fresh model when a node is added', () => {
		const { model } = countingModel();
		const first = model(chain);
		expect(model(graphOf([...chain.nodes, node('c', '$$p = m w$$')]))).not.toBe(first);
	});

	it('reflects an edit in the derived edges rather than serving the stale set', () => {
		const { model } = countingModel();
		model(chain);
		const after = model(graphOf([chain.nodes[0], node('b', 'prose')]));
		expect(after.edges).toEqual([]);
	});

	it('settles back onto one identity once the edit stops changing', () => {
		const { model } = countingModel();
		model(chain);
		const edited = graphOf([chain.nodes[0], node('b', '$$w = g / 2$$')]);
		const after = model(edited);
		expect(model(nextFrame(edited, 3))).toBe(after);
	});

	it('keeps its identity when the layer is switched off and back on', () => {
		const { model } = countingModel();
		const first = model(chain);
		expect(model(chain, false).edges).toEqual([]);
		expect(model(nextFrame(chain, 1))).toBe(first);
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
