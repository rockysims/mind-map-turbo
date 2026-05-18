import { describe, expect, it, vi } from 'vitest';
import { APP_CONFIG } from './appConfig';
import { makeGraph } from './components/ui/Multigraph/lib/testFixtures';
import { CURRENT_SCHEMA_VERSION } from './migrations';
import {
	LocalStoragePersistence,
	ServerPersistence,
	estimateNamespaceUsageBytes,
	graphStorageKey,
	type StorageLike
} from './persistence';

class MemoryStorage implements StorageLike {
	private readonly items = new Map<string, string>();

	get length(): number {
		return this.items.size;
	}

	getItem(key: string): string | null {
		return this.items.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		this.items.set(key, value);
	}

	removeItem(key: string): void {
		this.items.delete(key);
	}

	key(index: number): string | null {
		return Array.from(this.items.keys())[index] ?? null;
	}
}

describe('LocalStoragePersistence', () => {
	it('round-trips saved graph data through the schema envelope', async () => {
		const storage = new MemoryStorage();
		const persistence = new LocalStoragePersistence(storage, 'test', () => 123);
		const graph = makeGraph({ nodeCount: 2, edges: [[0, 1]] });

		await persistence.save('graph one', graph);

		expect(await persistence.load('graph one')).toEqual(graph);
		expect(JSON.parse(storage.getItem(graphStorageKey('test', 'graph one')) ?? '{}')).toMatchObject(
			{
				schemaVersion: CURRENT_SCHEMA_VERSION,
				data: graph,
				updatedAt: 123
			}
		);
	});

	it('returns null for a missing graph', async () => {
		const persistence = new LocalStoragePersistence(new MemoryStorage(), 'test');

		await expect(persistence.load('missing')).resolves.toBeNull();
	});

	it('lists graph ids by most recent update time', async () => {
		const storage = new MemoryStorage();
		let now = 100;
		const persistence = new LocalStoragePersistence(storage, 'test', () => now);

		await persistence.save('older', makeGraph({ nodeCount: 1 }));
		now = 200;
		await persistence.save('newer', makeGraph({ nodeCount: 2 }));

		await expect(persistence.list()).resolves.toEqual([
			{ id: 'newer', updatedAt: 200 },
			{ id: 'older', updatedAt: 100 }
		]);
	});

	it('deletes saved graphs', async () => {
		const persistence = new LocalStoragePersistence(new MemoryStorage(), 'test');

		await persistence.save('graph', makeGraph({ nodeCount: 1 }));
		await persistence.delete('graph');

		await expect(persistence.load('graph')).resolves.toBeNull();
	});

	it('isolates namespaces', async () => {
		const storage = new MemoryStorage();
		const first = new LocalStoragePersistence(storage, 'first');
		const second = new LocalStoragePersistence(storage, 'second');

		await first.save('graph', makeGraph({ nodeCount: 1 }));

		await expect(second.load('graph')).resolves.toBeNull();
		await expect(second.list()).resolves.toEqual([]);
	});

	it('estimates namespace usage from UTF-16 storage size', () => {
		const storage = new MemoryStorage();
		storage.setItem('mind-map:graph:a', '1234');
		storage.setItem('other:graph:a', '1234');

		expect(estimateNamespaceUsageBytes(storage, APP_CONFIG.persistence.storageNamespace)).toBe(
			('mind-map:graph:a'.length + '1234'.length) * 2
		);
	});
});

describe('ServerPersistence', () => {
	it('loads graph data from a schema envelope', async () => {
		const graph = makeGraph({ nodeCount: 1 });
		const fetchGraph = vi.fn(async () => Response.json({ schemaVersion: 1, data: graph }));
		const persistence = new ServerPersistence(fetchGraph);

		await expect(persistence.load('graph one')).resolves.toEqual(graph);
		expect(fetchGraph).toHaveBeenCalledWith('/api/graphs/graph%20one');
	});

	it('saves graph data with method, path, and envelope body', async () => {
		const graph = makeGraph({ nodeCount: 1 });
		const fetchGraph = vi.fn(async () => new Response(null, { status: 204 }));
		const persistence = new ServerPersistence(fetchGraph);

		await persistence.save('graph', graph);

		expect(fetchGraph).toHaveBeenCalledWith('/api/graphs/graph', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ schemaVersion: 1, data: graph })
		});
	});

	it('deletes graph data by id', async () => {
		const fetchGraph = vi.fn(async () => new Response(null, { status: 204 }));
		const persistence = new ServerPersistence(fetchGraph);

		await persistence.delete('graph');

		expect(fetchGraph).toHaveBeenCalledWith('/api/graphs/graph', { method: 'DELETE' });
	});
});
