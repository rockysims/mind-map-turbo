# Milestone 12: Undo and redo

**Status:** proposed
**Depends on:** milestone 04 (persistence), milestone 04c (import/export),
milestone 04l (self-contained HTML save files), the additive-import revert
(`graphSnapshot.ts`, `RevertBanner`, commit c248061).
**Plan:** [2026-08-30 12-undo-and-redo.md](../plans/2026-08-30%2012-undo-and-redo.md)

## Goal

One way back out of any edit, not just an import.

Today the only escape hatch is the revert offer an additive import leaves
behind: a single pre-import snapshot in `localStorage`, surfaced by
`RevertBanner`, restored by `GraphPersistenceController.revertToSnapshot()`.
It is deliberately narrow — one operation, one snapshot per graph id, a
confirmation dialog because it takes everything since with it. Every other
destructive act in the app has nothing: deleting a node, merging two nodes,
deleting a tag from every use, removing an image, committing a title that
reshapes the graph through inline syntax.

This milestone makes "undo the thing I just did" a property of the document.
The import revert stops being a mechanism beside it and becomes one entry in
it, and `graphSnapshot.ts` retires.

## Why now

Three things have converged.

**The foundations are already paid for.** `AGENTS.md` has required immutable
`MultigraphData` updates since milestone 01, so every prior state is still a
live object reference — snapshots cost nothing to take, and (see below) far
less to keep than they appear to. Every user edit in the canvas already funnels
through one function, `commitUserGraph`.

**The hard mechanism exists.** The additive import needed a way to hand a
_mounted_ canvas a different graph without remounting it and costing the reader
their pan, zoom, focus and nav stack. That is `graphRevision` plus
`adoptGraphInPlace` — the exact mechanism an undo needs, built and shipped for
a different reason.

**The absence is now shaping the design of other features.** The quantity
designation chips commit on every tap in the details overlay, and the code
says why:
"makes committing on the tap safe without an undo to fall back on"
(`QuantityDesignationChips.svelte`). Deleting a tag pays for the missing undo
with a `window.confirm`. Reverting an import pays with a second confirm inside
`RevertBanner`. Each new destructive gesture is currently taxed with either a
modal or a design compromise; an undo retires that tax.

The roadmap's "Out of scope (for now)" section already anticipates this:
_"Versioning / undo-redo UI (the immutable-update pattern enables it; a UI for
it can come later)."_ This is that later. Update that line when this milestone
goes active.

## Two properties the immutable rule hands us

The plan turns on two facts that follow from the house immutability rule, and
they are what make an unbounded history affordable rather than aspirational.

1. **Layout changes are invisible to reference equality.** Every layout write
   goes through `mergeVisiblePositions`, which spreads the graph and replaces
   only `posByNodeId` — so a physics frame leaves `graph.nodes` and
   `graph.edges` as the _same array references_. "Did anything semantic
   change?" is therefore an O(1) reference check, not a comparison. It is
   cheaper than the whole-graph `JSON.stringify` the document-status line pays
   on every commit today.
2. **Two adjacent states differ by reference in exactly the places they differ
   in fact.** `graph.ts` replaces only the arrays it touches and returns
   untouched `NodeData` objects by reference. So a snapshot shares almost
   everything with its neighbour, and a diff between neighbours is found by
   reference identity in O(N) comparisons producing O(changed) output — no deep
   equality anywhere.

## Scope

**In:**

- An **unbounded in-memory** undo/redo history for the loaded graph, owned by
  `GraphPersistenceController` so it survives a canvas remount. Bounded only by
  a generous memory ceiling that evicts oldest-first, so it is unbounded for
  any realistic session but cannot exhaust a tab.
- A **persisted tail**: the most recent K entries, stored as reference-identity
  deltas, in the `localStorage` draft — so undo survives a reload or a closed
  tab on the machine the edits were made on. Undo only: redo does not survive
  a reload.
- Undo and redo restore into a _mounted_ canvas via `graphRevision`, preserving
  camera, focus, deep-zoom stack and nav — the import-adopt path, reused.
- Every semantic edit is one entry: node/edge add and remove, merge, pin
  toggle, content save, designation cycle, image add/reorder/remove, edge
  patch, tag colour, tag delete, inline title syntax, additive import. A
  continuous input is one entry too: scrubbing the tag colour picker previews
  live but coalesces into a single entry.
- Deferred asset deletion, so undoing an image removal restores a working
  image rather than a broken reference, including after a reload.
- Toolbar Undo/Redo controls, and `Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z` /
  `Ctrl+Y` that stand down inside text entry, while the edit sheet is open
  (its unsaved drafts would be silently destroyed), and while a drag is in
  flight.
- Retiring `graphSnapshot.ts`. `RevertBanner` stays as a presentation over the
  history's newest import entry — surviving subsequent edits, as it does today
  — and its revert becomes an ordinary, redoable history operation.

**Out:**

- Keystroke-level undo inside the description or title fields. The browser's
  own undo stack already covers that, and `quantityTextInsertion.ts` and
  `NodeEditSheet.svelte` both go out of their way to keep it intact.
- Undoing a node drag or any layout-only change. See "The layout boundary".
- Undoing camera moves, focus entry, or query-panel state. None of them edit
  the document.
- A history browser / named checkpoints. Linear undo and redo only.
- **History in an exported file.** A saved document carries the graph and
  nothing about how it got there. See "The saved file carries no history".
- Multiplayer / operational-transform history (milestone 07's problem).

## The layout boundary

The decision the whole milestone turns on: **undo restores what the document
says, never where the physics happened to put it.**

`commitUserGraph` is called on every `pointermove` of a node drag, and every
mutation is wrapped in `layoutRuntime.relaxAfterMutation(...)`, which rewrites
`posByNodeId`. A history that recorded raw commits would fill with hundreds of
layout-only entries, and restoring one would snap the whole graph backwards to
positions the simulation has long since left.

So:

- Whether a commit is an entry is decided by the O(1) reference check above.
  Layout-only commits update the live graph and are not recorded.
- An entry carries positions only for the nodes it _removes_, so an undo can
  put a resurrected node back where it was. Every surviving node keeps the
  position it has now, and the restored graph then relaxes like any mutation.
- A drag is therefore not undoable, and that is the honest answer rather than a
  gap: dragging is continuous, self-evident, and the physics reshuffles
  positions constantly on its own account.

## Acceptance criteria

1. Deleting a node and pressing Undo restores the node, its edges, its content
   and its tags, without remounting the canvas — pan, zoom, focus level and
   nav breadcrumbs are all where the reader left them.
2. Undo then Redo returns the graph to the post-delete state; a fresh edit
   after an undo discards the redo tail.
3. Dragging a node produces no undo entry, and the entry count is unchanged by
   the physics settling. No `JSON.stringify` of the graph runs on a drag frame
   on account of the history.
4. Removing an image, undoing, and reloading the page shows the image, not a
   broken reference.
5. Closing the tab and reopening the app walks back the last K edits. Opening
   a _saved file_ starts with an empty history, and its Undo control says so
   rather than appearing broken.
6. `Cmd/Ctrl+Z` inside the description textarea undoes typing in the textarea,
   not the last graph edit.
7. Undo and Redo are reachable by touch, with disabled states that say when
   there is nothing to undo or redo — and tapping a disabled control surfaces
   the reason where touch can see it, since tooltips are hover-only here.
8. An additive import is one undo entry; `RevertBanner` still offers its
   labelled, confirmed revert, now driven by that entry.
9. An undo can never restore one document's contents into another. Switching
   graphs or loading a different document drops the in-memory stack; the
   destination document starts from its own persisted tail, if it has one. A
   document whose schema version predates the current one loads its graph and
   drops its history, the way `graphSnapshot.ts` already refuses to migrate a
   snapshot.
10. The persisted tail is byte-budgeted: entries that would push the draft past
    the storage quota are dropped oldest-first rather than failing the write.
11. An exported file contains no history — no entries, and no asset embedded
    only because an entry referenced it.
12. Scrubbing a tag colour previews live and lands as one entry; undoing it
    restores the colour from before the scrub began.
13. Undo and redo stand down while the node edit sheet is open (the sheet's
    unsaved drafts survive) and while a node drag or creation gesture is in
    flight.
14. A restore that removes the node or image the reader is focused into closes
    focus cleanly — never an empty overlay — and back-stack crumbs naming
    removed nodes are pruned.

## The saved file carries no history

History that survives sharing _is_ shared history. A tail in the exported file
would mean that deleting a node with a private note in it, saving, and sending
the file sends the note too — the undo entry holds the content it removed.
There is no version of undo-after-reopen that avoids this; it is the feature,
not a leak in it.

So the file carries the graph and nothing else, and the history lives only in
the browser that made the edits. The cost is real and worth stating plainly:
**undo does not survive moving a document to another machine.** Opening a saved
file is a fresh start, and the Undo control has to say that rather than look
broken.

This also keeps the exported document a description of a graph rather than of a
session, which is the property that makes it safe to hand to anyone. If
cross-machine undo is ever wanted, it wants an explicit, opt-in "save with
history" — a different feature with a different conversation attached, not a
default.
