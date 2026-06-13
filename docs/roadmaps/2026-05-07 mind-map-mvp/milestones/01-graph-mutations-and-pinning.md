# Milestone 01: Graph mutations and pinning

**Status:** complete
**Plan:** [2026-05-15 01-graph-mutations-and-pinning.md](../plans/2026-05-15 01-graph-mutations-and-pinning.md)

## Goal

Establish the canonical, immutable mutation API for `MultigraphData`,
add the `pinned` flag to the node model, and route every state change
through pure functions with unit tests. After this milestone, the only
way the graph changes is via a function in `lib/graph.ts`.

This is the keystone milestone — every later milestone (layout,
persistence, multiplayer, search) consumes the API shaped here.

## Scope

- New `apps/mind-map-sv/src/lib/components/ui/Multigraph/lib/graph.ts`
  with pure, immutable mutation functions:
  - `addNode(data, partial): MultigraphData`
  - `removeNode(data, id): MultigraphData` (also removes incident edges)
  - `addEdge(data, sourceId, targetId, color?): MultigraphData`
  - `removeEdge(data, edgeId): MultigraphData`
  - `togglePinned(data, id): MultigraphData`
  - `moveNode(data, id, point): MultigraphData`
  - `neighborsOf(data, id): NodeData[]`
- Add `pinned?: boolean` to `NodeData` in `types/node.ts`.
- Wire `Multigraph.svelte` to call these instead of mutating
  `multigraphData` in place. Replace the in-place assignment in
  `handleNodeMoved` with `moveNode(...)`.
- Treat **double-click / double-tap = `togglePinned`**. Re-purpose the
  existing `onNodeMakePrimary` callback rather than inventing a new
  gesture. "Primary" becomes the most-recently-pinned node (or the only
  pinned node, if any).
- Visual treatment for a pinned node in `Node.svelte` (e.g. a thicker
  border, accent color, or a small "pin" indicator). Keep it minimal —
  full styling polish comes in milestone 03.
- Extend `testFixtures.makeGraph` to accept a `pinned` array.

## Acceptance criteria

- All mutation functions have a colocated `graph.spec.ts` with at least
  the following coverage:
  - Add/remove leaves the graph internally consistent (no orphaned edges
    after `removeNode`; idempotency on missing ids).
  - Toggle pinned flips the flag and is its own inverse.
  - `moveNode` returns a new object; original is unchanged
    (immutability check).
- `Multigraph.svelte` no longer mutates props in place. (Confirmed by
  inspection plus by `Multigraph.stories.svelte` reading the value
  before and after a callback.)
- New / updated stories:
  - "User double-taps a node and it becomes pinned (visual indicator
    appears)."
  - "User double-taps a pinned node and it becomes unpinned."
  - "User double-tap-drags from one node to another and an edge appears."
  - "User double-tap-drags from a node to background and a new
    connected node appears."
- Definition of Done in `.cursor/rules/core.mdc` is satisfied.

## Non-goals

- **Layout / scaling / repulsion.** Those land in milestone 02. Pinned
  nodes look pinned, but neighbors don't yet shrink. The graph still
  shows only the primary node.
- **Editing node title/description from the UI.** Milestone 03.
- **Undo/redo UI.** The immutable mutations _enable_ it but the UI is
  out of scope.
- **Persistence.** Mutations live only in memory.

## Risks and open questions

- **Multiple pinned nodes vs single primary.** Current `Multigraph.svelte`
  renders only one "primary" node. Switching to "render all nodes,
  highlight pinned ones" is a step further than this milestone. Decision
  to make in the plan: do we render all nodes now (with naive layout)
  or wait until milestone 02 wires up real layout? Recommendation: render
  all nodes with placeholder positions in milestone 01 so milestone 02
  is purely about _how_ they're laid out.
- **Position generation for new nodes.** When `addNode` is called from
  a double-tap-drag-to-background gesture, what's the initial position?
  Decision in the plan; likely "drop point in stage-local coordinates".
- **Edge id collisions.** `addEdge` needs an id strategy. Likely
  `crypto.randomUUID()` or a monotonic counter — pick in the plan.
- **Drop-onto-self semantics.** Today `Stage.svelte` routes a
  double-tap-drag onto the source node to
  `onNodeDoubleClickDropOntoBackground` (i.e. treats it the same as
  drop-on-empty-space). The story test in
  `Multigraph/Stage.stories.svelte` (SingleNode) carries a TODO
  pointing at this milestone to finalize. Three options: (a) keep
  current — drop-on-self = drop-on-background = add new connected
  node; (b) make drop-on-self a no-op; (c) create a self-loop edge.
  Decide in the plan.

## References

- `.cursor/rules/typescript.mdc` (immutability + configurable defaults).
- `.cursor/rules/tests.mdc` (decision tree for spec vs story).
- Existing patterns: `Multigraph/lib/graphMath.ts`, `hitTest.ts`.
