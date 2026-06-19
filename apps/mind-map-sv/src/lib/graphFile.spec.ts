import { describe, expect, it } from 'vitest';
import {
	makeGraph,
	SAME_DIRECTION_PARALLEL_EDGES_GRAPH
} from './components/ui/Multigraph/lib/testFixtures';
import { parseGraphFile, serializeGraphFile, type GraphFileDocument } from './graphFile';
import { CURRENT_SCHEMA_VERSION, NEUTRAL_VIEW_STATE, PersistedGraphError } from './migrations';

const NEUTRAL = NEUTRAL_VIEW_STATE;

function makeDoc(overrides: Partial<GraphFileDocument> = {}): GraphFileDocument {
	return {
		data: makeGraph({ nodeCount: 2, edges: [[0, 1]] }),
		viewState: { panX: 100, panY: -50, scale: 1.5 },
		...overrides
	};
}

// serialize

describe('serializeGraphFile', () => {
	it('round-trips graph data and viewState through JSON', () => {
		const doc = makeDoc();
		const parsed = parseGraphFile(serializeGraphFile(doc));
		expect(parsed.data).toEqual(doc.data);
		expect(parsed.viewState).toEqual(doc.viewState);
	});

	it('includes the current schema version in the output', () => {
		const json = serializeGraphFile(makeDoc());
		expect(JSON.parse(json)).toMatchObject({ schemaVersion: CURRENT_SCHEMA_VERSION });
	});

	it('does not include updatedAt in the exported file', () => {
		const json = serializeGraphFile(makeDoc());
		expect(json).not.toContain('updatedAt');
		expect(JSON.parse(json)).not.toHaveProperty('updatedAt');
	});

	it('produces pretty-printed JSON (indented)', () => {
		const json = serializeGraphFile(makeDoc());
		expect(json).toContain('\n');
	});
});

// parse: valid inputs

describe('parseGraphFile: valid payloads', () => {
	it('returns graph data and viewState for a current-version file', () => {
		const doc = makeDoc();
		const result = parseGraphFile(serializeGraphFile(doc));
		expect(result.data).toEqual(doc.data);
		expect(result.viewState).toEqual(doc.viewState);
	});

	it('preserves duplicate edge file data without deduping', () => {
		const doc = makeDoc({ data: SAME_DIRECTION_PARALLEL_EDGES_GRAPH });
		const result = parseGraphFile(serializeGraphFile(doc));

		expect(result.data.edges).toEqual(SAME_DIRECTION_PARALLEL_EDGES_GRAPH.edges);
		expect(result.data.edges.map((edge) => edge.id)).toEqual([
			'parallel-same-01',
			'parallel-same-02',
			'parallel-same-03'
		]);
	});

	it('defaults viewState to neutral pan/zoom when the envelope has no viewState', () => {
		const payload = JSON.stringify({
			schemaVersion: CURRENT_SCHEMA_VERSION,
			data: makeGraph({ nodeCount: 1 })
			// no viewState field
		});

		const result = parseGraphFile(payload);
		expect(result.viewState).toEqual(NEUTRAL);
	});

	it('clamps an above-range zoom scale to the maximum', () => {
		const payload = JSON.stringify({
			schemaVersion: CURRENT_SCHEMA_VERSION,
			data: makeGraph({ nodeCount: 1 }),
			viewState: { panX: 0, panY: 0, scale: 999 }
		});

		const result = parseGraphFile(payload, { maxScale: 4 });
		expect(result.viewState.scale).toBe(4);
	});

	it('clamps a below-range zoom scale to the minimum', () => {
		const payload = JSON.stringify({
			schemaVersion: CURRENT_SCHEMA_VERSION,
			data: makeGraph({ nodeCount: 1 }),
			viewState: { panX: 0, panY: 0, scale: 0.001 }
		});

		const result = parseGraphFile(payload, { minScale: 0.05 });
		expect(result.viewState.scale).toBe(0.05);
	});
});

// parse: invalid viewState (normalized, not rejected)

describe('parseGraphFile: invalid viewState fields', () => {
	function payloadWithViewState(vs: unknown): string {
		return JSON.stringify({
			schemaVersion: CURRENT_SCHEMA_VERSION,
			data: makeGraph({ nodeCount: 1 }),
			viewState: vs
		});
	}

	it('falls back to neutral panX when panX is Infinity', () => {
		const result = parseGraphFile(payloadWithViewState({ panX: Infinity, panY: 0, scale: 1 }));
		expect(result.viewState.panX).toBe(NEUTRAL.panX);
	});

	it('falls back to neutral panX when panX is -Infinity', () => {
		const result = parseGraphFile(payloadWithViewState({ panX: -Infinity, panY: 0, scale: 1 }));
		expect(result.viewState.panX).toBe(NEUTRAL.panX);
	});

	it('falls back to neutral panX when panX is NaN', () => {
		const result = parseGraphFile(payloadWithViewState({ panX: NaN, panY: 0, scale: 1 }));
		expect(result.viewState.panX).toBe(NEUTRAL.panX);
	});

	it('falls back to neutral panY when panY is non-finite', () => {
		const result = parseGraphFile(payloadWithViewState({ panX: 0, panY: Infinity, scale: 1 }));
		expect(result.viewState.panY).toBe(NEUTRAL.panY);
	});

	it('falls back to neutral scale when scale is NaN', () => {
		const result = parseGraphFile(payloadWithViewState({ panX: 0, panY: 0, scale: NaN }));
		expect(result.viewState.scale).toBe(NEUTRAL.scale);
	});

	it('falls back to neutral scale when scale is Infinity', () => {
		const result = parseGraphFile(payloadWithViewState({ panX: 0, panY: 0, scale: Infinity }));
		expect(result.viewState.scale).toBe(NEUTRAL.scale);
	});

	it('falls back to neutral when viewState is not an object', () => {
		const result = parseGraphFile(payloadWithViewState('not-an-object'));
		expect(result.viewState).toEqual(NEUTRAL);
	});

	it('falls back to neutral when viewState is null', () => {
		const result = parseGraphFile(payloadWithViewState(null));
		expect(result.viewState).toEqual(NEUTRAL);
	});

	it('uses finite panX/panY values even when scale needs clamping', () => {
		const result = parseGraphFile(payloadWithViewState({ panX: 200, panY: -100, scale: 99 }), {
			maxScale: 4
		});
		expect(result.viewState.panX).toBe(200);
		expect(result.viewState.panY).toBe(-100);
		expect(result.viewState.scale).toBe(4);
	});
});

// parse: error cases

describe('parseGraphFile: error cases', () => {
	it('throws PersistedGraphError with malformed-payload on invalid JSON', () => {
		expect(() => parseGraphFile('{ nope')).toThrow(
			new PersistedGraphError('Graph file JSON is malformed.', 'malformed-payload')
		);
	});

	it('throws PersistedGraphError with malformed-payload on non-object JSON', () => {
		expect(() => parseGraphFile('"a string"')).toThrow(
			new PersistedGraphError('Persisted graph payload must be an object.', 'malformed-payload')
		);
	});

	it('throws PersistedGraphError with malformed-payload when graph data is missing required fields', () => {
		const payload = JSON.stringify({
			schemaVersion: CURRENT_SCHEMA_VERSION,
			data: { nodes: [] } // missing edges and posByNodeId
		});

		expect(() => parseGraphFile(payload)).toThrow(
			new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload')
		);
	});

	it('throws PersistedGraphError with unsupported-version for an unknown schema version', () => {
		const payload = JSON.stringify({
			schemaVersion: 99,
			data: makeGraph({ nodeCount: 1 })
		});

		expect(() => parseGraphFile(payload)).toThrow(
			new PersistedGraphError('Unsupported graph schema version: 99', 'unsupported-version')
		);
	});

	it('throws PersistedGraphError with stable message text for unsupported version', () => {
		const payload = JSON.stringify({ schemaVersion: 99, data: makeGraph() });
		expect(() => parseGraphFile(payload)).toThrow(PersistedGraphError);
		try {
			parseGraphFile(payload);
		} catch (err) {
			expect(err).toBeInstanceOf(PersistedGraphError);
			if (err instanceof PersistedGraphError) {
				expect(err.code).toBe('unsupported-version');
				expect(err.message).toMatch(/unsupported/i);
			}
		}
	});

	it('throws before any graph data can be extracted on malformed JSON', () => {
		let result: unknown = undefined;
		try {
			result = parseGraphFile('not json at all');
		} catch {
			// expected
		}
		// result was never assigned, so no caller-visible replacement occurred
		expect(result).toBeUndefined();
	});
});
