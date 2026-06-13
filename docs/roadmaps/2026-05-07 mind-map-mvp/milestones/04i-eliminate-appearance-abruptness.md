# Milestone 04i: Eliminate appearance/disappearance abruptness

**Status:** not started
**Depends on:** milestones 02 (hop-distance scale + relaxation loop), 04a/04b
(bounded pinned-neighborhood visibility, boundary-edge fade, and the existing
scale-animation/settle machinery in `Multigraph.svelte`).
**Plan:** [2026-06-13 04i-enter-exit-and-reveal-wave.md](../plans/2026-06-13%2004i-enter-exit-and-reveal-wave.md)

## Goal

Nothing should pop in or out. Every node and edge that appears, disappears, or
changes membership in the visible set should animate, and every animation
should **end exactly on the resting render** so there is no snap at the end.

Two sources of abruptness exist today:

1. **User mutations.** `addNode`, `addEdge`, and `removeEdge` commit straight
   through `withRelaxedPositions(...)`; the element simply appears or vanishes.
2. **Pin/unpin reveal.** `createScaleAnimations` only animates nodes present in
   both the old and new visible sets, so neighbors newly brought within
   `displayedLayers` of a pin snap to full scale instantly. There is no opacity
   channel in the render at all today.

After this milestone, single user mutations animate their one element in/out,
and pin/unpin sweeps a soft reveal wave across the changed neighborhood that
lands on the resting `boundedVisibility` render — including the static
boundary-edge half-fade — with no visible discontinuity.

## Scope

### Per-element enter/exit

- Nodes **scale into and out of existence** (target scale ↔ 0).
- Edges **fade into and out of existence** (opacity 0 ↔ 1), because scaling a
  1-D line reads poorly.
- Exit is the hard case: explicit user removals (`removeEdge`, node delete)
  mutate `graph` immediately, so the element is gone before it can animate.
  A transient **exiting buffer** retains removed/just-hidden elements in the
  render until their exit animation finishes, then prunes them. Hide-by-pin
  reuses the same buffer (the node still exists in `graph` but left the visible
  set).
- Disabling: an enter/exit duration of `0` makes transitions instant
  (reduced-motion and test escape hatch), matching the existing
  `scaleAnimationDurationMs > 0` convention.

### Pin/unpin reveal wave

- On pin/unpin, a soft-edged reveal front propagates outward (reveal) or inward
  (hide) across the changed neighborhood, **driven by the existing focal
  scale-animation clock** rather than a separate timeline.
- The front position is expressed in **hop distance**: a node's reveal moment is
  its min hop to any pinned node, normalized by `displayedLayers`. At progress
  `p`, the front sits at `frontHop = p · displayedLayers`.
- The front is **soft**: per-element opacity is a smoothstep over a configurable
  hop width so the wavefront goes 0→1 quickly but not instantly.
- A rendered edge's reveal is keyed off its **in-range endpoint** (the endpoint
  that is within the visible set), not its far/hidden endpoint, so:
  - interior edges arrive at full opacity, and
  - **boundary edges** (one endpoint at `displayedLayers + 1`) fully arrive and
    then show the resting half-fade gradient — no never-arriving edge, no snap.

### End-state continuity (no terminal snap)

- At animation completion (`p = 1`), every element's appearance must equal the
  resting `boundedVisibility` render: interior nodes/edges at full scale/opacity,
  boundary edges at full opacity **with** their resting half-gradient, hidden
  elements removed from the DOM.
- This applies symmetrically to unpin: the reverse wave must converge on the new
  (smaller) resting neighborhood and its newly-formed boundary edges.

### Settings

- Extend `LayoutSettings` / `appConfig.multigraph.layout` with at least:
  - an enter/exit duration (ms),
  - a reveal-wave front width (in hops).
- Keep all tunables as explicit parameters with defaults in the pure modules;
  pin existing specs against the new defaults per the TypeScript rule.

## Acceptance criteria

- A pure reveal-wave module has specs covering:
  - per-hop opacity rising with progress and ordered by hop distance,
  - the soft front width producing a partial (0<opacity<1) band, not a step,
  - `p = 1` yielding opacity `1` for every in-range hop (continuity),
  - multiple pins resolving by min hop,
  - reveal vs. hide (reverse) direction.
- A pure enter/exit + exiting-buffer module has specs covering:
  - node scale 0→target on enter and target→0 on exit,
  - edge opacity 0→1 / 1→0,
  - the buffer retaining a removed element until its exit completes, then
    pruning it,
  - duration `0` collapsing to instant.
- Edge reveal keyed off the in-range endpoint is covered: a boundary edge
  reaches full opacity and renders its resting half-gradient at `p = 1`.
- Story coverage:
  - user double-tap-drag to background → the new node scales in (not instant)
    and its edge fades in,
  - removing a duplicate edge → it fades out before leaving the DOM,
  - pinning a node in a multi-hop chain → revealed neighbors arrive as a wave,
    nearer-first, and the final frame matches the resting bounded render,
  - unpinning → the reverse wave converges on the smaller resting neighborhood.
- Existing layout, scale, drag, and bounded-visibility stories still pass.
- Lint, check, and unit tests pass.

## Non-goals

- New-node friction / "lots of friction then decay" (TODO line 44) — that is
  physics-settle tuning and belongs with milestone 04g, not visual enter/exit.
- New nodes pinned-by-default behavior (separate TODO).
- Thinning/decomposing `Multigraph.svelte` (milestone 04h) — this milestone adds
  orchestration as pure `lib/*.ts` modules so 04h can absorb the wiring later,
  but does not itself perform the refactor.
- Animating pan/zoom, layout drift, or rigid-body settle (milestone 04g).
- Any change to how the visible set itself is computed (`boundedVisibility`
  stays the source of truth for the resting state).

## Risks and open questions

- **Exiting-buffer correctness.** Retained-but-removed elements must not be
  re-introduced into `graph`, must not be draggable/editable mid-exit, and must
  prune deterministically. Resolve the buffer's exact lifecycle in the plan.
- **Clock coupling.** The reveal wave rides the focal scale-animation progress;
  if that animation is pre-empted (a second pin mid-flight), the wave must
  restart cleanly rather than leave half-revealed elements. Resolve in the plan.
- **Monolith pressure.** All wiring lands in the already-large
  `Multigraph.svelte` before 04h splits it; tasks that touch it must serialize
  to avoid same-file collisions.
- **Boundary continuity proof.** The most likely source of a terminal snap is an
  edge whose reveal is keyed off the wrong endpoint; the `p = 1`-equals-resting
  assertion must be explicit in both a unit spec and a story.
