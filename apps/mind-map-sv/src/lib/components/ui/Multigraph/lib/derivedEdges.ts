/**
 * Turn the quantity index into directed edges from definer to consumer.
 *
 * These are computed on every render rather than stored, so they can never drift
 * from the math they describe and cannot be orphaned by an edit.
 */

import type { EdgeData } from '../../types/edge';
import type { QuantitySymbol } from '../../MathText/lib/mathSymbols';
import { isTracked, type QuantityIndex } from './quantityIndex';

/**
 * Marks an edge as derived. Authored ids are `e1`-style, so the prefix cannot
 * collide, and it gives persistence a cheap assertion that none leaked through.
 */
export const DERIVED_EDGE_ID_PREFIX = 'dataflow:';

export interface DerivedEdge extends EdgeData {
	directed: true;
	/** Quantities flowing along this edge, so a bundle can still label itself. */
	quantities: QuantitySymbol[];
	/**
	 * How hard this edge pulls relative to an authored one, read by the physics
	 * spring. Set by whoever hands the edge to the layout rather than here,
	 * because it is a tuning choice about layout, not a fact about the dataflow.
	 */
	springFactor?: number;
}

export function isDerivedEdgeId(id: string): boolean {
	return id.startsWith(DERIVED_EDGE_ID_PREFIX);
}

/**
 * Identity depends only on the pair, never on how many quantities flow along it
 * or on anything else in the graph.
 *
 * This matters more than it looks: `edge.id` keys the each block, parallel-edge
 * slot ordering, enter and exit animation, and reveal-wave diffing. An id that
 * churned when an unrelated node changed would show up as flicker and sideways
 * jumps that read like a physics bug.
 */
export function derivedEdgeId(sourceNodeId: string, targetNodeId: string): string {
	return `${DERIVED_EDGE_ID_PREFIX}${sourceNodeId}->${targetNodeId}`;
}

/**
 * One edge per producer/consumer pair, carrying every quantity that flows along
 * it, so a pair sharing several variables reads as one arrow rather than a
 * bundle of near-identical lines.
 *
 * A quantity defined by more than one node yields an edge from each definer.
 * That is the intended reading of a conflict: both claims are real until the
 * author resolves them, and hiding one would misrepresent the graph.
 */
export function deriveDataflowEdges(index: QuantityIndex): DerivedEdge[] {
	const byEdgeId = new Map<string, DerivedEdge>();

	for (const entry of index.entries.values()) {
		if (!isTracked(entry)) {
			continue;
		}

		for (const definerNodeId of entry.definerNodeIds) {
			for (const consumerNodeId of entry.consumerNodeIds) {
				// A node depending on its own definition is a statement about that
				// quantity, not a dependency, and a self-loop has no useful geometry.
				if (definerNodeId === consumerNodeId) {
					continue;
				}

				const id = derivedEdgeId(definerNodeId, consumerNodeId);
				const existing = byEdgeId.get(id);
				if (existing === undefined) {
					byEdgeId.set(id, {
						id,
						sourceNodeId: definerNodeId,
						targetNodeId: consumerNodeId,
						tags: [],
						directed: true,
						quantities: [entry.symbol]
					});
					continue;
				}
				existing.quantities.push(entry.symbol);
			}
		}
	}

	const edges = [...byEdgeId.values()].sort((left, right) => left.id.localeCompare(right.id));
	for (const edge of edges) {
		edge.quantities.sort((left, right) => left.key.localeCompare(right.key));
	}
	return edges;
}
