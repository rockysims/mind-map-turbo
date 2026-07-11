# Plan: Single-surface morph (one frame element for deep zoom)

**Created:** 2026-07-10
**Author:** Cursor agent
**Milestone:** [milestones/06c-single-surface-morph.md](../milestones/06c-single-surface-morph.md)
**Status:** draft
**Total estimated effort:** L (5 tasks across 4 waves; pure frame geometry,
shared chrome extraction, morph surface component, production rewiring,
cleanup/closeout)

## Summary

Replace the two-instance frame handoff (in-stage preview node → overlay node)
with a single `MorphSurface` overlay that owns the frame for the entire deep
zoom interaction, driven by one pure geometry function and crossfading
fixed-layout, transform-scaled content layers inside it — eliminating both
handoff seams, the dual geometry math, and all DOM-measurement compensation.

## Open questions resolved

- **Handoff shimmer at progress 0.** **Accept subpixel rasterization
  differences; assert geometry (not pixels) with a ≤ 1 px tolerance in the
  continuity story.** Both sides are the same component under a scale
  transform, so any residual difference is compositor rasterization; if a
  visible pop shows up on device, add a one-frame visibility overlap at the
  swap as a contingency, not up front.
- **Mount/unmount thrash near progress 0.** **Keep the surface mounted while
  the focus candidate persists and unmount only when progress is 0 and the
  gesture has idled (reuse `entryGestureIdleMs`).** Gentle scrubs that hover
  around the zone edge then reuse one mounted surface instead of thrashing;
  no new hysteresis tunable.
- **Chrome extraction scope.** **Everything that paints the `.circle` chrome
  moves into a shared `NodeChrome` component: border, background, radius,
  pinned halo, tag-border conic gradient, spotlight color.** Positioning,
  wrapper scale, and graph interactivity stay in `Node.svelte`/`Multigraph`.
  One paint path means the surface and the in-stage node cannot drift.
- **Who owns the crossfade.** **The surface owns all intermediate-progress
  rendering; `Node.svelte` becomes compact-only.** The `detailsProgress` /
  `detailsWidthPx` / `detailsHeightPx` / `detailsMode` props and the internal
  compact↔details crossfade leave `Node.svelte`; the details layer becomes a
  shared `NodeDetailsLayer` component rendered only by the surface. The
  in-stage node never renders intermediate progress again.
- **ZoomWorld interplay with the frame's content scale.** **No double
  scaling by construction: `ZoomWorld` is only live at progress 1, and exit
  requires centered fit (world at fit transform) before progress may fall.**
  At any progress < 1 the world transform is the fit identity, so the frame's
  transform-scaling of the details layer is the only scale in play; at
  progress 1 the frame is the fill rect (scale 1) and `ZoomWorld` is the only
  scale. The controller specs pin this ordering already (06b).
- **Where the surface lives relative to `DeepZoomStack`.** **The morph
  surface is the level layer: `DeepZoomLayer` is reworked to consume
  `frameGeometry` and host the dual content layers, and `Multigraph` mounts
  `DeepZoomStack` instead of `NodeFocusSurface`.** This lands 06b's T05
  intent (stack in production) instead of keeping a bespoke single-level
  wrapper alive alongside the stack.
- **What happens to `interpolateMorph` and `borderRadiusForProgress`.**
  **`frameGeometry` composes `interpolateMorph` (extended with a border-width
  channel) over a derived — never measured — source rect;
  `borderRadiusForProgress` is deleted with the preview pathway.** One radius
  formula remains, in one module.

## Out of scope (for this plan)

- Image (or other block) inspection as a nested zoom level — next consumer
  milestone; images stay inside node details, enlargeable by free world zoom.
- Retrofitting `Stage.svelte` graph zoom onto the shared world abstraction.
- Browser Back/history; persisting focus-mode camera state.
- Gate feel/tunable changes (zone fractions, margins, swallow timing).
- Visual redesign of node or details styling beyond the chrome extraction.

## Tasks

### T01 — Pure frame geometry: derived source rect + border-width channel

|                |                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| **Depends on** | —                                                                                                      |
| **Wave**       | 1                                                                                                      |
| **Agent**      | default (claude-4.6-sonnet-medium-thinking)                                                            |
| **Effort**     | M                                                                                                      |
| **Files**      | new `Multigraph/lib/frameGeometry.ts` + spec, `Multigraph/lib/morphGeometry.ts` + spec, `appConfig.ts` |
| **PR title**   | `feat(focus): add pure frame geometry with derived source rect`                                        |

Add `frameGeometry(nodeLayout, viewState, fillRect, progress, opts)` returning
`{ x, y, width, height, borderRadiusPx, borderWidthPx }`. The source rect is
derived from node layout + pan/scale (reuse `nodeScreenCircle` /
`graphPointToClientPoint` math), never measured. Extend `interpolateMorph`
with a border-width channel interpolating from
`NODE_BORDER_WIDTH × source visual scale` (pinned variant included) to a
`detailsBorderWidthPx` tunable added to the `appConfig` focus block.
`frameGeometry` composes the derived source rect through `interpolateMorph`.
Do not remove `borderRadiusForProgress` or measurement callers yet (T04/T05).

**Acceptance**

- Specs: progress 0 equals the derived on-screen rect/radius/border width for
  several `(pan, scale, nodeScale)` combinations and tracks a changing view
  state between calls; progress 1 equals the fill rect + details
  radius/border width; mid values interpolate every channel; pinned border
  width is respected at the source end.
- No Svelte/DOM imports; every tunable is a parameter with an `appConfig`
  default; existing `interpolateMorph` callers still compile and pass.

### T02 — Extract shared chrome and content-layer components from Node

|                |                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Depends on** | —                                                                                                                                          |
| **Wave**       | 1                                                                                                                                          |
| **Agent**      | default (claude-4.6-sonnet-medium-thinking)                                                                                                |
| **Effort**     | M                                                                                                                                          |
| **Files**      | `Node/Node.svelte`, new `Node/NodeChrome.svelte`, new `Node/NodeCompactContent.svelte`, new `Node/NodeDetailsLayer.svelte`, `Node` stories |
| **PR title**   | `refactor(node): extract shared chrome and content layers`                                                                                 |

Behavior-preserving refactor: pull the `.circle` chrome (border, background,
radius, pinned halo, tag-border gradient, spotlight) into `NodeChrome`, the
compact title/`SquareText`/edit-input layer into `NodeCompactContent`, and the
details article (header + body slot around `NodeDetailsContent`) into
`NodeDetailsLayer`. `Node.svelte` re-renders identically by composing them;
`NodeFocusSurface` keeps working unchanged. Keep the existing preview props
functional in this task — removal happens in T04/T05 so this PR stays a pure
refactor.

**Acceptance**

- All existing Node/Multigraph stories pass unchanged (visual behavior
  preserved, including pinned and tag-border rendering).
- The three new components have no graph/layout knowledge (props in, markup
  out) and `Node.svelte` contains no duplicated chrome CSS.
- Lint, check, unit/story tests pass.

### T03 — MorphSurface: one frame element with dual transform-scaled layers

|                |                                                                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T01, T02                                                                                                                                                  |
| **Wave**       | 2                                                                                                                                                         |
| **Agent**      | high-reasoning (claude-opus-4-8-thinking-high or gpt-5.3-codex)                                                                                           |
| **Effort**     | L                                                                                                                                                         |
| **Files**      | `Multigraph/DeepZoomLayer.svelte`, `Multigraph/DeepZoomStack.svelte`, `Multigraph/DeepZoomStackHarness.svelte`, `Multigraph/DeepZoomStack.stories.svelte` |
| **PR title**   | `feat(focus): morph surface with fixed-layout crossfading content layers`                                                                                 |

Rework `DeepZoomLayer` into the morph surface: it renders `NodeChrome` as the
frame (rect/radius/border width from `frameGeometry` output passed in as
geometry props) and hosts two absolutely positioned content snippets — a
compact layer laid out at the node's logical diameter and a details layer laid
out at the fill size — each `transform: scale()`-ed (top-left origin) to the
current frame and crossfaded by progress. Only transform/opacity change
during the morph; layout happens once per endpoint. The details snippet
mounts lazily on first nonzero progress. The surface is
`pointer-events: none` below progress 1. `DeepZoomStack` keeps stacking these
layers with `ZoomWorld` wrapping the active level's details layer only at
progress 1.

**Acceptance**

- Stories: scrubbing progress 0→1→0 crossfades the layers with no content
  re-layout (assert layer size attributes stay constant while transforms
  change); the same surface element (by identity/data attribute) spans the
  whole scrub; details content mounts once, lazily.
- The depth-2 placeholder recursion story from 06b passes with the reworked
  layer (enter/exit both levels with the same gestures).
- Below progress 1 the surface does not intercept pointer events (story
  asserts events reach the element beneath).
- The component keeps zero content-type knowledge (snippets only); reduced
  motion path reaches end states without intermediate frames.

### T04 — Rewire Multigraph: DeepZoomStack in production, one progress channel

|                |                                                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T03                                                                                                                                 |
| **Wave**       | 3                                                                                                                                   |
| **Agent**      | high-reasoning (claude-opus-4-8-thinking-high or gpt-5.3-codex)                                                                     |
| **Effort**     | L                                                                                                                                   |
| **Files**      | `Multigraph.svelte`, `Multigraph.stories.svelte`, `Stage.svelte`, `focusRuntime.svelte.ts` + spec, delete `NodeFocusSurface.svelte` |
| **PR title**   | `feat(focus): single morph surface owns the frame across the round trip`                                                            |

Mount `DeepZoomStack` in `Multigraph` in place of `NodeFocusSurface`. The
surface mounts when a candidate's boundary progress first becomes nonzero (or
on explicit Focus) and unmounts at progress 0 after gesture idle; the in-stage
node hides (`visibility`) exactly while the surface is mounted. Entry scrub,
commit, focused state, and exit scrub all drive the **same** level progress
through `frameGeometry` — delete the in-stage preview channel
(`focusPreviewProgress`, `focusPreviewSizeForNode`, preview props passed to
the stage `Node`) and all measurement compensation
(`nodeRenderMetricsForNodeId` DOM read, `measuredBorderWidthPx`,
`ensureFocusExitTarget` / `exitSourceRect`, captured morph source). Exit
tracks the node's current position because the source rect is derived each
frame. Explicit Focus pushes the same level from the node's derived rect.

**Acceptance**

- Continuity story asserts no rect/radius/border jump (≤ 1 px) at the
  progress-0 handoff in both directions, and that one surface element spans
  entry scrub → committed → exit scrub.
- 06b behavior regression: partial scrub reverses without committing; bold
  flick commits and stops (one boundary per gesture, both directions); exit
  requires centered fit; explicit Focus lands in the same details state;
  reduced motion skips the morph; persisted `ViewState.scale` stays clamped.
- `rg getBoundingClientRect` over the focus path
  (`Multigraph.svelte`, `DeepZoom*`, `focusRuntime`, `nodeFocus`) is clean;
  `NodeFocusSurface.svelte` is deleted.
- Focus accessibility (dialog role, labelled title, close affordance, Escape)
  is preserved on the stack/surface.

### T05 — Node cleanup, dead code removal, coverage, closeout

|                |                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Depends on** | T04                                                                                                                                        |
| **Wave**       | 4                                                                                                                                          |
| **Agent**      | default (claude-4.6-sonnet-medium-thinking)                                                                                                |
| **Effort**     | M                                                                                                                                          |
| **Files**      | `Node/Node.svelte`, `Node` stories, `Multigraph/lib/zoomBoundary.ts` + spec, `Multigraph/lib/nodeFocus.ts` + spec, `e2e/app.test.ts`, docs |
| **PR title**   | `refactor(node): drop preview-morph props and dual radius math`                                                                            |

Remove the now-unused `detailsProgress` / `detailsWidthPx` /
`detailsHeightPx` / `detailsMode` props and preview CSS from `Node.svelte`
(compact-only), delete `borderRadiusForProgress` and any other
preview-pathway exports (confirm no remaining callers), and drop dead focus
helpers in `nodeFocus.ts` (e.g. estimated-border fallbacks superseded by the
border-width channel). Re-run and update the wheel-driven e2e smoke
(graph → focus → exit) against the new DOM. Update this plan, milestone 06c,
and the roadmap row.

**Acceptance**

- `Node.svelte` has no intermediate-progress rendering; no dead exports or
  doc references to the preview pathway or `NodeFocusSurface` remain.
- Full validation passes: lint, check, `test:unit -- --run`, and the e2e
  smoke.
- Plan status `done`, milestone 06c `complete`, roadmap row updated.

## Wave plan

```text
Wave 1   T01  ‖  T02      (pure geometry; chrome extraction — disjoint files)
Wave 2   T03              (morph surface component on both foundations)
Wave 3   T04              (production rewiring, deletion of the old path)
Wave 4   T05              (Node cleanup, dead code, e2e, closeout)
```

T01 and T02 touch disjoint files and run in parallel. T03 needs both; T04
reshapes production wiring on top of T03; T05 removes what T04 orphaned and
closes out. T02 is deliberately behavior-preserving so it can merge without
waiting on any design validation from T01/T03.

## Risks and rollback

- **T04 is the riskiest task.** It swaps the production focus path in one PR
  so no half-migrated state ships (two frame owners _and_ a stack would be
  worse than today). If it balloons past `L`, split along the mount boundary
  — first land "surface handles committed + exit with derived rects" (still
  mounting at commit), then move the mount to zone entry — rather than
  shipping a partial mixture of measured and derived geometry.
- **Derived source rect disagrees with the real render.** The whole design
  assumes the node's on-screen rect is exactly computable from layout + view
  state. Any drift (e.g. wrapper transform rounding) shows up at the
  progress-0 handoff; the continuity story catches it, and the fix is in one
  pure function. Rollback: `git revert` of T04 restores the measured path
  (T01–T03 are additive/behavior-preserving).
- **Compositor shimmer at the visibility swap.** Accepted per the resolved
  question; contingency is a one-frame overlap at the swap, gated behind a
  story-verified need, not speculatively added.
- **Chrome extraction (T02) subtly changes node rendering.** Mitigated by
  running the full existing story suite unchanged; any diff is a T02 bug by
  definition.
- **Details layer laid out at fill size gets heavy when scaled far down.**
  Lazy mount plus the fact that it only appears once progress is nonzero
  bounds the cost; if scrubbing still stutters on device, defer detail-layer
  mount until a progress threshold (tunable) as a follow-up constant change.
- **Recursion regressions.** The depth-2 placeholder story and the 3-level
  focus-stack specs from 06b must keep passing with the reworked layer; T03
  cannot merge without them.

## Definition of Done (this plan)

- All 5 tasks are merged; milestone 06c acceptance criteria are satisfied.
- `pnpm --filter mind-map-sv lint` passes.
- `pnpm --filter mind-map-sv check` passes.
- `pnpm --filter mind-map-sv test:unit -- --run` passes.
- The wheel-driven e2e smoke (graph → node focus → exit) passes.
- Plan status is `done`, milestone 06c is `complete`, and the roadmap row is
  updated with a link back to this plan.
- The finished work is committed unless the user explicitly asks not to.

## Notes

- 2026-07-10: Plan created from a design review of the shipped 06b node round
  trip. Root cause of the remaining "same element" fragility: the frame
  changes owners twice per round trip (in-stage preview node → overlay node →
  in-stage node), with two geometry authorities (`borderRadiusForProgress` +
  graph-unit preview sizing vs `interpolateMorph` over measured rects) kept
  in sync by DOM measurement and border-width compensation. Design locked:
  one morph surface owns the frame from zone entry to exit idle; one pure
  `frameGeometry` with a derived (never measured) source rect; content as two
  fixed-layout, transform-scaled, crossfaded layers (container-transform
  pattern) built from chrome/content components shared with `Node.svelte`;
  handoffs only at progress ≈ 0 where the surface is pixel-identical by
  construction; `DeepZoomStack` finally becomes the production path.
  Rejected alternatives: keeping the in-stage node as the frame to progress 1
  (fullscreen content laid out under the stage scale wraps and rasterizes
  wrong; stage would own dialog scroll/gestures) and literal DOM reparenting
  (fragile under Svelte's managed anchors; `moveBefore()` not cross-browser).
