# Milestone 06a: Continuous deep zoom

**Status:** complete
**Depends on:** milestone 06 (node focus and rich media).
**Plan:** [2026-07-04 06a-continuous-deep-zoom.md](../plans/2026-07-04%2006a-continuous-deep-zoom.md)

## Goal

Make deep zoom feel like one continuous camera move through three nested zoom
levels — graph, focus dialog, image — governed by a single repeated gate rule.
The real graph node should morph in place (un-rounding its border radius as
zoom is "spent" at the boundary), the focus dialog should be the same node
component in a details mode so borders match by construction, the whole dialog
should zoom as a world (its border can leave the screen), and image inspection
should be a nested, bold-zoom-gated level of the same interaction.

## Scope

### One gate rule at every boundary

- Free zoom continues until the inner subject (node circle, focus dialog, or
  image) is **inscribed**: touching, within a near-touch margin, both top and
  bottom OR both left and right of the viewport.
- While approaching inscribed, zoom **steers**: if one side touches first, pan
  is clamped so that side never crosses off screen, so continued zoom brings
  the opposite side into contact.
- At inscribed, further zoom input stops scaling and feeds the bold-gesture
  overshoot accumulator; commit descends one level.
- Exit mirrors entry: zoom-out under a cover pan clamp (content must keep
  covering the viewport) recenters the dialog/image as it shrinks, reaches
  centered fit, and only then feeds the exit accumulator.

### In-place node morph (graph -> focus)

- Replace the fixed overzoom cap with a dynamic one: overzoom continues exactly
  until the focal node is inscribed, so every visible node can be entered.
- Visualize accumulator progress by animating the real in-stage node's border
  radius from circle toward squarish; backing off decays the radius back.
- On commit, the node animates to the dialog bounds in its details state (fully
  un-rounded except slight corner rounding) while the rest of the graph fades.
- The explicit Focus action plays the same commit animation from the node's
  current screen geometry, with no zoom prerequisite.

### Node details mode replaces the dialog replica

- `Node.svelte` gains a details mode (progress-driven border-radius and a
  details content layout) so the focus surface is the real node component.
- Border styling (default, pinned, tag-segment conic gradient) is shared by
  construction; no separately styled dialog frame or computed-style capture.

### Focus world and image world zoom

- Inside focus mode, zoom transforms the whole dialog (frame and border
  included), not an inner content layer; the border can go off screen.
- Zooming such that an image becomes inscribed engages the gate; a bold zoom
  enters image-focused zoom with natural-size clamps and pan bounds that keep
  the image in view.
- Zoom-out from image-focused zoom recenters the image to fit before the exit
  accumulator engages; a further bold zoom-out returns to the focus world, and
  the same pattern exits focus back to the graph.
- Wheel and pinch have parity at every level.

## Acceptance criteria

- Pure specs cover inscribed contact detection with margins, steering pan
  clamps, cover-clamp recentering on zoom-out, the dynamic overzoom cap, and
  the radius-progress mapping.
- Stories show: zoom-in un-rounds the node with progress and decays on
  back-off; a bold zoom commits to focus; brief bumps at every boundary do not
  transition; bold gestures do.
- The focus dialog is the same node component; there is no separately styled
  dialog border to drift (the previous mismatch class of bug is structurally
  impossible).
- In focus mode, zoom visibly moves the dialog border off screen; zoom-out
  recenters the dialog before exit accumulation begins.
- Image-focused zoom requires a bold zoom to enter and exit, clamps to natural
  image detail, and recenters on the way out.
- Pinch works for every zoom level and gate, not just wheel.
- The explicit Focus action lands in the same details state via the same
  commit animation.
- Reduced-motion users get instant or simplified state changes at every
  transition.
- Lint, check, unit/browser/story tests, and a relevant e2e smoke flow pass.

## Non-goals

- Browser Back/history integration for exiting focus or image zoom.
- Multi-image gallery controls, thumbnails, cropping, or annotations.
- Graph schema, asset storage, or HTML asset embedding changes.
- Persisting focus-mode or image-zoom camera state.
- Reworking focus content layout/visual design beyond what the details mode
  and zoom continuity require.

## Risks and open questions

Resolved in the plan; kept here for context.

- **Steering vs focal anchoring.** Zoom normally anchors the focal point;
  steering clamps pan near boundaries. The plan should define how these
  compose without fighting.
- **Scale behavior during accumulation.** Whether scale freezes entirely while
  input is spent on the accumulator, and how decay restores state.
- **Handoff continuity.** The commit moves the subject between render worlds
  (stage node -> focus world); the plan should guarantee no visual jump.
- **Details-mode content.** How Node renders details content (title,
  description, images) without absorbing asset logic.
- **Gesture simulation limits.** Pinch is hard to simulate in stories/e2e; the
  plan should say what is covered by pure specs vs manual smoke tests.
