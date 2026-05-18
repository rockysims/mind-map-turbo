import { describe, expect, it } from 'vitest';
import {
	CURRENT_SCHEMA_VERSION,
	PersistedGraphError,
	parsePersistedGraph,
	unwrapPersistedGraph,
	wrapPersistedGraph
} from './migrations';
import { makeGraph } from './components/ui/Multigraph/lib/testFixtures';

describe('persisted graph migrations', () => {
	it('wraps current graph data in the schema envelope', () => {
		const graph = makeGraph({ nodeCount: 2, edges: [[0, 1]] });

		expect(wrapPersistedGraph(graph)).toEqual({
			schemaVersion: CURRENT_SCHEMA_VERSION,
			data: graph
		});
	});

	it('reads version 1 payloads', () => {
		const graph = makeGraph({ nodeCount: 1 });

		expect(unwrapPersistedGraph({ schemaVersion: 1, data: graph })).toEqual(graph);
	});

	it('parses serialized version 1 payloads', () => {
		const graph = makeGraph({ nodeCount: 1 });

		expect(parsePersistedGraph(JSON.stringify(wrapPersistedGraph(graph)))).toEqual(graph);
	});

	it('rejects malformed graph payloads with a typed error', () => {
		expect(() => unwrapPersistedGraph({ schemaVersion: 1, data: { nodes: [] } })).toThrow(
			new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload')
		);
	});

	it('rejects unsupported schema versions with a typed error', () => {
		expect(() => unwrapPersistedGraph({ schemaVersion: 2, data: makeGraph() })).toThrow(
			new PersistedGraphError('Unsupported graph schema version: 2', 'unsupported-version')
		);
	});

	it('rejects malformed JSON with a typed error', () => {
		expect(() => parsePersistedGraph('{ nope')).toThrow(
			new PersistedGraphError('Persisted graph JSON is malformed.', 'malformed-payload')
		);
	});
});
