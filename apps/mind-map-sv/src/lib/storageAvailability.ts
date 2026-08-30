import type { StorageLike } from './persistence';

/**
 * Key used only to prove a storage round trip. Removed again immediately, so it
 * never appears in a namespace listing or a quota estimate.
 */
export const STORAGE_PROBE_KEY = 'mind-map:storage-probe';

export type StorageDurability = 'durable' | 'memory-only';

export type GraphStorageResolution = {
	storage: StorageLike;
	durability: StorageDurability;
	/** Why the durable storage was rejected; undefined when it was accepted. */
	reason?: string;
};

/**
 * Drop-in `StorageLike` that keeps values for the lifetime of the tab only.
 * Used when the browser blocks site data so the app still runs (in memory)
 * instead of dying on the first `localStorage` access.
 */
export class MemoryStorage implements StorageLike {
	private readonly entries = new Map<string, string>();

	get length(): number {
		return this.entries.size;
	}

	getItem(key: string): string | null {
		return this.entries.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		this.entries.set(key, String(value));
	}

	removeItem(key: string): void {
		this.entries.delete(key);
	}

	key(index: number): string | null {
		if (!Number.isInteger(index) || index < 0) return null;
		let position = 0;
		for (const key of this.entries.keys()) {
			if (position === index) return key;
			position += 1;
		}
		return null;
	}
}

/**
 * Resolve the storage the app should persist graphs into.
 *
 * Browsers configured to block site data (Chrome "Don't allow sites to save
 * data", Safari "Block all cookies", sandboxed iframes) throw from the
 * `window.localStorage` GETTER itself, so even reaching the object has to be
 * guarded. A working getter is still not proof of a working store, so the
 * resolution also round-trips a probe value before trusting it.
 */
export function resolveGraphStorage(
	getStorage: () => Storage = () => window.localStorage
): GraphStorageResolution {
	let storage: Storage;
	try {
		storage = getStorage();
	} catch (error) {
		return memoryOnly(resolutionReason(error));
	}

	if (storage === null || storage === undefined) {
		return memoryOnly('This browser did not provide local storage.');
	}

	try {
		const probeValue = `probe-${Date.now()}`;
		storage.setItem(STORAGE_PROBE_KEY, probeValue);
		const readBack = storage.getItem(STORAGE_PROBE_KEY);
		storage.removeItem(STORAGE_PROBE_KEY);
		if (readBack !== probeValue) {
			return memoryOnly('Local storage did not return the value it was given.');
		}
	} catch (error) {
		return memoryOnly(resolutionReason(error));
	}

	return { storage, durability: 'durable' };
}

function memoryOnly(reason: string): GraphStorageResolution {
	return { storage: new MemoryStorage(), durability: 'memory-only', reason };
}

function resolutionReason(error: unknown): string {
	return error instanceof Error ? error.message : 'Local storage is unavailable.';
}
