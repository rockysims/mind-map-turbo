import { describe, expect, it } from 'vitest';
import { estimateNamespaceUsageBytes } from './persistence';
import {
	MemoryStorage,
	resolveGraphStorage,
	STORAGE_PROBE_KEY,
	type StorageDurability
} from './storageAvailability';

function workingStorage(): Storage {
	return new MemoryStorage() as unknown as Storage;
}

describe('resolveGraphStorage', () => {
	it('falls back to memory when the storage getter itself throws', () => {
		const resolution = resolveGraphStorage(() => {
			throw new Error('blocked');
		});

		expect(resolution).toMatchObject<{ durability: StorageDurability; reason: string }>({
			durability: 'memory-only',
			reason: 'blocked'
		});
		expect(resolution.storage).toBeInstanceOf(MemoryStorage);
	});

	it('falls back to memory when the storage object is missing', () => {
		const resolution = resolveGraphStorage(() => null as unknown as Storage);

		expect(resolution.durability).toBe('memory-only');
		expect(resolution.storage).toBeInstanceOf(MemoryStorage);
	});

	it('falls back to memory when writing throws', () => {
		const storage = workingStorage();
		storage.setItem = () => {
			throw new Error('quota exceeded');
		};

		const resolution = resolveGraphStorage(() => storage);

		expect(resolution).toMatchObject({ durability: 'memory-only', reason: 'quota exceeded' });
		expect(resolution.storage).not.toBe(storage);
	});

	it('falls back to memory when the probe reads back a different value', () => {
		const storage = workingStorage();
		storage.getItem = () => 'something else';

		const resolution = resolveGraphStorage(() => storage);

		expect(resolution.durability).toBe('memory-only');
		expect(resolution.storage).not.toBe(storage);
	});

	it('accepts working storage and leaves no probe key behind', () => {
		const storage = workingStorage();

		const resolution = resolveGraphStorage(() => storage);

		expect(resolution).toEqual({ storage, durability: 'durable' });
		expect(storage.getItem(STORAGE_PROBE_KEY)).toBeNull();
		expect(storage.length).toBe(0);
	});
});

describe('MemoryStorage', () => {
	it('round-trips values and removes them again', () => {
		const storage = new MemoryStorage();

		storage.setItem('a', 'first');
		expect(storage.getItem('a')).toBe('first');

		storage.setItem('a', 'second');
		expect(storage.getItem('a')).toBe('second');
		expect(storage.length).toBe(1);

		storage.removeItem('a');
		expect(storage.getItem('a')).toBeNull();
		expect(storage.length).toBe(0);
	});

	it('enumerates keys by index so namespace scans work', () => {
		const storage = new MemoryStorage();
		storage.setItem('mind-map:graph:one', 'a');
		storage.setItem('other:graph:two', 'bb');
		storage.setItem('mind-map:graph:three', 'ccc');

		expect(storage.key(0)).toBe('mind-map:graph:one');
		expect(storage.key(2)).toBe('mind-map:graph:three');
		expect(storage.key(3)).toBeNull();
		expect(storage.key(-1)).toBeNull();
		expect(estimateNamespaceUsageBytes(storage, 'mind-map')).toBe(
			('mind-map:graph:one'.length + 1) * 2 + ('mind-map:graph:three'.length + 3) * 2
		);
	});
});
