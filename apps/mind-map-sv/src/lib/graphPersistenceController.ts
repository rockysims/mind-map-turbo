import type { GraphCommitIntent } from './components/ui/types/history';
import type { MultigraphData } from './components/ui/types/multigraph';
import { base64ToBlob, blobToBase64 } from './assets/assetEncoding';
import type { GraphAssetStore, StoredGraphAsset } from './assets/assetStore';
import { sweepAssetTrash } from './assets/assetTrash';
import { referencedAssetIds } from './components/ui/Multigraph/lib/graph';
import {
	restoreSemantics,
	semanticFingerprint,
	semanticallyUnchanged
} from './components/ui/Multigraph/lib/graphIdentity';
import { importGraphData } from './components/ui/Multigraph/lib/graphImport';
import { newerAppNotice } from './buildInfo';
import {
	documentStatusHasUnsavedChanges,
	documentStatusForGraph,
	documentStatusNotice,
	graphDataEquals,
	graphFingerprint,
	type DocumentBaseline,
	type DocumentStatus
} from './documentStatus';
import {
	createGraphFileArtifact,
	isUnsupportedHtmlGraphFile,
	parseGraphFileText,
	type GraphFileDocument,
	type GraphFileArtifact,
	type GraphFileEmbeddedAsset
} from './graphFile';
import { DEFAULT_GRAPH_ID } from './graphRoute';
import { applyDelta, deltaApplies, diffByReference } from './graphDelta';
import {
	NEUTRAL_VIEW_STATE,
	PersistedGraphError,
	type PersistedHistoryState,
	type PersistedHistoryTail,
	type ViewState
} from './migrations';
import {
	documentDraftGraphId,
	graphIdFromStorageKey,
	type GraphSummary,
	type Persistence
} from './persistence';
import type { ReadHistoryTail, SaveStatus } from './saveScheduler';
import type { StorageDurability } from './storageAvailability';
import {
	allEntries,
	canRedo,
	canUndo,
	undoEntries,
	clear as clearHistory,
	createUndoHistory,
	currentEntry,
	push,
	redo,
	redoTarget,
	replaceTop,
	undo,
	type HistoryChange,
	type HistoryEviction,
	type UndoHistory
} from './undoHistory';
import { APP_CONFIG } from './appConfig';

export const MEMORY_ONLY_STORAGE_NOTICE = 'Caching is blocked here. Save to a file to keep it.';

type ImportGraphResult =
	| 'imported'
	| 'cancelled'
	| 'invalid'
	| 'unsupported'
	| 'opened-in-new-tab'
	| 'open-tab-blocked';

/** Why an additive import did not parse. Shared with the replacing import path. */
type ImportGraphFailure = Exclude<ImportGraphResult, 'imported' | 'cancelled'>;

/**
 * Outcome of an additive import. Unlike the replacing path this reports how much
 * arrived, because the caller's notice names it ("Imported 14 nodes").
 */
type ImportIntoCurrentResult =
	| { outcome: 'imported'; importedNodeCount: number }
	| { outcome: ImportGraphFailure | 'read-failed' };

export type ControllerStatus =
	| { state: 'loading'; graphId: string }
	| { state: 'loaded'; graphId: string }
	| { state: 'reloaded'; graphId: string }
	| { state: 'saving' }
	| { state: 'saved'; savedAt: number }
	| { state: 'warning'; savedAt: number; message: string }
	/**
	 * `sticky` marks a notice the reader still has to act on — a failed import,
	 * or a cached draft another tab would have overwritten. It outranks the
	 * document status line until something replaces it; a plain notice does not.
	 */
	| { state: 'notice'; message: string; sticky?: boolean; severity?: 'info' | 'warning' }
	| { state: 'exported'; filename: string }
	| { state: 'error'; message: string };

/**
 * What the revert offer knows about the operation standing behind the loaded
 * graph. Deliberately not a graph: the banner only needs to say what happened
 * and how long ago, and holding a second copy in the view would double every
 * render's memory for a card the size of a sentence.
 *
 * `addedNodeCount` is exact, not inferred. The offer is now a view of the
 * history, and the entry holds the graph on both sides of the import — so the
 * banner states what arrived rather than subtracting a remembered count from the
 * graph on screen, which stopped being true the moment the reader added a node.
 */
export type SnapshotSummary = {
	label: string;
	createdAt: number;
	addedNodeCount: number;
};

/**
 * One recorded state of the document, plus the name of the edit that produced it.
 *
 * A state, not an operation: undo wants the *previous* state's values, and
 * capturing them per state is what supplies them with no bookkeeping at all. The
 * graph is kept by reference — the immutability rule means every field the edit
 * did not touch is shared with the entry beside it, so an entry retains one new
 * array per collection the edit rewrote and nothing else.
 *
 * `primaryNodeId` and `severedBeaconPreference` are canvas state the graph does
 * not hold and a restore has to put back. An empty `primaryNodeId` is the seed's
 * honest answer — nothing had committed yet when the document loaded — and the
 * canvas re-derives its own pointer from a value that names no node.
 */
type HistoryEntry = {
	graph: MultigraphData;
	primaryNodeId: string;
	severedBeaconPreference: string[];
	label: string;
	/** Epoch ms, so the revert offer can say how long ago the import happened. */
	createdAt: number;
	/**
	 * The reader turned down the revert offer for this entry. Per-entry, and it
	 * touches no history: dismissing hides a card, it does not undo anything.
	 */
	offerDismissed?: boolean;
};

type ControllerView = {
	graph: MultigraphData;
	viewState: ViewState;
	graphSummaries: GraphSummary[];
	loadedGraphId: string;
	documentId: string | null;
	documentStatus: DocumentStatus;
	/** True only when the graph now in memory is byte-for-byte what the cache holds. */
	draftCached: boolean;
	/** A cache write is scheduled or in flight, so "not cached" is premature rather than true. */
	cachePending: boolean;
	durability: StorageDurability;
	/**
	 * Bumped when the document itself is swapped — a load, a replacing import, a
	 * new graph, a revert. The canvas is keyed on it and remounts around the graph
	 * that arrived, discarding pan, zoom, focus and nav along with the old
	 * document, because none of it describes the new one.
	 */
	graphGeneration: number;
	/**
	 * Bumped when the *same* document is mutated from outside the canvas — today
	 * only by an additive import. The canvas stays mounted and adopts the incoming
	 * graph in place, exactly as it would a mutation of its own, so the reader
	 * keeps where they were looking while new nodes settle in beside their work.
	 *
	 * Deliberately separate from `graphGeneration`: a bump there would remount and
	 * throw that away. Never moved by `notifyGraphChanged`, which comes *from* the
	 * canvas — echoing it back would be the canvas telling itself what it just did.
	 */
	graphRevision: number;
	/**
	 * The revert offer standing over the loaded graph, or `null` when there is
	 * none. Derived from the history: it shows while the newest import entry is
	 * still on the *undo* side of the stack and has not been dismissed — not
	 * merely while it is the top entry, because today's banner deliberately
	 * survives the edits made after the import it offers to undo.
	 */
	snapshot: SnapshotSummary | null;
	/**
	 * Canvas state the newest `graphRevision` bump is asking to be put back, or
	 * `null` when that bump was an arrival rather than a restore.
	 *
	 * An arrival — the additive import — reveals itself by camera and leaves the
	 * canvas's own pointers alone; a restore moves no camera and hands back the
	 * pin pointer and beacon hint recorded with the state, which the graph does
	 * not carry. Read alongside `graphRevision`, never on its own.
	 */
	restoredCanvasState: { primaryNodeId: string; severedBeaconPreference: string[] } | null;
	canUndo: boolean;
	canRedo: boolean;
	/**
	 * What an undo would reverse and a redo would re-apply, in the words the
	 * commit named itself with ('delete node'). Null when there is nothing to do,
	 * which is what the disabled control explains.
	 */
	undoLabel: string | null;
	redoLabel: string | null;
	status: ControllerStatus;
};

export type GraphSaveScheduler = {
	schedule(
		id: string,
		data: MultigraphData,
		viewState: ViewState,
		readHistory?: ReadHistoryTail
	): void;
	flush(): Promise<void>;
	dispose(): void;
};

type LoadGraphResult = {
	createdDefaultGraph: boolean;
};

export type EmbeddedDocumentConflictChoice = 'recover-draft' | 'open-file';

type ControllerListener = (view: ControllerView) => void;

export type GraphPersistenceControllerDeps = {
	persistence: Persistence;
	createScheduler: (onStatus: (status: SaveStatus) => void) => GraphSaveScheduler;
	createDefaultGraph: () => MultigraphData;
	navigate: (graphId: string) => void | Promise<void>;
	storageNamespace: string;
	/** 'memory-only' when the browser blocks site data; defaults to 'durable'. */
	durability?: StorageDurability;
	confirmGraphImportReplace?: (context: {
		loadedGraphId: string;
		currentGraph: MultigraphData;
		incomingGraph: MultigraphData;
	}) => boolean | Promise<boolean>;
	confirmNewGraphReplace?: (context: {
		currentGraph: MultigraphData;
		documentStatus: DocumentStatus;
	}) => boolean | Promise<boolean>;
	minScale?: number;
	maxScale?: number;
	/**
	 * Retained-pointer ceiling for the undo history, past which the oldest entries
	 * are evicted. Defaults to `APP_CONFIG.history.retainedPointerCeiling`; specs
	 * pin it low enough to observe eviction.
	 */
	historyCeiling?: number;
	createGraphId?: () => string;
	createDocumentId?: () => string;
	now?: () => number;
	/**
	 * Raw build stamp of the running app. Recorded on every document it writes,
	 * and compared against a document's own stamp on open.
	 */
	appVersion?: string;
	openUnsupportedHtmlFile?: (html: string) => boolean;
	assetStore?: GraphAssetStore;
	chooseEmbeddedDocumentConflict?: (context: {
		documentId: string;
		draftGraph: MultigraphData;
		fileGraph: MultigraphData;
	}) => EmbeddedDocumentConflictChoice | Promise<EmbeddedDocumentConflictChoice>;
};

export class GraphPersistenceController {
	private readonly listeners = new Set<ControllerListener>();
	private readonly scheduler: GraphSaveScheduler;
	private view: ControllerView;
	private graphGeneration = 0;
	private graphRevision = 0;
	private baseline: DocumentBaseline;
	private recoveredDraft = false;
	/** Fingerprint of the graph data storage last accepted; null when nothing has been written. */
	private lastPersistedFingerprint: string | null = null;
	/** A cache write has been scheduled and has not reported back yet. */
	private cachePending = false;
	/** The camera moved since the last scheduled write, so no write carries it yet. */
	private viewStateDirty = false;
	/**
	 * The undo history for the loaded graph. Held here rather than in the canvas
	 * because this is the only place that sees both canvas edits and
	 * controller-side mutations, and because it must survive a canvas remount —
	 * exactly when a reader most wants their history.
	 */
	private history: UndoHistory<HistoryEntry>;
	/**
	 * The coalesce key of the run currently open, if any. A commit naming it
	 * replaces the newest entry instead of pushing beside it; anything else — a
	 * different key, no key, or the run's own closing commit — ends the run.
	 */
	private openCoalesceKey: string | null = null;

	constructor(private readonly deps: GraphPersistenceControllerDeps) {
		const defaultGraph = deps.createDefaultGraph();
		this.baseline = { kind: 'new', graph: defaultGraph };
		this.history = createUndoHistory(seedHistoryEntry(defaultGraph, this.now()));
		this.scheduler = deps.createScheduler((status) => this.handleSaveStatus(status));
		this.view = {
			graph: defaultGraph,
			viewState: { ...NEUTRAL_VIEW_STATE },
			graphSummaries: [],
			loadedGraphId: '',
			documentId: null,
			documentStatus: documentStatusForGraph(defaultGraph, this.baseline),
			draftCached: false,
			cachePending: false,
			durability: deps.durability ?? 'durable',
			graphGeneration: 0,
			graphRevision: 0,
			snapshot: null,
			restoredCanvasState: null,
			canUndo: false,
			canRedo: false,
			undoLabel: null,
			redoLabel: null,
			status: { state: 'loading', graphId: DEFAULT_GRAPH_ID }
		};
	}

	subscribe(listener: ControllerListener): () => void {
		this.listeners.add(listener);
		listener(this.getView());
		return () => {
			this.listeners.delete(listener);
		};
	}

	getView(): ControllerView {
		return {
			...this.view,
			documentStatus: this.currentDocumentStatus(),
			draftCached: this.currentDraftCached(),
			cachePending: this.cachePending,
			graphSummaries: [...this.view.graphSummaries],
			snapshot: this.currentSnapshotOffer(),
			canUndo: canUndo(this.history),
			canRedo: canRedo(this.history),
			undoLabel: canUndo(this.history) ? currentEntry(this.history).label : null,
			redoLabel: redoTarget(this.history)?.label ?? null
		};
	}

	async load(
		graphId: string,
		options: { flushCurrent?: boolean; externalReload?: boolean; documentId?: string | null } = {}
	): Promise<LoadGraphResult> {
		if (options.flushCurrent) {
			await this.flushPendingSave();
		}

		this.update({ status: { state: 'loading', graphId } });
		const savedGraph = await this.deps.persistence.load(graphId);
		const defaultGraph = this.deps.createDefaultGraph();
		const nextGraph = savedGraph?.data ?? defaultGraph;
		const nextViewState = savedGraph?.viewState ?? { ...NEUTRAL_VIEW_STATE };
		this.baseline = {
			kind: 'new',
			graph: defaultGraph
		};
		this.recoveredDraft = false;
		// A graph read back out of the cache IS what the cache holds; a missing one
		// has not been written yet and only counts once its write reports success.
		this.lastPersistedFingerprint = savedGraph === null ? null : graphFingerprint(savedGraph.data);
		this.resetHistory(nextGraph, { deferSweep: true });
		this.rebuildHistory(nextGraph, savedGraph?.history ?? null);
		this.graphGeneration += 1;
		this.update({
			graph: nextGraph,
			viewState: nextViewState,
			loadedGraphId: graphId,
			documentId: options.documentId ?? null,
			documentStatus: this.currentDocumentStatus(),
			graphGeneration: this.graphGeneration,
			graphSummaries: await this.deps.persistence.list()
		});

		if (savedGraph === null) {
			this.scheduleSave(graphId, nextGraph, nextViewState);
			await this.flushPendingSave();
			await this.refreshGraphList();
			await this.sweepTrashedAssets();
			return { createdDefaultGraph: true };
		}

		this.update({
			status: options.externalReload ? { state: 'reloaded', graphId } : { state: 'loaded', graphId }
		});
		await this.sweepTrashedAssets();
		return { createdDefaultGraph: false };
	}

	async loadEmbeddedDocument(
		doc: GraphFileDocument,
		options: { openedFromPicker?: boolean } = {}
	): Promise<void> {
		if (!doc.documentId) {
			await this.load(DEFAULT_GRAPH_ID, { flushCurrent: false });
			return;
		}

		const graphId = documentDraftGraphId(doc.documentId);
		this.update({ status: { state: 'loading', graphId } });
		const savedDraft = await this.deps.persistence.load(graphId);
		const shouldOpenFile =
			savedDraft !== null && options.openedFromPicker === true
				? await this.shouldOpenEmbeddedFile({
						documentId: doc.documentId,
						draftGraph: savedDraft.data,
						fileGraph: doc.data
					})
				: savedDraft === null;
		const shouldRecoverDraft = savedDraft !== null && !shouldOpenFile;
		const recoveredDraft = shouldRecoverDraft && !graphDataEquals(savedDraft.data, doc.data);
		const nextGraph = shouldRecoverDraft ? savedDraft.data : doc.data;
		const nextViewState = shouldRecoverDraft ? savedDraft.viewState : doc.viewState;
		if (shouldOpenFile) {
			await this.hydrateEmbeddedAssets(graphId, doc);
		}

		this.baseline = { kind: 'file', graph: doc.data };
		this.recoveredDraft = recoveredDraft;
		// Only the recovered draft came out of the cache. The file payload is not
		// cached until the write scheduled below reports success.
		this.lastPersistedFingerprint =
			shouldRecoverDraft && savedDraft !== null ? graphFingerprint(savedDraft.data) : null;
		this.resetHistory(nextGraph, { deferSweep: true });
		// Only a recovered draft carries a tail; the file payload has none by
		// design, and opening the file over the draft discards the draft's.
		this.rebuildHistory(nextGraph, shouldRecoverDraft ? (savedDraft?.history ?? null) : null);
		this.graphGeneration += 1;
		this.update({
			graph: nextGraph,
			viewState: nextViewState,
			loadedGraphId: graphId,
			documentId: doc.documentId,
			documentStatus: this.currentDocumentStatus(),
			graphGeneration: this.graphGeneration,
			graphSummaries: await this.deps.persistence.list(),
			status: { state: 'loaded', graphId }
		});

		if (savedDraft === null) await this.refreshGraphList();
		if (savedDraft !== null && shouldOpenFile) {
			this.scheduleSave(graphId, doc.data, doc.viewState);
			await this.flushPendingSave();
			await this.refreshGraphList();
		}
		// After the rebuild above, never before it. A sweep that runs first deletes
		// exactly the blobs the tail was about to make reachable again, and the
		// symptom — a broken image several undos later — is a long way from here.
		await this.sweepTrashedAssets();

		// Last, so the awaits above cannot overwrite it with a routine status, and
		// sticky because the reader has to act on it: their next Save would wrap
		// this newer graph back up in this older app's code.
		const versionNotice = newerAppNotice(doc.appVersion, this.deps.appVersion);
		if (versionNotice !== null) {
			this.update({
				status: { state: 'notice', sticky: true, severity: 'warning', message: versionNotice }
			});
		}
	}

	private async shouldOpenEmbeddedFile(context: {
		documentId: string;
		draftGraph: MultigraphData;
		fileGraph: MultigraphData;
	}): Promise<boolean> {
		if (graphDataEquals(context.draftGraph, context.fileGraph)) return true;
		const choice = await this.deps.chooseEmbeddedDocumentConflict?.(context);
		return choice === 'open-file';
	}

	/**
	 * `generation` names the graph the change was made to. A canvas being torn
	 * down still commits pending edits — a title input blurring as the graph is
	 * swapped is the usual one — and without this guard that commit is written
	 * under the graph that replaced it, silently overwriting it. Callers that
	 * cannot name a generation are trusted as before.
	 */
	notifyGraphChanged(
		data: MultigraphData,
		options: { syncView?: boolean; generation?: number; intent?: GraphCommitIntent } = {}
	): void {
		if (options.generation !== undefined && options.generation !== this.graphGeneration) return;
		const graphId = this.view.loadedGraphId || DEFAULT_GRAPH_ID;
		// A change event that lands on exactly what the cache already holds buys
		// nothing but a 'Caching draft...' flash. Skipping it is only safe while no
		// write is in flight, since a pending one may still hold different data.
		const alreadyCached =
			!this.cachePending && graphFingerprint(data) === this.lastPersistedFingerprint;
		if (!alreadyCached) this.scheduleSave(graphId, data, this.view.viewState);
		if (options.intent) this.recordHistory(data, options.intent);
		if (options.syncView) {
			this.update({ graph: data, documentStatus: this.currentDocumentStatus(data) });
		}
	}

	/**
	 * Turn a commit into an entry, or decide it is not one.
	 *
	 * Three gates, cheapest first. The O(1) reference test rejects every physics
	 * frame and every drag `pointermove` without touching the graph's contents. A
	 * commit that passes it is confirmed by a semantic fingerprint, because
	 * reference inequality over-reports — a mutation can rebuild an array to an
	 * equal value. A commit continuing an open coalesce run skips the fingerprint
	 * and replaces the run's newest state, which is what turns a colour scrub's
	 * dozens of `oninput` commits into one entry while the canvas previews live.
	 */
	private recordHistory(graph: MultigraphData, intent: GraphCommitIntent): void {
		const top = currentEntry(this.history);
		const continuing =
			intent.coalesceKey !== undefined && intent.coalesceKey === this.openCoalesceKey;

		if (semanticallyUnchanged(top.graph, graph)) {
			// A layout-only commit records nothing — but the swatch's closing
			// `change` fires with the colour its last `input` already committed, and
			// the run still has to end or the next scrub of this tag would join it.
			if (intent.endsCoalesceRun) this.openCoalesceKey = null;
			return;
		}

		const entry: HistoryEntry = {
			graph,
			primaryNodeId: intent.primaryNodeId,
			severedBeaconPreference: [...intent.severedBeaconPreference],
			label: intent.label,
			createdAt: this.now()
		};

		if (continuing) {
			this.commitHistory(replaceTop(this.history, entry, this.historyEviction()), graph);
		} else {
			if (semanticFingerprint(top.graph) === semanticFingerprint(graph)) {
				if (intent.endsCoalesceRun) this.openCoalesceKey = null;
				return;
			}
			this.commitHistory(push(this.history, entry, this.historyEviction()), graph);
			this.openCoalesceKey = intent.coalesceKey ?? null;
		}

		if (intent.endsCoalesceRun) this.openCoalesceKey = null;
	}

	/**
	 * Take an operation's result, and collect blobs it just put out of reach.
	 *
	 * `dropped` is the only signal that says a tombstoned blob may finally be
	 * unreachable — eviction on the memory ceiling, a cleared history, and the
	 * redo tail a fresh edit discards all arrive through it. It is a *trigger*,
	 * not the authority: what survives is recomputed from the live graph and every
	 * remaining entry, so over-reporting here is safe and cheap.
	 */
	private commitHistory(change: HistoryChange<HistoryEntry>, liveGraph?: MultigraphData): void {
		this.history = change.history;
		if (change.dropped.length > 0) void this.sweepTrashedAssets(liveGraph);
	}

	/**
	 * Delete tombstoned blobs nothing can reach any more.
	 *
	 * The keep-set spans *both* sides of the stack, not just the undo side: a blob
	 * referenced only by a redo entry is still one redo away from being on screen.
	 * Both asset scopes are swept for the same reason `embeddedAssetsForExport`
	 * searches both — a document that has been exported writes under its document
	 * id while the loaded graph id is still in use.
	 *
	 * `liveGraph` is passed explicitly by the commit path rather than read off the
	 * view, because history is recorded *before* the view syncs: reading the view
	 * here would sweep an image removal against the graph that still had the
	 * image, decide the blob is live, and clear the tombstone that was about to
	 * collect it.
	 */
	private async sweepTrashedAssets(liveGraph: MultigraphData = this.view.graph): Promise<void> {
		const store = this.deps.assetStore;
		if (!store) return;
		const keep = referencedAssetIds(liveGraph);
		for (const entry of allEntries(this.history)) {
			for (const assetId of referencedAssetIds(entry.graph)) keep.add(assetId);
		}
		for (const scope of new Set([this.assetScope(), this.view.loadedGraphId || DEFAULT_GRAPH_ID])) {
			await sweepAssetTrash(store, scope, keep);
		}
	}

	private historyEviction(): HistoryEviction<HistoryEntry> {
		return {
			// Retained pointers, not bytes: an entry's cost is the arrays the edit
			// rewrote, and every collection it did not touch is shared outright with
			// the entry beside it.
			costOf: (entry) => entry.graph.nodes.length + entry.graph.edges.length,
			ceiling: this.deps.historyCeiling ?? APP_CONFIG.history.retainedPointerCeiling
		};
	}

	/**
	 * Put the document back one state. Returns whether there was one to go to.
	 *
	 * `graphRevision`, never `graphGeneration`: the canvas stays mounted and
	 * adopts the older graph in place, so pan, zoom, focus and the nav stack all
	 * survive — the whole point of undoing rather than reloading. The camera does
	 * not move either: unlike an import, an undo reverses something the reader
	 * just did where they are already looking, and the notice covers the case
	 * where it happened off screen.
	 */
	undo(): boolean {
		if (!canUndo(this.history)) return false;
		const reversing = currentEntry(this.history).label;
		this.history = undo(this.history);
		this.applyHistoryEntry(currentEntry(this.history), `Undid "${reversing}".`);
		return true;
	}

	/**
	 * Say why an action the reader just asked for did not happen.
	 *
	 * The notice column is the one channel that reaches a touch device: the
	 * controls use `aria-disabled` rather than `disabled` precisely so a tap on
	 * one with nothing to do lands here instead of going nowhere. Like every other
	 * notice it is superseded by the next save status rather than dismissed, which
	 * gives it a natural lifetime.
	 */
	reportBlockedAction(reason: string): void {
		this.update({ status: { state: 'notice', sticky: true, message: reason } });
	}

	/** Put the document forward one state. Returns whether there was one to go to. */
	redo(): boolean {
		if (!canRedo(this.history)) return false;
		this.history = redo(this.history);
		const entry = currentEntry(this.history);
		this.applyHistoryEntry(entry, `Redid "${entry.label}".`);
		return true;
	}

	private applyHistoryEntry(entry: HistoryEntry, message: string): void {
		const graphId = this.view.loadedGraphId || DEFAULT_GRAPH_ID;
		const restored = restoreSemantics(this.view.graph, entry.graph);
		// A restore ends any open coalesce run: the state the run was folding into
		// is no longer the one the document is in.
		this.openCoalesceKey = null;
		this.graphRevision += 1;
		this.update({
			graph: restored,
			documentStatus: this.currentDocumentStatus(restored),
			graphRevision: this.graphRevision,
			restoredCanvasState: {
				primaryNodeId: entry.primaryNodeId,
				severedBeaconPreference: [...entry.severedBeaconPreference]
			},
			status: { state: 'notice', sticky: true, message }
		});
		this.scheduleSave(graphId, restored, this.view.viewState);
	}

	/**
	 * Start the history over from `graph`. Called wherever the document itself is
	 * replaced — a load, a new graph, a replacing import, a graph switch — because
	 * an entry from another document restores nothing meaningful. Never called by
	 * the additive import, whose whole point is that the document survives.
	 */
	private resetHistory(graph: MultigraphData, options: { deferSweep?: boolean } = {}): void {
		const change = clearHistory(this.history, seedHistoryEntry(graph, this.now()));
		this.history = change.history;
		this.openCoalesceKey = null;
		// A load defers the sweep and runs it itself, *after* rebuilding the draft's
		// persisted tail. Sweeping first would delete exactly the blobs that tail
		// was about to make reachable again, and the symptom — a broken image
		// several undos later — is a long way from the cause. Do not inline this
		// back into the reset.
		if (!options.deferSweep && change.dropped.length > 0) void this.sweepTrashedAssets();
	}

	/**
	 * Panning, zooming and deep zoom move the camera without editing the
	 * document, so they must not schedule a cache write: doing so rewrote the
	 * whole graph and flashed 'Caching draft...' through every gesture. The camera
	 * is held in memory and rides along with the next edit or flush instead.
	 */
	notifyViewStateChanged(viewState: ViewState, options: { syncView?: boolean } = {}): void {
		this.viewStateDirty = true;
		if (options.syncView) {
			this.update({ viewState });
			return;
		}
		this.view = { ...this.view, viewState };
	}

	async exportGraphDocument(htmlShell?: string): Promise<GraphFileArtifact> {
		const documentId = this.view.documentId ?? this.nextDocumentId();
		if (this.view.documentId === null) {
			this.update({ documentId });
		}
		const embeddedAssets = await this.embeddedAssetsForExport(this.view.graph, [
			this.assetScope(),
			this.view.loadedGraphId || DEFAULT_GRAPH_ID,
			documentDraftGraphId(documentId)
		]);
		const artifact = createGraphFileArtifact(
			this.view.loadedGraphId || DEFAULT_GRAPH_ID,
			{
				data: this.view.graph,
				viewState: this.view.viewState,
				documentId,
				exportedAt: this.now(),
				appVersion: this.deps.appVersion,
				embeddedAssets
			},
			{
				htmlShell
			}
		);
		this.baseline = { kind: 'saved-file', graph: this.view.graph };
		this.recoveredDraft = false;
		this.update({
			documentId,
			documentStatus: this.currentDocumentStatus(),
			status: { state: 'exported', filename: artifact.filename }
		});
		return artifact;
	}

	async importGraphDocument(text: string): Promise<ImportGraphResult> {
		await this.flushPendingSave();

		let imported: ReturnType<typeof parseGraphFileText>;
		try {
			imported = parseGraphFileText(text, {
				minScale: this.deps.minScale,
				maxScale: this.deps.maxScale
			});
		} catch (error) {
			return this.reportImportFailure(error, text);
		}

		const confirmReplace = this.deps.confirmGraphImportReplace;
		const shouldConfirm = requiresReplaceConfirmation(
			this.view.graph,
			this.deps.createDefaultGraph()
		);
		const confirmed = !shouldConfirm
			? true
			: ((await confirmReplace?.({
					loadedGraphId: this.view.loadedGraphId || DEFAULT_GRAPH_ID,
					currentGraph: this.view.graph,
					incomingGraph: imported.data
				})) ?? false);
		if (!confirmed) {
			this.update({
				status: {
					state: 'notice',
					message: 'Import cancelled.'
				}
			});
			return 'cancelled';
		}

		const graphId = this.view.loadedGraphId || DEFAULT_GRAPH_ID;
		this.resetHistory(imported.data);
		this.graphGeneration += 1;
		this.baseline = { kind: 'file', graph: imported.data };
		this.recoveredDraft = false;
		this.lastPersistedFingerprint = null;
		this.update({
			graph: imported.data,
			viewState: imported.viewState,
			documentId: imported.documentId ?? this.view.documentId,
			documentStatus: this.currentDocumentStatus(imported.data),
			graphGeneration: this.graphGeneration
		});
		this.scheduleSave(graphId, imported.data, imported.viewState);
		await this.hydrateEmbeddedAssets(graphId, imported);
		await this.flushPendingSave();
		await this.refreshGraphList();
		const versionNotice = newerAppNotice(imported.appVersion, this.deps.appVersion);
		this.update({
			status:
				versionNotice !== null
					? { state: 'notice', sticky: true, severity: 'warning', message: versionNotice }
					: { state: 'notice', message: `Imported into "${graphId}".` }
		});
		return 'imported';
	}

	async importGraphDocumentFromReader(
		readText: () => Promise<string>
	): Promise<ImportGraphResult | 'read-failed'> {
		try {
			const text = await readText();
			return await this.importGraphDocument(text);
		} catch {
			this.update({
				status: {
					state: 'notice',
					sticky: true,
					message: 'Import failed. Could not read the file.'
				}
			});
			return 'read-failed';
		}
	}

	/**
	 * Fold a graph file into the graph the reader is already looking at, as a
	 * separate component, and leave a snapshot of the moment before.
	 *
	 * Deliberately unlike `importGraphDocument`, which swaps the document out:
	 * this is an additive edit, so `graphGeneration` does not move and the view
	 * state is never touched. Bumping either would remount the canvas and throw
	 * away the reader's pan, zoom and focus for what is, to them, one more
	 * component appearing beside their work.
	 *
	 * The incoming document's own view state and document id are discarded for
	 * the same reason: the host document is still the document.
	 */
	async importGraphIntoCurrent(text: string): Promise<ImportIntoCurrentResult> {
		let imported: GraphFileDocument;
		try {
			imported = parseGraphFileText(text, {
				minScale: this.deps.minScale,
				maxScale: this.deps.maxScale
			});
		} catch (error) {
			// Nothing has been written yet, so a bad file leaves no snapshot behind
			// and no revert offer pointing at a moment that never changed.
			return { outcome: this.reportImportFailure(error, text) };
		}

		const graphId = this.view.loadedGraphId || DEFAULT_GRAPH_ID;
		const { next, nodeIdMap } = importGraphData(this.view.graph, imported.data);
		// One entry, labelled so the revert offer can find it again. An additive
		// import keeps every host node, so the canvas pointers it carries are the
		// ones already in force.
		const top = currentEntry(this.history);
		this.commitHistory(
			push(
				this.history,
				{
					graph: next,
					primaryNodeId: top.primaryNodeId,
					severedBeaconPreference: [...top.severedBeaconPreference],
					label: 'import',
					createdAt: this.now()
				},
				this.historyEviction()
			)
		);
		this.openCoalesceKey = null;
		// The one bump in the codebase. `graphGeneration` stays put so the canvas
		// stays mounted; the revision is how a mounted canvas is told that the graph
		// under it grew, and without it the nodes only appear on the next reload.
		this.graphRevision += 1;
		this.update({
			graph: next,
			documentStatus: this.currentDocumentStatus(next),
			graphRevision: this.graphRevision,
			restoredCanvasState: null
		});
		this.scheduleSave(graphId, next, this.view.viewState);
		await this.hydrateImportedAssets(graphId, imported);
		await this.flushPendingSave();
		await this.refreshGraphList();
		this.update({
			status: {
				state: 'notice',
				message: `Imported ${nodeIdMap.size} ${nodeIdMap.size === 1 ? 'node' : 'nodes'} into "${graphId}".`
			}
		});

		return { outcome: 'imported', importedNodeCount: nodeIdMap.size };
	}

	async importGraphIntoCurrentFromReader(
		readText: () => Promise<string>
	): Promise<ImportIntoCurrentResult> {
		let text: string;
		try {
			text = await readText();
		} catch {
			this.update({
				status: {
					state: 'notice',
					sticky: true,
					message: 'Import failed. Could not read the file.'
				}
			});
			return { outcome: 'read-failed' };
		}

		return await this.importGraphIntoCurrent(text);
	}

	/**
	 * Put the graph back the way it was before the import, as one *new* entry.
	 *
	 * Re-founded on the history, and strictly kinder for it. The revert used to be
	 * a one-way door that bumped `graphGeneration` and remounted the canvas;
	 * committing it as a new entry keeps the history linear, keeps the reader's
	 * pan, zoom, focus and nav, and — for the first time — makes the revert itself
	 * redoable.
	 *
	 * The confirmation stays where the caller has it: this is still not the
	 * inverse of the import alone, because everything done since goes with it.
	 *
	 * The baseline is left alone on purpose. Reverting does not change where this
	 * document came from — only how far it has drifted — so restoring the graph a
	 * download was taken from correctly reads as "matches downloaded file" again.
	 *
	 * Assets are left to the sweep. The import entry is still in the stack, so
	 * nothing it references has become unreachable.
	 */
	async revertToSnapshot(): Promise<boolean> {
		const index = this.newestImportEntryIndex();
		if (index === null || index === 0) return false;

		const before = this.history.entries[index - 1];
		// Taking the offer retires it. The import entry stays exactly where it is —
		// undo and redo still walk over it — but a card offering to revert an
		// import that has just been reverted is a card nobody wants twice.
		const entries = [...this.history.entries];
		entries[index] = { ...entries[index], offerDismissed: true };
		this.history = { entries, pointer: this.history.pointer };
		this.commitHistory(
			push(
				this.history,
				{
					graph: restoreSemantics(this.view.graph, before.graph),
					primaryNodeId: before.primaryNodeId,
					severedBeaconPreference: [...before.severedBeaconPreference],
					label: 'revert import',
					createdAt: this.now()
				},
				this.historyEviction()
			)
		);
		const graphId = this.view.loadedGraphId || DEFAULT_GRAPH_ID;
		this.applyHistoryEntry(currentEntry(this.history), `Reverted the import into "${graphId}".`);
		await this.flushPendingSave();
		await this.refreshGraphList();
		return true;
	}

	/**
	 * Turn down the revert offer. Marks the entry and touches no history: hiding a
	 * card is not undoing anything, and the import stays exactly as reachable
	 * through plain undo as it was a moment ago.
	 */
	dismissSnapshot(): void {
		const index = this.newestImportEntryIndex();
		if (index === null) return;
		const entries = [...this.history.entries];
		entries[index] = { ...entries[index], offerDismissed: true };
		this.history = { entries, pointer: this.history.pointer };
		this.emit();
	}

	/**
	 * Where the newest undismissed import entry sits on the *undo* side, or `null`.
	 *
	 * The undo side, not the top: today's banner survives every edit made after
	 * the import, and that is load-bearing — an import followed by a rename must
	 * not silently lose the way back. Undoing *past* the import does hide it,
	 * which loses nothing: the offer is reachable again as a plain redo.
	 */
	private newestImportEntryIndex(): number | null {
		for (let index = this.history.pointer; index >= 0; index -= 1) {
			const entry = this.history.entries[index];
			if (entry.label !== 'import') continue;
			return entry.offerDismissed === true ? null : index;
		}
		return null;
	}

	private currentSnapshotOffer(): SnapshotSummary | null {
		const index = this.newestImportEntryIndex();
		if (index === null || index === 0) return null;
		const entry = this.history.entries[index];
		return {
			label: entry.label,
			createdAt: entry.createdAt,
			addedNodeCount: entry.graph.nodes.length - this.history.entries[index - 1].graph.nodes.length
		};
	}

	/** Report a file that would not parse, in the words both import paths share. */
	private reportImportFailure(error: unknown, text: string): ImportGraphFailure {
		if (isUnsupportedHtmlGraphFile(error)) {
			const opened = this.deps.openUnsupportedHtmlFile?.(text) ?? false;
			this.update({
				status: {
					state: 'notice',
					sticky: true,
					message: opened
						? 'Newer graph file. Opened in a new tab.'
						: 'Needs a newer app version. Open the file directly.'
				}
			});
			return opened ? 'opened-in-new-tab' : 'open-tab-blocked';
		}
		if (error instanceof PersistedGraphError && error.code === 'unsupported-version') {
			this.update({
				status: {
					state: 'notice',
					sticky: true,
					message: 'Import failed. Unsupported file version.'
				}
			});
			return 'unsupported';
		}
		this.update({
			status: {
				state: 'notice',
				sticky: true,
				message: 'Import failed. Not a valid graph file.'
			}
		});
		return 'invalid';
	}

	/**
	 * Copy an imported document's embedded assets into a scope that is already in
	 * use, for an additive import.
	 *
	 * Deliberately unlike the replacing `hydrateEmbeddedAssets`: it never sweeps,
	 * because the incoming document's referenced ids say nothing about the host
	 * graph's own images — sweeping against them would delete every host asset.
	 * An incoming asset whose id is already stored in the scope is skipped rather
	 * than overwritten, so the host's copy stays authoritative. Assets left
	 * orphaned by later edits are collected by the next replacing load or import.
	 */
	async hydrateImportedAssets(scope: string, doc: GraphFileDocument): Promise<void> {
		const store = this.deps.assetStore;
		if (!store) return;
		for (const asset of doc.embeddedAssets ?? []) {
			const existing = await store.get(scope, asset.assetId);
			if (existing.ok) continue;
			await store.put(this.storedAsset(scope, asset));
		}
	}

	async selectGraph(graphId: string): Promise<void> {
		if (graphId === this.view.loadedGraphId) return;
		await this.flushPendingSave();
		// The load this navigation triggers re-seeds anyway; clearing here as well
		// keeps the window between them from offering an undo into the graph being
		// left behind.
		this.resetHistory(this.view.graph);
		await this.deps.navigate(graphId);
	}

	async createGraph(graphId = this.nextGraphId()): Promise<void> {
		const shouldConfirm = documentStatusHasUnsavedChanges(this.currentDocumentStatus());
		const confirmed = !shouldConfirm
			? true
			: ((await this.deps.confirmNewGraphReplace?.({
					currentGraph: this.view.graph,
					documentStatus: this.currentDocumentStatus()
				})) ?? false);
		if (!confirmed) return;

		await this.flushPendingSave();
		const nextGraph = this.deps.createDefaultGraph();
		this.baseline = { kind: 'new', graph: nextGraph };
		this.recoveredDraft = false;
		this.lastPersistedFingerprint = null;
		this.resetHistory(nextGraph);
		this.graphGeneration += 1;
		this.update({
			graph: nextGraph,
			viewState: { ...NEUTRAL_VIEW_STATE },
			loadedGraphId: graphId,
			documentId: null,
			documentStatus: this.currentDocumentStatus(nextGraph),
			graphGeneration: this.graphGeneration,
			status: { state: 'loaded', graphId }
		});
		this.scheduleSave(graphId, nextGraph, { ...NEUTRAL_VIEW_STATE });
		await this.flushPendingSave();
		await this.refreshGraphList();
		await this.deps.navigate(graphId);
	}

	async deleteGraph(graphId: string): Promise<void> {
		await this.flushPendingSave();
		await this.deps.persistence.delete(graphId);
		await this.refreshGraphList();

		const nextGraphId =
			this.view.graphSummaries.find((summary) => summary.id !== graphId)?.id ?? DEFAULT_GRAPH_ID;

		if (nextGraphId === graphId) {
			await this.load(nextGraphId, { flushCurrent: false });
			return;
		}

		await this.deps.navigate(nextGraphId);
	}

	async handleStorageEvent(event: { key: string | null }): Promise<void> {
		if (event.key === null || this.view.loadedGraphId === '') return;

		const graphId = graphIdFromStorageKey(this.deps.storageNamespace, event.key);
		if (graphId !== this.view.loadedGraphId) return;
		const documentStatus = this.currentDocumentStatus();
		if (
			documentStatus !== 'new-clean' &&
			documentStatus !== 'file-clean' &&
			documentStatus !== 'saved-file-clean'
		) {
			this.update({
				status: {
					state: 'notice',
					sticky: true,
					message: 'Changed in another tab. Kept your cached draft.'
				}
			});
			return;
		}

		await this.load(graphId, { flushCurrent: false, externalReload: true });
	}

	dispose(): void {
		this.scheduler.dispose();
		this.listeners.clear();
	}

	/**
	 * Every scheduled cache write goes through here so `cachePending` cannot
	 * drift from what the scheduler was actually asked to do.
	 */
	private scheduleSave(id: string, data: MultigraphData, viewState: ViewState): void {
		this.cachePending = true;
		// The scheduled write carries the current camera, so it is no longer owed.
		this.viewStateDirty = false;
		// A thunk, so the O(K·N) tail is built once per debounced write rather than
		// on every commit — this runs on every `pointermove` of a drag.
		this.scheduler.schedule(id, data, viewState, () => this.persistedHistoryTail());
	}

	/**
	 * The newest undo-side entries as deltas chained backwards from the current
	 * graph, under a byte budget measured on the tail itself.
	 *
	 * The budget is a pre-flight measurement, not `SaveScheduler`'s quota numbers:
	 * those are an advisory computed *after* a successful write, so they cannot
	 * gate one. A tail that will not fit is shortened from the oldest end, and the
	 * write still succeeds — the same discipline `graphSnapshot.ts` states for its
	 * own writes, because losing history is a smaller harm than losing the draft.
	 */
	private persistedHistoryTail(): PersistedHistoryTail | undefined {
		const states = undoEntries(this.history);
		const head = states[0];
		if (head === undefined) return undefined;

		const tail: PersistedHistoryTail = { head: persistedHistoryState(head), entries: [] };
		const limit = Math.min(states.length - 1, APP_CONFIG.history.persistedEntryCount);
		for (let index = 1; index <= limit; index += 1) {
			tail.entries.push({
				...persistedHistoryState(states[index]),
				delta: diffByReference(states[index - 1].graph, states[index].graph)
			});
		}

		while (tail.entries.length > 0 && tailBytes(tail) > APP_CONFIG.history.persistedBudgetBytes) {
			tail.entries.pop();
		}

		// A tail with nothing behind the head describes no undo, so it is bytes in
		// the draft that buy nothing. Leave the key out entirely.
		return tail.entries.length === 0 ? undefined : tail;
	}

	/**
	 * Rebuild the stack from a draft's tail, chaining the deltas backwards from
	 * the graph that came out of storage.
	 *
	 * "Does not apply" is drop-the-tail, never an error. Two tabs on the same
	 * graph already race on the draft, and the loser's tail describes a graph the
	 * draft no longer holds; the graph itself is intact either way, and an empty
	 * history is exactly what an opened file gets.
	 */
	private rebuildHistory(graph: MultigraphData, tail: PersistedHistoryTail | null): void {
		if (tail === null) return;
		try {
			let cursor = graph;
			const newestFirst: HistoryEntry[] = [{ graph, ...tail.head }];
			for (const entry of tail.entries) {
				// A delta naming elements this graph does not have is a tail written by
				// another tab against a graph the draft no longer holds. Drop it.
				if (!deltaApplies(cursor, entry.delta)) throw new Error('History tail does not apply.');
				cursor = applyDelta(cursor, entry.delta);
				newestFirst.push({
					graph: cursor,
					label: entry.label,
					primaryNodeId: entry.primaryNodeId,
					severedBeaconPreference: [...entry.severedBeaconPreference],
					createdAt: entry.createdAt,
					...(entry.offerDismissed === true ? { offerDismissed: true } : {})
				});
			}
			const entries = [...newestFirst].reverse();
			this.history = { entries, pointer: entries.length - 1 };
		} catch {
			this.resetHistory(graph, { deferSweep: true });
		}
	}

	/**
	 * Writes whatever is owed to the cache. Camera-only changes never scheduled a
	 * write of their own, so this is where they are folded in: leaving the page,
	 * switching graphs, importing over the current one.
	 */
	async flushPendingSave(): Promise<void> {
		if (this.viewStateDirty && this.view.loadedGraphId !== '') {
			this.scheduleSave(this.view.loadedGraphId, this.view.graph, this.view.viewState);
		}
		try {
			await this.scheduler.flush();
		} catch {
			// SaveScheduler has already emitted the error; route changes remain non-blocking.
		}
	}

	private handleSaveStatus(status: SaveStatus): void {
		// A cache error leaves the fingerprint alone: it still describes the last
		// write that actually landed.
		if (status.state === 'saved' || status.state === 'warning') {
			this.lastPersistedFingerprint = status.fingerprint;
		}

		// The scheduler has reported back, so nothing is owed any more: a failure
		// clears the pending flag too, which is what lets the warning surface.
		if (status.state === 'saved' || status.state === 'warning' || status.state === 'error') {
			this.cachePending = false;
		}

		this.update({ status: saveStatusToControllerStatus(status) });

		if (status.state === 'saved' || status.state === 'warning') {
			void this.refreshGraphList();
		}
	}

	private async refreshGraphList(): Promise<void> {
		this.update({ graphSummaries: await this.deps.persistence.list() });
	}

	private assetScope(): string {
		if (this.view.documentId) return documentDraftGraphId(this.view.documentId);
		return this.view.loadedGraphId || DEFAULT_GRAPH_ID;
	}

	private async embeddedAssetsForExport(
		graph: MultigraphData,
		scopes: string[]
	): Promise<NonNullable<GraphFileDocument['embeddedAssets']>> {
		const store = this.deps.assetStore;
		if (!store) return [];
		const embeddedAssets: NonNullable<GraphFileDocument['embeddedAssets']> = [];
		for (const assetId of referencedAssetIds(graph)) {
			let storedAsset: Awaited<ReturnType<GraphAssetStore['get']>> | null = null;
			for (const scope of [...new Set(scopes)]) {
				storedAsset = await store.get(scope, assetId);
				if (storedAsset.ok) break;
			}
			if (!storedAsset?.ok) continue;
			embeddedAssets.push({
				assetId,
				mimeType: storedAsset.value.mimeType,
				name: storedAsset.value.name,
				size: storedAsset.value.size,
				base64: await blobToBase64(storedAsset.value.blob)
			});
		}
		return embeddedAssets;
	}

	/** Replace a scope's assets with the document's, sweeping whatever it no longer references. */
	private async hydrateEmbeddedAssets(scope: string, doc: GraphFileDocument): Promise<void> {
		const store = this.deps.assetStore;
		if (!store) return;
		for (const asset of doc.embeddedAssets ?? []) {
			await store.put(this.storedAsset(scope, asset));
		}
		await store.deleteUnreferenced(scope, referencedAssetIds(doc.data));
	}

	private storedAsset(scope: string, asset: GraphFileEmbeddedAsset): StoredGraphAsset {
		return {
			scope,
			assetId: asset.assetId,
			blob: base64ToBlob(asset.base64, asset.mimeType),
			mimeType: asset.mimeType,
			name: asset.name,
			size: asset.size,
			updatedAt: this.now()
		};
	}

	private update(patch: Partial<ControllerView>): void {
		const nextGraph = patch.graph ?? this.view.graph;
		this.view = {
			...this.view,
			...patch,
			documentStatus: patch.documentStatus ?? this.currentDocumentStatus(nextGraph),
			draftCached: this.currentDraftCached(nextGraph),
			cachePending: this.cachePending
		};
		this.emit();
	}

	private currentDocumentStatus(graph = this.view.graph): DocumentStatus {
		return documentStatusForGraph(graph, this.baseline, { recoveredDraft: this.recoveredDraft });
	}

	private currentDraftCached(graph = this.view.graph): boolean {
		// Writing to memory-only storage is not caching: it dies with the tab.
		if (this.view.durability === 'memory-only') return false;
		if (this.lastPersistedFingerprint === null) return false;
		return graphFingerprint(graph) === this.lastPersistedFingerprint;
	}

	private emit(): void {
		const snapshot = this.getView();
		for (const listener of this.listeners) {
			listener(snapshot);
		}
	}

	private now(): number {
		return this.deps.now?.() ?? Date.now();
	}

	private nextGraphId(): string {
		return this.deps.createGraphId?.() ?? `graph-${Date.now().toString(36)}`;
	}

	private nextDocumentId(): string {
		return this.deps.createDocumentId?.() ?? `doc-${Date.now().toString(36)}`;
	}
}

/**
 * The entry a freshly loaded document starts from, and the state its first
 * edit's undo returns to.
 *
 * `primaryNodeId` is empty because nothing has committed yet: the canvas picks
 * its own primary on ingest, and a restore of this state hands back a value that
 * names no node, which is exactly the signal to re-derive one.
 */
function persistedHistoryState(entry: HistoryEntry): PersistedHistoryState {
	return {
		label: entry.label,
		primaryNodeId: entry.primaryNodeId,
		severedBeaconPreference: [...entry.severedBeaconPreference],
		createdAt: entry.createdAt,
		...(entry.offerDismissed === true ? { offerDismissed: true } : {})
	};
}

/** UTF-16 code units, the unit `estimateNamespaceUsageBytes` already counts in. */
function tailBytes(tail: PersistedHistoryTail): number {
	return JSON.stringify(tail).length * 2;
}

function seedHistoryEntry(graph: MultigraphData, createdAt: number): HistoryEntry {
	return { graph, primaryNodeId: '', severedBeaconPreference: [], label: 'load', createdAt };
}

export function statusToNotice(status: ControllerStatus): string {
	if (status.state === 'loading') return 'Loading graph...';
	if (status.state === 'loaded') return `Loaded "${status.graphId}".`;
	if (status.state === 'reloaded') return 'Reloaded from another tab.';
	if (status.state === 'saving') return 'Caching draft...';
	if (status.state === 'saved') return 'Draft cached.';
	if (status.state === 'warning') return status.message;
	if (status.state === 'notice') return status.message;
	if (status.state === 'exported') return `Saved ${status.filename}. Check your downloads.`;
	return `Could not cache draft. ${status.message}`;
}

export function controllerNotice(view: ControllerView): string {
	if (view.status.state === 'error') return statusToNotice(view.status);
	// Memory-only storage is a standing condition, not a transient status: it
	// outranks 'Caching draft...' / 'Draft cached.' / 'Loaded "x".', which would
	// otherwise reassure the user that work is being kept when nothing is. It
	// also outranks the post-save confirmation: the file is safe, but this
	// browser still is not caching anything.
	if (view.durability === 'memory-only') return MEMORY_ONLY_STORAGE_NOTICE;
	if (view.status.state === 'exported') return statusToNotice(view.status);
	if (view.status.state === 'loading') return statusToNotice(view.status);
	if (view.status.state === 'saving') return statusToNotice(view.status);
	// A sticky notice is the app answering something the reader just did — an
	// import that would not parse, an undo with nothing to undo, an undo that
	// happened off screen. It outranks the routine cache write below it because
	// otherwise it is never seen at all: an operation that edits the document
	// schedules a write in the same breath, and 'Caching draft...' would cover its
	// own answer for the whole debounce and then be replaced by the save status.
	if (view.status.state === 'notice' && view.status.sticky === true) return view.status.message;
	// A debounced cache write that has not fired yet is still in progress. Saying
	// 'Caching draft...' beats flashing "not cached" between every keystroke and
	// the write that follows it half a second later.
	if (view.cachePending) return statusToNotice({ state: 'saving' });
	if (view.status.state === 'warning') return statusToNotice(view.status);
	return documentStatusNotice(view.documentStatus, { draftCached: view.draftCached });
}

/**
 * Severity of the notice `controllerNotice` would return, so the toolbar can
 * escalate the ones that mean work is at risk. Kept beside the messages so the
 * two cannot drift apart.
 */
export function controllerNoticeSeverity(view: ControllerView): 'info' | 'warning' {
	if (view.status.state === 'error') return 'warning';
	if (view.durability === 'memory-only') return 'warning';
	// Mirrors controllerNotice's precedence exactly, so the styling always
	// matches the text: a pending cache write renders 'Caching draft...' and must
	// not be amber, even while a quota warning status is standing by.
	if (view.status.state === 'exported') return 'info';
	if (view.status.state === 'loading' || view.status.state === 'saving') return 'info';
	// Mirrors the sticky-notice tier above — the tier where controllerNotice
	// hands the sticky message the line, so the colour is decided on the message
	// actually shown. The app answering the reader directly is information, not
	// an alarm; a sticky notice that names its own severity keeps it, because
	// some of them (the newer-app warning) are about work at risk.
	if (view.status.state === 'notice' && view.status.sticky === true) {
		return view.status.severity ?? 'info';
	}
	if (view.cachePending) return 'info';
	if (view.status.state === 'warning') return 'warning';
	// Only escalate when the notice is the document-status one saying the work
	// is not saved.
	if (!view.draftCached && documentStatusHasUnsavedChanges(view.documentStatus)) {
		return 'warning';
	}
	return 'info';
}

function saveStatusToControllerStatus(status: SaveStatus): ControllerStatus {
	if (status.state === 'idle') return { state: 'loading', graphId: DEFAULT_GRAPH_ID };
	if (status.state === 'saving') return { state: 'saving' };
	if (status.state === 'saved') return { state: 'saved', savedAt: status.savedAt };
	if (status.state === 'warning') {
		return { state: 'warning', savedAt: status.savedAt, message: status.message };
	}
	return { state: 'error', message: status.message };
}

function requiresReplaceConfirmation(
	currentGraph: MultigraphData,
	defaultGraph: MultigraphData
): boolean {
	if (currentGraph.edges.length > 0) return true;
	if (currentGraph.nodes.length === 0) return false;
	if (currentGraph.nodes.length > 1) return true;
	return JSON.stringify(currentGraph) !== JSON.stringify(defaultGraph);
}
