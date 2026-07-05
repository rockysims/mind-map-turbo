# Plan: Deep zoom continuity polish

**Created:** 2026-07-04
**Author:** Codex agent
**Milestone:** [milestones/06-node-focus-and-rich-media.md](../milestones/06-node-focus-and-rich-media.md)
**Status:** done
**Total estimated effort:** L (4 tasks across 3 waves; conditional overzoom,
node-to-focus morph, in-surface image zoom, and focused validation)

## Summary

Polish milestone 06's deep zoom interaction so it feels like a continuous camera
move through the graph node, into the focus surface, and then into images inside
that same surface. The visible image-viewer mode goes away; image inspection
becomes a natural continuation of zooming within focus mode.

## Open questions resolved

- **Past-max graph zoom.** **Allow a transient overzoom corridor past graph
  `maxScale` only when the focal point is over an eligible node and continued
  zoom would commit focus.** Normal graph navigation remains bounded, but the
  focus gesture can keep visually zooming instead of feeling blocked at the
  exact moment it needs momentum.
- **Overzoom persistence.** **Keep overzoom as transient runtime state, not
  persisted `ViewState`.** If the user backs off before focus commits, the
  graph eases back to persisted-safe `maxScale`; saved documents still restore
  ordinary graph camera state.
- **Entry transition source.** **Fade non-selected graph/background content to
  0 while an overlay clone of the selected node morphs into the focus surface.**
  The clone starts from the node's actual projected screen circle after
  overzoom, including size, position, fill, border width, pinned/tag border
  styling where practical.
- **Focus-image zoom model.** **Replace the exposed click-to-open image viewer
  with in-surface focus zoom.** The UX should feel like zooming the focus
  dialog/content world itself; implementation may keep image-specific math, but
  users should not enter a separate image mode.
- **Zoom target inside focus.** **Use the image under the focal point as the
  active deep-detail target while the focus content layer zooms around the same
  focal point.** This preserves the feeling of zooming the whole dialog while
  ensuring the intended image receives natural-size clamps and pan bounds.
- **Zoom-out order.** **When an image is zoomed in, zoom-out first returns that
  image/content layer to fit, then a further bold zoom-out exits focus mode.**
  This gives users a reversible image-inspection gesture before the larger
  focus-exit gesture fires.
- **Reuse of current image zoom code.** **Keep `imageZoom.ts` if it helps the
  in-surface implementation, but remove `ImageZoomSurface` from the visible
  interaction.** Pure clamp/focal math is useful; a second modal surface is not.

## Out of scope (for this plan)

- Changing graph schema, asset storage, or HTML asset embedding.
- Adding captions/alt editing features beyond what milestone 06 already has.
- Browser Back/history integration.
- Multi-image gallery controls, thumbnails, cropping, annotations, or image
  editing.
- Arbitrary unbounded graph zoom outside an eligible node-focus gesture.
- Reworking the entire focus layout visual design beyond the transition and
  zoom continuity needed here.

## Tasks

### T01 - Add conditional focus overzoom geometry

|                |                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------ |
| **Depends on** | -                                                                                                |
| **Wave**       | 1                                                                                                |
| **Agent**      | Default workhorse                                                                                |
| **Effort**     | M                                                                                                |
| **Files**      | `Stage.svelte`, `Multigraph.svelte`, `Multigraph/lib/nodeFocus.ts`, `nodeFocus.spec.ts`, stories |
| **PR title**   | `feat(focus): allow conditional overzoom into nodes`                                             |

Extend the blocked-zoom model so eligible zoom-in input can produce a transient
visual scale above `maxScale` before focus commits. Keep ordinary pan/zoom
bounded when no eligible focal node exists. Add pure helpers for overzoom
progress, visual scale, cancel/ease-back semantics, and source node geometry at
the overzoomed scale.

**Acceptance**

- Wheel and pinch zoom past `maxScale` continue visually only when the focal
  point is inside an eligible node.
- Overzoom is not emitted through persisted `onViewStateChange`; saved
  `ViewState.scale` remains clamped to `maxScale`.
- Backing off before commit returns the graph to `maxScale` without entering
  focus.
- Specs cover eligible/ineligible focal points, overzoom scale clamping,
  cancellation, and persisted-vs-visual scale separation.
- Story coverage shows overzoom feedback before focus entry.

### T02 - Morph the overzoomed node clone into the focus surface

|                |                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------- |
| **Depends on** | T01                                                                                           |
| **Wave**       | 2                                                                                             |
| **Agent**      | High-reasoning                                                                                |
| **Effort**     | M                                                                                             |
| **Files**      | `Multigraph.svelte`, `NodeFocusSurface.svelte`, `focusRuntime.svelte.ts`, focus stories/tests |
| **PR title**   | `feat(focus): morph node clone into focus surface`                                            |

Replace the current fade/swap feeling with a transition overlay that captures
the selected node's projected screen circle after overzoom, fades the rest of
the graph/background to 0, and animates border radius plus width/height into the
focus dialog surface. Reduced-motion users should skip the morph but still get
correct state transitions.

**Acceptance**

- Entry transition starts from the selected node's current screen circle and
  ends at the focus surface bounds.
- The clone preserves the node's apparent fill, border width, and pinned/tag
  border styling where practical; if tag-gradient cloning is simplified, the
  simplification is documented in code and visually close.
- Non-selected graph content fades to 0 during entry and does not reappear
  mid-transition.
- Reduced-motion mode avoids the morph.
- Stories assert entry does not mutate graph data and that focus can still exit
  by Escape, close button, and bold zoom-out.

### T03 - Replace image viewer mode with in-surface focus image zoom

|                |                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------- |
| **Depends on** | T02                                                                                                |
| **Wave**       | 3                                                                                                  |
| **Agent**      | High-reasoning                                                                                     |
| **Effort**     | L                                                                                                  |
| **Files**      | `NodeFocusSurface.svelte`, `ImageZoomSurface.svelte`, `imageZoom.ts`, `imageZoom.spec.ts`, stories |
| **PR title**   | `feat(focus): zoom images within the focus surface`                                                |

Remove the exposed click-to-open image viewer interaction. Add a focus-content
zoom context: zoom gestures over an image scale the focus content around the
focal point while using the image under the pointer as the active natural-detail
target. Pan/zoom clamps should keep the active image inspectable and the focus
surface recoverable. The pure image zoom math may remain, but the user-facing
surface should be the existing focus dialog, not a second modal.

**Acceptance**

- Clicking/tapping an image no longer opens a separate visible image viewer.
- Wheel and pinch over an image zoom the focus content/image in place, anchored
  to the focal point.
- Only the image under the focal point becomes the active deep-detail target;
  nearby text/images may move/scale as part of the content-world illusion.
- Pan clamps keep at least part of the active image reachable.
- Zoom-out from an inspected image returns it/content to fit before focus-exit
  overshoot can commit.
- Escape and the close control still exit focus from any image zoom state.
- Specs cover focal image selection, fit/deep clamps, pan bounds, and zoom-out
  handoff from image-fit to focus-exit.

### T04 - Validate continuity and update plan status

|                |                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------ |
| **Depends on** | T03                                                                                        |
| **Wave**       | 3                                                                                          |
| **Agent**      | Default workhorse                                                                          |
| **Effort**     | S                                                                                          |
| **Files**      | `Multigraph.stories.svelte`, `Stage.stories.svelte`, relevant e2e tests, roadmap plan docs |
| **PR title**   | `test(focus): cover continuous deep zoom gestures`                                         |

Add or update behavior coverage for the complete interaction: graph overzoom
into focus, clone morph, image zoom within focus, image zoom-out-to-fit, and
bold focus exit. Update this plan's status after validation.

**Acceptance**

- Story coverage demonstrates graph zoom-through with overzoom, explicit Focus
  entry still working, focus entry morph, in-surface image zoom, image zoom-out
  to fit, and final focus exit.
- Relevant e2e smoke coverage passes for an image-bearing saved document where
  the image remains zoomable after reload/import.
- `pnpm --filter mind-map-sv lint`, `pnpm --filter mind-map-sv check`,
  `pnpm --filter mind-map-sv test:unit -- --run`, and relevant e2e tests pass.
- Plan status is updated to `done` after implementation validation passes.

## Wave plan

```text
Wave 1   T01
Wave 2   T02
Wave 3   T03  |  T04
```

T04 can begin by drafting story/e2e expectations once T03's event contract is
stable, but final validation waits for T03. T01 and T02 both touch focus entry
runtime and must stay sequential to avoid competing transition semantics.

## Risks and rollback

- **Overzoom can make graph navigation feel slippery.** Keep it conditional on
  node eligibility, bounded by explicit tunables, and non-persisted. Roll back
  by disabling the overzoom visual scale while retaining max-scale focus entry.
- **Clone styling can drift from the real node.** Prefer shared CSS custom
  properties or extracted style helpers; if exact tag-gradient cloning is
  brittle, use a visually close clone and keep the real node hidden underneath.
- **Content-world image zoom may fight dialog controls.** Keep close controls
  outside the zoomed content layer so users always have a stable escape hatch.
- **Multiple images can confuse pan clamps.** Track one active image based on
  focal point and retarget only when zoom returns to fit or the pointer starts a
  new gesture over another image.
- **Removing the visible image viewer may break existing story expectations.**
  Update stories to assert the new behavior rather than preserving the
  click-to-open modal contract.

## Definition of Done (this plan)

- The three requested UX changes are implemented:
  conditional overzoom past max zoom, node-clone-to-focus morph, and in-surface
  image zoom without a visible image-viewer mode.
- New or updated pure specs cover overzoom and focus/image zoom math.
- Story coverage verifies the complete gesture flow and reduced-motion path.
- Relevant e2e coverage passes for saved/reloaded image-bearing documents.
- `pnpm --filter mind-map-sv lint` passes.
- `pnpm --filter mind-map-sv check` passes.
- `pnpm --filter mind-map-sv test:unit -- --run` passes.
- The finished implementation is committed unless the user explicitly asks not
  to commit yet.

## Notes

- 2026-07-04: Created from follow-up UX discussion after milestone 06 landed.
  Decision: treat image inspection as continuous focus-surface zoom, not a
  separate visible mode, while preserving image-specific pure math if useful.
- 2026-07-04: Implemented conditional focus overzoom, node-to-focus morph,
  in-surface image zoom, and removal of the visible image viewer surface.
- 2026-07-04: Superseded by
  [2026-07-04 06a-continuous-deep-zoom.md](<2026-07-04 06a-continuous-deep-zoom.md>):
  the shipped result still gated entry on an arbitrary overzoom cap, the morph
  replica's border did not match the real node, image zoom scaled only the
  inner content layer, and the focus surface handled wheel only.
