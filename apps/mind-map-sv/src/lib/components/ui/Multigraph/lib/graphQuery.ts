import type { MultigraphData } from '../../types/multigraph';
import type { NodeData } from '../../types/node';
import { colorForTag } from './tagColors';

export type GraphQueryTokenMode = 'focus' | 'spotlight' | 'exclude';
export type GraphQueryTokenTarget = 'nodeTag' | 'edgeTag' | 'text';
export type GraphQueryRole = 'focus' | 'spotlight' | 'context' | 'background' | 'excluded';

export interface GraphQueryToken {
	mode: GraphQueryTokenMode;
	target: GraphQueryTokenTarget;
	value: string;
}

export interface GraphQueryElementState {
	role: GraphQueryRole;
	spotlightColor?: string;
}

export interface GraphQueryRegion {
	id: string;
	nodeIds: string[];
	edgeIds: string[];
}

export interface GraphQueryResult {
	tokens: GraphQueryToken[];
	hasActiveQuery: boolean;
	dimsBackground: boolean;
	nodeStateById: Record<string, GraphQueryElementState>;
	edgeStateById: Record<string, GraphQueryElementState>;
	regions: GraphQueryRegion[];
	focusedNodeIds: string[];
	focusedEdgeIds: string[];
}

type MutableElementState = {
	role: GraphQueryRole;
	spotlightColor?: string;
	spotlightOrder?: number;
};

export function parseGraphQuery(input: string): GraphQueryToken[] {
	const tokens: GraphQueryToken[] = [];
	let index = 0;

	while (index < input.length) {
		const current = input[index];
		if (isWhitespace(current)) {
			index += 1;
			continue;
		}

		let mode: GraphQueryTokenMode = 'focus';
		if (
			(current === '+' || current === '-') &&
			index + 1 < input.length &&
			(input[index + 1] === '#' || input[index + 1] === '@' || input[index + 1] === '"')
		) {
			mode = current === '+' ? 'spotlight' : 'exclude';
			index += 1;
		}

		const marker = input[index];
		if (marker === '"') {
			const parsed = readQuoted(input, index + 1);
			if (parsed.value.trim()) {
				tokens.push({ mode, target: 'text', value: parsed.value.trim() });
			}
			index = parsed.nextIndex;
			continue;
		}

		if (marker === '#' || marker === '@') {
			const parsed = readTag(input, index + 1);
			if (parsed.value) {
				tokens.push({
					mode,
					target: marker === '#' ? 'nodeTag' : 'edgeTag',
					value: parsed.value
				});
			}
			index = parsed.nextIndex;
			continue;
		}

		const parsed = readText(input, index);
		if (parsed.value) {
			tokens.push({ mode: 'focus', target: 'text', value: parsed.value });
		}
		index = parsed.nextIndex;
	}

	return tokens;
}

export function evaluateGraphQuery(data: MultigraphData, input: string): GraphQueryResult {
	const tokens = parseGraphQuery(input);
	if (tokens.length === 0) {
		return {
			tokens,
			hasActiveQuery: false,
			dimsBackground: false,
			nodeStateById: {},
			edgeStateById: {},
			regions: [],
			focusedNodeIds: [],
			focusedEdgeIds: []
		};
	}

	const nodeStates = Object.fromEntries(
		data.nodes.map((node) => [node.id, { role: 'background' as GraphQueryRole }])
	);
	const edgeStates = Object.fromEntries(
		data.edges.map((edge) => [edge.id, { role: 'background' as GraphQueryRole }])
	);

	for (const [tokenIndex, token] of tokens.entries()) {
		if (token.target === 'text') {
			for (const node of data.nodes) {
				if (!nodeTextMatches(node, token.value)) continue;
				applyTokenToState(nodeStates[node.id], token, tokenIndex);
			}
			continue;
		}

		if (token.target === 'nodeTag') {
			for (const node of data.nodes) {
				const matchedTag = matchingTag(node.tags, token.value);
				if (!matchedTag) continue;
				applyTokenToState(nodeStates[node.id], token, tokenIndex, {
					spotlightColor: colorForTag(data.tagColorConfig.nodeTags, matchedTag).color
				});
			}
			continue;
		}

		for (const edge of data.edges) {
			const matchedTag = matchingTag(edge.tags, token.value);
			if (!matchedTag) continue;
			applyTokenToState(edgeStates[edge.id], token, tokenIndex, {
				spotlightColor: colorForTag(data.tagColorConfig.edgeTags, matchedTag).color
			});
		}
	}

	for (const edge of data.edges) {
		const sourceState = nodeStates[edge.sourceNodeId];
		const targetState = nodeStates[edge.targetNodeId];
		const edgeState = edgeStates[edge.id];
		if (!sourceState || !targetState || !edgeState) continue;

		if (sourceState.role === 'excluded' || targetState.role === 'excluded') {
			edgeState.role = 'excluded';
			continue;
		}

		if (
			(edgeState.role === 'focus' || edgeState.role === 'spotlight') &&
			sourceState.role === 'background'
		) {
			sourceState.role = 'context';
		}
		if (
			(edgeState.role === 'focus' || edgeState.role === 'spotlight') &&
			targetState.role === 'background'
		) {
			targetState.role = 'context';
		}
	}

	const nodeStateById = finalizeStates(nodeStates);
	const edgeStateById = finalizeStates(edgeStates);
	const focusedNodeIds = data.nodes
		.filter((node) => isFocusedRole(nodeStateById[node.id]?.role))
		.map((node) => node.id);
	const focusedEdgeIds = data.edges
		.filter((edge) => isFocusedRole(edgeStateById[edge.id]?.role))
		.map((edge) => edge.id);

	return {
		tokens,
		hasActiveQuery: true,
		dimsBackground: tokens.some((token) => token.mode !== 'exclude'),
		nodeStateById,
		edgeStateById,
		focusedNodeIds,
		focusedEdgeIds,
		regions: computeGraphQueryRegions(data, nodeStateById, edgeStateById)
	};
}

export function computeGraphQueryRegions(
	data: MultigraphData,
	nodeStateById: Record<string, GraphQueryElementState>,
	edgeStateById: Record<string, GraphQueryElementState>
): GraphQueryRegion[] {
	const relevantNodeIds = new Set<string>();
	const relevantEdgeIds = new Set<string>();

	for (const node of data.nodes) {
		if (isFocusedRole(nodeStateById[node.id]?.role)) relevantNodeIds.add(node.id);
	}
	for (const edge of data.edges) {
		if (!isFocusedRole(edgeStateById[edge.id]?.role)) continue;
		relevantEdgeIds.add(edge.id);
		relevantNodeIds.add(edge.sourceNodeId);
		relevantNodeIds.add(edge.targetNodeId);
	}

	const adjacency = Object.fromEntries(
		[...relevantNodeIds].map((nodeId) => [nodeId, [] as string[]])
	);
	for (const edge of data.edges) {
		if (!relevantEdgeIds.has(edge.id)) continue;
		if (!adjacency[edge.sourceNodeId] || !adjacency[edge.targetNodeId]) continue;
		adjacency[edge.sourceNodeId].push(edge.targetNodeId);
		adjacency[edge.targetNodeId].push(edge.sourceNodeId);
	}

	const visited = new Set<string>();
	const regions: GraphQueryRegion[] = [];

	for (const nodeId of relevantNodeIds) {
		if (visited.has(nodeId)) continue;
		const queue = [nodeId];
		const regionNodeIds: string[] = [];
		visited.add(nodeId);

		for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
			const current = queue[queueIndex];
			regionNodeIds.push(current);
			for (const next of adjacency[current] ?? []) {
				if (visited.has(next)) continue;
				visited.add(next);
				queue.push(next);
			}
		}

		const regionNodeLookup = new Set(regionNodeIds);
		const regionEdgeIds = data.edges
			.filter(
				(edge) =>
					relevantEdgeIds.has(edge.id) &&
					regionNodeLookup.has(edge.sourceNodeId) &&
					regionNodeLookup.has(edge.targetNodeId)
			)
			.map((edge) => edge.id);

		regions.push({
			id: `region-${regions.length}`,
			nodeIds: regionNodeIds.sort(),
			edgeIds: regionEdgeIds.sort()
		});
	}

	return regions;
}

function applyTokenToState(
	state: MutableElementState,
	token: GraphQueryToken,
	tokenIndex: number,
	options: { spotlightColor?: string } = {}
): void {
	if (token.mode === 'exclude') {
		state.role = 'excluded';
		return;
	}
	if (state.role === 'excluded') return;
	if (token.mode === 'spotlight') {
		state.role = 'spotlight';
		if (state.spotlightOrder === undefined || tokenIndex < state.spotlightOrder) {
			state.spotlightOrder = tokenIndex;
			state.spotlightColor = options.spotlightColor;
		}
		return;
	}
	if (state.role === 'background' || state.role === 'context') {
		state.role = 'focus';
	}
}

function finalizeStates(
	states: Record<string, MutableElementState>
): Record<string, GraphQueryElementState> {
	return Object.fromEntries(
		Object.entries(states).map(([id, state]) => [
			id,
			{
				role: state.role,
				...(state.spotlightColor ? { spotlightColor: state.spotlightColor } : {})
			}
		])
	);
}

function matchingTag(tags: string[], queryTag: string): string | undefined {
	const normalizedQuery = normalize(queryTag);
	return tags.find((tag) => normalize(tag) === normalizedQuery);
}

function nodeTextMatches(node: NodeData, queryText: string): boolean {
	const needle = normalize(queryText);
	return normalize(node.title).includes(needle) || normalize(node.description).includes(needle);
}

function isFocusedRole(role: GraphQueryRole | undefined): boolean {
	return role === 'focus' || role === 'spotlight';
}

function normalize(value: string): string {
	return value.toLocaleLowerCase();
}

function isWhitespace(value: string | undefined): boolean {
	return value === ' ' || value === '\n' || value === '\t' || value === '\r';
}

function readQuoted(input: string, start: number): { value: string; nextIndex: number } {
	let index = start;
	let value = '';
	while (index < input.length && input[index] !== '"') {
		value += input[index];
		index += 1;
	}
	return { value, nextIndex: index < input.length ? index + 1 : index };
}

function readTag(input: string, start: number): { value: string; nextIndex: number } {
	let index = start;
	let value = '';
	while (index < input.length) {
		const current = input[index];
		const next = input[index + 1];
		if (
			isWhitespace(current) ||
			current === '#' ||
			current === '@' ||
			((current === '+' || current === '-') && (next === '#' || next === '@' || next === '"'))
		) {
			break;
		}
		value += current;
		index += 1;
	}
	return { value, nextIndex: index };
}

function readText(input: string, start: number): { value: string; nextIndex: number } {
	let index = start;
	let value = '';
	while (index < input.length) {
		const current = input[index];
		const next = input[index + 1];
		if (
			isWhitespace(current) ||
			current === '#' ||
			current === '@' ||
			((current === '+' || current === '-') && (next === '#' || next === '@' || next === '"'))
		) {
			break;
		}
		value += current;
		index += 1;
	}
	return { value, nextIndex: index };
}
