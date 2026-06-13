# Plan: Layout settle — rigid-motion normalization

**Created:** 2026-06-13
**Author:** Cursor agent
**Milestone:** [milestones/04g-layout-settle-eliminate-drift.md](../milestones/04g-layout-settle-eliminate-drift.md)
**Status:** draft
**Total estimated effort:** M

## Summary

Stop the visible layout from sliding and spinning as a rigid body during settle
by removing whole-graph translation and rotation from each relaxation frame, so
the loop ends when the shape is actually done instead of when the settle-frame
timeout fires.

## Open questions resolved

- **Detecting rotation.** **Estimate the per-frame best-fit (Procrustes/Kabsch)
  rotation of the movable participating nodes about the reference point and
  rotate them back by its negation.** Positions are absolute, and per-frame
  rotation is small, so the estimate is unambiguous — the symmetry concern only
  applies to absolute orientation, which we never measure.
- **Degenerate fits.** **Hard-cap the corrected rotation at
  `maxRelaxationRotationPerFrameRad` (default `π/4`).** A larger estimate can
  only come from a near-degenerate point cloud, not real motion, so the frame
  skips the rotation correction (translation is still removed when applicable).
- **Reference frame vs. anchors.** **Make normalization anchor-aware:** 0
  anchors → remove translation + rotation about the centroid; exactly 1 anchor →
  remove only rotation about the anchor; 2+ anchors → no-op. With ≥2 fixed
  anchors the rigid motion is already constrained, so correcting would fight the
  real solution.
- **When it runs.** **Only on the per-frame `relaxGraphPositionsStep` path, and
  only when `activeDragNodeId` is null.** During a drag the user controls
  position; the multi-iteration bulk path stays untouched to keep initial-load
  coordinates stable.
- **Settle metric.** **Commit and render the corrected positions, and measure
  `maxPositionDelta` on them.** Committing (not just measuring) the corrected
  positions is the crux: the displayed graph never drifts/rotates rigidly, so
  the only remaining motion is converging deformation. Rigid translation and
  rotation are free modes with no restoring force, so they never decay; removing
  them before render is what lets the loop stop on convergence instead of the
  timeout, and the post-drag and layered-relayout checks inherit the fix with no
  component change.
- **Configurability.** **Two booleans (`normalizeRelaxationTranslation`,
  `normalizeRelaxationRotation`) plus the cap.** Rotation is the riskier
  correction and benefits from being toggleable independently of translation.
- **Weighting.** **Uniform weighting across movable nodes** unless story
  coverage shows large nodes dominating; revisit only if needed.

## Out of scope (for this plan)

- Velocity/momentum integration or true frictional damping of the solver.
- Normalization during active drag.
- Changing `deriveGraphLayout` / `withSettledGraphPositions` bulk-settle output.
- Lowering the settle-frame caps (they stay as a backstop).

## Tasks

> Each task is one PR's worth of work. If a task feels like more than one
> logical commit, split it. The PR title is drafted up front so reviewers (and
> the model writing the commit) start aligned.

### T01 — Pure anchor-aware rigid-motion normalization

|                |                                                                               |
| -------------- | ----------------------------------------------------------------------------- |
| **Depends on** | —                                                                             |
| **Wave**       | 1                                                                             |
| **Agent**      | high-reasoning (`claude-opus-4-8-thinking-high` or `gpt-5.3-codex`)           |
| **Effort**     | M                                                                             |
| **Files**      | new `Multigraph/lib/rigidMotion.ts`, new `Multigraph/lib/rigidMotion.spec.ts` |
| **PR title**   | `feat(layout): add anchor-aware rigid-motion normalization`                   |

Implement `normalizeRigidMotion(before, after, participatingNodeIds,
anchoredNodeIds, settings)` returning a corrected positions map. Compute the
movable set (participating minus anchored), pick the reference frame from the
anchor count, recenter to the pre-step reference, estimate the best-fit rotation
`theta = atan2(Σ (p_i × q_i), Σ (p_i · q_i))` about the reference over movable
nodes, and rotate movable post-step positions back by `-theta` (skipping the
rotation when `|theta|` exceeds the cap). Take the tunables as a settings
argument with defaults so the spec can pin them. Anchored nodes pass through
unchanged; never mutate the input.

**Acceptance**

- 0 anchors: net translation removed (centroid matches the pre-step centroid)
  and a synthetic rigidly-rotated `after` is restored to the `before`
  orientation (within tolerance).
- 1 anchor: the anchor is unchanged and net rotation about it is removed.
- 2+ anchors: returns the input positions unchanged.
- Fewer than 2 movable nodes: centroid preserved, no rotation applied.
- Cap: a synthetic rotation beyond `maxRelaxationRotationPerFrameRad` is left
  uncorrected while translation is still removed when applicable.
- Flags: `normalizeRelaxationTranslation: false` keeps the drift; rotation flag
  behaves symmetrically.
- Immutability: original `after` map and its points are not mutated.

### T02 — Rigid-motion normalization settings

|                |                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                           |
| **Wave**       | 1                                                                                           |
| **Agent**      | fast/cheap (`composer-2.5-fast` or `kimi-k2.5`)                                             |
| **Effort**     | XS                                                                                          |
| **Files**      | `appConfig.ts`, `Multigraph/lib/layoutSettings.ts`, `Multigraph/lib/layoutSettings.spec.ts` |
| **PR title**   | `feat(layout): add rigid-motion normalization settings`                                     |

Add `normalizeRelaxationTranslation`, `normalizeRelaxationRotation`, and
`maxRelaxationRotationPerFrameRad` to `LayoutSettings` and
`APP_CONFIG.multigraph.layout` with inline default comments (translation/rotation
default `true`, cap default `Math.PI / 4`).

**Acceptance**

- `DEFAULT_LAYOUT_SETTINGS` still equals `APP_CONFIG.multigraph.layout`.
- Per the "pin new fields" guidance in `typescript.mdc`: grep the partial
  `LayoutSettings` literals in `graphLayout.spec.ts`, `scaleAnimation.spec.ts`,
  and `Multigraph.stories.svelte`; for any whose expectations would shift under
  the new defaults, pin the new fields to the pre-existing behavior. (Expected to
  be a no-op for the existing single-pin/`withSettled` cases, but verify rather
  than assume.)
- Lint, check, unit tests pass.

### T03 — Normalize rigid motion inside the relaxation step

|                |                                                                       |
| -------------- | --------------------------------------------------------------------- |
| **Depends on** | T01, T02                                                              |
| **Wave**       | 2                                                                     |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)               |
| **Files**      | `Multigraph/lib/graphLayout.ts`, `Multigraph/lib/graphLayout.spec.ts` |
| **Effort**     | M                                                                     |
| **PR title**   | `feat(layout): normalize rigid motion in relaxation step`             |

In `relaxGraphPositionsStep`, after computing relaxed positions, derive the
anchored set and participating set (already available from the options/data the
function uses), apply `normalizeRigidMotion` when `activeDragNodeId` is null and
either normalization flag is on, commit the corrected positions, and compute
`maxPositionDelta` against the corrected positions. Leave `deriveGraphLayout`,
`relaxGraphPositions`, and `withSettledGraphPositions` bulk output unchanged.

**Acceptance**

- Existing `relaxGraphPositionsStep` test still passes
  (`maxPositionDelta === 20` for the single radially-moving pinned pair).
- New spec: an unpinned 0-anchor pair given a relaxed result that is rigidly
  translated/rotated returns corrected positions whose centroid and orientation
  match the input, with a `maxPositionDelta` that reflects only deformation.
- New spec: with `activeDragNodeId` set, `relaxGraphPositionsStep` does not
  normalize (matches today's behavior).
- The `withSettledGraphPositions` large-graph overlap test is unaffected.

### T04 — Story: graph settles to a visual stop without timeout

|                |                                                              |
| -------------- | ------------------------------------------------------------ |
| **Depends on** | T03                                                          |
| **Wave**       | 3                                                            |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)      |
| **Effort**     | S                                                            |
| **Files**      | `Multigraph.stories.svelte`                                  |
| **PR title**   | `test(multigraph): cover drift-free settle to a visual stop` |

Add a story that loads an unpinned graph from an off-center, rotated start, lets
the relaxation loop run, and asserts the layout reaches rest and the loop clears
its settling state (via `data-settling` / layered-relayout harness attributes
and position stability) rather than running out the settle-frame budget.

**Acceptance**

- Story asserts `data-settling` clears and node positions stop changing while
  settle frames remain available (i.e. the stop was not the timeout).
- Story asserts the graph's centroid does not drift across the settle.
- Existing pin/unpin, scale, and drag stories still pass.

## Wave plan

```
Wave 1   T01  ‖  T02         (pure normalizer and settings; different files)
Wave 2   T03                 (wires T01 into the step using T02's settings)
Wave 3   T04                 (story exercises the wired behavior)
```

Total: 4 tasks. T01 and T02 touch disjoint files and run in parallel; T03 and
T04 are sequential gates.

A simple invariant to check before kicking off a wave: every task in the wave
has all its `Depends on` items already merged to `main`.

## Risks and rollback

- **T01 best-fit math is the load-bearing piece.** If the rotation estimate is
  wrong, the layout could be nudged in the wrong direction every frame.
  Mitigation: exhaustive pure spec with synthetic known rotations, and the
  per-frame cap bounds any single-frame error. Land and review T01 before T03.
- **1-anchor rotation introducing translation.** A bug rotating about the wrong
  point would slide the anchor. Mitigation: spec asserts the anchor is bit-for-bit
  unchanged in the 1-anchor case.
- **Unexpected default-flag fallout in existing specs/stories.** Covered by the
  T02 pin-new-fields sweep; if anything shifts, pin the field in that call site
  rather than changing the new default.
- **Rollback.** The behavior is gated entirely by the two settings; defaulting
  both to `false` disables normalization without reverting code.

## Definition of Done (this plan)

The plan is done when:

- All 4 tasks are merged to `main`.
- The acceptance criteria from the milestone doc are satisfied.
- `pnpm --filter mind-map-sv lint` passes.
- `pnpm --filter mind-map-sv check` passes.
- `pnpm --filter mind-map-sv test:unit -- --run` passes.
- Plan status is `done`, milestone status is `complete`, and the roadmap status
  for 04g is `complete` with a link back to this plan.

## Notes

- 2026-06-13: No `Multigraph.svelte` change is expected — the relaxation loop
  already commits `step.data.posByNodeId` and consumes `step.maxPositionDelta`
  for both post-drag settle and layered-relayout advance, so routing the
  correction through `relaxGraphPositionsStep` covers every automatic path.
