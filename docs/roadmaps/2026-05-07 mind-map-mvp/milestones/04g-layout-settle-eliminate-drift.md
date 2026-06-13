# Milestone 04g: Layout settle — eliminate endless drift and rotation

**Status:** complete
**Depends on:** milestones 02 (physics relaxation loop) and 04a/04b (layered
relayout and post-drag/scale settle frames).
**Plan:** [2026-06-13 04g-layout-settle-rigid-motion.md](../plans/2026-06-13%2004g-layout-settle-rigid-motion.md)

## Goal

After a drag, pin/unpin, or scale change, the visible layout should **come to
a visual stop on its own** — including stopping any whole-graph translation and
rotation — instead of sliding or spinning together until the settle-frame
timeout cuts it off abruptly.

Today the per-frame relaxation can leave the graph's _shape_ stable while the
whole node cloud keeps drifting or rotating as a rigid body. The settle check
measures absolute per-node movement (`maxPositionDelta`), so that shared rigid
motion keeps every node's delta above the epsilon and the loop runs until
`postDragSettleMaxFrames` / `layeredRelayoutSettleMaxFrames*` expire. The cut-off
is visible and feels abrupt.

After this milestone, an unpinned graph settles smoothly and stops because it is
actually done, not because a frame counter ran out.

## Scope

### Pure module

- new `Multigraph/lib/rigidMotion.ts` (+ colocated spec):
  - `normalizeRigidMotion(before, after, participatingNodeIds, anchoredNodeIds,
settings)` returning a corrected positions map.
  - **Anchor-aware** reference frame:
    - 0 anchors in the participating set → remove translation (recenter movable
      nodes to the pre-step centroid) and rotation (best-fit angle about that
      centroid).
    - exactly 1 anchor → translation is already pinned by the anchor; remove
      only rotation about the anchor point.
    - 2+ anchors → rigid motion is already constrained by the fixed geometry;
      return the input unchanged.
  - Rotation estimate is the 2D Procrustes/Kabsch best fit over **movable**
    participating nodes about the reference point:
    `theta = atan2(Σ w_i (p_i × q_i), Σ w_i (p_i · q_i))`, then rotate the
    movable post-step positions back by `-theta`.
  - Per-frame rotation is tiny, so the estimate is unambiguous. Guard against
    degenerate fits with a hard cap: if `|theta|` exceeds the configured
    per-frame maximum, skip the rotation correction for that frame (still
    recenter when applicable).
  - Anchored nodes are never moved; the function is immutable (returns a new
    map).

### Settings

- Extend `LayoutSettings` / `appConfig.multigraph.layout`:
  - `normalizeRelaxationTranslation` (boolean).
  - `normalizeRelaxationRotation` (boolean).
  - `maxRelaxationRotationPerFrameRad` (the degenerate-fit cap, e.g. `π/4`).

### Wiring

- `Multigraph/lib/graphLayout.ts`:
  - `relaxGraphPositionsStep` applies `normalizeRigidMotion` to the relaxed
    positions and returns the **corrected** positions as `step.data` — these are
    what the loop commits and renders, so the displayed graph never drifts or
    rotates as a rigid body in the first place. `maxPositionDelta` is also
    measured against the corrected positions, so the only motion left to settle
    is shape deformation, which converges on its own (rigid drift/rotation are
    free modes with no restoring force and never decay — that is why the old
    loop only stopped when the frame counter ran out).
  - Normalization runs only on the per-frame step path and only when no node is
    actively being dragged. The multi-iteration bulk path (`deriveGraphLayout`
    /`withSettledGraphPositions`) is unchanged.
- No `Multigraph.svelte` changes are required: the relaxation loop already
  commits `step.data.posByNodeId` and feeds `step.maxPositionDelta` into both
  the post-drag settle and layered-relayout advance, so both inherit the fix.

## Acceptance criteria

- `rigidMotion.spec.ts` covers, with pinned tunables:
  - 0 anchors: net translation removed (centroid preserved) and a synthetic
    rigidly-rotated cloud is returned to its original orientation.
  - 1 anchor: the anchor stays fixed and net rotation about it is removed.
  - 2+ anchors: input returned unchanged.
  - fewer than 2 movable nodes: centroid preserved, no rotation applied.
  - rotation cap: a synthetic rotation beyond the cap is left uncorrected while
    translation (when applicable) is still removed.
  - per-flag behavior: translation-only and rotation-only configurations.
  - anchored nodes are never moved; original input is not mutated.
- `graphLayout.spec.ts`: `relaxGraphPositionsStep` returns corrected positions
  and a `maxPositionDelta` measured on them; existing single-pin radial-move
  expectation (`maxPositionDelta === 20`) still holds because that motion is
  purely radial about the anchor.
- New story shows an **unpinned** graph released from an off-center, rotated
  start settles to rest and the relaxation loop ends before the settle-frame
  timeout (assert via the existing `data-settling` / relayout harness attrs and
  position stability, not a wall-clock timeout).
- Existing layout, pin/unpin, scale, and drag stories still pass.
- Lint, check, and unit tests pass.

## Non-goals

- Adding velocity/momentum integration or true frictional damping (this
  milestone removes spurious rigid motion; it does not rewrite the solver).
- Normalizing during an active drag (the user controls position then).
- Changing initial-load / bulk-settle coordinates (`withSettledGraphPositions`).
- Reducing the settle-frame caps; they remain as a safety backstop.

## Risks and open questions

- **Reference-frame correctness with 1 anchor.** Rotating only movable nodes
  about the single anchor must not introduce translation; verify the anchor is
  excluded from the movable set and stays fixed.
- **Cap value.** `π/4` per frame is generous given ~60 fps; confirm it never
  clips legitimate fast settle motion in the story coverage.
- **Weighting.** Whether to weight the best-fit by node radius or treat all
  movable nodes uniformly — resolve in the plan; default to uniform unless a
  story shows large nodes dominating undesirably.
