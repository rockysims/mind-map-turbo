# Plan: Variable dataflow layer

**Created:** 2026-08-27
**Author:** Cursor agent
**Milestone:** [milestones/09-variable-dataflow-layer.md](../milestones/09-variable-dataflow-layer.md)
**Status:** executing — all open questions resolved 2026-08-27
**Total estimated effort:** L

## Summary

Infer quantities from the MathML milestone 08 already renders, derive dataflow
edges from who defines and who references them, and compose those edges into the
existing render pipeline without disturbing authored edges.

## Open questions resolved

Carried over from the milestone. The three product decisions were made by the
user on 2026-08-27 and are marked as such; the rest are engineering calls
resolved here.

- **Escape hatches inside math.** **Ship the text-span rule, the constant
  stoplist, and the per-node opt-out. No graph-level ignore list at launch.**
  The three together already cover the cases we can name — prose inside
  `\text{}`, conventional constants, and scratch nodes that reuse common letters
  — and a second global list is speculative until real graphs show what leaks
  through. The stoplist is a parameter, so widening it is a config change rather
  than a code change.

- **Whether reuse of an undefined letter is silent.** **Silent.** The milestone
  already settles this in scope: a symbol is promoted to a tracked variable only
  once some node defines it, so writing `E = mc^2` in isolation manufactures no
  references to `m` and `c`. This is what keeps the feature quiet on graphs that
  merely happen to contain math.

- **Whether reuse of an undefined letter is silent.** Yes on the canvas, no in
  focus. The milestone asks for two things that read as contradictory: promotion
  only on definition, so an isolated `E = mc^2` manufactures nothing, but also an
  unresolved marker on a reference with no definer. They reconcile if the
  promotion rule governs the **canvas** — edges, chips, labels — while unresolved
  references are a **focus-mode affordance**. So `m` and `c` produce no arrow, no
  chip, and no marker at graph scale; opening that node offers to create a node
  defining them. That matches the milestone's own framing of an unresolved
  quantity as an invitation rather than an error, and it keeps the canvas quiet
  by default in the same spirit as the conflict decision below.

  Consequence for T03: the index retains **every** reference, resolved or not,
  and the promotion rule is applied where edges and chips are generated. Throwing
  unclaimed symbols away at index time would leave T05 nothing to report.

- **How aggressively to surface a symbol defined by two nodes.** _(User
  decision.)_ **Mark the competing nodes and record the conflict for the
  milestone 10 panel; do not interrupt with a toast or modal, and still draw the
  dataflow edges.** Collisions on a large graph will be common and often
  intentional, so a blocking treatment would train people to ignore it.

- **Whether derived edges feed layout and bounded visibility.** _(User
  decision.)_ **Off by default**, exposed as a toggle. Adjacency currently
  drives hop distance, node scaling, and which nodes are visible at all, so
  including derived edges would silently rearrange every existing graph the
  moment a description contains an equation. Off by default keeps this milestone
  additive; the toggle lets us try the other behavior without a migration.

  Mechanically the toggle is a choice of **which graph feeds adjacency**, not
  whether composition happens. The render pipeline computes hops from the graph
  it is handed, so T06 introduces two values: `renderGraph`, always composed and
  always used for edge visibility, parallel offsets, and drawing; and
  `adjacencyGraph`, which is the authored graph when the toggle is off and
  `renderGraph` when it is on. Feeding only `adjacencyGraph` to `hopsFromPinned`
  and `deriveGraphLayout` is what confines the blast radius.

- **How a reference reads when its definer is out of view.** **Mark it as a
  distinct third state — resolved-but-out-of-view — rather than reusing the
  unresolved marking.** Bounded visibility routinely hides definers, so
  collapsing the two states would make the normal case look like an error. The
  "offer a way to reach it" half is milestone 10's jump-to-definition; milestone
  09 only has to distinguish the state and expose it.

- **Recomputation timing.** **Recompute on description commit, not on
  keystrokes, and no debounce.** The edit sheet holds a local draft and only
  emits `onSave` when the user commits, which milestone 08's T06 stories pin. So
  the natural commit point already exists and there is nothing to debounce:
  descriptions simply do not change between saves. The live preview in the sheet
  covers the "see it as I type" need without touching the graph.

- **Cost on large graphs.** **Extract for every node, not just visible ones, and
  memoize on the description string.** Diagnostics have to know about definers
  that bounded visibility is currently hiding, so a visible-only extraction
  would report false "unresolved" states. The cost is bounded instead by content
  addressing: a node whose description has not changed is never re-extracted,
  and the milestone 08 render cache already dedupes identical expressions.

- **Whether a bundled edge retains enough detail for milestone 10.** **Yes —
  bundle per producer/consumer pair while carrying the list of quantity keys on
  the edge.** Milestone 10 highlights a single quantity by filtering that list at
  render time, which needs no extra structure. Bundling is also what keeps a pair
  carrying five variables from drawing as five near-identical lines.

- **Where defined quantities sit on a compact node.** _(User decision.)_ **A
  chip row in the circular segment below the inscribed square, hidden below a
  screen-size threshold.** The exploration found the node
  is a 400 px circle whose inscribed square (side `d/√2`) is entirely spent on
  the auto-fit title, and whose border ring is already carrying three meanings —
  tag colors as a conic gradient, pinned as border weight plus a white halo, and
  query spotlight as a glow. The band between the square's bottom edge and the
  circle is unclaimed and is `0.146 × d` tall: about 59 px at full size and
  20 px on a hop-3 node. Putting chips there costs the title nothing.

  The threshold matters more than the placement. There is **no level-of-detail
  mechanism on the canvas today** — nothing shows or hides node internals based
  on zoom — so this milestone has to add one. It should key on the node's
  effective on-screen diameter (`layout scale × stage scale`) rather than hop
  count, because a hop-1 node at 0.05 zoom is ~14 px across and a hop-3 node at
  4× zoom is ~550 px. Below the threshold the chips disappear entirely, which is
  also how graphs with no math stay visually unchanged.

## Out of scope (for this plan)

- Everything in milestone 10: tracing, spotlighting, upstream/downstream
  navigation, the quantities panel, query tokens, and the dataflow-only view.
- Numeric evaluation, units, and dimensional analysis. The extracted model must
  leave room for them but this plan computes no values.
- Explicit declaration syntax or a per-node inputs/outputs form. Inference from
  the description is the whole model.
- Renaming a quantity across the graph.
- Multiline or aligned equation environments as definition sources.

## Tasks

> One PR each. Waves 1–4 are pure modules with `server`-project specs and no
> component changes; the canvas is not touched until wave 5.

### T01 — Extract quantity symbols from a MathML tree

|                |                                                             |
| -------------- | ----------------------------------------------------------- |
| **Depends on** | —                                                           |
| **Wave**       | 1                                                           |
| **Agent**      | high-reasoning (claude-opus-5-thinking-high)                |
| **Effort**     | M                                                           |
| **Files**      | new `MathText/lib/mathSymbols.ts`, `mathSymbols.spec.ts`    |
| **PR title**   | `feat(math): extract quantity symbols from rendered MathML` |

Walk the `MathNode` tree from milestone 08's render adapter and return the
symbols an expression mentions, each with a canonical key. Cover a bare
identifier and an identifier with a subscript. Exclude numbers, function names,
and a stoplist of conventional constants passed as a parameter.

Function names are detected **structurally**: the engine emits a U+2061 function
application operator immediately after them. Do not infer from identifier length
or upright styling.

**Acceptance**

- `v_0` and `v_{0}` produce the same key; `\alpha` and a literal `α` do too.
- `\sin x` contributes `x` and not `sin`, via the U+2061 rule rather than a name
  list.
- Nothing inside `mtext` is scanned, including the error-colored `mtext` Temml
  emits for an unknown command (see Notes).
- The stoplist is a parameter with a default, pinned by a test that overrides it.
- An integration spec renders real LaTeX through milestone 08's adapter and
  asserts the extracted keys, rather than asserting against a hand-written tree.

### T02 — Infer definitions and references from one description

|                |                                                                           |
| -------------- | ------------------------------------------------------------------------- |
| **Depends on** | T01                                                                       |
| **Wave**       | 2                                                                         |
| **Agent**      | default (inherit)                                                         |
| **Effort**     | M                                                                         |
| **Files**      | new `Multigraph/lib/nodeQuantities.ts`, `nodeQuantities.spec.ts`          |
| **PR title**   | `feat(graph): infer defined and referenced quantities from a description` |

Combine milestone 08's segmentation with T01. Display math can define; inline
math only references. A definition requires exactly one top-level equality whose
left side is a single symbol, where "top level" means children of the single
`mrow` the engine wraps a multi-token expression in — not the `math` element's
own children. Everything else is a reference. Include the per-node opt-out.

**Acceptance**

- `F = ma` defines `F`; `a + b = c` defines nothing; `x = y = z` defines nothing.
- Inline `$F = ma$` defines nothing but references `F`, `m`, and `a`.
- Multiple display equations in one description each define independently.
- An opted-out node yields no definitions and no references.
- Tunables (opt-out marker, stoplist) are parameters with defaults.

### T03 — Build the graph-wide quantity index

|                |                                                                              |
| -------------- | ---------------------------------------------------------------------------- |
| **Depends on** | T02                                                                          |
| **Wave**       | 3                                                                            |
| **Agent**      | default (inherit)                                                            |
| **Effort**     | M                                                                            |
| **Files**      | new `Multigraph/lib/quantityIndex.ts`, `quantityIndex.spec.ts`               |
| **PR title**   | `feat(graph): build a graph-wide index of defined and referenced quantities` |

Map every quantity key to its definer node ids and consumer node ids across the
graph. Promote a symbol to a tracked quantity only when some node defines it, so
an isolated `E = mc^2` manufactures no references to `m` and `c`. Memoize per
node on the description string so unchanged nodes are never re-extracted.

**Acceptance**

- A symbol referenced but never defined does not appear as a tracked quantity.
- Re-running over a graph with one edited description re-extracts exactly one
  node, asserted through a counting test double.
- Index construction is independent of node order.

### T04 — Derive bundled dataflow edges

|                |                                                                      |
| -------------- | -------------------------------------------------------------------- |
| **Depends on** | T03                                                                  |
| **Wave**       | 4                                                                    |
| **Agent**      | default (inherit)                                                    |
| **Effort**     | M                                                                    |
| **Files**      | new `Multigraph/lib/derivedEdges.ts`, `derivedEdges.spec.ts`         |
| **PR title**   | `feat(graph): derive bundled dataflow edges from the quantity index` |

Emit one directed `EdgeData` per producer/consumer pair, carrying the list of
quantity keys flowing along it. Ids must be deterministic and stable for a pair,
because `edge.id` keys the Svelte each block, parallel-edge slots, enter/exit
animations, and reveal-wave diffing — an id that churns causes visible flicker
and sideways jumps.

**Acceptance**

- A node referencing its own defined quantity produces no self edge.
- A pair carrying three quantities yields one edge listing all three.
- Ids are stable across unrelated edits: adding a node elsewhere leaves every
  existing derived id byte-identical.
- Derived ids are distinguishable from authored ids, so a later filter can
  assert none reach persistence.
- Every derived edge is `directed: true`.

### T05 — Compute dataflow diagnostics

|                |                                                                                 |
| -------------- | ------------------------------------------------------------------------------- |
| **Depends on** | T03                                                                             |
| **Wave**       | 4 (parallel with T04)                                                           |
| **Agent**      | high-reasoning (claude-opus-5-thinking-high)                                    |
| **Effort**     | M                                                                               |
| **Files**      | new `Multigraph/lib/dataflowDiagnostics.ts`, `dataflowDiagnostics.spec.ts`      |
| **PR title**   | `feat(graph): compute unresolved, conflicting, and cyclic dataflow diagnostics` |

Produce per-quantity and per-reference diagnostics: unresolved, out-of-view,
duplicate definition naming the competing nodes, and cycles. Out-of-view takes
the visible node set as a parameter so the module stays pure.

**Acceptance**

- A reference whose definer is outside the visible set reports out-of-view, not
  unresolved — the two are distinct states.
- Duplicate definition names every competing node, not just the first.
- Cycle detection terminates on a self-referential chain and on a two-node loop,
  and reports the participating nodes.
- A diamond dependency is not reported as a cycle.

### T06 — Compose derived edges into the render pipeline

|                |                                                                             |
| -------------- | --------------------------------------------------------------------------- |
| **Depends on** | T04, T05                                                                    |
| **Wave**       | 5                                                                           |
| **Agent**      | high-reasoning (claude-opus-5-thinking-high)                                |
| **Effort**     | L                                                                           |
| **Files**      | `Multigraph.svelte`, `Multigraph/lib/layoutRuntime.svelte.ts`, stories      |
| **PR title**   | `feat(multigraph): compose derived dataflow edges into the render pipeline` |

Introduce `renderGraph` (always composed) and `adjacencyGraph` (authored unless
the layout toggle is on) ahead of the existing `$derived` chain, so bounded
visibility, parallel offsets, occlusion, and enter/exit keep working untouched.
`LayoutRuntime` computes its own visibility and hops and must be handed the same
composed view, or dragging and pin/unpin will disagree with the render.

Authored `graph` stays the mutation and persistence path. Do not let composed
edges reach `commitUserGraph`, `findExistingEdge`, the duplicate-edge dialog, or
`NodeEditSheet`.

**Acceptance**

- A three-node chain shows a derived arrow appear when an equation is added and
  disappear when it is removed.
- With the layout toggle off, adding an equation leaves every node position,
  scale, and visibility unchanged — asserted, not eyeballed.
- Derived edges never appear in an exported save file.
- Drawing an authored edge between a pair that already has a derived edge does
  not trigger the duplicate-edge flow.
- Graphs with no math produce a byte-identical composed edge list.

### T07 — Give derived edges a distinct identity and quantity labels

|                |                                                                             |
| -------------- | --------------------------------------------------------------------------- |
| **Depends on** | T06                                                                         |
| **Wave**       | 6                                                                           |
| **Agent**      | default (inherit)                                                           |
| **Effort**     | M                                                                           |
| **Files**      | `Multigraph.svelte` (edge template and CSS), stories                        |
| **PR title**   | `feat(multigraph): style derived dataflow edges and label their quantities` |

Add a `derived` class alongside the existing `boundary` and `query-spotlight`
classes and style it with its own CSS block. The boundary dash mask is the
precedent to follow; do not fork the edge renderer or add a stroke-style field
to `EdgeData`. Labels reveal with zoom rather than rendering permanently.

**Acceptance**

- Derived and authored edges are visually distinguishable in a story.
- Derived edges always draw directed.
- Labels are absent below the zoom threshold and present above it.
- Existing edge stories (parallel offsets, occlusion, boundary fade) still pass.

### T08 — Show defined quantities on the compact node

|                |                                                                                   |
| -------------- | --------------------------------------------------------------------------------- |
| **Depends on** | T06                                                                               |
| **Wave**       | 6 (parallel with T07; touches `Node/*`, not the edge template)                    |
| **Agent**      | default (inherit)                                                                 |
| **Effort**     | M                                                                                 |
| **Files**      | `Node/NodeCompactContent.svelte`, new `Node/lib/quantityChips.ts` + spec, stories |
| **PR title**   | `feat(node): show defined quantities on the compact node above a zoom threshold`  |

Render defined quantities in the circular segment below the inscribed square, so
the auto-fit title keeps its space. Gate visibility on effective on-screen
diameter with a pure threshold function; there is no level-of-detail mechanism
on the canvas today, so this adds the first one.

Chips must be `pointer-events: none` or stop propagation. Hit testing is
geometric against the node circle, so an interactive chip that does neither
still registers as a node hit and starts a drag.

**Acceptance**

- The threshold function is pure and unit-tested, including the degenerate
  measurements that come from a pre-layout frame.
- Chips are absent on a small node and present on a large one, in stories.
- Title layout is unchanged when a node defines no quantities.
- Dragging a node by a chip moves the node rather than doing nothing.

### T09 — Surface diagnostics where the reference appears

|                |                                                                                 |
| -------------- | ------------------------------------------------------------------------------- |
| **Depends on** | T05, T06                                                                        |
| **Wave**       | 7                                                                               |
| **Agent**      | default (inherit)                                                               |
| **Effort**     | M                                                                               |
| **Files**      | `MathText/MathText.svelte`, `Multigraph/NodeDetailsContent.svelte`, stories     |
| **PR title**   | `feat(math): mark unresolved, out-of-view, and conflicting quantities in place` |

Mark references in the rendered description according to their diagnostic state,
keeping unresolved and out-of-view visually distinct. Offer to create a defining
node from an unresolved reference.

**Acceptance**

- Unresolved, out-of-view, and conflicting states each render distinctly.
- Creating a node from an unresolved reference produces a node that defines it,
  and the derived edge then appears.
- A description with no diagnostics renders exactly as it does today.

## Wave plan

```
Wave 1   T01                 (symbol extraction; everything reads it)
Wave 2   T02                 (per-node inference)
Wave 3   T03                 (graph index; T04 and T05 both need it)
Wave 4   T04  ‖  T05         (edges and diagnostics; independent modules)
Wave 5   T06                 (single integration point; touches shared files)
Wave 6   T07  ‖  T08         (edge template/CSS vs Node components)
Wave 7   T09                 (diagnostics UI; depends on both)
```

Nine tasks, seven gates. Waves 1–4 are pure modules and could be handed to
separate agents with no file contention. T06 is deliberately alone: it is the
only task touching `Multigraph.svelte` and `layoutRuntime.svelte.ts` together.

## Risks and rollback

- **`LayoutRuntime` keeps its own copy of the visibility logic.** It recomputes
  hops and the visible subgraph independently of the `$derived` chain. Compose
  in one place and hand it to both, or dragging and pin/unpin will disagree with
  what is drawn. This is the most likely source of a subtle bug in T06.
- **Derived edge ids churning.** `edge.id` keys list rendering, parallel-edge
  slot ordering, enter/exit animation, and reveal-wave diffing. An id that
  changes when an unrelated node is edited produces flicker and sideways jumps
  that will look like a physics bug. T04 pins stability directly.
- **Turning the layout toggle on changes existing graphs.** Hops feed scaling,
  visibility, physics springs, hop repulsion, and beacon selection. Rollback is
  the toggle itself; keep the default off until real graphs argue otherwise.
- **Extraction cost on large graphs.** Mitigated by memoizing on the description
  string and by recomputing only on save. If it still bites, the fallback is to
  extract lazily per quantity rather than eagerly for the whole graph — a change
  contained to T03.
- **Quantity chips at small scale.** A hop-3 node is ~137 px at zoom 1 and ~7 px
  at minimum zoom. If the threshold proves fiddly, chips can hide entirely below
  a generous size without losing the milestone's value, since the dataflow edges
  carry the same information.

## Definition of Done (this plan)

- All nine tasks merged, satisfying the milestone's acceptance criteria.
- Lint, `svelte-check`, and the unit/browser/story suites pass.
- A graph containing no math is unchanged visually and behaviorally, asserted by
  story coverage rather than inspection.
- No derived edge reaches a save file, the duplicate-edge flow, or the edit
  sheet.
- Plan, milestone, and roadmap statuses updated.

## Notes

- 2026-08-27: Milestone 08 landed first and settled the substrate this plan
  reads. Two findings from it constrain the extractor:
  - Temml reports an unknown command as a **soft** failure — valid MathML with
    the bad token in `<mtext style="color:#b22222;">`. The extractor must not
    read those as identifiers; the existing "never scan literal text spans" rule
    covers it, but the case is easy to miss because the node looks like content.
  - The render adapter returns a plain-object `MathNode` tree alongside markup,
    so extraction is a pure function with a `server`-project spec and needs no
    DOM. This was designed for exactly this milestone.

- 2026-08-27: Edge pipeline findings, from a read-only exploration. These shape
  T06 and T07.
  - The composition point is immediately before the `$derived` chain in
    `Multigraph.svelte` (currently around lines 311–324, starting at
    `resolvedLayoutSettings`). Everything downstream consumes `EdgeData[]`, so a
    valid derived edge needs no API changes anywhere in the render path.
  - `layoutRuntime.svelte.ts` independently recomputes visibility and hops via
    its own `#visibleGraphFor` / `#effectiveHopsFor` during drag, pin/unpin, and
    reveal waves. It must receive the same composed graph. This is the easiest
    thing to miss.
  - `edgeVisibilityForPinnedNeighborhood` reads the **full** edge list so
    boundary half-edges can render, while `deriveGraphLayout` and physics read
    only the visible subgraph. Two different inputs, so the toggle has to be
    applied deliberately rather than by swapping one variable.
  - Edges are already non-interactive: `.edges` is `pointer-events: none` and
    there is no edge hit test. "Derived edges are not selectable for deletion"
    therefore needs no new code.
  - Persistence needs no filter provided derived edges never enter the mutable
    `graph`. `findExistingEdge` already runs against authored data, which is
    exactly where it must stay — a derived pair would otherwise block authored
    edge creation.
  - `.edge.boundary` already does a dashed stroke via a `mask-image` repeating
    gradient. That is the precedent for a `derived` class; `EdgeData` has no
    stroke-style field and does not need one.

- 2026-08-27: Compact node measurements, from a read-only exploration. Useful
  when sizing the quantity chips and their visibility threshold.
  - The circle is a fixed 400 px (`nodeRadiusPx` 200) and is scaled on
    `.node-wrapper`, so everything inside — border, title, future chips —
    scales together. Per-hop scale is `scaleFalloff ** hops` (0.7), floored at
    `minScale` 0.1, and only `displayedLayers` 3 hops render at all.
  - Effective sizes at stage zoom 1: hop 0 is 400 px across with a 38 px title;
    hop 3 is about 137 px with a ~13 px title and a ~97 px inscribed square.
    Stage zoom ranges 0.05–4, so the same hop-3 node spans roughly 7 px to
    550 px on screen. Any always-on chip would be unreadable at the low end.
  - Hit testing is geometric in `Multigraph.getNodeAt` against
    `effectiveHitRadius(visualRadius, minNodeHitRadiusPx)`, not DOM targets, and
    `.stage-content` is `pointer-events: none`. Chips therefore cannot shrink
    the tap target — but an interactive chip that does not stop propagation will
    still register as a node hit and start a drag, the way `.title-input`
    already has to guard against.
  - The compact node renders no description at all today; math lives only in
    `NodeDetailsContent` behind focus. Chips would be the first description-
    derived content on the canvas.
