# Plan: Edge occlusion zoom and window semantics

**Created:** 2026-06-13
**Author:** Cursor agent
**Milestone:** [milestones/04j-edge-occlusion-fade.md](../milestones/04j-edge-occlusion-fade.md)
**Status:** done
**Total estimated effort:** S (3 tasks; one pure-geometry fix, one zoom-behavior
change, one focused story pass)

## Summary

Correct the follow-up behavior discovered after 04j shipped: overlapping
occlusion windows must not wash out the clear edge span between unrelated nodes,
and zoom should visibly change the occlusion pullback/cutoff rather than merely
keeping the fade ramp constant on screen.

## Open questions resolved

- **Same milestone or new milestone.** **Use a supplemental 04j plan.** The work
  fixes and tunes the edge-occlusion behavior delivered by 04j; it does not add a
  new product area.
- **Why zoom appeared ineffective.** **The prior zoom helper scaled only
  `edgeOcclusionFadeWidthPx`, which is the soft ramp, not the core/pullback.**
  With `edgeOcclusionFadeWidthPx = 0`, the cutoff is entirely controlled by the
  core (`chord + clearance`), so zoom has no visible effect.
- **Merge semantics.** **Never merge separate cores into one min-opacity core.**
  If two fade ramps overlap but their actual node-crossing cores are separate,
  the edge segment between those cores should remain capable of returning toward
  full opacity instead of being collapsed to `edgeOcclusionMinOpacity`.
- **Zoom response target.** **Zoom affects visible-edge occlusion only, and it
  should move both pullback and ramp.** Boundary edges stay radius-based; visible
  edge occlusion scales the post-intersection pullback/clearance and fade ramp
  from the live stage scale.
- **Formula.** **Use graph-space multipliers derived from zoom with clamps, but
  make the intended screen-space behavior explicit in tests.** The current
  `base / scale` formula keeps screen-space width roughly constant; the follow-up
  should use a stronger zoom-out response for pullback/cutoff so the visible
  cutoff moves when zooming out, including when the fade width is `0`.
- **Hard debug case.** **Pin `edgeOcclusionFadeWidthPx = 0` in tests.** This is
  the easiest way to prove the cutoff itself moves rather than only the soft
  ramp.

## Out of scope (for this plan)

- Boundary-edge fade behavior; it remains dashed and radius-windowed from the
  visible node.
- Occlusion on reveal-wave-buffer and exiting edges.
- Spatial indexing or broad performance refactors.
- SVG/mask renderer migration.
- New app-level config fields unless the pure helpers need named clamp defaults.

## Tasks

> Each task is one PR. T01 and T02 both touch `edgeOcclusion.ts`, so they are
> sequenced even though they are conceptually independent.

### ✓ T01 - Preserve full-opacity gaps between separate occlusion cores

|                |                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| **Depends on** | -                                                                                                    |
| **Wave**       | 1                                                                                                    |
| **Agent**      | default (claude-4.6-sonnet-medium-thinking)                                                          |
| **Effort**     | S                                                                                                    |
| **Files**      | `Multigraph/lib/edgeOcclusion.ts`, `Multigraph/lib/edgeOcclusion.spec.ts`, maybe `edgeStyle.spec.ts` |
| **PR title**   | `fix(multigraph): preserve clear spans between occlusion windows`                                    |

Change window merging so overlapping fade ramps do not automatically collapse the
entire span between two node cores into one min-opacity core. Keep deterministic
ordering and merging for truly overlapping/touching cores, but preserve separate
cores when only their ramps overlap.

**Acceptance**

- Spec covers two nodes whose ramps overlap but cores do not: output preserves
  separate cores and the gradient can return toward full opacity between them.
- Spec covers cores that overlap/touch: output merges deterministically.
- Existing single-node, endpoint-exclusion, near-miss, and disabled-opacity specs
  still pass.
- No `edgeOcclusionMinOpacity` wash across a B-C span when only B and C occlude
  an A-D edge.

### ✓ T02 - Make occlusion pullback and ramp respond visibly to zoom

|                |                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T01                                                                                                            |
| **Wave**       | 2                                                                                                              |
| **Agent**      | high-reasoning (claude-opus-4-8-thinking-high or gpt-5.3-codex)                                                |
| **Effort**     | S                                                                                                              |
| **Files**      | `Multigraph/lib/edgeOcclusion.ts`, `Multigraph/lib/edgeOcclusion.spec.ts`, `Stage.svelte`, `Multigraph.svelte` |
| **PR title**   | `fix(multigraph): scale occlusion cutoff with zoom`                                                            |

Replace or extend the current zoom helper so the effective occlusion parameters
make the cutoff visibly move when zoom changes. The helper should return both
effective clearance/pullback and effective fade width (or a typed parameter
object) from base settings and live stage scale. Keep the intersection gate tied
to the true node radius: zoom may widen pullback after a real crossing, but it
must not make near-miss edges occlude.

**Acceptance**

- Pure specs cover scale `1`, zoomed out, zoomed in, and clamp boundaries for
  both clearance/pullback and fade width.
- With `edgeOcclusionFadeWidthPx = 0`, zoomed-out scale still changes
  `coreStart/coreEnd` compared with scale `1`.
- Near-miss outside the node radius remains a no-op even with zoom-inflated
  clearance/pullback.
- `Stage` live-scale plumbing remains warning-free under `svelte-check`.
- Boundary-edge radius fade is unchanged.

### ✓ T03 - Add stories for the observed zoom regression

|                |                                                            |
| -------------- | ---------------------------------------------------------- |
| **Depends on** | T01, T02                                                   |
| **Wave**       | 3                                                          |
| **Agent**      | default (claude-4.6-sonnet-medium-thinking)                |
| **Effort**     | S                                                          |
| **Files**      | `Multigraph.stories.svelte`                                |
| **PR title**   | `test(multigraph): cover zoomed occlusion cutoff behavior` |

Add browser/story coverage that reproduces the user's observed failure and pins
the intended behavior.

**Acceptance**

- Story with an A-D edge crossed by B and C proves the B-C span is not uniformly
  `edgeOcclusionMinOpacity` when the two cores are separate.
- Story with `edgeOcclusionFadeWidthPx = 0` proves the cutoff/cored window
  changes between `initialViewState.scale = 1` and a zoomed-out scale.
- Existing static crossing, near-miss, dragging, dense-graph, and boundary-edge
  stories still pass.

## Wave plan

```text
Wave 1   T01                  (fix merge semantics)
Wave 2   T02                  (zoom-aware cutoff/pullback; depends on T01)
Wave 3   T03                  (story regression coverage; depends on T01,T02)
```

Total: 3 tasks, all serial because they touch the same core occlusion behavior
or its Storybook assertions.

## Risks and rollback

- **Gradient stop complexity.** Preserving separate cores while ramps overlap may
  require richer stop generation than the current merged-window shape. Keep the
  data model pure and spec-covered; rollback is to disable ramp-overlap merging
  entirely before attempting a more clever union.
- **Zoom formula feels too strong or too weak.** The pure helper should expose
  clamp constants and tests should state the intended visible behavior. If the
  first formula feels wrong, changing the helper is isolated.
- **Stage live-scale plumbing regresses gestures.** Keep the existing
  `onViewStateChange` completion callback untouched; the live callback remains
  render-only and covered by existing Stage stories plus `svelte-check`.
- **Dense graph gradients get noisy.** Preserve existing dense-graph guardrails
  and keep spatial indexing out of scope unless performance regresses.

## Definition of Done (this plan)

- All 3 tasks are merged.
- `pnpm --filter mind-map-sv lint` passes.
- `pnpm --filter mind-map-sv check` passes with 0 warnings.
- `pnpm --filter mind-map-sv test:unit -- --run` passes.
- Follow-up plan status is set to `done` when complete.

## Notes

- 2026-06-13: The observed B-C behavior comes from merging by ramp overlap and
  then expanding `coreStart/coreEnd` across both nodes. That makes the gap
  between two unrelated occluders hit `edgeOcclusionMinOpacity` until zoom shrinks
  the ramps enough to split the windows.
- 2026-06-13: The previous `baseFadeWidth / scale` helper keeps ramp width
  roughly constant in screen space. That is not enough for a visible zoom-out
  effect, and with `edgeOcclusionFadeWidthPx = 0` it has no effect at all.
