import type { EdgeData } from './components/ui/types/edge';
import type { MultigraphData, Point } from './components/ui/types/multigraph';
import type { NodeData } from './components/ui/types/node';

export const CURRENT_SCHEMA_VERSION = 1;

export type PersistedGraphPayload = {
	schemaVersion: typeof CURRENT_SCHEMA_VERSION;
	data: MultigraphData;
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

function isMultigraphData(value: unknown): value is MultigraphData {
	if (!isRecord(value)) return false;
	if (!Array.isArray(value.nodes) || !Array.isArray(value.edges) || !isRecord(value.posByNodeId)) {
		return false;
	}

	return (
		value.nodes.every(isNodeData) &&
		value.edges.every(isEdgeData) &&
		Object.values(value.posByNodeId).every(isPoint)
	);
}

function isNodeData(value: unknown): value is NodeData {
	return (
		isRecord(value) &&
		typeof value.id === 'string' &&
		typeof value.title === 'string' &&
		typeof value.description === 'string' &&
		(value.pinned === undefined || typeof value.pinned === 'boolean')
	);
}

function isEdgeData(value: unknown): value is EdgeData {
	return (
		isRecord(value) &&
		typeof value.id === 'string' &&
		typeof value.sourceNodeId === 'string' &&
		typeof value.targetNodeId === 'string' &&
		typeof value.color === 'string'
	);
}

function isPoint(value: unknown): value is Point {
	return isRecord(value) && typeof value.x === 'number' && typeof value.y === 'number';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
