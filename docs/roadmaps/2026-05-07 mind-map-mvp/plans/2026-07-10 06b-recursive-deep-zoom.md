# Plan: Recursive deep zoom (single-element morph)

**Created:** 2026-07-10
**Author:** Cursor agent
**Milestone:** [milestones/06b-recursive-deep-zoom.md](../milestones/06b-recursive-deep-zoom.md)
**Status:** done
**Total estimated effort:** XL (6 tasks across 5 waves; pure morph geometry,
gate/exit extensions, recursive focus-stack runtime + world controller,
recursive stack component, node consumer round trip, closeout)

## Summary

Replace the 06a crossfade-to-a-centered-replica transition with a genuine
single-element morph driven by one 0→1 progress, built on a depth-agnostic
focus stack so deep zoom nests to any number of levels; wire the node level as
the first consumer while keeping images and other blocks as future consumers of
the same primitives.

## Open questions resolved

- **Element identity — how literal is "the real node becomes the dialog"?**
  **Conceptual continuity via a single overlay instance.** One `Node` instance
  renders in the focus layer, positioned by exact morph geometry to coincide
  with the in-stage node at progress 0, with the in-stage node hidden while
  focused. Literal DOM reparenting of the live node is rejected: moving a mounted
  Svelte instance breaks bindings/reactivity and reintroduces the brittleness we
  are removing. Identical component + identical styling + exact geometry makes it
  visually the same element.
- **Gesture model at a boundary.** **Drop freeze-at-inscribe; commit is aligned
  to inscribe via a scale-derived boundary progress over a pre-inscribe zone.**
  As the focal subject grows through the last stretch before inscribe, a `0→1`
  progress ramps (driven purely by scale relative to the inscribe scale), the
  border radius rounds as a direct readout of that progress, and commit fires at
  inscribe (`progress = 1`); it is fully reversible (zoom back out and it
  un-rounds). This keeps the border fully visible the entire approach — because
  scale never exceeds inscribe before commit, the reason freeze existed is
  satisfied structurally, so freeze is redundant. "Bold" is no longer a separate
  momentum accumulator: a large-delta gesture naturally traverses the whole zone
  in one move and commits, while a gentle gesture scrubs and can rest partway.
  The separate time-based overshoot accumulator and its tunables
  (`overshootCommitThreshold`, decay half-life, hysteresis window) are dropped.
- **Accidental commit near the inscribe line.** **Accepted, mitigated by zone
  sizing; no dwell hysteresis for now.** Pure positional weakens "brief bump
  rejected" only near the top of the zone (a subject already ~inscribed commits
  on a small nudge), which reads as intent, not accident; the case that matters
  — casual graph zoom far from any node — is fully protected because you never
  reach the zone. A commit dwell can be added later if device testing shows
  accidental entries.
- **Boundary gesture swallowing.** **A single gesture crosses at most one
  boundary in either direction: on commit (entry) or pop (exit), the remainder of
  the ongoing same-direction gesture and its momentum are swallowed until the
  gesture idles.** This keeps `zoomBoundary` progress capped at the boundary so a
  bold flick zooms in exactly to the commit and stops, rather than blowing
  through and immediately zooming (or chain-committing) the newly entered level;
  exit is symmetric. Opposite-direction input is not swallowed, so the user can
  immediately reverse. Reuse the existing pure `entryGestureGate` (idle/max-time
  swallow) and its `entryGestureIdleMs`/`entryGestureMaxMs` tunables; this is the
  same mechanism as the `feature/deep-zoom` gesture-swallow fixes, generalized to
  every boundary and both directions.
- **"Zoom everything" vs the gate.** **They govern different phases and do not
  conflict.** Free zoom (before the focal subject enters its pre-inscribe zone)
  scales the entire current world, so frames/borders leave the viewport as a
  child grows toward inscribe; the boundary progress only reads out scale within
  the zone and never diverts or stalls the zoom. The current build zooms an inner
  layer only in places — the rework makes whole-world zoom a hard invariant at
  every level.
- **Nesting fill target + parent behavior.** **A descended child expands to fill
  the full viewport, and there is no persistent backdrop: as you zoom toward the
  child, the parent world scales too and winds up off screen.** Handoff to the
  child happens at inscribe (child ≈ fills viewport already), so continuity is
  structural. The parent level stays in the stack (frozen beneath) purely so the
  reverse exit is exact.
- **Handoff continuity.** **One pure morph function + handoff at inscribe.**
  Both the commit animation and the new level's initial world camera derive from
  the same on-screen rect math; because handoff occurs when the subject already
  fills the viewport, the seam is near-identity. No crossfade, no styled replica.
- **Exit semantics.** **Zoom-out is redirected to centering under a cover clamp
  until the subject is centered _and_ fit (not merely inscribed), then a
  scale-derived progress falls `1→0` through a sub-fit zone (re-rounding the
  radius) and pops at the bottom.** Symmetric with entry: no separate exit
  accumulator; the cover clamp guarantees recentering finishes before the
  progress can retreat, so a pop cannot happen off-center.
- **Zoomable content scope.** **Design a generic, content-agnostic zoomable
  abstraction, but implement the node level first.** Images and other blocks are
  additional consumers of the same primitives in a follow-up; the node level and
  the recursive stack are enough to prove the model.
- **Recursion proof under node-first scope.** **Prove depth with pure
  focus-stack specs plus a story that nests a placeholder zoomable child one
  level below the node.** Real image zoom is deferred, so a lightweight
  placeholder consumer demonstrates that levels ≥ 2 enter/exit with the same
  gestures.
- **Stage integration.** **Keep `Stage.svelte` separate; the graph→node boundary
  reuses the shared gate + morph primitives.** Stage's zoom is entangled with
  drag, long-press, and hit-testing; retrofitting it onto the world abstraction
  is a deferred follow-up once a second real consumer earns the interface.
- **Rebuild vs incremental.** **Decisive rebuild of the overlay/transition
  layer, keeping the still-valid pure geometry helpers.** The crossfade
  keyframes, viewport-centered dialog CSS, stage-opacity fade, and dead
  `morphSource` capture are removed, as is the now-unused time-based overshoot
  accumulator; `zoomBoundary` and the inscribe/focal math are reused and
  extended.
- **Reduced motion.** **Skip the morph animation but reach identical
  committed/exited end states; the gate and commit still function.**

## Out of scope (for this plan)

- Image inspection (and any other block) as a nested zoom level — a follow-up
  milestone adds it as a second consumer. Interim: images render inside the node
  details surface and are reachable only by free zoom within the node world; the
  current dedicated image-zoom path is removed rather than ported.
- Retrofitting `Stage.svelte` graph zoom onto the world abstraction.
- Browser Back/history; persisting focus/camera state.
- Graph schema, asset storage, or HTML embedding changes.
- Visual redesign of the details surface beyond what the morph and details mode
  require.

## Tasks

### T01 — Pure single-element morph geometry

|                |                                                                                 |
| -------------- | ------------------------------------------------------------------------------- |
| **Depends on** | —                                                                               |
| **Wave**       | 1                                                                               |
| **Agent**      | default (claude-4.6-sonnet-medium-thinking)                                     |
| **Effort**     | M                                                                               |
| **Files**      | new `Multigraph/lib/morphGeometry.ts` + spec, `appConfig.ts`, `zoomBoundary.ts` |
| **PR title**   | `feat(focus): add single-element morph geometry`                                |

Add a pure `interpolateMorph(source: Rect, fill: Rect, progress, opts)` that
returns `{ x, y, width, height, borderRadiusPx }`, interpolating position, size,
and corner radius (from a circle's `min(w,h)/2` to a configured details corner)
with an easing hook. Define/relocate a shared `Rect` type. Reuse
`borderRadiusForProgress` for the radius channel (or move it here and re-export).
Consolidate focus tunables into the `appConfig.ts` focus block: the details
corner radius plus the new `preInscribeZoneFraction` (entry) and
`subFitExitZoneFraction` (exit) that size the scale-derived boundary progress.
Do not remove the existing overshoot tunables here (still referenced until T06
cleanup); just add the new ones.

**Acceptance**

- Specs cover progress 0 (== source rect and source radius), 1 (== fill rect and
  target radius), and a mid value for every channel, plus aspect-ratio changes
  (square source → wide fill) and the easing hook.
- No Svelte/DOM imports; every tunable is a parameter with an `appConfig`
  default.
- Existing `borderRadiusForProgress` callers still compile and pass.

### T02 — Add scale-derived boundary progress and centered-fit exit

|                |                                                                          |
| -------------- | ------------------------------------------------------------------------ |
| **Depends on** | —                                                                        |
| **Wave**       | 1                                                                        |
| **Agent**      | default (claude-4.6-sonnet-medium-thinking)                              |
| **Files**      | `Multigraph/lib/zoomBoundary.ts` + spec                                  |
| **Effort**     | M                                                                        |
| **PR title**   | `feat(focus): add scale-derived boundary progress and centered-fit exit` |

Replace freeze-at-inscribe with a scale-derived boundary progress. Add a pure
`entryProgress(scale, inscribeScale, zoneFraction)` that ramps `0→1` across the
pre-inscribe zone and reaches `1` exactly at the inscribe scale (commit point),
and an `exitProgress` that falls `1→0` across a sub-fit zone below fit. Add a
**centered-fit** predicate distinct from **inscribed** so exit must recenter
under the cover clamp (recentering monotonically as scale falls to fit) before
`exitProgress` may retreat. Keep inscribe/steer helpers; take zone fractions as
parameters defaulting to `appConfig`. No freeze, no separate accumulator.

**Acceptance**

- Specs cover `entryProgress` at zone start (`0`), mid, and inscribe (`1`, ==
  commit), full reversibility, and that a large single-step scale jump can cross
  `0→1` in one call (bold = large delta); `exitProgress` symmetric across the
  sub-fit zone.
- Specs cover centered-fit detection (centered vs off-center at fit scale) and
  the ordering guarantee that cover-clamp recentering completes before
  `exitProgress` can advance.
- Inscribe/steer specs remain unchanged; no Svelte/DOM imports; all tunables are
  parameters with `appConfig` defaults.

### T03 — Recursive focus-stack runtime + whole-world zoom controller

|                |                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T01, T02                                                                                                                                                |
| **Wave**       | 2                                                                                                                                                       |
| **Agent**      | high-reasoning (claude-opus-4-8-thinking-high or gpt-5.3-codex)                                                                                         |
| **Effort**     | M                                                                                                                                                       |
| **Files**      | `Multigraph/lib/focusRuntime.svelte.ts` + spec, `Multigraph/lib/zoomWorldController.ts` + spec, `Multigraph/lib/entryGestureGate.ts` (+ spec if needed) |
| **PR title**   | `feat(focus): recursive focus stack and whole-world zoom`                                                                                               |

Rework `focusRuntime.svelte.ts` from a single focused-node holder into a
**stack** of zoom levels, each `{ subjectKind, subjectId, sourceRect, worldState,
morphProgress, phase }`, with `push`, `pop`, `setProgress`, `setWorldState`, and
derived "active level" / depth. Extend/confirm `zoomWorldController.ts` enforces
the **zoom-everything** invariant (transform scales the whole subject, min scale
= fit, cover clamp on zoom-out) and drives the level's `morphProgress` from the
T02 `entryProgress`/`exitProgress`, emitting descend on `entryProgress` reaching
`1` (inscribe) and ascend on `exitProgress` reaching `0` after centered fit. On
each descend/ascend, arm the pure `entryGestureGate` so the remainder of the
same-direction gesture and its momentum are swallowed until the gesture idles;
opposite-direction input passes through immediately.

**Acceptance**

- Specs push/pop across at least three levels and assert each level keeps the
  correct source/fill geometry and world state, and that pop restores the parent
  exactly.
- Controller specs assert whole-subject scaling, fit as the minimum, cover-clamp
  recentering on zoom-out, descend exactly at the inscribe scale, and ascend only
  after centered fit — with no freeze phase and no time-based accumulator.
- A single gesture crosses at most one boundary: after a descend/ascend, further
  same-direction input (including leftover momentum from a bold flick) is
  swallowed until idle and does not advance or chain-commit the next level, while
  opposite-direction input reverses immediately (pure gate specs).
- Wheel and pinch inputs produce equivalent controller state (pure parity),
  including a large single-step delta committing in one move and then being
  capped at the boundary.

### T04 — Recursive deep-zoom stack component

|                |                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------- |
| **Depends on** | T03                                                                                            |
| **Wave**       | 3                                                                                              |
| **Agent**      | high-reasoning (claude-opus-4-8-thinking-high or gpt-5.3-codex)                                |
| **Effort**     | L                                                                                              |
| **Files**      | new `Multigraph/DeepZoomStack.svelte`, new `Multigraph/DeepZoomLayer.svelte`, stories, harness |
| **PR title**   | `feat(focus): add recursive deep-zoom stack component`                                         |

Build the depth-agnostic UI shell: `DeepZoomStack.svelte` renders the focus
stack (active level live in a `ZoomWorld`, ancestors frozen beneath), and a thin
`DeepZoomLayer` positions its subject via `interpolateMorph` and exposes the
expanded content plus child-zoomable regions via snippets. Entering a child
region pushes a level (source = the region's on-screen rect); a gated exit pops.
No content-type knowledge lives here — subjects and children arrive as snippets.

**Acceptance**

- A story nests **two** levels using placeholder zoomable content and enters and
  exits each with the same wheel gesture; a gentle partial zoom scrubs the radius
  without committing, and continuing to inscribe commits.
- A single bold wheel gesture that overshoots the boundary advances exactly one
  level and stops (residual same-direction input swallowed); it takes a second
  gesture to descend to the next level.
- The active level scales the whole subject (its frame leaves the viewport on
  zoom-in); zoom-out recenters to centered fit before `exitProgress` retreats.
- Reduced-motion story reaches identical committed/exited states without the
  morph animation.
- The component imports no focus/asset/graph specifics; it is exercised entirely
  through snippets and the controller.

### T05 — Wire the node level: entry morph and gated exit round trip

|                |                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T04                                                                                                                                   |
| **Wave**       | 4                                                                                                                                     |
| **Agent**      | high-reasoning (claude-opus-4-8-thinking-high or gpt-5.3-codex)                                                                       |
| **Effort**     | L                                                                                                                                     |
| **Files**      | `Stage.svelte`, `Multigraph.svelte`, `NodeFocusSurface.svelte`, `Node/Node.svelte`, `focusRuntime.svelte.ts`, stories, `appConfig.ts` |
| **PR title**   | `feat(focus): morph the real node into the focus surface`                                                                             |

Make the node the first `DeepZoomStack` consumer as a complete round trip.
Graph entry: overzoom to the dynamic inscribe cap with steering; through the
pre-inscribe zone the scale-derived `entryProgress` drives the in-stage node's
radius feedback, and at inscribe (`progress = 1`) the level commits, pushing a
node focus level that morphs from the node's real inscribed on-screen rect to the
fullscreen details surface (single `Node` instance; in-stage node hidden). Exit:
cover-clamp recenter to centered fit, then `exitProgress` falls through the
sub-fit zone (re-rounding) and pops at the bottom with the reverse morph. Rebuild
`NodeFocusSurface` as the consumer that supplies the node subject and details
content. **Remove** the crossfade keyframes, viewport-centered dialog CSS,
stage-opacity fade, and dead `morphSource` capture. Reduced motion jumps to end
states.

**Acceptance**

- Zooming in rounds the node as it enters the pre-inscribe zone and commits at
  inscribe; backing off before inscribe un-rounds and does not commit; a large
  single flick commits in one move.
- The graph→node handoff has no rect/border jump (story asserts geometry
  continuity); the details surface is the same `Node` styling.
- Zoom inside focus scales the whole dialog (border leaves the viewport);
  zoom-out recenters to centered fit before `exitProgress` retreats; continuing
  the zoom-out returns to the graph via the reverse morph.
- A bold zoom-in commits to focus and stops there (leftover momentum swallowed,
  the focus world does not immediately start zooming); a bold zoom-out exits to
  the graph and stops (the graph does not keep zooming out) — one boundary per
  gesture, both directions.
- No replica node, crossfade keyframes, centered-dialog CSS, freeze phase,
  time-based accumulator, or on-screen-rect-capture-then-discard remain.
- Persisted `ViewState.scale` stays clamped at `maxScale` through overzoom and
  after exit.

### T06 — Explicit Focus parity, coverage, and closeout

|                |                                                                                         |
| -------------- | --------------------------------------------------------------------------------------- |
| **Depends on** | T05                                                                                     |
| **Wave**       | 5                                                                                       |
| **Agent**      | default (claude-4.6-sonnet-medium-thinking)                                             |
| **Files**      | `NodeActionMenu.svelte`, `Multigraph.svelte`, stories, `e2e/*.test.ts`, docs, dead code |
| **Effort**     | M                                                                                       |
| **PR title**   | `feat(focus): unify explicit Focus with the morph and cover the chain`                  |

Route the long-press **Focus** action through the same commit animation from the
node's current on-screen geometry (no zoom prerequisite); remove the old
no-morph menu-entry path. Add a wheel-driven e2e smoke (graph → node focus →
exit) and stories for the reduced-motion path and partial-scrub-vs-commit at the
node boundary. Remove leftovers: the now-unused time-based overshoot accumulator
(`overshootInput`/`decayOvershoot`) and only its `appConfig` tunables
(`overshootCommitThreshold`, `overshootDecayHalfLifeMs`, `overshootHysteresisMs`,
`exitOvershootDeltaScale`) — **keep** the `entryGestureGate` swallow tunables
(`entryGestureIdleMs`, `entryGestureMaxMs`), which the boundary swallow still
uses; dead code/doc references to the old image-zoom surface; and unused exports.
Note the deferred image-inspection interim. Perform and date a manual device
pinch smoke if available. Update this plan, milestone 06b, and the roadmap
statuses.

**Acceptance**

- Explicit Focus lands in the same details state via the same morph as the
  zoom-through path.
- One e2e smoke drives wheel zoom from graph into node focus and back out.
- Stories cover reduced motion and partial-scrub-vs-commit at the node boundary.
- No dead code or doc references to removed surfaces remain, and the overshoot
  accumulator + its tunables are gone; the image-inspection deferral is
  documented.
- Lint, check, unit/story tests, and the e2e smoke pass; plan status `done`,
  milestone 06b `complete`, roadmap row updated.

## Wave plan

```text
Wave 1   T01  |  T02      (morph geometry; boundary progress + centered-fit — disjoint files)
Wave 2   T03              (recursive stack runtime + whole-world controller)
Wave 3   T04              (recursive deep-zoom stack component)
Wave 4   T05              (node consumer: entry morph + gated exit round trip)
Wave 5   T06              (explicit Focus parity, coverage, closeout)
```

T01 and T02 touch disjoint pure files and run in parallel. Everything after is
serial: T03 depends on both foundations; T04 builds on the runtime/controller;
T05 reshapes the same focus files T04 established; T06 closes out. The rework is
contract-heavy and cheap to review one wave at a time.

## Risks and rollback

- **T05 is the riskiest task and may balloon.** It is intentionally the full
  node round trip so no broken enter-but-cannot-exit state ships. If it exceeds
  `L`, split along the commit boundary (entry+committed reading state, then
  gated exit) rather than shipping a one-way transition.
- **Handoff jump between stage and node level.** Both sides use the same pure
  helpers and handoff occurs at inscribe (subject ≈ fills viewport), so the seam
  is near-identity; the story asserts rect/border continuity. If a jump persists,
  freeze one frame at commit to re-measure before pushing the level.
- **Recursion unproven under node-first scope.** Mitigated by pure focus-stack
  specs across ≥ 3 levels (T03) and a two-level placeholder story (T04), so depth
  is validated before real image zoom exists.
- **Removing the current image-zoom path regresses image inspection.** Accepted
  and documented as interim; free zoom within the node world still lets users
  enlarge images. The follow-up milestone restores inspection as a proper
  zoomable child.
- **Gate feel needs tuning.** The pre-inscribe/sub-fit zone fractions,
  near-touch margin, and corner radius are `appConfig` tunables pinned by specs;
  retuning is a constants change, and the automatic gate can be disabled while
  keeping the menu Focus path. If pure positional lets in accidental commits on
  device, add a small commit dwell at the inscribe line (deferred by decision).
- **`Node.svelte` grows too smart.** Details content arrives via snippet and
  asset logic stays outside; if the details layout balloons, extract a child
  component rather than letting focus logic leak in.
- **Pinch unverifiable in CI.** Pure controller specs carry parity; the closeout
  task records a manual device smoke if available, mirroring milestone 03.

## Definition of Done (this plan)

- All 6 tasks are merged; milestone 06b acceptance criteria are satisfied.
- `pnpm --filter mind-map-sv lint` passes.
- `pnpm --filter mind-map-sv check` passes.
- `pnpm --filter mind-map-sv test:unit -- --run` passes.
- The wheel-driven e2e smoke for the graph→node→graph chain passes.
- Pinch parity is covered by pure controller specs; manual hardware pinch smoke
  is noted if available.
- Plan status is `done`, milestone 06b is `complete`, and the roadmap row is
  updated with a link back to this plan.
- The finished work is committed unless the user explicitly asks not to.

## Notes

- 2026-07-10: Plan created from a design discussion reworking milestone 06a.
  Root causes driving the rework: 06a's shipped transition is a crossfade
  between a fading stage and a viewport-centered replica `Node` (real on-screen
  rect captured but discarded), which is fiddly to time, never perfectly
  continuous, and does not generalize to nesting. Decisions locked in the
  discussion: conceptual (not literal-DOM) element continuity; border-radius
  feedback; whole-world zoom as a hard invariant; child fills full viewport with
  the parent scaling off (no persistent backdrop); exit recenters to centered fit
  before retreating; generic zoomable abstraction but node-first; keep Stage
  separate sharing primitives; decisive rebuild of the transition layer; reduced
  motion skips the morph.
- 2026-07-10: Revised the gate model before any code. Dropped freeze-at-inscribe
  and the separate time-based bold accumulator; commit is now aligned to inscribe
  via a scale-derived boundary progress over a pre-inscribe zone (exit mirrors it
  through a sub-fit zone). Freeze became redundant once commit coincides with
  inscribe (scale never exceeds inscribe pre-commit, so the border stays visible
  for the radius indicator); "bold" now emerges from large-delta gestures
  traversing the zone. Accidental commit near the inscribe line is accepted for
  now; a commit dwell can be added if device testing warrants.
- 2026-07-10: Kept boundary gesture swallowing (from the `feature/deep-zoom`
  `swallow … zoom gestures` fixes) and generalized it to every boundary in both
  directions: one gesture crosses at most one entry/exit boundary, with residual
  same-direction input/momentum swallowed until idle. This is what keeps the
  positional gate from letting a bold flick chain-commit through levels; the pure
  `entryGestureGate` and its `entryGestureIdleMs`/`entryGestureMaxMs` tunables are
  retained (only the overshoot accumulator tunables are removed).
- 2026-07-10: Work continues on the `feature/deep-zoom` branch (16 commits ahead
  of `main`, not yet merged); this plan supersedes the 06a transition mechanism
  there rather than starting from `main`.
- 2026-07-11: Executed the plan as one integrated branch change in this
  workspace. Delivered pure morph geometry, scale-derived entry/exit progress,
  recursive focus-stack/world-controller primitives, generic deep-zoom
  layer/stack components with placeholder recursion story coverage, node focus
  round trip via the same morph path, explicit Focus parity, removal of the
  time-based overshoot accumulator, and removal of the old image-specific zoom
  helper path. Images remain visible inside node details and can be enlarged by
  free world zoom; dedicated image inspection is deferred to the follow-up
  consumer milestone. Validation passed: `pnpm --filter mind-map-sv lint`,
  `pnpm --filter mind-map-sv check`,
  `pnpm --filter mind-map-sv test:unit -- --run`, and
  `pnpm --filter mind-map-sv test:e2e`. Pinch parity is covered by pure
  controller specs; no manual hardware pinch smoke was available in this
  environment.
