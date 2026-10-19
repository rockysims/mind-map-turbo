# A failed attachment write still reports a successful paste or import

**Created:** 2026-10-18
**Area:** `apps/mind-map-sv/src/lib/components/ui/Multigraph/Multigraph.svelte`
(`commitPaste`), `apps/mind-map-sv/src/lib/graphPersistenceController.ts`
(`hydrateImportedAssets`)
**Cost if ignored:** on a quota-exceeded or unavailable asset store, the pasted
or imported node lands pointing at bytes that were never stored; the image
draws as missing and the notice still says "Pasted 3 nodes."

## What we did

`commitPaste` awaits `store.put` for each new attachment before committing,
which is the right order, but ignores the result the way `hydrateImportedAssets`
always has. The attachment-adding paths in the edit sheet do check `stored.ok`
and report `'store-failed'`.

## Why

Paste mirrored the import path it reuses, and the import path has never
checked. Deciding what a half-stored paste should do — refuse the whole paste,
land the nodes without the blocks, or land them and say which attachments are
missing — is a product call that was out of scope for the plan.

## What paying it off looks like

Check each `put`'s result in both paths; on failure, drop the affected content
blocks from the incoming nodes (so nothing points at missing bytes) and say so
in the notice ("Pasted 3 nodes. 1 attachment could not be stored."). A story
with a `MemoryGraphAssetStore` that refuses with `quota-exceeded` proves it.
