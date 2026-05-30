# Milestone 04a: Layered pin relayout

**Status:** complete
**Depends on:** milestones 01 + 02 (pinning, hop-distance layout, physics loop).
**Plan:** [2026-05-25 layered-pin-relayout.md](../plans/2026-05-25%20layered-pin-relayout.md)

## Goal

When the user pins or unpins a node, relayout should **ripple outward from
pinned anchors** instead of moving the whole graph at once. Nodes not yet
included in the current hop batch dim to half opacity so it is obvious which
parts of the graph have not settled yet.

After this milestone, pin/unpin on a large graph feels intentional: nearby
nodes settle first, distant nodes join in Fibonacci-sized hop batches, and
pinned nodes stay fully visible throughout.

## Scope

### Pure modules

- `lib/layeredRelayout.ts`:
  - Fibonacci hop batch schedule (cumulative max hops: 1, 2, 4, 7, 12, …).
  - Layered relayout state machine (batch index, settle frames, active flag).
  - `participatingNodeIds(hops, activeMaxHop, pinnedIds)` for physics gating.
  - `targetLayoutOpacityByNodeId(...)` — pinned always 1.0; revealed hops 1.0;
    unrevealed non-pinned 0.5 during active relayout.
- new `lib/layoutOpacityAnimation.ts` — rAF opacity tweens mirroring
  `scaleAnimation.ts` (`createLayoutOpacityAnimations`, `animatedOpacitiesAt`, …).
- Extend `lib/physics.ts` / `lib/graphLayout.ts`:
  - `participatingNodeIds` option — nodes outside the set are excluded from
    pairwise physics (not merely anchored), so ghost nodes do not block
    in-progress layers.
- Extend `LayoutSettings` / `appConfig`:
  - `layeredRelayoutDimOpacity` (default 0.5).
  - `layeredRelayoutOpacityAnimationDurationMs` (default matches scale duration).

### Component wiring

- `Multigraph.svelte`:
  - Start layered relayout from pin/unpin when ≥1 pinned node remains.
  - On **last unpin** (zero pins): dim all nodes, run global bulk settle +
    scale in parallel, restore full opacity when done (no Fibonacci batches).
  - Extend the existing `requestAnimationFrame` relaxation loop to advance
    Fibonacci batches and settle criteria per batch.
  - Apply animated opacity to node wrappers and edges (dim edge when either
    endpoint is not fully revealed; tween via rAF each frame).
  - Do **not** change initial graph sync (`withSettledGraphPositions`) or
    drag-time behavior.

### Visual rules (locked)

| Trigger                        | Layering              | Opacity                                                    |
| ------------------------------ | --------------------- | ---------------------------------------------------------- |
| Pin/unpin, ≥1 pin              | Fibonacci hop batches | Pinned = 1; revealed → 1 (animated); rest → 0.5 (animated) |
| Unpin last pin                 | Global bulk only      | All → 0.5 (animated) → settle → all → 1 (animated)         |
| Drag, add/remove, initial load | Unchanged             | No dim                                                     |

Scale animation and layered position relayout run **in parallel** on
pin/unpin (same rAF loop as today).

## Acceptance criteria

- `layeredRelayout.spec.ts` covers:
  - Fibonacci batch maxes for small and large hop depths.
  - Participating-node sets per batch; pinned always included.
  - Opacity map and animation: pinned never dim; unrevealed tween toward dim
    on relayout start; batch reveal tweens toward 1.0.
  - State machine advances batch on settle; finishes after unreachable batch.
  - Last-unpin path uses bulk mode (no hop batches).
- `physics.spec.ts` covers excluded nodes not blocking active pairs.
- New story: pin on a multi-hop chain asserts hop-1 nodes reach full opacity
  before hop-4+ nodes (via `data-layout-opacity` or equivalent harness attrs).
- New story: unpin last pin dims all nodes briefly then restores opacity.
- Existing pin/scale/layout stories still pass.
- Lint, check, and unit tests pass.

## Open questions

- **Fibonacci batch schedule.** Use increments 1, 1, 2, 3, 5, 8, … on hop
  _levels_, producing cumulative max hops 1, 2, 4, 7, 12, 20, … per batch.
- **Ghost nodes during relayout.** Exclude not-yet-revealed nodes from physics
  entirely; render at 0.5 opacity in place until their batch activates.
- **Unreachable nodes.** One final batch after all finite hops, before relayout
  ends.
- **Initial load.** No layered relayout; keep instant bulk settle.
- **Last unpin.** Global dim + bulk settle + restore opacity (no hop ripple).
- **Opacity transition.** Animate dim/reveal with rAF ease-in-out over
  `layeredRelayoutOpacityAnimationDurationMs`, same pattern as scale animation.

## Risks

- Fibonacci batches still add noticeable time on very deep single chains; batch
  count grows slowly (~10 batches for hop 100 vs 100 one-at-a-time).
- Parallel scale + position + opacity may feel busy; tune settle frames if
  needed.
- Edge dimming must stay in sync with animated node opacity or edges will look
  broken mid-relayout.
