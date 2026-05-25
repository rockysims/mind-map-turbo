# Plan: Layered pin relayout

**Created:** 2026-05-25
**Author:** Cursor agent
**Milestone:** [milestones/07-layered-pin-relayout.md](../milestones/07-layered-pin-relayout.md)
**Status:** draft
**Total estimated effort:** L

## Summary

Add Fibonacci-batched hop-layer relayout on pin/unpin so the graph ripples
outward from pinned anchors, with half-opacity ghosts for nodes not yet in the
current batch. Reuse the existing scale animation and rAF physics loop; extend
pure layout/physics modules first, then wire Multigraph and stories.

## Open questions resolved

- **When to run layered relayout.** **Only on pin/unpin**, not initial load,
  drag, or add/remove. Initial sync keeps `withSettledGraphPositions`; drag
  keeps the current continuous loop.
- **Pinned node opacity.** **Pinned nodes never dim** — always opacity 1.0
  during relayout so anchors stay visually stable.
- **Scale vs position timing.** **Parallel.** Scale animations and layered
  position batches share the existing rAF loop started by `withScaleAnimation`.
- **Hop batch schedule.** **Fibonacci increments on hop levels:** batch max
  hops 1, 2, 4, 7, 12, 20, … (increments 1, 1, 2, 3, 5, 8, …). Multiple hop
  distances activate in the same batch so large graphs do not take one settle
  pass per hop.
- **Not-yet-revealed nodes in physics.** **Exclude from simulation**
  (not anchored). They render as 0.5-opacity ghosts at last positions until
  their batch; they must not block in-progress layers.
- **Unreachable nodes (`hops = Infinity`).** **Final batch** after all finite
  hop batches complete.
- **Last unpin (zero pinned nodes).** **Global bulk relayout with opacity
  pulse:** dim all nodes to 0.5, run normal global physics + scale in
  parallel, restore 1.0 when settle finishes. No Fibonacci hop batches because
  there is no pin-centered hop map.
- **Edge opacity.** **Dim when either endpoint** is not fully revealed (same
  rule as node opacity, min of the two endpoint opacities).
- **Opacity transition.** **Animate** dim/reveal with the same rAF + ease-in-out
  pattern as scale (`scaleAnimation.ts`). When relayout starts or a batch
  reveals nodes, tween from current opacity toward target over
  `layeredRelayoutOpacityAnimationDurationMs` (default matches scale duration).

## Out of scope (for this plan)

- Layered relayout on initial graph load or external graph sync.
- Layered relayout during drag or non-pin graph mutations.
- Changing hop-distance scale math or hop-repulsion formulas.
- Persisting layered-relayout settings to storage (Storybook controls / app
  config defaults only).

## Tasks

### T01 — Fibonacci hop batches and relayout state machine

|                |                                                                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                                                                                              |
| **Wave**       | 1                                                                                                                                                              |
| **Agent**      | `composer-2.5-fast`                                                                                                                                            |
| **Effort**     | M                                                                                                                                                              |
| **Files**      | new `lib/layeredRelayout.ts`, new `lib/layeredRelayout.spec.ts`, new `lib/layoutOpacityAnimation.ts`, new `lib/layoutOpacityAnimation.spec.ts`, `lib/index.ts` |
| **PR title**   | `feat(layout): add fibonacci hop batch relayout scheduler`                                                                                                     |

Implement pure helpers:

- `fibonacciHopBatchMaxes(maxFiniteHop: number): number[]` — e.g. 20 →
  `[1, 2, 4, 7, 12, 20]`.
- `maxFiniteHop(hopsByNodeId)`, `hasUnreachableNodes(hopsByNodeId)`.
- `participatingNodeIds(hops, activeMaxHop, pinnedIds): Set<string>`.
- `targetLayoutOpacityByNodeId(nodeIds, hops, pinnedIds, relayoutState, dimOpacity)`.
- `LayeredRelayoutState` + `initialLayeredRelayoutState`, `advanceLayeredRelayout`,
  `shouldUseLayeredRelayout(hasPinned)`, `bulkUnpinRelayoutState` for last-unpin.
- new `lib/layoutOpacityAnimation.ts` (+ spec): mirror `scaleAnimation.ts` —
  `createLayoutOpacityAnimations`, `animatedOpacitiesAt`, `hasActiveLayoutOpacityAnimations`,
  `pruneFinishedLayoutOpacityAnimations`.

**Acceptance**

- Specs cover batch maxes for hop depths 1, 4, 20, 100.
- Target opacity: pinned always 1; revealed hops 1; unrevealed 0.5 when active.
- Opacity animation spec covers tween from 1→0.5 on relayout start, 0.5→1 on
  batch reveal, and ease-in-out midpoint values.
- State machine advances batch index when settle completes; emits unreachable
  final batch when needed.
- Bulk-unpin mode skips hop batches and marks all nodes participating.

### T02 — Physics participation filter

|                |                                                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T01                                                                                                                               |
| **Wave**       | 2                                                                                                                                 |
| **Agent**      | `composer-2.5-fast`                                                                                                               |
| **Effort**     | M                                                                                                                                 |
| **Files**      | `lib/physics.ts`, `lib/physics.spec.ts`, `lib/graphLayout.ts`, `lib/graphLayout.spec.ts`, `lib/layoutSettings.ts`, `appConfig.ts` |
| **PR title**   | `feat(physics): gate relaxation by participating node ids`                                                                        |

Add `participatingNodeIds?: ReadonlySet<string>` to `GraphLayoutOptions`. When
set, skip pairwise edge/overlap/hop-repulsion checks where either endpoint is
outside the set. Pass through from `deriveGraphLayout` / `relaxGraphPhysics`.
Add `layeredRelayoutDimOpacity` and `layeredRelayoutOpacityAnimationDurationMs`
to `LayoutSettings` and `APP_CONFIG`.

**Acceptance**

- Excluded node does not move and does not displace an active overlapping
  partner (spec with 3-node fixture: ghost at old position, active pair
  separates).
- Pinned nodes inside the participating set remain anchored as today.
- Existing physics and graphLayout specs pass (pin participating fields in
  partial settings literals where needed).

### T03 — Wire Multigraph pin/unpin relayout loop

|                |                                                             |
| -------------- | ----------------------------------------------------------- |
| **Depends on** | T01, T02                                                    |
| **Wave**       | 3                                                           |
| **Agent**      | `composer-2.5-fast`                                         |
| **Effort**     | L                                                           |
| **Files**      | `Multigraph.svelte`                                         |
| **PR title**   | `feat(multigraph): fibonacci layered relayout on pin/unpin` |

Extend `withScaleAnimation` / `relaxationStep`:

- On pin/unpin with ≥1 pinned: start `LayeredRelayoutState`, kick off opacity
  animations toward dim targets for unrevealed nodes, pass `participatingNodeIds`
  into `graphLayoutOptions`.
- On each batch advance: create opacity animations from current → 1.0 for newly
  revealed nodes (pinned nodes skip dim animations entirely).
- Advance Fibonacci batch when per-batch settle completes (reuse
  `postDragSettleEpsilonPx` + `postScaleChangeSettleMaxFrames` or dedicated
  layered settle max frames from config).
- On last unpin: start bulk-unpin mode (animate all → dim → global participate →
  animate all → 1.0).
- Apply `animatedOpacitiesAt(...)` to `.node-wrapper` and `.edge` styles each
  rAF frame; edge opacity = min(source, target).
- Keep drag, initial sync, and non-pin mutations unchanged.

**Acceptance**

- Pin/unpin runs scale, opacity, and position relax in parallel on the same
  rAF loop.
- rAF loop stops when layered relayout, scale animations, opacity animations,
  and settle all complete (no orphaned frames).
- Pinned nodes never animate below opacity 1 during layered relayout.
- `data-layout-opacity` (or equivalent) exposes the animated value for stories.

### T04 — Story coverage and harness assertions

|                |                                                               |
| -------------- | ------------------------------------------------------------- |
| **Depends on** | T03                                                           |
| **Wave**       | 4                                                             |
| **Agent**      | `composer-2.5-fast`                                           |
| **Effort**     | M                                                             |
| **Files**      | `Multigraph.stories.svelte`, optionally `StageHarness.svelte` |
| **PR title**   | `test(multigraph): cover fibonacci layered pin relayout`      |

Add stories:

- **PinRelayoutRevealsNearbyNodesFirst** — chain or tree with hops ≥4; after
  pin, assert hop-1 nodes reach opacity 1 before hop-4+ (mid-relayout hop-4+
  should be between dim and full, not yet 1); assert all reach 1 when relayout
  completes.
- **UnpinLastNodeDimsThenRestores** — single pinned node; unpin; assert opacity
  animates down then back up (not an instant snap).

Update story helpers if needed (`waitForLayout`, poll `data-layout-opacity`).

**Acceptance**

- New story `play` functions pass in the storybook Vitest project.
- Existing pin/scale stories (`UserPinsNodeAndNeighborsScaleDownWithDistance`,
  `PinningNodeAnimatesNeighborScaleChanges`, etc.) still pass.

## Wave plan

```
Wave 1   T01                 foundational scheduler + state machine
Wave 2   T02                 physics gate (depends T01)
Wave 3   T03                 Multigraph integration (depends T01, T02)
Wave 4   T04                 stories (depends T03)
```

Total: 4 tasks, 3 sequential gates, no parallel waves (each task builds on the
previous file boundary).

Before starting wave N, verify all `Depends on` tasks are merged to `main`.

## Risks and rollback

- **Ghost exclusion changes physics invariants.** If pairwise filtering is
  wrong, graphs may jump when a batch activates. Mitigation: T02 spec with
  explicit 3-node ghost fixture; T04 story catches regressions.
- **Long relayout on deep chains.** Fibonacci batches cap batch count (~6 for
  hop 20) but each batch still waits for settle. Mitigation: early exit when
  `maxPositionDelta <= epsilon`; tune settle max frames in app config.
- **Parallel scale + layered position feels busy.** Rollback lever: feature-flag
  via `layeredRelayoutDimOpacity = 0` or skip `shouldUseLayeredRelayout` until
  tuned — keep pure modules either way.
- **T03 touches the hot rAF path.** If integration breaks drag or scale settle,
  prefer fixing forward; do not revert T01/T02 pure modules.

## Definition of Done (this plan)

The plan is done when:

- All 4 tasks are merged to `main`.
- [Milestone 07 acceptance criteria](../milestones/07-layered-pin-relayout.md)
  are satisfied.
- Plan status is `done`, milestone status is `complete`, and the roadmap row
  for milestone 07 is `complete` with a link to this plan.
- The finished work has been committed unless the user explicitly asked not
  to commit yet.

## Notes

- 2026-05-25: Design discussion locked pinned-never-dim, parallel scale/position,
  pin/unpin-only trigger, Fibonacci hop batches, last-unpin global dim pulse,
  animated opacity transitions (rAF ease-in-out, same pattern as scale).
- 2026-05-25: All tasks assigned to `composer-2.5-fast`.
- Fibonacci batch example for max hop 20: batches at cumulative max hops
  `[1, 2, 4, 7, 12, 20]` then unreachable if any.
