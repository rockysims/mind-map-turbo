import type { MultigraphData } from './components/ui/types/multigraph';
import { base64ToBlob, blobToBase64 } from './assets/assetEncoding';
import type { GraphAssetStore, StoredGraphAsset } from './assets/assetStore';
import { referencedAssetIds } from './components/ui/Multigraph/lib/graph';
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
import {
	clearGraphSnapshot,
	readGraphSnapshot,
	writeGraphSnapshot,
	type GraphSnapshotOptions
} from './graphSnapshot';
import { NEUTRAL_VIEW_STATE, PersistedGraphError, type ViewState } from './migrations';
import {
	documentDraftGraphId,
	graphIdFromStorageKey,
	type GraphSummary,
	type Persistence,
	type StorageLike
} from './persistence';
import type { SaveStatus } from './saveScheduler';
import type { StorageDurability } from './storageAvailability';

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
 * arrived, because the revert offer names it ("Imported 14 nodes"), and whether a
 * pre-import snapshot survived — without one there is nothing to revert to.
 */
type ImportIntoCurrentResult =
	| { outcome: 'imported'; importedNodeCount: number; snapshotStored: boolean }
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
	| { state: 'notice'; message: string; sticky?: boolean }
	| { state: 'exported'; filename: string }
	| { state: 'error'; message: string };

/**
 * What the revert offer knows about the snapshot standing behind the loaded
 * graph. Deliberately not the snapshot itself: the banner only needs to say what
 * happened and how long ago, and holding a second copy of the graph in the view
 * would double every render's memory for a card the size of a sentence.
 *
 * `nodeCount` is the count *before* the operation, so the banner can name what
 * the operation added by subtracting it from the graph on screen.
 */
export type SnapshotSummary = {
	label: string;
	createdAt: number;
	nodeCount: number;
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
	/** The revertible snapshot for the loaded graph, or `null` when there is none. */
	snapshot: SnapshotSummary | null;
	status: ControllerStatus;
};

export type GraphSaveScheduler = {
	schedule(id: string, data: MultigraphData, viewState: ViewState): void;
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
	/**
	 * Where pre-import snapshots live. Defaults to the ambient `localStorage`,
	 * beside the saved graphs; `null` turns snapshotting off.
	 */
	snapshotStorage?: StorageLike | null;
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

	constructor(private readonly deps: GraphPersistenceControllerDeps) {
		const defaultGraph = deps.createDefaultGraph();
		this.baseline = { kind: 'new', graph: defaultGraph };
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
			graphSummaries: [...this.view.graphSummaries]
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
		this.graphGeneration += 1;
		this.update({
			graph: nextGraph,
			viewState: nextViewState,
			loadedGraphId: graphId,
			documentId: options.documentId ?? null,
			documentStatus: this.currentDocumentStatus(),
			graphGeneration: this.graphGeneration,
			// Read from storage rather than carried in memory: a snapshot outlives a
			// reload, so the revert offer has to be rediscovered on every load.
			snapshot: this.readSnapshotSummary(graphId),
			graphSummaries: await this.deps.persistence.list()
		});

		if (savedGraph === null) {
			this.scheduleSave(graphId, nextGraph, nextViewState);
			await this.flushPendingSave();
			await this.refreshGraphList();
			return { createdDefaultGraph: true };
		}

		this.update({
			status: options.externalReload ? { state: 'reloaded', graphId } : { state: 'loaded', graphId }
		});
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
		this.graphGeneration += 1;
		this.update({
			graph: nextGraph,
			viewState: nextViewState,
			loadedGraphId: graphId,
			documentId: doc.documentId,
			documentStatus: this.currentDocumentStatus(),
			graphGeneration: this.graphGeneration,
			snapshot: this.readSnapshotSummary(graphId),
			graphSummaries: await this.deps.persistence.list(),
			status: { state: 'loaded', graphId }
		});

		if (savedDraft === null) await this.refreshGraphList();
		if (savedDraft !== null && shouldOpenFile) {
			this.scheduleSave(graphId, doc.data, doc.viewState);
			await this.flushPendingSave();
			await this.refreshGraphList();
		}

		// Last, so the awaits above cannot overwrite it with a routine status, and
		// sticky because the reader has to act on it: their next Save would wrap
		// this newer graph back up in this older app's code.
		const versionNotice = newerAppNotice(doc.appVersion, this.deps.appVersion);
		if (versionNotice !== null) {
			this.update({ status: { state: 'notice', sticky: true, message: versionNotice } });
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
		options: { syncView?: boolean; generation?: number } = {}
	): void {
		if (options.generation !== undefined && options.generation !== this.graphGeneration) return;
		const graphId = this.view.loadedGraphId || DEFAULT_GRAPH_ID;
		// A change event that lands on exactly what the cache already holds buys
		// nothing but a 'Caching draft...' flash. Skipping it is only safe while no
		// write is in flight, since a pending one may still hold different data.
		const alreadyCached =
			!this.cachePending && graphFingerprint(data) === this.lastPersistedFingerprint;
		if (!alreadyCached) this.scheduleSave(graphId, data, this.view.viewState);
		if (options.syncView) {
			this.update({ graph: data, documentStatus: this.currentDocumentStatus(data) });
		}
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
				exportedAt: this.deps.now?.() ?? Date.now(),
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
			status: {
				state: 'notice',
				// Only the version warning is sticky; a routine import is not.
				sticky: versionNotice !== null,
				message: versionNotice ?? `Imported into "${graphId}".`
			}
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
		const snapshotNodeCount = this.view.graph.nodes.length;
		const createdAt = this.deps.now?.() ?? Date.now();
		const snapshotStored = writeGraphSnapshot(
			graphId,
			{ data: this.view.graph, viewState: this.view.viewState, label: 'import' },
			{ ...this.snapshotOptions(), now: () => createdAt }
		);

		const { next, nodeIdMap } = importGraphData(this.view.graph, imported.data);
		// The one bump in the codebase. `graphGeneration` stays put so the canvas
		// stays mounted; the revision is how a mounted canvas is told that the graph
		// under it grew, and without it the nodes only appear on the next reload.
		this.graphRevision += 1;
		this.update({
			graph: next,
			documentStatus: this.currentDocumentStatus(next),
			graphRevision: this.graphRevision,
			// Without a stored snapshot there is nothing to revert to, so the offer
			// is not made — better silence than a button that cannot keep its word.
			snapshot: snapshotStored ? { label: 'import', createdAt, nodeCount: snapshotNodeCount } : null
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

		return { outcome: 'imported', importedNodeCount: nodeIdMap.size, snapshotStored };
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
	 * Put the graph back the way the snapshot found it, and forget the snapshot.
	 * Returns whether there was one to restore.
	 *
	 * This is a wholesale replacement of the document's contents, so unlike the
	 * additive import it *does* bump `graphGeneration`: the canvas remounts around
	 * the restored graph and its restored pan and zoom, the same way a replacing
	 * import or a load does. Everything the reader did since the snapshot goes
	 * with it, which is why the caller asks first.
	 *
	 * The baseline is left alone on purpose. Reverting does not change where this
	 * document came from — it changes only how far it has drifted — so restoring
	 * the graph a download was taken from correctly reads as "matches downloaded
	 * file" again.
	 *
	 * Assets are deliberately untouched. Sweeping here would take the host graph's
	 * own images with the imported ones, because the restored graph references
	 * neither set by id it did not already know about; blobs the revert orphans
	 * are collected by the next replacing load.
	 */
	async revertToSnapshot(): Promise<boolean> {
		const graphId = this.view.loadedGraphId || DEFAULT_GRAPH_ID;
		const snapshot = readGraphSnapshot(graphId, this.snapshotOptions());
		if (snapshot === null) {
			this.update({ snapshot: null });
			return false;
		}

		const nextViewState = snapshot.viewState ?? this.view.viewState;
		this.graphGeneration += 1;
		this.update({
			graph: snapshot.data,
			viewState: nextViewState,
			documentStatus: this.currentDocumentStatus(snapshot.data),
			graphGeneration: this.graphGeneration,
			snapshot: null
		});
		this.scheduleSave(graphId, snapshot.data, nextViewState);
		clearGraphSnapshot(graphId, this.snapshotOptions());
		await this.flushPendingSave();
		await this.refreshGraphList();
		this.update({
			status: {
				state: 'notice',
				message:
					snapshot.label === 'import'
						? `Reverted the import into "${graphId}".`
						: `Reverted "${graphId}".`
			}
		});
		return true;
	}

	/** Turn down the revert offer, discarding the snapshot behind it. */
	dismissSnapshot(): void {
		const graphId = this.view.loadedGraphId || DEFAULT_GRAPH_ID;
		clearGraphSnapshot(graphId, this.snapshotOptions());
		this.update({ snapshot: null });
	}

	private snapshotOptions(): GraphSnapshotOptions {
		return {
			storage: this.deps.snapshotStorage,
			namespace: this.deps.storageNamespace,
			...(this.deps.now === undefined ? {} : { now: this.deps.now })
		};
	}

	private readSnapshotSummary(graphId: string): SnapshotSummary | null {
		const snapshot = readGraphSnapshot(graphId, this.snapshotOptions());
		if (snapshot === null) return null;
		return {
			label: snapshot.label,
			createdAt: snapshot.createdAt,
			nodeCount: snapshot.data.nodes.length
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
		this.graphGeneration += 1;
		this.update({
			graph: nextGraph,
			viewState: { ...NEUTRAL_VIEW_STATE },
			loadedGraphId: graphId,
			documentId: null,
			documentStatus: this.currentDocumentStatus(nextGraph),
			graphGeneration: this.graphGeneration,
			snapshot: this.readSnapshotSummary(graphId),
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
		this.scheduler.schedule(id, data, viewState);
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
			updatedAt: this.deps.now?.() ?? Date.now()
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

	private nextGraphId(): string {
		return this.deps.createGraphId?.() ?? `graph-${Date.now().toString(36)}`;
	}

	private nextDocumentId(): string {
		return this.deps.createDocumentId?.() ?? `doc-${Date.now().toString(36)}`;
	}
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
	// A debounced cache write that has not fired yet is still in progress. Saying
	// 'Caching draft...' beats flashing "not cached" between every keystroke and
	// the write that follows it half a second later.
	if (view.cachePending) return statusToNotice({ state: 'saving' });
	if (view.status.state === 'warning') return statusToNotice(view.status);
	if (view.status.state === 'notice' && view.status.sticky === true) return view.status.message;
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
