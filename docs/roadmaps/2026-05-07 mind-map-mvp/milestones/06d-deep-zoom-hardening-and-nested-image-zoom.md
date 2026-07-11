# Milestone 06d: Deep zoom hardening and nested image zoom

**Status:** complete
**Depends on:** milestone 06c (single-surface morph).
**Plan:** [2026-07-11 06d-deep-zoom-hardening-and-nested-image-zoom.md](../plans/2026-07-11%2006d-deep-zoom-hardening-and-nested-image-zoom.md)

## Why

Milestone 06c landed a working single-surface morph: one overlay element owns
the frame across the whole deep-zoom round trip, geometry is a pure function of
layout + live view state (no node measurement), and content crossfades inside
it. A pre-merge review of `feature/deep-zoom` found the mechanic is solid but
carries **scaffolding and split ownership** that will bite the moment a real
consumer nests on top of it:

- Dead APIs and abstractions left from earlier designs (`FocusRuntime.preview`,
  `entryProgress`, the `placeholder` subject arm; `DeepZoomLayer`'s legacy
  `children`/`sourceRect`/`fillRect` self-interpolation path and its
  `data-source-*`/`data-fill-*` attributes; `DeepZoomStack`'s default
  geometry/base functions; vestigial per-content `opacity` props; an unused
  `blockedFactor`).
- **The recursive stack is unproven.** `FocusRuntime` exposes `push`/`pop`/
  `depth`, but production only ever `open()`s a single node level; the multi-
  level path is exercised solely by placeholder stories. The original 06b intent
  — images and other blocks as nested zoom levels of the same primitives — was
  explicitly deferred and has never run.
- **Split, duplicated ownership.** Focus state is spread across Multigraph
  booleans (`focusCommitted`/`focusExiting`) _and_ `FocusRuntime.phase`; Stage
  owns entry-boundary steering while Multigraph owns the morph; the exit scrub
  needs a full-viewport `focus-root` wheel hack that re-implements
  `wheelZoomWorld` as a second scrub driver; there are two asymmetric close
  paths; wheel and pinch duplicate ~80 lines in Stage; and a second, older
  focus-eligibility path (the overzoom fallback with fixed `NODE_RADIUS`) shadows
  the boundary candidate resolver.

This milestone hardens the mechanic (remove cruft, unify ownership, one input
authority) and then **proves nesting for real** by making images inside a node
their own deep-zoom level — the first production consumer of the recursive
stack.

## Goal

A deep-zoom mechanic that is (1) free of dead scaffolding, (2) owned by one
`FocusController` with a single phase source of truth and one input surface, and
(3) demonstrably recursive: bold-zooming an image inside a focused node pushes a
second zoom level via the same primitives, and exiting pops back continuously —
proving the stack works at depth ≥ 2 in production, not just in placeholder
stories.

## Scope

### Remove cruft

- Delete unreferenced focus/morph code: `FocusRuntime.preview()`,
  `FocusRuntime.entryProgress`, the `placeholder` arm of `FocusSubjectKind` where
  it is only test scaffolding; `DeepZoomLayer`'s legacy single-`children` /
  `sourceRect`+`fillRect` interpolation branch and its `data-source-*` /
  `data-fill-*` attributes; `DeepZoomStack`'s `defaultGeometryForLevel` /
  `defaultBaseSizeForLevel`; the always-1 `opacity` props on
  `NodeCompactContent` / `NodeDetailsLayer`; and the unused `blockedFactor`
  callback field. Harnesses/stories move to the production geometry API.
- De-duplicate the tag-border conic-gradient builder (currently in both
  `Node.svelte` and `Multigraph`'s focus snippet) into one shared helper.

### Unify ownership

- **One phase source of truth.** Collapse Multigraph's `focusCommitted` /
  `focusExiting` booleans into a derived phase over the focus runtime; no state
  that can disagree with `FocusLevel.phase`.
- **One exit routine.** Merge the wheel-completion exit and the explicit
  (Escape/close-button) exit into a single close path with consistent morph and
  consistent residual-gesture gating.
- **One focus-entry eligibility path.** Remove the Stage overzoom fallback
  (`canOverzoomForFocus`, `focusOverzoomMaxScaleForPoint`,
  `overzoomMaxScaleForPoint`, `focusOverzoomMaxScaleForNode`); the boundary
  candidate resolver becomes the sole path, with tests confirming it covers the
  cases the fallback used to.
- **DRY gestures.** Extract the shared wheel/pinch focus-entry sequence in Stage
  so a boundary change is written once.
- **Drop stored camera state.** Remove `FocusLevel.worldState` and the
  write-only `handleFocusWorldState`; the entry (identity) and exit
  (centered-fit) invariants fully determine each level's camera.

### One `FocusController`

- Extract a `FocusController` (Svelte-runes class, like `LayoutRuntime`) that
  owns the focus runtime, the phase state machine, commit/exit/idle-unmount, and
  the input dispatch. Multigraph becomes thin wiring: it feeds graph/view/stage
  rect and supplies node-specific geometry + frame/compact/details snippets.
- **One focus input surface.** A single fullscreen surface, present while
  focused, captures wheel/pinch and dispatches to the **active** level's zoom
  controller (entry scrub, committed pan/zoom, exit scrub alike), replacing the
  per-`ZoomWorld` "only when covering the cursor" wheel handling and the
  Multigraph `focus-root` exit hack. Stage keeps owning graph-world gestures.

### Prove nesting: image deep zoom

- Inside a focused node, an image block is a **zoomable child subject**.
  Bold-zooming an image toward inscribe of the node world commits and **pushes an
  image level** (source rect = image's live on-screen rect, fill = viewport)
  through the same morph surface + gate + world primitives; exit mirrors and pops
  back to the node, continuously.
- The pushed level renders through content-agnostic snippets (an image frame /
  compact / details), demonstrating the stack is not node-specific.
- Depth-2 entry/exit is covered in production stories and a wheel-driven e2e,
  replacing (or upgrading) the depth-2 _placeholder_ recursion story.

## Acceptance criteria

- `rg` over the focus modules is clean of the removed symbols
  (`preview`, `entryProgress`, `worldState`, `blockedFactor`,
  `canOverzoomForFocus`, `focusOverzoomMaxScaleForPoint`, the `data-source-*` /
  `data-fill-*` attributes); no dead default functions remain in `DeepZoomStack`.
- No `focusCommitted`/`focusExiting` booleans remain as independent state; phase
  is derived from the runtime and cannot disagree with `FocusLevel.phase`.
- A single close routine handles Escape, the close button, and wheel-completion
  with the same morph and the same residual-gesture gate; covered by a story that
  exercises all three.
- The overzoom fallback is gone; a spec/story shows the boundary candidate
  resolver still commits focus for a node the old fallback would have caught, and
  that the fixed-`NODE_RADIUS` cap is no longer referenced.
- Stage's wheel and pinch drive focus entry through one shared code path (no
  duplicated boundary-apply/`onBlockedZoom` blocks); existing entry/exit e2e
  still pass.
- `FocusController` owns focus state and handlers; `Multigraph` no longer
  contains the focus state machine beyond wiring it to graph/view/snippets.
- One focus input surface routes all focus-mode wheel/pinch to the active level;
  the `focus-root` full-viewport wheel hack and the duplicated
  `handleFocusRootWheel` scrub driver are removed; exit scrub still completes when
  the cursor is off the shrinking frame (regression-tested).
- **Depth 2 in production:** a story and a wheel-driven e2e bold-zoom an image
  inside a focused node, land in an image level (frame morphs from the image's
  on-screen rect), pan/zoom within it, and exit back to the node continuously —
  with `FocusRuntime.depth === 2` at the nested level.
- Reduced motion reaches identical committed/exited states at both levels without
  the morph.
- Lint, check, unit/browser/story tests, and the wheel-driven e2e pass.

## Non-goals

- New image UX beyond making an image a zoom level: no cropping, annotations,
  multi-image gallery navigation, or zoom-to-fit-on-double-click.
- Zoomable levels for non-image blocks (text, future embeds); the primitives
  should not preclude them, but only images are wired here.
- Retrofitting `Stage.svelte` graph zoom onto the shared world/input abstraction.
- Browser Back/history integration; persisting focus-mode camera across reloads.
- Any change to gate feel/tunables (zone fractions, margins, swallow timing)
  beyond what unification and nesting require.

## Risks and open questions

Resolved in the plan; kept here for context.

- **Camera on pop.** Recompute the parent camera from the centered-fit invariant
  vs. store an ancestor's live world state — does recompute hold once a real
  child (image) can be panned before exit?
- **Input surface scope.** A focus-scoped surface vs. a truly global gesture bus
  spanning Stage; and how pinch/drag pointer-capture cooperates with a wheel
  dispatcher.
- **Controller extraction scope.** How much of Stage's entry-boundary steering
  moves into `FocusController` vs. stays in Stage behind a thin callback.
- **Image entry trigger.** Bold-zoom on the image within the node world vs. an
  explicit affordance; and how the child boundary gate runs inside a `ZoomWorld`
  the way it runs in Stage today.
- **Endpoint crispness.** An image transform-scaled by the frame during the
  morph then owned by `ZoomWorld` at fit — confirm no double-scale and that the
  image is crisp at rest.
