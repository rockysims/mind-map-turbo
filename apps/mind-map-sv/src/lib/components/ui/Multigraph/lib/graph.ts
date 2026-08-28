import type { EdgeData } from '../../types/edge';
import type {
	GraphAssetMetadata,
	MultigraphData,
	Point,
	TagColorNamespace
} from '../../types/multigraph';
import type { NodeData, NodeImageContent, QuantityDesignation } from '../../types/node';
import { mathPlainText } from '../../MathText/lib/mathPlainText';
import { symbolFor } from '../../MathText/lib/mathSymbols';
import { parseTitleSyntax } from './titleSyntax';

export interface AddNodeInput {
	id?: string;
	title?: string;
	description?: string;
	tags?: string[];
	pinned?: boolean;
	position?: Point;
	inputs?: QuantityDesignation[];
	outputs?: QuantityDesignation[];
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

export function duplicateEdgeIdentifier(data: MultigraphData, edgeId: string): string {
	const edge = data.edges.find((candidate) => candidate.id === edgeId);
	if (!edge) return 'Unknown edge';

	// Projected, because this string is shown to a person deciding which edge to
	// remove. Raw `$v_0$` would be worse than the node id it replaced.
	const sourceTitle = mathPlainText(
		normalizeNodeTitle(data.nodes.find((node) => node.id === edge.sourceNodeId)?.title ?? '')
	);
	const targetTitle = mathPlainText(
		normalizeNodeTitle(data.nodes.find((node) => node.id === edge.targetNodeId)?.title ?? '')
	);

	return `${sourceTitle} -- ${targetTitle}`;
}

export function addNode(data: MultigraphData, input: AddNodeInput = {}): MultigraphData {
	const id =
		input.id ??
		nextId(
			'n',
			data.nodes.map((node) => node.id)
		);
	const pinSequence = input.pinned ? nextPinSequence(data) : undefined;
	const node: NodeData = {
		id,
		title: input.title ?? NEW_NODE_TITLE,
		description: input.description ?? '',
		tags: input.tags ?? [],
		pinned: input.pinned,
		lastPinnedSeq: pinSequence,
		inputs: input.inputs === undefined ? undefined : dedupeDesignations(input.inputs),
		outputs: input.outputs === undefined ? undefined : dedupeDesignations(input.outputs)
	};

	return {
		...data,
		nodes: [...data.nodes, node],
		posByNodeId: {
			...data.posByNodeId,
			[id]: input.position ?? data.posByNodeId[id] ?? { ...DEFAULT_NODE_POSITION }
		},
		pinSequence: pinSequence ?? data.pinSequence
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
	const node = data.nodes.find((candidate) => candidate.id === nodeId);
	if (!node) return data;

	return setNodePinned(data, nodeId, !node.pinned);
}

export function setNodePinned(
	data: MultigraphData,
	nodeId: string,
	pinned: boolean
): MultigraphData {
	const node = data.nodes.find((candidate) => candidate.id === nodeId);
	if (!node || (node.pinned ?? false) === pinned) return data;

	// Both pin and unpin stamp recency, so a component's beacon is the node
	// whose pin state the user touched last.
	const pinSequence = nextPinSequence(data);

	return {
		...data,
		nodes: data.nodes.map((candidate) =>
			candidate.id === nodeId ? { ...candidate, pinned, lastPinnedSeq: pinSequence } : candidate
		),
		pinSequence
	};
}

export function updateNodeContent(
	data: MultigraphData,
	nodeId: string,
	content: Pick<NodeData, 'title' | 'description'> &
		Partial<Pick<NodeData, 'tags' | 'content' | 'inputs' | 'outputs'>>
): MultigraphData {
	if (!hasNode(data, nodeId)) return data;

	return {
		...data,
		nodes: data.nodes.map((node) =>
			node.id === nodeId ? { ...node, ...content, title: normalizeNodeTitle(content.title) } : node
		)
	};
}

/**
 * Replaces a node's confirmed input/output designations. Duplicates collapse to
 * the first occurrence; user order is otherwise preserved.
 */
export function setNodeDesignations(
	data: MultigraphData,
	nodeId: string,
	io: { inputs: QuantityDesignation[]; outputs: QuantityDesignation[] }
): MultigraphData {
	if (!hasNode(data, nodeId)) return data;

	return {
		...data,
		nodes: data.nodes.map((node) =>
			node.id === nodeId
				? {
						...node,
						inputs: dedupeDesignations(io.inputs),
						outputs: dedupeDesignations(io.outputs)
					}
				: node
		)
	};
}

/** A designation's canonical identity — the key of the symbol it designates. */
export function designationKey(designation: QuantityDesignation): string {
	return symbolFor(designation.base, designation.subscript).key;
}

function dedupeDesignations(designations: readonly QuantityDesignation[]): QuantityDesignation[] {
	const seen = new Set<string>();
	const result: QuantityDesignation[] = [];
	for (const designation of designations) {
		const key = designationKey(designation);
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(designation);
	}
	return result;
}

export function addNodeImageContent(
	data: MultigraphData,
	nodeId: string,
	image: NodeImageContent,
	asset: GraphAssetMetadata
): MultigraphData {
	if (!hasNode(data, nodeId)) return data;

	return {
		...data,
		assets: {
			...(data.assets ?? {}),
			[asset.id]: asset
		},
		nodes: data.nodes.map((node) =>
			node.id === nodeId ? { ...node, content: [...(node.content ?? []), image] } : node
		)
	};
}

export function updateNodeImageContent(
	data: MultigraphData,
	nodeId: string,
	assetId: string,
	patch: Pick<NodeImageContent, 'alt'> & Partial<Pick<NodeImageContent, 'caption'>>
): MultigraphData {
	if (!hasNode(data, nodeId)) return data;

	return {
		...data,
		nodes: data.nodes.map((node) =>
			node.id === nodeId
				? {
						...node,
						content: (node.content ?? []).map((block) =>
							block.type === 'image' && block.assetId === assetId ? { ...block, ...patch } : block
						)
					}
				: node
		)
	};
}

export function moveNodeContentBlock(
	data: MultigraphData,
	nodeId: string,
	fromIndex: number,
	toIndex: number
): MultigraphData {
	const node = data.nodes.find((candidate) => candidate.id === nodeId);
	if (!node) return data;
	const content = node.content ?? [];
	if (fromIndex < 0 || fromIndex >= content.length || toIndex < 0 || toIndex >= content.length) {
		return data;
	}
	const nextContent = [...content];
	const [block] = nextContent.splice(fromIndex, 1);
	if (!block) return data;
	nextContent.splice(toIndex, 0, block);
	return {
		...data,
		nodes: data.nodes.map((candidate) =>
			candidate.id === nodeId ? { ...candidate, content: nextContent } : candidate
		)
	};
}

export function removeNodeImageContent(
	data: MultigraphData,
	nodeId: string,
	assetId: string
): { graph: MultigraphData; removedAssetIds: string[] } {
	if (!hasNode(data, nodeId)) return { graph: data, removedAssetIds: [] };
	const nextGraph = {
		...data,
		nodes: data.nodes.map((node) =>
			node.id === nodeId
				? {
						...node,
						content: (node.content ?? []).filter(
							(block) => !(block.type === 'image' && block.assetId === assetId)
						)
					}
				: node
		)
	};
	if (isAssetReferenced(nextGraph, assetId)) return { graph: nextGraph, removedAssetIds: [] };
	const nextAssets = { ...(nextGraph.assets ?? {}) };
	delete nextAssets[assetId];
	return { graph: { ...nextGraph, assets: nextAssets }, removedAssetIds: [assetId] };
}

export function referencedAssetIds(data: MultigraphData): Set<string> {
	const ids = new Set<string>();
	for (const node of data.nodes) {
		for (const block of node.content ?? []) {
			if (block.type === 'image') ids.add(block.assetId);
		}
	}
	return ids;
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

function nextPinSequence(data: MultigraphData): number {
	// Max over nodes keeps the counter self-healing when pinSequence is missing
	// or stale. Looped rather than spread into Math.max: a spread of every node
	// throws RangeError once the graph passes the argument-count limit.
	let highest = data.pinSequence ?? 0;
	for (const node of data.nodes) {
		const seq = node.lastPinnedSeq ?? 0;
		if (seq > highest) highest = seq;
	}

	return highest + 1;
}

function isAssetReferenced(data: MultigraphData, assetId: string): boolean {
	return referencedAssetIds(data).has(assetId);
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
