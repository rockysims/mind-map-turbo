# Plan: Bounded pinned-neighborhood visibility

**Created:** 2026-05-30
**Author:** Cursor agent
**Milestone:** [milestones/04b-bounded-pinned-neighborhood-visibility.md](../milestones/04b-bounded-pinned-neighborhood-visibility.md)
**Status:** draft
**Total estimated effort:** L

## Summary

Replace Fibonacci reveal/dimming with a bounded visibility model around pinned
nodes. The implementation keeps layout/scale behavior for the visible subgraph,
renders boundary edge hints for just-outside nodes, and removes obsolete 04a
state instead of layering another mode on top.

## Open questions resolved

- **No pinned nodes.** **Show nodes within `displayedLayers` hops of the last
  pinned node.** If no node has ever been pinned, choose a random node as the
  fallback anchor; this should be rare because the first node is expected to be
  primary. Never render beyond the bounded hop window for performance.
- **Boundary-edge semantics.** **Only one-visible/one-hidden edges become
  boundary hints.** Edges with both endpoints visible always render as normal
  full edges, even when one endpoint is also near a different pinned
  neighborhood boundary.
- **Current milestone 04a behavior.** **Delete Fibonacci reveal, ghost
  participation, and relayout-only dimming.** Keep the useful mobility/settle
  idea for now, but use visibility plus boundary fade as the only "more graph
  exists nearby" signal.

## Out of scope (for this plan)

- Search, minimap, "show hidden neighbors", or any explicit hidden-count UI.
- Server-side pruning or persistence changes for `displayedLayers`.
- Rich edge rendering beyond a simple boundary fade.
- Changing hop-distance scale math, edge spring constants, or overlap
  repulsion formulas except where filtering requires passing the visible set.

## Tasks

### T01 — Add pure bounded visibility helpers

|                |                                                                                     |
| -------------- | ----------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                   |
| **Wave**       | 1                                                                                   |
| **Agent**      | `claude-4.6-sonnet-medium-thinking`                                                 |
| **Effort**     | M                                                                                   |
| **Files**      | new `lib/boundedVisibility.ts`, new `lib/boundedVisibility.spec.ts`, `lib/index.ts` |
| **PR title**   | `feat(layout): add bounded pinned visibility model`                                 |

Implement pure helpers that take `MultigraphData`, pinned-hop distances, and a
`displayedLayers` value, then return the visible node ids plus render metadata
for normal edges and boundary hints.

Expected API shape:

- `visibleNodeIdsForPinnedNeighborhood(...)`: returns nodes with finite hop
  distance `<= displayedLayers` from any pinned node, or from the fallback
  anchor when there are no pinned nodes.
- `edgeVisibilityForPinnedNeighborhood(...)`: classifies each edge as
  `visible`, `boundary`, or hidden. Boundary metadata includes the visible
  endpoint id, hidden endpoint id, source/target edge direction, and a fade
  ratio defaulting to `0.5`.
- Tunables such as `displayedLayers` and boundary fade ratio are parameters with
  defaults; no module reads app config directly. The no-pins fallback anchor is
  also an explicit input so the pure helper does not own randomness or UI state.

**Acceptance**

- Specs cover no pinned nodes, one pinned node, multiple pinned nodes with
  overlapping neighborhoods, disconnected nodes, and boundary edges at
  `displayedLayers + 1`.
- Specs prove edges with both endpoints visible stay normal full edges.
- Specs cover boundary-edge metadata separately from node visibility.
- Existing `layout` and `graphLayout` specs continue to pass without importing
  component code.

### T02 — Add `displayedLayers` layout setting

|                |                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------- |
| **Depends on** | T01                                                                                           |
| **Wave**       | 2                                                                                             |
| **Agent**      | `composer-2.5-fast`                                                                           |
| **Effort**     | S                                                                                             |
| **Files**      | `lib/layoutSettings.ts`, `lib/layoutSettings.spec.ts`, `appConfig.ts`, affected specs/stories |
| **PR title**   | `feat(layout): configure displayed pinned neighborhood depth`                                 |

Add `displayedLayers` beside the existing layout settings and default it to
`10`. Thread the setting through existing layout-settings defaults without
changing behavior until the render integration consumes it.

**Acceptance**

- `DEFAULT_LAYOUT_SETTINGS.displayedLayers` comes from `APP_CONFIG`.
- `withDefaultLayoutSettings` accepts overrides for `displayedLayers`.
- Specs or story args that need broader visibility pin the setting high enough
  for the graph under test.
- Grep for `LayoutSettings` and partial `settings: { ... }` literals; pin the
  new field where the default would make a test ambiguous.

### T03 — Render the bounded visible subgraph

|                |                                                                             |
| -------------- | --------------------------------------------------------------------------- |
| **Depends on** | T01, T02                                                                    |
| **Wave**       | 3                                                                           |
| **Agent**      | `claude-4.6-sonnet-medium-thinking`                                         |
| **Effort**     | L                                                                           |
| **Files**      | `Multigraph.svelte`, possibly a small pure geometry helper + spec if needed |
| **PR title**   | `feat(multigraph): render bounded pinned neighborhoods`                     |

Use the bounded visibility helpers to derive the rendered node and edge sets.
Normal edges render only when both endpoints are visible. Boundary edges render
from the visible endpoint toward the hidden endpoint and fade out halfway.

Implementation notes:

- Keep the underlying `graph` data complete; filtering is render/layout input,
  not a destructive mutation.
- Track the last pinned node id in component/view state. When no nodes are
  currently pinned, pass that id as the visibility fallback anchor; if it is
  missing or no longer exists, choose a random existing node and remember it as
  the fallback anchor.
- Keep `getNodeAt` and pointer handling aligned with rendered nodes so hidden
  nodes cannot be targeted.
- Boundary edge geometry should reuse current endpoint positions when both are
  known. If computing the half-edge/fade style grows beyond a few lines, extract
  it into a pure helper with a spec.
- Expose stable `data-*` attributes for story assertions, e.g.
  `data-edge-visibility="boundary"` and endpoint ids.

**Acceptance**

- Hidden nodes are absent from the DOM and from hit testing.
- Visible-visible edges render as full current edges.
- Boundary edges render as non-interactive hints with deterministic DOM
  metadata for stories.
- Existing layout and scale behavior still works for the visible subgraph.

### T04 — Simplify 04a relayout state for bounded visibility

|                |                                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T03                                                                                                                          |
| **Wave**       | 4                                                                                                                            |
| **Agent**      | `claude-4.6-sonnet-medium-thinking`                                                                                          |
| **Effort**     | M                                                                                                                            |
| **Files**      | `Multigraph.svelte`, `lib/layeredRelayout.ts`, `lib/layeredRelayout.spec.ts`, `lib/layoutOpacityAnimation.ts`, related specs |
| **PR title**   | `refactor(layout): replace fibonacci relayout with bounded visibility`                                                       |

Remove Fibonacci batch scheduling, ghost-node participation, and relayout-only
opacity dimming. Keep the useful mobility/settle idea for now so repinning can
still settle positions over the visible set without carrying the old reveal UX.

**Acceptance**

- No production code references Fibonacci hop batches.
- Relayout state, if still present, is bounded-visibility oriented and does not
  expose ghost ids or dim opacity targets.
- `layoutOpacityAnimation` is deleted if no remaining behavior needs it; if it
  remains for boundary fades, rename or reshape it so it no longer describes
  layered relayout dimming.
- Repinning starts a single visible-set animation/settle pass rather than
  advancing through batches.

### T05 — Add bounded visibility story coverage

|                |                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------- |
| **Depends on** | T03, T04                                                                                 |
| **Wave**       | 5                                                                                        |
| **Agent**      | `composer-2.5-fast`                                                                      |
| **Effort**     | S                                                                                        |
| **Files**      | `Multigraph.stories.svelte`, possibly `lib/testFixtures.ts` / `lib/testFixtures.spec.ts` |
| **PR title**   | `test(multigraph): cover bounded neighborhood visibility stories`                        |

Add Storybook behavior coverage for the milestone's visible user-facing cases.
Prefer existing fixture builders; extend them only if they reduce repeated
inline graph setup.

**Acceptance**

- A multi-hop chain story shows nodes beyond `displayedLayers` are not rendered
  and the boundary edge is present with fade metadata.
- A repinning story shows the old visible neighborhood leaving, the new
  neighborhood entering, and the currently visible set settling together.
- Story names read like user behavior and `play` functions assert on DOM
  outcomes rather than internal component state.

## Wave plan

```
Wave 1   T01                 pure visibility contract
Wave 2   T02                 setting default + override plumbing
Wave 3   T03                 render integration
Wave 4   T04                 remove obsolete 04a reveal/dimming state
Wave 5   T05                 story coverage against the final DOM contract
```

Total: 5 tasks, 5 sequential gates. This milestone intentionally has limited
parallelism because the later tasks all touch `Multigraph.svelte` and should not
race the render contract.

A simple invariant before starting a wave: every task in the wave has all its
`Depends on` items already merged to `main`.

## Risks and rollback

- **Boundary edge geometry gets tangled with component rendering.** Extract a
  pure helper before the Svelte file grows non-trivial math; rollback is to keep
  only full-edge filtering and leave boundary hints disabled behind the helper
  until specs pass.
- **Filtering render input accidentally changes stored graph data.** Keep T03
  focused on derived visible sets and assert that `onMultigraphChange` still
  receives complete graph data for mutations.
- **Relayout simplification breaks repinning motion.** T04 should be reversible
  by restoring the old 04a module from git, but the preferred fix is a smaller
  visible-set settle state rather than bringing back batch reveal UX.
- **Default `displayedLayers: 10` hides too little in demo graphs.** Keep the
  default conservative for real use and use story-level overrides for tight
  visual examples.
- **Fallback anchor state gets stale after node deletion.** Treat the stored
  last-pinned id as a hint; if it no longer exists, choose and store another
  existing node before deriving visibility.

## Definition of Done (this plan)

The plan is done when:

- All 5 tasks are merged to `main`.
- The acceptance criteria from the milestone doc are satisfied.
- Plan status is `done`, milestone status is `complete`, and roadmap status for
  the milestone is `complete` with a link back to this plan.
- `pnpm --filter mind-map-sv lint` passes.
- `pnpm --filter mind-map-sv check` passes.
- `pnpm --filter mind-map-sv test:unit -- --run` passes.
- The finished work has been committed unless the user explicitly asked not to
  commit yet.

## Notes

- 2026-05-30: Revised no-pins behavior to stay bounded: use the last pinned node
  as the fallback anchor, or choose a random node if no valid fallback exists.
