# Plan: Layout and repulsion

**Created:** 2026-05-15
**Author:** Cursor agent
**Milestone:** [milestones/02-layout-and-repulsion.md](../milestones/02-layout-and-repulsion.md)
**Status:** draft
**Total estimated effort:** L

## Summary

This plan adds hop-distance node scaling and gentle overlap repulsion on top
of the milestone 01 immutable graph state. It keeps layout math in pure
modules first, then wires Multigraph rendering and drag-time relaxation through
those tested contracts.

## Open questions resolved

- **What's "anchored"?** **Pinned nodes plus the currently dragged node are
  anchored.** Pinned nodes represent user intent, and anchoring the active drag
  keeps repulsion from fighting the pointer.
- **When to run physics?** **Run one bounded relaxation pass after graph
  mutations and run a requestAnimationFrame loop while a node drag is active.**
  This keeps static changes tidy while preserving smooth feedback during
  direct manipulation.
- **Sub-pixel jitter.** **Use a small epsilon in overlap detection and stop
  applying pushes once overlap is within tolerance.** The physics module owns
  this invariant so component code does not need defensive jitter checks.
- **Edge rendering.** **Keep the existing minimal edge lines, but make their
  endpoints follow scaled node positions.** Edge styling remains intentionally
  simple; this milestone is about readability from scale and non-overlap, not
  final graph aesthetics.

## Out of scope (for this plan)

- Force-directed layout with springs, gravity, or link-length constraints.
- Spatial indexing such as quadtrees; the initial pairwise pass is acceptable
  for MVP graph sizes.
- Animated scale transitions; nodes may snap to their new scale for now.
- Rich edge routing, labels, arrows, or collision-aware edge avoidance.
- Persisting layout settings; Storybook controls or local component defaults
  are enough for tuning in this milestone.

## Tasks

> Each task is one PR's worth of work. If a task feels like more than one
> logical commit, split it. The PR title is drafted up front so reviewers and
> implementing agents start aligned.

### T01 - Add layout settings and hop-distance scaling

|                |                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------ |
| **Depends on** | -                                                                                          |
| **Wave**       | 1                                                                                          |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)                                    |
| **Effort**     | M                                                                                          |
| **Files**      | new `lib/layoutSettings.ts`, new `lib/layout.ts`, new `lib/layout.spec.ts`, `lib/index.ts` |
| **PR title**   | `feat(layout): add hop-distance scaling`                                                   |

Implement `LayoutSettings`, defaults, `hopsFromPinned`, `scaleByHops`, and
`radiusOf`. Use multi-source BFS from all pinned nodes; when nothing is pinned,
all nodes should be treated as unreachable and therefore use `minScale`.

**Acceptance**

- Specs cover a single pinned source, multiple pinned sources, cycles, and
  disconnected nodes.
- Unreachable nodes return `Infinity` from `hopsFromPinned` and resolve to
  `minScale` in `scaleByHops`.
- `scaleByHops` honors `scaleFalloff ** hops` and the `minScale` floor.
- `radiusOf` derives from `baseRadius` and falls back predictably for missing
  node ids.

### T02 - Add pure overlap physics

|                |                                                                      |
| -------------- | -------------------------------------------------------------------- |
| **Depends on** | -                                                                    |
| **Wave**       | 1                                                                    |
| **Agent**      | high-reasoning (`claude-opus-4-7-thinking-xhigh` or `gpt-5.3-codex`) |
| **Effort**     | M                                                                    |
| **Files**      | new `lib/physics.ts`, new `lib/physics.spec.ts`, `lib/index.ts`      |
| **PR title**   | `feat(physics): add overlap relaxation`                              |

Implement `relaxOverlapsStep` and `relaxOverlaps`. The step function accepts
positions, radii, padding, and anchored ids, then returns a new positions map
where each overlapping pair is separated by the minimum needed push.

**Acceptance**

- Two overlapping unanchored circles separate symmetrically.
- An anchored circle does not move; the unanchored circle absorbs the full
  push.
- A pair with no overlap returns unchanged positions.
- Identical centers use a deterministic push direction so results are stable.
- N iterations converge for a small deterministic fixture, with remaining
  overlap below padding tolerance.
- Inputs are not mutated.

### T03 - Add graph layout orchestration helpers

|                |                                                                         |
| -------------- | ----------------------------------------------------------------------- |
| **Depends on** | T01, T02                                                                |
| **Wave**       | 2                                                                       |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)                 |
| **Effort**     | M                                                                       |
| **Files**      | new `lib/graphLayout.ts`, new `lib/graphLayout.spec.ts`, `lib/index.ts` |
| **PR title**   | `feat(layout): derive graph presentation state`                         |

Add a pure helper that derives per-node presentation data from
`MultigraphData`: hop counts, scales, radii, and relaxed positions. Keep this
as the single boundary Multigraph consumes so the component does not duplicate
BFS, radius, or physics decisions.

**Acceptance**

- The helper returns presentation entries for every graph node.
- Pinned nodes are included in the anchored set during relaxation.
- A supplied active drag node id is added to the anchored set.
- Position relaxation returns a new `posByNodeId` map without mutating the
  original graph.
- Specs cover a pinned chain, a disconnected node, and an overlapping pinned
  plus unpinned pair.

### T04 - Render scaled nodes and expose tuning controls

|                |                                                                                        |
| -------------- | -------------------------------------------------------------------------------------- |
| **Depends on** | T03                                                                                    |
| **Wave**       | 3                                                                                      |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)                                |
| **Effort**     | M                                                                                      |
| **Files**      | `Multigraph.svelte`, `Multigraph.stories.svelte`, `Node.svelte`, `Node.stories.svelte` |
| **PR title**   | `feat(multigraph): scale nodes by pinned hop distance`                                 |

Wire `Multigraph.svelte` to the graph presentation helper and pass each node's
scale into rendering without changing the underlying graph coordinates. Expose
layout settings as optional props and Storybook controls so falloff, floor,
radius, padding, and iteration counts can be tuned.

**Acceptance**

- All existing Multigraph stories still pass.
- New story: "User pins a node and neighbors scale down with distance" asserts
  expected scale values from the rendered DOM.
- A disconnected node renders at `minScale`.
- Node hit targets remain compatible with the scaled visual radius.
- Storybook controls can tune layout settings without recompilation.

### T05 - Relax overlaps after mutations and during drags

|                |                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T03, T04                                                                                                        |
| **Wave**       | 4                                                                                                               |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)                                                         |
| **Effort**     | L                                                                                                               |
| **Files**      | `Multigraph.svelte`, `Stage.svelte`, `StageHarness.svelte`, `Stage.stories.svelte`, `Multigraph.stories.svelte` |
| **PR title**   | `feat(multigraph): relax overlapping nodes during drag`                                                         |

After add, remove, pin, unpin, and drop operations, run a bounded relaxation
pass and commit the returned positions through immutable graph state. Add the
minimal Stage drag lifecycle callback needed for Multigraph to know when a drag
is active, then run a requestAnimationFrame loop that anchors pinned nodes and
the active drag node.

**Acceptance**

- Drag lifecycle callbacks are covered by Stage harness story assertions.
- Dragging one node into another causes overlap relaxation without moving the
  actively dragged node away from the pointer.
- Pinned nodes do not move when an unpinned node bumps them.
- Relaxation stops when the drag ends and no orphaned animation frame loop
  remains.
- Positions stay finite and within the visible Storybook stage for the covered
  scenarios.

### T06 - Add large-graph coverage and tune defaults

|                |                                                                                |
| -------------- | ------------------------------------------------------------------------------ |
| **Depends on** | T04, T05                                                                       |
| **Wave**       | 5                                                                              |
| **Agent**      | fast/cheap (`composer-2-fast` or `kimi-k2.5`)                                  |
| **Effort**     | S                                                                              |
| **Files**      | `Multigraph.stories.svelte`, `lib/testFixtures.ts`, `lib/testFixtures.spec.ts` |
| **PR title**   | `test(multigraph): cover large scaled graph layout`                            |

Extend fixtures or story helpers so large deterministic graphs are easy to
create, then add the 20-node and 100-node scenarios called out by the
milestone. Use assertions for the measurable parts and a Storybook visual check
for drag smoothness.

**Acceptance**

- A 20-node pinned story asserts hop-derived scale values for pinned, adjacent,
  distant, and disconnected nodes.
- A 100-node story renders with 1-3 pinned nodes and no obvious overlap after
  the configured relaxation passes.
- Fixture helpers remain deterministic and do not break existing specs.
- Story names read like user-facing behavior, not implementation details.

## Wave plan

```text
Wave 1   T01  ||  T02
Wave 2   T03
Wave 3   T04
Wave 4   T05
Wave 5   T06
```

T01 and T02 can run in parallel because hop scaling and overlap physics are
independent pure modules. T03 composes those contracts into graph presentation
state. T04 consumes presentation state for rendering, T05 adds live relaxation
behavior, and T06 finishes large-graph coverage once the visible behavior is
stable.

Total: 6 tasks, 5 waves, with parallelism in wave 1.

## Risks and rollback

- **T02 can become algorithmically fiddly.** Keep the first implementation
  pairwise and deterministic; if convergence is poor, compare a small
  best-of-N implementation before changing the public function contract.
- **T05 touches Stage and Multigraph together.** Keep Stage changes limited to
  drag lifecycle callbacks; if this grows, split lifecycle wiring from
  relaxation behavior.
- **Scaled hit-testing can drift from visuals.** The plan explicitly checks
  hit targets after T04 so drag and drop do not silently keep using unscaled
  circles.
- **Large graphs may still look crowded with the defaults.** Tune settings in
  Storybook first, then update default `LayoutSettings` only after the 20-node
  and 100-node stories are readable.

## Definition of Done (this plan)

The plan is done when:

- All 6 tasks are merged to `main`.
- The milestone 02 acceptance criteria are satisfied.
- `pnpm --filter mind-map-sv lint` passes.
- `pnpm --filter mind-map-sv check` passes.
- `pnpm --filter mind-map-sv test:unit -- --run` passes.
- Relevant Storybook `play` tests cover hop scaling, drag-time repulsion, and
  pinned-node anchoring.
- The 100-node story has been visually checked for drag jank.
- Plan status is `done`, milestone status is `complete`, and roadmap status
  for the milestone is `complete` with a link back to this plan.

## Notes

- 2026-05-15: Milestone 01 already renders all nodes, draws minimal edges,
  exposes pinned visual state, and routes graph edits through immutable
  mutations. This plan starts from those foundations instead of redoing them.
- 2026-05-15: The existing `NODE_RADIUS` constant is the current rendered
  circle radius source. T01 should decide whether `LayoutSettings.baseRadius`
  defaults from that constant or replaces it as the node sizing source.
