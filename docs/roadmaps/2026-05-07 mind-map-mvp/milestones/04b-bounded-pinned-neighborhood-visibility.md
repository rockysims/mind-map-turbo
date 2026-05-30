# Milestone 04b: Bounded pinned-neighborhood visibility

**Status:** not started
**Depends on:** milestones 01 (pinning and immutable graph mutations), 02
(hop-distance layout), 04 (local persistence), and 04a (current layered
pin relayout behavior to simplify).
**Plan:** _none yet._

## Goal

Make large graphs usable by rendering the useful neighborhood around pinned
nodes, rather than progressively revealing Fibonacci hop batches. The user
should see all currently visible nodes animate together toward their new
positions, while boundary edges hint that more graph exists just outside
the displayed range.

## Scope

### Visibility model

- Replace the Fibonacci reveal concept with a `displayedLayers` setting
  associated with the graph view. Default to a conservative value during
  the plan (the TODO suggests `10`).
- A node is visible when it is within `displayedLayers` hops of at least
  one pinned node.
- Edges from visible nodes to nodes at exactly `displayedLayers + 1` hops
  render as boundary hints: the edge is visible near the in-range node and
  fades out halfway toward the out-of-range endpoint.
- Nodes beyond `displayedLayers` are not rendered.

### Relayout behavior

- Keep the current layer-by-layer layout influence model if it still
  produces stable results, but run it in memory only.
- The rendered graph updates as one visible set: all visible nodes animate
  to their new positions together.
- Remove the old relayout-only half-opacity treatment. Visibility and
  boundary fade communicate the same concept more directly.

### Settings

- Add a configurable `displayedLayers` value near the existing layout
  settings.
- Keep tunables as explicit parameters with defaults in pure modules.

## Acceptance Criteria

- Unit specs cover visible node selection for:
  - no pinned nodes,
  - one pinned node,
  - multiple pinned nodes with overlapping neighborhoods,
  - disconnected nodes,
  - boundary edges at `displayedLayers + 1`.
- Unit specs cover boundary-edge fade metadata separately from node
  visibility.
- Existing layout and scale behavior still works for the visible subgraph.
- Story coverage shows a multi-hop chain where distant nodes disappear and
  boundary edges fade out.
- Story coverage shows repinning from one anchor to another animates the
  full visible set together.
- Lint, check, and unit tests pass.

## Non-goals

- Search, minimap, or "show hidden neighbors" UI.
- Server-side visibility pruning.
- Rich edge rendering beyond the boundary fade.

## Risks and Open Questions

- **No pinned nodes.** Decide in the plan whether to show all nodes,
  show the previous visible set, or choose a default anchor. Preserve the
  least surprising current behavior if possible.
- **Boundary-edge semantics.** An edge may connect two visible nodes even
  when one endpoint is also a boundary for another pinned neighborhood.
  The pure visibility API should make this unambiguous.
- **Current milestone 04a behavior.** This milestone intentionally replaces
  the Fibonacci and dimming UX delivered in milestone 04a; the plan should
  delete obsolete state rather than layering another mode on top.
