# Milestone 06b: Recursive deep zoom (single-element morph)

**Status:** complete
**Depends on:** milestone 06a (continuous deep zoom).
**Plan:** [2026-07-10 06b-recursive-deep-zoom.md](../plans/2026-07-10%2006b-recursive-deep-zoom.md)

## Why

Milestone 06a set out to make deep zoom "the real node morphing in place into
the focus dialog." The shipped result on `feature/deep-zoom` does not actually
do that: it renders a **second** `Node` instance in a viewport-centered overlay
and ties it to the graph with CSS keyframe crossfades while fading the whole
stage to `opacity: 0`; the node's real on-screen rect is measured
(`captureFocusMorphSource`) but thrown away. Selling the illusion that the node
"becomes" the dialog through crossfade timing has proven fiddly and brittle,
and it does not generalize to nesting.

This milestone reworks deep zoom so it **genuinely is the element that becomes
the fullscreen surface**, driven by a single 0→1 morph progress, and makes the
whole interaction **recursively nestable to arbitrary depth** through one
uniform set of primitives (world zoom + boundary gate + morph). It supersedes
06a's transition mechanism; the gate model, dynamic inscribe cap, radius
feedback, and "zoom the whole world" intent from 06a are kept and generalized.

## Goal

One continuous camera that descends through an unbounded stack of zoom levels
(graph → node → …), where each level's real element morphs into the next
fullscreen surface via a single geometry function, gated by a bold gesture and
made discoverable by border-radius feedback. Node deep zoom is the first
consumer; images and other content blocks become additional zoomable consumers
of the same primitives in follow-up milestones.

## Scope

### One recursive interaction model

- A **focus stack** of zoom levels; the top level is live, ancestors are pinned
  fully expanded beneath it. Descending pushes a level; exiting pops one. Depth
  is unbounded — the same primitives run at every level.
- **Zoom always zooms everything.** Within a level, zoom scales the entire
  current world (frame, border, siblings), so an element's frame naturally
  leaves the viewport as a child subject grows toward inscribe. There is no
  "inner content only" zoom.
- **One geometry source of truth.** A pure morph function maps a level's
  progress 0→1 to `{ x, y, width, height, borderRadiusPx }`, interpolating from
  the subject's real on-screen rect to the fill rect. Handoff between levels
  happens **at inscribe**, when the subject already ≈ fills the viewport, so the
  seam is near-identity and continuous by construction — no crossfade, no
  styled replica.

### One gate rule at every boundary

- Free zoom continues until the focal subject enters its **pre-inscribe zone**,
  steering pan so a touching side never slides off; a subject is **inscribed**
  when it touches, within a near-touch margin, both top+bottom OR both left+right.
- Through the pre-inscribe zone, a **scale-derived progress ramps 0→1** and is
  **visualized as border radius** (circle→squarish on entry) so the commit
  affordance is discoverable; **commit fires at inscribe** (`progress = 1`). It
  is fully reversible — zoom back out and the radius un-rounds. There is no
  frozen scale phase: because commit coincides with inscribe, scale never exceeds
  inscribe before commit, so the border stays visible for the indicator.
- "Bold" is emergent, not a separate accumulator: a large-delta gesture
  traverses the whole zone in one move and commits, while a gentle gesture scrubs
  and can rest partway.
- **Exit mirrors entry**: zoom-out is redirected under a cover clamp that
  recenters the subject until it is **centered and fit** (not merely inscribed),
  and only then does progress fall `1→0` through a sub-fit zone (re-rounding the
  radius) to pop one level.
- **One boundary per gesture.** On commit (entry) or pop (exit), the remainder of
  the ongoing same-direction gesture and its momentum are swallowed until the
  gesture idles, so a bold flick stops exactly at the boundary rather than
  blowing through and zooming (or chain-committing) the next level; opposite
  input reverses immediately. Applies in both directions at every level.
- Wheel and pinch feed the same gate at every level.

### Single-element node morph (graph → node)

- Overzoom continues to the dynamic inscribe cap; through the pre-inscribe zone
  the real in-stage node rounds its border radius as progress readout, and commit
  fires at inscribe.
- On commit, the node morphs from its real inscribed on-screen rect to the
  fullscreen details surface as **one continuous element** (position, size, and
  corner radius interpolated by progress). The in-stage node is hidden while it
  owns the focus layer; the details surface is the same `Node` component in
  details mode, so border styling matches by construction.
- The explicit **Focus** action in the long-press menu plays the same commit
  from the node's current on-screen geometry, with no zoom prerequisite.

### Reduced motion

- Reduced-motion users skip the morph animation but reach identical
  committed/exited states; the gate and bold-zoom commit still work.

## Acceptance criteria

- Pure specs cover: morph geometry (rect + corner-radius interpolation at 0, mid,
  1); the scale-derived entry/exit boundary progress (0 at zone start, 1 at
  inscribe, reversible; symmetric sub-fit exit); inscribe/steer; cover-clamp
  recentering to **centered fit**; the distinction between "inscribed" and
  "centered fit"; and the focus-stack push/pop with correct source/fill geometry
  across at least three levels.
- The transition is a single element: no second/replica node, no crossfade
  keyframes, no viewport-centered dialog, and no dead on-screen-rect capture
  remain. Border/frame is continuous across the graph→node handoff (story
  asserts geometry continuity).
- Zoom scales the entire current world at every level (the frame/border visibly
  leaves the viewport on zoom-in); zoom-out recenters to centered fit before the
  exit accumulator engages.
- Commit is aligned to inscribe with no freeze phase: a gentle partial zoom
  scrubs the radius and can back off without committing, reaching inscribe
  commits, and a large single flick commits in one move; exit mirrors this
  through the sub-fit zone.
- A single gesture crosses at most one boundary in either direction: after a
  commit or pop, residual same-direction input/momentum is swallowed until idle,
  so one bold flick does not chain through levels or immediately zoom the level
  it just entered.
- The recursive stack is provably depth-agnostic: a story nests at least two
  levels (node + a placeholder zoomable child) and enters/exits each with the
  same gestures.
- Explicit Focus lands in the same details state via the same commit.
- Wheel parity is covered by stories/e2e; pinch parity is carried by pure
  controller specs plus a noted manual device smoke.
- Lint, check, unit/browser/story tests, and a wheel-driven e2e smoke pass.

## Non-goals

- Image (and other block) inspection as a nested zoom level — deferred to the
  immediate follow-up milestone; in this milestone images render inside the node
  details surface and are reachable only by free zoom within the node world.
- Retrofitting `Stage.svelte` graph zoom onto the shared world abstraction; the
  graph→node boundary reuses the shared gate + morph primitives, but Stage keeps
  owning drag/long-press/hit-testing.
- Browser Back/history integration; persisting focus-mode camera state.
- Multi-image gallery, cropping, annotations; graph schema or asset-storage
  changes.

## Risks and open questions

Resolved in the plan; kept here for context.

- **Element identity.** How literal "the same element" must be (DOM reparent vs
  a single overlay instance positioned by exact geometry).
- **Nesting fill + parent behavior.** What a child expands to fill and what
  happens to the parent as you descend.
- **Gate vs "zoom everything".** How the commit gate reconciles with the
  whole-world zoom invariant (resolved: a scale-derived boundary progress that
  reads out the approach to inscribe without diverting or freezing the zoom).
- **Recursion proof under node-first scope.** How to demonstrate arbitrary depth
  before real image zoom exists.
- **Rebuild vs incremental.** How much of the `feature/deep-zoom` transition
  layer to replace.
