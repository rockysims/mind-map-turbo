# Milestone 11: Unified hop model for derived edges

**Status:** complete
**Depends on:** milestone 09 (variable dataflow layer), milestone 04b (bounded
neighborhood visibility), milestone 02 (hop-distance scaling).
**Plan:** [2026-08-28 11-unified-hop-model-for-derived-edges.md](../plans/2026-08-28%2011-unified-hop-model-for-derived-edges.md)

## Goal

Make a derived dataflow edge differ from an authored edge in exactly one way:
it has its own, smaller visibility budget. A new `dataflowDisplayedLayers`
setting (default 1) says how many hops an equation can reveal, the way
`displayedLayers` already says it for drawn edges. In every other respect —
distance, sizing, physics pull, hop repulsion — a derived edge behaves like an
edge the author drew.

One distance computation produces one hop map, and everything reads it:
visibility, node scale, the reveal wave, and physics. The current architecture
computes hops in four places that must agree by convention, and each of the
last five substantive commits on this feature patched a disagreement between
two of them.

## Why now

A structured review on 2026-08-28 (three independent reviewers plus
verification) traced the recurring dataflow sizing/visibility bugs to one root
cause: the distance metric was never generalized for a second edge type, so
every consumer of hops grew its own bolt-on. The bolt-ons now include a
non-cascading reveal override (`withRevealedNeighborHops`), a separate sizing
re-measure (`withHopsThroughEdges`), beacon selection run over two different
edge sets, a spring-only edge side channel, and a `dataflowInLayout` toggle
gating different subsets of these — plus the entire chain duplicated between
`Multigraph.svelte` and `LayoutRuntime`, held together by a "must agree"
comment. Interactions between bolt-ons grow combinatorially; commits 96e565e,
1fefed6, f0ae896, 2faed60, and c31aa45 each fixed exactly one such pairwise
interaction.

The review also confirmed four live defects this milestone resolves
structurally rather than by patching (reveal wave ignoring derived edges;
fading nodes snapping between sizing and visibility scales; hop repulsion
mostly cancelling the derived-edge spring; a chained equation reintroducing
the boundary-stub arrow), and one it fixes directly (a content edit never
kicks the physics loop, so an equation edit leaves the canvas frozen).

## The model

A node is visible when some path from an origin (pinned node, or beacon of a
pinless authored component) reaches it in the form **authored steps, then
derived steps**:

- Authored steps spend from `displayedLayers`, exactly as today.
- Crossing a derived edge spends the remaining authored budget: after it, only
  further derived steps may follow, up to `dataflowDisplayedLayers` in total.
- Every step, authored or derived, costs one hop for distance and sizing.

Consequences, by construction rather than by defended invariant:

- A node revealed by an equation never brings its drawn neighbors along. "One
  equation cannot drag a cluster into view" becomes a theorem of the path
  grammar.
- Sizing and visibility come from the same number. A node one derived edge
  from a pin sizes like an authored neighbor; a node behind it sizes one
  further out — or is hidden, if reaching it needs a second derived step and
  the budget is 1.
- A derived edge between two already-visible nodes may shorten the farther
  endpoint's hop (sizing it nearer). It never changes visibility.

## Scope

### One bounded-hops computation

- A pure function computing the hop map for a graph plus its derived edges,
  parameterized by `displayedLayers` and `dataflowDisplayedLayers`, seeded
  from pins (hop 0) and beacons (`BEACON_HOP`).
- `Multigraph.svelte` computes it once; `LayoutRuntime` reads the same map
  instead of rebuilding its own chain. `deriveGraphLayout` takes the map
  outright instead of recomputing hops and merging overrides.
- Beacons keep being selected per **authored** component, so a cluster linked
  to another only by an equation keeps its own anchor and cannot vanish.

### Deletions

- `withRevealedNeighborHops` (subsumed as the derived phase of the unified
  computation).
- `withHopsThroughEdges`, `#scaleHopsFor`, `#distanceOriginsFor`, and
  dataflow-joined beacon selection (`BeaconOptions.extraEdges`) — sizing hops
  are visibility hops now.
- The `dataflowInLayout` toggle. Its question ("do derived edges join the
  topology?") dissolves; the knob is `dataflowDisplayedLayers`.
- The spring-only side channel (`composeSpringEdges` / `springEdges`):
  derived edges between visible nodes join the visible layout graph as
  ordinary edges, weighted by `derivedEdgeSpringFactor` (kept, default 1).
  Hop repulsion then sees them as real hops instead of treating the pair as
  infinitely distant and pushing them apart.

### Rendering and interaction rules

- A derived edge renders only when **both** endpoints are visible. No boundary
  stubs toward unreachable nodes, at any budget including 0; the out-of-view
  diagnostic from milestone 09 remains the affordance for a hidden definer.
- Committing a content edit (title or description) relaxes and settles the
  layout when it changes the dataflow layer, the same as structural
  mutations. Today it is the one mutation path that never kicks the physics
  loop, so a revealed node pops in frozen at a stale position and size.
- The pin/unpin reveal wave reasons over the composed (authored + derived)
  edges, so derived arrows fade with the wave instead of snapping.

### Performance

- The dataflow model (index, edges, diagnostics) becomes identity-stable: it
  is a pure function of per-node content, so per-frame position updates must
  not rebuild it. Today it rebuilds several times per animation frame during
  drag and settle.

## Acceptance criteria

- Pure specs cover the unified computation: the path grammar (authored steps
  never follow a derived step), budgets spent independently, hop caps at
  `displayedLayers`, min-relaxation of already-visible endpoints, beacon
  seeding, and the no-pins case.
- The behavior tests that pinned the old mechanisms carry over: a revealed
  node cannot anchor a further authored reveal; one equation reveals at most
  `dataflowDisplayedLayers` nodes per anchor chain.
- Renderer and runtime consume one hop map; the duplicated chain and its
  "must agree" comment are gone.
- Story coverage: an equation edit committed through the real save path (not
  a harness reset) reveals its node with physics settling it into place; a
  revealed node's drawn neighbors stay hidden; a derived edge whose far end
  is not visible does not render; pin/unpin fades derived edges with the
  wave; a fading dataflow-sized node exits at the size it was drawn.
- Two nodes joined only by a derived edge settle at a comparable distance to
  an authored pair (the repulsion/spring tug-of-war is gone), asserted
  numerically in a spec rather than eyeballed.
- Dragging during settle does not rebuild the quantity index (asserted via a
  counting double).
- Graphs with no math are visually and behaviorally unchanged.
- Lint, check, and unit/browser/story tests pass.

## Non-goals

- Fixing symbol-inference correctness (the leaf-text conflict key, the
  permissive definition left-hand side, prime handling). Independent track,
  already scoped as standalone fixes in `MathText/lib/mathSymbols.ts`.
- Any change to what counts as a definition or reference, or to diagnostics
  semantics.
- Exposing `dataflowDisplayedLayers` in a settings UI (joins the settings
  surface whenever that milestone happens; the config value ships now).
- Values of `dataflowDisplayedLayers` above 1 are supported by the model and
  specs but not tuned or given story coverage.

## Risks and open questions

- **Existing graphs with math will visibly re-settle.** Derived edges enter
  hop repulsion and pull at full weight for the first time; pairs that used
  to hover ~30% too far apart will move. Accepted: that distance was the bug.
- **Beacon sizing changes slightly at one boundary.** The old sizing
  re-measure let a _larger_ real distance replace a beacon's flat hop; the
  unified computation only ever relaxes hops downward. The one surviving
  case — a beacon that is a direct derived neighbor of a visible node — now
  sizes at `BEACON_HOP` rather than one hop past its anchor. Accepted as the
  simpler rule; noted here so a future "why is this beacon big" question has
  an answer.
- **The reveal wave code assumes hops it did not compute.** Handing it the
  unified map must not regress unpinned-cluster waves; the plan isolates this
  in its own task with the failing story written first.

## References

- The five commits whose interactions motivated this: 96e565e, 1fefed6,
  f0ae896, 2faed60, c31aa45.
- Mechanisms being replaced: `Multigraph/lib/boundedVisibility.ts`
  (`withRevealedNeighborHops`), `Multigraph/lib/layout.ts`
  (`withHopsThroughEdges`), `Multigraph/lib/layoutRuntime.svelte.ts`
  (`#scaleHopsFor`, `#distanceOriginsFor`, `#effectiveHopsFor`),
  `Multigraph/lib/beacons.ts` (`extraEdges`).
- Milestone 09's "decide whether derived edges participate in hop distance
  and layout" and its `dataflowInLayout` resolution are superseded by this
  milestone (see the amendment there).
