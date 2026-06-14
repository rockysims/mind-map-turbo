# Plan: Edge occlusion fade near unrelated nodes

**Created:** 2026-06-13
**Author:** Cursor agent
**Milestone:** [milestones/04j-edge-occlusion-fade.md](../milestones/04j-edge-occlusion-fade.md)
**Status:** executing
**Total estimated effort:** M (4 tasks; pure geometry first, then serialized render
wiring)

## Summary

Add geometry-based soft fade windows to edges that pass near unrelated visible
nodes, so an unrelated edge pulls back from the node (no longer reads as
attached) while connected endpoints still touch the node boundary.

## Open questions resolved

- **What the fade is actually for.** **The visible stub, not the part behind the
  node.** Nodes are opaque (`background: #ccc`) and paint over edges, so the
  segment directly behind a node is already hidden. The fade exists to keep an
  unrelated edge's stub from touching the circle; a connected edge keeps touching
  the boundary as it does today.
- **Window geometry.** **Chord-based, gated by perpendicular distance.** The
  occluded core half-length is `sqrt(R² − d²)` (`d` = perpendicular distance from
  node center to the segment, projection clamped to the ends), widened by a
  clearance, with a soft ramp outside the core. A flat fixed-width window is
  geometrically wrong for varying node sizes and grazing angles.
- **Which edges get occlusion.** **Visible edges only for v1.** The reveal-wave
  buffer and exiting edges are transient; applying occlusion there is a recorded
  follow-up.
- **Gradient composition with boundary edges.** **Defer boundary edges and keep
  their existing far-end fade unchanged.** Composing a second gradient is the real
  complexity; a cleaner follow-up is to make boundary nodes ignore connections to
  other invisible nodes (recorded as a follow-up).
- **Soft gradient vs. hard gap.** **Soft gradient.** A hard gap (simply not
  drawing the edge within `R + clearance`, like endpoint trimming) was considered
  and rejected — it reads as a cut/broken edge rather than a passing one.
- **DOM/CSS representation.** **Keep the current rotated-div edge and generate
  CSS linear-gradient stops.** SVG/mask primitives would be a larger renderer
  rewrite without enough evidence yet.
- **Directed-edge gradient mapping.** **Do it right: compute stop percentages
  relative to the rendered `::before` width.** For directed edges `::before` is
  `calc(100% - var(--edge-arrow-length)/2)`, not the full segment. A small error
  is acceptable only if mapping to `::before` width turns out hard/complex.
- **Performance in dense graphs.** **Visible-edge by visible-node pass with cheap
  bounding-box rejection before projection.** Story coverage already exercises
  100-node graphs; spatial indexing waits until profiling shows the O(E \* N) pass
  is a bottleneck.
- **Occluding small/far nodes.** **Yes, occlude, but no extra suppression.** The
  window is already radius-aware, so a small node yields a small window; no
  additional scale threshold.
- **Opacity semantics / disable hatch.** **`edgeOcclusionMinOpacity` is the core
  floor; setting it to `1` disables the feature**, mirroring the repo's
  `durationMs === 0` escape-hatch convention.

## Out of scope (for this plan)

- Curved routing, bundling, or layout changes to avoid node crossings.
- SVG renderer migration or full edge masking.
- Occlusion on boundary, reveal-wave-buffer, and exiting edges (see follow-ups).
- Connectivity, hit testing, duplicate-edge, or node visibility changes.

## Tasks

> Each task is one PR. T03 and T04 both touch `Multigraph.svelte`, so they run
> in separate waves.

### ✓ T01 - Add pure edge occlusion geometry

|                |                                                                                   |
| -------------- | --------------------------------------------------------------------------------- |
| **Depends on** | -                                                                                 |
| **Wave**       | 1                                                                                 |
| **Agent**      | default (claude-4.6-sonnet-medium-thinking)                                       |
| **Effort**     | M                                                                                 |
| **Files**      | new `Multigraph/lib/edgeOcclusion.ts`, new `Multigraph/lib/edgeOcclusion.spec.ts` |
| **PR title**   | `feat(multigraph): compute edge occlusion fade windows`                           |

Implement a pure module that, for each visible unrelated node, computes the
perpendicular distance `d` to the rendered (already endpoint-trimmed) segment
with the projection clamped to the ends, applies bounding-box rejection, gates on
`d < R + clearance`, and emits a soft fade window. The window's occluded core
half-length is `sqrt(R² − d²)` (when `d < R`) widened by clearance, with a ramp
of `edgeOcclusionFadeWidthPx` on each side. Exclude the edge's source/target node
ids, merge overlapping windows, return them ordered along the segment as
fractions of segment length, and treat zero-length segments as no-op.

**Acceptance**

- Specs pin the math: core half-length equals `sqrt(R² − d²)` for a known `d`;
  the `d = R + clearance` gate boundary (just inside occludes, just outside is a
  no-op); projection clamped at the ends (node beyond an endpoint does not
  occlude).
- Specs cover centered unrelated node, near-but-outside node, far node, endpoint
  exclusion, multiple/overlapping nodes, zero-length segments, smaller-radius
  node yields a proportionally smaller window, and directed-vs-undirected parity.
- Tunables are parameters with defaults: `edgeOcclusionClearancePx`,
  `edgeOcclusionFadeWidthPx`, `edgeOcclusionMinOpacity` (`1` ⇒ no windows).
- Original input objects are not mutated.

### ✓ T02 - Compose occlusion windows into edge backgrounds

|                |                                                                   |
| -------------- | ----------------------------------------------------------------- |
| **Depends on** | T01                                                               |
| **Wave**       | 2                                                                 |
| **Agent**      | default (claude-4.6-sonnet-medium-thinking)                       |
| **Effort**     | S                                                                 |
| **Files**      | `Multigraph/lib/edgeStyle.ts`, `Multigraph/lib/edgeStyle.spec.ts` |
| **PR title**   | `feat(multigraph): render edge occlusion fade gradients`          |

Extend the edge background helper so visible edges can render ordered
linear-gradient stops from T01 windows while no-window edges keep the exact
current solid/tag-colored background. Map window fractions to stop percentages
against the rendered `::before` width — full segment for undirected,
`calc(100% - var(--edge-arrow-length)/2)` for directed (a small error is
acceptable only if exact mapping proves hard). Keep boundary-edge background
behavior unchanged in this task.

**Acceptance**

- No windows returns the current `color` string.
- One window produces full -> min -> full opacity stops at deterministic
  percentages, with the soft ramp between full and min (not a step).
- Directed-edge stops are computed against the `::before` width, not the full
  segment (or the accepted-error path is documented in the PR).
- Multiple windows produce sorted stops without invalid CSS.
- Boundary visibility still returns the existing far-end fade gradient.

### T03 - Add settings and wire occlusion into `Multigraph`

|                |                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------ |
| **Depends on** | T01, T02                                                                                   |
| **Wave**       | 3                                                                                          |
| **Agent**      | default (claude-4.6-sonnet-medium-thinking)                                                |
| **Effort**     | M                                                                                          |
| **Files**      | `Multigraph.svelte`, `lib/layoutSettings.ts`, `lib/layoutSettings.spec.ts`, `appConfig.ts` |
| **PR title**   | `feat(multigraph): fade edges behind unrelated nodes`                                      |

Add `edgeOcclusionClearancePx`, `edgeOcclusionFadeWidthPx`, and
`edgeOcclusionMinOpacity` to layout settings and config. In the **visible** edge
render loop only, compute occlusion windows from the rendered edge points and the
currently visible node centers/radii, then pass those windows to the background
helper. Expose `data-edge-occlusion-count` and keep existing `data-edge-opacity`
as the whole-edge animation multiplier, not the per-segment fade.

**Acceptance**

- Connected endpoints do not create fade windows for their own edge.
- An unrelated visible node crossing an edge produces
  `data-edge-occlusion-count="1"`.
- Reveal-wave-buffer and exiting edge loops are left unchanged (no occlusion).
- Enter/exit opacity and reveal-wave opacity still multiply the whole edge via
  existing opacity style/data attrs.
- Existing layout-settings specs pin or accept the new defaults deliberately.

### T04 - Add behavior stories and dense-graph guardrails

|                |                                                                     |
| -------------- | ------------------------------------------------------------------- |
| **Depends on** | T03                                                                 |
| **Wave**       | 4                                                                   |
| **Agent**      | default (claude-4.6-sonnet-medium-thinking)                         |
| **Effort**     | S                                                                   |
| **Files**      | `Multigraph.stories.svelte`, maybe `Multigraph/lib/testFixtures.ts` |
| **PR title**   | `test(multigraph): cover edge occlusion fade behavior`              |

Add stories that assert the visual contract in user-facing scenarios: an edge
passing under an unrelated node fades, a connected edge does not fade at its
endpoint, and dragging a node across an unrelated edge updates the fade window.
Include a dense graph assertion that the feature remains enabled without changing
edge/node counts.

**Acceptance**

- Story: crossing edge behind unrelated node gets one occlusion window and a
  gradient background.
- Story: connected endpoint stays solid near the connected node.
- Story: drag an unrelated node across an edge and observe occlusion count change
  from `0` to `1` and back.
- Existing dense graph stories still pass with the new settings defaults.

## Wave plan

```text
Wave 1   T01                  (pure geometry)
Wave 2   T02                  (gradient composition, depends on T01)
Wave 3   T03                  (settings + Multigraph wiring)
Wave 4   T04                  (stories and guardrails)
```

T03 and T04 serialize because both touch `Multigraph.svelte` /
`Multigraph.stories.svelte`. If implementation discovers the gradient helper is
too coupled to the geometry result shape, T01 and T02 should merge in sequence as
written rather than being parallelized.

## Risks and rollback

- **CSS gradients become hard to reason about.** Keep T02 small and fully
  spec-covered; rollback is returning visible-edge backgrounds to solid color
  while leaving T01 geometry unused.
- **Dense graph cost is noticeable.** The first mitigation is bounding rejection
  and computing only against currently visible nodes; if stories or profiling
  show lag, add a follow-up spatial-index task before shipping.
- **Boundary edge semantics get confusing.** Boundary occlusion is out of scope;
  if users still confuse boundary edges, write a separate milestone for composed
  masks or SVG rendering.
- **Arrowheads appear through an unrelated node.** Accepted initially because
  arrowheads live in the existing pseudo-element path; if the story exposes a bad
  case, add a focused follow-up rather than expanding this plan.

## Definition of Done (this plan)

- All 4 tasks are merged to `main`; milestone 04j acceptance criteria are
  satisfied.
- `pnpm --filter mind-map-sv lint` passes.
- `pnpm --filter mind-map-sv check` passes.
- `pnpm --filter mind-map-sv test:unit -- --run` passes.
- Plan status is `done`, milestone status is `complete`, and roadmap status for
  04j is `complete` with a link back to this plan.

## Follow-ups (deliberately deferred)

Recorded so they are not forgotten; each is its own future task/PR, not part of
this plan's Definition of Done.

- **Apply occlusion to the reveal-wave-buffer and exiting edge loops.** v1 covers
  only the visible edge loop; the two transient loops in `Multigraph.svelte`
  (`data-edge-reveal-buffer`, `data-edge-exiting`) should get the same treatment
  once the visible path is proven, so transitions stay consistent.
- **Boundary-edge occlusion / fewer long stubs.** Rather than composing a second
  gradient onto boundary edges, explore making boundary nodes ignore connections
  to other invisible nodes so fewer long stubs exist to occlude in the first
  place.
- **Spatial index for the occlusion pass.** Only if profiling shows the O(E \* N)
  per-frame pass is a bottleneck in dense graphs.

## Notes

- 2026-06-13: The existing edge render path already has whole-edge opacity for
  enter/exit and reveal-wave animation. This feature uses background gradients for
  per-segment occlusion instead of changing `data-edge-opacity`; the two compose
  (animation opacity × per-segment gradient alpha).
- 2026-06-13: Nodes are opaque and paint over edges, so the occluded core is
  already hidden — the visible soft ramp outside the core is what disambiguates a
  passing edge from a connected one.
