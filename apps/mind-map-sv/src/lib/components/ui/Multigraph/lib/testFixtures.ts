/**
 * Test fixtures for graph data. Use these in unit specs and story tests
 * instead of hand-rolling node/edge arrays inline.
 *
 * As new fields appear on the domain types (e.g. `pinned`, weights, colors),
 * extend the builders here so every test gets the new defaults for free.
 */

import type { NodeData } from '../../types/node';
import type { EdgeData } from '../../types/edge';
import type { MultigraphData, Point, TagColorConfig } from '../../types/multigraph';
import type { ParsedTitleDirection } from './titleSyntax';

type MakeNodeInput = Omit<NodeData, 'tags'> & Partial<Pick<NodeData, 'tags'>>;
type MakeEdgeInput =
	| [number, number]
	| [string, string]
	| (Partial<Pick<EdgeData, 'id' | 'tags' | 'directed'>> & {
			source: number | string;
			target: number | string;
	  });

export const EMPTY_TAG_COLOR_CONFIG: TagColorConfig = {
	nodeTags: {},
	edgeTags: {}
};

export interface MakeGraphInput {
	/** Number of nodes to generate (with ids 'n0', 'n1', ...). Ignored if `nodes` is provided. */
	nodeCount?: number;
	/** Explicit nodes; takes precedence over nodeCount. */
	nodes?: MakeNodeInput[];
	/** Edges as endpoint pairs or objects with optional tags/direction fields. */
	edges?: MakeEdgeInput[];
	/** Nodes to mark pinned, by generated index or explicit id. */
	pinned?: Array<number | string>;
	/** Optional explicit positions, keyed by node id. Defaults to (0, 0). */
	posByNodeId?: Record<string, Point>;
	/** Optional graph-level tag colors. Defaults to empty node/edge maps. */
	tagColorConfig?: TagColorConfig;
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
		pinnedIds.has(node.id)
			? { ...node, tags: node.tags ?? [], pinned: true }
			: { ...node, tags: node.tags ?? [] }
	);

	const edges: EdgeData[] = (input.edges ?? []).map((edge, i) => {
		const source = Array.isArray(edge) ? edge[0] : edge.source;
		const target = Array.isArray(edge) ? edge[1] : edge.target;
		return {
			id: Array.isArray(edge) ? `e${i}` : (edge.id ?? `e${i}`),
			sourceNodeId: idAt(source),
			targetNodeId: idAt(target),
			tags: Array.isArray(edge) ? [] : (edge.tags ?? []),
			directed: Array.isArray(edge) ? false : (edge.directed ?? false)
		};
	});

	const posByNodeId =
		input.posByNodeId ?? Object.fromEntries(nodes.map((n) => [n.id, { x: 0, y: 0 }]));

	return {
		nodes,
		edges,
		posByNodeId,
		tagColorConfig: input.tagColorConfig ?? {
			nodeTags: {},
			edgeTags: {}
		}
	};
}

function defaultNodes(count: number): NodeData[] {
	return Array.from({ length: count }, (_, i) => ({
		id: `n${i}`,
		title: `Node ${i}`,
		description: `Description for node ${i}`,
		tags: []
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

export interface AssignNodeGroupsInput {
	nodeCount: number;
	groupCount: number;
	/** Seed for deterministic group assignment. Default 42. */
	seed?: number;
}

/**
 * Assign each node index to a group in `[0, groupCount)`.
 * Uses a seeded shuffle so fixtures stay reproducible in specs and stories.
 */
export function assignNodeGroups({
	nodeCount,
	groupCount,
	seed = 42
}: AssignNodeGroupsInput): number[] {
	if (nodeCount < 0) {
		throw new Error(`nodeCount must be non-negative, got ${nodeCount}`);
	}
	if (groupCount < 1) {
		throw new Error(`groupCount must be at least 1, got ${groupCount}`);
	}

	const next = createSeededRandom(seed);
	return Array.from({ length: nodeCount }, () => Math.floor(next() * groupCount));
}

export interface MakeClusteredRandomEdgesInput {
	nodeCount: number;
	edgeCount: number;
	groupCount: number;
	/** Fraction of edges that connect nodes in different groups (0–1). Default 0.1. */
	crossGroupFraction?: number;
	/** Seed for deterministic group assignment and edge endpoints. Default 42. */
	seed?: number;
}

function edgeKey(source: number, target: number): string {
	return `${source},${target}`;
}

function tryAddUniqueEdge(
	edges: Array<[number, number]>,
	seen: Set<string>,
	source: number,
	target: number
): boolean {
	if (source === target) return false;

	const key = edgeKey(source, target);
	if (seen.has(key)) return false;

	seen.add(key);
	edges.push([source, target]);
	return true;
}

function shuffleInPlace<T>(values: T[], next: () => number): void {
	for (let index = values.length - 1; index > 0; index -= 1) {
		const swapIndex = Math.floor(next() * (index + 1));
		[values[index], values[swapIndex]] = [values[swapIndex], values[index]];
	}
}

function countCrossGroupEdges(edges: Array<[number, number]>, groupByNode: number[]): number {
	return edges.filter(([source, target]) => groupByNode[source] !== groupByNode[target]).length;
}

/** Spanning trees inside each group plus a chain linking group representatives. */
function addConnectedBackbone(
	edges: Array<[number, number]>,
	seen: Set<string>,
	membersByGroup: number[][],
	next: () => number
): void {
	const representatives: number[] = [];

	for (const members of membersByGroup) {
		if (members.length === 0) continue;

		const shuffled = [...members];
		shuffleInPlace(shuffled, next);
		representatives.push(shuffled[0]);

		for (let index = 1; index < shuffled.length; index += 1) {
			tryAddUniqueEdge(edges, seen, shuffled[index - 1], shuffled[index]);
		}
	}

	shuffleInPlace(representatives, next);
	for (let index = 1; index < representatives.length; index += 1) {
		tryAddUniqueEdge(edges, seen, representatives[index - 1], representatives[index]);
	}
}

function fillRandomEdges(
	edges: Array<[number, number]>,
	seen: Set<string>,
	edgesToAdd: number,
	membersByGroup: number[][],
	groupCount: number,
	groupByNode: number[],
	next: () => number,
	crossGroup: boolean
): void {
	if (edgesToAdd === 0) return;

	const targetCount = edges.length + edgesToAdd;
	const maxAttempts = edgesToAdd * 200;
	let attempts = 0;

	while (edges.length < targetCount && attempts < maxAttempts) {
		attempts += 1;

		if (crossGroup) {
			const sourceGroup = Math.floor(next() * groupCount);
			const targetGroup = Math.floor(next() * groupCount);
			if (sourceGroup === targetGroup) continue;

			const sourceMembers = membersByGroup[sourceGroup];
			const targetMembers = membersByGroup[targetGroup];
			if (sourceMembers.length === 0 || targetMembers.length === 0) continue;

			const source = sourceMembers[Math.floor(next() * sourceMembers.length)];
			const target = targetMembers[Math.floor(next() * targetMembers.length)];
			if (groupByNode[source] === groupByNode[target]) continue;

			tryAddUniqueEdge(edges, seen, source, target);
			continue;
		}

		const groupIndex = Math.floor(next() * groupCount);
		const members = membersByGroup[groupIndex];
		if (members.length < 2) continue;

		const source = members[Math.floor(next() * members.length)];
		const target = members[Math.floor(next() * members.length)];
		tryAddUniqueEdge(edges, seen, source, target);
	}

	if (edges.length < targetCount) {
		const kind = crossGroup ? 'cross-group' : 'within-group';
		throw new Error(
			`Could only generate ${edges.length} of ${targetCount} ${kind} clustered edges`
		);
	}
}

/**
 * Build deterministic random edges biased toward within-group connections.
 * Nodes are randomly assigned to `groupCount` buckets; roughly
 * `(1 - crossGroupFraction)` of edges stay inside a bucket.
 *
 * When `edgeCount >= nodeCount - 1`, the result is a single connected graph:
 * each group is spanned internally, then representatives are chained across groups.
 */
export function makeClusteredRandomEdges({
	nodeCount,
	edgeCount,
	groupCount,
	crossGroupFraction = 0.1,
	seed = 42
}: MakeClusteredRandomEdgesInput): Array<[number, number]> {
	if (edgeCount === 0) return [];
	if (nodeCount < 2) {
		throw new Error(`Cannot generate ${edgeCount} edges with nodeCount ${nodeCount}`);
	}
	if (groupCount < 1) {
		throw new Error(`groupCount must be at least 1, got ${groupCount}`);
	}
	if (crossGroupFraction < 0 || crossGroupFraction > 1) {
		throw new Error(`crossGroupFraction must be in [0, 1], got ${crossGroupFraction}`);
	}
	if (edgeCount < nodeCount - 1) {
		throw new Error(
			`Cannot generate a connected graph: need at least ${nodeCount - 1} edges for ${nodeCount} nodes, got ${edgeCount}`
		);
	}

	const maxEdges = nodeCount * (nodeCount - 1);
	if (edgeCount > maxEdges) {
		throw new Error(
			`Cannot generate ${edgeCount} unique edges among ${nodeCount} nodes (max ${maxEdges})`
		);
	}

	const groupByNode = assignNodeGroups({ nodeCount, groupCount, seed });
	const membersByGroup = Array.from({ length: groupCount }, () => [] as number[]);
	for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
		membersByGroup[groupByNode[nodeIndex]].push(nodeIndex);
	}

	const populatedGroupCount = membersByGroup.filter((members) => members.length > 0).length;
	if (populatedGroupCount < 1) {
		throw new Error(`Cannot generate edges: no nodes were assigned to any group`);
	}

	const crossCount = Math.round(edgeCount * crossGroupFraction);
	const intraCount = edgeCount - crossCount;
	const next = createSeededRandom(seed + 1);
	const seen = new Set<string>();
	const edges: Array<[number, number]> = [];

	addConnectedBackbone(edges, seen, membersByGroup, next);

	const backboneCross = countCrossGroupEdges(edges, groupByNode);
	const backboneIntra = edges.length - backboneCross;
	if (backboneCross > crossCount) {
		throw new Error(
			`Connectivity backbone needs ${backboneCross} cross-group edges but crossGroupFraction allows only ${crossCount}`
		);
	}
	if (backboneIntra > intraCount) {
		throw new Error(
			`Connectivity backbone needs ${backboneIntra} within-group edges but only ${intraCount} are budgeted`
		);
	}

	fillRandomEdges(
		edges,
		seen,
		intraCount - backboneIntra,
		membersByGroup,
		groupCount,
		groupByNode,
		next,
		false
	);
	fillRandomEdges(
		edges,
		seen,
		crossCount - backboneCross,
		membersByGroup,
		groupCount,
		groupByNode,
		next,
		true
	);

	if (edges.length !== edgeCount) {
		throw new Error(
			`Expected ${edgeCount} clustered edges but generated ${edges.length} (${backboneCross} cross-group in backbone, target ${crossCount} cross-group total)`
		);
	}

	return edges;
}

export const DEFAULT_RANDOM_TAG_POOL = [
	'topic',
	'urgent',
	'idea',
	'ref',
	'rel',
	'strong',
	'weak',
	'meta',
	'core',
	'leaf',
	'group',
	'link',
	'note',
	'todo',
	'done'
] as const;

export interface WithRandomTagsAndDirectionsInput {
	/** Seed for deterministic tag counts and edge directions. Default 42. */
	seed?: number;
	/** Inclusive min/max tag counts per node. Defaults 0 and 4. */
	minNodeTags?: number;
	maxNodeTags?: number;
	/** Inclusive min/max tag counts per edge. Defaults 0 and 2. */
	minEdgeTags?: number;
	maxEdgeTags?: number;
	tagPool?: readonly string[];
}

function randomIntInclusive(next: () => number, min: number, max: number): number {
	if (min > max) {
		throw new Error(`min must be <= max, got ${min} > ${max}`);
	}

	return min + Math.floor(next() * (max - min + 1));
}

function pickRandomUniqueTags(
	next: () => number,
	count: number,
	pool: readonly string[]
): string[] {
	if (count === 0) return [];

	const shuffled = [...pool];
	shuffleInPlace(shuffled, next);
	return shuffled.slice(0, Math.min(count, shuffled.length));
}

/** Matches title-syntax directions: undirected (B), parent-to-child (>C), child-to-parent (<A). */
function randomTitleDirection(next: () => number): ParsedTitleDirection {
	const roll = Math.floor(next() * 3);
	if (roll === 0) return 'undirected';
	if (roll === 1) return 'parent-to-child';
	return 'child-to-parent';
}

function applyTitleDirectionToEdge(edge: EdgeData, direction: ParsedTitleDirection): EdgeData {
	if (direction === 'undirected') {
		return { ...edge, directed: false };
	}

	if (direction === 'parent-to-child') {
		return { ...edge, directed: true };
	}

	return {
		...edge,
		sourceNodeId: edge.targetNodeId,
		targetNodeId: edge.sourceNodeId,
		directed: true
	};
}

/**
 * Assign random node tags, edge tags, and edge directions to an existing graph.
 * Edge directions follow title-syntax semantics: undirected, parent-to-child
 * (stored source → target), or child-to-parent (swapped endpoints).
 */
export function withRandomTagsAndDirections(
	data: MultigraphData,
	input: WithRandomTagsAndDirectionsInput = {}
): MultigraphData {
	const {
		seed = 42,
		minNodeTags = 0,
		maxNodeTags = 4,
		minEdgeTags = 0,
		maxEdgeTags = 2,
		tagPool = DEFAULT_RANDOM_TAG_POOL
	} = input;

	const next = createSeededRandom(seed);

	const nodes = data.nodes.map((node) => ({
		...node,
		tags: pickRandomUniqueTags(next, randomIntInclusive(next, minNodeTags, maxNodeTags), tagPool)
	}));

	const edges = data.edges.map((edge) => {
		const direction = randomTitleDirection(next);
		const withDirection = applyTitleDirectionToEdge(edge, direction);

		return {
			...withDirection,
			tags: pickRandomUniqueTags(next, randomIntInclusive(next, minEdgeTags, maxEdgeTags), tagPool)
		};
	});

	return {
		...data,
		nodes,
		edges
	};
}
