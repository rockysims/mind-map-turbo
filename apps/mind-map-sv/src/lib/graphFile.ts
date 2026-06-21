import type { MultigraphData } from './components/ui/types/multigraph';
import {
	CURRENT_SCHEMA_VERSION,
	NEUTRAL_VIEW_STATE,
	PersistedGraphError,
	unwrapPersistedGraph,
	type ViewState
} from './migrations';

export const GRAPH_HTML_DOCUMENT_VERSION = 1;
export const GRAPH_HTML_READER_VERSION = 1;
export const GRAPH_HTML_PAYLOAD_SCRIPT_ID = 'mind-map-embedded-graph';

/** The in-memory representation of a graph backup file. */
export type GraphFileDocument = {
	data: MultigraphData;
	viewState: ViewState;
	documentId?: string;
	exportedAt?: number;
};

export type GraphFileArtifact = {
	content: string;
	filename: string;
	mimeType: string;
};

type GraphFilePayload = {
	schemaVersion: typeof CURRENT_SCHEMA_VERSION;
	data: MultigraphData;
	viewState: ViewState;
	documentId?: string;
	exportedAt?: number;
	htmlDocumentVersion?: number;
	minReaderVersion?: number;
};

/**
 * Default zoom bounds match APP_CONFIG multigraph.zoom.{minScale,maxScale}.
 * Passed as parameters so pure specs can pin them without importing APP_CONFIG.
 */
const DEFAULT_MIN_SCALE = 0.05;
const DEFAULT_MAX_SCALE = 4;

/**
 * Serialize a graph document into pretty-printed JSON suitable for file download.
 *
 * The output uses the schema envelope (schemaVersion + data + viewState) and
 * deliberately omits `updatedAt` so backup files stay free of autosave metadata.
 */
export function serializeGraphFile(doc: GraphFileDocument): string {
	return JSON.stringify(graphFilePayload(doc), null, 2);
}

export function createGraphFileArtifact(
	graphId: string,
	doc: GraphFileDocument,
	options: {
		format?: 'html' | 'json';
		htmlShell?: string;
		filename?: string;
	} = {}
): GraphFileArtifact {
	const format = options.format ?? 'html';
	const safeGraphId = safeFilenamePart(graphId);
	if (format === 'json') {
		return {
			content: serializeGraphFile(doc),
			filename: options.filename ?? `${safeGraphId}.json`,
			mimeType: 'application/json'
		};
	}

	return {
		content: serializeGraphHtmlFile(doc, options.htmlShell),
		filename: options.filename ?? `${safeGraphId}.html`,
		mimeType: 'text/html'
	};
}

export function serializeGraphHtmlFile(
	doc: GraphFileDocument,
	htmlShell = defaultHtmlShell()
): string {
	const payloadScript = graphPayloadScript(doc);

	if (htmlShell.includes(`id="${GRAPH_HTML_PAYLOAD_SCRIPT_ID}"`)) {
		return htmlShell.replace(graphPayloadScriptPattern(), payloadScript);
	}

	if (htmlShell.includes(`id='${GRAPH_HTML_PAYLOAD_SCRIPT_ID}'`)) {
		return htmlShell.replace(graphPayloadScriptPattern(), payloadScript);
	}

	if (/<\/body>/i.test(htmlShell)) {
		return htmlShell.replace(/<\/body>/i, `${payloadScript}\n</body>`);
	}

	if (/<\/html>/i.test(htmlShell)) {
		return htmlShell.replace(/<\/html>/i, `${payloadScript}\n</html>`);
	}

	return `${htmlShell}\n${payloadScript}`;
}

/**
 * Parse a JSON string produced by `serializeGraphFile` (or an older autosave
 * payload without `viewState`) back into a `GraphFileDocument`.
 *
 * - Delegates graph-data validation to `unwrapPersistedGraph`, preserving its
 *   stable `PersistedGraphError` codes (`malformed-payload`, `unsupported-version`).
 * - Missing or partially-invalid `viewState` fields are normalized to neutral
 *   values rather than rejected: older payloads default to `panX/panY = 0,
 *   scale = 1`; non-finite pan values fall back to 0; out-of-range scale is
 *   clamped to `[minScale, maxScale]`.
 * - Throws `PersistedGraphError` before returning so no caller-visible graph
 *   replacement can happen on failure.
 */
export function parseGraphFile(
	json: string,
	opts: { minScale?: number; maxScale?: number } = {}
): GraphFileDocument {
	return parseGraphFilePayload(json, opts);
}

export function parseGraphFileText(
	text: string,
	opts: { minScale?: number; maxScale?: number } = {}
): GraphFileDocument {
	if (looksLikeHtml(text)) {
		return parseGraphFilePayload(extractHtmlGraphPayload(text), opts);
	}

	return parseGraphFilePayload(text, opts);
}

export function isUnsupportedHtmlGraphFile(error: unknown): boolean {
	return error instanceof PersistedGraphError && error.code === 'unsupported-app-version';
}

function parseGraphFilePayload(
	json: string,
	opts: { minScale?: number; maxScale?: number } = {}
): GraphFileDocument {
	const minScale = opts.minScale ?? DEFAULT_MIN_SCALE;
	const maxScale = opts.maxScale ?? DEFAULT_MAX_SCALE;

	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch {
		throw new PersistedGraphError('Graph file JSON is malformed.', 'malformed-payload');
	}

	assertSupportedHtmlDocument(raw);

	// Delegate envelope + graph-data validation; preserves stable error codes.
	const data = unwrapPersistedGraph(raw);

	const viewState = normalizeViewState(raw, minScale, maxScale);

	return {
		data,
		viewState,
		documentId: readOptionalString(raw, 'documentId'),
		exportedAt: readOptionalNumber(raw, 'exportedAt')
	};
}

function graphFilePayload(doc: GraphFileDocument): GraphFilePayload {
	return {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		data: doc.data,
		viewState: doc.viewState,
		documentId: doc.documentId,
		exportedAt: doc.exportedAt
	};
}

function graphPayloadScript(doc: GraphFileDocument): string {
	const payload: GraphFilePayload = {
		...graphFilePayload(doc),
		htmlDocumentVersion: GRAPH_HTML_DOCUMENT_VERSION,
		minReaderVersion: GRAPH_HTML_READER_VERSION
	};
	const json = JSON.stringify(payload, null, 2).replaceAll('<', '\\u003c');
	return `<script id="${GRAPH_HTML_PAYLOAD_SCRIPT_ID}" type="application/json">${json}</script>`;
}

function graphPayloadScriptPattern(): RegExp {
	return new RegExp(
		`<script\\b(?=[^>]*\\bid=(["'])${GRAPH_HTML_PAYLOAD_SCRIPT_ID}\\1)(?=[^>]*\\btype=(["'])application/json\\2)[^>]*>[\\s\\S]*?<\\/script>`,
		'i'
	);
}

function extractHtmlGraphPayload(html: string): string {
	const match = html.match(graphPayloadScriptPattern());
	if (!match) {
		throw new PersistedGraphError(
			'Graph HTML file is missing embedded graph data.',
			'malformed-payload'
		);
	}

	const contentMatch = match[0].match(/<script\b[^>]*>([\s\S]*?)<\/script>/i);
	const content = contentMatch?.[1];
	if (content === undefined) {
		throw new PersistedGraphError(
			'Graph HTML file embedded graph data is malformed.',
			'malformed-payload'
		);
	}

	return content;
}

function looksLikeHtml(text: string): boolean {
	const trimmed = text.trimStart().slice(0, 128).toLowerCase();
	return (
		trimmed.startsWith('<!doctype html') ||
		trimmed.startsWith('<html') ||
		text.includes(GRAPH_HTML_PAYLOAD_SCRIPT_ID)
	);
}

function assertSupportedHtmlDocument(raw: unknown): void {
	if (!isRecord(raw)) return;
	const minReaderVersion = raw.minReaderVersion;
	if (
		typeof minReaderVersion === 'number' &&
		Number.isFinite(minReaderVersion) &&
		minReaderVersion > GRAPH_HTML_READER_VERSION
	) {
		throw new PersistedGraphError(
			`Unsupported graph HTML reader version: ${minReaderVersion}`,
			'unsupported-app-version'
		);
	}
}

function defaultHtmlShell(): string {
	return '<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Mind Map</title></head><body></body></html>';
}

function safeFilenamePart(value: string): string {
	return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'graph';
}

function normalizeViewState(raw: unknown, minScale: number, maxScale: number): ViewState {
	if (!isRecord(raw) || !isRecord(raw.viewState)) {
		return { ...NEUTRAL_VIEW_STATE };
	}

	const vs = raw.viewState;

	const panX = isFiniteNumber(vs.panX) ? vs.panX : NEUTRAL_VIEW_STATE.panX;
	const panY = isFiniteNumber(vs.panY) ? vs.panY : NEUTRAL_VIEW_STATE.panY;

	const rawScale = typeof vs.scale === 'number' ? vs.scale : NEUTRAL_VIEW_STATE.scale;
	const scale = isFiniteNumber(rawScale)
		? Math.min(Math.max(rawScale, minScale), maxScale)
		: NEUTRAL_VIEW_STATE.scale;

	return { panX, panY, scale };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function readOptionalString(raw: unknown, key: string): string | undefined {
	if (!isRecord(raw)) return undefined;
	const value = raw[key];
	return typeof value === 'string' ? value : undefined;
}

function readOptionalNumber(raw: unknown, key: string): number | undefined {
	if (!isRecord(raw)) return undefined;
	const value = raw[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
