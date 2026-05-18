import type { MultigraphData } from './components/ui/types/multigraph';
import {
	parsePersistedGraph,
	unwrapPersistedGraph,
	wrapPersistedGraph,
	type PersistedGraphPayload
} from './migrations';

export type GraphSummary = {
	id: string;
	updatedAt: number;
};

export interface Persistence {
	load(id: string): Promise<MultigraphData | null>;
	save(id: string, data: MultigraphData): Promise<void>;
	list(): Promise<GraphSummary[]>;
	delete(id: string): Promise<void>;
}

export type PersistenceKind = 'local' | 'server';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

type StoredGraphPayload = PersistedGraphPayload & {
	updatedAt: number;
};

export function graphStorageKey(namespace: string, graphId: string): string {
	return `${namespace}:graph:${encodeURIComponent(graphId)}`;
}

export function graphIdFromStorageKey(namespace: string, key: string): string | null {
	const prefix = `${namespace}:graph:`;
	if (!key.startsWith(prefix)) return null;
	return decodeURIComponent(key.slice(prefix.length));
}

export class LocalStoragePersistence implements Persistence {
	constructor(
		private readonly storage: StorageLike,
		private readonly namespace: string,
		private readonly now: () => number = Date.now
	) {}

	async load(id: string): Promise<MultigraphData | null> {
		const item = this.storage.getItem(graphStorageKey(this.namespace, id));
		return item === null ? null : parsePersistedGraph(item);
	}

	async save(id: string, data: MultigraphData): Promise<void> {
		const payload: StoredGraphPayload = {
			...wrapPersistedGraph(data),
			updatedAt: this.now()
		};
		this.storage.setItem(graphStorageKey(this.namespace, id), JSON.stringify(payload));
	}

	async list(): Promise<GraphSummary[]> {
		const summaries: GraphSummary[] = [];

		for (let index = 0; index < this.storage.length; index += 1) {
			const key = this.storage.key(index);
			if (key === null) continue;
			const id = graphIdFromStorageKey(this.namespace, key);
			if (id === null) continue;
			const item = this.storage.getItem(key);
			if (item === null) continue;

			const payload = JSON.parse(item) as unknown;
			const graph = unwrapPersistedGraph(payload);
			const updatedAt = readUpdatedAt(payload);
			if (graph.nodes.length >= 0) summaries.push({ id, updatedAt });
		}

		return summaries.sort((left, right) => right.updatedAt - left.updatedAt);
	}

	async delete(id: string): Promise<void> {
		this.storage.removeItem(graphStorageKey(this.namespace, id));
	}
}

export class ServerPersistence implements Persistence {
	constructor(
		private readonly fetchGraph: typeof fetch,
		private readonly basePath = '/api/graphs'
	) {}

	async load(id: string): Promise<MultigraphData | null> {
		const response = await this.fetchGraph(`${this.basePath}/${encodeURIComponent(id)}`);
		if (response.status === 404) return null;
		if (!response.ok) throw new Error(`Failed to load graph ${id}: ${response.status}`);
		return unwrapPersistedGraph(await response.json());
	}

	async save(id: string, data: MultigraphData): Promise<void> {
		const response = await this.fetchGraph(`${this.basePath}/${encodeURIComponent(id)}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(wrapPersistedGraph(data))
		});
		if (!response.ok) throw new Error(`Failed to save graph ${id}: ${response.status}`);
	}

	async list(): Promise<GraphSummary[]> {
		const response = await this.fetchGraph(this.basePath);
		if (!response.ok) throw new Error(`Failed to list graphs: ${response.status}`);
		return (await response.json()) as GraphSummary[];
	}

	async delete(id: string): Promise<void> {
		const response = await this.fetchGraph(`${this.basePath}/${encodeURIComponent(id)}`, {
			method: 'DELETE'
		});
		if (!response.ok && response.status !== 404) {
			throw new Error(`Failed to delete graph ${id}: ${response.status}`);
		}
	}
}

export function createPersistence(
	kind: PersistenceKind,
	deps: {
		storage: StorageLike;
		namespace: string;
		fetchGraph?: typeof fetch;
		now?: () => number;
	}
): Persistence {
	if (kind === 'server') {
		return new ServerPersistence(deps.fetchGraph ?? fetch);
	}

	return new LocalStoragePersistence(deps.storage, deps.namespace, deps.now);
}

export function estimateNamespaceUsageBytes(storage: StorageLike, namespace: string): number {
	let bytes = 0;
	const prefix = `${namespace}:`;

	for (let index = 0; index < storage.length; index += 1) {
		const key = storage.key(index);
		if (key === null || !key.startsWith(prefix)) continue;
		const value = storage.getItem(key) ?? '';
		bytes += (key.length + value.length) * 2;
	}

	return bytes;
}

function readUpdatedAt(payload: unknown): number {
	if (typeof payload === 'object' && payload !== null && 'updatedAt' in payload) {
		const updatedAt = payload.updatedAt;
		if (typeof updatedAt === 'number') return updatedAt;
	}

	return 0;
}
