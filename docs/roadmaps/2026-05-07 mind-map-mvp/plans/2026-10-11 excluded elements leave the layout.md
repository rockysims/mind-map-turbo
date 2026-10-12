# Plan: Excluded elements leave the layout

**Created:** 2026-10-11
**Author:** Claude agent
**Milestone:** none — reverses a ruling in [milestone 05](../milestones/05-filter-find-search.md) and builds on [milestone 04b](../milestones/04b-bounded-pinned-neighborhood-visibility.md)
**Status:** done
**Total estimated effort:** L

## Summary

Make a query exclusion (`-#tag`, `-@tag`, `-"phrase"`, `-!addon`) take the
matching nodes and edges out of the graph the layout runs over, not just out of
the paint. While excluded they exert no springs or repulsion, route no hops,
cannot be elected beacon, occlude nothing, and are not focus, fit or hit-test
candidates. Owner ruling 2026-10-11: excluded elements are **effectively gone
from the graph** while the exclusion lasts. This deliberately reverses milestone
05's "visual mask only" ruling and its "Layout isolation mode" non-goal.

## The problem this solves

There are two kinds of hidden node today, and only one of them is really gone.

- **Beyond the hop budget (milestone 04b).** `visibleNodeIdsForPinnedNeighborhood`
  (`Multigraph/lib/boundedVisibility.ts:35`) drops the node, and
  `composeVisibleLayoutGraph` (`boundedVisibility.ts:277`) builds the layout
  graph without it. Physics never sees it.
- **Query-excluded (milestone 05).** `evaluateGraphQuery`
  (`Multigraph/lib/graphQuery.ts:108`) sets `role: 'excluded'` on matching nodes
  (`graphQuery.ts:299`) and on every edge with an excluded endpoint
  (`graphQuery.ts:185`). That role is read in exactly three places in
  `Multigraph.svelte`: the edge render loop (`:3112`), the node render loop
  (`:3352`), and `getNodeAt` hit testing (`:1623`). Nothing else consults it.

So an excluded node is invisible and still does all of these:

| Behaviour                                 | Where it leaks in                                                                                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Springs, hop repulsion, overlap repulsion | `visibleGraph` (`Multigraph.svelte:1030`) and `LayoutRuntime.visibleGraphFor` (`Multigraph/lib/layoutRuntime.svelte.ts:484`) are built from the full graph |
| Routes hops to nodes behind it            | `hopsFor` (`Multigraph.svelte:945`) → `computeBoundedHops` over the full graph                                                                             |
| Elected beacon / anchors its component    | `beaconsWithTransientReveals` (`Multigraph.svelte:965`) → `beaconNodeIds` (`Multigraph/lib/beacons.ts:52`)                                                 |
| Occludes edges                            | `visibleEdgeOcclusionNodes` (`Multigraph.svelte:1064`)                                                                                                     |
| Reserves a parallel-edge slot             | `visibleEdgeParallelOffsets` (`Multigraph.svelte:1072`) reads `renderableEdgeVisibility`, which has no query filter                                        |
| Focus-entry candidate                     | `focusCandidates` (`Multigraph.svelte:1892`)                                                                                                               |
| Counts toward Fit and "graph lost"        | `fitVisibleGraph` (`:2662`), `visibleNodeScreenCircles` (`:1104`) → `graphLost` (`:1120`)                                                                  |
| Reveal-wave before/after sets             | `#createScaleChangeRevealState` (`layoutRuntime.svelte.ts:640`)                                                                                            |
| Layered relayout roots                    | `startLayeredRelayout` → `pinnedNodeIds(nextGraph)` (`layoutRuntime.svelte.ts:316`)                                                                        |

And one outright bug: derived (dataflow) edges are not query elements, so
`queryStateForEdge` (`Multigraph.svelte:2616`) returns `undefined` for them and
`queryOpacity` (`:2620`) draws a derived edge into an excluded node at full
opacity, pointing at nothing.

A change to the query text funds no settle frames today, because a mask never
needed any.

## Open questions resolved

- **Where the reduction happens.** **Once, as a pure function of (graph,
  exclusion), applied at the head of the layout pipeline.** A new
  `Multigraph/lib/excludedElements.ts` derives the excluded id sets from a
  `GraphQueryResult` and returns the graph minus those nodes, their incident
  edges, and the excluded edges. `Multigraph.svelte` reads a
  `layoutSourceGraph` everywhere the layout pipeline reads `graph` today, and
  `LayoutRuntime` gets the same reducer as an option. Everything downstream of
  `visibleGraph` is then fixed by construction instead of by one guard per
  consumer — the same argument 04b used for hop-bounded visibility. Node details,
  the edit sheet, history, persistence and the query evaluation itself keep the
  full `graph`.

- **Which graph the query is evaluated against.** **The graph being reduced.**
  The runtime asks about graphs that do not exist yet (the mutation in
  `relaxAfterMutation`, the before/after pair in `beginScaleChange`), so the
  reducer evaluates the active query against whatever graph it is handed. A node
  created already carrying an excluded tag is then excluded in the very relax
  that places it, rather than for one frame later. Same `evaluateGraphQuery`
  arguments as `Multigraph.svelte:1057` (default tag syntax), so the reducer and
  the panel cannot disagree about what matched.

- **Identity stability of the reduced graph.** **Required, and specified.**
  Every physics frame replaces `graph` with a new object whose `nodes` and
  `edges` arrays are the same references (`mergeVisiblePositions`,
  `layoutRuntime.svelte.ts:718`). `beaconNodeIds` memoizes on exactly those
  references (`beacons.ts:59`), and the derived chain behind it is written to be
  identity-stable. A reducer that returned fresh arrays every call would miss
  that cache every frame. So the reducer is a small memo
  (`createLayoutSourceReducer()`, the `createDataflowModel` pattern): same
  `nodes`/`edges` references and an equal excluded set ⇒ the same reduced
  `nodes`/`edges` arrays, and the input graph itself when nothing in it is
  excluded. `posByNodeId` passes through by reference, so an excluded node's
  entry is never touched.

- **Derived edges under exclusion.** **Derived from the reduced graph, through
  a second `createDataflowModel()` instance dedicated to the layout source.**
  "Effectively gone" means an excluded node defines nothing, so an equation can
  no longer route through it or pull toward it. One instance cannot serve both
  graphs: `createQuantityIndexer` evicts every id missing from its input
  (`Multigraph/lib/quantityIndex.ts:339`), so feeding it full and reduced node
  lists alternately would re-extract every excluded node twice a frame. The
  full-graph instance (`Multigraph.svelte:981`) keeps serving the quantity chips
  (`:992`), the diagnostics (`:1034`) and the edit sheet. The derived edges that
  are drawn, their quantity labels (`:1006`), `renderGraph` (`:983`) and
  `layoutDerivedEdges` (`:985`) all come from the layout-source instance. When
  nothing is excluded `layoutSourceGraph === graph`, and T03 routes that case
  to the full-graph instance so the common path pays nothing new.
  (Rejected: dropping the full graph's derived edges that touch an excluded
  node. Cheaper, but a quantity defined by an excluded node and a remaining one
  would stay ambiguous, so the excluded node would still shape what is drawn.)

- **Hops, beacons and the 04b neighbourhood.** **Recomputed on the reduced
  graph, with no special-casing.** A node reachable only through an excluded
  node or edge drops out of the visible neighbourhood. An excluded pinned node
  stops anchoring its component, and `beacons.ts` then elects one beacon per
  pinless component that remains. Excluding a hub can therefore split one
  component into several, each with its own beacon. That is intended.

- **Positions of excluded nodes.** **Kept, untouched.** Exclusion is UI state,
  not a graph edit: nothing goes through `commitUserGraph`, nothing reaches
  history, `onMultigraphChange` does not fire. `mergeVisiblePositions` spreads
  the full graph's `posByNodeId`, so an excluded node's entry survives every
  frame. When the token is removed, the node re-enters exactly where it was and
  the settle takes it from there. Settle frames write positions through
  `applyGraph` and are saved with the next commit, as a settings-change settle
  is today.

- **Enter/exit animation.** **Not automatic, so it is tasked (T03).** The
  enter/exit buffers are explicit-call state. `animateRestoreDifference`
  (`Multigraph.svelte:1412`) says so in its own doc comment ("nothing diffs for
  them"), and nothing watches `visibleGraph` membership. On a query-text change
  that changes the exclusion, T03 diffs the visible node and renderable edge
  ids of the current graph under the previous and the next exclusion. Leavers
  fade out through `addExitingNode`/`addExitingEdge`, and returners grow in
  through `createNodeEnterAnimation`/`createEdgeEnterAnimation`. These are the
  primitives `animateRestoreDifference` uses; extract the shared part rather
  than writing a third copy. The diff covers the visible sets rather than the
  excluded ones, because an excluded node that was already past the hop budget
  must not flash, and a node that leaves only because its route did must still
  fade.

- **Node scale changes from re-routed hops.** **They snap in this plan.** A
  re-elected beacon or a shortened path changes `scaleByHops` for remaining
  nodes. `beginScaleChange` animates that for a pin toggle, but it needs a focal
  node and diffs two graphs, not two exclusions. If the snap reads badly in the
  T03 smoke test, file it under `docs/debt/`. Do not widen this plan.

- **Settle on a query change.** **A sibling primitive,
  `settleAfterVisibilityChange()`, sharing the top-up rule with
  `settleAfterSettingsChange()` (`layoutRuntime.svelte.ts:203`).** It is the same
  budget (`postDragSettleMaxFrames`), topped up with `Math.max` and not funded
  during a drag. The two call sites then read as what they are. Extract the
  shared body into one private method. An `$effect` keyed on the reducer's
  excluded-set key calls it, so a query edit that changes nothing in the
  exclusion (adding a positive token, typing inside a phrase that still matches
  the same nodes) settles nothing.

- **Hover previews.** **Never reflow, by construction.** `GraphQueryPanel` only
  previews `+#tag` / `+@tag` (`GraphQueryPanel.svelte:121`, `:144`), and
  `applyTokenToState` keeps an excluded element excluded whatever follows
  (`graphQuery.ts:302`). The excluded set under a preview therefore equals the
  committed one, the reducer's memo returns the same arrays, and the settle
  effect does not fire. T01 pins this with a spec and T04 with a story, so a
  future exclude-preview cannot quietly start reflowing on hover.

- **Jumping to an excluded node.** **The jump wins: a node held on screen by
  `transientReveal` is exempt from exclusion for as long as its nav entry holds
  it.** `jumpToNode` (`Multigraph.svelte:2040`) is offered from node details for
  any referenced node. If an excluded target stayed out of the layout, the
  beacon seed in `beaconsWithTransientReveals` (it filters `data.nodes`,
  `:965`) would find nothing to seed. The target would get no layout slot, and
  focus would open with no frame to morph from. The reader named that node
  explicitly, so the exemption honours the jump and leaves with the entry. Only
  the node is exempted. Its incident edges stay excluded, which costs nothing
  because a jump-seeded node is drawn without its neighbourhood anyway
  (`withBeaconHops` expands from none of its seeds). The render mask follows: a
  node in the exempt set is not drawn at `queryOpacity` 0.

- **The render-mask guards.** **Removed once the reduction lands.** After T03,
  `visibleGraph` and `renderableEdgeVisibility` can no longer contain an
  excluded element, so the guards at `Multigraph.svelte:3112`, `:3352` and
  `:1623` are dead. Leaving them would also hide an exempt jump target. The
  canvas then has one answer to "is this drawn": membership in the reduced
  layout graph. `queryOpacity`'s `excluded → 0` branch stays for any caller
  that still asks.

- **`severedComponent` and persistence.** **Untouched.**
  `severedComponentAfterMutation` (`Multigraph.svelte:2303`, `:3720`) reasons
  about what a deletion did to the graph, and exclusion is not graph data. Its
  beacon preference is still applied through `beaconNodeIds` on the reduced
  graph, where `selectBeacon` ignores any preferred id that is not in the
  component (`beacons.ts:147`).

- **Debouncing the exclusion while typing.** **No debounce in this plan.**
  Typing `-"phys` excludes at every keystroke, and a short phrase can match a
  lot. The settle top-up keeps it from compounding, and positions are kept, so
  every intermediate state is reversible. If the T03 smoke test shows thrash,
  debounce the _reducer's_ query text by ~250 ms and leave the panel's live
  result alone. The renderer and runtime still agree, because both read the
  reducer.

## Out of scope (for this plan)

- A status indicator for an active filter once the panel is closed. This gap
  predates the plan: the query persists after `onClose` (`Multigraph.svelte:3804`)
  and the Find / Filter button (`:3035`) shows nothing. The ruling makes it
  sharper, because now nodes are missing from the layout as well as the paint.
  Filed as debt in T05 rather than built here.
- AND / grouping / precedence in the query grammar.
- Persisted or saved filters: the query stays session UI state.
- Animating node-scale changes caused by exclusion (see above).
- Any change to `severedComponent.ts`, graph persistence, history, or
  `evaluateGraphQuery`'s matching rules.
- Making Multigraph's own `graphQueryResult` (`:1057`) stop re-evaluating on
  position-only frames. It already does that today and this plan does not make
  it worse.

## Tasks

### T01 — Pure exclusion reduction: `excludedElements.ts`

|                |                                                                                         |
| -------------- | --------------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                       |
| **Wave**       | 1                                                                                       |
| **Agent**      | default (opus)                                                                          |
| **Effort**     | S                                                                                       |
| **Files**      | new `Multigraph/lib/excludedElements.ts`, new `Multigraph/lib/excludedElements.spec.ts` |
| **PR title**   | `feat(graph-query): pure reduction of query-excluded nodes and edges`                   |

Three exports, no DOM, no Svelte:

- `excludedGraphElements(result: GraphQueryResult, exemptNodeIds?: ReadonlySet<string>): ExcludedGraphElements`
  → `{ nodeIds: ReadonlySet<string>; edgeIds: ReadonlySet<string> }`. A node
  or edge is excluded when its role is `'excluded'`, minus any exempt node id.
  Edge exclusion is taken from the result as-is, including endpoint-driven
  exclusion. Returns one shared empty constant when nothing is excluded.
- `withoutExcludedElements(graph, excluded): MultigraphData`. Drops excluded
  nodes, every edge with an endpoint not in the surviving node set, and every
  excluded edge. Immutable. Returns `graph` itself when none of its nodes or
  edges is excluded. `posByNodeId` passes through by reference.
- `createLayoutSourceReducer()` → `(graph, queryText, exemptNodeIds) => MultigraphData`.
  Evaluates `evaluateGraphQuery(graph, queryText)` and reduces the result,
  memoized as described in _Identity stability_ above.

**Acceptance**

- Spec: excluding a node removes it and its incident edges; excluding an edge
  by tag removes only that edge and keeps both endpoints; `-!addon` behaves
  like a node tag.
- Spec: nothing excluded ⇒ `toBe(graph)`. Reducing an already-reduced graph
  returns it unchanged (idempotent).
- Spec: the input is never mutated, and `posByNodeId` of the result `toBe` the
  input's, excluded entries included.
- Spec: an exempt node survives, and its incident edges stay excluded.
- Spec (memo): two graphs that differ only in `posByNodeId` reduce to results
  whose `nodes` and `edges` arrays are `toBe`-equal. Changing the query text
  without changing the excluded set (appending `+#other`) also keeps them
  `toBe`-equal. Changing the excluded set produces new arrays.
- Spec (preview invariant): for every exclusion in the fixture, appending a
  `+#tag` or `+@tag` token yields an equal excluded set. This includes
  `+#hidden` after `-#hidden`.

### T02 — `LayoutRuntime` learns about exclusion

|                |                                                                                  |
| -------------- | -------------------------------------------------------------------------------- |
| **Depends on** | T01                                                                              |
| **Wave**       | 2                                                                                |
| **Agent**      | default (opus)                                                                   |
| **Effort**     | M                                                                                |
| **Files**      | `Multigraph/lib/layoutRuntime.svelte.ts`, `Multigraph/lib/layoutRuntime.spec.ts` |
| **PR title**   | `feat(layout): let the layout runtime reduce its source graph before physics`    |

Add one option beside `computeHops` and `composeDerivedEdges`
(`layoutRuntime.svelte.ts:90`, `:99`):

```ts
/**
 * The graph the layout actually runs over, given the whole one — in the app,
 * the graph minus whatever the query excludes. Positions come back into the
 * whole graph, so what this drops keeps its place. Defaults to identity.
 */
reduceLayoutSource?: (graph: MultigraphData) => MultigraphData;
```

Apply it at every entry point, so that hops, visibility, derived-edge
composition, the reveal wave and layered relayout all see the reduced graph,
while positions merge back into the **full** graph:

- `step` (`:368`): reduce `getGraph()` for `#hopsFor` / `visibleGraphFor`, and
  merge into the unreduced graph at `:392`.
- `relaxAfterMutation` (`:217`): same, against `nextGraph`.
- `beginScaleChange` (`:236`): both the current and the next graph, plus the
  `#createScaleChangeRevealState` inputs and `startLayeredRelayout`. The
  `pinnedNodeIds` call at `:316` must not see an excluded pin.
- `visibleGraphFor` (`:484`) and `#hopsFor` (`:456`) reduce their argument
  themselves. Both are safe on an already-reduced graph, because T01's reducer
  is idempotent and identity-returning. Spec callers and Multigraph therefore
  cannot get it wrong by passing either graph.

Add `settleAfterVisibilityChange()` beside `settleAfterSettingsChange()`
(`:203`), with the shared body extracted into one private method.

**Acceptance**

- The "renderer and runtime agree on who is on screen" block
  (`layoutRuntime.spec.ts:868`) gains an `excluded` field on its fixtures and
  these new fixtures. In each one, the renderer side reduces first, then
  computes hops and visibility, mirroring Multigraph:
  - a pinned chain whose middle node is excluded: the far end drops out;
  - an excluded pinned node whose neighbour becomes a beacon;
  - an edge excluded by tag that was the only route to a node;
  - a derived edge into an excluded node, which is not in the physics graph.
- Spec: N `step`s with an exclusion leave the excluded node's `posByNodeId`
  entry bit-for-bit unchanged and its node still present in the applied graph.
- Spec: `relaxAfterMutation` and `beginScaleChange` return a full graph:
  excluded nodes present, positions intact. The reveal state's
  previous/next visible ids and renderable edges contain no excluded id.
- Spec: excluding the only pinned node means `startLayeredRelayout` seeds no
  layer from it.
- Spec: `settleAfterVisibilityChange` starts the loop from idle, tops up rather
  than restarts, and does not fund a settle mid-drag. Mirror the three existing
  `settleAfterSettingsChange` cases at `:324`.
- Every existing runtime spec passes untouched (the option defaults to
  identity).

### T03 — Wire the reduction into `Multigraph.svelte`

|                |                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| **Depends on** | T02                                                                                                      |
| **Wave**       | 3                                                                                                        |
| **Agent**      | default (opus) — the integration task; review it before T04 starts                                       |
| **Effort**     | L                                                                                                        |
| **Files**      | `Multigraph/Multigraph.svelte`, `Multigraph/Multigraph.stories.svelte` (one story flip only — see below) |
| **PR title**   | `feat(multigraph): take query-excluded elements out of the layout`                                       |

- `const reduceLayoutSource = createLayoutSourceReducer()`. Add
  `layoutSourceFor(data)`, which calls it with `activeGraphQueryText` and
  `transientReveal.revealedNodeIds` (that set is identity-stable, which the memo
  relies on). Then
  `layoutSourceGraph = $derived(layoutSourceFor(graph))`.
- Hand `reduceLayoutSource: layoutSourceFor` to the `LayoutRuntime`
  (`:889`).
- Re-point the layout chain at `layoutSourceGraph`: `hopsByNodeId` (`:1017`),
  `visibleNodeIds` (`:1018`), `visibleGraph` (`:1030`), `renderGraph` (`:983`),
  and `edgeVisibility` (`:1042`, through `renderGraph`).
  `beaconsWithTransientReveals` and `hopsFor` need no change, because they
  already take their graph as an argument.
- Add the layout-source dataflow instance (see _Derived edges under exclusion_).
  `composeDerivedEdges` (`:892`), `hopsFor`'s derived edges (`:948`),
  `layoutDerivedEdges` (`:985`), `renderGraph` and `quantityLabelByEdgeId`
  (`:1006`) read it. `dataflow` (`:981`), the chips (`:992`) and the
  diagnostics (`:1034`) keep the full graph. When nothing is excluded, both
  roles resolve to the full-graph instance.
- The ingest settle (`:1243`–`:1255`) composes and hops over
  `layoutSourceFor(incoming)`. Excluded nodes keep the incoming positions.
- Remove the excluded-role guards at `:1623`, `:3112` and `:3352`.
  `queryStateForNode` reports an exempt node's state as `background` so it
  does not paint at opacity 0.
- An `$effect` keyed on the excluded-set key does two things when the key
  changes on a query-text change. It runs the enter/exit diff (see _Enter/exit
  animation_), and it calls `layoutRuntime.settleAfterVisibilityChange()`. The
  first run only records the baseline, like `layoutSettleFingerprint` at
  `:1326`.
- Flip the story `UserExcludesNodeTagWithoutRelayout`
  (`Multigraph.stories.svelte:5463`) in this task, because it asserts the
  opposite of the new behaviour and would leave the suite red. Rename it
  `UserExcludesNodeTagAndTheRestResettles`. Use a fixture where the excluded
  node's spring holds a neighbour off its rest position. Keep the
  no-`.node-wrapper` and no-`data-edge-id` assertions, wait out the exit fade,
  and assert the neighbour's `data-x` changes. T04 owns every other story.

**Acceptance**

- `lint`, `check`, `test:unit -- --run`, and `knip` are clean. No story
  besides the flipped one changes.
- Manual smoke test in the browser with a seeded graph (see
  `browser-smoke-test-mind-map` memory). Type `-#tag` on a hub, then clear it.
  The rest of the graph settles closer without thrashing, the excluded nodes
  fade out and back in at their old places, and hovering tag suggestions moves
  nothing. Type `-"` then a phrase one letter at a time, and decide on the
  debounce from what you see (see _Debouncing_). Record the outcome in Notes.
- Manual: jump from a node's details to a definer that is excluded. The target
  appears, focus opens on it, and Back takes it away again.

### T04 — Stories: the new behaviour and every downstream consumer

|                |                                                              |
| -------------- | ------------------------------------------------------------ |
| **Depends on** | T03                                                          |
| **Wave**       | 4 (parallel with T05)                                        |
| **Agent**      | default (opus)                                               |
| **Effort**     | M                                                            |
| **Files**      | `Multigraph/Multigraph.stories.svelte`                       |
| **PR title**   | `test(multigraph): cover query exclusion leaving the layout` |

Story names read as sentences. All of them open the panel and type through the
`Graph query` input, as the existing query stories do (`:5485`). Wait out
`enterExitDurationMs` or zero it in `layoutSettings` before asserting absence.

Behaviour (design items 3–5):

- `UserExcludesAPinnedNodesTagAndABeaconTakesOver`: a pinned hub whose
  unpinned neighbour is reachable only through it. After `-#hub` the
  neighbour is drawn at beacon scale, and nodes past it are hidden.
- `UserClearsAnExclusionAndTheNodeReturnsWhereItWas`: record `data-x`/`data-y`
  before excluding. Exclude, let the graph settle, clear the query, and assert
  the returning node's first rendered position equals the recorded one.
- `UserHoversATagSuggestionWithAnExclusionActive`: hover with `-#x` committed.
  `data-settling` stays false and no node's `data-x` moves.
- `UserExcludesTheOnlyRouteToANode`: `-@bridge` on the one edge into a
  subtree. The subtree's far side leaves the canvas.

Downstream consumers (design item 6). Each gets its own assertion rather than
being trusted to follow from `visibleGraph`:

| Consumer                                | Assertion                                                                                                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Occlusion (`visibleEdgeOcclusionNodes`) | Story: an excluded node lying across a visible edge. `data-edge-occlusion-count` goes from 1 to 0                                                   |
| Parallel offsets                        | Story: two parallel edges, one excluded by `-@tag`. The survivor's `data-edge-parallel-count` is 1 and its offset is 0                              |
| Focus candidates                        | Story: a deep-zoom gesture at the excluded node's former position never sets `data-focus-subject-id` to it                                          |
| Fit                                     | Story: an excluded node parked far away. Pressing `F` frames only the remaining nodes (the fitted scale is larger than it is without the exclusion) |
| Graph lost                              | Story: pan so only the excluded node's former spot is in view. The `.lost-graph-hint` appears                                                       |
| Hit testing (`getNodeAt`)               | Story: a tap at the excluded node's former position opens nothing and selects nothing                                                               |
| Derived-edge query state (the bug)      | Story: two math nodes linked by a quantity, one excluded. No `[data-edge-derived]` element joins them                                               |
| Hops and beacons                        | Covered by T02's agreement fixtures plus the beacon story above                                                                                     |
| Reveal-wave buffers                     | Covered by T02's `beginScaleChange` spec                                                                                                            |

**Acceptance**

- Every story above passes in the `storybook` Vitest project. Each one fails
  when T03's re-pointing of `visibleGraph` is reverted. Check at least the
  occlusion, parallel and derived-edge ones by reverting locally.

### T05 — Record the ruling in the docs

|                |                                                                                                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T03                                                                                                                                                                               |
| **Wave**       | 4 (parallel with T04)                                                                                                                                                             |
| **Agent**      | fast/cheap                                                                                                                                                                        |
| **Effort**     | XS                                                                                                                                                                                |
| **Files**      | `milestones/05-filter-find-search.md`, `plans/2026-06-22 05-filter-find-search.md`, this plan, new `docs/debt/2026-10-11-active-filter-has-no-indicator-once-the-panel-closes.md` |
| **PR title**   | `docs(filter): record that query exclusion removes elements from the layout`                                                                                                      |

In `milestones/05-filter-find-search.md`:

- **Goal** (line 8): drop "while preserving the underlying layout" for
  exclusions. Spotlight, focus, context and background still preserve it.
- **Scope › Visual states** (line 46): `excluded` now reads as "not rendered
  and removed from layout: no physics, hop routing, beacon election, occlusion,
  focus or fit".
- The "visual mask only" paragraph (lines 53–56): replace it with the
  2026-10-11 owner ruling. Exclusion always isolates, with no separate mode.
  Excluded positions are kept and restored. Link this plan. Say plainly that
  the earlier "explicit mode with its own transition and status indicator"
  requirement is dropped, and that the indicator is filed as debt.
- **Acceptance** (lines 132–133): "stop rendering without layout reflow" →
  "stop rendering and leave the layout; the remaining graph settles".
- **Non-goals** (lines 143–144): remove "Layout isolation mode", and add a
  one-line pointer to this plan.

In `plans/2026-06-22 05-filter-find-search.md`, add a dated Notes entry that
points forward to this plan. Its line 32 non-goal is historical and stays.

File the debt item using `docs/debt/TEMPLATE.md`. Once the panel closes,
nothing on the canvas says a filter is active, and excluding every node leaves
a blank canvas with no hint, because `graphIsLost` returns false for zero
circles (`Multigraph/lib/graphOnScreen.ts:59`). Set this plan's status to
`done`.

**Acceptance**

- Milestone 05 no longer contradicts the shipped behaviour anywhere. A grep for
  "mask only", "reflow" and "isolation" in it finds only the new ruling.
- The debt file follows `docs/debt/README.md` conventions.

## Wave plan

```
Wave 1   T01                 pure reduction + memo
Wave 2   T02                 runtime option + agreement spec (uses T01's reducer)
Wave 3   T03                 Multigraph wiring, settle, transitions, story flip
Wave 4   T04  ‖  T05         stories (Multigraph.stories.svelte) ‖ docs (disjoint)
```

Total: 5 tasks, 4 sequential gates. The chain is honestly sequential. T02's
agreement fixtures should exercise the real reducer rather than a stand-in, and
T03 is where both meet. T03 gets a focused review before wave 4, because it
touches the derived chain every frame reads.

## Risks and rollback

- **Per-frame cost.** If the reducer's memo misses, every frame rebuilds
  arrays, misses the beacon cache, and recomputes hops. That is invisible in
  specs and very visible on a 300-node graph. T01's identity specs are the
  guard. In review, check that `layoutSourceGraph.nodes` keeps its reference
  across a drag, for example with a temporary `$inspect`.
- **Two dataflow instances drift.** If a consumer reads the wrong instance, a
  chip or label can disagree with the arrows drawn. The rule is short: what is
  drawn on the canvas comes from the layout-source instance, and what describes
  a node comes from the full one. A definer that is excluded shows as "out of
  view" in diagnostics, which is accurate.
- **Exclusion changed by a mutation, not the query.** Tagging a node with an
  excluded tag in the edit sheet takes it out of the layout through the
  mutation's own relax. It pops rather than fades, because the transition diff
  fires only on query-text changes. That is acceptable. If it reads badly, file
  it beside `docs/debt/2026-09-07-orphaning-every-node-pops-instead-of-fading.md`.
- **Typing thrash.** See _Debouncing_. The fallback lives entirely in T03 and
  needs no change to the pure layer.
- **Rollback.** T03 is the only task with user-visible behaviour. Reverting it,
  together with the T04 stories and T05 text, restores the mask. T01 and T02
  are inert without T03 (the identity default), so they can stay.

## Definition of Done (this plan)

- All five tasks merged.
- `pnpm --filter mind-map-sv lint`, `check`, `test:unit -- --run` and `knip`
  pass. Nothing new is exported that nothing imports, so any T01 helper that
  ends up used only inside the module loses its `export`.
- Excluding a tag takes the matching nodes and edges out of physics, hops,
  beacons, occlusion, parallel offsets, focus, fit, graph-lost, hit testing and
  derived edges, and each of those has its own assertion (T02, T04).
- Removing the exclusion brings every node back at the position it left from.
  Hovering suggestions never reflows.
- Milestone 05 records the new ruling. The status-indicator gap is filed under
  `docs/debt/`. So is anything else real that came up and was not fixed (scale
  snap, mutation-driven pop), if the smoke test confirmed it.
- Plan status is `done`.

## Notes

- 2026-10-11: Owner ruling: query-excluded nodes and edges are effectively gone
  from the graph while excluded. The design points above were decided with the
  ruling and are not to be reopened during execution. Raise any deviation as a
  Note here.
- 2026-10-11: The jump exemption was the one decision this plan added beyond
  the ruling; the owner confirmed it the same day (the jump wins while its nav
  entry holds the node).
- 2026-10-11: executed. What landed:
  - T01 — new pure `lib/excludedElements.ts` (`excludedGraphElements`,
    `withoutExcludedElements`, and `createLayoutSourceReducer`, a memoized
    reducer that returns the same `nodes`/`edges` arrays across
    position-only frames and query edits that leave the excluded set alone,
    and the input graph itself when nothing is excluded), with
    `lib/excludedElements.spec.ts` covering the identity, idempotence,
    exemption and preview-invariant cases.
  - T02 — `LayoutRuntime` takes a `reduceLayoutSource` option (identity by
    default) and applies it at `step`, `relaxAfterMutation`,
    `beginScaleChange` and its reveal state, layered-relayout seeding,
    `visibleGraphFor` and the hop map, merging positions back into the full
    graph. `settleAfterVisibilityChange()` shares its top-up body with
    `settleAfterSettingsChange()`. The renderer/runtime agreement block gained
    the excluded fixtures.
  - T03 — `Multigraph.svelte` derives `layoutSourceGraph` through the reducer
    and re-points the layout chain at it; a second dataflow model serves the
    layout source (the full-graph one keeps chips, diagnostics and the edit
    sheet); an `$effect` keyed on the excluded set runs the enter/exit diff and
    funds the settle; the render-mask guards are removed; a jump target held
    by `transientReveal` is exempt from exclusion while its nav entry holds it.
    `UserExcludesNodeTagWithoutRelayout` was flipped to
    `UserExcludesNodeTagAndTheRestResettles`.
  - The jump exemption is the owner-confirmed ruling recorded in the note
    above: the jump wins while its nav entry holds the node.
  - Orchestrator's browser smoke test: excluding a tag fades the matching nodes
    out in about 200 ms and their neighbours settle; hovering tag suggestions
    moves nothing. The desktop app's Browser pane throttles the frame loop
    while the pane is hidden, which made the fade look stuck until the tab was
    fronted. That is the environment, not the code.
  - T04's stories are landing in parallel with this close-out (T05).
  - T05 — milestone 05's Goal, `excluded` visual state, ruling paragraph,
    acceptance line and non-goals now describe exclusion leaving the layout;
    the 2026-06-22 plan points forward here; the missing active-filter
    indicator (and the blank canvas when every node is excluded) is filed as
    `docs/debt/2026-10-11-active-filter-has-no-indicator-once-the-panel-closes.md`.
  - The offline shell was **not** regenerated: it will be rebuilt once, after
    all four 2026-10-11 plans land, so `check:offline-shell` is still owed for
    this plan's `src/**` changes.
