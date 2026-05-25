import type { MultigraphData } from './components/ui/types/multigraph';
import { DEFAULT_GRAPH_ID } from './graphRoute';
import { graphIdFromStorageKey, type GraphSummary, type Persistence } from './persistence';
import type { SaveStatus } from './saveScheduler';

export type ControllerStatus =
	| { state: 'loading'; graphId: string }
	| { state: 'loaded'; graphId: string }
	| { state: 'reloaded'; graphId: string }
	| { state: 'saving' }
	| { state: 'saved'; savedAt: number }
	| { state: 'warning'; savedAt: number; message: string }
	| { state: 'error'; message: string };

export type ControllerView = {
	graph: MultigraphData;
	graphSummaries: GraphSummary[];
	loadedGraphId: string;
	graphGeneration: number;
	status: ControllerStatus;
};

export type GraphSaveScheduler = {
	schedule(id: string, data: MultigraphData): void;
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
		const nextGraph = savedGraph ?? this.deps.createDefaultGraph();
		this.graphGeneration += 1;
		this.update({
			graph: nextGraph,
			loadedGraphId: graphId,
			graphGeneration: this.graphGeneration,
			graphSummaries: await this.deps.persistence.list()
		});

		if (savedGraph === null) {
			this.scheduler.schedule(graphId, nextGraph);
			await this.flushPendingSave();
			await this.refreshGraphList();
			return;
		}

		this.update({
			status: options.externalReload ? { state: 'reloaded', graphId } : { state: 'loaded', graphId }
		});
	}

	notifyGraphChanged(data: MultigraphData): void {
		const graphId = this.view.loadedGraphId || DEFAULT_GRAPH_ID;
		this.update({ graph: data });
		this.scheduler.schedule(graphId, data);
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
