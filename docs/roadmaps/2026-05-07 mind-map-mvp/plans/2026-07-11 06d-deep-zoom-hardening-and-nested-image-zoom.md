# Plan: Deep zoom hardening and nested image zoom

**Created:** 2026-07-11
**Author:** Cursor agent
**Milestone:** [milestones/06d-deep-zoom-hardening-and-nested-image-zoom.md](../milestones/06d-deep-zoom-hardening-and-nested-image-zoom.md)
**Status:** draft
**Total estimated effort:** L (≈ 2–3 days across the waves)

## Summary

Remove the deep-zoom scaffolding left after 06c, unify the split focus ownership
into one `FocusController` with a single input surface, then prove the recursive
stack for real by making images inside a focused node their own deep-zoom level.

## Open questions resolved

Carried from the milestone (and the review that motivated it):

- **Camera state on a level (was: `worldState` write-only).** **Drop the stored
  `FocusLevel.worldState` and `handleFocusWorldState`.** Entry commits only at
  centered-and-fit (identity world), and the exit gate guarantees a child is
  centered-and-fit before it pops, so a level's camera is fully determined by
  those invariants and can be recomputed rather than stored. T08 (nested images)
  includes an explicit pop-continuity check; if a real panned-image case proves
  recompute insufficient, reintroduce a _minimal_ preserved-camera field then —
  not the general store we have today.
- **Input authority (was: `focus-root` full-viewport wheel hack + two scrub
  drivers).** **Add one focus-scoped fullscreen input surface**, not a global bus
  spanning Stage. It exists while focused and dispatches wheel/pinch to the
  active level's controller (entry scrub, committed, exit scrub). Stage keeps
  owning graph-world drag/long-press/hit-test — reusing it buys nothing and risks
  regressing well-tested gestures.
- **Focus-eligibility path (was: dual systems).** **Remove the Stage overzoom
  fallback entirely** (`canOverzoomForFocus`, `focusOverzoomMaxScaleForPoint`,
  `overzoomMaxScaleForPoint`, `focusOverzoomMaxScaleForNode`). The boundary
  candidate resolver becomes the single eligibility path; T03 proves parity with
  a spec/story for a node the fallback used to catch.
- **Controller extraction scope.** **Extract a `FocusController` runes class**
  (mirroring `LayoutRuntime`) that owns the runtime, phase machine,
  commit/exit/idle, and input dispatch. Stage keeps computing raw
  steer/boundary geometry and reports it via one callback; the controller decides
  steer vs. commit. Do the small unifications (T03–T05) _first_ so the extraction
  moves clean code.
- **Image entry trigger.** **Bold-zoom the image toward inscribe inside the node
  world** (same gate as graph→node), no separate affordance. This requires the
  entry-boundary gate to run inside a `ZoomWorld` the way it runs in Stage — the
  `FocusController` + input surface (T06/T07) provide the single place to host
  it, which is why images (T08) come last.
- **Depth-2 proof.** **A production story + wheel-driven e2e** bold-zooms a real
  image inside a focused node to depth 2, pans, and exits — upgrading the current
  _placeholder_ recursion story.

## Out of scope (for this plan)

- Non-image zoomable blocks; image cropping/annotation/gallery UX.
- Folding Stage graph gestures into the focus input surface.
- History/Back integration; persisting focus camera across reloads.
- Retuning any gate feel constants beyond what unification forces.

## Tasks

> One PR each. Most tasks touch `Multigraph.svelte` and/or `Stage.svelte`, so
> waves are mostly sequential to avoid conflicting edits to those files; the
> pure-module and docs tasks are the parallelizable ones.

### T01 — Remove deep-zoom cruft

|                |                                                                                                                                                                                                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                                                                                                                                                                                                                              |
| **Wave**       | 1                                                                                                                                                                                                                                                                                              |
| **Agent**      | default (claude-4.6-sonnet-medium-thinking)                                                                                                                                                                                                                                                    |
| **Effort**     | M                                                                                                                                                                                                                                                                                              |
| **Files**      | `lib/focusRuntime.svelte.ts`(+spec), `DeepZoomLayer.svelte`, `DeepZoomStack.svelte`, `NodeCompactContent.svelte`, `NodeDetailsLayer.svelte`, `Multigraph.svelte`, `DeepZoomLayerHarness.svelte`, `DeepZoomStackHarness.svelte`, `DeepZoomLayer.stories.svelte`, `DeepZoomStack.stories.svelte` |
| **PR title**   | `refactor(focus): remove dead deep-zoom scaffolding`                                                                                                                                                                                                                                           |

Delete `FocusRuntime.preview()` + `entryProgress` (and the `placeholder`
subject arm if only test scaffolding uses it — otherwise leave the union but
drop `preview`). Remove `DeepZoomLayer`'s legacy `children`/`sourceRect`/
`fillRect` branch, its self-interpolation, and `data-source-*`/`data-fill-*`
attributes. Remove `DeepZoomStack` `defaultGeometryForLevel`/
`defaultBaseSizeForLevel` (make `geometryForLevel`/`baseSizeForLevel` required).
Drop the always-1 `opacity` props on `NodeCompactContent`/`NodeDetailsLayer` and
the unused `blockedFactor` field. Migrate harnesses/stories to the geometry API.

**Acceptance**

- `rg 'preview\(|entryProgress|data-source-|data-fill-|blockedFactor|defaultGeometryForLevel'` over `src` returns only intended hits (or none).
- Deep-zoom stories still pass against the geometry-only API.
- lint / check / unit clean.

### T02 — Extract shared tag-border gradient helper

|                |                                                               |
| -------------- | ------------------------------------------------------------- |
| **Depends on** | T01                                                           |
| **Wave**       | 2                                                             |
| **Agent**      | fast/cheap (composer-2.5-fast)                                |
| **Effort**     | XS                                                            |
| **Files**      | `lib/tagColors.ts`(+spec), `Node.svelte`, `Multigraph.svelte` |
| **PR title**   | `refactor(node): share tag-border gradient builder`           |

Move the `conic-gradient(...)` builder into `tagColors.ts` as a pure function
with a spec; call it from both `Node.svelte` (`borderGradient`) and Multigraph's
`focusTagBorderBackground`.

**Acceptance**

- One gradient builder; both call sites use it.
- Spec covers 0-segment (transparent) and multi-segment output.

### T03 — Remove Stage overzoom fallback; single eligibility path

|                |                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------- |
| **Depends on** | T01                                                                                          |
| **Wave**       | 2 (parallel with T02; different regions, but both touch `Multigraph.svelte` — see wave note) |
| **Agent**      | default (claude-4.6-sonnet-medium-thinking)                                                  |
| **Effort**     | M                                                                                            |
| **Files**      | `Stage.svelte`, `lib/zoomBoundary.ts`(+spec), `Stage.stories.svelte`, `Multigraph.svelte`    |
| **PR title**   | `refactor(stage): drop overzoom focus fallback for single boundary path`                     |

Delete `canOverzoomForFocus`, `focusOverzoomMaxScaleForPoint`,
`overzoomMaxScaleForPoint`, and `focusOverzoomMaxScaleForNode`. Route all
zoom-in-past-scale focus entry through `focusEntryBoundaryCandidateForPoint` +
`solveFocusEntryBoundary`. Confirm and, if needed, widen the boundary candidate
resolver so it covers the cases the fallback caught (e.g. cursor near a node
edge). Update stories that asserted the generic overzoom-at-max path.

**Acceptance**

- No references to the removed symbols remain.
- New/updated spec or story: a node the fallback used to catch still commits
  focus via the boundary path.
- Entry/exit e2e still pass.

### T04 — DRY Stage wheel/pinch focus-entry path

|                |                                                                |
| -------------- | -------------------------------------------------------------- |
| **Depends on** | T03                                                            |
| **Wave**       | 3                                                              |
| **Agent**      | default (claude-4.6-sonnet-medium-thinking)                    |
| **Effort**     | M                                                              |
| **Files**      | `Stage.svelte`, optional new `lib/focusEntryGesture.ts`(+spec) |
| **PR title**   | `refactor(stage): unify wheel and pinch focus-entry handling`  |

Extract the shared boundary-apply → progress-accumulate → `onBlockedZoom`
sequence duplicated between `onWheel` and the pinch handler into one function (or
pure helper + thin wiring). Fix the wheel/pinch `onViewStateChange` asymmetry
noted in review.

**Acceptance**

- Wheel and pinch call one shared path; no duplicated boundary blocks.
- Pinch and wheel both persist view state consistently after steering.
- Entry/exit e2e + pinch controller specs pass.

### T05 — Unify focus close paths and phase source of truth

|                |                                                                                       |
| -------------- | ------------------------------------------------------------------------------------- |
| **Depends on** | T01                                                                                   |
| **Wave**       | 3 (parallel with T04; T04 is Stage-only, T05 is Multigraph-only)                      |
| **Agent**      | default (claude-4.6-sonnet-medium-thinking)                                           |
| **Files**      | `Multigraph.svelte`, `lib/focusRuntime.svelte.ts`(+spec), `Multigraph.stories.svelte` |
| **PR title**   | `refactor(focus): single close path and derived phase`                                |

Collapse `focusCommitted`/`focusExiting` into a phase derived from the runtime.
Merge wheel-completion exit and explicit (Escape/close-button) exit into one
close routine with the same morph and the same residual-gesture gating.

**Acceptance**

- No independent `focusCommitted`/`focusExiting` booleans; phase cannot disagree
  with `FocusLevel.phase`.
- Story exercises Escape, close button, and wheel-completion → same end state and
  gate behavior.

### T06 — Extract `FocusController`

|                |                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------- |
| **Depends on** | T04, T05                                                                                      |
| **Wave**       | 4                                                                                             |
| **Agent**      | high-reasoning (claude-opus-4-8-thinking-high or gpt-5.5-medium)                              |
| **Effort**     | L (split into runtime-move then handler-move commits if needed)                               |
| **Files**      | new `lib/focusController.svelte.ts`(+spec), `Multigraph.svelte`, `lib/focusRuntime.svelte.ts` |
| **PR title**   | `refactor(focus): extract FocusController runtime`                                            |

Introduce a `FocusController` runes class owning the focus runtime, phase
machine, `commit`/`close`/`handleExit`/`handleBlockedZoom`/idle-unmount. Drop
`FocusLevel.worldState` + `handleFocusWorldState` (open question #1). Multigraph
becomes thin wiring: geometry callback + frame/compact/details snippets + feeding
graph/view/stageRect. Keep Stage reporting raw steer/boundary geometry via one
callback into the controller.

**Acceptance**

- `Multigraph.svelte` focus logic reduced to wiring; controller unit-tested for
  the entry→commit→exit→unmount lifecycle.
- No `worldState` field remains; entry/exit invariants documented in the
  controller.
- All existing focus stories/e2e pass unchanged.

### T07 — Single focus input surface

|                |                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| **Depends on** | T06                                                                                                       |
| **Wave**       | 5                                                                                                         |
| **Agent**      | high-reasoning (claude-opus-4-8-thinking-high or gpt-5.5-medium)                                          |
| **Effort**     | L                                                                                                         |
| **Files**      | `DeepZoomStack.svelte`, `ZoomWorld.svelte`, `Multigraph.svelte`, `lib/focusController.svelte.ts`, stories |
| **PR title**   | `refactor(focus): one input surface dispatches to active level`                                           |

Add a fullscreen focus input surface (present while focused) that captures
wheel/pinch and dispatches to the active level's controller. Remove the
`focus-root` full-viewport wheel hack and the duplicated `handleFocusRootWheel`
scrub driver; make `ZoomWorld` receive input from the surface rather than only
when it covers the cursor.

**Acceptance**

- `focus-root` wheel hack + `handleFocusRootWheel` removed.
- Exit scrub completes with the cursor off the shrinking frame (regression e2e).
- One dispatcher; `exitBoundarySync` dual-driver plumbing simplified or removed.

### T08 — Nested image deep zoom (depth-2 proof)

|                |                                                                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T07                                                                                                                                                                                    |
| **Wave**       | 6                                                                                                                                                                                      |
| **Agent**      | high-reasoning (claude-opus-4-8-thinking-high or gpt-5.5-medium)                                                                                                                       |
| **Effort**     | L (split: push/pop wiring, then image snippets + geometry, then tests)                                                                                                                 |
| **Files**      | `NodeDetailsContent.svelte`, `Multigraph.svelte`, `lib/focusController.svelte.ts`, `types/*`, `Multigraph.stories.svelte`, `e2e/app.test.ts`, new image frame/compact/details snippets |
| **PR title**   | `feat(focus): zoom into node images as a nested level`                                                                                                                                 |

Make an image block a zoomable child: bold-zoom toward inscribe inside the node
world commits and `push`es an image level (source = image on-screen rect, fill =
viewport) through the morph surface + gate + world; exit pops back. Render via
content-agnostic image frame/compact/details snippets. Verify pop-continuity
(open question #1); reintroduce a minimal preserved camera only if needed.

**Acceptance**

- Story + wheel-driven e2e: bold-zoom an image in a focused node → image level
  (frame morphs from the image's on-screen rect), pan, exit back to node
  continuously; `FocusRuntime.depth === 2` at the nested level.
- Reduced motion reaches identical states without morph at both levels.
- No double-scale; image crisp at fit.

### T09 — Close out docs and roadmap

|                |                                         |
| -------------- | --------------------------------------- |
| **Depends on** | T08                                     |
| **Wave**       | 7                                       |
| **Agent**      | fast/cheap (composer-2.5-fast)          |
| **Effort**     | XS                                      |
| **Files**      | this plan, milestone 06d, `roadmap.md`  |
| **PR title**   | `docs(roadmap): complete milestone 06d` |

Flip plan → `done`, milestone → `complete`, roadmap row → `complete`; record any
follow-ups discovered during execution.

**Acceptance**

- Statuses updated and cross-linked; no stale references to removed APIs in docs.

## Wave plan

```
Wave 1   T01                      (cruft removal; unblocks everything)
Wave 2   T02  ‖  T03              (gradient helper ‖ overzoom-fallback removal)
Wave 3   T04  ‖  T05              (Stage-only DRY ‖ Multigraph-only close/phase)
Wave 4   T06                      (extract FocusController — needs clean T04/T05)
Wave 5   T07                      (input surface — needs the controller)
Wave 6   T08                      (nested image zoom — needs the input surface)
Wave 7   T09                      (docs close-out)
```

Wave note: T02 and T03 both touch `Multigraph.svelte` but in disjoint regions
(gradient helper call vs. Stage prop wiring). If run in parallel, land T02 first
or rebase T03 on it; if that friction shows up, serialize them. T04 (Stage) and
T05 (Multigraph) are cleanly disjoint.

Invariant before starting a wave: every task's `Depends on` is merged to the
feature branch.

## Risks and rollback

- **T03 parity gap.** Removing the overzoom fallback could drop a focus-entry
  case the boundary resolver doesn't cover. Mitigation: add the parity spec/story
  before deleting; if a real gap appears, widen the resolver rather than
  restoring the fallback.
- **T06 is the keystone and the biggest risk.** A bad `FocusController` boundary
  makes T07/T08 fight it. Mitigation: T06 lands only after T04/T05 clean the
  code, is split into runtime-move then handler-move commits, and gets a focused
  review before T07 starts. Rollback = revert T06; T01–T05 stand alone.
- **T07 input routing regressions.** A single dispatcher could mis-route
  pinch/drag pointer capture. Mitigation: keep pointer drag/pinch inside the
  world; dispatch wheel (and pinch centroid) only; regression e2e for off-frame
  exit scrub.
- **T08 pop-continuity.** If a panned image can't recompute its parent camera on
  pop, nesting feels wrong. Mitigation: the pop-continuity check is an explicit
  acceptance item; reintroduce a minimal preserved camera if it fails
  (documented fallback, not the old general store).

## Definition of Done (this plan)

- All tasks merged to the feature branch (or `main`, per the branch's merge
  flow).
- Milestone 06d acceptance criteria satisfied (link, not duplicated).
- Plan status `done`, milestone `complete`, roadmap row `complete` linking here.
- Full DoD suite green: `pnpm --filter mind-map-sv lint`, `check`,
  `test:unit -- --run`, and the wheel-driven e2e.
- Work committed per Conventional Commits unless the user says otherwise.

## Notes

- 2026-07-11: Plan authored from the pre-merge review of `feature/deep-zoom`.
  Review findings that seed the tasks: dead `FocusRuntime` APIs, `DeepZoomLayer`
  legacy path, dual close paths, dual focus-eligibility systems, wheel/pinch
  duplication, write-only `worldState`, `focus-root` exit hack, and the unproven
  recursive stack. T08 is the payoff that proves the stack at depth 2.
- 2026-07-11: Open question on camera-on-pop resolved toward _recompute from
  invariants_; T08 must validate before we consider the general `worldState`
  store gone for good.
