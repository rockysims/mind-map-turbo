# Plan: Graph mutations and pinning

**Created:** 2026-05-15
**Author:** Cursor agent
**Milestone:** [milestones/01-graph-mutations-and-pinning.md](../milestones/01-graph-mutations-and-pinning.md)
**Status:** executing
**Total estimated effort:** L

## Summary

This plan establishes the immutable graph mutation layer, adds node
pinning, and wires existing pointer gestures through that API. It also
normalizes Stage callback coordinates so moving nodes and creating nodes
from background drops store graph-local positions instead of viewport
client coordinates.

## Open questions resolved

- **Multiple pinned nodes vs single primary.** **Render all nodes now, with
  positions from `posByNodeId` and a centered fallback.** This removes the
  current single-primary rendering bottleneck without pulling milestone 02's
  layout and scaling work into this milestone.
- **Position generation for new nodes.** **Use the double-tap-drag release
  point in graph-local coordinates.** Stage already owns pan and zoom state,
  so it should translate pointer client coordinates before calling graph
  mutation handlers.
- **Edge id collisions.** **Generate deterministic next ids from existing
  graph data (`n0`, `n1`, ... and `e0`, `e1`, ...).** The mutation module
  stays pure and testable; callers may still provide explicit ids when data
  comes from persistence or multiplayer later.
- **Drop-onto-self semantics.** **Treat drop onto self as drop onto
  background.** The gesture remains small and predictable: dragging from a
  node back to itself creates a new connected node near the release point,
  while self-loop edges stay out of scope until there is a product use case.

## Out of scope (for this plan)

- Hop-distance scaling, force layout, and overlap repulsion; milestone 02
  replaces the naive positioning fallback.
- Node title or description editing from the UI; milestone 03 owns that.
- Undo/redo UI; immutable mutations make it possible, but no history stack
  ships here.
- Persistence; all mutations remain local component state.
- Styling polish beyond a minimal pinned indicator.

## Tasks

> Each task is one PR's worth of work. If a task feels like more than one
> logical commit, split it. The PR title is drafted up front so reviewers
> and implementing agents start aligned.

### T01 - Add `pinned` to node data and fixtures

|                |                                                                    |
| -------------- | ------------------------------------------------------------------ |
| **Depends on** | -                                                                  |
| **Wave**       | 1                                                                  |
| **Agent**      | fast/cheap (`composer-2-fast` or `kimi-k2.5`)                      |
| **Effort**     | XS                                                                 |
| **Files**      | `types/node.ts`, `lib/testFixtures.ts`, `lib/testFixtures.spec.ts` |
| **PR title**   | `feat(graph): add pinned flag to node fixtures`                    |

Add `pinned?: boolean` to `NodeData`. Extend `MakeGraphInput` with
`pinned?: Array<number | string>` so tests and stories can request pinned
nodes by index or id while keeping the default unpinned.

**Acceptance**

- `makeGraph({ nodeCount: 2, pinned: [0] })` marks only `n0` pinned.
- `makeGraph({ nodeCount: 2, pinned: ['n1'] })` marks only `n1` pinned.
- Existing fixture behavior and default generated nodes stay unchanged.

### T02 - Add pure graph mutation API

|                |                                                             |
| -------------- | ----------------------------------------------------------- |
| **Depends on** | T01                                                         |
| **Wave**       | 2                                                           |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)     |
| **Effort**     | M                                                           |
| **Files**      | new `lib/graph.ts`, new `lib/graph.spec.ts`, `lib/index.ts` |
| **PR title**   | `feat(graph): add immutable graph mutations`                |

Implement `addNode`, `removeNode`, `addEdge`, `removeEdge`,
`togglePinned`, `moveNode`, and `neighborsOf`. Each function returns a new
`MultigraphData` object and never mutates its input. `addNode` and
`addEdge` should accept explicit ids through their input data when present,
then fall back to deterministic next ids derived from current graph data.

**Acceptance**

- `removeNode` removes incident edges and is a no-op for missing ids.
- `removeEdge` is a no-op for missing ids.
- `togglePinned` flips the target node and is its own inverse.
- `moveNode` returns a new graph and new `posByNodeId` object while leaving
  the original graph unchanged.
- `neighborsOf` returns adjacent nodes for incoming and outgoing edges.
- Specs cover id generation collisions, explicit id preservation, and
  missing-id behavior.

### T03 - Normalize Stage callback coordinates

|                |                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T02                                                                                                                              |
| **Wave**       | 3                                                                                                                                |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)                                                                          |
| **Effort**     | M                                                                                                                                |
| **Files**      | `Stage.svelte`, `StageHarness.svelte`, `Stage.stories.svelte`, new `lib/stageCoordinates.ts`, new `lib/stageCoordinates.spec.ts` |
| **PR title**   | `refactor(stage): report graph-local gesture points`                                                                             |

Change Stage gesture callbacks that report positions to pass a `Point`
instead of raw `clientX` and `clientY`: `onNodeMoved(node, point)` and
`onNodeDoubleClickDropOntoBackground(node, point)`. Add a tiny pure helper
that converts a pointer client point, stage rect, pan, and scale into the
graph-local coordinate system used by `posByNodeId`.

**Acceptance**

- Single-click drag stories still report the moved node id and a graph-local
  point through `StageHarness` data attributes.
- Double-click-drag-to-background stories report the source node id and a
  graph-local drop point.
- Existing pan, zoom, double-click, and drop-on-node stories still pass.
- Unit specs cover coordinate conversion with no pan/zoom, with pan, and
  with zoom.

### T04 - Add minimal pinned node visual treatment

|                |                                               |
| -------------- | --------------------------------------------- |
| **Depends on** | T01                                           |
| **Wave**       | 3                                             |
| **Agent**      | fast/cheap (`composer-2-fast` or `kimi-k2.5`) |
| **Effort**     | S                                             |
| **Files**      | `Node.svelte`, `Node.stories.svelte`          |
| **PR title**   | `feat(node): show pinned node state`          |

Show a minimal pinned state in `Node.svelte`, such as a thicker accent
border and `data-pinned="true"` on the root node element. Keep the visual
treatment intentionally small so milestone 03 can revisit styling.

**Acceptance**

- Existing Node stories still pass for unpinned nodes.
- New pinned closed-node story asserts `data-pinned="true"` and verifies the
  pinned indicator is visible.
- The indicator does not depend on hover.

### T05 - Route Multigraph state through graph mutations

|                |                                                            |
| -------------- | ---------------------------------------------------------- |
| **Depends on** | T02, T03, T04                                              |
| **Wave**       | 4                                                          |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)    |
| **Effort**     | L                                                          |
| **Files**      | `Multigraph.svelte`, `Multigraph.stories.svelte`           |
| **PR title**   | `feat(multigraph): route gestures through graph mutations` |

Introduce local graph state in `Multigraph.svelte` initialized from the
`multigraphData` prop. Replace the in-place `posByNodeId` assignment with
`moveNode`. Render every node from graph state at its stored position, with
`{ x: 0, y: 0 }` as the centered fallback until milestone 02 supplies real
layout.

Wire existing gesture callbacks to the mutation API:

- `onNodeMakePrimary` calls `togglePinned`.
- Double-tapping an unpinned node pins it and records it as the current
  primary.
- Double-tapping a pinned node unpins it; if other pinned nodes remain, the
  first pinned node in graph order becomes the current primary, otherwise
  fallback to `defaultPrimaryNodeId` or the first node.
- `onNodeDoubleClickDropOntoNode` calls `addEdge`.
- `onNodeDoubleClickDropOntoBackground` calls `addNode` plus `addEdge`, using
  the graph-local drop point from Stage.

**Acceptance**

- `Multigraph.svelte` no longer mutates `multigraphData` or
  `posByNodeId` in place.
- Existing `Single` story still renders.
- New story: user double-taps a node and it becomes pinned.
- New story: user double-taps a pinned node and it becomes unpinned.
- New story: user double-tap-drags from one node to another and an edge is
  added.
- New story: user double-tap-drags from a node to background and a new
  connected node appears at the drop point.
- New story: moving a node changes graph state while the original story arg
  object remains unchanged.

### T06 - Finalize drop-onto-self story contract

|                |                                                    |
| -------------- | -------------------------------------------------- |
| **Depends on** | T03                                                |
| **Wave**       | 4                                                  |
| **Agent**      | fast/cheap (`composer-2-fast` or `kimi-k2.5`)      |
| **Effort**     | XS                                                 |
| **Files**      | `Stage.stories.svelte`                             |
| **PR title**   | `test(stage): pin drop-onto-self gesture behavior` |

Replace the milestone TODO in `Stage.stories.svelte` with the final
behavioral assertion: double-click-dragging a node onto itself is routed to
the background-drop callback and includes the graph-local release point.

**Acceptance**

- The TODO pointing at milestone 01 is removed.
- The story name or assertion text documents that self-drop means
  background-drop.
- Stage story tests pass with the coordinate callback contract from T03.

## Wave plan

```text
Wave 1   T01
Wave 2   T02
Wave 3   T03  ||  T04
Wave 4   T05  ||  T06
```

T01 is the domain type foundation. T02 builds the pure API on top of it.
T03 and T04 can run in parallel because they touch Stage and Node
respectively. T05 waits for all foundations, while T06 only needs the Stage
coordinate contract from T03 and can run alongside the Multigraph integration.

Total: 6 tasks, 4 waves, with parallelism in waves 3 and 4.

## Risks and rollback

- **Stage coordinate conversion could broaden the milestone.** Keep it to a
  pure helper plus callback type updates; avoid adding new pan or zoom
  behavior. If it becomes larger than expected, land T02 and T04 first and
  split T03 before starting Multigraph integration.
- **T05 is the riskiest PR because it changes state ownership and rendering
  together.** Review it after T02 and T03 are merged, and prefer story
  assertions on visible behavior and harness data attributes over internal
  component state.
- **Naive all-node rendering can overlap badly.** This is acceptable for
  milestone 01. Add a short TODO near the fallback positioning that links to
  milestone 02 rather than polishing layout here.
- **Deterministic ids are local-only.** If persistence or multiplayer needs
  globally unique ids later, introduce an id strategy at that boundary rather
  than making the pure mutation module random now.

## Definition of Done (this plan)

The plan is done when:

- All 6 tasks are merged to `main`.
- The milestone 01 acceptance criteria are satisfied.
- `pnpm --filter mind-map-sv lint` passes.
- `pnpm --filter mind-map-sv check` passes.
- `pnpm --filter mind-map-sv test:unit -- --run` passes.
- Relevant Storybook `play` tests cover the new pin, unpin, edge-add, and
  background-node-add behaviors.
- Roadmap and milestone statuses are updated to complete with a link back to
  this plan.

## Notes

- 2026-05-15: Stage already treats self-drop as background-drop; this plan
  makes that behavior explicit and tested instead of leaving it as a TODO.
- 2026-05-15: The coordinate callback task exists because the current Stage
  API reports raw client coordinates, while graph positions are rendered as
  offsets from graph center.
- 2026-05-15: Pre-execution cleanup removed starter route/test scaffolding,
  unused dialog/toast components, and toast-only Multigraph placeholders. This
  plan assumes milestone 01 owns the first real graph mutation behavior.
