# Milestone 10: Dataflow tracing and navigation

**Status:** not started
**Depends on:** milestone 09 (variable dataflow layer), milestone 05
(filter/find/search query roles), and milestone 06d (focus controller).
**Plan:** _none yet._

## Goal

Turn the dataflow layer from something you look at into something you follow.
Once quantities and their edges exist, the questions people actually ask are
"where does this come from?", "what breaks if I change this?", and "where is
this used?" — and none of those are answerable by staring at a static graph.

This milestone adds the interactions that answer them: touch a quantity and see
it light up everywhere it appears, walk the chain upstream to its origins or
downstream to everything that depends on it, and jump straight to the node that
defines it.

Most of the machinery already exists. The find/filter work in milestone 05
established per-element query roles that dim, spotlight, and exclude nodes and
edges at render time, and the focus controller already knows how to bring a
node to the center. Tracing is largely a matter of computing role assignments
from the dataflow graph instead of from a text query.

## Scope

### Trace a quantity

- Selecting a rendered quantity anywhere in a description highlights every
  occurrence of that same quantity across the graph, spotlights the node that
  defines it, emphasizes the derived edges carrying it, and quiets everything
  else.
- Work on touch as a first-class input, not as a hover fallback, in keeping
  with the project's mobile-first gesture rule.
- Make quantities visibly interactive so their affordance is discoverable
  without hovering.
- Clear the trace with an obvious gesture and on the same paths that clear an
  active search.
- Decide how tracing composes with an active search query rather than letting
  the two silently fight.

### Walk the dependency chain

- From a node, trace upstream to every node it transitively depends on, and
  downstream to every node that transitively depends on it.
- Distinguish direct neighbors from more distant ancestors or descendants, so
  a long chain does not read as one undifferentiated blob.
- Terminate cleanly on cycles rather than looping.
- Offer both directions from the node action menu so the feature is
  discoverable without knowing a gesture.

### Jump to a definition

- Move from a reference to the node that defines it in one step, including
  when that node is currently outside the visible neighborhood.
- Reuse the existing focus and camera navigation rather than inventing a
  second way to move the viewport.
- Leave the user able to get back to where they were.

### Quantities panel

- List every quantity in the graph with its defining node and how many nodes
  consume it.
- Surface the milestone 09 diagnostics — unresolved, conflicting, and cyclic
  quantities — as a review surface rather than something only visible by
  stumbling across the node.
- Make each entry a navigation target that traces or jumps.
- Follow the existing side-panel patterns rather than introducing new chrome.

### Query integration

- Add a query token for quantities alongside the existing node-tag, edge-tag,
  and text tokens, so dataflow participates in saved and shared queries.
- Support the existing token modes so a quantity can be spotlighted, focused,
  or excluded like any other token.
- Keep the tag syntax configurable rather than hard-coding a new sigil.

### Dataflow-only view

- Let the user view the dataflow layer in isolation, hiding authored edges, to
  read the computation structure without conceptual clutter.
- Make the mode obvious while active and trivial to leave.

## Acceptance criteria

- Pure specs cover upstream and downstream transitive closure, including
  depth labeling, cycle termination, disconnected quantities, and diamond
  dependencies where two paths reconverge.
- Pure specs cover mapping a traced quantity onto query roles for nodes and
  edges, and the composition rule between a trace and an active query.
- Pure specs cover parsing the new quantity token, including its interaction
  with existing token sigils and configurable tag syntax.
- Story coverage shows selecting a quantity spotlighting its definer,
  its consumers, and the edges between them while other nodes recede.
- Story coverage shows upstream and downstream traces from a node in a chain
  at least three nodes deep, and correct termination on a cycle.
- Story coverage shows jumping from a reference to a definer that is outside
  the visible neighborhood.
- Story coverage shows the quantities panel listing quantities with their
  definers, consumer counts, and diagnostic states, and navigating from an
  entry.
- Tracing works by touch with no hover dependency, and tap targets remain
  usable at small node scales.
- Tracing and navigation never mutate graph data.
- Graphs containing no math show no new affordances.
- Lint, check, and unit/browser/story tests pass.

## Non-goals

- Numeric evaluation, units, or sensitivity analysis.
- Renaming a quantity across the graph, or any other dataflow-driven mutation.
- Auto-layout that arranges nodes into dependency order or layers.
- Exporting the dataflow graph to an external format.
- A separate dataflow-only document mode or a second canvas.
- Cross-document quantity references.
- Undo/redo for trace state; traces are transient view state.

## Risks and open questions

To be resolved in the plan.

- **Sigil collision in the query language.** The existing query syntax already
  uses distinct sigils for node tags and edge tags, and the description syntax
  from milestone 08 claims the dollar sign for math. The plan should choose a
  quantity token sigil that collides with neither and fits the configurable tag
  syntax.
- **Trace versus active query.** Both assign roles to the same elements. The
  plan should decide whether a trace replaces, intersects with, or layers over
  an active search rather than leaving precedence implicit.
- **Discoverability without hover.** Quantities must look interactive on touch
  devices where hover does not exist, without turning every equation into a
  field of buttons. The plan should decide the affordance.
- **Tap targets inside scaled math.** Rendered symbols sit inside several
  nested transform scales and can be far smaller than the project's minimum tap
  target. The plan should decide how selection works at small scales.
- **Traces can span hidden nodes.** Bounded visibility may hide most of a
  dependency chain. The plan should decide whether tracing temporarily reveals
  the chain, summarizes what is hidden, or moves the camera.
- **Closure cost on large graphs.** The plan should decide whether closures are
  computed eagerly for the whole graph or lazily per trace, and what is cached.
- **Transient state ownership.** Trace state is view state, not graph state.
  The plan should decide where it lives so it does not leak into persistence or
  the focus stack.

## References

- Query roles and panel precedent: `Multigraph/lib/graphQuery.ts`,
  `Multigraph/GraphQueryPanel.svelte`, `Multigraph/TagColorLegend.svelte`.
- Camera and focus navigation: `Multigraph/lib/focusController.svelte.ts`.
- Milestone 09 supplies the dataflow graph and diagnostics this milestone
  navigates.
