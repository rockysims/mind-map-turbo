import type { MultigraphData } from './components/ui/types/multigraph';
import { parseGraphFile, serializeGraphFile } from './graphFile';
import { DEFAULT_GRAPH_ID } from './graphRoute';
import { NEUTRAL_VIEW_STATE, PersistedGraphError, type ViewState } from './migrations';
import { graphIdFromStorageKey, type GraphSummary, type Persistence } from './persistence';
import type { SaveStatus } from './saveScheduler';

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
	minScale?: number;
	maxScale?: number;
	createGraphId?: () => string;
};

export class GraphPersistenceController {
	private readonly listeners = new Set<ControllerListener>();
	private readonly scheduler: GraphSaveScheduler;
	private view: ControllerView;
	private graphGeneration = 0;

	constructor(private readonly deps: GraphPersistenceControllerDeps) {
		this.scheduler = deps.createScheduler((status) => this.handleSaveStatus(status));
		this.view = {
			graph: deps.createDefaultGraph(),
			viewState: { ...NEUTRAL_VIEW_STATE },
			graphSummaries: [],
			loadedGraphId: '',
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
			graphSummaries: [...this.view.graphSummaries]
		};
	}

	async load(
		graphId: string,
		options: { flushCurrent?: boolean; externalReload?: boolean } = {}
	): Promise<void> {
		if (options.flushCurrent) {
			await this.flushPendingSave();
		}

		this.update({ status: { state: 'loading', graphId } });
		const savedGraph = await this.deps.persistence.load(graphId);
		const nextGraph = savedGraph?.data ?? this.deps.createDefaultGraph();
		const nextViewState = savedGraph?.viewState ?? { ...NEUTRAL_VIEW_STATE };
		this.graphGeneration += 1;
		this.update({
			graph: nextGraph,
			viewState: nextViewState,
			loadedGraphId: graphId,
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

	notifyGraphChanged(data: MultigraphData, options: { syncView?: boolean } = {}): void {
		const graphId = this.view.loadedGraphId || DEFAULT_GRAPH_ID;
		this.scheduler.schedule(graphId, data, this.view.viewState);
		if (options.syncView) {
			this.update({ graph: data });
		}
	}

	notifyViewStateChanged(viewState: ViewState, options: { syncView?: boolean } = {}): void {
		const graphId = this.view.loadedGraphId || DEFAULT_GRAPH_ID;
		this.scheduler.schedule(graphId, this.view.graph, viewState);
		if (options.syncView) {
			this.update({ viewState });
		}
	}

	exportGraphDocument(): string {
		return serializeGraphFile({
			data: this.view.graph,
			viewState: this.view.viewState
		});
	}

	async importGraphDocument(
		json: string
	): Promise<'imported' | 'cancelled' | 'invalid' | 'unsupported'> {
		await this.flushPendingSave();

		let imported: ReturnType<typeof parseGraphFile>;
		try {
			imported = parseGraphFile(json, {
				minScale: this.deps.minScale,
				maxScale: this.deps.maxScale
			});
		} catch (error) {
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
		this.update({
			graph: imported.data,
			viewState: imported.viewState,
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
	): Promise<'imported' | 'cancelled' | 'invalid' | 'unsupported' | 'read-failed'> {
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
		await this.selectGraph(graphId);
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
		this.view = { ...this.view, ...patch };
		this.emit();
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
