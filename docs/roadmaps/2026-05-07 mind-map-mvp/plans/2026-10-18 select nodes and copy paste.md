# Plan: Select nodes, then copy and paste them

**Created:** 2026-10-18
**Author:** Claude agent (Fable 5.1), from a design conversation with the owner
**Milestone:** none — a standalone feature. Builds on
[milestone 01](../milestones/01-graph-mutations-and-pinning.md) (pure
mutations), [milestone 12](../milestones/12-undo-and-redo.md) (history) and the
[import-and-merge plan](2026-08-29%20import%20a%20graph%20and%20merge%20nodes%20by%20hand.md)
(folding one graph into another).
**Status:** done — all nine tasks landed on `feature/node-selection-copy-paste`
on 2026-10-18 with the full gates green on each; the four rulings that
changed or added UI behaviour are filed as `docs/ui-decisions/2026-10-18--*.md`.
Still open: the phone check and a Safari check (see Notes).
**Total estimated effort:** L

## Summary

Give the canvas a selection: a set of nodes the reader marked, drawn with a
ring, that keyboard shortcuts and the action menus act on. The actions are
copy, cut, paste, delete and a group drag. The selection box is a
double-click-drag on empty canvas, which is the background twin of the
double-click-drag that already grows the graph from a node. Paste is the
existing file import aimed at a point, and the clipboard carries the existing
graph-file JSON, so a copy is a valid graph file and a graph file is
pasteable.

Paths below are relative to `apps/mind-map-sv/src/lib/` unless they start with
`apps/` or `docs/`. Every file:line reference was read on
`claude/node-selection-copy-paste-92d5f5` at `e3f3f57`.

## What exists today

The gesture vocabulary on the stage, from `components/ui/Multigraph/Stage.svelte`:

| Where it starts | Gesture                                   | Today                                                                            |
| --------------- | ----------------------------------------- | -------------------------------------------------------------------------------- |
| node            | click                                     | nothing, but it arms a double-click (`:411-427`)                                 |
| node            | double-click                              | toggle pinned (`onNodeMakePrimary`, `:565`)                                      |
| node            | double-click-drag                         | create a node, or an edge to the node dropped on (`creationSession`, `:490-523`) |
| node            | drag                                      | move the node (`:506-522`)                                                       |
| node            | hold (touch only) / right-click           | node action menu (`startLongPressTimer` `:428`, `onContextMenu` `:648`)          |
| background      | drag                                      | pan (`panStart`, `:421`)                                                         |
| background      | click / double-click / hold / right-click | nothing                                                                          |
| anywhere        | second pointer                            | pinch, cancelling everything else (`:660-680`)                                   |
| anywhere        | wheel                                     | zoom                                                                             |

So the background has no gesture but pan, which is what makes a background
double-click-drag free to take without colliding with anything.

What the plan reuses, rather than builds:

- **Folding a subgraph into a graph.** `components/ui/Multigraph/lib/graphImport.ts`
  `importGraphData(host, incoming)` remints every node and edge id against the
  host, rebases positions by one translation, merges tag colours and physics
  factors host-last, and shifts pin stamps so recency stays ordered. It is what
  Import… uses, and it is exactly what a paste needs, except for _where_ the
  incoming nodes land (`importOffset`, `:179-189`, parks them beside the host's
  bounding box).
- **Taking an externally grown graph in place.** `Multigraph.svelte`
  `adoptGraphInPlace` (`:3097`) commits an incoming graph through the normal
  relax-and-animate path and reveals the arrivals, and
  `components/ui/Multigraph/lib/importRevealTarget.ts` `arrivedNodeIds` names
  what arrived by diffing node ids.
- **The file format.** `graphFile.ts` `serializeGraphFile` (`:82`) writes a
  `GraphFileDocument` (graph data, view state, settings, embedded assets as
  base64) and `parseGraphFileText` (`:165`) reads it back through the same
  validation and migrations a load uses. `graphPersistenceController.ts`
  `embeddedAssetsForExport` (`:1321`) reads blobs out of the asset store for the
  assets a graph references, and `hydrateImportedAssets` (`:1080`) writes
  embedded assets into the store, skipping ids already stored.
- **Screen-space node geometry.** `components/ui/Multigraph/lib/nodeFocus.ts`
  `nodeScreenCircle` turns a graph position, a radius, the stage rect and the
  view transform into an on-screen circle; `Multigraph.svelte`
  `focusCandidates()` (`:2192`) builds the candidate list for the nodes the
  canvas is drawing.
- **Shared assets are already safe.** `graph.ts` `removeNodeContentBlock`
  (`:504`) and `replaceNodeContentBlockAsset` only report an asset as removed
  when no block anywhere still points at it, and `removeNode` (`:130`) never
  tombstones; the trash sweep works from `referencedAssetIds` (`:588`). Two
  nodes pointing at one asset id — which is what a same-document paste
  produces — is therefore fine, and no re-minting is needed.
- **Pin seeding.** `migrations.ts` `withSeededComponentPins` (`:523`) pins one
  beacon per pinless component so a loaded graph is never invisible under the
  bounded-neighbourhood rule. A pasted component that carries no pin needs the
  same treatment.
- **The node action menu.** `components/ui/Multigraph/NodeActionMenu.svelte`
  is a horizontal pill of six items opened by hold or right-click, with a
  roving tabindex. It is the touch route to any per-node action, and the place
  the gesture-triple ruling says a secondary action lives.
- **Keyboard guards.** `Multigraph.svelte` `:1833-1895`: one window `keydown`
  handler, every shortcut guarded by `keyboardIsInTextEntry()`, with
  Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z, Ctrl+Y, Cmd/Ctrl+K and bare `F` already taken.
- **Dragging one node.** `Multigraph.svelte` `handleNodeDragStart` /
  `handleNodeMoved` / `handleNodeDragEnd` (`:1936-1956`): the Stage reports the
  dragged node and a graph point, `moveNode` sets its position, and the layout
  runtime relaxes around it and settles on release. A group drag is the same
  three callbacks applying one delta to several nodes.

Rulings read before designing: `docs/ui-decisions/README.md` (mobile-first,
one gesture vocabulary, Pointer Events only),
`2026-08-28--pointer--hold-right-click-and-shift-enter-for-a-second-action.md`,
`2026-08-28--pointer--prefer-a-prior-click-to-drag-and-drop.md`,
`2026-08-30--keyboard--guard-every-shortcut-while-typing.md`,
`2026-08-29--keyboard--fit-with-f-and-offer-it-when-the-graph-is-lost.md`, and
the library entries `pointer--state-a-precedence-for-competing-gestures`,
`destructive--prefer-undo-to-confirmation`,
`editing--match-undo-granularity-to-what-the-hand-did`,
`motion--animate-every-add-and-remove-or-none`,
`a11y--put-a-custom-canvas-in-the-accessibility-tree`.

## Open questions resolved

The owner ruled on 2026-10-18. Where the ruling differs from the
recommendation put to them, both are recorded in the ui-decisions file named.

- **How a selection box starts.** **Double-click-drag on empty canvas.** It is
  the background twin of the node gesture that already exists — from a node,
  double-click-drag grows the graph; from empty space, it gathers the graph —
  so the reader learns one motion. It works on touch (double-tap-drag;
  `touch-action: none` already keeps the browser's double-tap zoom away) and
  needs no modifier key, which Shift-drag would. Ruling:
  `docs/ui-decisions/2026-10-18--pointer--double-click-drag-on-empty-canvas-boxes-a-selection.md`.
- **Which nodes a box takes.** **Any node whose on-screen circle overlaps the
  box.** The owner's ruling over the centre-inside recommendation; see
  `docs/ui-decisions/2026-10-18--pointer--a-selection-box-takes-any-node-it-overlaps.md`.
  The rule is a parameter of the pure function
  (`containment: 'intersect' | 'center' | 'enclose'`, default `'intersect'`),
  pinned by its spec, so the other two stay one constant away.
- **Adding to a selection.** **Shift held while boxing adds; the node action
  menu gains "Select" / "Deselect" for one node at a time, on every input.** A
  plain tap on a node keeps doing nothing, because it is the first half of a
  double-click: toggling selection on it would flicker the ring on every pin.
  The menu is where the gesture-triple ruling puts a node's second action, and
  it is the only route a touch reader has. A box with no modifier replaces the
  selection, on every input.
- **Clearing a selection.** **A click on empty canvas (no drag, no Shift) and
  Escape.** Escape walks out one level at a time, as it does today: a focus
  overlay first, then an open menu, then a box in flight, then the selection.
  The first click of an unmodified double-click clears too, which is harmless
  since the box that follows replaces anyway; a Shift-click does not clear, so
  Shift+double-click-drag adds.
- **The touch route to copy and paste.** **Two menus.** The node action menu
  gains "Copy" (the selection when the node is in it, else that node) next to
  "Select"; its "Delete" acts on the selection when the node is in it, and its
  label says so ("Delete 3 nodes"). The background gets its own menu on hold
  (touch) or right-click, with "Paste here", "Select all" and, when a
  selection exists, "Clear selection". A menu tap is the user activation the
  async clipboard needs, and "Paste here" gives a paste its point, which a
  toolbar button cannot.
- **What goes on the clipboard.** **The graph-file JSON, as `text/plain`.**
  `serializeGraphFile` of a `GraphFileDocument` whose `data` is the induced
  subgraph (selected nodes, the edges between them, their positions, the tag
  colours and physics factors those nodes and edges use, the asset metadata
  they reference, the graph's `weightConfig`) and whose `embeddedAssets` carry
  the blobs. Reading it back is `parseGraphFileText`, with every validation
  and migration a load gets, and a paste therefore also accepts a saved
  `.json` graph file's text. The cost is that pasting into a text editor
  dumps JSON rather than titles; a second `text/html` or custom flavour can be
  added later without changing the reader. Derived edges are never copied
  (`importGraphData` drops them anyway).
- **Attachments.** **Copy embeds every attachment the copied nodes reference;
  paste asks once above a threshold and then brings all of them.** Paste sums
  the bytes of the embedded assets this document's store does not already
  hold; above `clipboard.pasteAttachmentWarnBytes` (new config entry, default
  5 MB) a dialog names the total ("This paste adds about 12 MB of attachments
  to this document. Paste anyway?") with Paste anyway / Cancel, and OK pastes
  everything regardless of size. A same-document paste adds no bytes and never
  asks. Ruling:
  `docs/ui-decisions/2026-10-18--editing--a-large-paste-asks-once-and-then-brings-every-attachment.md`.
- **Where a paste lands.** **Centred on the anchor, keeping the copied
  layout.** The anchor is the menu point for "Paste here", the pointer's last
  position over the stage for Cmd/Ctrl+V when there is one, and the viewport
  centre otherwise. The whole component moves by one translation
  (`importGraphData` already works this way), so hand-arranged geometry
  survives. If the subgraph carries no pinned node, its beacon is pinned before
  the fold (the `withSeededComponentPins` rule, applied to the incoming
  subgraph), so the paste is visible under the bounded-neighbourhood rule. The
  pasted nodes become the selection, and they enter through the same
  enter-animation path an added node uses.
- **Delete, cut and group drag.** **All in scope.** Delete/Backspace removes
  the selection as one history entry ("delete 3 nodes"), Cmd/Ctrl+X is copy
  then that delete, and neither asks first: both are inside undo's reach,
  which the destructive ruling makes the deciding test. Dragging a selected
  node moves the whole selection by one delta as one undo entry; dragging an
  unselected node moves only it. A drag lands in history as a single drag
  does today — milestone 12 keeps positions out of undo — so "one undo
  entry" in the first draft of this plan was wrong, and the ruling file was
  corrected on 2026-10-18. Ruling:
  `docs/ui-decisions/2026-10-18--pointer--dragging-a-selected-node-moves-the-whole-selection.md`.
- **Edges that leave the selection.** **Dropped.** Only edges whose both ends
  are selected are copied. The induced subgraph is the rule every editor uses,
  and the one `importGraphData` can fold without inventing endpoints.
- **Which nodes are selectable.** **The nodes the canvas is drawing**
  (`visibleNodeIds`, `Multigraph.svelte:1198`). A box cannot pick a node hidden
  by the hop limit or excluded by the query, and Select all selects the same
  set. Selecting what the reader cannot see would copy things they did not
  mean to.
- **Selection and history.** **Selection is session state, not document
  state.** It is not persisted and not recorded in undo entries; it is pruned
  to the ids still in the graph on every graph change, so undoing a paste
  empties the selection it made. Copy writes no history entry at all.
- **How copy and paste read the clipboard.** **DOM `copy` / `cut` / `paste`
  events first, the async API from the menus, and an in-memory mirror behind
  both.** The DOM events fire on the keyboard shortcuts with no permission
  prompt in any browser, and the handler steps aside when the reader is in a
  text field or has text selected (`keyboardIsInTextEntry()` plus a non-empty
  `window.getSelection()`), so copying a sentence out of a description still
  works. The menus call `navigator.clipboard.writeText` / `readText` inside the
  tap's activation; where `readText` is refused (Firefox by default, Safari's
  callout dismissed) the paste falls back to the last payload this tab copied.
  The port is injected (`clipboard?: ClipboardPort`) so stories run on a memory
  clipboard, as `getNodeAt` is injected for the Stage today.
- **AI output bindings.** **Remapped through the id map, dropped when the
  target was not copied.** `addons.ai.promoted` values are node ids;
  `importGraphData` does not rewrite them today, which is a latent Import… bug
  (an imported workbench can point at a host node by id collision). Fixed in
  the import module, so both paths get it.
- **Saying what happened.** **The toolbar notice for outcomes; a count on the
  canvas for state.** "Copied 3 nodes.", "Pasted 3 nodes.", "Deleted 3 nodes."
  go through the status notice the toolbar already stacks (`noticeLines`), and
  the strings are measured at the phone viewport per the copy ruling. The live
  count ("3 selected") is a small `aria-live="polite"` label at the bottom-left
  of the canvas, below the toolbar's clearance, present only while a selection
  exists; a selected node also carries ", selected" in its accessible name next
  to ", pinned".

## Out of scope (for this plan)

- **Pasting plain text as a new node.** A non-graph clipboard is ignored.
  Making "paste a sentence" create a node titled with it is a one-line idea for
  later.
- **Marquee selection of edges.** Edges are copied by membership of their
  endpoints only; there is no edge selection.
- **A richer clipboard flavour** (`text/html`, titles-only `text/plain`, a
  custom MIME type).
- **Dragging a selection into another window.** Cross-document paste goes
  through the clipboard only.
- **Making hold work for a mouse** (TODO.md:147). The background hold stays
  touch-only, matching the node hold.

## Tasks

> Each task is one PR's worth of work. The repo's gates (`lint`, `check`,
> `test:unit -- --run`, `knip`) run before a task is called done, and every
> pure function lands with a colocated spec. Agent classes follow
> `.cursor/rules/plans.mdc`; in this owner's setup every class is an Opus
> subagent briefed by the orchestrating session, which reviews the diff,
> re-runs the gates and commits.

### T01 — Pure selection geometry and the induced subgraph

|                |                                                                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                                                                                               |
| **Wave**       | 1                                                                                                                                                               |
| **Agent**      | default workhorse                                                                                                                                               |
| **Effort**     | M                                                                                                                                                               |
| **Files**      | new `components/ui/Multigraph/lib/selection.ts` + `.spec.ts`; `components/ui/Multigraph/lib/graphImport.ts` + `.spec.ts`; `migrations.ts` (export one function) |
| **PR title**   | `feat(graph): selection geometry, induced subgraph and paste placement`                                                                                         |

`selection.ts`:

- `normalizeScreenRect(a: Point, b: Point): ScreenRect` — any two corners to
  `{left, top, width, height}`.
- `nodeIdsInScreenRect(candidates: readonly NodeFocusCandidate[], rect, stageRect, view, options: { containment?: 'intersect' | 'center' | 'enclose' }): string[]`
  — reuses `nodeScreenCircle`; default `'intersect'` (any overlap, per the
  ruling).
- `inducedSubgraph(data: MultigraphData, nodeIds: ReadonlySet<string>): MultigraphData`
  — nodes in order of `data.nodes`; edges with both ends in the set, derived
  edges excluded; `posByNodeId` for those nodes; `tagColorConfig` and
  `tagPhysicsConfig` filtered to tags the copied nodes/edges carry;
  `assets` filtered to `referencedAssetIds` of the subgraph; `weightConfig`
  carried whole; `pinSequence` recomputed from the copied stamps;
  `addons.ai.promoted` entries whose target is outside the set dropped.
- `pastePlacement(incoming: MultigraphData, anchor: Point): Point` — the
  translation that centres the incoming bounding box on `anchor`.
- `withSeededPinIfPinless(incoming)` — thin wrapper over `migrations.ts`
  `withSeededComponentPins`, which this task exports.

`graphImport.ts`: `importGraphData` takes an optional `{ offset?: Point }`
that replaces `importOffset` when given, and rewrites `addons.ai.promoted`
values through `nodeIdMap`, dropping entries whose target is not in the
import.

**Acceptance**

- Specs pin `'intersect'` (a node whose circle crosses the box edge with its
  centre outside _is_ taken), `'center'` and `'enclose'`.
- Induced subgraph spec: an edge to an unselected node is dropped, a derived
  edge is dropped, tag colours for unused tags are not carried, an asset only
  an unselected node references is not carried, a promoted binding to an
  unselected node is dropped.
- Import spec: a custom offset is applied verbatim; a promoted binding is
  remapped to the minted id.
- Immutability: inputs are returned untouched (`toBe` on the original).

### T02 — Clipboard payload and port

|                |                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                                                      |
| **Wave**       | 1                                                                                                                      |
| **Agent**      | default workhorse                                                                                                      |
| **Effort**     | M                                                                                                                      |
| **Files**      | new `components/ui/Multigraph/lib/nodeClipboard.ts` + `.spec.ts`; `config/configSchema.ts`, `appConfig.ts` (one entry) |
| **PR title**   | `feat(clipboard): graph-file payload and a clipboard port with a memory mirror`                                        |

- `encodeNodeClipboard(subgraph: MultigraphData, embeddedAssets: GraphFileEmbeddedAsset[]): string`
  — `serializeGraphFile` of a document with a neutral view state.
- `decodeNodeClipboard(text: string): GraphFileDocument | null` — wraps
  `parseGraphFileText`; `null` for anything that is not a graph file, never a
  throw.
- `embeddedAssetsForGraph(graph, store: GraphAssetStore, scopes: string[]): Promise<GraphFileEmbeddedAsset[]>`
  — the `embeddedAssetsForExport` logic, lifted out of the controller so both
  callers share it (the controller then calls this). Every referenced asset
  is embedded; there is no cap.
- `newAttachmentBytes(doc: GraphFileDocument, storedAssetIds: ReadonlySet<string>): number`
  — the bytes a paste would add: the `size` of each embedded asset whose id is
  not already stored. Pure, so the threshold check is a spec.
- `ClipboardPort { writeText(text): Promise<boolean>; readText(): Promise<string | null> }`,
  `memoryClipboard()` for stories, `systemClipboard()` wrapping
  `navigator.clipboard` with the memory mirror: every successful write is
  mirrored, and a refused `readText` returns the mirror.
- `clipboard.pasteAttachmentWarnBytes` in the config schema, default 5 MB,
  tier advanced, with help text saying a paste above it asks first.

**Acceptance**

- Round-trip spec: encode → decode yields an equal `data` and the same
  embedded assets.
- `decodeNodeClipboard('hello')` and `decodeNodeClipboard('{"a":1}')` are
  `null`.
- Asset spec with `MemoryGraphAssetStore`: two referenced assets of different
  sizes are both embedded as base64; an unreferenced one is not.
- `newAttachmentBytes` counts only ids not in the stored set.
- `systemClipboard()` spec: a `readText` that rejects falls back to the last
  written text.

### T03 — Stage: background box, click, hold and right-click

|                |                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                                                               |
| **Wave**       | 1                                                                                                                               |
| **Agent**      | high-reasoning (gesture precedence in a 950-line pointer machine)                                                               |
| **Effort**     | L                                                                                                                               |
| **Files**      | `components/ui/Multigraph/Stage.svelte`, `StageHarness.svelte`, `Stage.stories.svelte`; `constants.ts` only if a tunable is new |
| **PR title**   | `feat(stage): background double-click-drag draws a selection box`                                                               |

New props: `onSelectionBoxUpdate?(rect: ScreenRect)`,
`onSelectionBoxEnd?(rect: ScreenRect, options: { additive: boolean })`,
`onSelectionBoxCancel?()`, `onBackgroundClick?(point: Point, options: { shiftKey: boolean })`,
`onBackgroundLongPress?(point: Point)`, `onBackgroundContextMenu?(point: Point)`.
`point` is client coordinates, like `onNodeLongPress`.

Precedence, written into the file's comment block and implemented:

1. A background press records `{clientX, clientY, time}`. It is a double
   when the previous background click was within `doubleClickMs` and within
   `longPressDistancePx` of it.
2. Movement past `dragThreshold` in a double session starts the box and
   clears `panStart`; outside a double session it pans, as today.
3. The box is drawn by the Stage itself as an `aria-hidden` `.selection-box`
   in stage space (not inside `.stage-content`, which is transformed), and
   `onSelectionBoxUpdate` fires on every move.
4. Release ends the box with `additive: e.shiftKey`. A release with no drag
   and no double fires `onBackgroundClick`. A release with no drag in a double
   session fires nothing.
5. A second pointer, `pointercancel` and Escape cancel the box
   (`onSelectionBoxCancel`); the second pointer then pinches as today.
6. A touch hold on the background with no movement past
   `longPressDistancePx` fires `onBackgroundLongPress` and suppresses the
   click; the same timer code path as the node hold, with the same
   `activePointers.size !== 1` guard. A right-click on the background fires
   `onBackgroundContextMenu`.
7. A menu-armed creation session still swallows background presses.

**Acceptance**

- Stories, each asserting through `data-last-*` harness attributes:
  "user double-click-drags on empty canvas and a box is reported";
  "a single background drag still pans and reports no box";
  "Shift on release reports additive";
  "a second pointer cancels the box";
  "Escape cancels the box";
  "a background click reports the point";
  "a touch hold on the background opens the menu callback";
  "a mouse hold on the background does not".
- The box's computed `pointer-events` is `none`.
- Every existing Stage story still passes.

### T04 — Multigraph: selection state, ring, count and keyboard

|                |                                                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T01, T03                                                                                                                                                 |
| **Wave**       | 2                                                                                                                                                        |
| **Agent**      | default workhorse                                                                                                                                        |
| **Effort**     | M                                                                                                                                                        |
| **Files**      | new `components/ui/Multigraph/lib/selectionController.svelte.ts` + `.spec.ts`; `Multigraph.svelte`; `NodeActionMenu.svelte`; `Multigraph.stories.svelte` |
| **PR title**   | `feat(multigraph): select nodes with a box, the menu and Cmd/Ctrl+A`                                                                                     |

- `selectionController.svelte.ts`: a `SvelteSet<string>` behind `replace`,
  `add`, `toggle`, `clear`, `prune(graph)`, `has`, `size`, `ids`. Pure enough to
  spec in the `server` project where it does not touch the DOM.
- Wire the Stage callbacks: box end → `nodeIdsInScreenRect(focusCandidates(), …)`,
  additive adds; background click without Shift clears; Escape clears when
  nothing above it took the key; Cmd/Ctrl+A selects `visibleNodeIds` (guarded
  by `keyboardIsInTextEntry()`).
- Prune on every graph commit, in the same place `primaryNodeId` is
  re-pointed.
- Ring: `.node-wrapper.selected :global(.circle)` next to the merge ring
  (`:4201`), in a colour that is neither the amber merge ring nor the blue
  focus outline; `data-selected="true"` on the wrapper; `nodeAccessibleName`
  (`:2495`) appends ", selected".
- Count label: `aria-live="polite"`, bottom-left, below the toolbar's
  clearance, `data-selection-count`.
- `NodeActionMenu`: "Select" / "Deselect" item after "Merge", with `selected`
  passed in; its hint names the gesture that boxes.

**Acceptance**

- Stories: "user boxes three nodes and they are selected (rings, count,
  names)"; "a box with Shift adds to the selection"; "a click on empty canvas
  clears"; "Escape clears"; "Cmd/Ctrl+A selects every drawn node and not a
  hidden one"; "the menu's Select toggles one node"; "undo of a deletion that
  removed a selected node leaves no dangling id" (prune).
- Keyboard: Enter on a node still opens focus; `Cmd/Ctrl+A` inside a text
  field still selects text.
- The count label and the Tags dialog do not overlap at the phone viewport.

### T05 — Copy, cut and delete the selection

|                |                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T02, T04                                                                                                                              |
| **Wave**       | 3                                                                                                                                     |
| **Agent**      | default workhorse                                                                                                                     |
| **Effort**     | M                                                                                                                                     |
| **Files**      | `Multigraph.svelte`; `NodeActionMenu.svelte`; `Multigraph.stories.svelte`; `apps/mind-map-sv/src/routes/+page.svelte` (pass the port) |
| **PR title**   | `feat(multigraph): copy, cut and delete a node selection`                                                                             |

- `clipboard?: ClipboardPort` prop on Multigraph, defaulting to
  `systemClipboard()`; the page passes nothing, stories pass
  `memoryClipboard()`.
- `copySelection()`: `inducedSubgraph` → `embeddedAssetsForGraph` (using
  the `assetStore` and `assetScope` props Multigraph already holds) →
  `encodeNodeClipboard` → port write; notice "Copied N nodes."
- Window `copy` and `cut` listeners: step aside when `keyboardIsInTextEntry()`
  or `window.getSelection()?.toString()` is non-empty; otherwise with a
  selection, `clipboardData.setData('text/plain', …)`, `preventDefault`, and
  mirror into the port. The DOM event cannot await the asset read, so the
  payload is prepared when the selection changes (a `$derived` promise cached
  by selection identity) and the event writes the last resolved payload.
- `deleteSelection()`: fold `removeNode` over the ids, one commit with
  `editIntent('delete N nodes')`, through the existing exit animation path
  `deleteNode` (`:2591`) uses; `Delete` and `Backspace` call it (guarded).
- Cut = copy, then delete, one history entry.
- `NodeActionMenu`: "Copy" item; "Delete" label becomes "Delete N nodes" when
  the node is selected and the selection has more than one node.

**Acceptance**

- Stories: "Cmd/Ctrl+C with three selected writes a graph file to the memory
  clipboard holding exactly those nodes and the edges between them";
  "copy from the menu on a selected node copies the selection; on an
  unselected node copies that node"; "Delete removes the selection as one
  undo entry and undo restores all three"; "Cmd/Ctrl+C while text is selected
  in the details view does not touch the node clipboard".
- The three notice strings are measured at the phone viewport before they are
  committed (log the measurement in the PR).

### T06 — Paste, the size warning, and the background menu

|                |                                                                                                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T05, T07                                                                                                                                                                                        |
| **Wave**       | 4                                                                                                                                                                                               |
| **Agent**      | high-reasoning (asset hydration, pin seeding, reveal and animation paths meet here)                                                                                                             |
| **Effort**     | L                                                                                                                                                                                               |
| **Files**      | `Multigraph.svelte`; new `PasteSizeConfirmDialog.svelte`; `Multigraph.stories.svelte`; `graphPersistenceController.ts` (call the shared asset helper from T02); `+page.svelte` if a prop is new |
| **PR title**   | `feat(multigraph): paste nodes at a point, from the keyboard or the background menu`                                                                                                            |

- `pasteAt(anchor: Point, text: string)`: `decodeNodeClipboard` → `null`
  ignored silently; else compute `newAttachmentBytes` against the ids the
  store already holds for this scope; above the threshold, open
  `PasteSizeConfirmDialog` (same shape as `MergeConfirmDialog`) naming the
  total with `formatByteSize`, and continue only on "Paste anyway"; then
  `withSeededPinIfPinless` → `importGraphData(graph, incoming, { offset: pastePlacement(incoming, anchorGraphPoint) })`
  → put every embedded asset into the store, skipping ids already present
  (the `hydrateImportedAssets` rule) → `commitUserGraph(layoutRuntime.relaxAfterMutation(next), editIntent('paste N nodes'))`
  → enter animations for every arrived node and edge, as
  `handleNodeDoubleClickDropOntoBackground` (`:2019`) does for one → selection
  replaced by the arrived ids → notice "Pasted N nodes."
- Window `paste` listener (same guards as copy) reads
  `clipboardData.getData('text/plain')` and pastes at the pointer's last
  stage position, else the viewport centre. The last pointer position is a
  `pointermove` listener on the stage element in Multigraph, or a Stage
  hover report; pick whichever does not fight the Stage's capture.
- Background menu wiring: hold / right-click → `BackgroundActionMenu` at the
  point; "Paste here" calls the port's `readText` inside the activation, then
  `pasteAt`; "Select all"; "Clear selection".
- A pasted graph file's own `viewState`, `settings` and `documentId` are
  discarded, as `importGraphIntoCurrent` discards them.

**Acceptance**

- Stories: "paste after copy lands three new nodes centred on the anchor with
  fresh ids, the same two edges and the same relative layout"; "undo removes
  all of them in one step and the selection is empty"; "paste of a subgraph
  with no pinned node arrives pinned and visible"; "paste of a saved graph
  file's text imports it at the anchor"; "paste with a non-graph clipboard
  does nothing"; "cross-document paste stores the embedded image under its
  id and the node shows it" (two `MemoryGraphAssetStore` scopes); "a
  cross-document paste whose new attachments exceed the threshold asks once,
  naming the size; Cancel leaves the graph untouched and Paste anyway brings
  every attachment"; "a same-document paste of the same nodes never asks";
  "a promoted AI binding inside the selection points at the pasted twin".
- Existing Import… stories still pass with the refactored asset helper.
- The dialog sits below the toolbar like the Tags dialog
  (`2026-10-12--display--the-tags-dialog-stays-below-the-toolbar-and-can-fade.md`).

### T07 — Background action menu component

|                |                                                                                |
| -------------- | ------------------------------------------------------------------------------ |
| **Depends on** | —                                                                              |
| **Wave**       | 2 (alongside T04; touches no shared file)                                      |
| **Agent**      | fast/cheap — it is `NodeActionMenu` with three items and no node               |
| **Effort**     | S                                                                              |
| **Files**      | new `components/ui/Multigraph/BackgroundActionMenu.svelte` + `.stories.svelte` |
| **PR title**   | `feat(multigraph): background action menu with paste, select all and clear`    |

Either a second component sharing `NodeActionMenu`'s styles and keyboard
handling through an extracted `ActionMenuPill.svelte`, or `NodeActionMenu`
generalised over an `items` prop — the implementer picks whichever leaves
`NodeActionMenu.stories` untouched. Items: "Paste here" (hint: "Put the copied
nodes here"), "Select all" (hint: "Select every node on the canvas"), "Clear
selection" (only when `selectionCount > 0`). Focus, Escape, Tab and arrow
behaviour identical to the node menu.

**Acceptance**

- Stories: open, arrow between items, Escape closes and restores focus;
  "Clear selection" absent at count 0 and present at 2.
- Every item's hit box is at least 44 px tall at the phone viewport.

### T08 — Docs and close-out

|                |                                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T09                                                                                                               |
| **Wave**       | 6                                                                                                                 |
| **Agent**      | fast/cheap                                                                                                        |
| **Effort**     | XS                                                                                                                |
| **Files**      | `docs/roadmaps/TODO.md` (the paste-text-as-node follow-up); this plan's status; any `docs/debt/` file a task left |
| **PR title**   | `docs(roadmap): close the selection and clipboard plan`                                                           |

### T09 — Group drag of a selection

|                |                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T04 (and T06 for the file, since both edit `Multigraph.svelte`)                                                           |
| **Wave**       | 5                                                                                                                         |
| **Agent**      | default workhorse                                                                                                         |
| **Effort**     | M                                                                                                                         |
| **Files**      | `components/ui/Multigraph/lib/graph.ts` + `.spec.ts` (`translateNodes`); `Multigraph.svelte`; `Multigraph.stories.svelte` |
| **PR title**   | `feat(multigraph): drag a selected node to move the whole selection`                                                      |

- `translateNodes(data, nodeIds: ReadonlySet<string>, delta: Point): MultigraphData`
  — pure, immutable, a no-op for unknown ids.
- `handleNodeDragStart` on a node in the selection records the start
  position of every selected node; each `handleNodeMoved` computes
  `delta = point − draggedStart` and commits `translateNodes` from the
  recorded starts (so rounding never accumulates), through the same relax
  the single-node drag uses, with the same `'layout'` intent so the run lands
  in history exactly as a single drag does (which, per milestone 12, is not at
  all); `handleNodeDragEnd` settles as today, applying the
  pinned-node branch to every pinned node in the set. A drag that starts on
  an unselected node behaves exactly as before and leaves the selection as it
  was.
- The Stage is untouched: it already reports the dragged node and a graph
  point.

**Acceptance**

- Spec: `translateNodes` moves exactly the named nodes by the delta and
  returns the same object for an empty set.
- Stories: "dragging one of three selected nodes moves all three by the same
  delta, keeping their relative layout, and lands in history as a single drag
  does";
  "dragging an unselected node moves only it and the selection is unchanged";
  "dragging a selected pinned node keeps it pinned".

## Wave plan

```
Wave 1   T01  ‖  T02  ‖  T03     pure geometry, clipboard payload, Stage gesture — disjoint files
Wave 2   T04  ‖  T07             selection in Multigraph; background menu as a standalone component
Wave 3   T05                     copy / cut / delete (Multigraph.svelte, after T04 lands)
Wave 4   T06                     paste, size warning, menu wiring (after T05 and T07)
Wave 5   T09                     group drag (Multigraph.svelte, after T06)
Wave 6   T08                     docs
```

Total: 9 tasks, 6 gates. Nothing in a wave shares a file. T04, T05, T06 and
T09 all edit `Multigraph.svelte` and are strictly sequential for that reason.

## Risks and rollback

- **Touch double-tap-drag reliability.** iOS Safari delivers the second
  `pointerdown` promptly under `touch-action: none`, but the plan's manual
  check is on a real phone before T03 merges, as milestone 03 did for the node
  hold. If the second tap is unreliable, the fallback is a background hold
  that _arms_ a box (lift, then drag), reusing the menu-armed session shape
  the creation gesture already has.
- **`readText` is refused.** Firefox refuses it without a pref, Safari shows a
  callout the reader can dismiss. The memory mirror keeps same-tab paste
  working everywhere; cross-tab paste on those browsers needs Cmd/Ctrl+V,
  which goes through the DOM event and never asks. The notice says "Press
  Cmd+V to paste" when the menu's read comes back empty on a tab that never
  copied.
- **Clipboard size with embedded assets.** Copy embeds everything, so a
  node with a 40 MB attachment puts ~53 MB of base64 on the OS clipboard.
  Browsers accept it but the write is slow and some OS clipboards cap it; if
  the write fails the notice says the copy failed rather than claiming
  success. The owner chose to warn on paste, not to cap on copy; if copy
  failures show up in practice, a copy-side warning is the follow-up.
- **A pasted component is flung by physics.** Same accepted risk as import:
  disconnected components repel at max hops. Pasting next to the originals
  overlaps them for a moment and relaxation separates them; if that reads
  badly, nudge the placement by one diameter when the anchor sits inside the
  source bounds.
- **`Multigraph.svelte` grows again.** It is 4,477 lines. The controller
  module in T04 and the pure modules in T01/T02 keep the new logic out of it;
  the wiring that remains is on the order of the merge gesture's.
- **If T01's subgraph shape turns out wrong**, T04–T06 rebase on a pure
  function with a spec, which is the cheap place to be wrong. T01 lands first
  and gets a read before T04 starts.

## Definition of Done (this plan)

- All nine tasks merged to `feature/node-selection-copy-paste`, gates green on
  each, branch pushed.
- A phone smoke test of: box, Shift-less add via the menu, copy from the
  menu, paste from the background menu, group drag, undo. Logged in the Notes
  below.
- This plan's status `done`; TODO.md carries the paste-text-as-node
  follow-up.

## Notes

- 2026-10-18: `importGraphData` does not remap `addons.ai.promoted`. Found
  while tracing what a paste must carry; it affects Import… today and is
  fixed in T01 rather than filed, because paste would inherit it.
- 2026-10-18: shared asset ids between two nodes are already safe
  (`removeNodeContentBlock` checks `isAssetReferenced` graph-wide before
  reporting an asset removed), so a same-document paste need not copy blobs.
- 2026-10-18: owner's rulings taken in the planning conversation: any-overlap
  box (over centre-inside), warn-on-paste-above-threshold with every
  attachment carried (over a copy-side cap), group drag in scope (over a
  follow-up). Everything else as recommended.
- 2026-10-18 (close-out): desktop smoke test in the in-app browser against
  the dev server, with real pointer input where the tool allows it. A
  double-click-drag on empty canvas boxed exactly the two nodes under it (count
  "2 selected", names ", selected", no pan); "Paste here" from the background
  menu, opened by a real right-click, landed two new nodes centred on the
  press, the pinless copy arrived pinned, the arrivals became the selection and
  the toolbar read "Undo paste 2 nodes"; the same menu with nothing copied said
  "Nothing to paste."; a real drag of one pasted node carried both by the same
  delta and left history alone; the Delete key removed both ("Undo delete 2
  nodes") and a real click on Undo brought them back; Escape cleared. The
  keyboard copy fired through a dispatched `copy` event, because the browser
  pane delivers Cmd+C over the debugging protocol without the browser's own
  copy command, so no real-key copy or paste could be exercised there; the T05
  agent's Playwright probe did see real Cmd/Ctrl+C and X fire the events in
  headless Chromium. Not done: a real phone (double-tap-drag, hold menus) and
  Safari (`beforecopy`/`beforecut`/`beforepaste`, the activation rule for the
  menu's async write). Both are the owner's to run; nothing else is pending.
- 2026-10-18 (close-out): what the work found and left is in `docs/debt/`
  under this date — the outcome notice overwritten by the save status half a
  second after an edit is the one most worth paying first.
