/**
 * One revertible snapshot per graph id, held in `localStorage` beside the saved
 * graph itself (see persistence.ts). A snapshot is an escape hatch for a single
 * destructive-ish operation — import writes one before folding a file in, and
 * the revert banner reads it back — not a history stack: a second write for the
 * same graph id replaces the first.
 *
 * Two rules keep it from ever hurting the operation it guards:
 * - Writing is quota-aware. A snapshot that will not fit is dropped and the
 *   write reports failure instead of throwing, so the caller can carry on
 *   (without offering a revert) rather than losing the operation.
 * - Reading never throws. Anything unreadable — absent, malformed JSON, an
 *   envelope from another version, storage that refuses access — reads as "no
 *   snapshot".
 */

import { APP_CONFIG } from './appConfig';
import type { MultigraphData } from './components/ui/types/multigraph';
import { CURRENT_SCHEMA_VERSION, type ViewState } from './migrations';
import type { StorageLike } from './persistence';

/**
 * Envelope format version, independent of the graph schema version. Bump it
 * when the envelope's own shape changes; snapshots written by another version
 * read as absent, which is the safe answer for a short-lived escape hatch.
 */
export const SNAPSHOT_ENVELOPE_VERSION = 1;

export type GraphSnapshotInput = {
	/** The pre-operation graph, serialized as-is. */
	data: MultigraphData;
	/** Pan/zoom to restore alongside the graph, when the caller has one. */
	viewState?: ViewState;
	/** Short operation label, e.g. 'import', shown in the revert offer. */
	label: string;
};

export type GraphSnapshot = GraphSnapshotInput & {
	/** Epoch ms the snapshot was written, so a reader can state its age. */
	createdAt: number;
};

export type GraphSnapshotOptions = {
	/**
	 * Storage to use. Defaults to the ambient `localStorage`, resolved lazily so
	 * the module is safe to import during SSR; `null` disables snapshotting.
	 */
	storage?: StorageLike | null;
	namespace?: string;
	now?: () => number;
};

type StoredSnapshot = {
	snapshotVersion: typeof SNAPSHOT_ENVELOPE_VERSION;
	schemaVersion: typeof CURRENT_SCHEMA_VERSION;
	createdAt: number;
	label: string;
	data: MultigraphData;
	viewState?: ViewState;
};

export function snapshotStorageKey(namespace: string, graphId: string): string {
	return `${namespace}:snapshot:${encodeURIComponent(graphId)}`;
}

/**
 * Store the snapshot for `graphId`, replacing any earlier one. Returns whether
 * it was stored: `false` means no snapshot exists for this graph afterwards
 * (quota, unavailable storage), never that the caller's operation failed.
 */
export function writeGraphSnapshot(
	graphId: string,
	snapshot: GraphSnapshotInput,
	options: GraphSnapshotOptions = {}
): boolean {
	const storage = resolveStorage(options);
	if (storage === null) return false;

	const key = snapshotStorageKey(resolveNamespace(options), graphId);
	const stored: StoredSnapshot = {
		snapshotVersion: SNAPSHOT_ENVELOPE_VERSION,
		schemaVersion: CURRENT_SCHEMA_VERSION,
		createdAt: (options.now ?? Date.now)(),
		label: snapshot.label,
		data: snapshot.data,
		...(snapshot.viewState === undefined ? {} : { viewState: snapshot.viewState })
	};

	try {
		// Drop the previous snapshot first: it is being replaced either way, and
		// freeing its bytes gives the new one its best chance of fitting. If the
		// write then fails, the graph is left with no snapshot rather than with a
		// stale one that would offer a revert to the wrong moment.
		storage.removeItem(key);
		storage.setItem(key, JSON.stringify(stored));
		return true;
	} catch {
		discard(storage, key);
		return false;
	}
}

/** Read the snapshot for `graphId`, or `null` when there is nothing usable. */
export function readGraphSnapshot(
	graphId: string,
	options: GraphSnapshotOptions = {}
): GraphSnapshot | null {
	const storage = resolveStorage(options);
	if (storage === null) return null;

	let item: string | null;
	try {
		item = storage.getItem(snapshotStorageKey(resolveNamespace(options), graphId));
	} catch {
		return null;
	}
	if (item === null) return null;

	let payload: unknown;
	try {
		payload = JSON.parse(item);
	} catch {
		return null;
	}

	return readStoredSnapshot(payload);
}

/** Forget the snapshot for `graphId`. Silent when there is none. */
export function clearGraphSnapshot(graphId: string, options: GraphSnapshotOptions = {}): void {
	const storage = resolveStorage(options);
	if (storage === null) return;

	discard(storage, snapshotStorageKey(resolveNamespace(options), graphId));
}

function discard(storage: StorageLike, key: string): void {
	try {
		storage.removeItem(key);
	} catch {
		// Nothing left to do: the snapshot is best-effort by design.
	}
}

function resolveStorage(options: GraphSnapshotOptions): StorageLike | null {
	if (options.storage !== undefined) return options.storage;

	try {
		return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
	} catch {
		// Storage access can throw outright when the browser blocks site data.
		return null;
	}
}

function resolveNamespace(options: GraphSnapshotOptions): string {
	return options.namespace ?? APP_CONFIG.persistence.storageNamespace;
}

function readStoredSnapshot(payload: unknown): GraphSnapshot | null {
	if (!isRecord(payload)) return null;
	if (payload.snapshotVersion !== SNAPSHOT_ENVELOPE_VERSION) return null;
	// A snapshot outlives only a reload, not a schema change: migrating one is
	// not worth the risk of restoring a half-understood graph.
	if (payload.schemaVersion !== CURRENT_SCHEMA_VERSION) return null;
	if (typeof payload.label !== 'string') return null;
	if (typeof payload.createdAt !== 'number' || !Number.isFinite(payload.createdAt)) return null;
	if (!isMultigraphData(payload.data)) return null;

	const viewState = readViewState(payload.viewState);

	return {
		data: payload.data,
		label: payload.label,
		createdAt: payload.createdAt,
		...(viewState === null ? {} : { viewState })
	};
}

function isMultigraphData(value: unknown): value is MultigraphData {
	return (
		isRecord(value) &&
		Array.isArray(value.nodes) &&
		Array.isArray(value.edges) &&
		isRecord(value.posByNodeId) &&
		isRecord(value.tagColorConfig)
	);
}

function readViewState(value: unknown): ViewState | null {
	if (!isRecord(value)) return null;
	if (
		typeof value.panX !== 'number' ||
		typeof value.panY !== 'number' ||
		typeof value.scale !== 'number' ||
		!Number.isFinite(value.panX) ||
		!Number.isFinite(value.panY) ||
		!Number.isFinite(value.scale)
	) {
		return null;
	}

	return { panX: value.panX, panY: value.panY, scale: value.scale };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
