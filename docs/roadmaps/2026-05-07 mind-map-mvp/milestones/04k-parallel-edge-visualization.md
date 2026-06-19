# Milestone 04k: Parallel edge visualization

**Status:** not started
**Depends on:** milestones 04f (edge tag colors), 04h (thin component refactor),
and 04j (edge occlusion fade) so the implementation can build on the current
edge styling and visibility pipeline.
**Plan:** [2026-06-18 04k-parallel-edge-visualization.md](../plans/2026-06-18%2004k-parallel-edge-visualization.md)

## Goal

When graph data contains multiple distinct edges between the same two nodes, the
graph should make that multiplicity visible instead of drawing all relationships
as one coincident line. Users should be able to tell at a glance that A and B
have more than one relationship, while still preserving directed arrows, tag
colors, node occlusion fades, enter/exit animation, and boundary visibility
behavior.

The first implementation should prefer a low-risk renderer-compatible approach:
fan parallel edges with small perpendicular straight-line offsets. In this
milestone, "fan" means each edge remains one straight line segment; its
source/target centers are offset perpendicular to the original pair axis, then
the segment is re-trimmed and re-lengthened through the existing renderer. Curved
edges, SVG paths, and UI creation of duplicate edges are intentionally deferred
until the straight fan proves insufficient.

## Scope

### Pure parallel edge geometry

- Add a pure module that groups edges by an unordered node-pair key
  (`sourceNodeId`/`targetNodeId` sorted) and assigns each edge a stable slot in
  that pair's fan.
- Compute a perpendicular offset for each slot using centered spacing:
  `slot - (count - 1) / 2`, so odd counts keep one edge centered and even counts
  straddle the original segment.
- Offset the rendered segment before endpoint trimming, then reuse the existing
  straight-edge pipeline for line length, rotation, arrows, stroke scale, and
  occlusion windows.
- Clamp spacing by node radius, edge count, and a new
  `APP_CONFIG.multigraph.layout.parallelEdgeMaxOffsetRadiusFactor` value so the
  fan remains attached to both node rims and large edge groups do not explode
  visually.
- Keep the single-edge case exactly centered and behavior-preserving.

### Rendering

- Apply offsets only to visible duplicate-pair edges in the main visible-edge
  render loop.
- Keep boundary, reveal-wave-buffer, and exiting edges on their existing paths
  unless the implementation discovers a simple, well-tested way to share the
  same offset metadata.
- Preserve existing edge colors, directed-edge arrow sizing, edge stroke scaling,
  node occlusion fades, and whole-edge opacity animation.
- Add debug/test attributes that expose the parallel group count, slot, and
  offset for story assertions.

### Multigraph data support

- Treat parallel edges as valid graph data, even though the gesture UI still
  toggles/removes an existing edge instead of creating a duplicate.
- Keep a note in tests or docs that this shape can currently arrive from file
  data, so future implementers do not assume it is unreachable.
- Avoid changing graph mutation semantics or duplicate-edge dialog behavior in
  this milestone.

## Acceptance criteria

- A graph with two or more edges between the same unordered node pair renders
  those edges as visibly separated straight parallel segments.
- Odd-sized parallel groups render one centered edge and balanced siblings on
  both sides; even-sized groups straddle the original line.
- Directed edges keep their arrowheads attached to the correct target-side rim
  after offsetting.
- Opposite-direction edges between the same pair are grouped together and offset
  consistently instead of swapping sides based on source/target orientation.
- Edge occlusion fade windows are computed against the offset rendered segment,
  not the original centerline.
- Single edges are visually unchanged from the current renderer.
- Specs cover grouping, deterministic ordering, offset math, zero-length/very
  short edges, even/odd group counts, opposite-direction edges, and spacing
  clamps.
- Story coverage includes parallel edges with distinct colors/tags and at least
  one directed parallel edge.
- Lint, check, and unit tests pass.

## Non-goals

- UI support for creating multiple edges between the same two existing nodes.
- Curved routing, SVG renderer migration, path markers, or bezier occlusion.
- Merging opposite-direction pairs into a single double-headed edge.
- Changing layout physics, graph connectivity, import/export schema, or duplicate
  edge confirmation behavior.
- Perfect visualization for very large parallel groups; a future count badge or
  bundling approach can handle extreme cases if real data needs it.

## Risks and open questions

Resolved in the plan; kept here for context.

- **Straight offsets may look less elegant than bowed curves.** Start with
  perpendicular offsets because they preserve the existing CSS-div renderer and
  occlusion math; escalate to curves only if stories show the fan is hard to
  read.
- **Large parallel groups can become noisy.** Clamp spacing and record a follow-up
  for count badges or bundling rather than solving extreme multiplicity in v1.
- **Endpoint attachment can look wrong on small nodes.** Use node radii to cap
  offset spacing and story-test small-node cases.
- **Offsets may cause edge occlusion windows to shift.** This is desired:
  occlusion should describe the actual rendered segment, but it needs explicit
  spec coverage.
