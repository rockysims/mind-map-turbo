/**
 * The one rule for which neighbours feed an `!ai` node.
 *
 * An edge pointing *at* the node feeds it; an undirected edge touching it feeds
 * it; an edge pointing *away* is an output and does not; a self-loop is never
 * a neighbour. Input collection uses it to decide whose text and files a run
 * carries, and the ancestor walk uses it to decide whose prompts and summaries
 * come along as prose — one rule, so a reader who can predict which files a
 * node reads can predict which conversation it remembers. It lives in a module
 * of its own because the collector needs the run history and the run history
 * needs the rule, and a shared predicate is what keeps that from being a cycle.
 */

import type { EdgeData } from '../../types/edge';
import type { MultigraphData } from '../../types/multigraph';

/**
 * The other end of `edge` when it feeds `nodeId`, or `undefined` when it does
 * not: a directed edge leaving the node is an output, and an edge that never
 * touches it is nothing to do with it.
 */
export function feedingNeighborId(edge: EdgeData, nodeId: string): string | undefined {
	if (edge.directed === true) {
		if (edge.targetNodeId !== nodeId) return undefined;
		return edge.sourceNodeId === nodeId ? undefined : edge.sourceNodeId;
	}

	if (edge.sourceNodeId === nodeId) {
		return edge.targetNodeId === nodeId ? undefined : edge.targetNodeId;
	}
	if (edge.targetNodeId === nodeId) return edge.sourceNodeId;
	return undefined;
}

/**
 * The ids of every node that feeds `nodeId`, each once, in `graph.nodes` order
 * — not edge order, so drawing an unrelated edge moves nothing.
 */
export function feedingNodeIds(graph: MultigraphData, nodeId: string): string[] {
	const feeding = new Set<string>();
	for (const edge of graph.edges) {
		const neighborId = feedingNeighborId(edge, nodeId);
		if (neighborId !== undefined) feeding.add(neighborId);
	}
	return graph.nodes.filter((node) => feeding.has(node.id)).map((node) => node.id);
}
