import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from './appConfig';
import { makeGraph } from './components/ui/Multigraph/lib/testFixtures';
import {
	SNAPSHOT_ENVELOPE_VERSION,
	clearGraphSnapshot,
	readGraphSnapshot,
	snapshotStorageKey,
	writeGraphSnapshot
} from './graphSnapshot';
import { CURRENT_SCHEMA_VERSION } from './migrations';
import type { StorageLike } from './persistence';

class MemoryStorage implements StorageLike {
	private readonly items = new Map<string, string>();

	/** Flip on to simulate a localStorage with no room left. */
	full = false;

	get length(): number {
		return this.items.size;
	}

	getItem(key: string): string | null {
		return this.items.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		if (this.full) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
		this.items.set(key, value);
	}

	removeItem(key: string): void {
		this.items.delete(key);
	}

	key(index: number): string | null {
		return Array.from(this.items.keys())[index] ?? null;
	}
}

/** Storage that refuses every read, like a browser blocking site data. */
class UnreadableStorage extends MemoryStorage {
	override getItem(): never {
		throw new Error('Access to storage is denied.');
	}
}

const options = (storage: StorageLike | null, now = () => 1_000) => ({
	storage,
	namespace: 'test',
	now
});

describe('snapshotStorageKey', () => {
	it('namespaces and encodes the graph id', () => {
		expect(snapshotStorageKey('test', 'document:doc 1')).toBe('test:snapshot:document%3Adoc%201');
	});

	it('does not collide with the graph key for the same id', () => {
		expect(snapshotStorageKey('mind-map', 'g1')).not.toBe('mind-map:graph:g1');
	});
});

describe('writeGraphSnapshot / readGraphSnapshot', () => {
	it('round-trips the graph, view state, label and creation time', () => {
		const storage = new MemoryStorage();
		const data = makeGraph({ nodeCount: 2, edges: [[0, 1]], pinned: [0] });
		const viewState = { panX: 10, panY: -5, scale: 1.25 };

		expect(writeGraphSnapshot('g1', { data, viewState, label: 'import' }, options(storage))).toBe(
			true
		);
		expect(readGraphSnapshot('g1', options(storage))).toEqual({
			data,
			viewState,
			label: 'import',
			createdAt: 1_000
		});
	});

	it('restores a graph that is equal to but independent of the live one', () => {
		const storage = new MemoryStorage();
		const data = makeGraph({ nodeCount: 1 });

		writeGraphSnapshot('g1', { data, label: 'import' }, options(storage));
		data.nodes.push(...makeGraph({ nodeCount: 1 }).nodes);

		expect(readGraphSnapshot('g1', options(storage))?.data.nodes).toHaveLength(1);
	});

	it('omits view state when the caller did not supply one', () => {
		const storage = new MemoryStorage();

		writeGraphSnapshot(
			'g1',
			{ data: makeGraph({ nodeCount: 1 }), label: 'import' },
			options(storage)
		);

		expect(readGraphSnapshot('g1', options(storage))).not.toHaveProperty('viewState');
	});

	it('stores a versioned envelope under the snapshot key', () => {
		const storage = new MemoryStorage();

		writeGraphSnapshot(
			'g1',
			{ data: makeGraph({ nodeCount: 1 }), label: 'import' },
			options(storage)
		);

		expect(JSON.parse(storage.getItem(snapshotStorageKey('test', 'g1')) ?? '{}')).toMatchObject({
			snapshotVersion: SNAPSHOT_ENVELOPE_VERSION,
			schemaVersion: CURRENT_SCHEMA_VERSION,
			createdAt: 1_000,
			label: 'import'
		});
	});

	it('defaults to the app storage namespace', () => {
		const storage = new MemoryStorage();

		writeGraphSnapshot(
			'g1',
			{ data: makeGraph({ nodeCount: 1 }), label: 'import' },
			{ storage, now: () => 1_000 }
		);

		expect(
			storage.getItem(snapshotStorageKey(APP_CONFIG.persistence.storageNamespace, 'g1'))
		).not.toBeNull();
	});

	it('keeps one snapshot per graph id, so a second write replaces the first', () => {
		const storage = new MemoryStorage();
		const first = makeGraph({ nodeCount: 1 });
		const second = makeGraph({ nodeCount: 3 });

		writeGraphSnapshot(
			'g1',
			{ data: first, label: 'import' },
			options(storage, () => 1_000)
		);
		writeGraphSnapshot(
			'g1',
			{ data: second, label: 'merge' },
			options(storage, () => 2_000)
		);

		expect(readGraphSnapshot('g1', options(storage))).toMatchObject({
			data: second,
			label: 'merge',
			createdAt: 2_000
		});
		expect(storage.length).toBe(1);
	});

	it('keeps snapshots for different graph ids apart', () => {
		const storage = new MemoryStorage();

		writeGraphSnapshot(
			'g1',
			{ data: makeGraph({ nodeCount: 1 }), label: 'import' },
			options(storage)
		);
		writeGraphSnapshot(
			'g2',
			{ data: makeGraph({ nodeCount: 2 }), label: 'import' },
			options(storage)
		);

		expect(readGraphSnapshot('g1', options(storage))?.data.nodes).toHaveLength(1);
		expect(readGraphSnapshot('g2', options(storage))?.data.nodes).toHaveLength(2);
	});

	it('reads as absent when nothing was written', () => {
		expect(readGraphSnapshot('g1', options(new MemoryStorage()))).toBeNull();
	});
});

describe('quota failures', () => {
	it('reports failure instead of throwing when the snapshot will not fit', () => {
		const storage = new MemoryStorage();
		storage.full = true;
		const write = () =>
			writeGraphSnapshot(
				'g1',
				{ data: makeGraph({ nodeCount: 1 }), label: 'import' },
				options(storage)
			);

		expect(write).not.toThrow();
		expect(write()).toBe(false);
		expect(readGraphSnapshot('g1', options(storage))).toBeNull();
	});

	it('leaves no snapshot behind, rather than a stale one offering the wrong revert', () => {
		const storage = new MemoryStorage();
		writeGraphSnapshot(
			'g1',
			{ data: makeGraph({ nodeCount: 1 }), label: 'import' },
			options(storage)
		);

		storage.full = true;

		expect(
			writeGraphSnapshot(
				'g1',
				{ data: makeGraph({ nodeCount: 9 }), label: 'import' },
				options(storage)
			)
		).toBe(false);
		expect(readGraphSnapshot('g1', options(storage))).toBeNull();
	});

	it('does not disturb anything else the storage holds', () => {
		const storage = new MemoryStorage();
		storage.setItem('test:graph:g1', 'the saved graph');
		storage.full = true;

		writeGraphSnapshot(
			'g1',
			{ data: makeGraph({ nodeCount: 1 }), label: 'import' },
			options(storage)
		);

		expect(storage.getItem('test:graph:g1')).toBe('the saved graph');
	});
});

describe('unusable stored snapshots', () => {
	it('reads malformed JSON as absent', () => {
		const storage = new MemoryStorage();
		storage.setItem(snapshotStorageKey('test', 'g1'), '{not json');

		expect(readGraphSnapshot('g1', options(storage))).toBeNull();
	});

	it('reads an envelope from another snapshot version as absent', () => {
		const storage = new MemoryStorage();
		storage.setItem(
			snapshotStorageKey('test', 'g1'),
			JSON.stringify({
				snapshotVersion: SNAPSHOT_ENVELOPE_VERSION + 1,
				schemaVersion: CURRENT_SCHEMA_VERSION,
				createdAt: 1,
				label: 'import',
				data: makeGraph({ nodeCount: 1 })
			})
		);

		expect(readGraphSnapshot('g1', options(storage))).toBeNull();
	});

	it('reads an envelope from another graph schema version as absent', () => {
		const storage = new MemoryStorage();
		storage.setItem(
			snapshotStorageKey('test', 'g1'),
			JSON.stringify({
				snapshotVersion: SNAPSHOT_ENVELOPE_VERSION,
				schemaVersion: CURRENT_SCHEMA_VERSION - 1,
				createdAt: 1,
				label: 'import',
				data: makeGraph({ nodeCount: 1 })
			})
		);

		expect(readGraphSnapshot('g1', options(storage))).toBeNull();
	});

	it('reads an envelope whose graph data is not a graph as absent', () => {
		const storage = new MemoryStorage();
		storage.setItem(
			snapshotStorageKey('test', 'g1'),
			JSON.stringify({
				snapshotVersion: SNAPSHOT_ENVELOPE_VERSION,
				schemaVersion: CURRENT_SCHEMA_VERSION,
				createdAt: 1,
				label: 'import',
				data: { nodes: 'all of them' }
			})
		);

		expect(readGraphSnapshot('g1', options(storage))).toBeNull();
	});

	it('drops a malformed view state but keeps the graph', () => {
		const storage = new MemoryStorage();
		const data = makeGraph({ nodeCount: 1 });
		storage.setItem(
			snapshotStorageKey('test', 'g1'),
			JSON.stringify({
				snapshotVersion: SNAPSHOT_ENVELOPE_VERSION,
				schemaVersion: CURRENT_SCHEMA_VERSION,
				createdAt: 1,
				label: 'import',
				data,
				viewState: { panX: 'far', panY: 0, scale: 1 }
			})
		);

		expect(readGraphSnapshot('g1', options(storage))).toEqual({
			data,
			label: 'import',
			createdAt: 1
		});
	});

	it('reads as absent when storage refuses the read', () => {
		expect(readGraphSnapshot('g1', options(new UnreadableStorage()))).toBeNull();
	});
});

describe('clearGraphSnapshot', () => {
	it('forgets the snapshot for one graph and leaves the others', () => {
		const storage = new MemoryStorage();
		writeGraphSnapshot(
			'g1',
			{ data: makeGraph({ nodeCount: 1 }), label: 'import' },
			options(storage)
		);
		writeGraphSnapshot(
			'g2',
			{ data: makeGraph({ nodeCount: 2 }), label: 'import' },
			options(storage)
		);

		clearGraphSnapshot('g1', options(storage));

		expect(readGraphSnapshot('g1', options(storage))).toBeNull();
		expect(readGraphSnapshot('g2', options(storage))).not.toBeNull();
	});

	it('is silent when there is no snapshot', () => {
		expect(() => clearGraphSnapshot('g1', options(new MemoryStorage()))).not.toThrow();
	});
});

describe('without storage', () => {
	it('reports write failure and reads as absent when storage is unavailable', () => {
		expect(
			writeGraphSnapshot(
				'g1',
				{ data: makeGraph({ nodeCount: 1 }), label: 'import' },
				options(null)
			)
		).toBe(false);
		expect(readGraphSnapshot('g1', options(null))).toBeNull();
		expect(() => clearGraphSnapshot('g1', options(null))).not.toThrow();
	});

	it('falls back to the ambient storage, which is absent outside a browser', () => {
		// This spec runs in the node project, so there is no global localStorage:
		// the ambient lookup must degrade to "no snapshot" rather than throwing.
		expect(readGraphSnapshot('g1', { namespace: 'test' })).toBeNull();
	});
});
