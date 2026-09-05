import { describe, expect, it } from 'vitest';
import {
	MemoryGraphAssetStore,
	type AssetStoreResult,
	type GraphAssetStore,
	type StoredGraphAsset
} from './assetStore';
import { sweepAssetTrash, tombstoneAsset } from './assetTrash';

const SCOPE = 'graph-1';

async function storeWith(...assetIds: string[]): Promise<MemoryGraphAssetStore> {
	const store = new MemoryGraphAssetStore();
	for (const assetId of assetIds) {
		await store.put({
			scope: SCOPE,
			assetId,
			blob: new Blob([assetId]),
			mimeType: 'image/png',
			size: assetId.length,
			updatedAt: 0
		});
	}
	return store;
}

const ids = async (store: GraphAssetStore): Promise<string[]> => {
	const listed = await store.list(SCOPE);
	return listed.ok ? listed.value.map((asset) => asset.assetId).sort() : [];
};

/** A store that refuses every read, like a browser blocking site data. */
class UnreadableStore implements GraphAssetStore {
	async put(): Promise<AssetStoreResult> {
		throw new Error('Access to storage is denied.');
	}

	async get(): Promise<AssetStoreResult<StoredGraphAsset>> {
		throw new Error('Access to storage is denied.');
	}

	async delete(): Promise<AssetStoreResult> {
		throw new Error('Access to storage is denied.');
	}

	async deleteUnreferenced(): Promise<AssetStoreResult<string[]>> {
		throw new Error('Access to storage is denied.');
	}

	async list(): Promise<AssetStoreResult<StoredGraphAsset[]>> {
		throw new Error('Access to storage is denied.');
	}
}

describe('tombstoneAsset', () => {
	it('leaves a tombstoned blob readable, so an undo can still resolve it', async () => {
		const store = await storeWith('a1');

		const marked = await tombstoneAsset(store, SCOPE, 'a1', () => 100);

		expect(marked.ok).toBe(true);
		const stored = await store.get(SCOPE, 'a1');
		expect(stored.ok && stored.value.trashedAt).toBe(100);
		expect(stored.ok && stored.value.blob.size).toBeGreaterThan(0);
	});

	it('succeeds when the blob is already gone', async () => {
		const store = await storeWith();

		expect((await tombstoneAsset(store, SCOPE, 'missing')).ok).toBe(true);
	});

	it('keeps the first tombstone time when marked twice', async () => {
		const store = await storeWith('a1');
		await tombstoneAsset(store, SCOPE, 'a1', () => 100);

		await tombstoneAsset(store, SCOPE, 'a1', () => 500);

		const stored = await store.get(SCOPE, 'a1');
		expect(stored.ok && stored.value.trashedAt).toBe(100);
	});

	it('reports failure rather than throwing on a store that refuses access', async () => {
		const result = await tombstoneAsset(new UnreadableStore(), SCOPE, 'a1');

		expect(result.ok).toBe(false);
	});
});

describe('sweepAssetTrash', () => {
	it('deletes a tombstoned blob nothing live names', async () => {
		const store = await storeWith('a1');
		await tombstoneAsset(store, SCOPE, 'a1', () => 1);

		const swept = await sweepAssetTrash(store, SCOPE, new Set());

		expect(swept.ok && swept.value).toEqual(['a1']);
		expect(await ids(store)).toEqual([]);
	});

	it('keeps a tombstoned blob some surviving entry still names, and revives it', async () => {
		const store = await storeWith('a1');
		await tombstoneAsset(store, SCOPE, 'a1', () => 1);

		const swept = await sweepAssetTrash(store, SCOPE, new Set(['a1']));

		expect(swept.ok && swept.value).toEqual([]);
		const stored = await store.get(SCOPE, 'a1');
		expect(stored.ok && stored.value.trashedAt).toBeUndefined();
	});

	it('never touches a blob that was not tombstoned', async () => {
		const store = await storeWith('a1', 'a2');
		await tombstoneAsset(store, SCOPE, 'a2', () => 1);

		await sweepAssetTrash(store, SCOPE, new Set());

		expect(await ids(store)).toEqual(['a1']);
	});

	it('leaves another scope alone', async () => {
		const store = await storeWith('a1');
		await store.put({
			scope: 'other-graph',
			assetId: 'a1',
			blob: new Blob(['x']),
			mimeType: 'image/png',
			size: 1,
			updatedAt: 0,
			trashedAt: 1
		});
		await tombstoneAsset(store, SCOPE, 'a1', () => 1);

		await sweepAssetTrash(store, SCOPE, new Set());

		expect((await store.get('other-graph', 'a1')).ok).toBe(true);
	});

	it('reports failure rather than throwing on a store that refuses access', async () => {
		const result = await sweepAssetTrash(new UnreadableStore(), SCOPE, new Set());

		expect(result.ok).toBe(false);
	});
});
