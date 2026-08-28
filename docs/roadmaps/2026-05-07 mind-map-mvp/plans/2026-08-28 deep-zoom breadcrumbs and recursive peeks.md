# Plan: Deep-zoom breadcrumbs and recursive peek cards

**Created:** 2026-08-28
**Author:** Claude agent
**Milestone:** none — follow-up polish on the manual-dataflow work that landed
on top of [milestone 09](../milestones/09-variable-dataflow-layer.md) and
[milestone 11](../milestones/11-unified-hop-model-for-derived-edges.md).
The feature (user-confirmed input/output designations, the quantity peek card,
and jump-to-definition landing inside the details view) shipped without a
milestone doc of its own; these three follow-ups came out of using it.
**Status:** executing
**Total estimated effort:** M

## Summary

Three UX follow-ups on the manual-dataflow feature, agreed with the user:

- **A. Dismiss restyle.** The peek card's ✕ is styled unlike every other
  control in the card, which also leaves it visually misaligned with the row
  buttons beside it. It should read as the same kind of thing as "Go to node".
- **B. Breadcrumbs in deep zoom.** The nav stack is real navigation history but
  the only affordance for it is a single floating "Back to X" button, so
  unwinding three jumps takes three round trips through three cameras. Render
  the stack as a clickable trail along the overlay's top edge and let one click
  unwind several jumps.
- **C. Recursive peek cards.** A peek answers "what is this quantity?" with the
  definer's equation, and the next question is almost always "and what is _that_
  symbol?". Give each definer row a drill line — that node's confirmed inputs as
  chips — and let a chip open a nested peek card, uniformly and unboundedly.

## Open questions resolved

There is no milestone doc to carry questions over from, so these are the
decisions taken while planning, each verified against the code first.

- **Where the peek cascade scrolls.** **The root card becomes its own scroller**
  — `max-height: min(24rem, 55vh)`, `overflow: auto`, and a contained
  overscroll — and today's `max-height`/`overflow` moves off the inner `ul`. The
  focus overlay deliberately has no scroll container — `NodeChrome.svelte:79-90`
  plus the story `AddsNoScrollContainerSoWheelInputReachesTheZoomWorld` pin that,
  because wheel input has to reach the ZoomWorld underneath — and ZoomWorld's pan
  clamp makes below-frame content unreachable. So a deep cascade has to scroll
  _somewhere_, and the card is the only place left. The precedent already exists
  (the `ul` scrolls today), and the no-scroll story only walks `.focus-content`
  and `.description`, so it stays honest.

- **Where the dismiss sits once the card scrolls.** **Absolute top-right, last
  in the DOM, and outside the scroll wrapper.** Tab order `goto… → Close` is
  pinned by `KeyboardEnterOnAChipLandsInsideThePeekCard`, and a dismiss inside
  the scroller would scroll away from the reader who most needs it.

- **Whether a nested card is a dialog.** **Only the root card is
  `role="dialog"`; nested cards are `role="group"` with an aria-label.** Nested
  dialogs claim a modality the cascade does not have — every level stays visible
  and interactive at once.

- **Whether the trail records peek drilling.** **Node jumps only.** Drilling a
  peek deliberately does not move the reader, so recording it would make the
  trail describe something that never happened to the camera.

- **What the current crumb reads when the reader is inside an image level.**
  **`focus.levels[0]`, the root node level, not `focus.focusedNodeId`.** The
  latter is null at an image level, which would blank the trail's tail exactly
  when the reader is deepest.

- **Whether closing focus clears the trail.** **No.** _(Accepted flaw.)_ The
  trail can then read stale after the reader closes focus and manually focuses
  somewhere else — but that is the same flaw the single Back button has today,
  and clearing the stack would throw away seeds that are holding real nodes on
  screen.

- **What "Define x" does at depth.** **Still calls `leaveFocusForCanvasAction()`
  and discards the cascade.** _(Accepted.)_ Consistent with what it does today
  from the root card; preserving a cascade across a graph mutation and an overlay
  close is a bigger question than this plan.

- **Whether a repeated symbol is a loop.** **Per-path only.** A chip whose
  symbol is already open as an ancestor _along its own path_ renders as an inert
  loop marker; siblings may repeat symbols freely, because two different definers
  both consuming `m` is ordinary, not circular.

- **Accordion or tree.** **Tree — multiple branches open at once.** Closing a
  chip closes its branch and its descendants only.

- **How a path is encoded into a DOM attribute.** **`encodeURIComponent` per
  segment.** Quantity keys embed spaces (and worse), which are illegal raw in the
  attribute selectors every story uses to find a card.

## Out of scope (for this plan)

- Any change to what a designation _is_ or how it is confirmed. Chips are read
  from `node.inputs`/`node.outputs` exactly as they are today.
- Preserving a peek cascade across a jump or a graph mutation.
- Recording peek drilling in the nav stack (see the decision above).
- A breadcrumb trail on the canvas. The trail is a focus-mode affordance; the
  floating `[data-nav-back]` button stays as the canvas's single-step
  equivalent.

## Tasks

> Two agent waves. Wave A (T01–T03) is breadcrumbs plus the dismiss restyle;
> wave B (T04–T07) is the recursive cascade. They share only
> `QuantityPeekCard.svelte`'s stylesheet, which is why the restyle goes first.

### T01 — Restyle the peek dismiss as the control it is

|                |                                                                           |
| -------------- | ------------------------------------------------------------------------- |
| **Depends on** | —                                                                         |
| **Wave**       | A1                                                                        |
| **Agent**      | fast/cheap                                                                |
| **Effort**     | XS                                                                        |
| **Files**      | `Multigraph/QuantityPeekCard.svelte`, `NodeDetailsContent.stories.svelte` |
| **PR title**   | `fix(peek): style the peek dismiss like the card's other controls`        |

Delete `button.dismiss`'s border/background/color overrides so it inherits the
card's shared `button` rule — the same rule `.goto` inherits. Keep it absolutely
positioned in the top-right corner (`top`/`right: 0.5rem`) and widen the card's
right padding to `0.5rem 2.75rem 0.5rem 0.75rem` so the rows still clear it.

**Acceptance**

- New story `TheWayOutIsStyledLikeTheWayThrough`: computed border, background,
  and font-size of the dismiss equal those of `[data-peek-goto="earth"]`.
- Existing peek stories still pass, tab order included.

### T02 — Unwind the nav stack to any depth, and project it as crumbs

|                |                                                                             |
| -------------- | --------------------------------------------------------------------------- |
| **Depends on** | —                                                                           |
| **Wave**       | A1 (parallel with T01)                                                      |
| **Agent**      | default                                                                     |
| **Effort**     | S                                                                           |
| **Files**      | `Multigraph/lib/navStack.ts` + spec, `lib/transientReveal.svelte.ts` + spec |
| **PR title**   | `feat(nav): unwind the nav stack to any depth and project breadcrumbs`      |

`unwindNavStackTo(entries, index)` returns `{ entries, target }` or `null` when
the index is out of range; `pop` is exactly unwinding to `length - 1`. The
dropped entries' seeds need no extra work — `revealedNodeIdsOf` derives from the
array that remains, and entries `0..k-1` are precisely the ones holding the
target on screen.

`navBreadcrumbs(entries, currentNodeId, maxCrumbs = NAV_BREADCRUMB_MAX)` returns
`NavCrumb[]`, where a crumb is an entry, an ellipsis carrying its hidden count,
or the current node. Truncation keeps crumb 0, then the ellipsis, then the tail.

`TransientRevealController.unwindTo(index)` delegates to the pure function.

**Acceptance**

- Spec covers empty, single, exactly-at-cap and over-by-one trails.
- A tail crumb's `index` is its index in `entries`, **not** in the rendered
  array — the bug this spec exists to prevent.
- Unwind to 0, to the last entry, and out of range.
- A stack pruned in the middle still unwinds to a sensible target (the
  deleted-middle-entry case, covered here rather than in a story).

### T03 — Render the trail and hide the floating Back button in focus

|                |                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------- |
| **Depends on** | T02                                                                                                |
| **Wave**       | A2                                                                                                 |
| **Agent**      | default                                                                                            |
| **Effort**     | M                                                                                                  |
| **Files**      | new `Multigraph/NavBreadcrumbs.svelte` + stories, `Multigraph.svelte`, `Multigraph.stories.svelte` |
| **PR title**   | `feat(focus): show the jump trail as breadcrumbs in deep zoom`                                     |

`NavBreadcrumbs` is presentational: entry crumbs are buttons reporting their
index, ellipsis and current are inert spans, and every crumb truncates at
`8rem`. `Multigraph` derives `navCrumbs` from the stack plus `focusRootNodeId`,
and `navigateToCrumb(index)` becomes the single unwind path — `navigateBack()`
is `navigateToCrumb(depth - 1)`.

The trail renders inside `.focus-root` just before the Close button and only
while the dialog is open with more than one crumb. `[data-nav-back]` is hidden
while focused, which lets its z-index drop back to the toolbar default.

**Acceptance**

- `NavBreadcrumbs` stories: renders a trail, middle-truncates over the cap,
  click reports the entry's index, the current crumb is inert, long titles
  truncate.
- The three Multigraph stories that click `[data-nav-back]` while focused are
  rewritten against the trail **in the same commit** as the hiding change.
- New `BreadcrumbUnwindsSeveralJumpsInOneStep`: three jumps, one click on crumb
  0, one camera restore, the first origin's focus, later seeds gone, zero
  `onMultigraphChange`.
- New `TheFloatingBackButtonReturnsOnTheCanvas`.

### T04 — The peek cascade as a pure tree

|                |                                                                 |
| -------------- | --------------------------------------------------------------- |
| **Depends on** | —                                                               |
| **Wave**       | B1                                                              |
| **Agent**      | default                                                         |
| **Effort**     | M                                                               |
| **Files**      | new `Multigraph/lib/peekCascade.ts` + spec                      |
| **PR title**   | `feat(peek): model the peek cascade as a pure open-branch tree` |

`PeekStep`, `PeekPath`, `PeekBranch`, `PeekCascade`, plus `openCascade`,
`isBranchOpen`, `toggleBranch` (closing drops descendants), `closeBranch`,
`isLoop`, `serializePath`/`parsePath`. No prune function: the renderer iterates
live definer inputs and asks `isBranchOpen`, so a vanished chip's branch simply
stops rendering.

**Acceptance**

- Toggle open/close; closing an ancestor drops its descendants.
- Sibling branches are independent, including the same key under different rows.
- `isLoop` fires at the root key and at an intermediate key on the same path,
  and does not fire across siblings.
- `serializePath`/`parsePath` round-trip subscripted keys and hostile node ids.

### T05 — Extract the quantity chip so two surfaces can render it

|                |                                                                         |
| -------------- | ----------------------------------------------------------------------- |
| **Depends on** | —                                                                       |
| **Wave**       | B1 (parallel with T04)                                                  |
| **Agent**      | fast/cheap                                                              |
| **Effort**     | S                                                                       |
| **Files**      | new `Multigraph/QuantityChip.svelte`, `QuantityDesignationChips.svelte` |
| **PR title**   | `refactor(peek): extract QuantityChip so the drill line can reuse it`   |

Move the chip button/span markup **and its scoped CSS** out of
`QuantityDesignationChips`. Scoped styles do not cross component boundaries, so
leaving the rules behind would silently unstyle both call sites. Preserve every
attribute (`data-designation-role`/`-stale`/`-key`, `class:peeking`,
`aria-pressed`, `title`).

**Acceptance**

- Every existing `NodeEditSheet` and `NodeDetailsContent` chip story passes
  untouched.

### T06 — Recursive peek cards under one controller

|                |                                                                                        |
| -------------- | -------------------------------------------------------------------------------------- |
| **Depends on** | T04, T05                                                                               |
| **Wave**       | B2                                                                                     |
| **Agent**      | high-reasoning                                                                         |
| **Effort**     | L                                                                                      |
| **Files**      | `Multigraph/QuantityPeekCard.svelte`, `NodeDetailsContent.svelte`, `Multigraph.svelte` |
| **PR title**   | `feat(peek): drill into a definer's own inputs, recursively`                           |

`QuantityPeekCard` self-imports and becomes presentational: no document
listeners, no mount-focus effect, a `path` prop, and a `.drill` line per definer
row rendering that node's confirmed inputs as `QuantityChip`s. Open branches
render a nested card under the row, keyed by the **serialized path** — never by
index, or closing a sibling steals focus.

`NodeDetailsContent` becomes the single cascade controller and owns the one
document listener pair. N capture listeners each stopping propagation would
close the wrong card.

`Multigraph` threads `inputsForNodeId` returning the node's own array with a
module-level empty fallback — no map or filter, which would allocate per settle
frame and thrash the nested deriveds.

**Acceptance**

- `onCreateDefiningNode` is called with the **card's own** key, fixing the
  latent closure bug at `NodeDetailsContent.svelte:160-161`.
- Exactly one `document.addEventListener` pair in the peek subtree.
- Escape closes the card holding focus, deepest first.

### T07 — Stories for the cascade

|                |                                                                     |
| -------------- | ------------------------------------------------------------------- |
| **Depends on** | T06                                                                 |
| **Wave**       | B3                                                                  |
| **Agent**      | default                                                             |
| **Effort**     | M                                                                   |
| **Files**      | `Multigraph/NodeDetailsContent.stories.svelte`                      |
| **PR title**   | `test(peek): cover drilling, branching, loops, and the Escape walk` |

Extend `peekAtG`, add `drillInto(card, definerId, key)`, and cover: drill chips
come from confirmed inputs; drilling opens a nested card under that row; two
branches stay open at once; closing a branch closes its descendants; a repeated
symbol on one path is an inert loop marker; the same symbol opens independently
under sibling rows; Enter on a drill chip lands inside the nested card; three
Escapes walk depth 2 → 1 → gone → chip focused; "Define" at depth reports the
nested card's key; "Go to node" at depth leaves and closes everything; a
six-level cascade scrolls the root card and stops indenting after four.

**Acceptance**

- Both vitest projects green; no story skipped.

## Wave plan

```
Wave A1   T01  ‖  T02        (CSS-only vs pure module; no shared files)
Wave A2   T03                (needs T02; touches Multigraph + its stories)
Wave B1   T04  ‖  T05        (pure module vs component extraction)
Wave B2   T06                (integration; the only task touching all three)
Wave B3   T07                (story coverage for B2)
```

Waves A and B are handed to separate agents. A finishes first because T01
rewrites the very `QuantityPeekCard` stylesheet T06 restructures.

## Risks and rollback

- **Listener stacking.** Exactly one document listener pair, in the controller.
  Grep the peek subtree for stray `document.addEventListener` before finishing.
- **Focus churn.** `focusRequestPath` must be consumed and cleared in one
  effect, or every re-render refocuses the deepest card.
- **Identity stability.** `inputsForNodeId` returns the node's own array;
  `nodeById` rebuilds on graph churn, so per-card work stays cheap (a few
  `symbolFor` calls) and nothing memoizes on the prop.
- **`{#each}` keys.** Serialized path, never index.
- **Overlay layout.** The trail (z 65) sits beside the Close button inside
  `.focus-root` (60). Check mobile widths for overlap.
- **Story rewrites.** The three Multigraph stories asserting `[data-nav-back]`
  while focused must land in the same commit as the hiding change, or the suite
  goes red mid-sequence.

## Definition of Done (this plan)

- Lint, `svelte-check` (0/0), and both vitest projects green, with the rewritten
  Multigraph stories passing rather than skipped.
- `pnpm --filter mind-map-sv test:e2e` green as a regression (no e2e test
  touches these selectors).
- Offline shell rebuilt in its own `chore(build):` commit before merge.
- Manual browser smoke with real pointer input — synthetic events have masked
  hit-testing bugs here twice: breadcrumb multi-unwind lands in the right deep
  zoom with the right camera; drill three levels including a loop chip; the
  Escape walk; wheel over the card scrolls the cascade; breadcrumbs versus the
  Close button at mobile width.

## Notes

- 2026-08-28: Verified anchors at planning time, in
  `apps/mind-map-sv/src/lib/components/ui/`. `QuantityPeekCard.svelte` — dismiss
  overrides :200-208, mount-focus :61-63, document listeners :65-86, `ul`
  scroller :158-167. `NodeDetailsContent.svelte` — `openPeekKey` :66-68,
  open/close :89-98, `{#key}` remount :151-164, `onCreateDefiningNode` closure
  :160-161. `Multigraph.svelte` — `jumpToNode` :1061, `navigateBack` :1095,
  `enterFocusOnNode` :1119, nav-back markup :1476-1492, details wiring
  :1978-1990, focus overlay root :1997-2035, Close button :2012,
  `.focus-close-button` z 65 :2205, `.nav-back-button` z 70 :2246, `nodeById`
  :525.
- 2026-08-28: This work has no milestone doc because the manual-dataflow feature
  it extends has none either. If a milestone is ever written for that feature,
  link it from the header above.
- 2026-08-28: Wave A (T01–T03) landed: breadcrumbs, the dismiss restyle, and the
  nav-stack unwind, with the three `[data-nav-back]` stories rewritten against
  the trail.
- 2026-08-28: Wave B (T04–T07) landed. `lib/peekCascade.ts` + spec is the open-
  branch tree; `QuantityChip.svelte` carries the chip markup and its scoped CSS
  for both surfaces; `QuantityPeekCard.svelte` self-imports and is purely
  presentational; `NodeDetailsContent.svelte` is the single cascade controller
  with the one document listener pair; `Multigraph.svelte` threads
  `inputsForNodeId` off a module-level `EMPTY_DESIGNATIONS`. Both vitest projects
  are green at 1418 tests (1386 + 20 cascade specs + 12 cascade stories),
  `svelte-check` reports 0/0, lint and Prettier are clean, and the offline shell
  fingerprint is fresh after a rebuild.
- 2026-08-28: One addition beyond the plan's attribute list — each drill chip
  also carries `data-peek-drill-path`, the same serialized path its card gets.
  The Escape handler needs to focus the chip that opened a card, and the obvious
  `[data-peek-drill="<key>"]` lookup cannot be escaped for a selector: quantity
  keys embed a NUL and `CSS.escape` replaces it with U+FFFD rather than escaping
  it, so the selector would silently miss for every subscripted quantity.
- 2026-08-28: Still open before this plan is `done` — the `test:e2e` regression
  run, the manual browser smoke listed above, the commit sequence, and the
  offline shell's own `chore(build):` commit (the rebuilt
  `static/offline-app-shell.html` is currently an uncommitted working-tree
  change).
