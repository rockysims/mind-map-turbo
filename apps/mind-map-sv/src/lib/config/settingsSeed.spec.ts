import { describe, expect, it } from 'vitest';
import type { StorageLike } from '../persistence';
import {
	clearSettingsSeed,
	readSettingsSeed,
	settingsSeedStorageKey,
	writeSettingsSeed
} from './settingsSeed';

const NAMESPACE = 'mind-map';

/** A minimal in-memory `StorageLike`, so these specs need no real `localStorage`. */
function makeStorage(initial: Record<string, string> = {}): StorageLike {
	const store = new Map(Object.entries(initial));
	return {
		getItem: (key) => store.get(key) ?? null,
		setItem: (key, value) => {
			store.set(key, value);
		},
		removeItem: (key) => {
			store.delete(key);
		},
		key: (index) => [...store.keys()][index] ?? null,
		get length() {
			return store.size;
		}
	};
}

describe('settingsSeedStorageKey', () => {
	it('namespaces below the graph key prefix so the two can never collide', () => {
		expect(settingsSeedStorageKey(NAMESPACE)).toBe('mind-map:settings-seed');
	});
});

describe('readSettingsSeed', () => {
	it('returns an empty map when nothing has been saved', () => {
		expect(readSettingsSeed(makeStorage(), NAMESPACE)).toEqual({});
	});

	it('returns a saved sparse override map', () => {
		const storage = makeStorage({
			[settingsSeedStorageKey(NAMESPACE)]: JSON.stringify({
				'multigraph.layout.scaleFalloff': 0.4
			})
		});
		expect(readSettingsSeed(storage, NAMESPACE)).toEqual({
			'multigraph.layout.scaleFalloff': 0.4
		});
	});

	it('sanitizes a saved blob, dropping unknown paths rather than throwing', () => {
		const storage = makeStorage({
			[settingsSeedStorageKey(NAMESPACE)]: JSON.stringify({
				'multigraph.layout.scaleFalloff': 0.4,
				'not.a.real.setting': 3
			})
		});
		expect(readSettingsSeed(storage, NAMESPACE)).toEqual({
			'multigraph.layout.scaleFalloff': 0.4
		});
	});

	it('reads unparseable JSON back as no seed at all', () => {
		const storage = makeStorage({ [settingsSeedStorageKey(NAMESPACE)]: 'not json' });
		expect(readSettingsSeed(storage, NAMESPACE)).toEqual({});
	});

	it('reads a non-object blob back as no seed at all', () => {
		const storage = makeStorage({ [settingsSeedStorageKey(NAMESPACE)]: JSON.stringify('nope') });
		expect(readSettingsSeed(storage, NAMESPACE)).toEqual({});
	});
});

describe('writeSettingsSeed', () => {
	it('saves a sparse override map under the namespaced key', () => {
		const storage = makeStorage();
		writeSettingsSeed(storage, NAMESPACE, { 'multigraph.layout.scaleFalloff': 0.4 });
		expect(readSettingsSeed(storage, NAMESPACE)).toEqual({
			'multigraph.layout.scaleFalloff': 0.4
		});
	});

	it('clears the key instead of writing `{}` for an empty map', () => {
		const storage = makeStorage({
			[settingsSeedStorageKey(NAMESPACE)]: JSON.stringify({
				'multigraph.layout.scaleFalloff': 0.4
			})
		});
		writeSettingsSeed(storage, NAMESPACE, {});
		expect(storage.getItem(settingsSeedStorageKey(NAMESPACE))).toBeNull();
	});
});

describe('clearSettingsSeed', () => {
	it('removes a saved seed', () => {
		const storage = makeStorage({
			[settingsSeedStorageKey(NAMESPACE)]: JSON.stringify({
				'multigraph.layout.scaleFalloff': 0.4
			})
		});
		clearSettingsSeed(storage, NAMESPACE);
		expect(readSettingsSeed(storage, NAMESPACE)).toEqual({});
	});

	it('changing or clearing the seed never touches a graph that already copied it', () => {
		// This is the property that matters: the seed is stamped at creation
		// (graphPersistenceController.createGraph), not read as a live layer. A
		// graph's own overrides, once created, are just a plain `ConfigOverrides`
		// map with no reference back to the seed at all, so there is nothing here
		// for a later seed change to reach into. Modeled directly:
		const storage = makeStorage();
		writeSettingsSeed(storage, NAMESPACE, { 'multigraph.layout.scaleFalloff': 0.4 });

		// A graph "stamps" the seed by copying it at creation time.
		const graphOverridesAtCreation = { ...readSettingsSeed(storage, NAMESPACE) };

		// The seed changes later...
		writeSettingsSeed(storage, NAMESPACE, { 'multigraph.layout.scaleFalloff': 0.9 });
		// ...and is cleared entirely.
		clearSettingsSeed(storage, NAMESPACE);

		// The graph's own copy is untouched.
		expect(graphOverridesAtCreation).toEqual({ 'multigraph.layout.scaleFalloff': 0.4 });
	});
});
