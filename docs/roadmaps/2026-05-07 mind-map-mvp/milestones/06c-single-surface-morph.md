# Milestone 06c: Single-surface morph (one frame element for deep zoom)

**Status:** not started
**Depends on:** milestone 06b (recursive deep zoom).
**Plan:** [2026-07-10 06c-single-surface-morph.md](../plans/2026-07-10%2006c-single-surface-morph.md)

## Why

Milestone 06b set out to make deep zoom "genuinely the element that becomes
the fullscreen surface," but the shipped node round trip still splits the
frame between **two `Node` instances that take turns**: the in-stage node
morphs during the pre-commit preview (radius from
`borderRadiusForProgress(NODE_RADIUS * 2, …)`, size in graph units under the
stage transform), then at commit a second `Node` inside `NodeFocusSurface`
mounts at `morphProgress: 1` (geometry from `interpolateMorph` over a
**measured** `getBoundingClientRect`) while the in-stage node flips to
`visibility: hidden`; exit morphs the overlay back down and swaps visibility
again. That leaves two handoff seams per round trip, two geometry authorities
that only agree if measurement-based compensation (captured source rect,
re-measured exit rect, border-width × visual-scale correction) is kept in
sync, and asymmetric entry/exit pipelines. `DeepZoomStack` — 06b's recursive
primitive — never made it into production; `Multigraph` still mounts the
single-level `NodeFocusSurface`.

The fix is to finish the single-element intent for real: **one surface
element owns the frame for the entire interaction**, and the node/details
content crossfades _inside_ it.

## Goal

From the moment a node enters the pre-inscribe zone until the exit scrub
returns to the graph, exactly one overlay element (the **morph surface**)
renders the node's frame — rect, border, border radius, background — driven
by one pure geometry function of (node layout, live view state, progress).
Content crossfades within that element between a compact layer and a details
layer, both laid out at fixed logical sizes and transform-scaled to the
current frame (the container-transform/FLIP pattern), so each is crisp at the
endpoint where it is fully visible. The only handoffs with the in-stage node
happen at progress ≈ 0, where the surface is pixel-identical by construction.

## Scope

### One frame owner

- A `MorphSurface` overlay element mounts when a node's boundary progress
  first becomes nonzero (or on explicit Focus) and unmounts only when
  progress has returned to 0 and the gesture has idled. It owns the frame
  chrome continuously through entry scrub, commit, focused state, exit scrub,
  and pop — entry and exit are the same code path with progress rising or
  falling.
- The in-stage node hides the instant the surface mounts and reappears when
  it unmounts. The in-stage node is demoted to a dumb graph circle: the
  preview-morph props (`detailsProgress`, `detailsWidthPx`/`detailsHeightPx`)
  and preview CSS leave `Node.svelte`.
- The surface is `pointer-events: none` before commit so the stage keeps
  receiving the wheel/pinch input that drives the scrub.

### One pure geometry authority

- A pure `frameGeometry(nodeLayout, viewState, fillRect, progress)` returns
  `{ x, y, width, height, borderRadiusPx, borderWidthPx }`, composing the
  node's live on-screen rect (recomputed from pan/scale each frame — no DOM
  measurement) with the morph toward the fill rect, and interpolating border
  width from `NODE_BORDER_WIDTH × source visual scale` to the details border
  width.
- Every `getBoundingClientRect`-based capture in the focus path is removed:
  the commit-time source-rect measurement, the exit-rect snapshot
  (`ensureFocusExitTarget`), and the measured border-width compensation.
  Exit morphs back to wherever the node currently is because the source rect
  is derived, not captured.

### Content: fixed layout, transform-scaled, crossfaded

- Two absolutely positioned content layers inside the surface, crossfaded by
  progress: a **compact layer** laid out at the node's logical diameter
  (identical markup to the in-stage node) and transform-scaled to the current
  frame; a **details layer** laid out at the final fill size and
  transform-scaled down to fit the current frame. No content re-layout during
  the morph — transform and opacity only.
- The frame chrome and both content layers are **shared components** rendered
  by both `Node.svelte` and the surface, so the progress-0 handoff is
  identical layout by construction (same line breaks, same text shrink), not
  a styled replica.
- The details layer mounts lazily on first use so gentle scrubs do not pay
  for image loading; at progress 1 it sits at natural scale with working
  scroll inside the level's `ZoomWorld`, as today.

### Recursion and gates unchanged in behavior

- `DeepZoomStack` finally drives production focus in `Multigraph`, with the
  morph surface as each level's layer; `NodeFocusSurface` as a bespoke
  single-level wrapper is removed.
- The 06b gate model is preserved as-is: scale-derived entry/exit boundary
  progress, inscribe/steer, centered-fit exit, one-boundary-per-gesture
  swallowing, wheel/pinch parity, explicit Focus parity, reduced motion
  reaching identical end states without the morph.

## Acceptance criteria

- Pure specs cover `frameGeometry`: at progress 0 it equals the node's
  derived on-screen rect/radius/border width under the current view state
  (and tracks a changing view state); at 1 it equals the fill rect and
  details radius/border; mid values interpolate every channel.
- A story asserts geometry continuity at the progress-0 handoff in **both**
  directions (surface mount and unmount produce no rect/radius/border jump
  against the in-stage node), and that one and the same surface element (by
  identity/data attribute) spans entry scrub, committed state, and exit
  scrub.
- No `getBoundingClientRect`, captured exit rect, or measured border-width
  compensation remains anywhere in the focus path; `rg getBoundingClientRect`
  over the focus modules comes back clean.
- The in-stage `Node` no longer accepts or renders preview-morph props; only
  the surface renders intermediate progress. The compact and details content
  render through components shared with `Node.svelte`, not duplicated markup.
- During the morph the surface animates only transform/opacity on the content
  layers (layout happens once per endpoint); text is crisp at both endpoints.
- `Multigraph` mounts `DeepZoomStack` (not `NodeFocusSurface`); the depth-2
  placeholder recursion story still passes with the surface as the level
  layer.
- Existing 06b behaviors regress-tested: partial scrub reverses without
  committing, bold flick commits and stops (one boundary per gesture, both
  directions), exit requires centered fit, explicit Focus lands in the same
  state, reduced motion skips the morph, persisted `ViewState.scale` stays
  clamped.
- Lint, check, unit/browser/story tests, and the wheel-driven e2e smoke pass.

## Non-goals

- Image (and other block) inspection as its own nested zoom level — still the
  follow-up consumer milestone; images stay inside node details.
- Retrofitting `Stage.svelte` graph zoom onto the shared world abstraction.
- Browser Back/history integration; persisting focus-mode camera state.
- Visual redesign of the node or details surface beyond what the shared
  chrome extraction requires.
- Any change to the gate feel/tunables (zone fractions, margins, swallow
  timing) beyond relocation.

## Risks and open questions

- **Handoff shimmer.** Even with identical geometry, the browser may
  rasterize the stage-transformed node and the surface-transformed compact
  layer slightly differently at subpixel scale — how much tolerance is
  acceptable, and is a one-frame overlap needed?
- **Mount/unmount thrash.** Gentle scrubs that hover around progress 0 could
  mount and unmount the surface repeatedly — what hysteresis (if any) keeps
  this cheap without leaving a stale surface?
- **Chrome extraction scope.** Border, pinned halo, and tag-border conic
  gradient live in `Node.svelte` CSS today — how much moves into the shared
  chrome component vs stays node-only?
- **Who owns the crossfade.** `Node.svelte` currently crossfades
  compact/details internally via `detailsProgress` — does any of that remain,
  or does the surface own all intermediate-progress rendering?
- **ZoomWorld interplay during exit.** The details layer is transform-scaled
  by the frame while `ZoomWorld` applies its own transform at fit — confirm
  the two compose without double-scaling.
