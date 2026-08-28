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
 */
export function createDataflowModel(options: QuantityIndexerOptions = {}) {
	const buildIndex = createQuantityIndexer(options);

	return function dataflowModel(data: MultigraphData, enabled = true): DataflowModel {
		if (!enabled) {
			return EMPTY_MODEL;
		}
		const index = buildIndex(data.nodes);
		return { index, edges: deriveDataflowEdges(index) };
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
