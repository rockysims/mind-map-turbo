# Milestone 02: Layout — hop-distance scaling and overlap repulsion

**Status:** complete
**Depends on:** milestone 01 (needs the pinned flag and immutable
`moveNode`).
**Plan:** [2026-05-15 layout and repulsion](../plans/2026-05-15 layout-and-repulsion.md)

## Goal

Make giant graphs usable by:

1. Scaling each node's visual size by its **hop distance from the
   nearest pinned node**, with a configurable falloff and floor.
2. Gently pushing overlapping nodes apart so the graph self-tidies
   without fighting the user's drags.
3. Keeping connected nodes within a readable edge-gap band so long
   links do not strand related nodes off-screen or too far apart.

After this milestone, a 100-node graph with 1–3 pinned nodes is
readable: the pinned-and-near nodes are large and legible, distant
nodes are small but still visible, connected neighbors stay within a
readable distance, and nothing visually overlaps.

## Scope

### Pure modules

- New `lib/layout.ts`:
  - `hopsFromPinned(data): Record<string, number>` — multi-source BFS
    from the union of pinned ids; unreachable → `Infinity`.
  - `scaleByHops(hops, settings: LayoutSettings): Record<string, number>`
    — `scale = max(minScale, falloff^hops)` per node.
  - `radiusOf(scales, settings, nodeId): number` —
    `baseRadius * scales[id]`.
- New `lib/physics.ts`:
  - `relaxOverlaps(positions, radii, paddingPx, iterations = 1):
Record<string, Point>` — for each overlapping pair, push apart by
    half the overlap each (anchored nodes stay put).
  - `relaxOverlapsStep(positions, radii, paddingPx, anchoredIds: Set<string>):
Record<string, Point>` — single iteration; `relaxOverlaps`
    composes this.
  - `relaxEdgeDistancesStep(positions, radii, edges, settings, anchoredIds):
Record<string, Point>` — nudges connected endpoints toward a readable
    minimum/maximum gap band without moving anchored nodes.
  - `relaxGraphPhysics(...)` — composes edge-distance relaxation with
    overlap relaxation so graph layout has one bounded physics boundary.
- New `lib/layoutSettings.ts`:

  ```ts
  export interface LayoutSettings {
    baseRadius: number; // pixel radius at scale 1.0 (default 200)
    scaleFalloff: number; // 0–1 multiplier per hop  (default 0.7)
    minScale: number; // floor                   (default 0.1)
    paddingPx: number; // breathing room between circles (default 12)
    relaxIterations: number; // physics passes per frame (default 2)
    edgeGapMinPx: number; // minimum gap between connected nodes (default 80)
    edgeGapMaxPx: number; // maximum gap between connected nodes (default 320)
    edgeSpringStrength: number; // per-pass edge-gap correction (default 0.25)
  }
  ```

### Component wiring

- `Multigraph.svelte` renders **all** nodes (not just the primary), each
  with `transform: scale(...)` derived from the BFS scales.
- Initial graph render runs a larger bounded settling pass so dense graphs
  start readable instead of relying on the first user interaction to finish
  relaxation.
- After every move, every add/remove, and on a `requestAnimationFrame`
  loop while a drag is in progress: run graph physics and update positions.
  Pinned nodes and the currently-dragged node are anchored.
- A small `LayoutSettings` panel (or just exposed as Storybook controls
  for now) lets us tune `baseRadius`, `falloff`, etc. without recompiling.

## Acceptance criteria

- `layout.spec.ts` covers:
  - BFS with single pinned source; with multiple pinned sources (takes
    `min` of hops).
  - Unreachable nodes return `Infinity` and resolve to `minScale`.
  - `scaleByHops` honors `minScale` floor and `falloff` exponent.
- `physics.spec.ts` covers:
  - Two overlapping circles separate symmetrically (each moves by half
    the overlap).
  - Anchored nodes don't move; non-anchored absorbs the full push.
  - No-op when no overlap.
  - Convergence: after N iterations of randomly-placed circles, all
    pairwise overlaps are below `paddingPx` tolerance.
  - Connected endpoints outside the configured edge-gap band move toward
    the band, while endpoints already in range are unchanged.
  - Edge-distance relaxation respects anchored endpoints and clamps spring
    strength to a bounded range.
- `graphLayout.spec.ts` covers:
  - Initial settling uses a larger bounded relaxation budget than drag-time
    frames, capped to avoid unbounded work.
  - Graph layout composes overlap and edge-distance relaxation through a
    single pure helper.
- New / updated stories:
  - "User pins a node in a 20-node graph and neighbors scale down with
    distance" — visual + assertion that scale values match expected
    BFS distances.
  - "User drags a node into another — both push apart but neither
    gets ejected to infinity" — assert positions stay within stage.
  - "Pinned nodes do not move when a non-pinned node bumps them."
  - "Connected node follows dragged endpoint" — assert an edge endpoint
    moves toward the dragged connected node while the drag remains anchored.
  - "100-node graph" — assert the initial settled render has negligible
    overlap and connected neighbors are not left at their raw crowded
    distance.
- No measurable jank when dragging in a 100-node graph (visual check
  in Storybook; we don't add a perf test yet).

## Non-goals

- **Full force-directed layout** (global springs, gravity, velocity,
  cooldowns, or d3-force). The milestone allows the bounded edge-gap
  relaxation above, but not a general simulation engine that fights user
  drags.
- **Spatial indexing** (quadtree). O(n²) is fine to ~1000 nodes; revisit
  if perf says otherwise.
- **Animated transitions** for scale changes. Snap is fine for v1;
  smoothing comes later if needed.

## Risks and open questions

- **What's "anchored"?** Definition: pinned nodes + the currently-dragged
  node. Confirm in the plan.
- **When to run physics?** Decision: run a bounded settling pass on initial
  graph load, one-shot passes after graph mutations, and a single-pass rAF
  loop while any drag is active.
- **Sub-pixel jitter.** If iterations push nodes back and forth across
  the padding boundary, motion can shimmer. Use a small tolerance
  (`>` instead of `>=` overlap test, plus `paddingPx` slack).
- **Edge rendering.** Decision: keep minimal DOM edge lines under the node
  layer and let their endpoints follow the settled/scaled node positions.
  Rich routing, labels, and collision-aware edges remain out of scope.

## References

- `.cursor/rules/typescript.mdc` (configurable-not-constant — every
  setting passes through `LayoutSettings`).
- BFS / hop distance is textbook; worth referencing graph theory only
  in code comments where helpful.
