# Plan: Import a graph, and merge nodes by hand

**Created:** 2026-08-29
**Author:** Claude agent
**Milestone:** none — closes the two backlog lines at
[TODO.md:121-122](../../TODO.md) ("Import another graph into current graph (as a
disconnected beacon node) / Maybe need a way to merge nodes?")
**Status:** done
**Total estimated effort:** L

## Summary

Let a graph absorb another graph's contents as a separate component, give the
reader one honest way back out of that (a revert that says how far back it
goes), and make node merging a deliberate hand gesture rather than something an
import guesses at.

## Open questions resolved

- **Does import merge anything automatically?** **No.** The original sketch had
  a "merge nodes with the same title" checkbox on the import dialog. It was
  dropped: title matching has no good answer when a title appears twice on
  either side (legal and common today — nothing constrains titles, and
  `normalizeNodeTitle` only trims), and a merge that fires during an import
  hides a destructive edit inside an additive one. Import is now purely
  additive, and merging is a separate gesture the reader aims by hand. This is
  also what makes merging useful beyond import — it is how accidental
  near-duplicates get cleaned up regardless of where they came from.

- **Which node survives a merge?** **The drop target.** The gesture drags from
  the node being absorbed onto the node that remains, matching the "drag a file
  into a folder" reading. The survivor keeps its id, its position, and its
  title; the dragged node's content is folded in and the node disappears.

- **What happens to two non-empty descriptions?** **Concatenate them, separated
  by a blank line.** Keeping only the survivor's silently deletes prose the
  reader wrote; concatenating is ugly but recoverable in the edit sheet, and a
  merge is a deliberate act, so the reader is already right there. This also
  keeps the confirmation gate below meaningful: description merging is never
  lossy, so it never needs to ask.

- **What happens when merged edges disagree about direction?** **The survivor's
  edge wins, but only after telling the reader how many edges that affects and
  getting a confirmation.** Silent direction rewriting is the one genuinely
  lossy part of a merge, so it is the one part that stops and asks. A merge with
  no direction conflicts commits immediately with no dialog.

- **Will an imported component drift far from the graph?** **Accepted risk, not
  designed around.** Disconnected components get `hops = Infinity`, which
  `hopRepulsionProgress` clamps to `maxHops` — i.e. maximum repulsion
  ([physics.ts:406](../../../../apps/mind-map-sv/src/lib/components/ui/Multigraph/lib/physics.ts)),
  the known wart already logged in TODO.md. We place the import at a sensible
  offset and let relaxation do what it does. If it flings the component too far
  in practice, that is a physics fix, not an import fix.

- **Should imported quantity symbols connect to existing ones?** **Yes — this is
  wanted, not a leak.** `deriveDataflowEdges` synthesizes `dataflow:` edges
  between any definer and any consumer of the same symbol key, so an import that
  shares a symbol with the host graph will wire itself in on the next render.
  The component is "disconnected" in the sense that no _authored_ edge crosses
  the seam. No warning copy is needed.

- **How long does the revert offer last?** **Until the reader closes it**, and it
  survives reload — the snapshot is persisted next to the graph, not held in
  memory. The banner states the snapshot's age so the reader knows how far back
  they are going, and reverting requires its own confirmation, because edits made
  _since_ the import are lost too. Closing the banner discards the snapshot.

- **What is the toolbar entry called?** **"Import…"**, sitting beside New / Open
  / Download. Noted for later: TODO.md:53 plans to rename this toolbar to New /
  Load / Save / Settings, at which point this becomes "Import" next to "Load".

## Out of scope (for this plan)

- **Importing from another graph already in `localStorage`.** The controller
  already exposes `graphSummaries` / `selectGraph` (unused outside the Storybook
  harness), but there is no graph-switcher UI in the app, and building one is its
  own project. Import here means import _from a file_, reusing the existing
  picker.
- **General undo/redo.** The snapshot in T07 is a single-operation escape hatch
  for import, not a history stack. It is written as a generic util so a future
  undo could reuse it, but only import wires it up.
- **Merging more than two nodes at once**, and any bulk "find duplicates" review
  UI. One gesture, two nodes.
- **Fixing disconnected-component repulsion** (see the accepted risk above).

## Tasks

### T01 — `planNodeMerge` pure transform

|                |                                                            |
| -------------- | ---------------------------------------------------------- |
| **Depends on** | —                                                          |
| **Wave**       | 1                                                          |
| **Agent**      | Opus subagent                                              |
| **Effort**     | M                                                          |
| **Files**      | new `Multigraph/lib/nodeMerge.ts`, new `nodeMerge.spec.ts` |
| **PR title**   | `feat(graph): add planNodeMerge pure transform`            |

A dry-run-and-commit in one call, so the dialog and the commit can never
disagree about what a merge does:

```ts
planNodeMerge(data, absorbedId, survivorId): {
	next: MultigraphData;
	directionConflicts: EdgeConflict[];   // absorbed edges whose direction is discarded
	droppedSelfEdgeId: string | null;     // the absorbed--survivor edge, if any
}
```

Field rules on the survivor: `title` and `id` unchanged; `description`
concatenated (blank-line separated, skipping empties); `tags` unioned preserving
survivor order; `inputs`/`outputs` unioned and deduped by symbol key
(`base` + `subscript`); `content` blocks appended; `pinned` is the OR of the two;
`lastPinnedSeq` is the max. Delete the absorbed node's `posByNodeId` entry.

Edge rules, for each edge incident to the absorbed node:

- The `absorbed--survivor` edge itself becomes a self-loop → drop it, and report
  its id.
- No existing survivor-side counterpart → rewrite the endpoint, preserving
  orientation.
- An existing counterpart → collapse into the survivor's edge, union the tags,
  keep the survivor's direction, and record a conflict **only** when the absorbed
  edge asserted a direction the result will not carry: the two point opposite
  ways, or the absorbed edge was directed and the survivor's is not. An absorbed
  _undirected_ edge folding into a directed one is not a conflict — it discards
  no assertion.

Never emit an id with the `dataflow:` prefix; derived edges are recomputed, never
merged.

**Acceptance**

- Spec covers immutability (input object identity unchanged).
- Each of the direction sub-cases above gets a named test, including the two that
  must _not_ report a conflict.
- Merging two adjacent nodes drops exactly one edge and leaves no self-loop.
- `next` is identical whether or not the caller inspects the conflicts.
- Merging a node with itself is a no-op.

### T02 — Merge gesture

|                |                                                                       |
| -------------- | --------------------------------------------------------------------- |
| **Depends on** | T01                                                                   |
| **Wave**       | 2                                                                     |
| **Agent**      | Opus subagent                                                         |
| **Effort**     | M                                                                     |
| **Files**      | `Multigraph.svelte`, `NodeActionMenu.svelte`, `Stage.svelte`, stories |
| **PR title**   | `feat(multigraph): merge a node into another by gesture`              |

Add a `Merge` entry to `NodeActionMenu` and arm the same drag-from-node skeleton
`armCreationGesture` uses (`Multigraph.svelte:926` — arm request, live preview,
hover hit test), under a mode flag. Drop on a node commits the merge; drop on
background cancels; drop on self cancels. The preview should read as "absorb
into", visually distinct from the add-node/edge preview.

**Acceptance**

- Story: reader opens the menu on N1, chooses Merge, drags to N2 → N1 is gone and
  N2 carries both tag sets.
- Story: same gesture released over background → nothing changes.
- The existing add-node/edge gesture stories still pass unchanged.

### T03 — Merge confirmation for direction loss

|                |                                                                  |
| -------------- | ---------------------------------------------------------------- |
| **Depends on** | T02                                                              |
| **Wave**       | 3                                                                |
| **Agent**      | default                                                          |
| **Effort**     | S                                                                |
| **Files**      | new `MergeConfirmDialog.svelte`, `Multigraph.svelte`, stories    |
| **PR title**   | `feat(multigraph): confirm merges that overwrite edge direction` |

Model it on `DuplicateEdgeDialog.svelte` (same backdrop, `role="dialog"`,
`aria-modal`, 44px targets). Shown only when `directionConflicts` is non-empty,
with the count stated plainly — "3 edges will lose their direction." Cancel
leaves the graph untouched.

**Acceptance**

- Story: a merge with no conflicts commits with no dialog.
- Story: a merge with conflicts shows the count, and Cancel is a true no-op.
- The count in the dialog always equals the number of edges actually changed.

### T04 — `importGraphData` id remapping and union

|                |                                                      |
| -------------- | ---------------------------------------------------- |
| **Depends on** | —                                                    |
| **Wave**       | 1                                                    |
| **Agent**      | Opus subagent                                        |
| **Effort**     | L                                                    |
| **Files**      | new `lib/graphImport.ts`, new `graphImport.spec.ts`  |
| **PR title**   | `feat(graph): add importGraphData with id remapping` |

Fold one `MultigraphData` into another. Ids are per-graph sequential (`n0`, `e0`
from `nextId`) and every graph starts with `n0`, so **collision is guaranteed**
and remapping is not optional — nothing validates id uniqueness on load, so a
naive concat corrupts silently.

Build a `Map` from incoming id to a freshly minted host id, then apply it to:
node ids, `edges[].sourceNodeId` / `targetNodeId`, and the keys of
`posByNodeId`. Translate incoming positions by an offset that clears the host
graph's bounding box. Rebase `pinSequence` — offset every incoming
`lastPinnedSeq` past the host's current counter, so pin recency (which decides
beacon election) stays ordered. Union `tagColorConfig` with the host winning any
tag-name collision; unset tags fall back to a deterministic hash color anyway.
Union the `assets` metadata map (asset ids are UUIDs — no remap needed).

**Acceptance**

- Spec: importing a graph into itself yields 2× the nodes, no duplicate ids, and
  every edge still resolves to a real node.
- Spec: every node has a `posByNodeId` entry, and no orphan keys remain.
- Spec: host tag colors survive a collision; incoming-only tags are added.
- Spec: incoming `lastPinnedSeq` values all exceed the host's prior maximum, and
  their relative order is preserved.
- Property-style check: no id in the result appears twice.

### T05 — Cross-scope asset copy

|                |                                                                      |
| -------------- | -------------------------------------------------------------------- |
| **Depends on** | T04                                                                  |
| **Wave**       | 2                                                                    |
| **Agent**      | Opus subagent                                                        |
| **Effort**     | M                                                                    |
| **Files**      | `lib/assets/assetStore.ts`, `graphPersistenceController.ts`          |
| **PR title**   | `feat(assets): copy embedded assets without sweeping the host scope` |

Image blobs live in IndexedDB keyed `${scope}:${assetId}`, scoped per graph, so
imported image nodes need their blobs copied into the host scope. The existing
`hydrateEmbeddedAssets` ends with `deleteUnreferenced(scope, referencedAssetIds(doc.data))`
— reused as-is for an additive import, **that would garbage-collect the host
graph's own images**. Add a merge-aware variant that hydrates without sweeping,
or that sweeps against the union of both documents' referenced ids.

**Acceptance**

- Test: importing a document with assets into a graph that already has assets
  leaves both sets retrievable.
- Test: the existing replace-import path still sweeps exactly as it does today.

### T06 — Import entry point and toolbar

|                |                                                                                 |
| -------------- | ------------------------------------------------------------------------------- |
| **Depends on** | T04, T05, T07                                                                   |
| **Wave**       | 3                                                                               |
| **Agent**      | Opus subagent                                                                   |
| **Effort**     | M                                                                               |
| **Files**      | `graphPersistenceController.ts`, `GraphToolbar.svelte`, `+page.svelte`, stories |
| **PR title**   | `feat(persistence): import a graph file into the current graph`                 |

Add `importGraphIntoCurrent(text)` alongside the existing replacing
`importGraphDocument`. Parse with the existing `parseGraphFileText` + migration
path (so every schema version 1–6 imports), snapshot via T07, fold with T04,
hydrate assets with T05, then commit through the normal
`commitUserGraph` → autosave path. Reuse the existing picker
(`openHtmlFilePickerInNewTab`). Unlike replace, this must **not** bump
`graphGeneration` — remounting would throw away the reader's pan/zoom and focus
for what is an additive edit.

**Acceptance**

- Story/test: importing into a non-empty graph preserves every pre-existing node
  and adds the incoming ones.
- Importing a v1-era file still works.
- View state (pan/zoom) is unchanged across an import.
- A malformed file surfaces the existing `PersistedGraphError` copy and changes
  nothing.

### T07 — Pre-import snapshot store

|                |                                                        |
| -------------- | ------------------------------------------------------ |
| **Depends on** | —                                                      |
| **Wave**       | 1                                                      |
| **Agent**      | default                                                |
| **Effort**     | S                                                      |
| **Files**      | new `lib/graphSnapshot.ts`, new spec                   |
| **PR title**   | `feat(persistence): store a revertible graph snapshot` |

Write/read/clear one snapshot per graph id in `localStorage`, keyed off
`graphStorageKey`, holding the serialized pre-operation graph plus `createdAt`
and a short operation label. Quota-aware, like `saveScheduler` — a snapshot that
will not fit is dropped rather than failing the operation it guards.

**Acceptance**

- Round-trips a graph through write → read → restore unchanged.
- Writing a second snapshot replaces the first.
- A quota failure leaves the graph save itself unaffected.

### T08 — Revert banner

|                |                                                    |
| -------------- | -------------------------------------------------- |
| **Depends on** | T06, T07                                           |
| **Wave**       | 4                                                  |
| **Agent**      | Opus subagent                                      |
| **Effort**     | M                                                  |
| **Files**      | new `RevertBanner.svelte`, `+page.svelte`, stories |
| **PR title**   | `feat(persistence): offer a revert after import`   |

A persistent banner shown whenever a snapshot exists: what happened ("Imported 14
nodes"), a Revert action, and a dismiss. Because the snapshot outlives a reload,
the banner must state the snapshot's **age** ("from 5 minutes ago"), recomputed
as it sits. Revert opens its own confirmation that repeats the age and warns that
changes made since the import are lost too. Dismiss clears the snapshot.

**Acceptance**

- Story: banner appears after import, survives a reload, and the age label
  updates.
- Story: Revert → confirm restores the pre-import graph exactly; Revert → cancel
  changes nothing.
- Dismiss clears the snapshot and the banner does not return.
- Reverting an import that added assets does not delete the host's own assets.

## Wave plan

```
Wave 1   T01  ‖  T04  ‖  T07     (three pure/isolated modules, no shared files)
Wave 2   T02  ‖  T05             (T02←T01, T05←T04)
Wave 3   T03  ‖  T06             (T03←T02; T06←T04,T05,T07)
Wave 4   T08                     (integration; ←T06,T07)
```

Total: 8 tasks, 4 gates. The merge track (T01→T02→T03) and the import track
(T04→T05→T06→T08) are independent all the way to the end — the merge gesture
ships on its own if import slips, and vice versa.

Sequencing note: T02, T03, T06 and T08 all touch `Multigraph.svelte` or
`+page.svelte`. They are in different waves by design; do not parallelize a
merge-track and an import-track task that both edit those two files.

## Risks and rollback

- **T02's gesture is a second mode on machinery built for one.**
  `armCreationGesture` and `creationPreview` currently assume "create". If the
  mode flag starts leaking into the preview math, stop and extract the shared
  arm/preview/hit-test skeleton first rather than threading booleans through it.
- **Import has no undo of its own until T08 lands.** T06 is therefore not
  shippable to a real reader before T08 — it can merge behind the wave order, but
  the toolbar button should not appear without the banner. Keep the button behind
  T08 if the waves land out of order.
- **`deleteUnreferenced` is the sharpest edge in the whole plan.** Getting T05
  wrong destroys reader data (host images) rather than merely annoying them. It
  wants a test that asserts host assets survive, written before the change.
- **Merging is irreversible and the snapshot util exists.** If merge turns out to
  be scarier in practice than the direction-conflict dialog covers, T07 is
  already generic enough to wrap it. Deliberately not wired now: a banner after
  every merge would be noise, and the confirmation already gates the lossy case.

## Definition of Done (this plan)

- All 8 tasks merged, plan status `done`.
- TODO.md:121-122 removed, since this closes both lines.
- The finished work has been committed unless the user explicitly asked not to.

## Notes

- 2026-08-29: The self-loop dropped when merging two adjacent nodes is real edge
  loss but is not counted as a direction conflict, so it will not by itself raise
  the dialog. That matches the decision as stated ("edge direction overwritten").
  If it turns out readers are surprised by the edge between two merged nodes
  vanishing, the dialog copy is the place to mention it — `planNodeMerge` already
  reports `droppedSelfEdgeId` for exactly that.
- 2026-08-29: `withSeededComponentPins` only runs when a graph loads with no pins
  at all, so it will not fire on an import. An imported pinless component
  therefore relies on beacon election for visibility, which is the behavior
  TODO.md:121 asked for ("as a disconnected beacon node"). Worth an eyes-on check
  during T06 that the imported component actually gets a beacon.
