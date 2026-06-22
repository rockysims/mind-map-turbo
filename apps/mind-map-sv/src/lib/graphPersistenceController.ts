import type { MultigraphData } from './components/ui/types/multigraph';
import {
	documentStatusHasUndownloadedChanges,
	documentStatusForGraph,
	documentStatusNotice,
	graphDataEquals,
	type DocumentBaseline,
	type DocumentStatus
} from './documentStatus';
import {
	createGraphFileArtifact,
	isUnsupportedHtmlGraphFile,
	parseGraphFileText,
	type GraphFileDocument,
	type GraphFileArtifact
} from './graphFile';
import { DEFAULT_GRAPH_ID } from './graphRoute';
import { NEUTRAL_VIEW_STATE, PersistedGraphError, type ViewState } from './migrations';
import {
	documentDraftGraphId,
	graphIdFromStorageKey,
	type GraphSummary,
	type Persistence
} from './persistence';
import type { SaveStatus } from './saveScheduler';

export type ImportGraphResult =
	| 'imported'
	| 'cancelled'
	| 'invalid'
	| 'unsupported'
	| 'opened-in-new-tab'
	| 'open-tab-blocked';

export type ControllerStatus =
	| { state: 'loading'; graphId: string }
	| { state: 'loaded'; graphId: string }
	| { state: 'reloaded'; graphId: string }
	| { state: 'saving' }
	| { state: 'saved'; savedAt: number }
	| { state: 'warning'; savedAt: number; message: string }
	| { state: 'notice'; message: string }
	| { state: 'error'; message: string };

export type ControllerView = {
	graph: MultigraphData;
	viewState: ViewState;
	graphSummaries: GraphSummary[];
	loadedGraphId: string;
	documentId: string | null;
	documentStatus: DocumentStatus;
	graphGeneration: number;
	status: ControllerStatus;
};

export type GraphSaveScheduler = {
	schedule(id: string, data: MultigraphData, viewState: ViewState): void;
	flush(): Promise<void>;
	dispose(): void;
};

type ControllerListener = (view: ControllerView) => void;

export type GraphPersistenceControllerDeps = {
	persistence: Persistence;
	createScheduler: (onStatus: (status: SaveStatus) => void) => GraphSaveScheduler;
	createDefaultGraph: () => MultigraphData;
	navigate: (graphId: string) => void | Promise<void>;
	storageNamespace: string;
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
	openUnsupportedHtmlFile?: (html: string) => boolean;
};

export class GraphPersistenceController {
	private readonly listeners = new Set<ControllerListener>();
	private readonly scheduler: GraphSaveScheduler;
	private view: ControllerView;
	private graphGeneration = 0;
	private baseline: DocumentBaseline;
	private recoveredDraft = false;

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
			graphGeneration: 0,
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
			graphSummaries: [...this.view.graphSummaries]
		};
	}

	async load(
		graphId: string,
		options: { flushCurrent?: boolean; externalReload?: boolean; documentId?: string | null } = {}
	): Promise<void> {
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
			this.scheduler.schedule(graphId, nextGraph, nextViewState);
			await this.flushPendingSave();
			await this.refreshGraphList();
			return;
		}

		this.update({
			status: options.externalReload ? { state: 'reloaded', graphId } : { state: 'loaded', graphId }
		});
	}

	async loadEmbeddedDocument(doc: GraphFileDocument): Promise<void> {
		if (!doc.documentId) {
			await this.load(DEFAULT_GRAPH_ID, { flushCurrent: false });
			return;
		}

		const graphId = documentDraftGraphId(doc.documentId);
		this.update({ status: { state: 'loading', graphId } });
		const savedDraft = await this.deps.persistence.load(graphId);
		const recoveredDraft = savedDraft !== null && !graphDataEquals(savedDraft.data, doc.data);
		const nextGraph = savedDraft?.data ?? doc.data;
		const nextViewState = savedDraft?.viewState ?? doc.viewState;

		this.baseline = { kind: 'file', graph: doc.data };
		this.recoveredDraft = recoveredDraft;
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
	}

	notifyGraphChanged(data: MultigraphData, options: { syncView?: boolean } = {}): void {
		const graphId = this.view.loadedGraphId || DEFAULT_GRAPH_ID;
		this.scheduler.schedule(graphId, data, this.view.viewState);
		if (options.syncView) {
			this.update({ graph: data, documentStatus: this.currentDocumentStatus(data) });
		}
	}

	notifyViewStateChanged(viewState: ViewState, options: { syncView?: boolean } = {}): void {
		const graphId = this.view.loadedGraphId || DEFAULT_GRAPH_ID;
		this.scheduler.schedule(graphId, this.view.graph, viewState);
		if (options.syncView) {
			this.update({ viewState });
		}
	}

	exportGraphDocument(htmlShell?: string): GraphFileArtifact {
		const documentId = this.view.documentId ?? this.nextDocumentId();
		if (this.view.documentId === null) {
			this.update({ documentId });
		}
		const artifact = createGraphFileArtifact(
			this.view.loadedGraphId || DEFAULT_GRAPH_ID,
			{
				data: this.view.graph,
				viewState: this.view.viewState,
				documentId,
				exportedAt: this.deps.now?.() ?? Date.now()
			},
			{
				htmlShell
			}
		);
		this.baseline = { kind: 'download', graph: this.view.graph };
		this.recoveredDraft = false;
		this.update({ documentId, documentStatus: this.currentDocumentStatus() });
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
			if (isUnsupportedHtmlGraphFile(error)) {
				const opened = this.deps.openUnsupportedHtmlFile?.(text) ?? false;
				this.update({
					status: {
						state: 'notice',
						message: opened
							? 'Opened newer graph file in a new tab.'
							: 'Import needs a newer app version. Open the file directly to continue.'
					}
				});
				return opened ? 'opened-in-new-tab' : 'open-tab-blocked';
			}
			if (error instanceof PersistedGraphError && error.code === 'unsupported-version') {
				this.update({
					status: {
						state: 'notice',
						message: 'Import failed: unsupported graph file version.'
					}
				});
				return 'unsupported';
			}
			this.update({
				status: {
					state: 'notice',
					message: 'Import failed: invalid graph file.'
				}
			});
			return 'invalid';
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
		this.update({
			graph: imported.data,
			viewState: imported.viewState,
			documentId: imported.documentId ?? this.view.documentId,
			documentStatus: this.currentDocumentStatus(imported.data),
			graphGeneration: this.graphGeneration
		});
		this.scheduler.schedule(graphId, imported.data, imported.viewState);
		await this.flushPendingSave();
		await this.refreshGraphList();
		this.update({
			status: {
				state: 'notice',
				message: `Imported graph into "${graphId}".`
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
					message: 'Import failed: unable to read file.'
				}
			});
			return 'read-failed';
		}
	}

	async selectGraph(graphId: string): Promise<void> {
		if (graphId === this.view.loadedGraphId) return;
		await this.flushPendingSave();
		await this.deps.navigate(graphId);
	}

	async createGraph(graphId = this.nextGraphId()): Promise<void> {
		const shouldConfirm = documentStatusHasUndownloadedChanges(this.currentDocumentStatus());
		const confirmed = !shouldConfirm
			? true
			: ((await this.deps.confirmNewGraphReplace?.({
					currentGraph: this.view.graph,
					documentStatus: this.currentDocumentStatus()
				})) ?? false);
		if (!confirmed) {
			this.update({ status: { state: 'notice', message: 'New graph cancelled.' } });
			return;
		}

		await this.flushPendingSave();
		const nextGraph = this.deps.createDefaultGraph();
		this.baseline = { kind: 'new', graph: nextGraph };
		this.recoveredDraft = false;
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
		this.scheduler.schedule(graphId, nextGraph, { ...NEUTRAL_VIEW_STATE });
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
			documentStatus !== 'download-clean'
		) {
			this.update({
				status: {
					state: 'notice',
					message: 'Kept local draft; another tab changed this document.'
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

	private async flushPendingSave(): Promise<void> {
		try {
			await this.scheduler.flush();
		} catch {
			// SaveScheduler has already emitted the error; route changes remain non-blocking.
		}
	}

	private handleSaveStatus(status: SaveStatus): void {
		this.update({ status: saveStatusToControllerStatus(status) });

		if (status.state === 'saved' || status.state === 'warning') {
			void this.refreshGraphList();
		}
	}

	private async refreshGraphList(): Promise<void> {
		this.update({ graphSummaries: await this.deps.persistence.list() });
	}

	private update(patch: Partial<ControllerView>): void {
		const nextGraph = patch.graph ?? this.view.graph;
		this.view = {
			...this.view,
			...patch,
			documentStatus: patch.documentStatus ?? this.currentDocumentStatus(nextGraph)
		};
		this.emit();
	}

	private currentDocumentStatus(graph = this.view.graph): DocumentStatus {
		return documentStatusForGraph(graph, this.baseline, { recoveredDraft: this.recoveredDraft });
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
	if (status.state === 'reloaded') return `Reloaded "${status.graphId}" from another tab.`;
	if (status.state === 'saving') return 'Saving...';
	if (status.state === 'saved') return 'Saved.';
	if (status.state === 'warning') return status.message;
	if (status.state === 'notice') return status.message;
	return `Save failed: ${status.message}`;
}

export function controllerNotice(view: ControllerView): string {
	if (view.status.state === 'loading') return statusToNotice(view.status);
	if (view.status.state === 'saving') return statusToNotice(view.status);
	if (view.status.state === 'warning') return statusToNotice(view.status);
	if (view.status.state === 'error') return statusToNotice(view.status);
	if (
		view.status.state === 'notice' &&
		(view.status.message.includes('cancelled') ||
			view.status.message.includes('failed') ||
			view.status.message.includes('newer') ||
			view.status.message.includes('Kept local draft'))
	) {
		return view.status.message;
	}
	return documentStatusNotice(view.documentStatus);
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
