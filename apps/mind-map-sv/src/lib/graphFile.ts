import type { MultigraphData } from './components/ui/types/multigraph';
import {
	CURRENT_SCHEMA_VERSION,
	NEUTRAL_VIEW_STATE,
	PersistedGraphError,
	unwrapPersistedGraph,
	type ViewState
} from './migrations';

/** The in-memory representation of a graph backup file. */
export type GraphFileDocument = {
	data: MultigraphData;
	viewState: ViewState;
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
	return JSON.stringify(
		{
			schemaVersion: CURRENT_SCHEMA_VERSION,
			data: doc.data,
			viewState: doc.viewState
		},
		null,
		2
	);
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
	const minScale = opts.minScale ?? DEFAULT_MIN_SCALE;
	const maxScale = opts.maxScale ?? DEFAULT_MAX_SCALE;

	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch {
		throw new PersistedGraphError('Graph file JSON is malformed.', 'malformed-payload');
	}

	// Delegate envelope + graph-data validation; preserves stable error codes.
	const data = unwrapPersistedGraph(raw);

	const viewState = normalizeViewState(raw, minScale, maxScale);

	return { data, viewState };
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
