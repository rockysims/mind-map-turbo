# Plan: Deep-zoom chip cycling and the define flow

**Created:** 2026-08-28
**Author:** Claude agent
**Milestone:** none — follow-up polish on the manual-dataflow work that sits on
top of [milestone 09](../milestones/09-variable-dataflow-layer.md) and
[milestone 11](../milestones/11-unified-hop-model-for-derived-edges.md), and
directly on [the breadcrumbs/recursive-peeks plan](<./2026-08-28 deep-zoom breadcrumbs and recursive peeks.md>).
The feature has no milestone doc of its own; these two follow-ups came out of
using it.
**Status:** executing
**Total estimated effort:** M

## Summary

Two UX changes to the manual-dataflow feature, agreed with the user:

- **A. The define flow finishes the job.** Clicking "Define k" — from the
  details view's diagnostics row or from any peek card in the cascade — creates
  the node, but then leaves the author on the canvas with an empty node to find
  and open by hand. It should exit deep zoom, fly the camera to the new node,
  and open it in **inline title edit with the title `$k = $` and the caret just
  before the closing `$`**, so the next keystroke is the right-hand side. It
  should also push a nav-stack entry, so Back returns to the deep zoom the
  author left.

- **B. Chips in the details view cycle on tap and answer on hold.** Today a
  view-mode chip only opens a peek card, so changing a designation means a round
  trip through the edit sheet. **Click = cycle the designation** (the same
  semantics the edit sheet already has: a ghost confirms its suggested role in
  one tap, then the other role, then unassign; commits immediately).
  **Long-press or right-click = open the peek card, now on every chip** —
  inputs, outputs and ghosts alike, so an output's peek lists every definer of
  that symbol and surfaces conflicts.

## Open questions resolved

There is no milestone doc to carry questions over from, so these are the
decisions taken while planning, each verified against the code first.

- **Where the equation for a defined node lives.** **In the title, with the
  description empty.** Titles define on equal terms with descriptions in this
  app, the node's whole content is one equation, and seeding both would put the
  same statement in two places that have to stay in sync. `updateNodeContent`
  spreads only title/description/tags, so the seeded `outputs` survive the
  author's first title commit.

- **Where the caret goes.** **Just before the closing `$`** —
  `title.length - 1`. The author asked for a definition; what they have to type
  is the right-hand side, inside the math. Select-all (today's behavior) would
  make the first keystroke delete the equation they just asked for.

- **How the caret is expressed.** **An optional `caretAt` on
  `titleEditContext`, threaded to `NodeCompactContent` as `titleCaretAt`.**
  Absent means select-all, so every existing caller is unchanged; present means
  `setSelectionRange`. A `{start, end}` selection was the alternative and buys
  nothing today.

- **What the nav entry's origin is.** **`focusRootNodeId`, never
  `consumerNodeId`.** The consumer can be a definer three peek levels down, and
  the reader has never seen that node's details — Back has to return them to the
  node whose details were actually on screen.

- **What a chip's `aria-pressed` means once it cycles.** **Dropped in view
  mode.** A three-state cycle button is not a toggle, and `aria-expanded` would
  be a second lie. The peeked chip carries `data-designation-peeking="true"` as
  the styling and test hook; the peek dialog's own role and label carry the AT
  semantics.

- **Which pointer types long-press.** **All of them, mouse included.** Right-click
  stays the fast desktop path, but a reader arriving from mobile should not have
  to learn a second gesture to ask the same question.

- **Whether cycling needs an undo.** **No.** No undo exists anywhere in the app
  yet, and the cycle is reversible in at most two taps by construction.

- **Whether a definer row in a peek offers "Go to node" for the node you are
  already in.** **No** — a `currentNodeId` thread omits it on that row. The
  equation still renders; only the navigation that goes nowhere is dropped.

## Verified constraints (bake in; do not rediscover)

Anchors are as of 2026-08-28, in
`apps/mind-map-sv/src/lib/components/ui/`.

1. `createDefiningNode`'s `consumerNodeId` can be a definer **three levels
   deep** (`QuantityPeekCard` passes `path.at(-1)?.definerNodeId`) — the nav
   entry's origin must be `focusRootNodeId` (`Multigraph.svelte:333`).
2. `leaveFocusForCanvasAction()` → `closeOverlays()` **clears
   `titleEditContext`** (`Multigraph.svelte:947`). The title-edit context must
   be set AFTER the focus exit. Hard ordering constraint.
3. `revealedNodeId: null` is right for the new node: an edge-less node is its
   own component, hence its own beacon, hence always visible
   (`lib/beacons.ts:41`); beacons ignore derived edges.
4. `commitInlineTitleSyntax` → `updateNodeContent` spreads only
   title/description/tags, so seeded `outputs` survive. `parseTitleSyntax`
   passes `$k = $` through untouched (it strips leading `>`/`<` and `#`/`@`;
   `$` and `=` are plain text) — pinned by spec. An emptied title falls back to
   "New Node" (accepted).
5. The cascade-close effect (`NodeDetailsContent.svelte:121-127`) and
   `peekLabel` (`:113`) consult only `designations.inputs` — cycling a peeked
   chip into the output column would slam the open card shut. Both must consult
   inputs ∪ outputs ∪ suggestions.
6. Cycling moves a chip between two `{#each}`/`<ul>` blocks: destroy + create,
   so keyboard focus is lost. Refocus by key after re-render — and
   `querySelector` does NOT work, because subscripted keys embed a NUL and
   `CSS.escape` replaces it with U+FFFD. Scan `data-designation-key` attributes
   (as `NodeDetailsContent.svelte:168` already documents).
7. Stage never uses DOM `click` (it synthesizes from `pointerup` and guards with
   `longPressFired`), but a DOM button does get a real click after pointerup —
   so click suppression after a long-press must live in the chip's own click
   handler (`suppressClickForKey`, cleared only by the trailing click, never in
   `pointerup`).
8. The focus overlay is a **sibling** of Stage with no pointer handlers, so a
   chip `contextmenu` never reaches Stage's handler — but nothing suppresses the
   native browser menu either. The chip handler must `preventDefault()`.
9. The commit path for a designation change is `commitContentGraph`
   (`Multigraph.svelte`), whose doc explains that dataflow changes are topology
   changes. NOT `saveNodeContent`, which calls `closeOverlays()`.
10. `lib/longPress.ts` is a reusable pure predicate; only Stage's suppression is
    canvas-coupled.
11. Keyboard peek is `Shift+Enter` (preventDefault + `onPeek`). Do NOT also
    handle the `ContextMenu` key: browsers that support it fire a real
    `contextmenu` on the focused element, and double-handling toggles the card
    shut. Note user-event v14 does not synthesize `contextmenu` from
    `{ContextMenu}` — stories dispatch `MouseEvent('contextmenu')`.

## Out of scope (for this plan)

- Undo for a designation change.
- Preserving a peek cascade across the graph mutation a Define makes — Define
  still leaves focus and discards the cascade, as it does today.
- Edit-sheet chips and peek drill chips: their gestures are unchanged.
- Any change to what a designation _is_ or how the dataflow layer derives from
  it.

## Tasks

> Two waves, handed to separate agents. Wave 1 is the define flow and touches
> `Multigraph.svelte` plus the shared `Node` title input; wave 2 is the chip
> gesture split. They share no files.

### T01 — Define lands the author in the equation title

|                |                                                                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                                                                            |
| **Wave**       | 1                                                                                                                                            |
| **Agent**      | high-reasoning                                                                                                                               |
| **Effort**     | M                                                                                                                                            |
| **Files**      | `Multigraph/Multigraph.svelte`, `Node/Node.svelte`, `Node/NodeCompactContent.svelte`, `Multigraph.stories.svelte`, `lib/titleSyntax.spec.ts` |
| **PR title**   | `feat(dataflow): land Define in the new node's equation title`                                                                               |

Rewrite `createDefiningNode`, in this order:

1. Read the departure state **before** anything closes: `originNodeId =
focusRootNodeId`, `originFocused = focus.isFocused`, and a `stageViewState`
   snapshot.
2. `leaveFocusForCanvasAction()`.
3. Build and commit the new seed: ``addNode({ title: `$${quantityLabel} = $`,
description: '', position, outputs })`` — outputs exactly as today —
   then `commitUserGraph(relaxAfterMutation(nextGraph, null, 1))`.
4. `if (originNodeId) transientReveal.push({ originNodeId, viewState,
revealedNodeId: null, originFocused })`.
5. `fitViewRequest` on `boundsForNodeIds([newNode.id])`, read after the commit
   so the derived layout has placed the node (the `jumpToNode` pattern; fitView
   applies synchronously in Stage's effect, so there is no tween race).
6. `titleEditContext = { nodeId: newNode.id, caretAt: title.length - 1 }` —
   **last**, per constraint 2.

Add an optional `caretAt` to `titleEditContext` and thread it as `titleCaretAt`
through `Node` to `NodeCompactContent`, whose rAF handler applies
`setSelectionRange` when it is present and keeps `select()` when it is not.

**Acceptance**

- `DefineButtonInFocusCreatesTheMissingNode` rewritten: the title `<input>`
  exists, its value is `$m = $`, it is `document.activeElement`,
  `selectionStart === selectionEnd === value.length - 1`, the committed node's
  description is `''`, and the derived edge still arrives.
- New `DefineFromDeepZoomLandsInTheEquationTitleReadyToType`: Define from a
  nested peek card defines the card's own quantity, and the nav entry's origin
  is the focused node, not the deep consumer (constraint 1).
- New `BackAfterDefineReturnsToTheConsumersDetails`: `[data-nav-back]` appears
  on the canvas, the camera has moved, and clicking it restores both the camera
  and the origin's details.
- A `titleSyntax` spec case pinning that `$k = $` (and `$v_0 = $`) survive the
  parser untouched.
- **Eyeball in the dev app**: the focus-exit morph runs concurrently with the
  camera fit. Geometry is computed live per render so no tear is expected, but
  the compound motion is unreviewed. If it reads badly, fit first and delay the
  exit — no timers without seeing it.

### T02 — `QuantityChip` accepts the gesture handlers

|                |                                                             |
| -------------- | ----------------------------------------------------------- |
| **Depends on** | —                                                           |
| **Wave**       | 2a                                                          |
| **Agent**      | fast/cheap                                                  |
| **Effort**     | XS                                                          |
| **Files**      | `Multigraph/QuantityChip.svelte`                            |
| **PR title**   | `refactor(chips): accept pointer and context-menu handlers` |

Add typed optional handler props alongside `onclick`: `oncontextmenu`,
`onpointerdown`/`up`/`cancel`/`move`/`leave`, `onkeydown` — explicit props, not
a widened `attributes` bag (the header comment explains the string typing, and
AGENTS.md forbids unexplained casts). Add `user-select: none` to `.chip`.

Do **not** set `touch-action: none`: wheel and pinch must keep reaching
ZoomWorld, and a scroll canceling the hold is the correct outcome.

**Acceptance**

- Every existing chip story passes untouched.

### T03 — `lib/chipPress.ts`: the press recognizer, pure

|                |                                                          |
| -------------- | -------------------------------------------------------- |
| **Depends on** | —                                                        |
| **Wave**       | 2a (parallel with T02)                                   |
| **Agent**      | default                                                  |
| **Effort**     | S                                                        |
| **Files**      | new `Multigraph/lib/chipPress.ts` + spec, `appConfig.ts` |
| **PR title**   | `feat(chips): recognize a chip long-press, purely`       |

`beginChipPress(key, point, nowMs)`, `trackChipPress(press, point)`
(accumulating max drift), `isChipLongPress(press, nowMs, { minDuration,
maxDistance }?)`, built over the existing `recognizeLongPress`. Defaults come
from a new `APP_CONFIG.multigraph.dataflow.chipPeekLongPressMs: 500` plus the
existing distance constant, passed as parameters (canvas's 1000 ms is too long
for a chip).

**Acceptance**

- Fires at exactly `minDuration`, not before.
- Drift past `maxDistance` disqualifies the press even if the pointer returns.
- A different key never matches.

### T04 — `QuantityDesignationChips`: tap decides, hold asks

|                |                                                         |
| -------------- | ------------------------------------------------------- |
| **Depends on** | T02, T03                                                |
| **Wave**       | 2b                                                      |
| **Agent**      | high-reasoning                                          |
| **Effort**     | M                                                       |
| **Files**      | `Multigraph/QuantityDesignationChips.svelte`            |
| **PR title**   | `feat(chips): cycle a designation on tap, peek on hold` |

- `isInteractive` in view mode becomes `onCycle !== undefined || onPeek !==
undefined`, so outputs and ghosts become buttons.
- `activate` (click): if `suppressClickForKey === key`, clear it and return;
  otherwise `onCycle?.(symbol, suggestedRole)` — in both modes.
- `onpointerdown`: `button === 0` only, all pointer types; begin the press,
  clear the suppress flag, start the timer at `chipPeekLongPressMs`. On fire:
  set `suppressClickForKey = key` and call `onPeek?.(key, element)` with the
  element captured at pointerdown.
- `onpointermove` tracks drift. `onpointerup`/`cancel`/`leave` clear the **timer
  only** — never the suppress flag, which only the trailing click clears
  (constraint 7; this is the classic bug).
- `oncontextmenu`: `preventDefault()`; return early if `suppressClickForKey !==
null` (Android synthesizes a contextmenu from a touch long-press, and a double
  fire toggles the card shut); otherwise `onPeek`.
- `onkeydown`: `Shift+Enter` → `preventDefault()` + `onPeek`. Nothing for the
  ContextMenu key (constraint 11).
- Focus restoration: `refocusKey` set in `activate`; an `$effect` after the
  columns re-derive scans rendered `data-designation-key` attributes
  (constraint 6), focuses the chip, clears the key in the same effect, and
  guards on `document.activeElement` still being inside the section so a pointer
  cycle does not yank focus.
- Tooltips name both gestures; view-mode hint text becomes
  `Tap to cycle a quantity; hold or right-click to see where it is defined.`
- Drop `aria-pressed` in view mode; add `data-designation-peeking="true"` on the
  peeked chip. Delete the unused `data-designation-edit-hint`.
- Rewrite the header doc comment: "nothing here mutates" becomes false.

### T05 — `NodeDetailsContent`: pass the cycle down, stop closing on a column change

|                |                                                                              |
| -------------- | ---------------------------------------------------------------------------- |
| **Depends on** | T04                                                                          |
| **Wave**       | 2b                                                                           |
| **Agent**      | default                                                                      |
| **Effort**     | S                                                                            |
| **Files**      | `Multigraph/NodeDetailsContent.svelte`, `Multigraph/QuantityPeekCard.svelte` |
| **PR title**   | `feat(details): cycle designations from the details view`                    |

New props: `onCycleDesignation?: (symbol, suggestedRole?) => void` (passed as
the chips' `onCycle`; absent leaves chips peek-only, which keeps the
prop-light stories valid) and `currentNodeId?: string`, threaded to
`QuantityPeekCard` so the row whose definer id equals it omits "Go to node".

`peekLabel` and the cascade-close effect must consult inputs ∪ outputs ∪
suggestions (constraint 5), with both comments updated: a quantity leaving the
node entirely still closes the card; a column change must not. Update the
"Read-only here on purpose" comment.

### T06 — `Multigraph`: the mutation

|                |                                |
| -------------- | ------------------------------ |
| **Depends on** | T05                            |
| **Wave**       | 2b                             |
| **Agent**      | default                        |
| **Effort**     | XS                             |
| **Files**      | `Multigraph/Multigraph.svelte` |
| **PR title**   | (folded into the T04 commit)   |

```
function cycleNodeDesignation(nodeId, symbol, suggestedRole) {
  const node = nodeById[nodeId]; if (!node) return;
  const next = cycleDesignation({ inputs: node.inputs, outputs: node.outputs }, symbol, suggestedRole);
  commitContentGraph(setNodeDesignations(graph, nodeId, next));
}
```

Wire `onCycleDesignation` and `currentNodeId={detailsNode.id}` at the
`NodeDetailsContent` call site. Reactivity is free (`nodeById` is derived off
`graph`; the details `designations` are derived off the node's fields). Rapid
clicks are safe — synchronous reads and assignments, with the relax/settle
restarting rather than queuing.

### T07 — The story sweep

|                |                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| **Depends on** | T04, T05, T06                                                                                        |
| **Wave**       | 2b (same commit — the suite must never go red mid-sequence)                                          |
| **Agent**      | default                                                                                              |
| **Effort**     | M                                                                                                    |
| **Files**      | `NodeDetailsContent.stories.svelte`, `Multigraph.stories.svelte`, `DataflowHarness.svelte` + stories |
| **PR title**   | (folded into the T04 commit)                                                                         |

**`NodeDetailsContent.stories.svelte`**: switch `peekAt` / `peekAtG` from
`.click()` to a local `dispatchContextMenu(chip)`, which fixes sixteen stories
unchanged (the peek, drill, branch, loop, Escape and cascade-scroll set). Swap
`PeekShowsEveryDefiner…`'s `aria-pressed` assert for
`data-designation-peeking`. Rewrite
`KeyboardEnterOnAChipLandsInsideThePeekCard` →
`ShiftEnterOnAChipLandsInsideThePeekCard` (keeping the tab-order and Escape
asserts) and `TappingTheChipAgainTakesTheQuestionBack` →
`HoldingTheChipAgainTakesTheQuestionBack`.

**`Multigraph.stories.svelte`**: `jumpFromPeek` and the new `openPeekCard`
helper both open a peek by clicking a view chip — both become contextmenu.
Scope `confirmSuggestedChips` and `clearDesignationChips` to
`[data-designation-chips="edit"]`, since view chips now respond to clicks.

**`DataflowHarness.svelte`** and its stories: scope chip selectors to the edit
surface. **`NodeEditSheet.stories.svelte`**: untouched. **E2E**: no impact.

**New stories** — `NodeDetailsContent.stories.svelte`:
`ClickingAViewChipCyclesItsDesignation` (spy args `[symbol, suggestedRole]`);
`ConfirmingAGhostFromTheDetailsViewTakesOneTap`;
`HoldingAChipOpensItsDefinition` (touch pointerdown plus a sleep past the
tunable); `AMouseHoldOpensItsDefinitionToo` (pins the all-pointers decision);
**`ALongPressDoesNotAlsoCycle`** (long-press then trailing click; the cycle spy
is never called — the one that earns its keep);
`RightClickOnAnOutputChipListsEveryDefiner`;
`HoldingAGhostChipAnswersWithoutConfirmingIt`;
`TheChipKeepsFocusAfterItChangesColumn`; `ChipTitlesNameBothGestures`; and a
self-row story asserting the focused node's own definer row has no
`data-peek-goto`.

**New stories** — `Multigraph.stories.svelte`:
`CyclingAChipInDeepZoomDrawsTheEdge` and `…OffTakesTheEdgeAway`, both asserting
on the graph and on `[data-edge-derived]`.

## Wave plan

```
Wave 1    T01                 (define flow; Multigraph + Node title input)
Wave 2a   T02  ‖  T03         (chip props vs. pure recognizer; no shared files)
Wave 2b   T04 → T05 → T06 → T07  (one commit: the gesture split and its sweep)
```

Wave 1 and wave 2 share no files and could in principle run at once; they are
sequenced only because wave 2 is the larger risk and benefits from a settled
suite underneath it.

## Gates

After T01, and again after T04–T07:
`pnpm --filter mind-map-sv lint` · `check` (0/0) · `test:unit -- --run`
(1418 before this plan; the count rises, and no story is deleted rather than
converted). Before merging: build plus `check:offline-shell`, with the shell in
its own `chore(build):` commit.

Manual browser smoke with **real** input — this branch has twice caught bugs
that synthetic events masked: click-cycle a ghost in deep zoom and watch the
edge appear; right-click opens a peek; a touch long-press does not double-fire;
Define lands in a title edit with the caret in the gap; Back returns to the
origin's details; Shift+Enter peeks; Enter cycles without losing focus.

Commit sequence: `feat(dataflow)` define flow (T01 and its stories) →
`feat(dataflow)` chip gesture split (T02–T07 in one commit, so the suite never
goes red) → `chore(build)` shell. Merge into `temp` with `--no-ff`.

## Risks and rollback

- **Click-after-long-press suppression.** The classic bug is clearing the
  suppress flag in `pointerup`; `ALongPressDoesNotAlsoCycle` is the tripwire.
- **Android's synthetic contextmenu** double-firing after a touch long-press.
- **Focus restoration across the column move** — attribute scan, never
  `querySelector` (NUL keys).
- **The cascade-close effect firing on a column change** (constraint 5) would
  make cycling a peeked chip feel broken.
- **Title-edit ordering versus `closeOverlays()`** (constraint 2).
- **The compound exit-morph plus camera-fit motion** — eyeball it; the fallback
  is to fit before the exit, with no timers.

## Definition of Done (this plan)

- Lint, `svelte-check` (0/0), and both vitest projects green.
- `pnpm --filter mind-map-sv test:e2e` green as a regression.
- The manual browser smoke above.
- Offline shell rebuilt in its own `chore(build):` commit before merge.
- Plan status `done`.

## Notes

- 2026-08-28: **T01 landed.** `createDefiningNode` now reads the departure state
  first, exits focus, commits a node titled `$k = $` with an empty description,
  pushes the nav entry from `focusRootNodeId`, fits the camera to the new node,
  and sets `titleEditContext` last. `titleEditContext` grew an optional
  `caretAt`, threaded as `titleCaretAt` through `Node.svelte` to
  `NodeCompactContent.svelte`, whose rAF handler now clamps it and calls
  `setSelectionRange`; absent, it still calls `select()`, so the two existing
  producers (`handleNodeDoubleClickDropOntoBackground` and the initial
  title-edit path at `Multigraph.svelte:685`) are unchanged. Both vitest
  projects are green at 1422 tests (1418 + 2 `titleSyntax` cases + 2 stories),
  `svelte-check` reports 0/0, and lint and Prettier are clean.
- 2026-08-28: T01 added three helpers to `Multigraph.stories.svelte` —
  `openPeekCard`, `drillIntoPeek` and `openTitleInput`. **`openPeekCard` opens a
  peek by clicking a view chip**, so wave 2's sweep must convert it to
  `contextmenu` alongside `jumpFromPeek`; it exists precisely so that is one
  edit rather than several.
- 2026-08-28: Still unrun for T01 — the dev-app eyeball of the exit morph
  against the camera fit, and `test:e2e`. Nothing is committed yet.
- 2026-08-28: **T02–T07 landed** (wave 2, one working tree). `QuantityChip`
  takes named `oncontextmenu` / `onpointerdown|up|cancel|move|leave` /
  `onkeydown` props and `user-select: none` (no `touch-action`). New
  `lib/chipPress.ts` (`beginChipPress` / `trackChipPress` / `isChipLongPress`,
  the last taking `{ key, minDuration, maxDistance }`) over `recognizeLongPress`,
  with `APP_CONFIG.multigraph.dataflow.chipPeekLongPressMs: 500` and the
  existing `interaction.longPressDistancePx` as its defaults; seven spec cases.
  `QuantityDesignationChips` now cycles on a click in **both** modes, opens the
  peek on a hold of **any** pointer type, on `contextmenu`, and on Shift+Enter;
  `aria-pressed` is gone and `data-designation-peeking="true"` marks the peeked
  chip; `data-designation-edit-hint` is deleted and the header comment rewritten.
  `NodeDetailsContent` gained `onCycleDesignation` and `currentNodeId`, and its
  `peekLabel` and cascade-close effect now read inputs ∪ outputs ∪ suggestions.
  `QuantityPeekCard` omits "Go to node" on the row whose definer is
  `currentNodeId`. `Multigraph.cycleNodeDesignation` commits through
  `setNodeDesignations` + `commitContentGraph`.
- 2026-08-28: Two implementation notes worth keeping. **Click suppression** is a
  single `suppressClickForKey`, set inside the hold timer _before_ `onPeek` and
  cleared only by the trailing click (and by the next `pointerdown`); every
  `pointerup`/`cancel`/`leave` clears the timer alone. **Focus restoration**
  records `refocusKey` in `activate` and not in the effect: the cycle destroys
  the chip, so by the time the columns have re-rendered `document.activeElement`
  has already fallen back to the body and an effect-time "is focus still in
  here?" guard would never fire. The effect then scans `data-designation-key`
  attributes (never `querySelector` — NUL keys) and focuses the match.
- 2026-08-28: Story sweep done. `NodeDetailsContent.stories`' `peekAt` opens
  with a hand-built `contextmenu`, which carried sixteen stories unchanged;
  `KeyboardEnterOnAChip…` → `ShiftEnterOnAChip…` and
  `TappingTheChipAgain…` → `HoldingTheChipAgain…`; ten new stories including
  `ALongPressDoesNotAlsoCycle`, `AMouseHoldOpensItsDefinitionToo` and
  `ThePeekOffersNoWayToTheNodeYouAreAlreadyIn`. Two of the new ones own their
  node through a `{#snippet template()}` so the columns really change under the
  chip. `Multigraph.stories`' `openPeekCard` became the one place the gesture
  lives and `jumpFromPeek` now calls it; `confirmSuggestedChips` /
  `clearDesignationChips` and both `DataflowHarness` helpers are scoped to
  `[data-designation-chips="edit"]`. `NodeEditSheet.stories` untouched.
- 2026-08-28: Gates after wave 2 — both vitest projects green at **1441** tests
  (1422 + 7 `chipPress` + 10 `NodeDetailsContent` + 2 `Multigraph`; no story
  deleted rather than converted), `svelte-check` 0/0, `eslint` and Prettier
  clean, `pnpm --filter mind-map-sv build` succeeds and
  `check-offline-shell-fresh.mjs` reports fresh. Still unrun: `test:e2e` and the
  manual browser smoke with real input. Nothing is committed; the regenerated
  `static/offline-app-shell.html` is in the working tree awaiting its own
  `chore(build):` commit.
