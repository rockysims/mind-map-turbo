# Milestone 04h: Thin the Multigraph component

**Status:** complete
**Depends on:** milestone 04g (its in-flight `Multigraph.svelte` / `graphLayout.ts`
relaxation-loop changes should land first so this refactor rebases onto the final
loop, not a moving target).
**Plan:** [2026-06-13 04h-multigraph-thin-component-refactor.md](../plans/2026-06-13%2004h-multigraph-thin-component-refactor.md)

## Goal

`Multigraph.svelte` has grown to ~940 lines (~667 of `<script>`), making it the
one component that violates the roadmap's first design principle — "pure logic
lives in `lib/*.ts` modules with colocated specs; components are thin shells."
`Stage.svelte` is the exemplar of that pattern; `Multigraph.svelte` is the
outlier where presentation math, an animation/relaxation runtime, and an inline
dialog have accreted inline.

This milestone is a **behavior-preserving refactor** that pushes three distinct
concerns out of the component and behind tested module/component boundaries, so
the file reads like the same kind of thin orchestrator as `Stage.svelte`:
reactive graph state, event handlers, derived layout, and template — with the
heavy machinery extracted and unit-testable.

No user-visible behavior changes. The existing Storybook `play` stories are the
regression guard.

## Why now

- The component is the hardest file in the repo to reason about, and upcoming
  feature milestones (04f tag colors, 04g settle) keep touching it.
- A large chunk of the file (the animation/relaxation RAF loop and settle state
  machine) is currently only exercisable through Storybook `play`, not unit
  tests, because it is welded to the component. Extraction makes it spec-able.
- The pure presentation math (edge geometry/CSS, visibility filtering) is
  untested today purely because of where it lives.

## Scope

Three independent extractions, smallest/safest first.

### 1. Pure presentation + derivation logic → `lib/*.ts` (+ specs)

These are pure data/math transforms currently inlined in `<script>`:

- Edge styling and geometry — `edgeStyle`, `edgeRenderPoints`, `edgeArrowScale`,
  `edgeStrokeScale` — move to a new `Multigraph/lib/edgeStyle.ts` (the existing
  `edgeRender.ts` already owns the segment-trim geometry it builds on).
- Visibility filtering — `graphWithVisibleNodes`, `pinnedNodeIds` — move into
  the existing `Multigraph/lib/boundedVisibility.ts` (same concern).
- `duplicateEdgeIdentifier` (the `"source -- target"` confirm-dialog label)
  moves to `lib/graph.ts` (or a small sibling helper) and gets a spec.

The component imports and calls these instead of defining them.

### 2. Duplicate-edge confirm dialog → its own component

The inline confirm dialog (markup plus its slice of the `<style>` block) becomes
`Multigraph/DuplicateEdgeDialog.svelte`, matching how `NodeActionMenu.svelte` and
`NodeEditSheet.svelte` are already extracted. The component owns the dialog's
markup and styles; `Multigraph.svelte` keeps the `duplicateEdgeConfirm` state and
passes it down with confirm/cancel callbacks.

### 3. Animation / relaxation runtime → `lib/layoutRuntime.svelte.ts`

The largest cluster: the `requestAnimationFrame` loop
(`startRelaxationLoop` / `stopRelaxationLoop` / `relaxationStep`), the
post-mutation wrappers (`withRelaxedPositions`, `withScaleAnimation`), the
`startLayeredRelayout` kickoff, and the loop-only reactive state they drive
(`scaleAnimations`, `animationNowMs`, `settleFramesRemaining`,
`pendingPostScaleSettle`, `scaleChangeFocalNodeId`, `layeredRelayoutState`,
`lastRelayoutStateKey`, and the RAF handle).

These form a cohesive state machine that owns a timer and mutates node
positions. The per-frame _decisions_ already live in tested lib modules
(`relaxGraphPositionsStep`, `advanceLayeredRelayout`, `scaleChangeSettleState`,
`pruneFinishedScaleAnimations`, etc.); what remains in the component is the
glue that wires them to a clock. Extract that glue into a runes-based controller
so the state machine becomes unit-testable by driving its `step(nowMs)` directly.

The component keeps `graph`, overlays, primary/pinned state, the `$derived`
layout, the `$effect`s, and all event handlers; it delegates the loop to the
runtime.

## Acceptance criteria

- **No behavior change.** Every existing `Multigraph.stories.svelte` and
  `Stage.stories.svelte` `play` function still passes unchanged.
- **New pure modules have colocated specs:**
  - `lib/edgeStyle.spec.ts` covers `edgeStyle` CSS output, `edgeRenderPoints`
    for full vs. boundary-fade edges, and `edgeArrowScale` / `edgeStrokeScale`
    across directed / undirected / boundary cases.
  - `lib/boundedVisibility.spec.ts` gains coverage for `graphWithVisibleNodes`
    (nodes and incident edges filtered to the visible set) and `pinnedNodeIds`.
  - `lib/graph.spec.ts` covers `duplicateEdgeIdentifier`.
- **The layout runtime has its own spec** (`lib/layoutRuntime.spec.ts` or
  `.svelte.spec.ts`) that drives `step(nowMs)` with an injected clock and
  asserts settle-frame countdown, scale-animation pruning, layered-relayout
  advance/clear, and post-drag vs. post-scale settle transitions — without a
  real `requestAnimationFrame`.
- **`Multigraph.svelte` `<script>` shrinks substantially** (target: under ~400
  lines of script; the file overall well under its current 940) and contains no
  pure geometry/visibility math or RAF-loop bookkeeping.
- **No new pure logic remains in `.svelte` files** introduced by this work.
- Lint, check, and unit tests pass.

## Non-goals

- Any user-visible behavior change, new feature, or tuning change.
- Touching `Stage.svelte`, `Node.svelte`, `NodeEditSheet.svelte`, or
  `NodeActionMenu.svelte` beyond import/prop wiring.
- Rewriting the physics solver or the settle algorithm (that is 04g).
- Splitting the `<style>` block further than the slice that moves with the
  duplicate-edge dialog.
- Changing the persistence / sync `$effect`s or the `onMultigraphChange` /
  `onViewStateChange` contracts.

## Risks and open questions

- **Conflict with in-flight 04g work.** The working tree currently has
  uncommitted 04g changes in `Multigraph.svelte`, `graphLayout.ts`, and
  `layoutSettings.ts`. This refactor heavily rewrites the same loop, so it must
  start from a tree where 04g's `Multigraph.svelte` touches are committed/merged.
  The plan sequences around this.
- **Runtime reactivity boundary.** Moving loop state into a `.svelte.ts` class
  must preserve Svelte 5 reactivity across the component↔runtime boundary
  (`$state` class fields, getter for the current graph, a commit callback). The
  plan resolves the exact ownership split and the runtime's public surface.
- **Over-fragmentation.** Event handlers, the `$derived` layout, and the
  `$effect`s are correctly in the component; pulling them out would hurt
  readability. Scope is deliberately limited to the three clusters above.
- **Testing a RAF loop.** The runtime spec drives `step(nowMs)` manually with an
  injected clock rather than relying on real animation frames, mirroring how the
  existing lib step functions are already tested.
