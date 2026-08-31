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
   through `commitUserGraph` (`Multigraph.svelte`) — 22 direct call sites plus
   the four that route via `commitContentGraph` — and `onMultigraphChange` has
   exactly one production call site, inside it. Physics frames deliberately
   bypass it through `LayoutRuntime.applyGraph`. One funnel means one place to
   record history. (Two semantic edits are built _outside_ `graph.ts` —
   `planNodeMerge` in `nodeMerge.ts` and `importGraphData` in `graphImport.ts`
   — but both land through the same funnel; they matter to T08's delta
   coverage, not to where history is recorded.)
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

**Four things are genuinely hard**, and they are where the bugs will live.

1. _Layout noise._ `commitUserGraph` fires on every `pointermove` of a drag,
   and every mutation is wrapped in `relaxAfterMutation`, which rewrites
   `posByNodeId`. Recording raw commits would produce hundreds of layout-only
   entries and, on restore, snap the graph back to positions the simulation
   abandoned seconds ago. Resolved by the reference test and the position rule
   below (T02).
2. _Semantic noise._ One input in the app commits continuously without being
   layout: the tag colour swatch is a native `<input type="color">` whose
   `oninput` fires per scrub frame (`TagColorLegend.svelte`), each a real
   `tagColorConfig` change that sails through the reference test. Recording raw
   commits would turn one colour choice into dozens of entries. Resolved by
   the coalescing rule (T04, T05): a run of commits sharing a coalesce key
   collapses into one entry, and the live canvas preview keeps working.
3. _Asset lifetime._ `deleteNodeImage` hard-deletes the blob from IndexedDB the
   moment the content block goes (`await assetStore.delete(...)`). Undoing that
   restores a `content` block pointing at nothing. Needs deferred deletion with
   a sweep tied to history eviction, and an ordering rule so a sweep on load
   never runs before the draft's history has been rebuilt (T03, T07, T08).
4. _State the commit does not carry, and surfaces that watch it._
   `primaryNodeId` and `severedBeaconPreference` live in the canvas, not in
   `MultigraphData`; `deleteNode` and `applyNodeMerge` re-point the former as a
   side effect, and every severing removal rewrites the latter (it steers which
   node anchors an orphaned component). An entry has to carry both or the
   restored graph anchors wrong (T04, T05). Beyond those two, live UI reads the
   graph by node id and has never had to survive a node _vanishing_ under it:
   the focus overlay resolves `nodeById[subjectId]` with no close-on-missing
   path, the nav stack is pruned only by `deleteNode`, and the edit sheet's
   draft-reset effect re-runs (discarding unsaved text) whenever its node
   object is replaced. Undo is the first feature that can yank any of those out
   from underneath the reader, so the restore path has to guard each one (T06,
   T10).

**Rough sizing:** ten PR-sized tasks. Four carry real design risk (T02, T05,
T06, T08), the rest are mechanical or new surface over settled logic. Call it a week
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
stringified the whole graph. It is _far cheaper than what the app already
does_: a single `notifyGraphChanged` today costs six-plus full-graph
stringifies (`currentDocumentStatus` twice, `currentDraftCached`, and the
`emit → getView` recompute pays them again), and that runs per commit,
including per `pointermove` of a drag. (Reference inequality can over-report —
a mutation that rebuilds an array to an equal value — so an edit that passes
the gate is confirmed by a fingerprint before it becomes an entry. That is
O(N), but only on real edits, never on physics frames, and a coalesced
continuation of a run skips it (T05). In practice `graph.ts` already guards
this: 14 of its 17 mutations early-return the input unchanged when the
mutation does not apply.)

_A snapshot is not a copy._ `addNode` spreads the graph and replaces `nodes`,
`posByNodeId` and `pinSequence` — each a new array or record of pointers to the
_same_ `NodeData` objects. `updateNodeContent` maps and returns untouched
nodes by reference. So an entry
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
  reports failure instead of throwing"). Note the budget has to be a
  _pre-flight measurement of the tail's own bytes_: `SaveScheduler`'s
  `quotaBudgetBytes` is an advisory warning computed _after_ a successful
  write, not a gate. K lives in `APP_CONFIG`; on phones, where the OS evicts
  background tabs freely, the tail _is_ the effective history depth — so K is
  the first tunable to revisit once `costOf` instrumentation says what an
  entry really weighs.
- **Persisted history rides the schema version.** A draft from a different
  `CURRENT_SCHEMA_VERSION` loads its graph and drops its history,
  exactly as `graphSnapshot.ts` refuses to migrate a snapshot: "not worth the
  risk of restoring a half-understood graph."
- **`graphSnapshot.ts` retires.** Once the persisted tail exists, a
  single-snapshot store beside it is a second mechanism doing a subset of the
  same job. `RevertBanner` stays — the labelled, confirmed offer is genuinely
  different UX from a plain undo button, and worth keeping — but it is
  re-founded on the history with today's semantics preserved: the banner today
  _survives subsequent edits_ (`notifyGraphChanged` never touches the
  snapshot), so it must not vanish on the first post-import edit. It shows
  while the newest import entry is still on the undo side and not dismissed;
  Revert restores that entry's before-state _as one new entry_, which keeps
  history linear and — for the first time — makes the revert itself redoable.
  See T09.
- **Redo does not survive a reload.** The persisted tail serializes the undo
  side only — deltas chained backwards from the current graph cannot reach
  states forward of it. Losing redo on reload is what every mainstream editor
  does, and it keeps the tail format anchored to the draft's own `data`.
- **An entry restores the graph, the pin pointer, and the beacon hint —
  presentation state degrades on purpose.** Each recorded state carries
  `primaryNodeId` and `severedBeaconPreference` beside the graph (both are
  canvas state the graph does not hold, and both change what is on screen).
  Everything else ephemeral — open overlays, enter/exit animation buffers, nav
  crumbs a delete already pruned — is deliberately not resurrected: a restore
  closes overlays like any commit, prunes nav crumbs that name missing nodes,
  and lets animations play forward from what the restore did. Undo is for the
  document, not for replaying the session.
- **Live surfaces are guarded, not synchronised.** Three guards, all in the
  apply path so toolbar taps and shortcuts share them: undo/redo stand down
  while the edit sheet is open (its draft-reset effect would silently discard
  unsaved text — the disabled control names the reason); they no-op while a
  node drag or creation gesture is active (the gesture would re-commit the
  finger's position over the restored graph on the next `pointermove`); and a
  restore that removes the focus subject (node or image) closes focus cleanly
  instead of leaving an empty overlay.
- **`Ctrl+Y` joins `Cmd/Ctrl+Shift+Z` for redo.** One extra line, and it is
  the redo Windows hands expect.
- **A disabled Undo explains itself when tapped.** The controls use
  `aria-disabled` rather than `disabled`, so a tap on a control with nothing
  to do surfaces the reason in the status notice ("Nothing to undo. Opened
  files start fresh."). `title` is hover-only and this app is mobile-first
  (`docs/debt/2026-08-30-tooltips-are-hover-only.md`); the notice line is the
  one channel that reaches touch.
- **Redo is in scope.** The restore path, the entry format and the position
  rule are all shared; only the pointer arithmetic and one more button are new.
- **What is one entry.** A commit that fails the O(1) reference test _and_ is
  confirmed different by fingerprint — except that a commit whose intent
  carries the same coalesce key as the top entry _replaces_ that entry's
  after-state instead of pushing (keeping the run's original before-state, and
  skipping the fingerprint). That is what turns a colour scrub's dozens of
  `oninput` commits into one entry while the canvas still previews live. The
  colour path is the only coalescer for now; designation-chip taps stay one
  entry per tap — the cycle is at most two taps in either direction, so undo
  mirrors what the thumb did, and predictability beats cleverness there.
- **Positions.** In memory an entry is a snapshot, and a snapshot already
  carries `posByNodeId` as of its moment — so restore needs no side channel:
  every node present in both graphs keeps its _current_ position, nodes only
  the snapshot has take theirs _from the snapshot_, and the result relaxes.
  Restoring positions wholesale would yank the entire canvas backwards for an
  edit that touched one node. The sparse `removedPositions` capture exists
  only in the persisted delta (T08), where full position maps are what the
  format is there to avoid.
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
- Reconciling the edit sheet's split commit model with Cancel. The Edges tab
  and the image buttons commit on touch while the Node tab commits on Done, so
  Cancel already leaves some changes behind — undo makes that mismatch visible
  for the first time, but fixing it is sheet UX work, not history work. File
  in `docs/debt/` when it grates.
- Making the sheet's commit-on-tap chips and the details-overlay chips agree.
  Only the details overlay commits per tap; the sheet's chips are drafts until
  Done. The history will read differently depending on which surface was used,
  and that is acceptable for now.

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

A pure module over an opaque entry type: `push`, `replaceTop` (the coalescing
primitive — swaps the newest undo-side entry, for T05's same-coalesce-key
runs), `undo`, `redo`, `canUndo`, `canRedo`, `clear`, `undoEntries`
(newest-first from the pointer down — the persisted tail covers the undo side
only, since redo does not survive a reload), `allEntries` (both sides, for
T07's asset keep-set), and a `dropped` result on every operation that loses
entries — eviction _and_ the redo-tail truncation a push performs — so the
caller learns when a blob is finally unreachable (T03/T07 need both channels).
Eviction is driven by a `costOf(entry)` callback and a ceiling, both
parameters, so the stack itself knows nothing about graphs. The stack is
seeded with the loaded state, or there is nothing for the first edit's undo to
restore.

**Acceptance** — spec covers: push/undo/redo round trip from a seeded state;
new push after undo discards the tail _and reports the discarded entries_;
`replaceTop` swaps the top without growing the stack and never touches the
redo side; eviction fires on the cost ceiling, not an entry count, and reports
what it evicted; undo at the bottom and redo at the top are no-ops, not
throws; `undoEntries` is ordered newest-first and excludes the redo side;
`allEntries` includes it.

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

`removedNodePositions(prev, next)` — the sparse position capture. Used only by
T08's delta format; the in-memory restore does not need it, because a snapshot
already carries positions.

`restoreSemantics(current, snapshot)` — the snapshot's nodes, edges,
`tagColorConfig`, `assets` and `pinSequence`, with a `posByNodeId` that keeps
`current`'s position for every node in both, takes the _snapshot's_ position
for nodes only the snapshot has, and drops entries for nodes in neither.

One known exception to the funnel, stated so nobody rediscovers it in a panic:
the document-swap ingest at `Multigraph.svelte` (`graph = { ...incoming, posByNodeId: settledLayoutGraph.posByNodeId }`) writes layout without
`mergeVisiblePositions`. It still preserves `nodes`/`edges` by reference and
runs only on a `graphGeneration` change — where the history has just been
cleared — so it cannot corrupt an entry; note it beside the invariant spec.

**Acceptance** — spec covers: a graph through `mergeVisiblePositions` is
semantically unchanged; each of the five tracked fields changing is detected; a
resurrected node lands at its snapshot position; a node present in both keeps
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
switch, and on load. That last one quietly fixes a real leak: the comment
"blobs the revert orphans are collected by the next replacing load" oversells
today's behaviour — `deleteUnreferenced` runs only from `hydrateEmbeddedAssets`
(replacing import, or opening an embedded file over the draft), so a reader
who only ever reverts and reloads never gets collected. A sweep on every load
retires that.

**Acceptance** — spec covers: a tombstoned blob is still readable; sweeping
while something names it keeps it; sweeping when nothing does deletes it; a
re-referenced blob loses its tombstone; sweep never throws on a store that
refuses access (same discipline as `graphSnapshot.ts`).

### T04 — Label the commits

|                |                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                                    |
| **Wave**       | 1                                                                                                    |
| **Agent**      | fast/cheap (mechanical, but touches ~26 call sites)                                                  |
| **Effort**     | S–M                                                                                                  |
| **Files**      | `Multigraph.svelte`, `TagColorLegend.svelte`, `usePersistedGraph.svelte.ts`, `+page.svelte`, stories |
| **PR title**   | `refactor(multigraph): carry an intent with every graph commit`                                      |

Widen `commitUserGraph(next)` to `commitUserGraph(next, intent)` and
`onMultigraphChange(data, generation)` to carry the intent through to
`notifyGraphChanged`. `intent` is `{ label: string; primaryNodeId: string; severedBeaconPreference: string[]; coalesceKey?: string }`:

- the label is what the undo control and the status notice say ("Undo delete
  node");
- `primaryNodeId` and `severedBeaconPreference` are the canvas-local state a
  restore has to put back (`deleteNode` and `applyNodeMerge` re-point the
  former; every severing removal rewrites the latter, and a wrong value
  anchors an orphaned component to a stranger);
- `coalesceKey` marks a commit as the continuation of a run: `updateTagColor`
  passes `tag-color:<namespace>:<tag>` from the swatch's `oninput`, and the
  swatch gains an `onchange` that ends the run, so one scrub lands as one
  entry (T05 consumes this).

Give the drag path (`handleNodeMoved`, `handleNodeDragEnd`) an explicit
`'layout'` label so the intent is stated at the call site rather than inferred
downstream. T02's reference test is still the authority; the label is wording.

**Acceptance** — every existing call site names an intent (22 direct plus the
four through `commitContentGraph`); a colour scrub emits a stable coalesce key
and its release ends the run; no behaviour change; `lint`, `check`, `knip` and
the full `test:unit` run stay green.

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
semantic — or calls `replaceTop` when the intent's coalesce key matches the top
entry's, skipping the fingerprint on the continuation. Each recorded state is
`{ graph, primaryNodeId, severedBeaconPreference }` plus the transition label:
undo needs the _previous_ state's values, which is exactly what per-state
capture gives without bookkeeping. Seed the stack with the loaded state.
`undo()` / `redo()` restore via `restoreSemantics`, bump `graphRevision`,
`scheduleSave`, refresh `documentStatus`, and set a `notice` naming the
operation — written to the toolbar notice column's real constraints: ~11.5rem
wide, sentence-split by `noticeLines`, superseded by the next save status, so
keep it to two short words plus the label ('Undid "delete node".'). Expose
`canUndo` / `canRedo` / `undoLabel` / `redoLabel` on `ControllerView` and
re-export through `usePersistedGraph`. Clear the history on `load`,
`selectGraph`, `createGraph` and the replacing `importGraphDocument` — never
on the additive one.

Note the ordering trap the existing code already documents: a canvas being torn
down still commits pending edits, which is why `notifyGraphChanged` drops
commits naming a superseded `generation`. Those dropped commits must not push
entries either.

**Acceptance** — spec covers: an edit pushes one entry; a position-only change
pushes none; a same-coalesce-key run lands as one entry whose before-state is
the run's start and whose after-state is its end, and a different key ends the
run; undo restores graph, `primaryNodeId` and `severedBeaconPreference`, and
bumps `graphRevision` and not `graphGeneration`; redo returns; an edit after
undo drops the tail; a load clears and re-seeds; a superseded generation
neither saves nor pushes; the baseline and `documentStatus` follow the
restored graph.

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
reveals the arrival by camera, an undo does not. Restore `primaryNodeId` and
`severedBeaconPreference` from the recorded state rather than only re-pointing
when the current value has vanished. Play the enter/exit animations for what
the restore added and removed, so an undone deletion grows back the way a
creation does rather than popping in — the animation buffers are explicit-call
state, nothing diffs for you, so the restore path names every resurrected and
removed element itself (`createNodeEnterAnimation` / the exiting buffer, the
primitives `deleteNode` already uses).

The restore path also carries the guards from the resolved questions, all here
so buttons and shortcuts share them:

- **Stand down while the edit sheet is open** (`editNodeId` set). The sheet's
  draft-reset effect re-runs when its node object is replaced, silently
  discarding unsaved title/description/tags and yanking focus — and the
  toolbar sits at z-index 40 over the sheet's 30, so the button is one tap
  away mid-edit.
- **No-op while a node drag or creation gesture is active.** The stage holds
  pointer capture and re-commits the finger's position on the next
  `pointermove`, so a mid-drag restore would be half-overwritten immediately;
  `handleNodeDragEnd` would then run `beginScaleChange` on a possibly-removed
  id.
- **Close focus when the restore removes the subject.** Focus levels hold only
  a `subjectId` resolved through `nodeById` behind `{#if}` guards; nothing
  today closes focus on a vanished subject because nothing today can vanish
  one. Same for an image level whose `assetId` block the restore removes.
  Prune the nav stack (`transientReveal.pruneMissing`) on every history apply
  — today only `deleteNode` prunes. (`applyNodeMerge` already misses both the
  prune and the exit animation, and `createDefiningNode` misses the enter
  animation — fix in passing if trivial, otherwise file in `docs/debt/`.)

**Acceptance** — story `play` covers: undoing a node deletion restores the node
with its edges, with no `graphGeneration` bump and no camera move; the reveal
stack and focus level survive a restore that keeps the subject; a restore that
removes the focused subject closes focus cleanly; undo is inert while the edit
sheet is open and while a drag is in flight; the restored node animates in.

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
by the live graph and every surviving entry — _both sides_ of the stack, since
a blob referenced only by a redo entry is still one redo away from being on
screen. Redo tails discarded by a fresh edit reach the sweep through the same
`dropped` channel as eviction (T01).

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
inverts it. Serialize the newest K _undo-side_ entries (redo does not survive
a reload — resolved above) as deltas chained backwards from the current graph,
with each state's `primaryNodeId` and `severedBeaconPreference` riding along,
and store them in the draft payload beside `data` and `viewState`; rebuild the
stack on load. Byte-budget the tail with a pre-flight measurement of its own
serialized size, dropping oldest first — `SaveScheduler`'s quota numbers are a
post-write advisory, not a gate, so this discipline is written here, the way
`graphSnapshot.ts` wrote its own. Drop the whole tail on a schema-version
mismatch.

**Acceptance** — spec covers: a delta round-trips a graph through every
mutation in `graph.ts` _plus_ the two semantic edits built outside it —
`planNodeMerge` and `importGraphData` (drive all of it from
`testFixtures.ts`); an empty delta is emitted for a layout-only change; a
chained tail rebuilds the same states the in-memory stack held, including the
per-state canvas fields; a tail over budget drops oldest-first and the save
still succeeds; a mismatched schema version yields an empty history and an
intact graph.

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
separate snapshot. Today's banner semantics are load-bearing and must survive
the re-founding: the offer currently _persists across subsequent edits_ until
reverted or dismissed, so the banner shows while the newest import entry is
still on the undo side of the stack and not dismissed — not merely while it is
the top entry. `revertToSnapshot` becomes "commit the import entry's
before-state as one _new_ entry labelled `revert import`": history stays
linear, the confirm dialog stays (it still discards the edits since), but for
the first time the revert itself is redoable — which is strictly kinder than
today's one-way door. `dismissSnapshot` becomes a per-entry flag; it hides the
banner and touches no history. `snapshotOfferHeadline`'s node-count arithmetic
can now be exact rather than defensive, because the entry holds the pre-import
graph rather than only its node count. Delete the storage key and its
migration. `knip` will flag anything left behind.

Two honest costs, stated: undoing _past_ the import entry hides the banner
(the offer is now reachable as plain redo, so nothing is lost), and a huge
import's delta may not fit the persisted tail's byte budget, in which case the
banner does not survive a reload — the same drop-and-report discipline the
snapshot store already applies to a huge graph today.

**Acceptance** — spec covers: an additive import pushes exactly one entry and
writes no separate snapshot key; undoing it restores the pre-import graph
without a remount; the banner persists across subsequent edits, hides on
dismiss, and hides when the import entry is undone past; revert lands as one
new entry that redo can walk back; the banner still works after a reload, now
served by the persisted tail; no reference to `graphSnapshot` survives (`knip`
green).

### T10 — Undo and redo controls, and the end-to-end sweep

|                |                                                                           |
| -------------- | ------------------------------------------------------------------------- |
| **Depends on** | T06, T07, T09                                                             |
| **Wave**       | 5                                                                         |
| **Agent**      | mid (Opus)                                                                |
| **Effort**     | M                                                                         |
| **Files**      | `GraphToolbar.svelte` (+ stories), `Multigraph.svelte`, `e2e/app.test.ts` |
| **PR title**   | `feat(ui): add undo and redo to the toolbar and the keyboard`             |

Two icon buttons (↶ / ↷) in the toolbar pill at 44px touch targets, with the
operation in the accessible name ("Undo delete node") — icon-only in an
otherwise text toolbar, because two more _text_ buttons wrap the phone toolbar
to a third row (the four existing buttons already fill a 375px width, measured)
and ↶/↷ are as close to self-explanatory as icons get. When there is nothing
to do, the buttons take `aria-disabled` (not `disabled`) with the reason in
the accessible description, and a tap on them surfaces the same reason in the
notice column ("Nothing to undo. Opened files start fresh.") — `title` is
hover-only (`docs/debt/2026-08-30-tooltips-are-hover-only.md`) and the notice
line is the one channel that reaches touch. The toolbar has no disabled
styling precedent; copy `GraphQueryPanel`'s (`opacity: 0.5`).

`Cmd/Ctrl+Z`, `Cmd/Ctrl+Shift+Z` and `Ctrl+Y` in the existing window `keydown`
handler — inside the modifier branch, which today early-returns for everything
but `Cmd/Ctrl+K`, and with an explicit `keyboardIsInTextEntry()` guard so the
description field keeps its own undo. Copy the guard deliberately: `Cmd/Ctrl+K`
skips it today, so the surrounding structure will not hand it to you. Key
repeat (holding Cmd+Z) is fine — each step is a pointer swap plus a relax, and
T06's guards already refuse the states where a repeat could hurt.

E2E covers what only a real browser can: delete → undo → reload → the node is
back and cached; image remove → undo → reload → the image renders; save →
reopen the file → the history is empty and a tap on Undo says why; drag → the
undo button is still disabled; a colour scrub lands as one entry.

**Acceptance** — stories cover enabled, `aria-disabled`-with-reason and
labelled states at the phone viewport; a story `play` asserts `Cmd+Z` inside a
focused textarea does not undo the graph, and that tapping a disabled Undo
writes its reason to the notice column; the five e2e journeys pass.

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

## Risks and rollback

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
- **Two tabs on the same graph already race on the draft**; the persisted tail
  rides that race, no worse and no better — last writer wins, and the loser's
  tail describes a graph the draft no longer holds. The schema-version and
  rebuild-validation path (T08) must treat "delta does not apply" as
  drop-the-tail, not as an error, for exactly this case.
- **New commit paths added after T04 can silently skip the intent.** Make the
  `intent` parameter required, not optional — a missing label should be a type
  error at the new call site, not an unlabeled entry discovered in the UI.

**Rollback:** everything before T09 is additive and reverts by deleting the
new modules and dropping the `intent` parameter; nothing rewires existing
behaviour except the tombstone in `deleteNodeImage` (T07), which reverts to
the inline delete. T09 is the one removal — if the re-founded banner
misbehaves, `graphSnapshot.ts` and its callers restore cleanly from git
because nothing else will have grown dependencies on the history's import
entry in the same wave.

## Definition of Done (this plan)

- All ten tasks merged, plan status `done`, milestone status `complete`, and
  the roadmap row for milestone 12 updated with a link back here.
- The roadmap's "Out of scope (for now)" line about versioning/undo-redo
  (roadmap.md, under _Out of scope_) rewritten to point at this milestone.
- The manual smoke pass from the risks list done on the largest available
  graph: repeated undo/redo, undo mid-physics-settle, a colour scrub, an
  import-then-revert-then-redo, all by hand.
- The finished work committed unless explicitly asked not to.

## Notes

- 2026-08-30: Plan reviewed against the code before execution; counts and
  claims corrected (23 `commitUserGraph` call sites not ~27, four
  `commitContentGraph` callers not two, 14-of-17 early-returning mutations
  not 17-of-24, per-commit stringify cost is six-plus not two). The review
  also surfaced the colour-scrub continuous-commit path, the
  toolbar-over-sheet z-order footgun, the empty-focus-overlay case, the
  nav-stack prune gap, and the mid-drag hazard — all now resolved in the plan
  body above.
- 2026-08-30: Adjacent pre-existing gaps noticed during review, deliberately
  not widened into this plan (file as `docs/debt/` when touched):
  `applyNodeMerge` skips both `transientReveal.pruneMissing` and the exit
  animation that `deleteNode` pays for; `createDefiningNode` adds a node with
  no enter animation; `Cmd/Ctrl+K` skips the `keyboardIsInTextEntry()` guard;
  the RevertBanner at phone widths covers the bottom-corner `Tag colors` and
  `Find / Filter` buttons (z-index 39 over 25).
- 2026-08-30: Watch the undo notice in real use: controller notices never
  auto-dismiss but the next save status ("Caching draft...") supersedes them
  within the debounce, which happens to give undo feedback a natural lifetime
  — accidental, so worth confirming it reads well rather than assuming.
