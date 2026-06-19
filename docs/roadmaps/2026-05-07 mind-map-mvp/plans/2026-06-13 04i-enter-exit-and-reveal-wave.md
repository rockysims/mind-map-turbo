# Plan: Enter/exit transitions and the pin reveal wave

**Created:** 2026-06-13
**Author:** Cursor agent
**Milestone:** [milestones/04i-eliminate-appearance-abruptness.md](../milestones/04i-eliminate-appearance-abruptness.md)
**Status:** done
**Total estimated effort:** L (5 tasks; 2 pure modules can run in parallel,
then a serial chain through `Multigraph.svelte`)

## Summary

Add a per-element enter/exit animation model and a hop-distance reveal wave so
no node or edge pops in or out, and every transition lands exactly on the
resting `boundedVisibility` render (including the static boundary-edge half-fade).

## Open questions resolved

- **Milestone scope.** **Cover both user add/remove enter-exit and the
  pin/unpin reveal wave; defer TODO line 44 (new-node friction) to milestone
  04g.** Friction is solver tuning, not appearance abruptness, and shares the
  settle machinery 04g already owns.
- **How explicitly-removed elements exit.** **Animate them out via a transient
  exiting buffer, identical to hide-by-pin.** Consistency beats the small amount
  of extra component state; "instant on explicit delete" would reintroduce the
  pop we are removing.
- **Reveal-wave metric.** **Hop distance, not literal geometry.** The front
  position is `frontHop = p · displayedLayers` where `p` is the existing focal
  scale-animation progress; cheap, multi-pin-friendly (min hop), and matches the
  visibility model already in use.
- **Wavefront softness.** **Smoothstep over a configurable hop width.** One
  tunable gives "0→1 quickly but not instantly."
- **Node vs. edge transition style.** **Nodes scale (0↔target); edges fade
  (opacity 0↔1).** Scaling a 1-D line reads poorly; this matches the TODO's
  parenthetical.
- **Edge reveal keying / end-state continuity.** **Key a rendered edge's reveal
  off its in-range endpoint and require `p = 1` to equal the resting render.**
  Boundary edges then fully arrive and show their resting half-gradient with no
  terminal snap.
- **Disabling transitions.** **Duration `0` ⇒ instant**, reusing the existing
  `scaleAnimationDurationMs > 0` convention for reduced-motion and tests.
- **Default animation tunings.** **Use `enterExitDurationMs = 180`, keep the
  reveal wave on the existing `scaleAnimationDurationMs` clock, and default
  `revealFrontWidthHops = 1`.** This keeps single-element mutations quick while
  preserving the slower pin/unpin scale choreography.
- **Integration order.** **Wire user enter/exit before pin/unpin reveal.** This
  proves the render opacity/scale channel on smaller interactions before the
  more complex wave orchestration.
- **Post-04h target files.** **Treat `layoutRuntime.svelte.ts` as the scale and
  settle orchestration boundary.** `Multigraph.svelte` still owns UI wiring, but
  scale-animation clock integration belongs in the extracted runtime.

## Out of scope (for this plan)

- TODO line 44 new-node friction and "new nodes pinned by default" (separate
  work; 04g / its own TODO).
- Decomposing `Multigraph.svelte` (milestone 04h). Wiring lands in the existing
  component as thin calls into the new pure modules.
- Rigid-body drift/rotation settle (milestone 04g).
- Pan/zoom animation; changes to how the visible set is computed.

## Tasks

> Each task is one PR. T03–T05 all touch `Multigraph.svelte`, so they run in
> separate waves by design (the monolith serializes them until 04h splits it).

### ✓ T01 — Pure `revealWave.ts` module

|                |                                                                             |
| -------------- | --------------------------------------------------------------------------- |
| **Depends on** | —                                                                           |
| **Wave**       | 1                                                                           |
| **Agent**      | high-reasoning (claude-opus-4-8-thinking-high or gpt-5.3-codex)             |
| **Effort**     | M                                                                           |
| **Files**      | new `Multigraph/lib/revealWave.ts`, new `Multigraph/lib/revealWave.spec.ts` |
| **PR title**   | `feat(multigraph): add pure reveal-wave opacity model`                      |

Implement a pure module that, given `hopsByNodeId` (min hop to any pin),
`displayedLayers`, a front width in hops, a progress `p ∈ [0,1]`, and a
direction (`reveal` | `hide`), returns per-node opacity via a smoothstep front
at `frontHop = p · displayedLayers`. Provide a helper mapping node opacities to
a rendered edge's opacity using its **in-range** endpoint, and a helper to read
`p` from a `NodeScaleAnimation` (the focal animation). Front width, falloff are
parameters with defaults.

**Acceptance**

- Opacity rises with `p` and is ordered by hop (nearer reveals first).
- Front width produces a band with `0 < opacity < 1` (not a step).
- `p = 1` ⇒ opacity `1` for every hop `≤ displayedLayers` (continuity).
- Multiple pins resolve by min hop.
- `hide` direction is the time-reverse of `reveal`.
- Edge helper keyed off the in-range endpoint ⇒ boundary edge reaches `1`.

### ✓ T02 — Pure `elementTransitions.ts` (enter/exit + exiting buffer)

|                |                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                           |
| **Wave**       | 1                                                                                           |
| **Agent**      | default (claude-4.6-sonnet-medium-thinking)                                                 |
| **Effort**     | M                                                                                           |
| **Files**      | new `Multigraph/lib/elementTransitions.ts`, new `Multigraph/lib/elementTransitions.spec.ts` |
| **PR title**   | `feat(multigraph): add enter/exit + exiting-buffer transition model`                        |

Implement a pure model for per-element enter/exit: node scale `0↔target`, edge
opacity `0↔1`, on a shared clock with easing (reuse `scaleAnimation.ts`'s easing
where natural). Implement the **exiting buffer** as pure reducers: add an
exiting element with its final-known render data + start time, compute its
scale/opacity at `now`, and prune once complete. Duration `0` ⇒ instant.

**Acceptance**

- Enter/exit interpolation covered for nodes (scale) and edges (opacity).
- Buffer retains a removed element until exit completes, then prunes it.
- Adding an element id that re-enters mid-exit cancels its exit cleanly.
- Duration `0` collapses to the end state immediately.
- Immutable: reducers return new objects.

### ✓ T03 — Render opacity/scale channel + data attrs

|                |                                                                                  |
| -------------- | -------------------------------------------------------------------------------- |
| **Depends on** | T02                                                                              |
| **Wave**       | 2                                                                                |
| **Agent**      | default (claude-4.6-sonnet-medium-thinking)                                      |
| **Files**      | `Multigraph.svelte`, `Node/Node.svelte` (if needed), `Multigraph.stories.svelte` |
| **PR title**   | `feat(multigraph): add per-element opacity/scale render channel`                 |

Thread a per-node opacity (multiplying the existing scale) and a per-edge
opacity multiplier into the markup, with `data-node-opacity` / `data-edge-opacity`
attrs for story assertions. Render the union of the visible set and the exiting
buffer. No behavior change yet — values are driven by static props in a story to
prove the channel works in isolation.

**Acceptance**

- A story drives explicit opacity/scale values and asserts the rendered
  `data-*` attrs and computed style match.
- Existing node/edge stories still pass (default opacity `1`, scale unchanged).
- Exiting-buffer elements render even when absent from the visible set.

### ✓ T04 — Wire user add/remove through enter/exit

|                |                                                                                 |
| -------------- | ------------------------------------------------------------------------------- |
| **Depends on** | T02, T03                                                                        |
| **Wave**       | 3                                                                               |
| **Agent**      | default (claude-4.6-sonnet-medium-thinking)                                     |
| **Files**      | `Multigraph.svelte`, `Multigraph.stories.svelte`, `lib/layoutRuntime.svelte.ts` |
| **PR title**   | `feat(multigraph): animate node/edge add and edge removal`                      |

Route `addNode`/`addEdge` through an enter animation (new node scale 0→target at
its drop point; new edge fade in) and `removeEdge` / node delete through the
exiting buffer (fade/scale out, then prune). Drive the relaxation loop while
transitions are active, reusing the existing `startRelaxationLoop` gate.

**Acceptance**

- Story: double-tap-drag to background → new node scales in (intermediate frame
  shows `scale < target`) and its edge fades in.
- Story: remove duplicate edge → edge fades out and is gone after the buffer
  prunes.
- Removed elements are never editable/draggable mid-exit.
- Existing add/remove stories updated to assert via `data-*`, not instant state.

### ✓ T05 — Wire pin/unpin reveal wave + end-state continuity

|                |                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T01, T03                                                                                                                                          |
| **Wave**       | 4                                                                                                                                                 |
| **Agent**      | high-reasoning (claude-opus-4-8-thinking-high or gpt-5.3-codex)                                                                                   |
| **Files**      | `Multigraph.svelte`, `lib/layoutRuntime.svelte.ts`, `lib/layoutRuntime.spec.ts`, `layoutSettings.ts`, `appConfig.ts`, `Multigraph.stories.svelte` |
| **PR title**   | `feat(multigraph): sweep a reveal wave on pin/unpin`                                                                                              |

In `LayoutRuntime.beginScaleChange` / the frame loop, compute per-element
opacity from `revealWave` using the focal scale-animation progress, feeding the
render channel from T03. Add `enterExitDurationMs` (default `180`) and
`revealFrontWidthHops` (default `1`) to `LayoutSettings` +
`appConfig.multigraph.layout`, pinning existing specs to the new defaults.
Guarantee `p = 1` equals the resting render (boundary edges show their resting
half-gradient). Handle a second pin mid-flight by restarting the wave cleanly.

**Acceptance**

- Story: pin a node in a multi-hop chain → neighbors arrive nearer-first as a
  wave; the final frame's `data-*` opacities equal the resting bounded render
  (interior `1`, boundary edge `1` + half-gradient).
- Story: unpin → reverse wave converges on the smaller resting neighborhood and
  its new boundary edges, no terminal snap.
- `scaleAnimationDurationMs` / new durations at `0` ⇒ instant (reduced-motion).
- Existing pin/unpin/scale/bounded-visibility stories still pass.

## Wave plan

```
Wave 1   T01  ‖  T02        (two independent pure modules)
Wave 2   T03                (render channel; depends on T02)
Wave 3   T04                (user add/remove; depends on T02,T03; touches Multigraph)
Wave 4   T05                (pin reveal wave; depends on T01,T03; touches Multigraph)
```

T03/T04/T05 each touch `Multigraph.svelte`, so they are deliberately serial.
T04 and T05 are independent in concept but cannot share a wave because of the
shared file; sequence T04 → T05 (or swap, either order works) and rebase.

## Risks and rollback

- **If T01's wave model is wrong**, T05 rebases against it but T02–T04 are
  unaffected (T04 uses only `elementTransitions`). T01 lands and gets a focused
  review before T05 starts.
- **Exiting buffer leaks / double-render.** Mitigation: T02 reducers prune
  deterministically and are spec-covered; T03 renders `visible ∪ exiting` with a
  single keyed `{#each}` so a stale id can't double-mount.
- **Terminal snap on boundary edges.** Mitigation: the `p = 1`-equals-resting
  assertion is both a T01 unit spec and a T05 story.
- **Mid-flight pre-emption (second pin during a wave).** Mitigation: T05 resets
  the focal animation + wave atomically; covered by re-pin story or noted as a
  follow-up if it proves fiddly.
- **Monolith merge friction.** Accepted: T03→T04→T05 serialize; rebases are
  cheap because each adds a distinct block. 04h will later split this.

## Definition of Done (this plan)

- All 5 tasks merged to `main`; milestone 04i acceptance criteria satisfied.
- Plan status `done`, milestone status `complete`, roadmap row `complete` with a
  link back to this plan.
- Work committed (Conventional Commits) unless the user said not to.

## Notes

- 2026-06-13: Node scale-in can reuse `scaleAnimation.ts` by seeding `fromScale`
  `0` for newly-entering ids; the genuinely new code is edge opacity + the
  exiting buffer (T02) and the hop-front orchestration (T01/T05). Consider
  whether T02 should extend `scaleAnimation.ts` rather than add a sibling once
  T01/T02 land.
- 2026-06-13: 04h has landed; T03–T05 should keep UI state in
  `Multigraph.svelte` but put scale-clock / frame-loop behavior in
  `lib/layoutRuntime.svelte.ts` where possible.
