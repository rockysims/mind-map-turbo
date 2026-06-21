import { describe, expect, it } from 'vitest';
import {
	makeGraph,
	SAME_DIRECTION_PARALLEL_EDGES_GRAPH
} from './components/ui/Multigraph/lib/testFixtures';
import {
	GRAPH_HTML_PAYLOAD_SCRIPT_ID,
	createGraphFileArtifact,
	parseGraphFile,
	parseGraphFileText,
	serializeGraphFile,
	serializeGraphHtmlFile,
	type GraphFileDocument
} from './graphFile';
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

describe('HTML graph files', () => {
	it('round-trips graph data, viewState, and document metadata through HTML', () => {
		const doc = makeDoc({ documentId: 'doc-123', exportedAt: 42 });
		const html = serializeGraphHtmlFile(doc);
		const parsed = parseGraphFileText(html);

		expect(html).toContain(`id="${GRAPH_HTML_PAYLOAD_SCRIPT_ID}"`);
		expect(parsed).toEqual(doc);
	});

	it('replaces an existing embedded graph payload in an app shell', () => {
		const first = serializeGraphHtmlFile(makeDoc({ documentId: 'first' }));
		const second = serializeGraphHtmlFile(makeDoc({ documentId: 'second' }), first);

		expect(second.match(new RegExp(GRAPH_HTML_PAYLOAD_SCRIPT_ID, 'g'))).toHaveLength(1);
		expect(parseGraphFileText(second).documentId).toBe('second');
	});

	it('inserts a payload when the shell only mentions the payload id inside app code', () => {
		const shell = `<!doctype html><html><body><script type="module">const id = "${GRAPH_HTML_PAYLOAD_SCRIPT_ID}"; const type = "application/json";</script></body></html>`;
		const html = serializeGraphHtmlFile(makeDoc({ documentId: 'doc-from-shell' }), shell);

		expect(html.match(new RegExp(GRAPH_HTML_PAYLOAD_SCRIPT_ID, 'g'))).toHaveLength(2);
		expect(parseGraphFileText(html).documentId).toBe('doc-from-shell');
	});

	it('inserts a payload before the document body close when app code mentions body tags', () => {
		const shell =
			'<!doctype html><html><body><script>const replacement = `${payload}\\n</body>`;</script></body></html>';
		const html = serializeGraphHtmlFile(makeDoc({ documentId: 'doc-body-boundary' }), shell);
		const payloadIndex = html.indexOf(`id="${GRAPH_HTML_PAYLOAD_SCRIPT_ID}"`);
		const appCodeBodyIndex = html.indexOf('`${payload}\\n</body>`');
		const realBodyIndex = html.lastIndexOf('</body>');

		expect(appCodeBodyIndex).toBeGreaterThan(-1);
		expect(payloadIndex).toBeGreaterThan(appCodeBodyIndex);
		expect(payloadIndex).toBeLessThan(realBodyIndex);
		expect(parseGraphFileText(html).documentId).toBe('doc-body-boundary');
	});

	it('parses legacy JSON through the format-aware entry point', () => {
		const doc = makeDoc();

		expect(parseGraphFileText(serializeGraphFile(doc))).toEqual(doc);
	});

	it('escapes script-breaking node text inside HTML payloads', () => {
		const graph = makeGraph({ nodeCount: 1 });
		const dangerousTitle = '</script><img src=x onerror=alert(1)>';
		const doc = makeDoc({
			data: {
				...graph,
				nodes: [{ ...graph.nodes[0], title: dangerousTitle }]
			}
		});

		const html = serializeGraphHtmlFile(doc);
		expect(html).not.toContain(dangerousTitle);
		expect(html).toContain('\\u003c/script>');
		expect(parseGraphFileText(html).data.nodes[0]?.title).toBe(dangerousTitle);
	});

	it('throws malformed-payload when HTML is missing embedded graph data', () => {
		expect(() => parseGraphFileText('<!doctype html><html><body></body></html>')).toThrow(
			new PersistedGraphError(
				'Graph HTML file is missing embedded graph data.',
				'malformed-payload'
			)
		);
	});

	it('throws unsupported-app-version for newer HTML document readers', () => {
		const html = serializeGraphHtmlFile(makeDoc()).replace(
			'"minReaderVersion": 1',
			'"minReaderVersion": 999'
		);

		expect(() => parseGraphFileText(html)).toThrow(
			new PersistedGraphError(
				'Unsupported graph HTML reader version: 999',
				'unsupported-app-version'
			)
		);
	});

	it('creates HTML file artifacts by default', () => {
		const artifact = createGraphFileArtifact('team graph', makeDoc());

		expect(artifact.filename).toBe('team-graph.html');
		expect(artifact.mimeType).toBe('text/html');
		expect(parseGraphFileText(artifact.content).data).toEqual(makeDoc().data);
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
