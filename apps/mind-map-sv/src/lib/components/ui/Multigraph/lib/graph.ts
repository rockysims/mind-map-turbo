import type { EdgeData } from '../../types/edge';
import type { MultigraphData, Point } from '../../types/multigraph';
import type { NodeData } from '../../types/node';

export interface AddNodeInput {
	id?: string;
	title?: string;
	description?: string;
	pinned?: boolean;
	position?: Point;
}

export interface AddEdgeInput {
	id?: string;
	color?: string;
}

const DEFAULT_NODE_POSITION: Point = { x: 0, y: 0 };
const DEFAULT_EDGE_COLOR = '#888';

export function addNode(data: MultigraphData, input: AddNodeInput = {}): MultigraphData {
	const id =
		input.id ??
		nextId(
			'n',
			data.nodes.map((node) => node.id)
		);
	const node: NodeData = {
		id,
		title: input.title ?? 'New Node',
		description: input.description ?? '',
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
	input: AddEdgeInput | string = {}
): MultigraphData {
	if (!hasNode(data, sourceNodeId) || !hasNode(data, targetNodeId)) return data;

	const edgeInput = typeof input === 'string' ? { color: input } : input;
	const edge: EdgeData = {
		id:
			edgeInput.id ??
			nextId(
				'e',
				data.edges.map((existingEdge) => existingEdge.id)
			),
		sourceNodeId,
		targetNodeId,
		color: edgeInput.color ?? DEFAULT_EDGE_COLOR
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

export function togglePinned(data: MultigraphData, nodeId: string): MultigraphData {
	if (!hasNode(data, nodeId)) return data;

	return {
		...data,
		nodes: data.nodes.map((node) => (node.id === nodeId ? { ...node, pinned: !node.pinned } : node))
	};
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

function nextId(prefix: string, existingIds: string[]): string {
	const usedIds = new Set(existingIds);
	let index = 0;

	while (usedIds.has(`${prefix}${index}`)) {
		index += 1;
	}

	return `${prefix}${index}`;
}
