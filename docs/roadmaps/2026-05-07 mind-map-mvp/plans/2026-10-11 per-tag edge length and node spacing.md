# Plan: Per-tag edge length and node spacing

**Created:** 2026-10-11
**Author:** Claude agent
**Milestone:** none — extends [milestone 04f](../milestones/04f-tag-colors-and-graph-tag-config.md) (tag config) and [milestone 02](../milestones/02-layout-and-repulsion.md) (physics)
**Status:** done
**Total estimated effort:** M

## Summary

Let the reader tune the layout per tag from the tag legend: each edge tag gets
an **edge length** slider, which scales the rest-gap band of every edge that
carries it, and each node tag gets a **node spacing** slider, which scales the
extra clearance hop repulsion holds open around every node that carries it.
Factors are graph content stored sparsely next to tag colours, so they ride in
JSON and HTML exports and in `localStorage` with no format bump. Also fixes two
settings-panel sliders whose upper half does nothing.

Paths below are relative to `apps/mind-map-sv/src/lib/components/ui/Multigraph/`
unless they start with `src/`, `scripts/` or `docs/`. Every `file:line` was read
on `feature/graph-tunables` at `cb5371f`.

## Why spring strength is the wrong knob

The physics is position-based relaxation, not a force integrator.
`relaxEdgeDistancesStep` (`lib/physics.ts:220`) holds each edge's gap inside the
band `[radiusSum × edgeGapMinRadiusFactor, radiusSum × edgeGapMaxRadiusFactor]`
(`:255-256`) and moves the endpoints a fraction `edgeStrength` of the way back
into the band per iteration (`:268-274`). Inside the band the correction is
exactly zero.

So **spring strength is a convergence rate, not a rest length.** At equilibrium
an edge at strength 0.2 and one at 1.0 sit at the same distance; strength only
shows where a spring is fighting hop repulsion or overlap removal, and even there
it shifts a compromise rather than setting a length. A per-tag "attraction"
slider wired to `springFactor` would look broken — the reader drags it and the
graph does not change at rest. The visible knob is the band itself, so the edge
slider multiplies both band edges. The same reasoning applies to nodes: the
visible quantity is `extraHopGap` (`:429-442`), the clearance a pair holds open,
not `hopRepulsionStrength`.

How the forces meet, worth knowing before reading the stories:

- `hopRepulsionMinHops` ships as `0` (`src/lib/appConfig.ts:132`) and is clamped
  up to `1` (`lib/physics.ts:139`), so **adjacent pairs are repelled too**. With
  the defaults a hop-1 pair wants an extra gap of `radiusSum × 2 × 1/4 = 0.5 ×
radiusSum` — inside the default edge band `[0.42, 0.84]`, so today the two
  never fight.
- Raising an edge's length moves the band's **lower** edge above that 0.5, so the
  spring pushes the endpoints apart; it works at full effect. Lowering it below
  ~×0.6 puts the band's upper edge under the repulsion target, and the
  push-only repulsion (strength 0.3) contests the pull (0.5 ÷ degree). Short
  edges get shorter, but not by the full factor. Accepted; see Risks.
- Repulsion only ever pushes (`:167`). A node spacing below ×1 lets other forces
  (springs) bring things closer; it never attracts an unrelated node.

## Open questions resolved

Owner rulings of 2026-10-11 are marked _(ruling)_ and are not reopened here.

- **What the edge-tag slider controls.** **A rest-length multiplier** _(ruling)_:
  for an edge with factor `g`, both `edgeGapMinRadiusFactor` and
  `edgeGapMaxRadiusFactor` are multiplied by `g`. Spring strength is **not**
  exposed per tag, for the reason in the section above — it is invisible at rest.

- **What the node-tag slider controls.** **A spacing multiplier on hop
  repulsion's extra gap** _(ruling)_. A pair's `extraHopGap` — including the
  cross-component seam (`CROSS_COMPONENT_EXTRA_GAP_RADIUS_FACTOR`,
  `lib/physics.ts:14`) — is multiplied by `sqrt(fa × fb)`. The seam is multiplied
  _after_ its `Math.min(..., maxExtraGapFactor)` cap (`:439`), so a spaced-out
  node keeps a proportionally wider seam. Overlap removal is a hard constraint
  and is untouched.

- **Several tags on one element.** **Geometric mean of the _configured_ tags'
  factors** _(ruling)_. Tags with no stored factor are ignored; no configured
  tags gives 1. The product was rejected because `0.9 × 0.8 = 0.72` falls below
  both inputs — two "slightly shorter" tags would make an edge much shorter than
  either asked for. The geometric mean stays between its inputs, is symmetric
  about 1 in log space (×2 and ×0.5 cancel to ×1), and equals the single value
  when every tag agrees. Ignoring unconfigured tags keeps adding an incidental
  tag (say `#todo`) from diluting a deliberate one.

- **Pair combination for repulsion.** **Also the geometric mean,
  `sqrt(fa × fb)`** _(ruling)_ — the same rule one level up, symmetric in the two
  nodes so the push stays equal and opposite.

- **Range, slider and readout.** **Factors in `[0.25, 4]`, logarithmic slider**
  _(ruling)_. The native range input runs over `log2(factor)`:
  `min=-2 max=2 step=0.05`, so 1 sits at the centre and one step near 1 is
  `2^0.05 ≈ ×1.035` (~0.035 resolution, inside the ~0.05 asked for); Home/End
  reach ×0.25/×4. The stored factor is `2^position` rounded to 3 decimals, so
  position 0 is exactly 1 and removes the key. The readout is
  `×` + `factor.toPrecision(2)` (`×1.4`, `×0.71`, `×4.0`, `×0.25`) and is also
  the input's `aria-valuetext`, so a screen reader announces the factor, not the
  log position.

- **Where the range lives.** **Module constants in `lib/tagPhysics.ts`
  (`TAG_PHYSICS_MIN_FACTOR = 0.25`, `TAG_PHYSICS_MAX_FACTOR = 4`), not
  `APP_CONFIG`.** The range is part of what a stored value _means_ — a tunable
  that changed it would silently re-interpret every saved graph — so it is a
  format constant, not a setting. Functions still take the bounds as defaulted
  parameters per the tunables convention, so specs pin them.

- **Storage.** **New optional
  `MultigraphData.tagPhysicsConfig?: { nodeTags: Record<string, number>; edgeTags: Record<string, number> }`**
  _(ruling)_, a sibling of `tagColorConfig` (`src/lib/components/ui/types/multigraph.ts:9-12`, `:31-39`).
  Sparse: only factors ≠ 1 are stored, and when both maps are empty the field is
  **removed**, not left as `{ nodeTags: {}, edgeTags: {} }` — so a graph that
  never touched a slider serialises byte-identically to today. It is graph
  content like colours (unlike per-graph `settings`, which ride the envelope),
  because it is keyed by the graph's own tags and must travel with them through
  import/merge and tag deletion.

- **Schema version.** **No bump** _(ruling)_. `CURRENT_SCHEMA_VERSION` stays 8
  (`src/lib/migrations.ts:26`). The field is additive and optional; older
  readers ignore unknown `data` keys (`isMultigraphData`,
  `src/lib/migrations.ts:403-430`, checks only the keys it names), as the
  per-graph `settings` key already proved.

- **Invalid values on load.** **Sanitise, never reject the graph.** A new
  `sanitizeTagPhysicsConfig(value: unknown)` runs in the one load funnel,
  `unwrapPersistedGraph` (`src/lib/migrations.ts:161-163`), which every path
  (localStorage `persistence.ts`, JSON and HTML files via `graphFile.ts:250`)
  goes through. Rules: a non-record field is dropped whole; a missing or
  non-record `nodeTags`/`edgeTags` reads as `{}`; an entry that is not a finite
  number `> 0` is **dropped** (it has no direction to clamp toward); a finite
  positive entry is **clamped** into `[0.25, 4]` (a future build with a wider
  range writing ×8 opens here as ×4, keeping the intent's direction); an entry
  that ends up exactly 1 is dropped; both maps empty drops the field. The
  boolean guard `isMultigraphData` is **not** extended — a tuning value must
  never make a whole graph unreadable, which is what a guard failure does
  (`malformed-payload`). This mirrors `sanitizeOverrides`
  (`src/lib/config/configOverrides.ts`), whose stated rule is that nothing from a
  file may wedge the app.

- **Physics stays ignorant of tags.** **Yes** _(ruling)_. Physics takes numbers:
  `EdgeEndpointIds.gapFactor?` and `repulsionFactorByNodeId?`. A new pure
  `lib/tagPhysics.ts` turns tags into those numbers, and `Multigraph.svelte`
  composes it, beside `withSpringFactor` (`Multigraph.svelte:927-931`).

- **How factors reach physics — edges.** **Applied to the composed layout
  graph's edges, at every site that composes one.** There are three, all found on
  this branch: `Multigraph.svelte:1030-1032` (`visibleGraph`, drawn and laid
  out), `Multigraph.svelte:1243-1249` (the ingest settle) and
  `lib/layoutRuntime.svelte.ts:484-496` (`visibleGraphFor`, every relax frame).
  Note `withSpringFactor` only covers _derived_ edges; authored edges reach
  physics straight from `graph.edges` via `graphWithVisibleNodes`
  (`lib/boundedVisibility.ts:244-255`), so the derived-edge hook alone would
  miss every edge a user can tag. `LayoutRuntimeOptions` gains one hook,
  `weighLayoutGraph?: (layoutGraph: MultigraphData) => MultigraphData` (default
  identity), applied as the last step of `visibleGraphFor`; Multigraph passes a
  local `withTagGapFactorsOn(layoutGraph)` and applies the same function at its
  two own sites. The layout graph still carries `tagPhysicsConfig` because
  `graphWithVisibleNodes` spreads `...data`, so a mutation in flight is weighed
  by its own config, not the live one. `gapFactor` never reaches the saved graph:
  every layout write ends in `mergeVisiblePositions`
  (`lib/layoutRuntime.svelte.ts:718-729`), which copies positions only — the same
  reason `springFactor` never persists (`src/lib/components/ui/types/edge.ts:7-13`).

- **How factors reach physics — nodes.** **Threaded like `mobilityByNodeId`**
  _(ruling)_: `GraphLayoutOptions.repulsionFactorByNodeId?`
  (`lib/graphLayout.ts:29-48`) → `deriveGraphLayout`'s `relaxGraphPhysics` call
  (`:79-89`) → `relaxHopRepulsionStep`. `layoutOptions()`
  (`lib/layoutRuntime.svelte.ts:340-366`) fills it from a new
  `LayoutRuntimeOptions.repulsionFactorsFor?: (layoutGraph) => Record<string, number> | undefined`,
  called with the layout graph it is building options for; an explicit override
  wins, like `mobilityByNodeId` at `:364`. The ingest settle passes it directly in
  its own options (`Multigraph.svelte:1253-1256`).

- **Sanitisation inside physics.** **`gapFactor` and a node's repulsion factor
  read as 1 unless finite and `> 0`.** Deliberately _not_ `springFactorOf`'s rule
  (`lib/physics.ts:215-218`), which maps bad values to **0** because a zero spring
  is a meaningful "no pull". A zero rest length is not meaningful — it would ask
  every tagged edge to close to touching — so a bad gap factor falls back to
  "unchanged". Physics does not clamp to `[0.25, 4]`; that range is a UI and
  file-format concern.

- **Mutation API.** **`setTagPhysicsFactor(graph, namespace, tag, factor)` in
  `lib/graph.ts`** _(ruling)_, next to `setTagColor` (`:579-596`). Clamps into
  range; a factor of 1 removes the key; a non-finite factor is a no-op; returns
  **the same object** when nothing changes (unlike `setTagColor`, which always
  rebuilds). `deleteTagEverywhere` (`:598-628`) also drops the tag's factor.
  Namespaces reuse `TagColorNamespace` — the two configs share their keys, and a
  rename is churn this plan does not need.

- **Undo history and change detection.** **`tagPhysicsConfig` joins the tracked
  graph-level fields.** Found while verifying: history and save decisions do not
  diff whole graphs. `semanticallyUnchanged` (`lib/graphIdentity.ts:34-42`) is a
  five-field reference test, and `recordHistory` drops any commit it calls
  unchanged (`src/lib/graphPersistenceController.ts:544-550`). Without this, a
  slider drag would move the graph and record **no undo entry at all**. Likewise
  `semanticFingerprint` (`lib/graphIdentity.ts:54-62`) and `GraphDelta`
  (`src/lib/graphDelta.ts:54-61`, `diffByReference` `:64-76`, `applyDelta`
  `:79-110`, `isEmptyDelta` `:135-147`) gain the field, using `null` for "absent"
  exactly as `assets` does, because the field is optional and a delta must be
  able to take it away.

- **Undo walks the graph back.** **A restore that changes `tagPhysicsConfig`
  kicks a settle.** `restoreGraphInPlace` (`Multigraph.svelte:1381-1402`) runs
  `relaxAfterMutation` — `relaxIterations` (12) steps and no settle loop — so an
  undone ×4 would leave the graph stranded part-way. When the incoming config
  reference differs from the current one, it also calls
  `layoutRuntime.settleAfterSettingsChange()`. `adoptGraphInPlace` (the
  additive-import path, `:2757-2770`) gets the same check, since an import can
  bring factors in.

- **Import / merge.** **Host wins, like colours** _(ruling)_ — merge per
  namespace with the host spread last, as `importGraphData` does for
  `tagColorConfig` (`lib/graphImport.ts:112-118`); absent on both sides stays
  absent, as `assets` does (`:100-104`).

- **Legend data.** **`LegendTag` gains `physicsFactor: number`** (1 when unset),
  filled by `collectNamespaceLegendTags` (`lib/tagColors.ts:102-127`). A tag that
  appears only in `tagPhysicsConfig` (every use edited away, factor left behind)
  is listed, exactly as a colour-only tag is today (`:114`), so it can still be
  reset or deleted rather than silently shaping nothing.

- **Legend UI.** **A range input left of each row's colour input** _(ruling)_,
  sr-only labelled `Edge length for edge tag X` / `Node spacing for node tag X`,
  emitting `onPhysicsChange(namespace, tag, factor, phase)` with `oninput` →
  `'scrub'` and `onchange` → `'commit'`, the same phases as colour
  (`lib/tagColors.ts:21`, reused as-is). The coalesce key is
  `tag-physics:${namespace}:${tag}` and the history label is `edge length` /
  `node spacing` — one undo entry per drag, per
  `docs/ui-decisions/2026-08-30--editing--coalesce-a-colour-scrub-into-one-undo-entry.md`
  and library pattern `editing--match-undo-granularity-to-what-the-hand-did`.
  Each arrow-key press fires `input` then `change`, so it is its own entry —
  "discrete taps stay one entry each" in that same ruling.

- **A visible word beside the readout.** **The readout reads `length ×1.4` (edge
  rows) / `spacing ×1.4` (node rows).** This is the one UI choice here that the
  rulings did not make. The ui-patterns checklist asks for a visible label by
  default, and a bare `×1.4` beside a colour swatch does not say what it scales;
  one word costs nothing and survives the stacked layout, where a column header
  would not. Cheap to drop if the owner prefers the bare number.

- **Narrow screens.** **The stacked layout below 420px gives the slider its own
  full-width line** (`TagColorLegend.svelte:280-285` already turns each `li` into
  a column). The slider's hit area is at least 44px tall at every width
  (checklist: touch targets ≥ 44px).

- **Settle while dragging.** **The handler calls
  `layoutRuntime.settleAfterSettingsChange()` on every scrub and on commit**
  (`lib/layoutRuntime.svelte.ts:203-215`), so the graph walks to the new rest
  while the thumb moves. Its `Math.max` top-up means repeated calls never extend
  the budget past `postDragSettleMaxFrames`.

- **The schema max bug.** **`edgeSpringStrength` and `hopRepulsionStrength`
  slider max drops from 2 to 1** (`src/lib/config/configSchema.ts:529-537`,
  `:548-556`). Physics clamps both to `[0, 1]` (`lib/physics.ts:231`, `:135`), so
  the upper half of each slider moved the thumb and changed nothing. Stored
  overrides above 1 need no migration: `range` bounds are soft by design
  (`src/lib/config/configOverrides.ts:144-158`), so a saved 1.5 still loads and
  still behaves as 1, exactly as it does today. `derivedEdgeSpringFactor` keeps
  max 2 — it multiplies a strength below 1 before the clamp (`lib/physics.ts:268`),
  so its upper half is live.

## Out of scope (for this plan)

- Per-tag spring strength, in any form (see "Why spring strength is the wrong
  knob").
- Per-tag factors for derived dataflow edges. They carry no tags; their only
  per-edge weight stays `derivedEdgeSpringFactor`.
- Scaling a hop-1 pair's repulsion by the connecting edge's `gapFactor`, which
  would let the length slider's lower half reach its full effect. It would make
  repulsion read edge data — a physics design change, not a slider.
- Per-node or per-edge (untagged) factors, and a per-row reset button. The
  centre detent, Home/End, and undo are the ways back to ×1.
- `mobilityByNodeId`, which is still threaded and still unused in production.
- Settings-panel controls for these factors. They are graph content, edited
  where the tags are.

## Tasks

### T01 — Physics: per-edge gap factor and per-node repulsion factor

|                |                                                                                |
| -------------- | ------------------------------------------------------------------------------ |
| **Depends on** | —                                                                              |
| **Wave**       | 1                                                                              |
| **Agent**      | default (opus)                                                                 |
| **Effort**     | S                                                                              |
| **Files**      | `lib/physics.ts`, `lib/physics.spec.ts`                                        |
| **PR title**   | `feat(physics): scale edge rest gaps and hop clearance by per-element factors` |

- `EdgeEndpointIds` (`:31-43`) gains `gapFactor?: number`, documented like
  `springFactor`: physics is handed a number and does not know where it came
  from. A private `gapFactorOf(edge)` returns the factor when finite and `> 0`,
  else 1 (see the sanitisation decision for why this differs from
  `springFactorOf`).
- `relaxEdgeDistancesStep`: per edge, `minGap = radiusSum × minGapFactor × g`
  and `maxGap = radiusSum × maxGapFactor × g` (`:255-256`). Nothing else in the
  step changes — degree counting, the `forcefulEdges` filter and the strength
  clamp are untouched.
- `relaxHopRepulsionStep` (`:126-189`) and `relaxGraphPhysics` (`:73-124`) gain
  a trailing optional `repulsionFactorByNodeId?: Record<string, number>`, after
  `mobilityByNodeId`. Per pair, the `extraHopGap(...)` result (`:159`) is
  multiplied by `sqrt(fa × fb)`, each read through a private
  `repulsionFactorOf(map, id)` (finite and `> 0`, else 1). `extraHopGap` itself
  is unchanged, so the seam is scaled after its cap.
- `relaxOverlapsStep` is not touched.

**Acceptance**

- Spec: with hop repulsion off, an edge with `gapFactor: 2` relaxes to a gap
  inside `[2 × min, 2 × max] × radiusSum`, and an otherwise identical edge with
  no factor relaxes into the unscaled band — the factor moves the rest gap, not
  just the convergence speed.
- Spec: `gapFactor` of `0`, `-1`, `NaN` and `Infinity` each behave exactly like
  an absent factor.
- Spec: a non-adjacent pair whose nodes have factors 4 and 1 holds open
  `2 ×` the unscaled extra gap (`sqrt(4 × 1)`); factors 2 and 0.5 hold the
  unscaled gap.
- Spec: a cross-component pair's seam scales by the same pair factor.
- Spec: an absent or empty `repulsionFactorByNodeId` leaves every existing
  physics spec result bit-identical (run them unchanged — none may need edits).

### T02 — `lib/tagPhysics.ts`: tags to factors, slider mapping, types

|                |                                                                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                                                                         |
| **Wave**       | 1 (parallel with T01, T06)                                                                                                                |
| **Agent**      | default (opus)                                                                                                                            |
| **Effort**     | S                                                                                                                                         |
| **Files**      | new `lib/tagPhysics.ts`, new `lib/tagPhysics.spec.ts`, `src/lib/components/ui/types/multigraph.ts`, `src/lib/components/ui/types/edge.ts` |
| **PR title**   | `feat(tags): derive layout factors from per-tag physics config`                                                                           |

Types first: `TagPhysicsConfig` in `types/multigraph.ts` (same keys as
`TagColorConfig`), `MultigraphData.tagPhysicsConfig?: TagPhysicsConfig`, and
`EdgeData.gapFactor?: number` in `types/edge.ts` with a doc comment matching
`springFactor`'s ("set by whoever composes the layout graph; persistence never
sees it").

Pure module, no Svelte, no `APP_CONFIG`:

- `TAG_PHYSICS_MIN_FACTOR = 0.25`, `TAG_PHYSICS_MAX_FACTOR = 4`.
- `clampTagPhysicsFactor(factor, min?, max?)`.
- `elementFactor(tags, factors)` — geometric mean of the factors of the tags
  that have one; unconfigured tags and non-finite / non-positive stored values
  are ignored; none configured → 1. Compute as `2 ** mean(log2 f)`.
- `withTagGapFactors(edges, config)` — returns the **same array** when
  `config?.edgeTags` is empty or absent (this runs per frame); otherwise maps
  each edge to `{ ...edge, gapFactor }` only when its factor ≠ 1, preserving
  `springFactor` and every other field.
- `repulsionFactorByNodeId(nodes, config)` — sparse map of node id → factor for
  nodes whose factor ≠ 1; `undefined` when `config?.nodeTags` is empty or absent.
- Slider mapping: `sliderPositionForFactor(factor)` (log2, snapped to the
  0.05 step, clamped to `[-2, 2]`), `factorForSliderPosition(position)` (`2 **
position` rounded to 3 decimals), `formatTagPhysicsFactor(factor)`
  (`×` + `toPrecision(2)`).

**Acceptance**

- Spec: `elementFactor(['a', 'b'], { a: 0.9, b: 0.8 })` lies strictly between
  0.8 and 0.9 (pins the rejection of the product); `{ a: 2, b: 0.5 }` → 1;
  `['a', 'untuned']` with only `a: 2` → 2; no tags → 1; all unconfigured → 1;
  `{ a: NaN }` → 1.
- Spec: `withTagGapFactors` returns its input by reference for an absent or
  empty config, and never adds `gapFactor: 1`.
- Spec: `repulsionFactorByNodeId` is `undefined` for no node config and omits
  factor-1 nodes otherwise.
- Spec: `factorForSliderPosition(0) === 1`, `(-2) === 0.25`, `(2) === 4`;
  `sliderPositionForFactor` round-trips every step position; format gives
  `×1.0`, `×1.4`, `×0.71`, `×0.25`, `×4.0` for the obvious inputs.
- `pnpm --filter mind-map-sv check` passes with the new optional fields (no call
  site needs a change).

### T03 — Data model: mutation, deletion, import, load sanitising, undo tracking

|                |                                                                                                                                                                                                                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T02                                                                                                                                                                                                                                                                                                                         |
| **Wave**       | 2 (parallel with T04)                                                                                                                                                                                                                                                                                                       |
| **Agent**      | default (opus)                                                                                                                                                                                                                                                                                                              |
| **Effort**     | M                                                                                                                                                                                                                                                                                                                           |
| **Files**      | `lib/graph.ts`, `lib/graph.spec.ts`, `lib/graphImport.ts`, `lib/graphImport.spec.ts`, `lib/graphIdentity.ts`, `lib/graphIdentity.spec.ts`, `lib/tagColors.ts`, `lib/tagColors.spec.ts`, `lib/testFixtures.ts`, `src/lib/migrations.ts`, `src/lib/migrations.spec.ts`, `src/lib/graphDelta.ts`, `src/lib/graphDelta.spec.ts` |
| **PR title**   | `feat(graph): store per-tag physics factors as sparse graph content`                                                                                                                                                                                                                                                        |

- `setTagPhysicsFactor(graph, namespace, tag, factor)` in `lib/graph.ts` per the
  mutation decision; drops the whole field when both maps end up empty.
- `deleteTagEverywhere` also removes the tag's factor, with the same
  drop-when-empty rule; untouched when the tag had none.
- `importGraphData`: host-wins merge per namespace; absent on both → absent.
- `sanitizeTagPhysicsConfig(value: unknown): TagPhysicsConfig | undefined` in
  `src/lib/migrations.ts` (uses `clampTagPhysicsFactor`), applied inside
  `unwrapPersistedGraph` (`:161-163`) on both the v8 and v7-migration returns.
- `graphIdentity.ts`: add the field to `semanticallyUnchanged` and
  `semanticFingerprint`. `graphDelta.ts`: add `tagPhysicsConfig?:
TagPhysicsConfig | null` to `GraphDelta`, diff by reference, apply with `null`
  deleting the key, and count it in `isEmptyDelta`.
- `collectLegendTags`: `physicsFactor` on every `LegendTag`, and physics-only
  tags listed. Update the existing `LegendTag` literals that `check` flags.
- `testFixtures.ts`: `MakeGraphInput.tagPhysicsConfig?`, passed through only when
  given (default graphs stay without the field).

**Acceptance**

- `graph.spec`: set → value stored; set to 1 → key removed and, when last,
  field removed; set out of range → clamped; set `NaN` → same object back;
  set an unchanged value → same object back; `deleteTagEverywhere` drops the
  factor and leaves the other namespace alone.
- `migrations.spec`: a graph with factors round-trips `wrap` → `JSON` →
  `unwrapPersistedGraph` unchanged; a payload without the field loads with no
  field; `{ edgeTags: { a: 9, b: -1, c: 'x', d: 1, e: 0.5 } }` loads as
  `{ edgeTags: { a: 4, e: 0.5 }, nodeTags: {} }`; a non-object field is dropped
  and the graph still loads; `CURRENT_SCHEMA_VERSION` is still 8.
- `graphImport.spec`: a tag configured on both sides keeps the host's factor; an
  incoming-only tag brings its factor; neither side → no field.
- `graphIdentity.spec`: "detects each of the five tracked fields changing"
  becomes six, and a physics-only edit is reported as semantic.
- `graphDelta.spec`: diff/apply round-trips adding, changing and removing the
  field; a physics-only delta is not empty.
- `tagColors.spec`: `physicsFactor` defaults to 1; a physics-only tag is listed.

### T04 — Thread factors into the layout: runtime hooks and Multigraph composition

|                |                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T01, T02                                                                                                                         |
| **Wave**       | 2 (parallel with T03)                                                                                                            |
| **Agent**      | default (opus)                                                                                                                   |
| **Effort**     | M                                                                                                                                |
| **Files**      | `lib/graphLayout.ts`, `lib/graphLayout.spec.ts`, `lib/layoutRuntime.svelte.ts`, `lib/layoutRuntime.spec.ts`, `Multigraph.svelte` |
| **PR title**   | `feat(layout): feed per-tag physics factors through the layout pipeline`                                                         |

- `GraphLayoutOptions.repulsionFactorByNodeId?`, passed by `deriveGraphLayout`
  into `relaxGraphPhysics` after `mobilityByNodeId` (`lib/graphLayout.ts:79-89`).
  `withSettledGraphPositions` / `relaxGraphPositionsStep` inherit it through the
  options spread.
- `LayoutRuntimeOptions` gains `weighLayoutGraph?` and `repulsionFactorsFor?`
  (decisions above); `visibleGraphFor` applies the first as its last step;
  `layoutOptions()` gains a `repulsionFactorByNodeId` override and falls back to
  the second.
- `Multigraph.svelte`: a local `withTagGapFactorsOn(layoutGraph)` (identity when
  the layout graph has no edge factors) passed as `weighLayoutGraph` and applied
  at `:1030-1032` and `:1243-1249`; `repulsionFactorsFor: (layoutGraph) =>
repulsionFactorByNodeId(layoutGraph.nodes, layoutGraph.tagPhysicsConfig)`; the
  ingest settle's options (`:1253-1256`) get the same map.
- No UI in this task. A graph loaded with `tagPhysicsConfig` already lays out
  differently, which is how it is exercised.

**Acceptance**

- `layoutRuntime.spec`: `visibleGraphFor` applies `weighLayoutGraph` (an edge
  comes out with the hook's `gapFactor`); without the hook, output is unchanged
  from today (existing assertions at `:432-453` pass untouched).
- `layoutRuntime.spec`: `layoutOptions()` carries the hook's map, and an explicit
  override wins.
- `graphLayout.spec`: `deriveGraphLayout` with `repulsionFactorByNodeId` pushes a
  non-adjacent pair further apart than without it.
- `graphIdentity.spec`'s "holds after a real relaxAfterMutation" still passes —
  proving `gapFactor` never leaks into the saved graph's `edges`.
- With no `tagPhysicsConfig` anywhere, every existing `Multigraph.stories` story
  passes unchanged.

### T05 — Legend sliders, the change handler, and the at-rest stories

|                |                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| **Depends on** | T03, T04                                                                                                   |
| **Wave**       | 3                                                                                                          |
| **Agent**      | default (opus)                                                                                             |
| **Effort**     | M                                                                                                          |
| **Files**      | `TagColorLegend.svelte`, `TagColorLegend.stories.svelte`, `Multigraph.svelte`, `Multigraph.stories.svelte` |
| **PR title**   | `feat(legend): tune edge length and node spacing per tag`                                                  |

Read the ui-patterns skill and `docs/ui-decisions/` before starting (both cited
above).

- `TagColorLegend.svelte`: per row, a `<label>` wrapping an sr-only name and an
  `<input type="range" min="-2" max="2" step="0.05">` with `value` from
  `sliderPositionForFactor(legendTag.physicsFactor)`, `aria-valuetext` and a
  visible readout from `formatTagPhysicsFactor`, placed left of the colour
  `<label>` (`:81-104`). `oninput` / `onchange` emit
  `onPhysicsChange(namespace, tag, factorForSliderPosition(value), phase)`. Under
  420px the slider takes its own full-width line; its hit area is ≥ 44px tall
  at every width.
- `Multigraph.svelte`: `updateTagPhysics(namespace, tag, factor, phase)` mirroring
  `updateTagColor` (`:2584-2598`) — **always** commits, even when
  `setTagPhysicsFactor` returns the same graph, because the closing `change`
  must end the coalesce run (`src/lib/graphPersistenceController.ts:544-550`
  handles an unchanged commit that ends a run) — then calls
  `layoutRuntime.settleAfterSettingsChange()`. Wire it at the mount
  (`:3783-3789`).
- `restoreGraphInPlace` and `adoptGraphInPlace`: kick a settle when
  `incoming.tagPhysicsConfig !== graph.tagPhysicsConfig` (read before
  committing).
- Retitle the surface (owner ruling 2026-10-11): the toolbar button
  (`Multigraph.svelte:3025-3032`) and the dialog heading
  (`TagColorLegend.svelte:55`) read **"Tags"** instead of "Tag colors"; the
  eyebrow "Graph tags" goes, since the heading now says it. Update every story
  and e2e selector that finds the button or dialog by that name
  (`getByRole('button', { name: 'Tag colors' })` in `Multigraph.stories.svelte`
  and `TagColorLegend.stories.svelte`; grep `e2e/` too), and the sr-only
  "Close tag color legend" label becomes "Close tags".

**Acceptance**

- `TagColorLegend` story `play`: setting the edge-tag slider to position `1`
  and dispatching `input` emits `['edgeTags', 'rel', 2, 'scrub']`; dispatching
  `change` emits `['edgeTags', 'rel', 2, 'commit']`. Same for a node tag via
  `Node spacing for node tag topic`.
- `TagColorLegend` story `play`: a tag with `physicsFactor: 1.4` renders its
  slider at the matching position, `aria-valuetext` `×1.4` and visible
  `length ×1.4` / `spacing ×1.4`.
- `TagColorLegend` story: at a 400px-wide viewport the slider's box is on its
  own line and at least 44px tall.
- `Multigraph` story `play` (mirroring `UserChangesTagColorFromLegend`,
  `Multigraph.stories.svelte:5241`): a two-node graph joined by an `@rel` edge,
  hop repulsion on defaults; settle to rest, record the endpoint distance; drag
  `Edge length for edge tag rel` to ×2 (scrub frames, then `change`); wait for
  `data-settling` to clear; the endpoint distance is larger, and
  `lastChangedGraph(args).tagPhysicsConfig.edgeTags.rel` is 2.
- `Multigraph` story `play`: a chain `a — b — c` with `c` tagged `#far`; raising
  `Node spacing for node tag far` to ×4 leaves `a`–`c` (non-adjacent) further
  apart at rest than before.
- `Multigraph` story `play`: after the edge-length drag, undo once restores the
  previous distance at rest (one entry for the whole drag, and the settle kick
  walks it back).
- Manual: drag both sliders end to end in the dev app on desktop and at a 375px
  viewport; confirm the graph follows the thumb without visible thrash.

### T06 — Settings schema: cap the two strength sliders at what physics honours

|                |                                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                                                            |
| **Wave**       | 1 (parallel with T01, T02)                                                                                                   |
| **Agent**      | fast/cheap                                                                                                                   |
| **Effort**     | XS                                                                                                                           |
| **Files**      | `src/lib/config/configSchema.ts`, `src/lib/config/configSchema.spec.ts`, `src/lib/appConfig.ts`, `Multigraph.stories.svelte` |
| **PR title**   | `fix(settings): stop spring and repulsion strength sliders past their clamp`                                                 |

- `max: 2` → `max: 1` for `edgeSpringStrength` (`:529-537`) and
  `hopRepulsionStrength` (`:548-556`).
- While in the file: the two edge-gap help strings say "As a fraction of node
  radius." (`:512`, `:522`), and the matching `appConfig.ts` comments
  (`:127-128`) say the same, but physics multiplies by the **radius sum**
  (`lib/physics.ts:255-256`). Correct the copy to "As a fraction of the two
  nodes' combined radius." — one-line copy fixes in the files this task already
  touches.
- `DraggingEdgeSpringStrengthStartsTheFrameLoop` drags through `[1, 2]`
  (`Multigraph.stories.svelte:7549`); change to `[0.5, 1]` so the story stops
  exercising a value the slider can no longer reach.

**Acceptance**

- `configSchema.spec`: a new case pins both maxima at 1, with a comment pointing
  at the physics clamp, so a later widening fails loudly.
- The existing "keeps every range default inside its own slider bounds" case
  still passes (defaults 0.5 and 0.3).
- `DraggingEdgeSpringStrengthStartsTheFrameLoop` passes with the new values.

### T07 — Example save prose, offline shell, UI ruling log, plan close-out

|                |                                                                                                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T05, T06                                                                                                                                                                                      |
| **Wave**       | 4                                                                                                                                                                                             |
| **Agent**      | fast/cheap                                                                                                                                                                                    |
| **Effort**     | S                                                                                                                                                                                             |
| **Files**      | `scripts/example-save-file.mjs`, `examples/ai-mind-map.html`, `static/offline-app-shell.html`, new `docs/ui-decisions/2026-10-11--editing--tune-layout-per-tag-from-the-legend.md`, this plan |
| **PR title**   | `docs(tags): document per-tag physics in the example save and log the ruling`                                                                                                                 |

- `scripts/example-save-file.mjs`: the data-shape paragraph (`:68`) and the tag
  paragraph (`:84`) gain one sentence each: `data.tagPhysicsConfig` is optional,
  holds `nodeTags`/`edgeTags` maps of tag → factor in `[0.25, 4]`, omitted means
  ×1, edge factors scale edge length and node factors scale spacing, and several
  tags combine by geometric mean. Do not add it to the step-4 "replace" list
  (`:36`) — it is optional and the example graph does not use it.
- Run `pnpm --filter mind-map-sv build`; confirm `pnpm check:offline-shell`
  passes; commit the regenerated shell and example on their own, in the
  established pattern (`cb5371f`).
- Log the 2026-10-11 rulings (rest-length not strength, log slider with ×
  readout, geometric mean, slider left of the colour input, one undo entry per
  drag) as one `docs/ui-decisions/` file from the template, `Pattern:
editing--match-undo-granularity-to-what-the-hand-did`. Note the visible-word
  readout as the agent's choice, not a ruling.
- Set this plan's status to `done` and add execution notes.

**Acceptance**

- `pnpm check:offline-shell` passes and `exampleSaveFile.spec.ts` passes.
- The example HTML mentions `tagPhysicsConfig` exactly where the prose says.

## Wave plan

```
Wave 1   T01  ‖  T02  ‖  T06   (physics.ts / new tagPhysics.ts + types /
                                configSchema — disjoint files)
Wave 2   T03  ‖  T04           (T03 needs T02; T04 needs T01 + T02. Disjoint:
                                data model + persistence vs layout pipeline)
Wave 3   T05                   (needs the factors stored (T03) and laid out (T04))
Wave 4   T07                   (shell regeneration must follow the last src/ change)
```

Total: 7 tasks, 4 waves. T03 and T04 are disjoint by file but meet in T05; T04's
`Multigraph.svelte` edits are in the layout block (`:889-1062`, `:1243-1256`)
and T05's in the handlers and template (`:1381-1402`, `:2584-2610`,
`:2757-2770`, `:3783-3789`), so a rebase between them is mechanical. T06 also
edits `Multigraph.stories.svelte` (one line) and lands two waves before T05
touches that file. T04 is the task to review most carefully: it is the only one
where a mistake is silent — a composition site that forgets the hook lays out
with different forces than the one beside it, and nothing fails.

## Risks and rollback

- **A composition site gets missed.** Three sites compose the layout graph
  today; a fourth added later without the hook would place nodes under different
  forces from what is drawn. Mitigation: T04 names all three, and the
  `layoutRuntime.spec` case pins that the runtime's composition applies the hook.
  If this keeps biting, the follow-up is to move the hook into
  `composeVisibleLayoutGraph` itself — deliberately not done here, because it
  would make the visibility module depend on tag config.

- **Short edges are only partly short.** Below about ×0.6, hop-1 repulsion
  (adjacent pairs are repelled — `hopRepulsionMinHops` clamps 0 up to 1) contests
  the edge band's upper edge, so ×0.25 does not deliver a quarter-length edge.
  The stories only assert the raising direction, which is uncontested. If the
  owner finds the lower half too weak, the out-of-scope item (scale hop-1
  repulsion by the edge's factor) is the fix.

- **Node spacing also lengthens a node's own edges.** Its extra gap applies at
  hop 1 too, so ×4 asks for `2 × radiusSum` from each neighbour while the band
  allows `0.84`; the push (0.3) and pull (0.5 ÷ degree) settle in between.
  "Spacing around the node" includes its neighbours, which is arguably right,
  but it should be named in the T07 ruling so it does not read as a bug later.

- **The settle budget may run out on a big jump.** `postDragSettleMaxFrames`
  (200) bounds each kick. Every scrub frame and the commit top it up, so a drag
  is fine; a single keyboard Home/End from ×1 to ×4 gets one kick. If T05's
  manual check shows the graph stopping short, top up again on commit rather
  than raising the global cap.

- **Per-frame cost.** `withTagGapFactorsOn` and `repulsionFactorsFor` run on
  every relax frame. Both return their input / `undefined` immediately when the
  relevant map is empty, so a graph that never used the sliders pays one property
  read. With factors set the cost is O(E × tags) + O(N × tags) per frame, small
  next to the O(N²) repulsion loop.

- **Persisted undo tails written by this build carry `tagPhysicsConfig` in
  deltas.** An older build reading the tail ignores the unknown delta key, so an
  undo there would not restore a factor. The same is true of every optional field
  added since the tail format shipped; acceptable.

- **Rollback.** T06 stands alone. T05 can be reverted to remove the UI while
  stored factors keep working. Reverting T03/T04 leaves files with
  `tagPhysicsConfig` that this build ignores and preserves on re-save (the field
  rides the `...data` spreads), so no data is lost either way.

## Definition of Done (this plan)

- All seven tasks merged.
- `pnpm --filter mind-map-sv lint`, `check`, `test:unit -- --run` and `knip`
  pass; `pnpm check:offline-shell` passes with the regenerated shell committed.
- Dragging an edge tag's length slider visibly lengthens its edges at rest while
  the thumb moves; dragging a node tag's spacing slider moves non-adjacent nodes
  away; each drag is one undo entry, and undo walks the graph back.
- A graph with factors survives reload, `.json` export/import and `.html`
  export/open; a graph without them is byte-identical to before.
- The two strength sliders stop at 1.
- Plan status is `done`; the ruling is logged in `docs/ui-decisions/`.

## Notes

- 2026-10-11: drafted after the owner's design rulings. Three things surfaced
  while verifying against the code that the initial survey did not have: the
  undo/change-detection gate (`semanticallyUnchanged`, `GraphDelta`) tracks
  graph-level fields by name and would have silently recorded no undo entry; the
  ingest settle is a third layout-graph composition site; and undo restores via
  `relaxAfterMutation`, which does not settle.
- 2026-10-11: sequencing against the sibling plans of the same date. Execute
  this plan **after** `2026-10-11 excluded elements leave the layout.md`: both
  add a hook to `LayoutRuntime` around `visibleGraphFor`, and T04 here should
  be written against that plan's `reduceLayoutSource` (weigh after reducing)
  rather than rebased onto it afterwards. `2026-10-11 query tag buttons cycle
modes.md` is disjoint and may run in parallel.
- 2026-10-11: owner rulings on the two open items: the readout keeps its
  visible word (`length ×1.4` / `spacing ×1.4`), and the toolbar button and
  dialog are retitled **"Tags"** (folded into T05).
- 2026-10-11: executed. What landed:
  - T01 — `lib/physics.ts`: `EdgeEndpointIds.gapFactor?` multiplies both ends
    of an edge's rest-gap band in `relaxEdgeDistancesStep`, and a trailing
    `repulsionFactorByNodeId?` on `relaxGraphPhysics` / `relaxHopRepulsionStep`
    scales each pair's `extraHopGap` by `sqrt(fa × fb)`, after the
    cross-component seam's cap. Non-finite or non-positive values read as 1.
    With no factors every existing physics result is bit-identical.
  - T02 — new pure `lib/tagPhysics.ts` (range constants, clamp,
    geometric-mean `elementFactor`, `withTagGapFactors` returning its input
    by reference when nothing is configured, sparse `repulsionFactorByNodeId`,
    and the log2 slider mapping and `×` formatter), plus the
    `TagPhysicsConfig` type, the optional `MultigraphData.tagPhysicsConfig`
    and `EdgeData.gapFactor`.
  - T03 — `setTagPhysicsFactor` (clamps, removes the key at 1 and the field
    when both maps empty, same object back when nothing changes);
    `deleteTagEverywhere` drops the factor; host-wins import merge;
    `sanitizeTagPhysicsConfig` in the `unwrapPersistedGraph` load funnel;
    `physicsFactor` on every `LegendTag`, physics-only tags listed. The
    undo-tracking fix: `tagPhysicsConfig` joined `semanticallyUnchanged`,
    `semanticFingerprint` and `GraphDelta` (with `null` for absent), without
    which a slider drag would have recorded no undo entry.
  - T04 — `GraphLayoutOptions.repulsionFactorByNodeId`; the runtime's
    `weighLayoutGraph` (last step of `visibleGraphFor`, after the excluded-
    elements reducer) and `repulsionFactorsFor` (consulted by
    `layoutOptions()`, an explicit override winning). `Multigraph.svelte`
    applies the gap factors and passes the node factors at all three
    composition sites: `visibleGraph`, the ingest settle, and the runtime's
    `visibleGraphFor`.
  - T05 — `TagColorLegend.svelte` gives each row a log slider left of its
    colour, read out as `length ×1.4` / `spacing ×1.4` with the factor in
    `aria-valuetext`, on its own full-width line below 420px and ≥ 44px tall.
    `updateTagPhysics` always commits (so the release ends the coalesce run)
    and kicks a settle; `restoreGraphInPlace` and `adoptGraphInPlace` kick one
    when the incoming config differs. The dialog and toolbar button read
    "Tags" (stories and `e2e/app.test.ts` updated). Stories:
    `TagColorLegend` (`EmitsEdgeLengthAndNodeSpacingScrubsThenCommits`,
    `ShowsAStoredFactorOnItsSliderAndReadout`,
    `GivesTheSliderItsOwnLineOnANarrowScreen`), `Multigraph`
    (`UserLengthensAnEdgeTagFromLegend`, `UserSpacesOutANodeTagFromLegend`).
    The undo story, `UndoWalksAnEdgeLengthDragBackInOneStep`, lives in
    `GraphPersistence.stories.svelte` rather than `Multigraph.stories.svelte`,
    because undo and redo belong to the persistence controller that harness
    mounts; Multigraph stories can only observe commit intents. It runs with
    `relaxIterations: 1` so a restore's own `relaxAfterMutation` barely
    starts the walk and only the settle kick can finish it — the half of the
    restore the story exists to pin.
  - T06 — `edgeSpringStrength` and `hopRepulsionStrength` slider max 2 → 1,
    pinned by a `configSchema.spec` case; the edge-gap help text and config
    comments now say "the two nodes' combined radius";
    `DraggingEdgeSpringStrengthStartsTheFrameLoop` drags `[0.5, 1]`.
  - T07 — `scripts/example-save-file.mjs` gained one sentence in the
    data-shape paragraph and one in the tag paragraph (not in the step-4
    replace list); the rulings are logged in
    `docs/ui-decisions/2026-10-11--editing--tune-layout-per-tag-from-the-legend.md`,
    including the risk that a node's spacing also lengthens its own edges.
- 2026-10-11: T05 found three places where the plan's assumptions did not
  hold, none of which changed the design:
  - **Undo keeps current positions and restores only the factor.** A restore
    does not put nodes back where they were; the pair starts the undo where
    the drag left it, under the old band, and the spring walks it back. The
    undo acceptance is therefore met by the settle kick, not by the restore.
  - **A ×2 undo case would not move.** ×2's band `[0.84, 1.68] × radiusSum`
    touches ×1's `[0.42, 0.84]` at 0.84, so a pair resting at ×2's lower edge
    is already inside ×1's band and an undo leaves it there. The undo story
    drags to ×4 and starts the pair stretched past the band so the load's
    settle leaves it at a spring-defined rest.
  - **At default settings the settle kick is rarely what finishes an undo.**
    A two-node pair converges within `relaxAfterMutation`'s 12 iterations, so
    the kick matters only when iterations are low or forces compete — hence
    the story's `relaxIterations: 1`.
- 2026-10-11: the offline shell and `examples/ai-mind-map.html` were **not**
  regenerated: one build regenerates both after all four 2026-10-11 plans
  land. Until then `pnpm check:offline-shell` is owed for this plan's
  `src/**` changes, and two `exampleSaveFile.spec.ts` cases fail ("exactly
  the deterministic output" and "parses through the production reader as
  the canonical graph"), because the example prose changed and the committed
  example has not been rebuilt from it. The regeneration fixes both.
