/**
 * Deferred blob deletion, so removing an image is an edit the history can honour.
 *
 * Removing an image used to call `assetStore.delete` inline, which made it the
 * one edit no undo could put back: the content block would return pointing at
 * nothing. Instead the blob stays and is *tombstoned* — marked unreferenced by
 * the document — and a sweep is what finally collects it, run only when the
 * history says no entry can reach it any more.
 *
 * The tombstone is a field on the stored record rather than a separate index:
 * one write, no second store to keep in step, and a blob that outlives a tab
 * crash carries its own status.
 *
 * Nothing here throws. A browser that refuses storage is exactly the case where
 * an image removal must still succeed as a document edit, so every function
 * reports failure the way the store does and leaves the caller's operation
 * alone — the same discipline `graphSnapshot.ts` states for its own writes.
 */

import type { AssetStoreResult, GraphAssetStore } from './assetStore';

/**
 * Mark a blob unreferenced without deleting it. Silently succeeds when the blob
 * is already gone: the caller's edit removed the block either way.
 */
export async function tombstoneAsset(
	store: GraphAssetStore,
	scope: string,
	assetId: string,
	now: () => number = Date.now
): Promise<AssetStoreResult> {
	try {
		const stored = await store.get(scope, assetId);
		if (!stored.ok) return stored.reason === 'not-found' ? { ok: true, value: undefined } : stored;
		if (stored.value.trashedAt !== undefined) return { ok: true, value: undefined };
		return await store.put({ ...stored.value, trashedAt: now() });
	} catch (error) {
		return { ok: false, reason: 'unknown', error };
	}
}

/**
 * Collect tombstoned blobs nothing can reach any more, and clear the tombstone
 * on any that came back.
 *
 * `liveAssetIds` is the union of what the document names now and what every
 * surviving history entry names — *both* sides of the stack, since a blob
 * referenced only by a redo entry is still one redo away from being on screen.
 * Untombstoned blobs are never touched: this is not `deleteUnreferenced`, and a
 * blob that was never removed by an edit is not this function's business.
 *
 * Returns the ids it deleted.
 */
export async function sweepAssetTrash(
	store: GraphAssetStore,
	scope: string,
	liveAssetIds: ReadonlySet<string>
): Promise<AssetStoreResult<string[]>> {
	try {
		const listed = await store.list(scope);
		if (!listed.ok) return listed;

		const deleted: string[] = [];
		for (const asset of listed.value) {
			if (asset.trashedAt === undefined) continue;
			if (liveAssetIds.has(asset.assetId)) {
				// Re-referenced: the tombstone is a lie now, so drop it rather than
				// leave the blob one sweep away from being collected under a live block.
				const revived = { ...asset };
				delete revived.trashedAt;
				await store.put(revived);
				continue;
			}
			const removed = await store.delete(scope, asset.assetId);
			if (removed.ok) deleted.push(asset.assetId);
		}

		return { ok: true, value: deleted };
	} catch (error) {
		return { ok: false, reason: 'unknown', error };
	}
}
