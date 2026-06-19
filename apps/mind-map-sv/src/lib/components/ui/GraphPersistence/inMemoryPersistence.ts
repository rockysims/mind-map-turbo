import type { MultigraphData } from '$lib/components/ui/types/multigraph';
import { NEUTRAL_VIEW_STATE, type ViewState } from '$lib/migrations';
import type { GraphSummary, PersistedGraphRecord, Persistence } from '$lib/persistence';

type StoredGraph = {
	graph: PersistedGraphRecord;
	updatedAt: number;
};

export class InMemoryPersistence implements Persistence {
	private readonly graphs = new Map<string, StoredGraph>();

	constructor(
		initialGraphs: Record<string, MultigraphData> = {},
		private readonly now: () => number = Date.now
	) {
		for (const [id, graph] of Object.entries(initialGraphs)) {
			this.graphs.set(id, {
				graph: { data: cloneGraph(graph), viewState: { ...NEUTRAL_VIEW_STATE } },
				updatedAt: this.now()
			});
		}
	}

	async load(id: string): Promise<PersistedGraphRecord | null> {
		const graph = this.graphs.get(id);
		return graph
			? { data: cloneGraph(graph.graph.data), viewState: cloneViewState(graph.graph.viewState) }
			: null;
	}

	async save(id: string, graph: PersistedGraphRecord): Promise<void> {
		this.graphs.set(id, {
			graph: { data: cloneGraph(graph.data), viewState: cloneViewState(graph.viewState) },
			updatedAt: this.now()
		});
	}

	async list(): Promise<GraphSummary[]> {
		return Array.from(this.graphs.entries())
			.map(([id, { updatedAt }]) => ({ id, updatedAt }))
			.sort((left, right) => right.updatedAt - left.updatedAt);
	}

	async delete(id: string): Promise<void> {
		this.graphs.delete(id);
	}
}

function cloneGraph(graph: MultigraphData): MultigraphData {
	return JSON.parse(JSON.stringify(graph)) as MultigraphData;
}

function cloneViewState(viewState: ViewState): ViewState {
	return { panX: viewState.panX, panY: viewState.panY, scale: viewState.scale };
}
