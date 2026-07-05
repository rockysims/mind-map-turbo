# Plan: Continuous deep zoom

**Created:** 2026-07-04
**Author:** Codex agent
**Milestone:** [milestones/06a-continuous-deep-zoom.md](../milestones/06a-continuous-deep-zoom.md)
**Status:** draft
**Total estimated effort:** XL (6 tasks across 5 waves; shared gate geometry,
node details mode, in-place entry morph, focus-world zoom, gated image zoom,
coverage and cleanup)

## Summary

Rework the milestone 06 deep-zoom gestures into one continuous nested-zoom
model: a shared pure "inscribed -> steer -> accumulate -> commit" gate applied
at the graph/node, focus-dialog, and image boundaries, with the real node
component morphing in place (border radius as the accumulator visualization)
and serving as the focus dialog so borders match by construction.

## Open questions resolved

- **Steering vs focal anchoring.** **Zoom stays focal-anchored; steering is a
  pan clamp applied after the focal transform.** Near a boundary the clamp
  keeps a touching side on screen (entry) or keeps content covering the
  viewport (exit), so recentering emerges from clamp math instead of bespoke
  animation. If clamping ever fights the focal anchor visibly, the clamp wins
  at the boundary and the anchor wins elsewhere.
- **Overzoom cap.** **Replace the fixed `maxScale x 1.65` corridor with a
  dynamic cap: overzoom continues exactly until the focal node is inscribed
  (plus the near-touch margin).** The fixed cap leaves distant small nodes
  permanently unable to reach the gate; the dynamic cap makes every visible
  node enterable and gives the cap a geometric meaning.
- **Scale behavior during accumulation.** **Scale freezes at the inscribed
  scale; blocked input is spent on the accumulator and visualized as border
  radius.** Backing off decays the accumulator and re-rounds the radius; the
  camera does not creep during accumulation.
- **Accumulator visualization per boundary.** **Node boundary: border-radius
  un-rounding on the real in-stage node (entry) and re-rounding on the details
  surface (exit). Dialog and image boundaries: no bespoke visualization beyond
  the frozen-scale resistance.** One vivid signal at the flagship boundary;
  keep the inner gates simple until they prove confusing.
- **Handoff continuity.** **One geometry source of truth: the commit animation
  and the focus-world initial camera are both computed from the same
  screen-rect math (`nodeScreenCircle`-derived), and the dialog is the same
  `Node` component.** Acceptance asserts the node's on-screen rect and border
  are continuous across the stage-to-focus-world handoff.
- **Details-mode content.** **`Node.svelte` gains a progress-driven details
  mode but stays presentational; details content (description, images) is
  injected via a Svelte 5 snippet prop.** Asset object-URL logic stays in the
  focus surface/Multigraph layer, so Node never touches the asset store.
- **Explicit Focus action.** **The menu Focus command plays the same commit
  animation starting from the node's current screen geometry, with no zoom
  prerequisite.** One transition implementation, two entry points; the current
  no-morph fade path is removed.
- **Border parity after commit.** **The details surface keeps the node's own
  border styling (width, pinned ring, tag conic gradient) exactly; no separate
  dialog frame styling remains.** Any future "thinner reading border" easing is
  explicitly out of scope.
- **Pinch parity.** **Wheel and pinch feed the same gate model at every level,
  including inside the focus and image worlds.** The current wheel-only focus
  surface is a mobile bug, not a polish gap.
- **Gesture test strategy.** **Gate math, steering, cover clamps, and radius
  mapping are pinned by pure specs; wheel-driven flows are covered by stories
  and one e2e smoke; pinch inside focus/image worlds is verified by pure specs
  plus a manual device smoke noted in the closeout task.** Synthetic
  multi-pointer pinch in Playwright/stories is brittle; the pure model carries
  the correctness burden.

## Out of scope (for this plan)

- Browser Back/history integration.
- Multi-image gallery controls, thumbnails, cropping, or annotations.
- Graph schema, asset storage, or HTML asset embedding changes.
- Persisting focus-mode or image-zoom camera state.
- Reworking focus content layout/visual design beyond the details mode and
  zoom continuity.
- Post-commit border-thickness easing on the details surface.

## Tasks

### T01 - Add pure gated zoom-boundary geometry

|                |                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------ |
| **Depends on** | -                                                                                                |
| **Wave**       | 1                                                                                                |
| **Agent**      | Default workhorse                                                                                |
| **Effort**     | M                                                                                                |
| **Files**      | new `Multigraph/lib/zoomBoundary.ts` + spec, `nodeFocus.ts`, `nodeFocus.spec.ts`, `appConfig.ts` |
| **PR title**   | `feat(focus): add gated zoom boundary geometry`                                                  |

Create the shared pure model used by all three boundaries: inscribed-contact
detection for circles and rects with a near-touch margin (touching both top and
bottom OR both left and right); the inscribe scale for a subject (the dynamic
overzoom cap); a steering pan clamp for zoom-in (touching side never crosses
off screen); a cover pan clamp for zoom-out (content keeps covering the
viewport, forcing recentering as scale falls toward fit); and the
progress-to-border-radius mapping. Consolidate hardcoded tunables into the
`appConfig.ts` focus block (near-touch margin, wheel sensitivity inside focus,
exit delta scaling; remove the fixed overzoom multiplier).

**Acceptance**

- Specs cover contact detection for centered/off-center subjects, margins,
  both axes, and the OR rule; steering clamps that hold a touching side while
  the opposite side closes; cover clamps that recenter monotonically as scale
  drops to fit; inscribe-scale math for circle and rect subjects; and the
  radius mapping at progress 0, mid, and 1.
- Existing overshoot accumulator specs still pass; the gate model composes
  with `overshootInput`/`decayOvershoot` without changes to their semantics.
- No Svelte/DOM imports; every tunable is a parameter with a default sourced
  from `appConfig.ts`.

### T02 - Add Node details mode

|                |                                                                       |
| -------------- | --------------------------------------------------------------------- |
| **Depends on** | -                                                                     |
| **Wave**       | 1                                                                     |
| **Agent**      | Default workhorse                                                     |
| **Effort**     | M                                                                     |
| **Files**      | `Node/Node.svelte`, Node stories, `types/*` if a props type is shared |
| **PR title**   | `feat(node): add progress-driven details mode`                        |

Give `Node.svelte` a details mode: a `detailsProgress` (0-1) prop interpolating
border radius from circle to a small corner radius, and a details layout that
renders title plus injected details content (description, images) via a snippet
prop. Border styling (default, pinned ring, tag-segment conic gradient) is the
same code path in both modes. Node stays presentational: no asset-store or
focus-state knowledge.

**Acceptance**

- `detailsProgress: 0` renders exactly today's circle (stories/visuals
  unchanged); `1` renders the squarish details surface with slight corner
  rounding; intermediate values interpolate border radius.
- Tag-segment, pinned, and default borders render identically in both modes
  from shared styles.
- Details content is provided by the parent via snippet; Node compiles without
  importing asset or focus modules.
- Stories cover circle, mid-progress, and details states, including a
  tag-bordered and a pinned node.

### T03 - Rework focus entry to an in-place node morph

|                |                                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T01, T02                                                                                                          |
| **Wave**       | 2                                                                                                                 |
| **Agent**      | High-reasoning                                                                                                    |
| **Effort**     | L                                                                                                                 |
| **Files**      | `Stage.svelte`, `Multigraph.svelte`, `focusRuntime.svelte.ts`, `nodeFocus.ts`, `NodeFocusSurface.svelte`, stories |
| **PR title**   | `feat(focus): morph the real node into focus`                                                                     |

Wire the gate into graph entry: overzoom continues to the dynamic inscribe cap
with the steering clamp active; at inscribed, blocked zoom feeds the
accumulator and `focusRuntime.entryProgress` (currently dead) drives the real
in-stage node's `detailsProgress`; commit animates the node to the dialog
bounds and hands off to the focus world using the shared geometry math. Remove
the computed-style morph-source capture and the `surface-morph` keyframes. The
menu Focus command triggers the same commit animation from current geometry.

**Acceptance**

- Zooming in un-rounds the node once inscribed; backing off re-rounds it via
  accumulator decay; a bold zoom commits.
- The commit is visually continuous: the node's rect and border have no jump
  at the stage-to-focus handoff (story asserts geometry continuity).
- One side touching first steers rather than sliding off screen; the opposite
  side comes into contact under continued zoom.
- Persisted `ViewState.scale` stays clamped at `maxScale` throughout overzoom
  and after exit.
- Menu Focus lands in the same details state via the same animation.
- Reduced motion skips the morph but reaches identical end states.
- No `getComputedStyle`-based morph capture remains.

### T04 - Zoom the focus world and gate the exit

|                |                                                                                         |
| -------------- | --------------------------------------------------------------------------------------- |
| **Depends on** | T03                                                                                     |
| **Wave**       | 3                                                                                       |
| **Agent**      | High-reasoning                                                                          |
| **Effort**     | L                                                                                       |
| **Files**      | `NodeFocusSurface.svelte`, `focusRuntime.svelte.ts`, `zoomBoundary.ts` if gaps, stories |
| **PR title**   | `feat(focus): zoom the whole focus surface`                                             |

Rebuild `NodeFocusSurface` as a thin zoom-world shell hosting the details-mode
`Node`: the world transform applies to the entire dialog (frame and border
included) so zooming in moves the border off screen. Wheel and pinch both feed
the world. Zoom-out applies the cover clamp (recentering the dialog so it fills
the screen as long as possible), reaches centered fit, then feeds the exit
accumulator while the details surface re-rounds toward a circle; commit exits
to the graph via the reverse handoff. Close button and dismiss affordances stay
outside the transformed layer.

**Acceptance**

- Zooming in scales the whole dialog; the border visibly leaves the viewport.
- Zoom-out recenters before shrinking below cover, reaches centered fit, and
  only then accumulates toward exit; a brief bump at fit does not exit; a bold
  zoom-out does, with the radius re-rounding as progress feedback.
- Pinch and wheel behave equivalently (pure-spec parity plus story coverage
  for wheel).
- Escape and the close control exit from any zoom state; the close control
  never scales off screen.
- The dialog has no independent border styling: the frame is the details-mode
  `Node`.

### T05 - Gate image-focused zoom inside the focus world

|                |                                                                         |
| -------------- | ----------------------------------------------------------------------- |
| **Depends on** | T04                                                                     |
| **Wave**       | 4                                                                       |
| **Agent**      | Default workhorse                                                       |
| **Effort**     | M                                                                       |
| **Files**      | `NodeFocusSurface.svelte`, `imageZoom.ts`, `imageZoom.spec.ts`, stories |
| **PR title**   | `feat(focus): gate image inspection behind bold zoom`                   |

Apply the same gate at the image boundary: focus-world zoom is free until the
image under the focal point is inscribed; a bold zoom then enters image-focused
zoom with natural-size clamps (fix `boundsForImage` to use
`naturalWidth`/`naturalHeight` instead of the rendered rect) and pan bounds
that keep the image in view. Zoom-out cover-clamps the image back to centered
fit before the exit accumulator engages; a bold zoom-out returns to the focus
world at dialog scale.

**Acceptance**

- A brief zoom bump at an inscribed image does not enter image mode; a bold
  zoom does; the image under the focal point is the target.
- Image clamps derive from natural dimensions; deep zoom reaches natural
  detail and no further than the configured multiple.
- Pan keeps the image at least partially in view; zoom-out recenters to fit
  before exit accumulation; bold zoom-out returns to the focus world.
- Escape/close still exit focus entirely from image mode.
- Specs cover gate engagement, natural-size clamps, cover-clamp recentering,
  and the fit-then-accumulate handoff.

### T06 - Coverage, cleanup, and closeout

|                |                                                                               |
| -------------- | ----------------------------------------------------------------------------- |
| **Depends on** | T05                                                                           |
| **Wave**       | 5                                                                             |
| **Agent**      | Default workhorse                                                             |
| **Effort**     | S                                                                             |
| **Files**      | stories, `e2e/*.test.ts`, docs (this plan, milestone 06a, roadmap), dead code |
| **PR title**   | `test(focus): cover continuous deep zoom chain`                               |

Round out coverage of the full chain (graph zoom-through with radius feedback,
focus-world zoom, gated image zoom, gated exits) with stories and one
wheel-driven e2e smoke. Perform a manual pinch smoke on a real device and note
the result here. Remove leftovers: stale `ImageZoomSurface` doc references, any
now-unused morph/style-capture code, unused exports. Update plan, milestone
06a, and roadmap statuses.

**Acceptance**

- Stories cover boundary bumps vs bold gestures at all three boundaries and
  the reduced-motion path.
- One e2e smoke drives wheel zoom from graph into focus, into an image, and
  back out.
- A dated note records the manual device pinch smoke result.
- No dead code or docs references to removed surfaces remain.
- Lint, check, unit/story tests, and the e2e smoke pass; plan status `done`,
  milestone 06a `complete`, roadmap row updated.

## Wave plan

```text
Wave 1   T01  |  T02      (gate geometry and node details mode)
Wave 2   T03              (in-place entry morph)
Wave 3   T04              (focus-world zoom and gated exit)
Wave 4   T05              (gated image zoom)
Wave 5   T06              (coverage, cleanup, closeout)
```

T01 and T02 touch disjoint files. Everything after is intentionally serial:
T03-T05 all reshape `NodeFocusSurface.svelte` and the focus runtime, and each
wave's gesture contract feeds the next. Losing parallelism here is fine; the
tasks are contract-heavy and cheap to review one at a time.

## Risks and rollback

- **Steering clamp fights focal anchoring.** The clamp is pure and pinned by
  specs; if composed behavior feels wrong, fall back to focal-anchored zoom
  with clamping only at the exact boundary, without changing gate semantics.
- **Handoff jump between stage and focus world.** Both sides compute geometry
  from the same pure helpers and render the same component; the story asserts
  rect/border continuity. If a jump persists, freeze one frame at commit to
  re-measure before switching worlds.
- **Node.svelte grows too smart.** Details content arrives via snippet and
  asset logic stays outside; if the details layout balloons, extract a child
  component that Node composes rather than letting focus logic leak in.
- **Gate feel needs tuning.** Commit threshold, decay, and near-touch margin
  are `appConfig.ts` tunables with pinned specs; retuning is a constants
  change, and the automatic gate can be disabled while keeping the menu Focus
  path.
- **Pinch behavior unverifiable in CI.** Pure specs carry parity; the closeout
  task requires a recorded manual device smoke, mirroring the milestone 03
  precedent.
- **Rewriting NodeFocusSurface destabilizes shipped behavior.** Each wave keeps
  Escape/close exits working (asserted in every task's stories), so a partial
  rollout still has a usable escape hatch.

## Definition of Done (this plan)

- All 6 tasks are merged; milestone 06a acceptance criteria are satisfied.
- `pnpm --filter mind-map-sv lint` passes.
- `pnpm --filter mind-map-sv check` passes.
- `pnpm --filter mind-map-sv test:unit -- --run` passes.
- The wheel-driven e2e smoke for the deep-zoom chain passes.
- The manual pinch smoke is performed and noted.
- Plan status is `done`, milestone 06a is `complete`, and the roadmap row is
  updated.
- The finished work is committed unless the user explicitly asks not to.

## Notes

- 2026-07-04: Plan created from the post-implementation UX review of milestone
  06 and the deep-zoom continuity polish pass. Root causes driving the design:
  the entry gate was an arbitrary fixed overzoom cap rather than a geometric
  condition; the focus dialog was a computed-style replica of the node (border
  width captured unscaled -> visible mismatch); image zoom transformed an inner
  content layer while the frame stayed fixed; and the focus surface handled
  wheel only, leaving pinch users without image zoom or gesture exits.
