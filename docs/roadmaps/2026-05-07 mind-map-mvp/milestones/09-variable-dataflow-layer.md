# Milestone 09: Variable dataflow layer

**Status:** not started
**Depends on:** milestone 08 (LaTeX math in node descriptions), milestone 04e
(directed edges), milestone 04k (parallel edge visualization), and milestone 04b
(bounded neighborhood visibility).
**Plan:** [2026-08-27 09-variable-dataflow-layer.md](../plans/2026-08-27%2009-variable-dataflow-layer.md)

## Goal

Make the flow of quantities through a mind map visible. When one node defines a
quantity and another node's math uses it, a directed edge should appear from the
definer to the user, without anyone drawing that edge by hand.

The effect is a spreadsheet's dependency graph made spatial: a node that writes
`v = v_0 + a t` automatically shows inbound arrows from whichever nodes define
`v_0` and `a`, and an outbound arrow to whichever node consumes `v`. Structure
that is currently implicit in the prose becomes navigable graph topology.

Everything is inferred from the description text. There is no new syntax for
authors to learn and no form to fill in: writing the equation is the whole
interaction.

## Scope

### Symbol extraction from rendered MathML

- Identify symbols by walking the MathML that milestone 08 already produces,
  not by pattern-matching LaTeX source. The engine normalizes `v_0` and `v_{0}`
  into identical markup and turns `\alpha` into a single identifier, so symbol
  identity is a structural comparison rather than string normalization. A spike
  during milestone 08 confirmed both cases produce byte-identical output.
- Walk the `MathNode` tree that milestone 08's render adapter returns, rather
  than re-parsing its markup string. The tree is plain objects, so extraction
  stays a pure function with a `server`-project spec and needs no DOM — which
  matters because `DOMParser` does not exist in that environment. Milestone 08
  shaped its adapter contract around this requirement.
- Define a canonical key for a symbol, covering a bare identifier and an
  identifier carrying a subscript.
- Exclude things that look like symbols but are not quantities: function names,
  numbers, and a configurable stoplist of conventional constants. Function names
  are marked structurally rather than heuristically — the engine emits an
  invisible function-application operator (U+2061) directly after them, which is
  a more reliable signal than inspecting identifier length or upright styling.
- Never scan inside literal text spans, so prose embedded in an equation cannot
  create spurious references.
- Keep the extractor pure over the plain tree structure so it is testable in the
  node test project. No browser-side DOM adapter is needed: the render adapter
  hands over the same tree in both environments.

### Definition and reference inference

- Treat only display math as capable of defining a quantity. Inline math can
  reference but never define, which gives authors a predictable rule.
- Infer a definition when a display expression has exactly one top-level
  equality and its left side is a single symbol. `F = ma` defines `F`;
  `a + b = c` defines nothing. "Top level" means the children of the single
  `<mrow>` the engine wraps a multi-token expression in, not the `<math>`
  element's own children.
- Treat every other symbol occurrence as a reference.
- Promote a symbol to a tracked variable only when some node defines it.
  Unclaimed symbols stay ordinary math, so writing `E = mc^2` in isolation does
  not manufacture references to `m` and `c`.
- Expose the tunables that govern these rules as parameters, so tests can pin
  them and a future settings surface can expose them.
- Provide an opt-out so a node can be excluded from dataflow entirely, for
  worked examples and scratch notes that reuse common letters.

### Derived dataflow edges

- Compute dataflow edges from node descriptions instead of storing them, so
  they can never drift from the math they describe and cannot be orphaned by
  editing.
- Compose derived edges with authored edges once, ahead of the existing render
  pipeline, so parallel-edge offsets, occlusion fade, and bounded visibility
  keep working without special cases.
- Keep all graph mutations operating on authored data only. Derived edges are
  not selectable for deletion and never enter a save file.
- Bundle one derived edge per producer/consumer pair while retaining the list
  of quantities flowing along it, so a pair carrying several variables reads as
  one arrow rather than a bundle of near-identical lines.
- Give derived edges a distinct visual identity from authored edges, and always
  draw them directed.
- Let the user toggle the dataflow layer off, and decide whether derived edges
  participate in hop distance and layout.

### Making dataflow legible on the canvas

- Show a node's defined quantities on the compact node itself, so dataflow is
  readable at graph scale without focusing every node in turn.
- Label derived edges with the quantities they carry, revealing detail as zoom
  increases rather than rendering permanent clutter.
- Keep both surfaces quiet for graphs that contain no math at all.

### Diagnostics

- Mark a reference whose definer exists but is currently outside the visible
  neighborhood as out of view rather than undefined, and offer a way to reach
  it.
- Mark a reference with no definer anywhere as unresolved, and offer to create
  a node that defines it. An unresolved quantity is an invitation to extend the
  graph, not an error to suppress.
- Flag a quantity defined by more than one node as a conflict, naming the
  competing nodes.
- Detect cycles in the dataflow graph and surface them, since a quantity
  defined in terms of itself is usually a modeling mistake.

## Acceptance criteria

- Pure specs cover symbol canonicalization, including subscript forms, Greek
  letters, function-name exclusion, and the constant stoplist.
- Pure specs cover definition inference, including single-symbol left sides,
  rejected multi-symbol left sides, multiple definitions in one description,
  inline math never defining, and text spans never contributing symbols.
- Pure specs cover derived edge composition: producer-to-consumer direction,
  bundling of multiple quantities onto one pair, self-reference producing no
  edge, and stability of derived edge identity across unrelated edits.
- Pure specs cover the diagnostics: unresolved, out-of-view, duplicate
  definition, and cycle detection.
- An integration spec renders real LaTeX through the milestone 08 engine and
  asserts the extracted symbols, proving the extractor matches actual engine
  output rather than hand-written fixtures.
- Story coverage shows a three-node chain where editing one node's equation
  makes a dataflow arrow appear, and removing the equation makes it disappear.
- Story coverage shows defined quantities on compact nodes and quantity labels
  on derived edges.
- Story coverage shows unresolved, conflicting, and cyclic states rendering
  their diagnostics.
- Derived edges never appear in exported save files, and never reach the
  duplicate-edge removal flow when the user draws an authored edge between the
  same pair.
- Graphs containing no math are visually and behaviorally unchanged.
- Lint, check, and unit/browser/story tests pass.

## Non-goals

- Numeric evaluation, computer algebra, or dependency-ordered recalculation.
- Units or dimensional analysis.
- Explicit variable declaration syntax, sigils, or a per-node inputs/outputs
  form. Inference from the description is the whole model for this milestone.
- Namespacing or scoping quantities by tag or subgraph. The conflict badge is
  the collision remedy until real graphs show it is insufficient.
- Tracing, spotlighting, upstream/downstream navigation, a variables panel, or
  search integration. That is milestone 10.
- Renaming a quantity everywhere at once.
- Multiline or aligned equation environments as definition sources.

## Risks and open questions

To be resolved in the plan.

- **Inference has no escape hatch inside math.** With no reference syntax,
  the only ways to suppress a link are the text-span rule and the per-node
  opt-out. The plan should confirm those are sufficient and decide whether a
  graph-level ignore list is needed at launch.
- **Symbol collisions across unrelated regions of a large graph.** The same
  letter meaning different things in different corners is the core risk of
  inference. The plan should decide how aggressively to surface conflicts, and
  whether reuse of an undefined letter is silent.
- **Derived edges feeding layout changes existing behavior.** Adjacency
  currently drives hop distance, scaling, and bounded visibility, and treats
  edges as undirected. Including derived edges would pull consumers toward
  definers and could change which nodes are visible. The plan should decide
  whether this is on by default.
- **Definer visibility versus reference visibility.** Bounded visibility can
  hide a definer while its consumer is on screen. The plan should decide how a
  reference to an out-of-view definer reads so it is not mistaken for an error.
- **Recomputation timing.** Recomputing on every keystroke would make the graph
  thrash while typing, given enter/exit animations on edges. The plan should
  decide the commit point and any debounce.
- **Cost on large graphs.** Extraction requires rendering each description's
  math. The plan should decide what is cached, what is keyed on, and whether
  extraction is limited to visible nodes.
- **Compact node space is already contested.** Titles auto-fit an inscribed
  square and borders already encode tags. The plan should decide where defined
  quantities sit without harming title legibility.
- **Bundled edges versus per-quantity edges.** Bundling keeps the canvas calm
  but complicates highlighting a single quantity later. The plan should confirm
  the bundled edge retains enough detail for milestone 10.

## References

- Milestone 08 supplies the rendering substrate this milestone reads.
- Existing derived render layers to follow as precedent:
  `Multigraph/lib/boundedVisibility.ts`, `Multigraph/lib/parallelEdges.ts`,
  `Multigraph/lib/beacons.ts`.
- Authored edge model and mutations: `Multigraph/lib/graph.ts`,
  `types/edge.ts`.
