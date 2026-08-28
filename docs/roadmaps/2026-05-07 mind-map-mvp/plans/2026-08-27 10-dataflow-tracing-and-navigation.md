# Plan: Dataflow tracing and navigation

**Created:** 2026-08-27
**Author:** Cursor agent
**Milestone:** [milestones/10-dataflow-tracing-and-navigation.md](../milestones/10-dataflow-tracing-and-navigation.md)
**Status:** draft
**Total estimated effort:** L (11 tasks, five waves)

## Summary

Turns the milestone 09 dataflow layer from something you look at into something
you follow: select a quantity and see it everywhere, walk a dependency chain in
either direction, jump to a definition, and review every quantity in one panel.
Most of the work is mapping the dataflow graph onto the query roles that
milestone 05 already renders, rather than building new rendering.

## Open questions resolved

- **Sigil collision in the query language.** **Add a third marker, `~`, in a new
  `quantityMarker` field consumed only by `graphQuery.ts` — not by
  `titleSyntax.ts`.** `#`, `@`, `"`, `+`, and `-` are taken by the query grammar
  and `$` by math, and `~` is rare in prose so it costs bare-text search almost
  nothing. Keeping it out of `TagSyntaxConfig`'s title path matters: both parsers
  share that type today, so widening it would silently make `~` meaningful inside
  node titles, which no one asked for.

- **Trace versus active query.** **A trace layers over the query. Query exclusion
  still wins, trace roles beat query roles on traced elements, and everything
  untraced drops to background for the duration.** Exclusion is the one role the
  user set deliberately to remove something, so a trace resurrecting it would
  overrule an explicit instruction. Layering rather than replacing means the
  search you built stays intact when you let the trace go.

- **Discoverability without hover.** **Two entry points at two scales: quantity
  chips and the panel at graph scale, tappable glyphs only inside focus mode.**
  Chips are already node-sized targets and already name exactly the quantities
  worth tracing, so the canvas needs no new affordance and equations do not
  become a field of buttons. See the ASK USER item below.

- **Tap targets inside scaled math.** **Resolved by the decision above rather
  than by growing hit areas.** A glyph at graph scale can be under a pixel, and
  no honest hit-target padding survives that; inside focus the same glyph renders
  at readable size where a padded target clears the 32px minimum in
  `hitTest.ts`. Attempting canvas-scale glyph selection would mean invisible
  targets overlapping each other on any dense equation.

- **Traces can span hidden nodes.** **A trace assigns roles to hidden
  participants and reports how many there are, and never reveals them by
  itself.** The milestone requires that tracing never mutate graph data, and the
  only existing way to bring a node into the neighborhood, `revealNode`, pins it
  — which is a mutation that persists. So revealing stays an explicit action the
  user takes from the trace summary, not a side effect of tracing.

- **Closure cost on large graphs.** **Lazily per trace, memoized against the
  identity of the quantity index.** Only one trace is active at a time, so eager
  whole-graph closure would compute thousands of results to use one. The index is
  already memoized per node from milestone 09, so its identity is a sound cache
  key.

- **Transient state ownership.** **Component `$state` in `Multigraph.svelte`,
  beside the existing query state.** Query state already proves the pattern: it
  lives there, is never written to `MultigraphData`, and is torn down by
  `closeOverlays()`. The focus stack is about focus depth, not selection, so
  trace state does not belong in it.

### ASK USER

- **Glyph selection limited to focus mode.** The milestone's wording is
  "selecting a rendered quantity anywhere in a description", which could be read
  as including the canvas. The tap-target argument above says that cannot work at
  graph scale, so this plan restricts glyph tapping to focus and covers the
  canvas with chips and the panel. Confirm that reading before T06 starts, since
  it also decides whether T01 is needed at all.

## Out of scope (for this plan)

- Numeric evaluation, units, and every other non-goal listed in the milestone.
- Renaming a quantity across the graph, and any other dataflow-driven mutation.
- Auto-layout that arranges nodes into dependency order.
- A user-facing control for milestone 09's `dataflowInLayout` prop. It needs a
  persisted setting, so it belongs with whatever milestone owns the settings
  surface.
- Undo/redo for trace state.

## Tasks

### T01 — Add an annotated math render path that gives symbols DOM identity

|                |                                                                                   |
| -------------- | --------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                 |
| **Wave**       | 1                                                                                 |
| **Agent**      | high-reasoning                                                                    |
| **Effort**     | M                                                                                 |
| **Files**      | `MathText/lib/mathRender.ts`, `mathRender.spec.ts`, `MathText/lib/mathSymbols.ts` |
| **PR title**   | `feat(math): render quantity symbols with stable data attributes`                 |

Today `renderMath` hands the same cached tree to every caller and `MathText`
injects one opaque blob per segment, so nothing downstream can address a single
symbol. Add a render path that stamps each quantity symbol with its canonical key
before serializing, reusing the milestone 09 walkers so the key here and the key
in the index cannot drift apart.

The cache is the trap. The existing key is
`displayMode|maxSizeEm|maxSizePt|maxExpand|expression`, and annotated output must
not be served to unannotated callers or vice versa, so the annotation setting
must be part of the key. The `MathNode` interface is readonly and its results are
shared, so annotate during a fresh render rather than mutating a cached tree.

**Acceptance**

- A symbol carries a `data-quantity-key` matching the key `mathSymbols.ts`
  produces for it; specs assert the two agree for subscripts and Greek letters.
- Unannotated rendering is byte-identical to today, asserted directly.
- Cache specs cover that annotated and plain renders of the same expression do
  not evict or shadow each other.
- Numbers, operators, and function names get no attribute.

### T02 — Compute upstream and downstream transitive closure with depth

|                |                                                                  |
| -------------- | ---------------------------------------------------------------- |
| **Depends on** | —                                                                |
| **Wave**       | 1                                                                |
| **Agent**      | default workhorse                                                |
| **Effort**     | M                                                                |
| **Files**      | new `Multigraph/lib/dataflowClosure.ts` and spec                 |
| **PR title**   | `feat(multigraph): add upstream and downstream dataflow closure` |

From a node, walk the derived edges to every transitive ancestor and descendant,
labelling each with its hop depth so a long chain can be drawn as a gradient
rather than a blob. Breadth-first, so a node reached by two paths keeps its
shortest depth.

Cycles must terminate rather than loop. Milestone 09's diagnostics already run
Tarjan's iteratively for exactly this reason on 5000-node fixtures; match that
robustness rather than recursing.

**Acceptance**

- Specs cover a chain at least three deep, a diamond where two paths reconverge,
  a cycle, a node with no dataflow at all, and a disconnected quantity.
- Depth is the shortest path, pinned by the diamond fixture.
- The traced node itself is depth 0 and appears in neither direction's results.
- A 5000-node chain terminates without exhausting the stack.

### T03 — Map a trace onto query roles and compose it with an active query

|                |                                                          |
| -------------- | -------------------------------------------------------- |
| **Depends on** | T02                                                      |
| **Wave**       | 2                                                        |
| **Agent**      | high-reasoning                                           |
| **Effort**     | M                                                        |
| **Files**      | new `Multigraph/lib/dataflowTrace.ts` and spec           |
| **PR title**   | `feat(multigraph): map dataflow traces onto query roles` |

Produce `nodeStateById` and `edgeStateById` in the same shape
`evaluateGraphQuery` returns, so the renderer needs no new concepts: the definer
spotlights, consumers focus, carrying edges emphasize, everything else recedes.
Then compose that with an active query under the precedence decided above —
exclusion wins, trace beats query on traced elements, untraced falls to
background.

Keep composition a separate pure function from trace construction. They fail
differently and the precedence rule is the part most likely to be revised.

**Acceptance**

- Specs cover tracing a quantity with one definer, with several definers, and
  with none.
- Specs cover each precedence pair, including that a query-excluded node stays
  excluded under an active trace.
- Composition returns the query result unchanged when no trace is active,
  asserted by identity so the no-trace path allocates nothing.
- Depth from T02 maps to a role, and the mapping is pinned rather than inferred.

### T04 — Parse a quantity token in the graph query grammar

|                |                                                                   |
| -------------- | ----------------------------------------------------------------- |
| **Depends on** | —                                                                 |
| **Wave**       | 1                                                                 |
| **Agent**      | default workhorse                                                 |
| **Effort**     | S                                                                 |
| **Files**      | `lib/graphQuery.ts`, `graphQuery.spec.ts`, `appConfig.ts`         |
| **PR title**   | `feat(query): add a configurable quantity token to graph queries` |

Add `~name` alongside `#nodeTag` and `@edgeTag`, supporting the existing `+` and
`-` modes so a quantity spotlights, focuses, or excludes like anything else. The
marker is configurable and read only by the query parser.

The care point is bare text. Tokens currently read until whitespace, a tag
marker, `+`, or `-`, so introducing a marker changes how an unquoted word
containing it splits. Quoted text must remain an escape hatch.

**Acceptance**

- Specs cover `~g`, `+~g`, `-~g`, and a custom marker.
- A spec asserts `"a~b"` in quotes still parses as one text token.
- A spec asserts node titles are unaffected, guarding the decision to keep the
  marker out of `TagSyntaxConfig`.

### T05 — Hold trace state in Multigraph and clear it on the query's paths

|                |                                                         |
| -------------- | ------------------------------------------------------- |
| **Depends on** | T03                                                     |
| **Wave**       | 3                                                       |
| **Agent**      | default workhorse                                       |
| **Effort**     | M                                                       |
| **Files**      | `Multigraph.svelte`, `Multigraph.stories.svelte`        |
| **PR title**   | `feat(multigraph): hold and clear dataflow trace state` |

Add the active trace as component `$state` beside the query state, feed the
composed roles into the existing render chain, and clear it everywhere an active
search clears, including `closeOverlays()` and Escape.

**Acceptance**

- A story asserts the trace never reaches `onMultigraphChange`, which is the
  milestone's no-mutation criterion at the boundary that matters.
- A story asserts a graph with no math gains no new affordances.
- Clearing restores the pre-trace query rendering exactly.

### T06 — Make quantity glyphs selectable inside focus mode

|                |                                                                       |
| -------------- | --------------------------------------------------------------------- |
| **Depends on** | T01, T05                                                              |
| **Wave**       | 4                                                                     |
| **Agent**      | default workhorse                                                     |
| **Effort**     | M                                                                     |
| **Files**      | `MathText/MathText.svelte`, `NodeDetailsContent.svelte`, stories      |
| **PR title**   | `feat(math): trace a quantity by tapping it in a focused description` |

Turn annotated symbols into tap targets in focus, with a resting affordance so
they read as interactive without hover.

**Acceptance**

- A story taps a glyph and asserts the trace starts.
- Tap targets clear the 32px minimum from `hitTest.ts` at focus scale.
- Works on `pointerup` with no hover dependency.
- Math in an unfocused node gains no attributes and no listeners.

### T07 — Start a trace from a quantity chip

|                |                                                           |
| -------------- | --------------------------------------------------------- |
| **Depends on** | T05                                                       |
| **Wave**       | 4                                                         |
| **Agent**      | fast/cheap                                                |
| **Effort**     | S                                                         |
| **Files**      | `Node/NodeCompactContent.svelte`, `Multigraph.svelte`     |
| **PR title**   | `feat(node): start a dataflow trace from a quantity chip` |

Chips are the canvas-scale entry point. They are currently
`pointer-events: none` on purpose, because hit testing is geometric and a
swallowing chip reads as a dead zone; making them interactive has to preserve
dragging the node from anywhere else.

**Acceptance**

- A story starts a trace from a chip.
- A story drags the node from over a chip and asserts the drag still works.

### T08 — Walk upstream and downstream from the node action menu

|                |                                                                |
| -------------- | -------------------------------------------------------------- |
| **Depends on** | T02, T05                                                       |
| **Wave**       | 4                                                              |
| **Agent**      | default workhorse                                              |
| **Effort**     | S                                                              |
| **Files**      | `NodeActionMenu.svelte`, `Multigraph.svelte`, stories          |
| **PR title**   | `feat(multigraph): trace dependencies upstream and downstream` |

**Acceptance**

- Stories cover both directions on a chain at least three deep and correct
  termination on a cycle.
- Depth is visually distinguishable, asserted through a data attribute.
- Entries are hidden for a node with no dataflow.

### T09 — Jump from a reference to its definer

|                |                                                          |
| -------------- | -------------------------------------------------------- |
| **Depends on** | T05                                                      |
| **Wave**       | 4                                                        |
| **Agent**      | default workhorse                                        |
| **Effort**     | S                                                        |
| **Files**      | `Multigraph.svelte`, stories                             |
| **PR title**   | `feat(multigraph): jump from a reference to its definer` |

Reuse `fitViewRequest` with the bounds of the definer, which is how query region
navigation already moves the camera, rather than adding a second way to move the
viewport. A definer outside the neighborhood still has a layout position, so
fitting bounds reaches it without pinning it.

**Acceptance**

- A story jumps to a definer outside the visible neighborhood.
- The jump leaves the graph unchanged; only view state moves.
- The user can get back, and a story asserts it.

### T10 — Add the quantities panel

|                |                                                                            |
| -------------- | -------------------------------------------------------------------------- |
| **Depends on** | T02, T03, T05                                                              |
| **Wave**       | 5                                                                          |
| **Agent**      | default workhorse                                                          |
| **Effort**     | M                                                                          |
| **Files**      | new `Multigraph/QuantitiesPanel.svelte` and stories, `Multigraph.svelte`   |
| **PR title**   | `feat(multigraph): add a quantities panel with diagnostics and navigation` |

Follow `GraphQueryPanel`'s anchored-overlay pattern rather than
`TagColorLegend`'s modal one: this is a review surface you consult while looking
at the graph, so blocking the canvas would defeat it. Reuse the milestone 09
diagnostics rather than recomputing them.

**Acceptance**

- A story asserts quantities list with definer, consumer count, and diagnostic
  state, and that an entry navigates.
- Mutual exclusion with the other overlays holds, matching `closeOverlays()`.
- An empty graph and a math-free graph both render an honest empty state.

### T11 — Add a dataflow-only view

|                |                                                   |
| -------------- | ------------------------------------------------- |
| **Depends on** | T05                                               |
| **Wave**       | 5                                                 |
| **Agent**      | fast/cheap                                        |
| **Effort**     | S                                                 |
| **Files**      | `Multigraph.svelte`, stories                      |
| **PR title**   | `feat(multigraph): add a dataflow-only view mode` |

Hide authored edges so the computation structure reads on its own. Milestone
09's split between `renderGraph` and `adjacencyGraph` already makes this a
filter on what is drawn.

**Acceptance**

- A story asserts authored edges hide and derived edges remain.
- The mode is visibly active and leaves on Escape.
- Layout does not shift on entering or leaving, since only drawing changes.

## Wave plan

```
Wave 1   T01  ‖  T02  ‖  T04     (independent; T01 in MathText, T02 new file,
                                  T04 in graphQuery)
Wave 2   T03                     (needs T02's closure)
Wave 3   T05                     (integration point; every later task reads it)
Wave 4   T06  ‖  T07  ‖  T08  ‖  T09
Wave 5   T10  ‖  T11
```

Wave 4 has four tasks touching `Multigraph.svelte`. They are separable but not
free: T07, T08, and T09 each add a handler, so run them in sequence within the
wave or expect to resolve conflicts. T06 is the only one that stays out of that
file.

T01 is in wave 1 rather than blocking on the ASK USER item so the wave is not
idle, but it should not merge before that question is answered — if glyph
selection is dropped, T01 and T06 both disappear.

## Risks and rollback

- **T01 poisons the render cache.** Annotated and plain output sharing a key
  would corrupt every equation in the app, not just traced ones. The cache key
  change and its spec land in the same PR, and the byte-identical assertion on
  unannotated output is the tripwire.
- **T03's precedence rule turns out to feel wrong in practice.** It is a pure
  function with pinned specs, so revising it is a contained change. Do not let
  precedence leak into components, or it stops being revisable.
- **T05 becomes a bottleneck.** Everything in waves 4 and 5 depends on it. Give
  it a focused review before wave 4 starts rather than after four PRs have built
  on its shape.
- **Trace state leaking into persistence.** The failure would be silent and would
  corrupt saved graphs. T05 asserts at the `onMultigraphChange` boundary rather
  than trusting the layering.
- **`revealNode` being reused for tracing.** It pins, which persists, and would
  quietly break the no-mutation criterion. If a task needs to show a hidden node,
  it moves the camera instead.

## Definition of Done (this plan)

- All 11 tasks merged to `main`.
- The milestone's acceptance criteria are satisfied.
- Plan status `done`, milestone status `complete`, roadmap row `complete` with a
  link back to this plan.
- The offline shell is rebuilt and its size change reported.

## Notes

- 2026-08-27: Written straight after milestone 09 landed. Two deferrals from that
  milestone land here: T01 is the annotated render path 09 deferred, and the
  `dataflowInLayout` control is explicitly still out of scope.
- 2026-08-27: Survey found no single-tap callback on nodes anywhere in the app —
  `Stage` records a tap only to detect double-clicks. If any task wants a plain
  tap on a node, it is adding that callback, not reusing one.
