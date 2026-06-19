# Plan: Thin the Multigraph component

**Created:** 2026-06-13
**Author:** Cursor agent
**Milestone:** [milestones/04h-multigraph-thin-component-refactor.md](../milestones/04h-multigraph-thin-component-refactor.md)
**Status:** done
**Total estimated effort:** M

## Summary

Behavior-preserving decomposition of `Multigraph.svelte` (~940 lines) into the
repo's "pure logic in `lib/*.ts`, thin component" shape: extract presentation
math, the duplicate-edge dialog, and the animation/relaxation runtime into
tested modules and a sub-component, smallest/safest first, the runtime last.

## Open questions resolved

Carried from the milestone's "Risks and open questions":

- **Runtime shape: class vs. function module.** **Use a class-based
  `Multigraph/lib/layoutRuntime.svelte.ts`** with `$state` fields for the
  loop-only state. Rationale: the loop is inherently stateful and reactive; a
  runes class keeps reactivity intact while making the state machine
  instantiable in a spec, whereas a plain function module would force the
  component to thread every piece of loop state back in on each call.
- **Ownership boundary (what moves vs. stays).** **The runtime owns loop-only
  state**: `scaleAnimations`, `animationNowMs`, `settleFramesRemaining`,
  `pendingPostScaleSettle`, `scaleChangeFocalNodeId`, `layeredRelayoutState`,
  `lastRelayoutStateKey`, and the RAF handle. **The component keeps** `graph`,
  overlay state, `primaryNodeId` / `lastPinnedNodeId`, the `$derived` layout
  (`graphLayout`, `visibleGraph`, `hopsByNodeId`, etc.), the three `$effect`s,
  and all event handlers. The runtime is constructed with a getter for the
  current graph, a getter for resolved `LayoutSettings`, and a commit callback;
  it never reads the DOM.
- **Does this change behavior?** **No** — pure refactor. Existing story `play`
  functions are the regression guard; they must pass unchanged. If a story is
  coupled to a now-extracted internal, fix the story to assert via harness
  `data-*` attributes rather than reverting the extraction.
- **Testing a RAF loop.** **Inject the clock.** The runtime exposes
  `step(nowMs)` (and `start()` / `stop()` that schedule it via `requestAnimationFrame`
  in the component). Specs call `step(nowMs)` directly with synthetic
  timestamps — no real animation frames — mirroring how `relaxGraphPositionsStep`,
  `advanceLayeredRelayout`, and `scaleChangeSettle*` are already tested.
- **Sequencing vs. 04g.** **04g's `Multigraph.svelte` / relaxation-loop changes
  land first.** This refactor rewrites the same loop; starting before 04g is
  committed guarantees conflicts. T04 in particular rebases onto the final loop.

## Out of scope (for this plan)

- Any behavior, feature, or tuning change (see milestone Non-goals).
- Changes to `Stage.svelte`, `Node.svelte`, `NodeEditSheet.svelte`,
  `NodeActionMenu.svelte` beyond import/prop wiring.
- Physics-solver or settle-algorithm changes (milestone 04g).
- Persistence / sync `$effect`s and the `onMultigraphChange` /
  `onViewStateChange` contracts.

## Tasks

> Each task is one PR. All four touch `Multigraph.svelte`, so they are
> deliberately sequential (see Wave plan) — the parallelism this repo usually
> gets across files isn't available when the point is to decompose one file.

### T01 — Extract edge styling/geometry to `lib/edgeStyle.ts`

|                |                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------- |
| **Depends on** | — (after 04g `Multigraph.svelte` changes are merged)                                     |
| **Wave**       | 1                                                                                        |
| **Agent**      | default (claude-4.6-sonnet-medium-thinking)                                              |
| **Effort**     | S                                                                                        |
| **Files**      | new `lib/edgeStyle.ts`, new `lib/edgeStyle.spec.ts`, `Multigraph.svelte`, `lib/index.ts` |
| **PR title**   | `refactor(multigraph): extract edge style/geometry helpers to lib/edgeStyle.ts`          |

Move `edgeStyle`, `edgeRenderPoints`, `edgeArrowScale`, and `edgeStrokeScale`
out of the component into `lib/edgeStyle.ts` as pure functions (they already
build on `edgeRender.trimSegmentToNodeBorders`). Component imports them; template
call sites unchanged. Add to the `lib/index.ts` barrel.

**Acceptance**

- `edgeStyle.spec.ts` covers: `edgeStyle` CSS `left/top/width/transform` output
  for a known segment; `edgeRenderPoints` for a full `visible` edge vs. a
  `boundary` fade edge; `edgeArrowScale` and `edgeStrokeScale` across directed,
  undirected, and boundary cases.
- No edge-rendering pure logic remains in `Multigraph.svelte`.
- Existing edge/render stories still pass.

### T02 — Move visibility filters into `lib/boundedVisibility.ts`

|                |                                                                                         |
| -------------- | --------------------------------------------------------------------------------------- |
| **Depends on** | T01                                                                                     |
| **Wave**       | 2                                                                                       |
| **Agent**      | default (claude-4.6-sonnet-medium-thinking)                                             |
| **Effort**     | S                                                                                       |
| **Files**      | `lib/boundedVisibility.ts`, `lib/boundedVisibility.spec.ts`, `Multigraph.svelte`        |
| **PR title**   | `refactor(multigraph): move graphWithVisibleNodes/pinnedNodeIds into boundedVisibility` |

Move `graphWithVisibleNodes` and `pinnedNodeIds` into the existing
`boundedVisibility.ts` (same concern) as pure exports. Update the component's
`$derived` / wrapper call sites to import them.

**Acceptance**

- `boundedVisibility.spec.ts` gains: `graphWithVisibleNodes` keeps only nodes in
  the visible set and only edges whose endpoints are both visible; `pinnedNodeIds`
  returns the pinned id set (empty when none pinned).
- Sequenced after T01 because both edit `Multigraph.svelte`.
- Existing visibility/relayout stories still pass.

### T03 — Extract `DuplicateEdgeDialog.svelte` and move its label helper

|                |                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------ |
| **Depends on** | T02                                                                                        |
| **Wave**       | 3                                                                                          |
| **Agent**      | default (claude-4.6-sonnet-medium-thinking)                                                |
| **Effort**     | S                                                                                          |
| **Files**      | new `DuplicateEdgeDialog.svelte`, `lib/graph.ts`, `lib/graph.spec.ts`, `Multigraph.svelte` |
| **PR title**   | `refactor(multigraph): extract DuplicateEdgeDialog component`                              |

Move the inline duplicate-edge confirm markup and its slice of the `<style>`
block into `DuplicateEdgeDialog.svelte`, matching `NodeActionMenu` /
`NodeEditSheet`. Move `duplicateEdgeIdentifier` into `lib/graph.ts` (it derives
its label from graph data) with a spec. The component keeps `duplicateEdgeConfirm`
state and passes the identifier + confirm/cancel callbacks to the dialog.

**Acceptance**

- `graph.spec.ts` covers `duplicateEdgeIdentifier` (`"sourceTitle -- targetTitle"`,
  including the empty/`New Node` title fallback).
- The duplicate-edge confirm story (add an already-existing edge → dialog →
  confirm removes it; cancel keeps it) still passes against the extracted
  component.
- The dialog's styles live in `DuplicateEdgeDialog.svelte`, not
  `Multigraph.svelte`.

### T04 — Extract the layout runtime to `lib/layoutRuntime.svelte.ts`

|                |                                                                                         |
| -------------- | --------------------------------------------------------------------------------------- |
| **Depends on** | T03                                                                                     |
| **Wave**       | 4                                                                                       |
| **Agent**      | high-reasoning (claude-opus-4-8-thinking-high or gpt-5.3-codex)                         |
| **Effort**     | L                                                                                       |
| **Files**      | new `lib/layoutRuntime.svelte.ts`, new `lib/layoutRuntime.spec.ts`, `Multigraph.svelte` |
| **PR title**   | `refactor(multigraph): extract animation/relaxation runtime into layoutRuntime`         |

Introduce a class-based runes runtime owning the loop-only state and the
glue functions (`relaxationStep`, `withRelaxedPositions`, `withScaleAnimation`,
`startLayeredRelayout`, start/stop). Public surface (refine during
implementation): `step(nowMs)`, `start()`, `stop()`, `beginScaleChange(nextGraph,
focalNodeId)`, `relaxAfterMutation(nextGraph, dragNodeId?)`, plus reactive getters
the template reads (`animatedScaleByNodeId`, settle/relayout `data-*` keys). The
component constructs it with `{ getGraph, getSettings, commit }` and calls it from
the drag/pin/mutation handlers; `start()`/`stop()` schedule `step` via `requestAnimationFrame`
in the component (or the runtime accepts an injected scheduler).

**Acceptance**

- `layoutRuntime.spec.ts` drives `step(nowMs)` with an injected clock (no real
  RAF) and covers: settle-frame countdown to zero; `pendingPostScaleSettle`
  transition into a post-scale settle; scale-animation pruning at/after end time;
  layered-relayout advance and clear; post-drag vs. post-scale settle paths.
- `Multigraph.svelte` no longer defines the RAF loop, the settle/animation
  bookkeeping, or `withScaleAnimation` / `withRelaxedPositions`; its `<script>`
  is under ~400 lines.
- All existing drag, pin/unpin, scale-change, and layered-relayout stories pass
  unchanged (regression guard for the behavior-preserving claim).

## Wave plan

```
Wave 1   T01            edge style → lib (safe, isolated; first to build confidence)
Wave 2   T02            visibility filters → lib (after T01: shares Multigraph.svelte)
Wave 3   T03            DuplicateEdgeDialog component (after T02: shares Multigraph.svelte)
Wave 4   T04            layout runtime (last + riskiest; rebases onto the post-T03 file)
```

Total: 4 tasks, fully sequential. Parallelism is intentionally zero — every task
decomposes the same file (`Multigraph.svelte`), so concurrent edits would just
collide. The ordering is the value: each PR is small and independently
reviewable, the safe extractions land first, and the architectural runtime
extraction goes last against an already-slimmed file.

Invariant before starting a task: its `Depends on` PR is merged, and (for T01)
04g's `Multigraph.svelte` changes are merged.

## Risks and rollback

- **T04 reactivity regressions.** Moving loop state into a `.svelte.ts` class can
  silently break reactivity across the boundary. Mitigation: T04 is last, gated
  by the full story suite; if a story breaks, prefer fixing the runtime wiring
  over reverting. If the runes-class boundary proves unworkable, fall back to a
  function-module runtime that the component re-invokes each frame (more
  boilerplate, same testability) — decide before merging T04, not mid-stream.
- **Conflict with in-flight 04g.** 04g currently has uncommitted
  `Multigraph.svelte` changes. Do not start T01 until those are committed/merged;
  otherwise the whole chain rebases onto a moving loop.
- **Story coupling to internals.** Some `play` functions may assert on
  now-extracted internals. Fix the story to assert via harness `data-*` attrs;
  do not weaken the extraction.
- **Scope creep into behavior changes.** This is a refactor. If a "while I'm here"
  fix is tempting, file it against 04f/04g/TODO instead of folding it in.

## Definition of Done (this plan)

The plan is done when:

- All 4 tasks are merged.
- The milestone's acceptance criteria are satisfied (link, not duplicated).
- This plan's `**Status:**` is `done`, milestone 04h `**Status:**` is `complete`,
  and the roadmap row for 04h is `complete` with the plan link.
- The finished work has been committed unless the user explicitly asked not to
  commit yet.

## Notes

- 2026-06-13: Plan derived from an Ask-mode structural review of
  `Multigraph.svelte` (script ~667 / template ~155 / style ~115). The runtime
  cluster (RAF loop + wrappers + ~8 loop-only `$state`) is ~250 lines and the
  main source of bloat; the per-frame decisions already live in tested lib
  modules, so T04 is mostly relocating glue, not re-deriving algorithms.
- 2026-06-13: User chose to implement T01-T04 in one `/work` branch instead of
  four separate PRs. The branch keeps the tasks as separate commits and closes
  the milestone in the final docs commit.
