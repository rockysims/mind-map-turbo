import type { MultigraphData } from '$lib/components/ui/types/multigraph';
import type { GraphSummary, Persistence } from '$lib/persistence';

type StoredGraph = {
	data: MultigraphData;
	updatedAt: number;
};

export class InMemoryPersistence implements Persistence {
	private readonly graphs = new Map<string, StoredGraph>();

	constructor(
		initialGraphs: Record<string, MultigraphData> = {},
		private readonly now: () => number = Date.now
	) {
		for (const [id, graph] of Object.entries(initialGraphs)) {
			this.graphs.set(id, { data: cloneGraph(graph), updatedAt: this.now() });
		}
	}

	async load(id: string): Promise<MultigraphData | null> {
		const graph = this.graphs.get(id);
		return graph ? cloneGraph(graph.data) : null;
	}

	async save(id: string, data: MultigraphData): Promise<void> {
		this.graphs.set(id, { data: cloneGraph(data), updatedAt: this.now() });
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
