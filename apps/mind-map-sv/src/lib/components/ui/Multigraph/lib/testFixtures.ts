/**
 * Test fixtures for graph data. Use these in unit specs and story tests
 * instead of hand-rolling node/edge arrays inline.
 *
 * As new fields appear on the domain types (e.g. `pinned`, weights, colors),
 * extend the builders here so every test gets the new defaults for free.
 */

import type { NodeData } from '../../types/node';
import type { EdgeData } from '../../types/edge';
import type { MultigraphData, Point } from '../../types/multigraph';

export interface MakeGraphInput {
	/** Number of nodes to generate (with ids 'n0', 'n1', ...). Ignored if `nodes` is provided. */
	nodeCount?: number;
	/** Explicit nodes; takes precedence over nodeCount. */
	nodes?: NodeData[];
	/** Edges as [sourceIndex, targetIndex] pairs (or [sourceId, targetId] strings). */
	edges?: Array<[number, number] | [string, string]>;
	/** Nodes to mark pinned, by generated index or explicit id. */
	pinned?: Array<number | string>;
	/** Optional explicit positions, keyed by node id. Defaults to (0, 0). */
	posByNodeId?: Record<string, Point>;
}

/**
 * Build a `MultigraphData` for tests.
 *
 * @example
 *   const g = makeGraph({ nodeCount: 3, edges: [[0, 1], [1, 2]] });
 *   //  → 3 nodes (n0..n2), 2 edges, all positioned at (0, 0)
 */
export function makeGraph(input: MakeGraphInput = {}): MultigraphData {
	const baseNodes = input.nodes ?? defaultNodes(input.nodeCount ?? 0);
	const idAt = (idx: number | string): string =>
		typeof idx === 'number' ? (baseNodes[idx]?.id ?? `n${idx}`) : idx;
	const pinnedIds = new Set((input.pinned ?? []).map(idAt));
	const nodes = baseNodes.map((node) =>
		pinnedIds.has(node.id) ? { ...node, pinned: true } : { ...node }
	);

	const edges: EdgeData[] = (input.edges ?? []).map(([s, t], i) => ({
		id: `e${i}`,
		sourceNodeId: idAt(s),
		targetNodeId: idAt(t),
		color: '#888'
	}));

	const posByNodeId =
		input.posByNodeId ?? Object.fromEntries(nodes.map((n) => [n.id, { x: 0, y: 0 }]));

	return { nodes, edges, posByNodeId };
}

function defaultNodes(count: number): NodeData[] {
	return Array.from({ length: count }, (_, i) => ({
		id: `n${i}`,
		title: `Node ${i}`,
		description: `Description for node ${i}`
	}));
}
