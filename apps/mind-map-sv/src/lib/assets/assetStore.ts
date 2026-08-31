export interface StoredGraphAsset {
	scope: string;
	assetId: string;
	blob: Blob;
	mimeType: string;
	name?: string;
	size: number;
	updatedAt: number;
}

export type AssetStoreResult<T = void> =
	| { ok: true; value: T }
	| {
			ok: false;
			reason: 'quota-exceeded' | 'unavailable' | 'not-found' | 'unknown';
			error?: unknown;
	  };

export interface GraphAssetStore {
	put(asset: StoredGraphAsset): Promise<AssetStoreResult>;
	get(scope: string, assetId: string): Promise<AssetStoreResult<StoredGraphAsset>>;
	delete(scope: string, assetId: string): Promise<AssetStoreResult>;
	deleteUnreferenced(scope: string, keepAssetIds: Set<string>): Promise<AssetStoreResult<string[]>>;
	list(scope: string): Promise<AssetStoreResult<StoredGraphAsset[]>>;
}

const DB_NAME = 'mind-map-assets';
const DB_VERSION = 1;
const STORE_NAME = 'assets';

export class IndexedDbGraphAssetStore implements GraphAssetStore {
	private dbPromise: Promise<IDBDatabase> | null = null;

	async put(asset: StoredGraphAsset): Promise<AssetStoreResult> {
		try {
			const db = await this.open();
			await requestToPromise(
				transactionStore(db, 'readwrite').put({
					...asset,
					key: assetKey(asset.scope, asset.assetId)
				})
			);
			return { ok: true, value: undefined };
		} catch (error) {
			return classifyAssetStoreError(error);
		}
	}

	async get(scope: string, assetId: string): Promise<AssetStoreResult<StoredGraphAsset>> {
		try {
			const db = await this.open();
			const record = await requestToPromise<(StoredGraphAsset & { key: string }) | undefined>(
				transactionStore(db, 'readonly').get(assetKey(scope, assetId))
			);
			if (!record) return { ok: false, reason: 'not-found' };
			return { ok: true, value: withoutKey(record) };
		} catch (error) {
			return classifyAssetStoreError(error);
		}
	}

	async delete(scope: string, assetId: string): Promise<AssetStoreResult> {
		try {
			const db = await this.open();
			await requestToPromise(transactionStore(db, 'readwrite').delete(assetKey(scope, assetId)));
			return { ok: true, value: undefined };
		} catch (error) {
			return classifyAssetStoreError(error);
		}
	}

	async deleteUnreferenced(
		scope: string,
		keepAssetIds: Set<string>
	): Promise<AssetStoreResult<string[]>> {
		const listed = await this.list(scope);
		if (!listed.ok) return listed;
		const removed: string[] = [];
		for (const asset of listed.value) {
			if (keepAssetIds.has(asset.assetId)) continue;
			const deleted = await this.delete(scope, asset.assetId);
			if (!deleted.ok) return deleted;
			removed.push(asset.assetId);
		}
		return { ok: true, value: removed };
	}

	async list(scope: string): Promise<AssetStoreResult<StoredGraphAsset[]>> {
		try {
			const db = await this.open();
			const records = await requestToPromise<Array<StoredGraphAsset & { key: string }>>(
				transactionStore(db, 'readonly').index('scope').getAll(scope)
			);
			return { ok: true, value: records.map(withoutKey) };
		} catch (error) {
			return classifyAssetStoreError(error);
		}
	}

	private open(): Promise<IDBDatabase> {
		if (typeof indexedDB === 'undefined') {
			return Promise.reject(new Error('IndexedDB is unavailable.'));
		}
		this.dbPromise ??= new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, DB_VERSION);
			request.onupgradeneeded = () => {
				const db = request.result;
				const store = db.objectStoreNames.contains(STORE_NAME)
					? request.transaction?.objectStore(STORE_NAME)
					: db.createObjectStore(STORE_NAME, { keyPath: 'key' });
				if (store && !store.indexNames.contains('scope')) {
					store.createIndex('scope', 'scope', { unique: false });
				}
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB.'));
		});
		return this.dbPromise;
	}
}

/** In-memory stand-in for specs, so asset behaviour is testable without IndexedDB. */
export class MemoryGraphAssetStore implements GraphAssetStore {
	private readonly records = new Map<string, StoredGraphAsset>();

	async put(asset: StoredGraphAsset): Promise<AssetStoreResult> {
		this.records.set(assetKey(asset.scope, asset.assetId), { ...asset });
		return { ok: true, value: undefined };
	}

	async get(scope: string, assetId: string): Promise<AssetStoreResult<StoredGraphAsset>> {
		const record = this.records.get(assetKey(scope, assetId));
		return record ? { ok: true, value: { ...record } } : { ok: false, reason: 'not-found' };
	}

	async delete(scope: string, assetId: string): Promise<AssetStoreResult> {
		this.records.delete(assetKey(scope, assetId));
		return { ok: true, value: undefined };
	}

	async deleteUnreferenced(
		scope: string,
		keepAssetIds: Set<string>
	): Promise<AssetStoreResult<string[]>> {
		const removed: string[] = [];
		const listed = await this.list(scope);
		if (!listed.ok) return listed;
		for (const asset of listed.value) {
			if (keepAssetIds.has(asset.assetId)) continue;
			this.records.delete(assetKey(scope, asset.assetId));
			removed.push(asset.assetId);
		}
		return { ok: true, value: removed };
	}

	async list(scope: string): Promise<AssetStoreResult<StoredGraphAsset[]>> {
		return {
			ok: true,
			value: [...this.records.values()]
				.filter((asset) => asset.scope === scope)
				.map((asset) => ({ ...asset }))
		};
	}
}

function assetKey(scope: string, assetId: string): string {
	return `${encodeURIComponent(scope)}:${encodeURIComponent(assetId)}`;
}

function classifyAssetStoreError(error: unknown): AssetStoreResult<never> {
	if (
		error instanceof DOMException &&
		(error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
	) {
		return { ok: false, reason: 'quota-exceeded', error };
	}
	if (error instanceof Error && error.message.includes('IndexedDB is unavailable')) {
		return { ok: false, reason: 'unavailable', error };
	}
	return { ok: false, reason: 'unknown', error };
}

function transactionStore(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
	return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

function requestToPromise<T = undefined>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
	});
}

function withoutKey(record: StoredGraphAsset & { key: string }): StoredGraphAsset {
	return {
		scope: record.scope,
		assetId: record.assetId,
		blob: record.blob,
		mimeType: record.mimeType,
		name: record.name,
		size: record.size,
		updatedAt: record.updatedAt
	};
}
