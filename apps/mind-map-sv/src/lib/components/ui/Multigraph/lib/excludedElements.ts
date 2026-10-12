/**
 * Query exclusion as a graph reduction.
 *
 * A `-#tag`, `-@tag`, `-"phrase"` or `-!addon` token takes the matching nodes
 * and edges out of the graph the layout runs over, not just out of the paint:
 * while excluded they are effectively gone. This module derives what is
 * excluded from a `GraphQueryResult` and returns the graph without it. Node
 * positions are never touched, so an excluded node re-enters exactly where it
 * left when the exclusion is lifted.
 *
 * Identity matters here. Every physics frame hands over a new graph object
 * whose `nodes` and `edges` arrays are the previous frame's references, and the
 * derived chain downstream (beacons, hops, visibility) memoizes on exactly those
 * references. `createLayoutSourceReducer` therefore returns the same reduced
 * arrays for as long as the input arrays and the excluded set are unchanged.
 */

import type { EdgeData } from '../../types/edge';
import type { MultigraphData } from '../../types/multigraph';
import type { NodeData } from '../../types/node';
import { evaluateGraphQuery, type GraphQueryResult } from './graphQuery';

interface ExcludedGraphElements {
	nodeIds: ReadonlySet<string>;
	edgeIds: ReadonlySet<string>;
}

const NOTHING_EXCLUDED: ExcludedGraphElements = Object.freeze({
	nodeIds: new Set<string>(),
	edgeIds: new Set<string>()
});

/**
 * The node and edge ids a query result excludes, minus `exemptNodeIds`.
 *
 * Edge exclusion is taken from the result as-is, so an edge excluded only
 * because an endpoint is stays excluded even when that endpoint is exempt —
 * the exemption brings back the node, not its neighbourhood. Returns one shared
 * empty value when nothing is excluded; the sets must not be mutated.
 */
export function excludedGraphElements(
	result: GraphQueryResult,
	exemptNodeIds?: ReadonlySet<string>
): ExcludedGraphElements {
	const nodeIds = new Set<string>();
	for (const [nodeId, state] of Object.entries(result.nodeStateById)) {
		if (state.role === 'excluded' && !exemptNodeIds?.has(nodeId)) nodeIds.add(nodeId);
	}
	const edgeIds = new Set<string>();
	for (const [edgeId, state] of Object.entries(result.edgeStateById)) {
		if (state.role === 'excluded') edgeIds.add(edgeId);
	}
	if (nodeIds.size === 0 && edgeIds.size === 0) return NOTHING_EXCLUDED;
	return { nodeIds, edgeIds };
}

/**
 * `graph` without the excluded nodes, without every edge that lost an endpoint,
 * and without the excluded edges.
 *
 * Returns `graph` itself when none of its nodes or edges is excluded. Never
 * mutates its input. `posByNodeId` passes through by reference, so an excluded
 * node keeps its position for when it returns.
 */
export function withoutExcludedElements(
	graph: MultigraphData,
	excluded: ExcludedGraphElements
): MultigraphData {
	const reduced = reducedArrays(graph, excluded);
	return reducedGraph(graph, reduced.nodes, reduced.edges);
}

/** `graph` with these arrays, or `graph` itself when they are its own. */
function reducedGraph(graph: MultigraphData, nodes: NodeData[], edges: EdgeData[]): MultigraphData {
	if (nodes === graph.nodes && edges === graph.edges) return graph;
	return { ...graph, nodes, edges };
}

function reducedArrays(
	graph: MultigraphData,
	excluded: ExcludedGraphElements
): { nodes: NodeData[]; edges: EdgeData[] } {
	const touchesGraph =
		graph.nodes.some((node) => excluded.nodeIds.has(node.id)) ||
		graph.edges.some((edge) => excluded.edgeIds.has(edge.id));
	if (!touchesGraph) return { nodes: graph.nodes, edges: graph.edges };

	const nodes = graph.nodes.filter((node) => !excluded.nodeIds.has(node.id));
	const survivingNodeIds = new Set(nodes.map((node) => node.id));
	const edges = graph.edges.filter(
		(edge) =>
			!excluded.edgeIds.has(edge.id) &&
			survivingNodeIds.has(edge.sourceNodeId) &&
			survivingNodeIds.has(edge.targetNodeId)
	);
	return { nodes, edges };
}

/**
 * A stable string for an excluded set, so two evaluations that exclude the same
 * elements compare equal whatever query text produced them.
 */
function excludedSetKey(excluded: ExcludedGraphElements): string {
	if (excluded === NOTHING_EXCLUDED) return '';
	// NUL cannot appear in a typed id, so it separates ids unambiguously.
	const nodeKey = [...excluded.nodeIds].sort().join('\u0000');
	const edgeKey = [...excluded.edgeIds].sort().join('\u0000');
	return `${nodeKey}\u0001${edgeKey}`;
}

interface ReducerEntry {
	nodes: NodeData[];
	edges: EdgeData[];
	queryText: string;
	exemptNodeIds: ReadonlySet<string> | undefined;
	excludedKey: string;
	reducedNodes: NodeData[];
	reducedEdges: EdgeData[];
	/** The last graph object reduced through this entry, and what it produced. */
	source: MultigraphData;
	output: MultigraphData;
}

/**
 * Enough entries for the graphs one frame asks about — the live graph, its
 * reduced form handed back in (reducing it again is how callers stay safe on
 * either graph), and the before/after pair of a scale change — without growing.
 */
const REDUCER_CACHE_LIMIT = 6;

/**
 * A memoized `(graph, queryText, exemptNodeIds) => graph minus what the query
 * excludes`, evaluated with the default tag syntax exactly as the query panel
 * evaluates it.
 *
 * The memo, from cheapest to dearest:
 *  1. Same `nodes`/`edges` references, query text and exempt-set reference as
 *     an earlier call: the query is not re-evaluated, since a node's role
 *     depends on nothing else. This is every position-only physics frame.
 *  2. Same `nodes`/`edges` references and an equal excluded set (by id, not by
 *     the text that produced it): the earlier reduced arrays are reused. This
 *     is a query edit that changes nothing in the exclusion, such as a hover
 *     preview's `+#tag`.
 *  3. Otherwise the arrays are rebuilt.
 *
 * Whenever nothing in the graph is excluded the input graph itself comes back,
 * which also makes reducing an already-reduced graph a no-op. The exempt set is
 * compared by reference, so callers must keep it identity-stable.
 */
export function createLayoutSourceReducer() {
	const cache: ReducerEntry[] = [];

	function remember(entry: ReducerEntry): void {
		cache.unshift(entry);
		cache.length = Math.min(cache.length, REDUCER_CACHE_LIMIT);
	}

	function outputFor(entry: ReducerEntry, graph: MultigraphData): MultigraphData {
		if (entry.source === graph) return entry.output;
		const output = reducedGraph(graph, entry.reducedNodes, entry.reducedEdges);
		entry.source = graph;
		entry.output = output;
		return output;
	}

	return function reduceLayoutSource(
		graph: MultigraphData,
		queryText: string,
		exemptNodeIds?: ReadonlySet<string>
	): MultigraphData {
		const sameQuery = cache.find(
			(entry) =>
				entry.nodes === graph.nodes &&
				entry.edges === graph.edges &&
				entry.queryText === queryText &&
				entry.exemptNodeIds === exemptNodeIds
		);
		if (sameQuery) return outputFor(sameQuery, graph);

		const excluded = excludedGraphElements(evaluateGraphQuery(graph, queryText), exemptNodeIds);
		const excludedKey = excludedSetKey(excluded);
		const sameExclusion = cache.find(
			(entry) =>
				entry.nodes === graph.nodes &&
				entry.edges === graph.edges &&
				entry.excludedKey === excludedKey
		);
		const reduced = sameExclusion
			? { nodes: sameExclusion.reducedNodes, edges: sameExclusion.reducedEdges }
			: reducedArrays(graph, excluded);

		const output = reducedGraph(graph, reduced.nodes, reduced.edges);
		remember({
			nodes: graph.nodes,
			edges: graph.edges,
			queryText,
			exemptNodeIds,
			excludedKey,
			reducedNodes: reduced.nodes,
			reducedEdges: reduced.edges,
			source: graph,
			output
		});
		return output;
	};
}
