import { describe, expect, it } from 'vitest';
import {
	makeGraph,
	SAME_DIRECTION_PARALLEL_EDGES_GRAPH
} from './components/ui/Multigraph/lib/testFixtures';
import {
	GRAPH_HTML_PAYLOAD_SCRIPT_ID,
	GRAPH_HTML_READER_VERSION,
	createGraphFileArtifact,
	isUnsupportedHtmlGraphFile,
	parseGraphFile,
	parseGraphFileText,
	serializeGraphFile,
	serializeGraphHtmlFile,
	type GraphFileDocument,
	type GraphFileEmbeddedAsset
} from './graphFile';
import { CURRENT_SCHEMA_VERSION, NEUTRAL_VIEW_STATE, PersistedGraphError } from './migrations';

const NEUTRAL = NEUTRAL_VIEW_STATE;

function makeDoc(overrides: Partial<GraphFileDocument> = {}): GraphFileDocument {
	return {
		// Pinned so round-trip assertions compare like with like: loading a graph
		// with zero pins seeds a pin per component (see withSeededComponentPins).
		data: makeGraph({ nodeCount: 2, edges: [[0, 1]], pinned: [0] }),
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

	it('records the app version that wrote the document', () => {
		const json = serializeGraphFile(makeDoc({ appVersion: '2026-08-30 21:41 · efa2bbc' }));
		expect(JSON.parse(json)).toMatchObject({ appVersion: '2026-08-30 21:41 · efa2bbc' });
	});

	it('round-trips the app version through JSON and HTML', () => {
		const doc = makeDoc({ appVersion: '2026-08-30 21:41 · efa2bbc', documentId: 'doc-1' });

		expect(parseGraphFile(serializeGraphFile(doc)).appVersion).toBe('2026-08-30 21:41 · efa2bbc');
		expect(parseGraphFileText(serializeGraphHtmlFile(doc)).appVersion).toBe(
			'2026-08-30 21:41 · efa2bbc'
		);
	});

	it('reads back no app version from a document written before the stamp existed', () => {
		expect(parseGraphFile(serializeGraphFile(makeDoc())).appVersion).toBeUndefined();
	});

	it('ignores unknown top-level keys, which is why appVersion needs no schema bump', () => {
		const payload = {
			...JSON.parse(serializeGraphFile(makeDoc())),
			somethingAddedLater: { by: 'a newer app' }
		};

		expect(parseGraphFile(JSON.stringify(payload)).data.nodes).toHaveLength(2);
	});

	it('round-trips quantity designations through JSON and HTML', () => {
		const base = makeGraph({ nodeCount: 2, edges: [[0, 1]], pinned: [0] });
		const doc = makeDoc({
			data: {
				...base,
				nodes: base.nodes.map((node, index) =>
					index === 0
						? { ...node, outputs: [{ base: 'v', subscript: '0' }] }
						: { ...node, inputs: [{ base: 'v', subscript: '0' }] }
				)
			}
		});

		expect(parseGraphFile(serializeGraphFile(doc)).data).toEqual(doc.data);
		expect(parseGraphFileText(serializeGraphHtmlFile(doc)).data).toEqual(doc.data);
	});

	it('round-trips node add-ons through JSON and HTML', () => {
		const base = makeGraph({ nodeCount: 2, edges: [[0, 1]], pinned: [0] });
		const doc = makeDoc({
			data: {
				...base,
				nodes: base.nodes.map((node, index) =>
					index === 0
						? { ...node, addons: { task: { done: true, doneAt: 1_700_000_000_000 } } }
						: node
				)
			}
		});

		expect(parseGraphFile(serializeGraphFile(doc)).data).toEqual(doc.data);
		expect(parseGraphFileText(serializeGraphHtmlFile(doc)).data).toEqual(doc.data);
	});

	it('round-trips an ai add-on with a run and a promoted binding through JSON and HTML', () => {
		const base = makeGraph({ nodeCount: 2, edges: [[0, 1]], pinned: [0] });
		const doc = makeDoc({
			data: {
				...base,
				nodes: base.nodes.map((node, index) =>
					index === 0
						? {
								...node,
								addons: {
									ai: {
										prompt: 'plot channel 2 against time',
										model: 'claude-opus-5',
										script: 'import pandas as pd\n',
										runs: [
											{
												id: 'run-1',
												startedAt: 1_700_000_000_000,
												finishedAt: 1_700_000_030_000,
												status: 'done' as const,
												mode: 'analyse' as const,
												model: 'claude-opus-5',
												runtime: '0.27.7',
												inputs: [{ nodeId: 'n1', assetId: 'f1', label: 'baseline' }],
												summary: 'Plotted channel 2.',
												outputs: [{ name: 'plot.png', assetId: 'p1', mimeType: 'image/png' }],
												usage: { inputTokens: 1200, outputTokens: 340 },
												toolCalls: 2
											}
										],
										promoted: { 'plot.png': 'n1' }
									}
								}
							}
						: node
				)
			}
		});

		expect(parseGraphFile(serializeGraphFile(doc)).data).toEqual(doc.data);
		expect(parseGraphFileText(serializeGraphHtmlFile(doc)).data).toEqual(doc.data);
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
		const bootScriptIndex = html.indexOf('<script>const replacement');
		const appCodeBodyIndex = html.indexOf('`${payload}\\n</body>`');
		const realBodyIndex = html.lastIndexOf('</body>');

		expect(appCodeBodyIndex).toBeGreaterThan(-1);
		expect(payloadIndex).toBeLessThan(bootScriptIndex);
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
			`"minReaderVersion": ${GRAPH_HTML_READER_VERSION}`,
			'"minReaderVersion": 999'
		);

		expect(() => parseGraphFileText(html)).toThrow(
			new PersistedGraphError(
				'Unsupported graph HTML reader version: 999',
				'unsupported-app-version'
			)
		);
	});

	// Schema 7 stamps reader version 3, so the next schema bump stamps 4. This is
	// the case a reader one version behind sees: it must route the file to the
	// file's own embedded shell rather than fail on the schema envelope, which is
	// what `isUnsupportedHtmlGraphFile` is asked at the call site.
	it('routes a file one reader version ahead to the unsupported-app-version path', () => {
		const html = serializeGraphHtmlFile(makeDoc()).replace(
			`"minReaderVersion": ${GRAPH_HTML_READER_VERSION}`,
			`"minReaderVersion": ${GRAPH_HTML_READER_VERSION + 1}`
		);

		let thrown: unknown;
		try {
			parseGraphFileText(html);
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toEqual(
			new PersistedGraphError(
				`Unsupported graph HTML reader version: ${GRAPH_HTML_READER_VERSION + 1}`,
				'unsupported-app-version'
			)
		);
		expect(isUnsupportedHtmlGraphFile(thrown)).toBe(true);
	});

	it('stamps the current reader version on what it writes', () => {
		expect(GRAPH_HTML_READER_VERSION).toBe(4);
		expect(serializeGraphHtmlFile(makeDoc())).toContain('"minReaderVersion": 4');
	});

	// Schema 8's reader version is 4, so a document asking for 5 was written by
	// an app ahead of this one and must take the embedded-shell route.
	it('refuses a document asking for reader version 5 as unsupported-app-version', () => {
		const html = serializeGraphHtmlFile(makeDoc()).replace(
			'"minReaderVersion": 4',
			'"minReaderVersion": 5'
		);

		expect(() => parseGraphFileText(html)).toThrow(
			new PersistedGraphError('Unsupported graph HTML reader version: 5', 'unsupported-app-version')
		);
	});

	it('creates HTML file artifacts by default', () => {
		const artifact = createGraphFileArtifact('team graph', makeDoc());

		expect(artifact.filename).toBe('team-graph.html');
		expect(artifact.mimeType).toBe('text/html');
		expect(parseGraphFileText(artifact.content).data).toEqual(makeDoc().data);
	});
});

describe('embedded assets in HTML graph files', () => {
	const IMAGE: GraphFileEmbeddedAsset = {
		assetId: 'a1',
		mimeType: 'image/png',
		name: 'photo.png',
		size: 12,
		base64: 'aW1hZ2UgYnl0ZXM='
	};

	const CSV: GraphFileEmbeddedAsset = {
		assetId: 'f1',
		mimeType: 'text/csv',
		name: 'readings.csv',
		size: 24,
		base64: 'dGltZSx2YWx1ZQoxLDIK'
	};

	/** A document whose one node carries the given blocks, so the assets are referenced. */
	function docWithAssets(embeddedAssets: GraphFileEmbeddedAsset[]): GraphFileDocument {
		const graph = makeGraph({ nodeCount: 1, pinned: [0] });
		return {
			data: {
				...graph,
				nodes: [
					{
						...graph.nodes[0],
						content: embeddedAssets.map((asset) =>
							asset.mimeType.startsWith('image/') && asset.assetId.startsWith('a')
								? { type: 'image' as const, assetId: asset.assetId, alt: 'A photo' }
								: { type: 'file' as const, assetId: asset.assetId, name: asset.name ?? '' }
						)
					}
				],
				assets: Object.fromEntries(
					embeddedAssets.map((asset) => [
						asset.assetId,
						{
							id: asset.assetId,
							kind: asset.assetId.startsWith('a') ? ('image' as const) : ('file' as const),
							mimeType: asset.mimeType,
							name: asset.name,
							size: asset.size,
							createdAt: 1
						}
					])
				)
			},
			viewState: NEUTRAL,
			embeddedAssets
		};
	}

	it('round-trips an image asset, as it always has', () => {
		const doc = docWithAssets([IMAGE]);

		expect(parseGraphFileText(serializeGraphHtmlFile(doc)).embeddedAssets).toEqual([IMAGE]);
	});

	// Before schema 7 the container rejected any non-image asset as a malformed
	// file; a CSV attachment has to survive the same round trip an image does.
	it('round-trips a text/csv asset with its mime type, size and name intact', () => {
		const doc = docWithAssets([CSV]);
		const html = serializeGraphHtmlFile(doc);
		const parsed = parseGraphFileText(html);

		expect(parsed.embeddedAssets).toEqual([CSV]);
		expect(parsed.data).toEqual(doc.data);
	});

	it('parses a version 7 document carrying an image and a file together', () => {
		const parsed = parseGraphFileText(serializeGraphHtmlFile(docWithAssets([IMAGE, CSV])));

		expect(parsed.embeddedAssets).toEqual([IMAGE, CSV]);
	});

	it('still rejects an embedded asset with no mime type', () => {
		const html = serializeGraphHtmlFile(docWithAssets([CSV])).replace(
			'data-mime-type="text/csv"',
			'data-mime-type=""'
		);

		expect(() => parseGraphFileText(html)).toThrow(
			new PersistedGraphError('Graph HTML file embedded asset is malformed.', 'malformed-payload')
		);
	});

	it('still rejects an embedded asset whose payload is not base64', () => {
		const html = serializeGraphHtmlFile(docWithAssets([CSV])).replace(CSV.base64, 'not base64!');

		expect(() => parseGraphFileText(html)).toThrow(
			new PersistedGraphError('Graph HTML file embedded asset is malformed.', 'malformed-payload')
		);
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
