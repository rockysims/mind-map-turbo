import type { EdgeData } from './components/ui/types/edge';
import type { MultigraphData, Point, TagColorConfig } from './components/ui/types/multigraph';
import type { NodeData } from './components/ui/types/node';

export const CURRENT_SCHEMA_VERSION = 3;

const EMPTY_TAG_COLOR_CONFIG: TagColorConfig = {
	nodeTags: {},
	edgeTags: {}
};

export type ViewState = {
	panX: number;
	panY: number;
	scale: number;
};

export const NEUTRAL_VIEW_STATE: ViewState = { panX: 0, panY: 0, scale: 1 };

export type PersistedGraphPayload = {
	schemaVersion: typeof CURRENT_SCHEMA_VERSION;
	data: MultigraphData;
	viewState?: ViewState;
};

export class PersistedGraphError extends Error {
	constructor(
		message: string,
		readonly code: 'malformed-payload' | 'unsupported-version'
	) {
		super(message);
		this.name = 'PersistedGraphError';
	}
}

export function wrapPersistedGraph(data: MultigraphData): PersistedGraphPayload {
	return {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		data
	};
}

export function unwrapPersistedGraph(payload: unknown): MultigraphData {
	if (!isRecord(payload)) {
		throw new PersistedGraphError(
			'Persisted graph payload must be an object.',
			'malformed-payload'
		);
	}

	if (payload.schemaVersion === 1) {
		if (
			!isMultigraphData(payload.data, {
				allowLegacyTags: true,
				allowLegacyEdgeColor: true,
				allowMissingTagColorConfig: true
			})
		) {
			throw new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload');
		}
		return migrateLegacyGraphData(payload.data, { allowMissingTags: true });
	}

	if (payload.schemaVersion === 2) {
		if (
			!isMultigraphData(payload.data, {
				allowLegacyEdgeColor: true,
				allowMissingTagColorConfig: true
			})
		) {
			throw new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload');
		}
		return migrateLegacyGraphData(payload.data);
	}

	if (payload.schemaVersion !== CURRENT_SCHEMA_VERSION) {
		throw new PersistedGraphError(
			`Unsupported graph schema version: ${String(payload.schemaVersion)}`,
			'unsupported-version'
		);
	}

	if (!isMultigraphData(payload.data)) {
		throw new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload');
	}

	return payload.data;
}

export function parsePersistedGraph(json: string): MultigraphData {
	try {
		return unwrapPersistedGraph(JSON.parse(json));
	} catch (error) {
		if (error instanceof PersistedGraphError) throw error;
		throw new PersistedGraphError('Persisted graph JSON is malformed.', 'malformed-payload');
	}
}

function migrateLegacyGraphData(
	data: MultigraphData,
	options: { allowMissingTags?: boolean } = {}
): MultigraphData {
	return {
		...data,
		nodes: data.nodes.map((node) => ({
			...node,
			tags: options.allowMissingTags ? (node.tags ?? []) : node.tags
		})),
		edges: data.edges.map(migrateLegacyEdge),
		tagColorConfig: { ...EMPTY_TAG_COLOR_CONFIG }
	};
}

function isMultigraphData(
	value: unknown,
	options: {
		allowLegacyTags?: boolean;
		allowLegacyEdgeColor?: boolean;
		allowMissingTagColorConfig?: boolean;
	} = {}
): value is MultigraphData {
	if (!isRecord(value)) return false;
	if (!Array.isArray(value.nodes) || !Array.isArray(value.edges) || !isRecord(value.posByNodeId)) {
		return false;
	}

	return (
		value.nodes.every((node) => isNodeData(node, options)) &&
		value.edges.every((edge) => isEdgeData(edge, options)) &&
		Object.values(value.posByNodeId).every(isPoint) &&
		(options.allowMissingTagColorConfig
			? value.tagColorConfig === undefined || isTagColorConfig(value.tagColorConfig)
			: isTagColorConfig(value.tagColorConfig))
	);
}

function isNodeData(
	value: unknown,
	options: { allowLegacyTags?: boolean } = {}
): value is NodeData {
	return (
		isRecord(value) &&
		typeof value.id === 'string' &&
		typeof value.title === 'string' &&
		typeof value.description === 'string' &&
		(options.allowLegacyTags
			? value.tags === undefined || isStringArray(value.tags)
			: isStringArray(value.tags)) &&
		(value.pinned === undefined || typeof value.pinned === 'boolean')
	);
}

function isEdgeData(
	value: unknown,
	options: { allowLegacyTags?: boolean; allowLegacyEdgeColor?: boolean } = {}
): value is EdgeData {
	return (
		isRecord(value) &&
		typeof value.id === 'string' &&
		typeof value.sourceNodeId === 'string' &&
		typeof value.targetNodeId === 'string' &&
		(options.allowLegacyEdgeColor
			? value.color === undefined || typeof value.color === 'string'
			: true) &&
		(options.allowLegacyTags
			? value.tags === undefined || isStringArray(value.tags)
			: isStringArray(value.tags)) &&
		(value.directed === undefined || typeof value.directed === 'boolean')
	);
}

function migrateLegacyEdge(edge: EdgeData): EdgeData {
	return {
		id: edge.id,
		sourceNodeId: edge.sourceNodeId,
		targetNodeId: edge.targetNodeId,
		tags: edge.tags ?? [],
		directed: edge.directed ?? false
	};
}

function isPoint(value: unknown): value is Point {
	return isRecord(value) && typeof value.x === 'number' && typeof value.y === 'number';
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isTagColorConfig(value: unknown): value is TagColorConfig {
	return isRecord(value) && isStringRecord(value.nodeTags) && isStringRecord(value.edgeTags);
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
