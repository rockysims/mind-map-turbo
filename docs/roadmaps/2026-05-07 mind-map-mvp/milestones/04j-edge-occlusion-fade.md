# Milestone 04j: Edge occlusion fade near unrelated nodes

**Status:** complete
**Depends on:** milestones 04f (edge tag colors feed the edge background) and 04h
(thin component refactor), plus the current rotated-div edge render. Occlusion
rides the edge **background gradient**, not the 04i `data-edge-opacity` channel,
so 04i is related but not a hard dependency.
**Plan:** [2026-06-13 04j-edge-occlusion-fade.md](../plans/2026-06-13%2004j-edge-occlusion-fade.md)

## Goal

Edges that pass near a node they are not connected to should visually pull back
from that node so they no longer read as attached to it. The user should be able
to distinguish "this edge passes behind the node" from "this edge connects to the
node" without inspecting endpoints.

Nodes are opaque (`background: #ccc`) and render after edges, so the edge segment
running **directly behind** a node is already hidden. The real ambiguity is the
visible **stub**: an unrelated edge approaches the circle, disappears behind it,
and re-emerges on the far side — which looks exactly like an edge connected on
both sides. A genuinely connected edge is trimmed to touch the node boundary
(`radius + gap`); an unrelated passing edge should instead fade out _before_ it
reaches the circle, leaving a clear gap.

## Scope

### Pure occlusion geometry

- Add a pure `Multigraph/lib/edgeOcclusion.ts` module with colocated specs.
- Given a rendered (already endpoint-trimmed) edge segment, visible node
  centers/radii, and the edge's connected endpoint ids, compute one or more fade
  windows along the edge.
- Exclude the source and target node ids so connected endpoints continue to read
  as connected.
- Use **perpendicular distance** `d` from each unrelated node center to the
  segment, with the projection clamped to the segment ends:
  - gate occlusion to `d < R + clearance` (with a cheap bounding-box rejection
    first),
  - the fully-occluded core half-length along the edge is the chord half-length
    `sqrt(R² − d²)` when `d < R` (a grazing pass fades a little, a head-on pass
    fades a lot — automatically), widened by the clearance,
  - a soft fade ramp of width `edgeOcclusionFadeWidthPx` extends outward from the
    core into the still-visible region; that ramp is what actually
    disambiguates, since the core itself is hidden by the opaque node,
  - opacity reaches `edgeOcclusionMinOpacity` across the core and ramps back to
    full opacity past the ramp.
- Merge overlapping windows so dense graphs produce a valid, stable gradient.
- Occlusion does **not** scale with node smallness beyond what `R` already
  encodes: a small node yields a small window, with no extra suppression.

### Rendering

- Extend the existing edge background path so visible edges can render a
  linear-gradient with soft fade windows along the segment.
- Preserve existing edge color, tag color, directed-edge arrow sizing, edge
  stroke scaling, enter/exit opacity, reveal-wave opacity, and boundary-edge
  fade behavior.
- Add debug/test attributes for story assertions, such as the number of
  unrelated node fade windows affecting each edge.

### Settings

- Extend `LayoutSettings` / `appConfig.multigraph.layout` with at least:
  - `edgeOcclusionClearancePx` (extra gap beyond the node radius before the edge
    may touch),
  - `edgeOcclusionFadeWidthPx` (the soft ramp width on each side of the core),
  - `edgeOcclusionMinOpacity` (the floor reached across the core; **set to `1` to
    disable**, mirroring the existing `durationMs === 0` escape-hatch convention).
- Keep tunables as explicit parameters with defaults in the pure module.

## Acceptance criteria

- `edgeOcclusion.spec.ts` covers, with pinned tunables:
  - an unrelated node centered on an edge creates a fade window whose core
    half-length equals the chord half-length `sqrt(R² − d²)` for a known `d`,
  - the `d = R + clearance` gate boundary (just inside occludes, just outside is
    a no-op),
  - projection clamped to the segment ends (a node beyond an endpoint does not
    occlude),
  - source and target nodes never create occlusion windows for their own edge,
  - a node far enough from the segment leaves the edge unchanged,
  - overlapping fade windows merge deterministically,
  - zero-length and very short edge segments return a stable no-op result,
  - directed and undirected edges use the same occlusion geometry,
  - a smaller-radius node yields a proportionally smaller window with no extra
    suppression.
- `edgeStyle.spec.ts` or `edgeRender.spec.ts` covers gradient construction:
  - no windows returns the current solid/tag-colored edge background,
  - one window fades down then back up,
  - multiple windows produce ordered CSS stops,
  - boundary-edge gradients keep their existing far-end fade.
- Story coverage:
  - an edge crossing behind an unrelated node fades around that node and exposes
    `data-edge-occlusion-count="1"`,
  - an edge connected to the same node does not fade at that endpoint,
  - dragging a node across an unrelated edge updates the fade window live.
- Existing edge color, boundary visibility, enter/exit, reveal-wave, drag, and
  dense-graph stories still pass.
- Lint, check, and unit tests pass.

## Non-goals

- Curved edge routing, edge bundling, or automatic rerouting around nodes.
- Changing graph connectivity, hit testing, duplicate-edge behavior, or layout
  physics.
- Fading nodes themselves.
- Perfect SVG-style masking for arrowheads; arrowheads remain governed by the
  existing directed-edge render unless a story proves that insufficient.
- Any change to which nodes or edges are visible.

## Risks and open questions

Resolved in the plan; kept here for context.

- **Gradient composition with boundary edges.** Deferred. Boundary edges already
  carry a transparent far-end gradient, and composing a second gradient is the
  real complexity. A likely cleaner follow-up is to make boundary nodes ignore
  connections to other invisible nodes so fewer long stubs exist in the first
  place (tracked as a plan follow-up).
- **DOM/CSS representation.** Keep the rotated-div edge and generate CSS
  linear-gradient stops; SVG/mask migration is out of scope without more
  evidence.
- **Performance in dense graphs.** O(E \* N) per render, recomputed every
  relaxation/drag frame. Mitigated by bounding-box rejection and computing only
  against currently visible nodes; spatial indexing is deferred until profiling
  shows it is needed.
- **Opacity semantics.** Soft gradient (not a hard gap). Defaults must clarify
  underpasses without making dense graphs look broken or blinking; the
  dense-graph story is the guardrail.
