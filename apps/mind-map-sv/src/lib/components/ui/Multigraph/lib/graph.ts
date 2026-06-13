import type { EdgeData } from '../../types/edge';
import type { MultigraphData, Point, TagColorNamespace } from '../../types/multigraph';
import type { NodeData } from '../../types/node';
import { parseTitleSyntax } from './titleSyntax';

export interface AddNodeInput {
	id?: string;
	title?: string;
	description?: string;
	tags?: string[];
	pinned?: boolean;
	position?: Point;
}

export interface AddEdgeInput {
	id?: string;
	tags?: string[];
	directed?: boolean;
}

export type EdgePatch = Partial<
	Pick<EdgeData, 'sourceNodeId' | 'targetNodeId' | 'tags' | 'directed'>
>;

const DEFAULT_NODE_POSITION: Point = { x: 0, y: 0 };

export const NEW_NODE_TITLE = 'New Node';

/** Returns a trimmed title, falling back to NEW_NODE_TITLE when empty. */
export function normalizeNodeTitle(title: string): string {
	return title.trim() || NEW_NODE_TITLE;
}

/**
 * Returns the first edge whose endpoints match the given source/target pair,
 * treating the match as undirected (so n0→n1 and n1→n0 are considered the
 * same edge). Returns undefined when no match exists.
 *
 * NOTE: Undirected matching is intentional until directed-edge semantics land
 * in milestone 04e. At that point this helper can add a `directed` parameter
 * without touching callers.
 */
export function findExistingEdge(
	data: MultigraphData,
	sourceNodeId: string,
	targetNodeId: string
): EdgeData | undefined {
	return data.edges.find(
		(edge) =>
			(edge.sourceNodeId === sourceNodeId && edge.targetNodeId === targetNodeId) ||
			(edge.sourceNodeId === targetNodeId && edge.targetNodeId === sourceNodeId)
	);
}

export function addNode(data: MultigraphData, input: AddNodeInput = {}): MultigraphData {
	const id =
		input.id ??
		nextId(
			'n',
			data.nodes.map((node) => node.id)
		);
	const node: NodeData = {
		id,
		title: input.title ?? NEW_NODE_TITLE,
		description: input.description ?? '',
		tags: input.tags ?? [],
		pinned: input.pinned
	};

	return {
		...data,
		nodes: [...data.nodes, node],
		posByNodeId: {
			...data.posByNodeId,
			[id]: input.position ?? data.posByNodeId[id] ?? { ...DEFAULT_NODE_POSITION }
		}
	};
}

export function removeNode(data: MultigraphData, id: string): MultigraphData {
	if (!data.nodes.some((node) => node.id === id)) return data;

	const posByNodeId = { ...data.posByNodeId };
	delete posByNodeId[id];

	return {
		...data,
		nodes: data.nodes.filter((node) => node.id !== id),
		edges: data.edges.filter((edge) => edge.sourceNodeId !== id && edge.targetNodeId !== id),
		posByNodeId
	};
}

export function addEdge(
	data: MultigraphData,
	sourceNodeId: string,
	targetNodeId: string,
	input: AddEdgeInput = {}
): MultigraphData {
	if (!hasNode(data, sourceNodeId) || !hasNode(data, targetNodeId)) return data;

	const edge: EdgeData = {
		id:
			input.id ??
			nextId(
				'e',
				data.edges.map((existingEdge) => existingEdge.id)
			),
		sourceNodeId,
		targetNodeId,
		tags: input.tags ?? [],
		directed: input.directed ?? false
	};

	return {
		...data,
		edges: [...data.edges, edge]
	};
}

export function removeEdge(data: MultigraphData, edgeId: string): MultigraphData {
	if (!data.edges.some((edge) => edge.id === edgeId)) return data;

	return {
		...data,
		edges: data.edges.filter((edge) => edge.id !== edgeId)
	};
}

export function updateEdge(data: MultigraphData, edgeId: string, patch: EdgePatch): MultigraphData {
	if (!data.edges.some((edge) => edge.id === edgeId)) return data;
	if (patch.sourceNodeId !== undefined && !hasNode(data, patch.sourceNodeId)) return data;
	if (patch.targetNodeId !== undefined && !hasNode(data, patch.targetNodeId)) return data;

	return {
		...data,
		edges: data.edges.map((edge) => (edge.id === edgeId ? { ...edge, ...patch } : edge))
	};
}

export function togglePinned(data: MultigraphData, nodeId: string): MultigraphData {
	if (!hasNode(data, nodeId)) return data;

	return {
		...data,
		nodes: data.nodes.map((node) => (node.id === nodeId ? { ...node, pinned: !node.pinned } : node))
	};
}

export function updateNodeContent(
	data: MultigraphData,
	nodeId: string,
	content: Pick<NodeData, 'title' | 'description'> & Partial<Pick<NodeData, 'tags'>>
): MultigraphData {
	if (!hasNode(data, nodeId)) return data;

	return {
		...data,
		nodes: data.nodes.map((node) =>
			node.id === nodeId ? { ...node, ...content, title: normalizeNodeTitle(content.title) } : node
		)
	};
}

export function setTagColor(
	data: MultigraphData,
	namespace: TagColorNamespace,
	tag: string,
	color: string
): MultigraphData {
	return {
		...data,
		tagColorConfig: {
			...data.tagColorConfig,
			[namespace]: {
				...data.tagColorConfig[namespace],
				[tag]: color
			}
		}
	};
}

export function deleteTagEverywhere(
	data: MultigraphData,
	namespace: TagColorNamespace,
	tag: string
): MultigraphData {
	const nextConfig = { ...data.tagColorConfig[namespace] };
	delete nextConfig[tag];

	return {
		...data,
		nodes:
			namespace === 'nodeTags'
				? data.nodes.map((node) => ({
						...node,
						tags: node.tags.filter((candidate) => candidate !== tag)
					}))
				: data.nodes,
		edges:
			namespace === 'edgeTags'
				? data.edges.map((edge) => ({
						...edge,
						tags: edge.tags.filter((candidate) => candidate !== tag)
					}))
				: data.edges,
		tagColorConfig: {
			...data.tagColorConfig,
			[namespace]: nextConfig
		}
	};
}

export function commitInlineTitleSyntax(
	data: MultigraphData,
	nodeId: string,
	rawTitle: string,
	createdEdgeId?: string
): MultigraphData {
	if (!hasNode(data, nodeId)) return data;

	const parsed = parseTitleSyntax(rawTitle);
	const graphWithNode = updateNodeContent(data, nodeId, {
		title: parsed.displayTitle,
		description: data.nodes.find((node) => node.id === nodeId)?.description ?? '',
		tags: parsed.nodeTags
	});

	if (!createdEdgeId) return graphWithNode;

	const edge = graphWithNode.edges.find((candidate) => candidate.id === createdEdgeId);
	if (!edge) return graphWithNode;
	if (!isIncidentEdge(edge, nodeId)) return graphWithNode;

	const endpointPatch =
		parsed.direction === 'child-to-parent'
			? { sourceNodeId: nodeId, targetNodeId: otherEndpoint(edge, nodeId) }
			: parsed.direction === 'parent-to-child'
				? { sourceNodeId: otherEndpoint(edge, nodeId), targetNodeId: nodeId }
				: {};

	return updateEdge(graphWithNode, createdEdgeId, {
		...endpointPatch,
		tags: parsed.edgeTags,
		directed: parsed.direction === 'undirected' ? false : true
	});
}

export function moveNode(data: MultigraphData, nodeId: string, point: Point): MultigraphData {
	if (!hasNode(data, nodeId)) return data;

	return {
		...data,
		posByNodeId: {
			...data.posByNodeId,
			[nodeId]: point
		}
	};
}

export function neighborsOf(data: MultigraphData, nodeId: string): NodeData[] {
	const neighborIds = new Set<string>();

	for (const edge of data.edges) {
		if (edge.sourceNodeId === nodeId) neighborIds.add(edge.targetNodeId);
		if (edge.targetNodeId === nodeId) neighborIds.add(edge.sourceNodeId);
	}

	return data.nodes.filter((node) => neighborIds.has(node.id));
}

function hasNode(data: MultigraphData, nodeId: string): boolean {
	return data.nodes.some((node) => node.id === nodeId);
}

function isIncidentEdge(edge: EdgeData, nodeId: string): boolean {
	return edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId;
}

function otherEndpoint(edge: EdgeData, nodeId: string): string {
	return edge.sourceNodeId === nodeId ? edge.targetNodeId : edge.sourceNodeId;
}

function nextId(prefix: string, existingIds: string[]): string {
	const usedIds = new Set(existingIds);
	let index = 0;

	while (usedIds.has(`${prefix}${index}`)) {
		index += 1;
	}

	return `${prefix}${index}`;
}
