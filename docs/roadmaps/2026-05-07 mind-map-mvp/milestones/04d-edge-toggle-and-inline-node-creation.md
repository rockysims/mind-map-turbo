# Milestone 04d: Edge toggle and inline node creation

**Status:** not started
**Depends on:** milestones 01 (graph mutation API) and 03 (editing UX).
**Plan:** [plans/2026-06-12 edge-toggle-and-inline-node-creation.md](../plans/2026-06-12%20edge-toggle-and-inline-node-creation.md)

## Goal

Make graph creation feel faster and more intentional. Repeating an edge
creation gesture should remove the existing edge after confirmation, and
newly created nodes should be named inline immediately instead of briefly
showing a generic label.

## Scope

### Existing-edge toggle

- When the user adds an edge that already exists, show a small
  confirmation dialog.
- Confirming removes the edge. Canceling leaves the graph unchanged.
- Keep the mutation itself in pure graph logic and test it independently
  from the dialog.

### Inline title entry for new nodes

- When a new node is created by double-click-dragging to the background,
  render an inline title input on that node.
- Focus the input immediately so the user can type.
- Commit on blur or click-away. Enter may also commit if it stays simple.
- Track the editing target in UI-only state in `Multigraph` with a
  `titleEditNodeId`-style value.
- Extend `Node.svelte` with an editing mode.
- Stop pointer propagation from the inline input so `Stage` does not start
  a drag while the user is typing or selecting text.
- Unify the empty-title fallback with the edit sheet's `New Node` behavior.

## Acceptance Criteria

- Pure graph specs cover existing-edge detection and edge removal without
  mutating the original graph.
- Story coverage shows adding an existing edge opens confirmation and only
  removes the edge after confirm.
- Story coverage shows canceling the dialog leaves the edge in place.
- Story coverage shows creating a node focuses the inline title input,
  committing a typed title renders plain text afterward.
- Story coverage shows empty inline input falls back to `New Node`.
- Stage drag gestures do not fire when interacting with the inline input.
- Lint, check, and unit tests pass.

## Non-goals

- Bulk edge editing.
- Multi-node selection.
- Rich title formatting.

## Risks and Open Questions

- **Edge identity.** Decide in the plan whether directed edges from
  milestone 04e affect duplicate-edge matching immediately or only after
  direction lands.
- **Dialog primitive.** Reuse an existing small confirmation pattern if
  one exists; otherwise keep the dialog local and accessible.
- **Input placement.** The inline title editor should respect existing
  node sizing and not trigger layout jumps larger than the final label.
