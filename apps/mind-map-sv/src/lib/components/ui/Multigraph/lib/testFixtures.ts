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

export interface MakeRandomEdgesInput {
	nodeCount: number;
	edgeCount: number;
	/** Seed for deterministic pseudo-random endpoints. Default 42. */
	seed?: number;
}

/** Mulberry32 — small, fast, deterministic PRNG for test fixtures. */
function createSeededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Build deterministic random edge index pairs for stress-test graphs.
 * Self-loops and duplicate (source, target) pairs are skipped.
 */
export function makeRandomEdges({
	nodeCount,
	edgeCount,
	seed = 42
}: MakeRandomEdgesInput): Array<[number, number]> {
	if (edgeCount === 0) return [];
	if (nodeCount < 2) {
		throw new Error(`Cannot generate ${edgeCount} edges with nodeCount ${nodeCount}`);
	}

	const maxEdges = nodeCount * (nodeCount - 1);
	if (edgeCount > maxEdges) {
		throw new Error(
			`Cannot generate ${edgeCount} unique edges among ${nodeCount} nodes (max ${maxEdges})`
		);
	}

	const next = createSeededRandom(seed);
	const seen = new Set<string>();
	const edges: Array<[number, number]> = [];

	while (edges.length < edgeCount) {
		const source = Math.floor(next() * nodeCount);
		const target = Math.floor(next() * nodeCount);
		if (source === target) continue;

		const key = `${source},${target}`;
		if (seen.has(key)) continue;

		seen.add(key);
		edges.push([source, target]);
	}

	return edges;
}
