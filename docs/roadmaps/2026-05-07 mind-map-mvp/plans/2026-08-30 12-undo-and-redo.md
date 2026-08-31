# Plan: Undo and redo

**Created:** 2026-08-30
**Author:** Claude (Fable 5)
**Milestone:** [milestones/12-undo-and-redo.md](../milestones/12-undo-and-redo.md)
**Status:** draft
**Total estimated effort:** M–L

## Summary

Give the app one general way back out of an edit, built on the machinery the
additive import already installed. In memory: an unbounded stack of
structurally-shared snapshots, which the house immutability rule makes far
cheaper than the word "snapshot" suggests. In the `localStorage` draft: the
most recent few entries as reference-identity deltas, because structural
sharing is exactly what serialization destroys. Exported files carry no
history at all — see the resolved question below. Restoration goes
through `graphRevision`, so the canvas adopts the older graph in place instead
of remounting and throwing away where the reader was looking.

## How hard is this, honestly

Easier than in most apps, and the reasons are specific.

**Four things are already done.**

1. _Snapshots are free to take._ `AGENTS.md` has required immutable
   `MultigraphData` updates since milestone 01. Every previous state is still a
   live, unaliased object. There is nothing to deep-clone.
2. _There is exactly one write path._ Every user edit in the canvas goes
   through `commitUserGraph` (`Multigraph.svelte`), including the 27-odd call
   sites and the two that route via `commitContentGraph`. Physics frames
   deliberately bypass it through `LayoutRuntime.applyGraph`. One funnel means
   one place to record history.
3. _The expensive part of the UX is built._ An additive import already had to
   solve "hand a mounted canvas a different graph without remounting it": that
   is the `graphRevision` counter and `adoptGraphInPlace`, with a comment in
   `ControllerView` spelling out exactly why it is separate from
   `graphGeneration` ("a bump there would remount and throw that away"). Undo
   wants the same guarantee for the same reason.
4. _Text editing is already coarse._ The edit sheet commits on an explicit
   Save; the inline title editor commits on blur or Enter. So the usual worst
   part of an undo feature — coalescing keystrokes into sensible units — does
   not exist here. Browser-native undo covers inside-the-field typing, and
   `quantityTextInsertion.ts` and `NodeEditSheet.svelte` both take care to keep
   that stack intact.

**Three things are genuinely hard**, and they are where the bugs will live.

1. _Layout noise._ `commitUserGraph` fires on every `pointermove` of a drag,
   and every mutation is wrapped in `relaxAfterMutation`, which rewrites
   `posByNodeId`. Recording raw commits would produce hundreds of layout-only
   entries and, on restore, snap the graph back to positions the simulation
   abandoned seconds ago. Resolved by the reference test and the sparse
   position rule below (T02).
2. _Asset lifetime._ `deleteNodeImage` hard-deletes the blob from IndexedDB the
   moment the content block goes (`await assetStore.delete(...)`). Undoing that
   restores a `content` block pointing at nothing. Needs deferred deletion with
   a sweep tied to history eviction, and an ordering rule so a sweep on load
   never runs before the draft's history has been rebuilt (T03, T07, T08).
3. _State the commit does not carry._ `primaryNodeId`, and to a lesser degree
   `severedBeaconPreference`, live in the canvas, not in `MultigraphData`, and
   `deleteNode` and `applyNodeMerge` both re-point `primaryNodeId` as a side
   effect. An entry has to carry it or the pin pointer does not come back (T04).

**Rough sizing:** ten PR-sized tasks. Three carry real design risk (T02, T05,
T08), the rest are mechanical or new surface over settled logic. Call it a week
of focused human work, or four to five agent sessions with review between them.
The cheapest useful subset — in-memory undo only, no redo, no persistence, no
asset deferral — is T01+T02+T04+T05+T06 plus a toolbar button, and is roughly a
third of the whole.

## On efficiency: where snapshots are cheap and where they are not

The instinct that a full graph snapshot per edit is wasteful is right in
general and mostly wrong here, for a reason worth writing down — and the place
where it _is_ right is precisely the place this plan uses deltas.

**Two facts, both consequences of the immutability rule.**

_Layout writes are invisible to reference equality._ Every layout write ends in
`mergeVisiblePositions`, which is `{ ...graph, posByNodeId: { ... } }`. The
`nodes` and `edges` arrays come through as the same references. So:

```ts
next.nodes === prev.nodes &&
  next.edges === prev.edges &&
  next.tagColorConfig === prev.tagColorConfig &&
  next.assets === prev.assets &&
  next.pinSequence === prev.pinSequence;
```

is a complete, O(1) test for "nothing semantic changed" — and it runs on the
drag path 60 times a second where a fingerprint comparison would have
stringified the whole graph. It is _cheaper than what the app already does_:
`documentStatusForGraph` calls `graphDataEquals`, which stringifies the graph
twice, on every commit today. (Reference inequality can over-report — a
mutation that rebuilds an array to an equal value — so an edit that passes the
gate is confirmed by a fingerprint before it becomes an entry. That is O(N),
but only on real edits, never on physics frames. In practice `graph.ts` already
guards this: 17 of its 24 exports early-return the input unchanged when the
mutation does not apply.)

_A snapshot is not a copy._ `addNode` returns `{ ...data, nodes: [...data.nodes, node] }` — a new array of pointers to the _same_ `NodeData` objects.
`updateNodeContent` maps and returns untouched nodes by reference. So an entry
retains: one new array per collection the edit touched (N or E pointers), the
one or two objects it actually created, and nothing else. Arrays it did not
touch are shared with the previous entry outright.

**The arithmetic.** For a graph of N nodes and E edges, an entry that touched
only nodes retains roughly `8 × N` bytes. A 200-node graph: 1.6 KB per entry, so
2,000 edits ≈ 3 MB. A 1,000-node graph: 8 KB per entry, so 10,000 edits ≈ 80 MB
— an extreme session, and the only case where a ceiling matters. Hence
unbounded-with-a-ceiling rather than a depth cap: the ceiling exists so a tab
cannot be exhausted, not to limit history.

**Where it flips.** `JSON.stringify` does not preserve sharing. A serialized
snapshot _is_ a deep copy, so K persisted snapshots are K full graphs in the
draft — against a storage quota `SaveScheduler` already polices
(`quotaBudgetBytes`, `quotaWarningRatio`). So the persisted tail is deltas, and
computing one is cheap for the same reason the O(1) test works: **a
reference-identity walk finds exactly what changed**, in O(N) comparisons
producing O(changed) output, with no deep equality anywhere.

**Alternatives considered and rejected.**

- _Inverse operations per mutation._ Fifteen hand-written inverses to keep
  correct forever, and several mutations do not invert cleanly
  (`deleteTagEverywhere`, `commitInlineTitleSyntax`, a node merge). State
  deltas are one code path and correct by construction.
- _Immer `produceWithPatches`._ Would give forward and inverse patches for
  free, but means routing `graph.ts` — 500 lines, zero dependencies, the
  most-tested module in the app — through `produce`, and adding a runtime
  dependency to a bundle that ships as a committed self-contained HTML file.
  The reference-identity diff gets the same output for the shape of data we
  actually have.
- _Deltas in memory too._ Would save the per-entry pointer arrays, at the cost
  of making every undo a replay rather than a pointer swap, and of putting the
  delta code on the hot path where its bugs would be hardest to see. Snapshots
  in memory, deltas at the boundary, is the split that matches where the cost
  actually is.

## Open questions resolved

- **Where the history lives.** **`GraphPersistenceController`.** It already
  owns the snapshot/revert pair, it survives a canvas remount (the canvas is
  keyed on `graphGeneration`), and it is the only place that sees _both_ canvas
  edits and controller-side mutations like the additive import. Keeping it in
  `Multigraph.svelte` next to `commitUserGraph` would see richer intent but
  would miss imports and die on every remount — exactly when a reader most
  wants their history.
- **Snapshots in memory, deltas on disk.** See above.
- **Unbounded, under a memory ceiling.** No depth cap. A ceiling on estimated
  retained pointers (`Σ nodes.length + edges.length` over entries) evicts
  oldest-first, defaulting high enough that a real session never reaches it.
  The tunable lives in `APP_CONFIG` per the tunables-as-parameters rule.
- **The persisted tail lives in the draft only, never in a saved file.** An
  entry holds the content it removed, so a tail in an exported document would
  send deleted material along with the document. There is no undo-after-reopen
  that avoids that — it is the feature, not a leak in it — so the file stays a
  description of a graph, and undo does not survive moving a document to
  another machine. The Undo control has to say so on a freshly opened file
  rather than look broken.
- **K = 10 persisted entries, byte-budgeted.** Dropped oldest-first when they
  would not fit, never failing the write — the discipline `graphSnapshot.ts`
  already documents ("a snapshot that will not fit is dropped and the write
  reports failure instead of throwing").
- **Persisted history rides the schema version.** A draft from a different
  `CURRENT_SCHEMA_VERSION` loads its graph and drops its history,
  exactly as `graphSnapshot.ts` refuses to migrate a snapshot: "not worth the
  risk of restoring a half-understood graph."
- **`graphSnapshot.ts` retires.** Once the persisted tail exists, a
  single-snapshot store beside it is a second mechanism doing a subset of the
  same job. `RevertBanner` stays, re-founded on the history's top entry when
  that entry is an import — the labelled, confirmed offer is genuinely
  different UX from a plain undo button, and worth keeping.
- **Redo is in scope.** The restore path, the entry format and the position
  rule are all shared; only the pointer arithmetic and one more button are new.
- **What is one entry.** A commit that fails the O(1) reference test _and_ is
  confirmed different by fingerprint.
- **Positions.** An entry carries a sparse `posByNodeId` covering only the
  nodes it removes. On restore, every surviving node keeps its current
  position; resurrected nodes take theirs from the entry; the result relaxes.
  Restoring `posByNodeId` wholesale would yank the entire canvas backwards for
  an edit that touched one node.
- **Restore does not move the camera.** Unlike the import reveal, which chases
  an arrival the reader has never seen, an undo reverses something the reader
  just did at a place they are already looking. The status notice names the
  operation for the case where it is off screen.
- **Restore bumps `graphRevision`, never `graphGeneration`.** The canvas stays
  mounted and keeps pan, zoom, focus and nav — the whole point.
- **Cmd/Ctrl+Z stands down inside text entry.** `keyboardIsInTextEntry()`
  already exists in `Multigraph.svelte` for the bare-`F` fit shortcut, and the
  description field's native undo is something the codebase has deliberately
  protected twice.

## Out of scope (for this plan)

- Undoing drags, camera moves, focus entry, query-panel state.
- Keystroke-level undo inside inputs — the browser's, untouched.
- Undo across graph ids. Switching or loading clears the history.
- History in an exported file, an opt-in "save with history", a history
  browser, named checkpoints.
- Multiplayer-safe history (milestone 07).
- Relaxing the `window.confirm` on tag deletion, or dropping `RevertBanner`'s
  confirmation, now that an undo exists. Worth doing, but as a follow-up once
  the undo has proven itself. File in `docs/debt/` if not picked up.

## Tasks

### T01 — `undoHistory.ts`: the pure stack

|                |                                                         |
| -------------- | ------------------------------------------------------- |
| **Depends on** | —                                                       |
| **Wave**       | 1                                                       |
| **Agent**      | mid (Opus)                                              |
| **Effort**     | S                                                       |
| **Files**      | `src/lib/undoHistory.ts`, `src/lib/undoHistory.spec.ts` |
| **PR title**   | `feat(history): add an unbounded undo/redo stack`       |

A pure module over an opaque entry type: `push`, `undo`, `redo`, `canUndo`,
`canRedo`, `clear`, `entries` (newest-first, for the persisted tail), and an
`evicted` result so the caller learns which entries fell off the end (T03 needs
that to know when a blob is finally unreachable). Push truncates the redo tail.
Eviction is driven by a `costOf(entry)` callback and a ceiling, both
parameters, so the stack itself knows nothing about graphs.

**Acceptance** — spec covers: push/undo/redo round trip; new push after undo
discards the tail; eviction fires on the cost ceiling, not an entry count, and
reports what it evicted; undo at the bottom and redo at the top are no-ops, not
throws; `entries` is ordered newest-first and unaffected by the redo pointer.

### T02 — `graphIdentity.ts`: the reference test and the restore rule

|                |                                                                |
| -------------- | -------------------------------------------------------------- |
| **Depends on** | —                                                              |
| **Wave**       | 1                                                              |
| **Agent**      | strong (Opus, high effort)                                     |
| **Effort**     | M                                                              |
| **Files**      | `src/lib/components/ui/Multigraph/lib/graphIdentity.ts` + spec |
| **PR title**   | `feat(graph): separate semantic identity from layout`          |

Three functions. The design risk of this milestone is concentrated here.

`semanticallyUnchanged(prev, next)` — the O(1) reference test.

`removedNodePositions(prev, next)` — the sparse `posByNodeId` an entry carries.

`restoreSemantics(current, snapshot, removedPositions)` — the snapshot's nodes,
edges, `tagColorConfig`, `assets` and `pinSequence`, with a `posByNodeId` that
keeps `current`'s position for every node in both, takes `removedPositions` for
nodes only the snapshot has, and drops entries for nodes in neither.

**Acceptance** — spec covers: a graph through `mergeVisiblePositions` is
semantically unchanged; each of the five tracked fields changing is detected; a
resurrected node lands at its recorded position; a node present in both keeps
its current position; a node in neither leaves no stale `posByNodeId` entry;
`pinSequence` and `assets` round trip. Add a spec asserting the reference test
holds after `relaxAfterMutation` — it is the invariant everything rests on, and
it should fail loudly if a future layout change breaks it.

### T03 — Deferred asset deletion

|                |                                                                     |
| -------------- | ------------------------------------------------------------------- |
| **Depends on** | —                                                                   |
| **Wave**       | 1                                                                   |
| **Agent**      | mid (Opus)                                                          |
| **Effort**     | M                                                                   |
| **Files**      | `src/lib/assets/assetStore.ts` (+ spec), new `assetTrash.ts` + spec |
| **PR title**   | `feat(assets): defer blob deletion behind a sweepable trash`        |

Today `deleteNodeImage` calls `assetStore.delete(...)` inline, which makes an
image removal the one edit an undo cannot honour. Replace with a tombstone: the
blob stays, marked unreferenced. A `sweep(liveAssetIds)` deletes tombstoned
blobs nothing live names. Sweep on history eviction, on `clear`, on a graph
switch, and on load — which is also where the existing revert's orphans already
get collected ("blobs the revert orphans are collected by the next replacing
load").

**Acceptance** — spec covers: a tombstoned blob is still readable; sweeping
while something names it keeps it; sweeping when nothing does deletes it; a
re-referenced blob loses its tombstone; sweep never throws on a store that
refuses access (same discipline as `graphSnapshot.ts`).

### T04 — Label the commits

|                |                                                                             |
| -------------- | --------------------------------------------------------------------------- |
| **Depends on** | —                                                                           |
| **Wave**       | 1                                                                           |
| **Agent**      | fast/cheap (mechanical, but touches ~27 call sites)                         |
| **Effort**     | S–M                                                                         |
| **Files**      | `Multigraph.svelte`, `usePersistedGraph.svelte.ts`, `+page.svelte`, stories |
| **PR title**   | `refactor(multigraph): carry an intent with every graph commit`             |

Widen `commitUserGraph(next)` to `commitUserGraph(next, intent)` and
`onMultigraphChange(data, generation)` to carry the intent through to
`notifyGraphChanged`. `intent` is `{ label: string; primaryNodeId: string }` —
the label is what the undo control and the status notice say ("Undo delete
node"), and `primaryNodeId` is the canvas-local state a restore has to put back
(`deleteNode` and `applyNodeMerge` both move it).

Give the drag path (`handleNodeMoved`, `handleNodeDragEnd`) an explicit
`'layout'` label so the intent is stated at the call site rather than inferred
downstream. T02's reference test is still the authority; the label is wording.

**Acceptance** — every existing call site names an intent; no behaviour change;
`lint`, `check`, `knip` and the full `test:unit` run stay green.

### T05 — Controller owns the history

|                |                                                                         |
| -------------- | ----------------------------------------------------------------------- |
| **Depends on** | T01, T02, T04                                                           |
| **Wave**       | 2                                                                       |
| **Agent**      | strong (Opus, high effort)                                              |
| **Effort**     | M                                                                       |
| **Files**      | `graphPersistenceController.ts` (+ spec), `usePersistedGraph.svelte.ts` |
| **PR title**   | `feat(persistence): keep an undo history for the loaded graph`          |

`notifyGraphChanged` pushes an entry when T02's test says the commit is
semantic. `undo()` / `redo()` restore via `restoreSemantics`, bump
`graphRevision`, `scheduleSave`, refresh `documentStatus`, and set a `notice`
naming the operation. Expose `canUndo` / `canRedo` / `undoLabel` / `redoLabel`
on `ControllerView` and re-export through `usePersistedGraph`. Clear the
history on `load`, `selectGraph`, `createGraph` and the replacing
`importGraphDocument` — never on the additive one.

Note the ordering trap the existing code already documents: a canvas being torn
down still commits pending edits, which is why `notifyGraphChanged` drops
commits naming a superseded `generation`. Those dropped commits must not push
entries either.

**Acceptance** — spec covers: an edit pushes one entry; a position-only change
pushes none; undo restores and bumps `graphRevision` and not `graphGeneration`;
redo returns; an edit after undo drops the tail; a load clears; a superseded
generation neither saves nor pushes; the baseline and `documentStatus` follow
the restored graph.

### T06 — The canvas adopts a restored graph

|                |                                                              |
| -------------- | ------------------------------------------------------------ |
| **Depends on** | T05                                                          |
| **Wave**       | 3                                                            |
| **Agent**      | strong (Opus, high effort)                                   |
| **Effort**     | M                                                            |
| **Files**      | `Multigraph.svelte`, `Multigraph.stories.svelte`             |
| **PR title**   | `feat(multigraph): adopt an undone graph without remounting` |

Generalize `adoptGraphInPlace` to take the reason it is adopting: an import
reveals the arrival by camera, an undo does not. Restore `primaryNodeId` from
the entry rather than only re-pointing it when the current one has vanished.
Play the enter/exit animations for what the restore added and removed, so an
undone deletion grows back the way a creation does rather than popping in.

**Acceptance** — story `play` covers: undoing a node deletion restores the node
with its edges, with no `graphGeneration` bump and no camera move; the reveal
stack and focus level survive; the restored node animates in.

### T07 — Wire the trash to the history

|                |                                                                 |
| -------------- | --------------------------------------------------------------- |
| **Depends on** | T03, T05                                                        |
| **Wave**       | 3                                                               |
| **Agent**      | mid (Opus)                                                      |
| **Effort**     | S                                                               |
| **Files**      | `Multigraph.svelte`, `graphPersistenceController.ts`            |
| **PR title**   | `fix(assets): keep an undone image alive while its entry lives` |

`deleteNodeImage` tombstones instead of deleting; the controller sweeps on
eviction, `clear`, graph switch and load, passing the union of asset ids named
by the live graph and every surviving entry.

The sweep on load must run _after_ the draft's history has been rebuilt (T08),
or it deletes the blobs that history was about to resurrect. State the ordering
at the call site; it is the kind of thing a later refactor reorders innocently.

**Acceptance** — spec plus a story: remove an image, undo, and the block still
resolves to a blob; evict the entry and the blob is gone; a load that rebuilds
a tail referencing a tombstoned blob does not sweep it.

### T08 — `graphDelta.ts` and the persisted tail in the draft

|                |                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| **Depends on** | T05                                                                                                    |
| **Wave**       | 3                                                                                                      |
| **Agent**      | strong (Opus, high effort)                                                                             |
| **Effort**     | M                                                                                                      |
| **Files**      | new `src/lib/graphDelta.ts` + spec, `persistence.ts`, `migrations.ts`, `graphPersistenceController.ts` |
| **PR title**   | `feat(persistence): persist the recent undo tail in the draft`                                         |

`diffByReference(from, to)` walks the two graphs comparing element references,
emitting `{ nodes: { added, removed, changed }, edges: {...}, tagColorConfig?, assets?, pinSequence?, removedPositions }`. `applyDelta(graph, delta)`
inverts it. Serialize the newest K entries as deltas chained backwards from the
current graph and store them in the draft payload beside `data` and
`viewState`; rebuild the stack on load. Byte-budget the tail, dropping oldest
first; drop the whole tail on a schema-version mismatch.

**Acceptance** — spec covers: a delta round-trips a graph through every
mutation in `graph.ts` (drive it from `testFixtures.ts`); an empty delta is
emitted for a layout-only change; a chained tail rebuilds the same states the
in-memory stack held; a tail over budget drops oldest-first and the save still
succeeds; a mismatched schema version yields an empty history and an intact
graph.

### T09 — Retire `graphSnapshot.ts`, re-found `RevertBanner`

|                |                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T08                                                                                                                   |
| **Wave**       | 4                                                                                                                     |
| **Agent**      | mid (Opus)                                                                                                            |
| **Effort**     | S–M                                                                                                                   |
| **Files**      | delete `graphSnapshot.ts` + spec, `graphPersistenceController.ts` (+ spec), `RevertBanner.svelte`, `snapshotOffer.ts` |
| **PR title**   | `refactor(persistence): fold the import snapshot into the history`                                                    |

`importGraphIntoCurrent` pushes an entry labelled `import` and stops writing a
separate snapshot. `revertToSnapshot` / `dismissSnapshot` become thin wrappers
over the history. `RevertBanner` reads the top entry: it appears while that
entry is an import, and `snapshotOfferHeadline`'s node-count arithmetic can now
be exact rather than defensive, because the entry holds the pre-import graph
rather than only its node count. Delete the storage key and its migration.
`knip` will flag anything left behind.

**Acceptance** — spec covers: an additive import pushes exactly one entry and
writes no separate snapshot key; undoing it restores the pre-import graph
without a remount; the banner appears and disappears with the entry; the banner
still works after a reload, now served by the persisted tail; no reference to
`graphSnapshot` survives (`knip` green).

### T10 — Undo and redo controls, and the end-to-end sweep

|                |                                                                           |
| -------------- | ------------------------------------------------------------------------- |
| **Depends on** | T06, T07, T09                                                             |
| **Wave**       | 5                                                                         |
| **Agent**      | mid (Opus)                                                                |
| **Effort**     | M                                                                         |
| **Files**      | `GraphToolbar.svelte` (+ stories), `Multigraph.svelte`, `e2e/app.test.ts` |
| **PR title**   | `feat(ui): add undo and redo to the toolbar and the keyboard`             |

Two buttons in the toolbar pill, disabled with a reason when there is nothing
to undo or redo, labelled with the operation when there is ("Undo delete
node"). `Cmd/Ctrl+Z` and `Cmd/Ctrl+Shift+Z` in the existing window `keydown`
handler, returning early under `keyboardIsInTextEntry()` so the description
field keeps its own undo.

Note the tooltip debt: `docs/debt/2026-08-30-tooltips-are-hover-only.md` says
`title` is hover-only and invisible on touch, and this app is mobile-first. The
disabled reason has to reach `aria-disabled` and the accessible name, not
`title` alone.

E2E covers what only a real browser can: delete → undo → reload → the node is
back and cached; image remove → undo → reload → the image renders; save →
reopen the file → the history is empty and Undo says why; drag → the undo
button is still disabled.

**Acceptance** — stories cover enabled, disabled and labelled states; a story
`play` asserts `Cmd+Z` inside a focused textarea does not undo the graph; the
four e2e journeys pass.

## Wave plan

| Wave | Tasks              | Notes                                                                                       |
| ---- | ------------------ | ------------------------------------------------------------------------------------------- |
| 1    | T01, T02, T03, T04 | Fully parallel — disjoint files, no shared state.                                           |
| 2    | T05                | Sequential: it consumes all four.                                                           |
| 3    | T06, T07, T08      | T06 and T07 both touch `Multigraph.svelte` — sequence those two. T08 is disjoint from both. |
| 4    | T09                | After T08: retiring the snapshot store is only safe once the tail replaces it.              |
| 5    | T10                | Last. Needs everything to exist before the e2e journeys mean anything.                      |

Run it straight through. An earlier version of this plan proposed stopping
after wave 3 to avoid committing to a file format before real use; with history
kept out of exported files that risk is gone — the draft's format is a cache,
and a version mismatch drops the history the way `graphSnapshot.ts` already
drops a snapshot.

The one ordering that is not negotiable is T08 before T09: retiring
`graphSnapshot.ts` before the persisted tail exists would lose the
reload-surviving import revert, which is a regression, not a refactor.

## Risks

- **T02 is load-bearing and its invariant is implicit.** The O(1) reference
  test is only correct while every layout write preserves the `nodes` and
  `edges` references — true today because everything funnels through
  `mergeVisiblePositions`, but nothing enforces it. The spec asserting it
  (T02's acceptance) is the guard; treat a failure there as a design change,
  not a test to update.
- **The position rule needs a real graph, not a spec.** If
  `restoreSemantics` is subtly wrong the symptom is a canvas that lurches on
  undo, which specs will not show. Budget a manual smoke pass on the largest
  available graph.
- **T04 touches many call sites in a 3,000-line component.** Mechanical, but
  exactly the kind of sweep that quietly drops a call. The full `test:unit` run
  plus `knip` is the gate.
- **The memory ceiling is a guess until measured.** The arithmetic above says a
  realistic session is single-digit MB, but that is arithmetic. Instrument
  `costOf` and read it on a real large graph during T05 before fixing the
  default.
- **Undo silently absent on an opened file.** History is per-browser, so
  opening a saved document anywhere else starts empty. A disabled Undo button
  with no explanation reads as a bug; the accessible name has to carry the
  reason (T10), and this is the first thing to watch for in real use.
- **The sweep/rebuild ordering in T07 is invisible until it bites.** A load
  that sweeps before rebuilding the tail deletes exactly the blobs the tail
  needed, and the symptom is a broken image several undos later.
- **Two ways back out of an import** between T05 and T09. Shipping the middle
  waves without T09 leaves a banner and an undo button doing overlapping
  things; if that window is going to be long, say so in the notice wording.
