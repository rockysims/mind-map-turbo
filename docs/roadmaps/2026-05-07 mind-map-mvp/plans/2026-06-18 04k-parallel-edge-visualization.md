# Plan: Parallel edge visualization

**Created:** 2026-06-18
**Author:** Cursor agent
**Milestone:** [milestones/04k-parallel-edge-visualization.md](../milestones/04k-parallel-edge-visualization.md)
**Status:** done
**Total estimated effort:** M (4 tasks; pure geometry first, then render wiring)

## Summary

Render multiple edges between the same two nodes as a small straight-line fan, so
distinct relationships are visible without migrating the edge renderer to SVG or
changing the duplicate-edge UI.

## Open questions resolved

- **Straight fan vs. bowed curves.** **Use straight perpendicular offsets for
  v1.** They reuse the current rotated-div renderer, CSS arrowheads, and
  occlusion-window math; curves would force a much larger SVG/path migration.
- **Which edges are grouped.** **Group by unordered node pair.** A->B and B->A
  represent the same visual channel, so they should share one stable fan instead
  of swapping sides based on direction.
- **Offset ordering.** **Sort each group deterministically by edge id before slot
  assignment.** Graph edge order can vary across data sources and future
  mutations, but stable ids keep offsets from jittering during layout updates.
- **Where to apply the offset.** **Offset the source/target centers before border
  trimming.** This lets existing trim, line style, arrow, and occlusion helpers
  work on the actual rendered segment.
- **How much separation.** **Use configurable spacing with a radius-factor
  clamp.** Fixed graph-space spacing is easy to reason about, while
  `APP_CONFIG.multigraph.layout.parallelEdgeMaxOffsetRadiusFactor` caps the
  maximum offset as a fraction of the smaller endpoint radius so endpoints stay
  attached to small nodes and large fans do not sprawl.
- **Boundary/reveal/exiting edges.** **Keep them unchanged for v1.** The main user
  problem is persistent visible duplicate edges; transient render loops can be
  aligned later if stories expose a mismatch.
- **UI duplicate creation.** **Out of scope.** JSON import may contain parallel
  edges now, and future interactions may create them directly; gesture-based
  creation can remain a toggle/remove flow until a dedicated interaction
  milestone.
- **Large parallel groups.** **Clamp rather than invent a badge/bundle now.**
  Extreme multiplicity needs a separate design pass once real graphs prove it
  matters.

## Out of scope (for this plan)

- Creating duplicate edges through the UI or changing `DuplicateEdgeDialog`.
- Curved edges, SVG migration, path markers, or bezier occlusion.
- Double-headed edge merging for opposite-direction pairs.
- Layout physics or graph schema changes.
- Count badges/bundling for very large parallel groups.

## Tasks

> Each task is one PR. T03 and T04 both touch stories, so story fixture support
> lands before the user-facing story assertions.

### ✓ T01 — Add pure parallel edge slotting and offset geometry

|                |                                                                                   |
| -------------- | --------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                 |
| **Wave**       | 1                                                                                 |
| **Agent**      | default (claude-4.6-sonnet-medium-thinking)                                       |
| **Effort**     | M                                                                                 |
| **Files**      | new `Multigraph/lib/parallelEdges.ts`, new `Multigraph/lib/parallelEdges.spec.ts` |
| **PR title**   | `feat(multigraph): compute parallel edge render offsets`                          |

Implement a pure helper that accepts visible edges, node positions/radii, and
spacing options; groups edges by unordered node pair; sorts each group by stable
edge id; assigns centered slots; and returns offset metadata per edge id. Include
a helper for applying the offset to a source/target center pair before border
trimming. The offset is a single straight-line displacement, not a polyline that
fans out from a shared point.

**Acceptance**

- Specs cover single-edge no-op, two/three/four-edge groups, opposite-direction
  edges sharing one group, deterministic ordering by id, zero-length pairs, and
  missing node positions.
- Specs pin centered slot values: one edge `0`, two edges `-0.5/+0.5`, three
  edges `-1/0/+1`.
- Specs cover radius-factor clamping and show that offsets do not exceed the
  configured fraction of the smaller endpoint radius for small nodes.
- Inputs are not mutated.

### ✓ T02 — Wire offsets into visible edge rendering

|                |                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T01                                                                                                                                                           |
| **Wave**       | 2                                                                                                                                                             |
| **Agent**      | default (claude-4.6-sonnet-medium-thinking)                                                                                                                   |
| **Effort**     | M                                                                                                                                                             |
| **Files**      | `Multigraph.svelte`, `Multigraph/lib/edgeStyle.ts`, `Multigraph/lib/edgeStyle.spec.ts`, `lib/layoutSettings.ts`, `lib/layoutSettings.spec.ts`, `appConfig.ts` |
| **PR title**   | `feat(multigraph): render parallel edges with perpendicular offsets`                                                                                          |

Compute parallel offset metadata once for the main visible-edge list, apply the
offset before `edgeRenderPoints` trims the rendered segment, and expose
`data-edge-parallel-count`, `data-edge-parallel-slot`, and
`data-edge-parallel-offset` attributes for tests and debugging. Keep single-edge
rendering byte-for-byte close to the current path where practical. Add
`parallelEdgeMaxOffsetRadiusFactor` to `APP_CONFIG.multigraph.layout` and
`LayoutSettings`, passing it into the pure helper as an explicit parameter.

**Acceptance**

- A visible duplicate group renders separated edge divs with non-zero offsets.
- A single visible edge reports count `1`, slot `0`, and offset `0`.
- Directed edges still place the arrowhead at the target-side endpoint after
  offsetting.
- `computeEdgeOcclusionWindows` receives the offset rendered source/target
  segment.
- Layout settings specs pin the new `parallelEdgeMaxOffsetRadiusFactor` default,
  and parallel-edge specs cover a non-default clamp value.
- Boundary, reveal-wave-buffer, and exiting edge loops remain unchanged and
  continue to pass existing stories.

### ✓ T03 — Add parallel-edge fixtures and focused unit coverage

|                |                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------- |
| **Depends on** | T02                                                                                                |
| **Wave**       | 3                                                                                                  |
| **Agent**      | fast/cheap (composer-2.5-fast or kimi-k2.5)                                                        |
| **Effort**     | S                                                                                                  |
| **Files**      | `Multigraph/lib/testFixtures.ts`, `Multigraph/lib/testFixtures.spec.ts`, maybe `graphFile.spec.ts` |
| **PR title**   | `test(multigraph): add parallel edge fixtures`                                                     |

Add reusable graph fixtures that model parallel-edge data: multiple tagged edges
with the same direction, opposite-direction edges, and a mixed
directed/undirected group. Keep this fixture-only; no UI creation semantics
change.

**Acceptance**

- Fixtures expose at least a 3-edge same-pair graph with distinct ids/tags.
- Specs verify fixture edge ids are stable and distinct.
- If graph-file coverage is touched, it confirms file data with duplicate edges
  is preserved rather than deduped.
- No production graph mutation behavior changes.

### ✓ T04 — Add story coverage and visual guardrails

|                |                                                          |
| -------------- | -------------------------------------------------------- |
| **Depends on** | T03                                                      |
| **Wave**       | 4                                                        |
| **Agent**      | default (claude-4.6-sonnet-medium-thinking)              |
| **Effort**     | S                                                        |
| **Files**      | `Multigraph.stories.svelte`, maybe `StageHarness.svelte` |
| **PR title**   | `test(multigraph): cover parallel edge visualization`    |

Add Storybook scenarios for parallel edges and assert the contract via the debug
attributes from T02. Include distinct tag colors and at least one directed edge
so arrows and offsets are covered together.

**Acceptance**

- Story: three edges between A and B render with count `3` and slots `-1`, `0`,
  and `1`.
- Story: opposite-direction edges share one parallel group and keep arrows at
  opposite node rims.
- Story: a single unrelated edge remains unoffset.
- Existing dense graph, occlusion, enter/exit, and reveal-wave stories still
  pass.

## Wave plan

```text
Wave 1   T01                  (pure slotting and offset geometry)
Wave 2   T02                  (render integration)
Wave 3   T03                  (fixtures; can be cheap once T02 attrs exist)
Wave 4   T04                  (story assertions and visual guardrails)
```

The tasks serialize because the render integration depends on the exact metadata
shape from T01, and the story assertions should target the actual attributes
added in T02. T03 is intentionally small and can be handled by a cheaper agent
after the production behavior lands.

## Risks and rollback

- **Straight fans look too mechanical or cluttered.** Roll back T02 render wiring
  while keeping T01 as unused pure logic, then write a separate SVG/curve
  milestone with this evidence.
- **Endpoint offsets detach from small nodes.** Keep clamp logic in T01 and add a
  small-node story before widening default spacing.
- **Occlusion behavior changes unexpectedly.** T02 must assert that windows are
  computed against the offset segment; rollback is restoring the original
  centerline source/target points.
- **Large groups are unreadable.** Accept the clamp in v1 and record a follow-up
  for badges or bundling instead of expanding this milestone.

## Definition of Done (this plan)

- All 4 tasks are merged to `main`; milestone 04k acceptance criteria are
  satisfied.
- `pnpm --filter mind-map-sv lint` passes.
- `pnpm --filter mind-map-sv check` passes.
- `pnpm --filter mind-map-sv test:unit -- --run` passes.
- Plan status is `done`, milestone status is `complete`, and roadmap status for
  04k is `complete` with a link back to this plan.

## Notes

- 2026-06-18: This plan deliberately chooses straight offsets over bowed curves
  because the current renderer is a rotated CSS div with a CSS triangle arrow.
  Straight offset keeps the edge a line segment, which preserves existing
  gradient occlusion and arrow rendering.
- 2026-06-18: "Fan" means multiple straight, independently offset line segments.
  It does not mean edges share one endpoint and then bend or change into a
  straight segment.
- 2026-06-18: The UI still prevents duplicate edge creation through the main
  gesture flow; this milestone treats parallel edges as valid data and visualizes
  them without changing creation semantics. File data is the current way this
  shape can appear.
