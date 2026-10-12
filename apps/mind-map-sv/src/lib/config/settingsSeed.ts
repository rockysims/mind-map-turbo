import type { StorageLike } from '../persistence';
import { sanitizeOverrides, type ConfigOverrides } from './configOverrides';

/**
 * The "use as seed for new graphs" feature, backed by a single sparse blob in
 * `localStorage`. A new graph starts untuned; if a seed exists, it is stamped
 * into that graph's overrides **at creation only** — the seed is not a live
 * layer, so writing or clearing it later never retunes a graph that already
 * exists. Resolution order for any graph is `APP_CONFIG` -> that graph's own
 * overrides; the seed only ever contributes by being copied into the latter.
 *
 * A pure module over an injected `StorageLike` (the same abstraction
 * `persistence.ts` uses), so it needs no DOM and no mocking of the global
 * `localStorage` to test.
 */

/**
 * Storage key for `namespace`'s settings seed, one level below the graph keys
 * `persistence.ts` writes (`${namespace}:graph:${id}`) so the two can never
 * collide.
 */
export function settingsSeedStorageKey(namespace: string): string {
	return `${namespace}:settings-seed`;
}

/**
 * Reads the sparse settings seed saved for `namespace`, or `{}` if there is
 * none. Storage is untrusted the same way a graph file or another tab's write
 * is: unparseable JSON, a non-object blob, unknown paths and wrong-typed
 * values are all handled by `sanitizeOverrides` rather than thrown, so a
 * corrupted seed can never block graph creation.
 */
export function readSettingsSeed(storage: StorageLike, namespace: string): ConfigOverrides {
	const item = storage.getItem(settingsSeedStorageKey(namespace));
	if (item === null) return {};

	let raw: unknown;
	try {
		raw = JSON.parse(item);
	} catch {
		return {};
	}

	return sanitizeOverrides(raw).overrides;
}

/**
 * Writes `overrides` as the seed for `namespace`, sparse in and sparse out —
 * callers pass a graph's current overrides map directly. An empty map clears
 * the seed instead of writing `{}`, mirroring how an untuned graph omits its
 * own `settings` key everywhere else in the app.
 */
export function writeSettingsSeed(
	storage: StorageLike,
	namespace: string,
	overrides: ConfigOverrides
): void {
	if (Object.keys(overrides).length === 0) {
		clearSettingsSeed(storage, namespace);
		return;
	}
	storage.setItem(settingsSeedStorageKey(namespace), JSON.stringify(overrides));
}

/**
 * Clears the seed for `namespace`. Only affects future graph creation —
 * graphs that already stamped this (or an earlier) seed keep their own copy
 * untouched, because the seed is never read again after creation.
 */
export function clearSettingsSeed(storage: StorageLike, namespace: string): void {
	storage.removeItem(settingsSeedStorageKey(namespace));
}
