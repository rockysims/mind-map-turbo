/**
 * The seam between authored graph data and the dataflow the renderer draws.
 *
 * Composition happens here and nowhere else, so the authored graph that feeds
 * mutations, duplicate-edge detection, and persistence never sees a derived
 * edge.
 */

import type { MultigraphData } from '../../types/multigraph';
import { deriveDataflowEdges, isDerivedEdgeId, type DerivedEdge } from './derivedEdges';
import {
	createQuantityIndexer,
	type QuantityIndex,
	type QuantityIndexerOptions
} from './quantityIndex';

export interface DataflowModel {
	index: QuantityIndex;
	edges: DerivedEdge[];
}

const EMPTY_MODEL: DataflowModel = {
	index: { entries: new Map(), byNodeId: new Map() },
	edges: []
};

/**
 * Build a reusable dataflow model over a graph's nodes.
 *
 * Returns a closure because the underlying index memoizes per node; a fresh
 * indexer on every render would re-render every description's math each frame.
 *
 * The model is a pure function of node content, but callers hand it the whole
 * graph, whose identity changes on every frame of a drag or a settle because
 * positions moved. So the closure returns the *same model object* whenever the
 * index came back identical: the derived edges — the objects, not just their ids
 * — survive across unrelated frames, and every downstream derivation short-
 * circuits instead of rebuilding for a graph whose math never moved.
 */
export function createDataflowModel(options: QuantityIndexerOptions = {}) {
	const buildIndex = createQuantityIndexer(options);
	let previous: DataflowModel | undefined;

	return function dataflowModel(data: MultigraphData, enabled = true): DataflowModel {
		if (!enabled) {
			return EMPTY_MODEL;
		}
		const index = buildIndex(data.nodes);
		if (previous !== undefined && previous.index === index) {
			return previous;
		}
		previous = { index, edges: deriveDataflowEdges(index) };
		return previous;
	};
}

/**
 * The graph the renderer draws: authored edges plus derived ones.
 *
 * Returns the input untouched when there is nothing to add, which is what makes
 * a graph containing no math identical rather than merely equivalent — and keeps
 * downstream derived state from invalidating for no reason.
 */
export function composeEdgesForRender(
	authored: MultigraphData,
	derivedEdges: readonly DerivedEdge[]
): MultigraphData {
	if (derivedEdges.length === 0) {
		return authored;
	}
	return { ...authored, edges: [...authored.edges, ...derivedEdges] };
}

/** True when any edge here is derived. Used to assert authored data stayed clean. */
export function hasDerivedEdges(data: MultigraphData): boolean {
	return data.edges.some((edge) => isDerivedEdgeId(edge.id));
}
