# Plan: Unified hop model for derived edges

**Created:** 2026-08-28
**Author:** Claude Code agent
**Milestone:** [milestones/11-unified-hop-model-for-derived-edges.md](../milestones/11-unified-hop-model-for-derived-edges.md)
**Status:** executing
**Total estimated effort:** L

## Summary

Replace the four parallel hop computations that derived dataflow edges
accreted (visibility chain, sizing re-measure, dual beacon selection, spring
side channel, all gated differently by `dataflowInLayout`) with one bounded
hop computation parameterized by a new `dataflowDisplayedLayers` budget, and
fix the one bug the redesign does not absorb: content commits never kick the
physics loop.

## Open questions resolved

The first four are product decisions made by the user on 2026-08-28 during
the review that produced this milestone.

- **Path grammar for `dataflowDisplayedLayers ≥ 2`.** _(User decision.)_
  **Crossing a derived edge is a dead end for authored edges.** A feasible
  path is authored steps then derived steps; after the first derived step
  only further derived steps may follow, up to the derived budget. The
  alternative (a small mixed budget after the crossing) reintroduces "one
  equation drags the revealed node's drawn friends into view" — the exact
  failure the last five fix commits kept fighting. The two readings agree at
  the default budget of 1.

- **Keep `derivedEdgeSpringFactor`?** _(User decision.)_ **Keep, default 1.**
  It is a scalar per-edge weight, not a second graph, so it cannot recreate
  the divergence problem, and it is the only feel-tuning knob for how hard an
  equation pulls.

- **Beacon components.** _(User decision.)_ **Selected per authored
  component**, as today. Two clusters joined only by an equation each keep
  their own anchor; the alternative (one beacon per composed component) would
  leave the second cluster represented only by whatever the derived budget
  reveals — a whole cluster mostly vanishing because someone wrote an
  equation.

- **Derived edges at the visibility boundary.** _(User decision, via accepted
  recommendation.)_ **A derived edge renders only when both endpoints are
  visible.** The 1fefed6 principle — an arrow toward somewhere the reader
  cannot go is worse than no arrow — is enforced as a render rule instead of
  by trying to reveal every far endpoint, which a chained equation defeats
  (`v→h1→h3` reveals `h1` but not `h3`, leaving a stub under the old
  approach). The out-of-view diagnostic remains the affordance for a hidden
  definer. This also settles `dataflowDisplayedLayers = 0`: derived edges
  still draw between visible pairs, and no stubs appear.

- **Beacon hop vs. real distance.** **Accept min-relaxation.** The old sizing
  re-measure deliberately let a larger real distance replace a beacon's flat
  hop; the unified computation only relaxes downward. The single surviving
  divergence — a beacon that is a direct derived neighbor of a visible node
  keeps `BEACON_HOP` instead of sizing one past its anchor — is not worth a
  second semantics. Recorded in the milestone's risks.

- **Where the unified function lives.** **`boundedVisibility.ts`**, as
  `computeBoundedHops(graph, derivedEdges, beaconIds, options)`. It is the
  visibility module's question; `layout.ts` keeps the BFS primitive
  (`hopsFromPinned` / `hopsFromOrigins`) it builds on.

- **Who computes, who reads.** **`Multigraph.svelte` computes the hop map in
  its `$derived` chain; `LayoutRuntime` receives it through a `getHops`-style
  option.** The runtime rebuilding its own chain is the root of the "must
  agree" convention; one producer ends it. The runtime still needs
  hops-for-a-_hypothetical_ graph in `relaxAfterMutation` and the reveal-wave
  diff, so the option takes the graph as an argument rather than being a
  parameterless getter.

## Out of scope (for this plan)

- The `mathSymbols.ts` inference fixes (structural conflict key, definition
  LHS whitelist, prime identity). Independent bug-fix track, already scoped
  as standalone tasks; no dependency in either direction.
- Smaller math-layer improvements queued in the TODO intake (LRU render
  cache, `\text{}` subscripts, `≔`/`≡` as definition operators, a "looks
  like a definition but isn't" authoring note).
- Any settings UI for the new config value.
- Tuning or story coverage for derived budgets above 1.

## Tasks

> One PR each. T01 and T07 are independent bug/perf fixes that land first and
> stand on their own even if the redesign slips. Per the repo convention,
> every fix task writes its regression test first and watches it fail.

### T01 — Relax and settle after a content commit changes the dataflow

|                |                                                                            |
| -------------- | -------------------------------------------------------------------------- |
| **Depends on** | —                                                                          |
| **Wave**       | 1                                                                          |
| **Agent**      | default (inherit)                                                          |
| **Effort**     | S                                                                          |
| **Files**      | `Multigraph.svelte`, `layoutRuntime.spec.ts` or story                      |
| **PR title**   | `fix(multigraph): relax the layout when a content commit changes dataflow` |

`saveNodeContent` and the non-unpin title-commit branch call bare
`commitUserGraph`; every structural mutation goes through
`relaxAfterMutation` and a settle. Since milestone 09, content is
topology-affecting, so an equation edit reveals a node frozen at a stale
ingest position (settled at minimum scale, drawn much larger) with no physics
until the next drag. Commit content through `relaxAfterMutation` plus a
settle kick when the committed content changes the dataflow layer
(unconditionally is acceptable if simpler).

The test must drive the real save path. Every `DataflowHarness` story
currently masks this bug by bumping `graphGeneration` per equation change,
which routes through the full ingest reset that real edits never take.

**Acceptance**

- Regression test commits a description edit without a `graphGeneration`
  bump and asserts the runtime relaxes/settles; watched to fail first.
- Removing an equation also relaxes.
- A content edit that changes no math still behaves as today (no relayout
  churn while renaming a node, unless the unconditional route is chosen —
  then assert the settle is cheap/idempotent).

### T02 — `computeBoundedHops`: one hop computation with a derived budget

|                |                                                                            |
| -------------- | -------------------------------------------------------------------------- |
| **Depends on** | —                                                                          |
| **Wave**       | 1                                                                          |
| **Agent**      | high-reasoning                                                             |
| **Effort**     | M                                                                          |
| **Files**      | `lib/boundedVisibility.ts` + spec, `lib/layoutSettings.ts`, `appConfig.ts` |
| **PR title**   | `feat(layout): compute bounded hops with a derived-edge budget`            |

Pure function: authored BFS from pins (`hopsFromPinned`), beacon overrides
(`withBeaconHops`), then a derived-edges-only multi-source BFS seeded from
every node within `displayedLayers`, running at most
`dataflowDisplayedLayers` steps, relaxing
`min(existing, anchorHop + steps, displayedLayers)`. Nodes first reached in
the derived phase are never re-seeded into authored expansion. Add
`dataflowDisplayedLayers: 1` to `appConfig.multigraph.layout` and
`LayoutSettings`. Preserve the identity-return fast path when nothing
changes.

**Acceptance**

- Behavior tests carried over from `withRevealedNeighborHops`'s spec pass
  against the new function verbatim in spirit: a revealed node anchors no
  authored reveal; reveals cap at `displayedLayers`.
- Grammar pinned: `pin -d→ a -a→ b` hides `b` at any budget; `pin -d→ a -d→ b`
  reveals `b` only at budget ≥ 2.
- A derived edge between two visible nodes relaxes the farther endpoint's hop
  (the sizing behavior `withHopsThroughEdges` existed for) and never changes
  the visible set.
- Budget 0 reveals nothing; no-pins case seeds from beacons alone.
- Identity return when derived edges change nothing.

### T03 — One hop source: renderer computes, runtime reads

|                |                                                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T02                                                                                                                                            |
| **Wave**       | 2                                                                                                                                              |
| **Agent**      | high-reasoning                                                                                                                                 |
| **Effort**     | L                                                                                                                                              |
| **Files**      | `Multigraph.svelte`, `lib/layoutRuntime.svelte.ts`, `lib/graphLayout.ts`, `lib/layout.ts`, `lib/beacons.ts`, `lib/boundedVisibility.ts`, specs |
| **PR title**   | `refactor(layout): drive visibility and sizing from one bounded hop map`                                                                       |

The deletion task. `Multigraph.svelte` computes `computeBoundedHops` once;
`LayoutRuntime` consumes it via a new option (graph-parameterized, for
`relaxAfterMutation` and the wave diff). `deriveGraphLayout` accepts the hop
map directly instead of recomputing `hopsFromPinned` and merging
`hopOverridesByNodeId`. Delete: `withRevealedNeighborHops`,
`withHopsThroughEdges` + `HopsThroughEdgesOptions`, `#scaleHopsFor`,
`#distanceOriginsFor`, the `#effectiveHopsFor` duplication,
`composeAdjacency`/`composeRevealEdges`, `BeaconOptions.extraEdges`, the
`dataflowInLayout` prop and both branches (also in `DataflowHarness`), and
the "must agree" comments that documented the convention this ends.

**Acceptance**

- Grep-clean: none of the deleted names remain outside history.
- A node on the canvas is always in the physics graph and vice versa,
  asserted by a spec that runs renderer-side and runtime-side visibility on
  the same fixtures.
- Sizing equals visibility hops: the 2faed60 fixture (`root -d→ a -a→ b`) now
  shows `a` at hop 1 and `b` hidden; the c31aa45 unpinned fixture needs no
  special origins and keeps one beacon per authored cluster.
- Existing non-dataflow specs and stories pass unchanged.

### T04 — Derived edges join the visible layout graph

|                |                                                                    |
| -------------- | ------------------------------------------------------------------ |
| **Depends on** | T03                                                                |
| **Wave**       | 3                                                                  |
| **Agent**      | default (inherit)                                                  |
| **Effort**     | M                                                                  |
| **Files**      | `Multigraph.svelte`, `lib/graphLayout.ts`, `lib/physics.ts`, specs |
| **PR title**   | `feat(layout): let derived edges join the visible layout graph`    |

Compose the visible layout graph once as visible authored + visible derived
edges (still carrying `springFactor`), delete the
`composeSpringEdges`/`springEdges` side channel, and let
`shortestPathHopsByNodeId` see derived edges so hop repulsion treats a
derived pair as neighbors instead of infinitely distant. Today repulsion at
max strength fights the spring to a ~950px standoff where an authored pair
settles at ~736px. The ingest settle composes the same graph the same way.

**Acceptance**

- Numeric spec: a derived-only pair at factor 1 settles within a few percent
  of an authored pair's distance; watched to fail against the old standoff
  first.
- A zero factor still means absent before degree counting (the 96e565e
  invariant).
- No double-pull: exactly one composition point feeds physics.
- Derived edges still never reach persistence, mutation paths, or the
  duplicate-edge flow.

### T05 — Render derived edges only between visible endpoints

|                |                                                                |
| -------------- | -------------------------------------------------------------- |
| **Depends on** | T03                                                            |
| **Wave**       | 4                                                              |
| **Agent**      | default (inherit)                                              |
| **Effort**     | S                                                              |
| **Files**      | `Multigraph.svelte` (edge visibility derivation), story        |
| **PR title**   | `fix(multigraph): hide a derived edge whose far end is hidden` |

Map a derived edge's `boundary` classification to `hidden` (authored edges
keep their boundary fade). Kills the chained-equation stub
(`v→h1→h3` with `h3` beyond the budget) and makes budget 0 stub-free.

**Acceptance**

- Story: the chained-equation fixture renders no stub from `h1`; watched to
  fail first.
- Authored boundary edges still fade exactly as before.
- The out-of-view diagnostic still reports the hidden definer.

### T06 — Reveal wave over composed edges and unified hops

|                |                                                                       |
| -------------- | --------------------------------------------------------------------- |
| **Depends on** | T03, T04                                                              |
| **Wave**       | 4 (parallel with T05)                                                 |
| **Agent**      | high-reasoning                                                        |
| **Effort**     | M                                                                     |
| **Files**      | `lib/layoutRuntime.svelte.ts`, `layoutRuntime.spec.ts`, story         |
| **PR title**   | `fix(layout): fade derived edges and exit sizes with the reveal wave` |

Build the wave's edge sets over the composed render edges so derived arrows
fade with the wave instead of snapping to full opacity toward a node still at
opacity 0, and take previous scales from the unified hop map so a fading
dataflow-sized node exits at the size it was drawn (today it jumps ~43% at
wave start because the snapshot used visibility hops while rendering used
sizing hops).

**Acceptance**

- Story: pinning with derived edges on screen fades them with the wave, both
  directions; watched to fail first.
- Spec: previous-scale snapshot equals the drawn scale for a dataflow-sized
  node entering a wave.
- Unpinned-cluster waves are unregressed.

### T07 — Identity-stable dataflow model

|                |                                                                      |
| -------------- | -------------------------------------------------------------------- |
| **Depends on** | —                                                                    |
| **Wave**       | 1                                                                    |
| **Agent**      | default (inherit)                                                    |
| **Effort**     | M                                                                    |
| **Files**      | `lib/dataflowLayer.ts`, `lib/quantityIndex.ts`, specs                |
| **PR title**   | `perf(graph): make the dataflow model identity-stable across frames` |

The model depends only on per-node `(id, title, description, tags)` but is
derived from `graph`, whose identity changes every animation frame, so index,
edges, and diagnostics rebuild several times per frame during drag/settle.
Return the previous result by identity when every node's content signature
hits the memo and the live-id set is unchanged; downstream `$derived`s
(renderGraph composition, chips, labels, diagnostics, and after T03 the hop
map) then short-circuit. Matters more after T01 makes content commits kick
the frame loop.

**Acceptance**

- Counting-double spec: a position-only graph update performs zero
  extractions and returns the identical model object; a one-node content
  edit re-extracts exactly one node (existing T03-milestone-09 guarantee
  preserved).
- Derived edge objects, not just ids, are identity-stable across unrelated
  frames.

### T08 — Story sweep: the new semantics, told as stories

|                |                                                            |
| -------------- | ---------------------------------------------------------- |
| **Depends on** | T01–T06                                                    |
| **Wave**       | 5                                                          |
| **Agent**      | default (inherit)                                          |
| **Effort**     | M                                                          |
| **Files**      | `DataflowHarness.stories.svelte`, `DataflowHarness.svelte` |
| **PR title**   | `test(stories): cover the unified hop model end to end`    |

Rewrite the dataflow stories against the new model:
`LayoutRespondsWhenDataflowFeedsIt` dies with the toggle;
`ANodeBehindADataflowLinkIsSizedAHopFurtherOut` becomes "a node behind a
dataflow link stays hidden"; add the budget knob to the harness; keep the
pure-rendering stories. Give the harness a path that commits content through
the real save flow (no `graphGeneration` bump) so the story suite can never
again structurally mask a class of bug the way it masked T01's.

**Acceptance**

- Stories cover: reveal at budget 1, hidden drawn-neighbor, budget 0 (edges
  drawn, nothing revealed, no stubs), both-endpoints render rule, and an
  equation edit through the real save path settling into place.
- Roughly 6–8 of the ~15 dataflow stories rewritten; the rest pass
  untouched.

## Wave plan

```
Wave 1   T01  ‖  T02  ‖  T07   (independent: commit path / new pure module /
                                dataflow-layer memoization)
Wave 2   T03                   (the deletion refactor; touches everything,
                                deliberately alone)
Wave 3   T04                   (physics parity on top of the unified map)
Wave 4   T05  ‖  T06           (edge-render rule vs. wave internals;
                                disjoint files)
Wave 5   T08                   (story sweep over the finished behavior)
```

Eight tasks, five gates. T01 and T07 are useful even in isolation and can
ship before the redesign is agreed final.

## Risks and rollback

- **T03 is the risky one.** It deletes two hand-synchronized chains at once.
  Mitigation: T02 lands first with the full behavior-spec surface, T03 is a
  lone wave, and the renderer/runtime-agreement spec in T03 is written before
  the deletion starts. Rollback is reverting one PR.
- **T04 re-settles existing graphs with math.** Expected and accepted (the
  old distance was the bug), but it will be visible. If the new feel is
  wrong, `derivedEdgeSpringFactor` is the tuning knob — not a revert of the
  composition.
- **The wave code (T06) has the least spec coverage today.** Write the
  failing stories first; if the composed-edge change destabilizes unrelated
  wave behavior, T06 can revert independently of T03–T05.
- **Budget ≥ 2 is spec'd but unexercised.** The default stays 1; nothing in
  the app sets anything else yet. If a future settings surface exposes it,
  the grammar decision above is already recorded.

## Definition of Done (this plan)

- All eight tasks merged; milestone 11's acceptance criteria satisfied.
- Lint, `svelte-check`, and the unit/browser/story suites pass.
- None of the deleted mechanism names survive in source.
- Plan status `done`, milestone `complete`, roadmap row updated; milestone
  09's amendment about the superseded toggle is in place.

## Notes

- 2026-08-28: This plan came out of a three-reviewer structured review
  (architecture, defect hunt, math stack) with independent verification of
  the load-bearing claims. Findings not absorbed here went to: the
  `mathSymbols.ts` correctness fixes (standalone task chips), and the TODO
  intake (small math-layer improvements). The defect list and reproduction
  numbers (950px vs. 736px standoff, ~43% wave snap) are preserved in the
  task descriptions above so the regression tests have concrete targets.
- 2026-08-28: User directive — the two standalone bug fixes surfaced by the
  review are to be addressed right after this plan lands. The first (content
  commits never relaxing the layout) is T01 of this plan and is handled by
  executing it; the second (the `mathSymbols.ts` inference fixes: structural
  conflict key, definition LHS whitelist, prime handling) stays out of scope
  here and is the immediate follow-up once the plan's Definition of Done is
  met.
- 2026-08-28: Milestone 09's plan resolved "whether derived edges feed
  layout" with the `dataflowInLayout` toggle, off by default, noting the
  toggle "lets us try the other behavior without a migration". Five commits
  later the trial verdict is in: neither position of a single on/off toggle
  is right, because force, distance, and visibility deserve separate
  answers. This plan's budget model is that verdict, recorded properly.
