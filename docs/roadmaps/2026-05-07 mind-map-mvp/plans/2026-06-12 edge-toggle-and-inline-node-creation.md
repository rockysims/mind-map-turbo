# Plan: Edge toggle and inline node creation

**Created:** 2026-06-12
**Author:** Cursor agent
**Milestone:** [milestones/04d-edge-toggle-and-inline-node-creation.md](../milestones/04d-edge-toggle-and-inline-node-creation.md)
**Status:** done
**Total estimated effort:** M–L

## Summary

This plan makes edge creation reversible when the attempted edge already
exists, then removes the placeholder-title moment from background node
creation by focusing an inline title editor immediately.

## Open questions resolved

- **Edge identity.** **Treat duplicate-edge matching as undirected until
  directed edges land in milestone 04e.** The graph currently renders and
  navigates edges without direction semantics, so `n0 -> n1` and `n1 -> n0`
  should count as the same user-visible edge for this milestone.
- **Dialog primitive.** **Keep the confirmation local to `Multigraph` with
  accessible dialog markup.** There is no reusable confirmation component in
  the UI layer yet; a small local dialog avoids introducing a shared primitive
  before a second caller exists.
- **Input placement.** **Render the inline editor inside the existing
  closed-node title square and size it to the final title area.** This keeps
  the node circle and layout coordinates stable while editing, with only text
  wrapping/overflow behavior changing inside the node.
- **Empty title fallback.** **Centralize the fallback as `New Node` and use
  it from both inline editing and the edit sheet.** `addNode` already creates
  new nodes with `New Node`; sharing that fallback resolves the current
  mismatch with the edit sheet's local `Untitled node` constant.

## Out of scope (for this plan)

- Directed edge semantics and arrow rendering from milestone 04e.
- A reusable app-wide modal/dialog component.
- Rich title formatting, multiline title editing, or description editing
  inline.
- Bulk edge editing or multi-node selection.

## Tasks

> Each task is one PR's worth of work. If a task feels like more than one
> logical commit, split it. The PR title is drafted up front so reviewers
> (and the model writing the commit) start aligned.

### T01 done — Add pure edge lookup and title fallback helpers

|                |                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                            |
| **Wave**       | 1                                                                                            |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)                                      |
| **Effort**     | S                                                                                            |
| **Files**      | `Multigraph/lib/graph.ts`, `Multigraph/lib/graph.spec.ts`, `Multigraph/NodeEditSheet.svelte` |
| **PR title**   | `feat(graph): add duplicate edge lookup and node title fallback`                             |

Add a pure helper that returns the existing edge for a source/target pair,
matching undirected for now, plus a shared `normalizeNodeTitle`/fallback
constant used by `addNode`, `updateNodeContent`, and `NodeEditSheet`.

**Acceptance**

- Specs cover duplicate lookup for same-order and reversed endpoints.
- Specs cover no match when either endpoint is missing or unrelated.
- Specs prove `removeEdge` and title normalization return new graph data
  without mutating the original graph.
- Empty title saves from the edit sheet render as `New Node`.

### T02 done — Confirm and remove duplicate edge creation

|                |                                                         |
| -------------- | ------------------------------------------------------- |
| **Depends on** | T01                                                     |
| **Wave**       | 2                                                       |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`) |
| **Effort**     | M                                                       |
| **Files**      | `Multigraph.svelte`, `Multigraph.stories.svelte`        |
| **PR title**   | `feat(multigraph): confirm duplicate edge removal`      |

When double-click-dragging from one node to another would create an existing
edge, open a small confirmation dialog instead of mutating immediately.
Confirm removes the matched edge with `removeEdge`; cancel closes the dialog
and leaves graph data unchanged.

**Acceptance**

- Story `UserConfirmsDuplicateEdgeRemoval` shows a duplicate edge gesture
  opens the dialog and only removes the edge after confirm.
- Story `UserCancelsDuplicateEdgeRemoval` shows cancel leaves the edge
  rendered.
- The dialog has an accessible name, focusable confirm/cancel buttons, and
  closes on cancel without affecting action-menu/edit-sheet overlays.
- Non-duplicate edge creation still adds an edge as before.

### T03 done — Add inline title editing mode to `Node`

|                |                                                          |
| -------------- | -------------------------------------------------------- |
| **Depends on** | T01, T02                                                 |
| **Wave**       | 3                                                        |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)  |
| **Effort**     | M                                                        |
| **Files**      | `Node/Node.svelte`, `Multigraph.svelte`                  |
| **PR title**   | `feat(node): support inline title editing for new nodes` |

Extend `Node.svelte` with a closed-node editing mode that renders a focused
title input. Track `titleEditNodeId` in `Multigraph`, commit title changes
through the existing `updateNodeContent` plus the T01 title fallback on
blur/click-away/Enter, and stop pointer propagation from the input so Stage
gestures do not begin while editing. No new `graph.ts` logic is needed —
`updateNodeContent` already exists and the fallback lands in T01.

`titleEditNodeId` is UI-only state with an explicit lifecycle: set it in
`handleNodeDoubleClickDropOntoBackground` after the graph commit, clear it on
commit/click-away, and also clear it in `closeOverlays()` alongside
`actionMenu`/`editNodeId` so it never lingers stale.

**Depends on T02** only to avoid a same-wave edit conflict on
`Multigraph.svelte`; there is no logical dependency between the dialog and
inline editing.

**Acceptance**

- Creating a background node sets `titleEditNodeId` to the new node id after
  the graph is committed.
- The inline input receives focus after render and commits a typed title to
  plain node text on blur or Enter.
- Empty inline input commits as `New Node`.
- Pointer and click events on the input do not trigger Stage drag/drop
  callbacks.
- `closeOverlays()` clears `titleEditNodeId`.
- Existing edit-sheet title/description editing still works.

### T04 done — Add integrated story coverage for inline creation

|                |                                                         |
| -------------- | ------------------------------------------------------- |
| **Depends on** | T03                                                     |
| **Wave**       | 4                                                       |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`) |
| **Effort**     | S                                                       |
| **Files**      | `Multigraph.stories.svelte`                             |
| **PR title**   | `test(multigraph): cover inline title creation flows`   |

Add Storybook play coverage for the full background-node creation path so the
behavior is tested through the same gesture surface users exercise.

**Acceptance**

- Story `UserCreatesNodeAndNamesItInline` double-click-drags to background,
  asserts focus is in the inline title input, types a title, commits, and
  sees the final plain text.
- Story `UserLeavesInlineTitleEmpty` commits an empty value and sees
  `New Node`.
- Story `InlineTitleInputDoesNotStartStageDrag` interacts with the input and
  asserts via the rendered DOM that no drag occurred: the node's `data-x` /
  `data-y` are unchanged and no extra node or edge is created. (These stories
  render `Stage` directly, so there is no `StageHarness`/`data-last-*` surface
  to assert on — assert on the node/edge DOM instead.)

## Wave plan

```
Wave 1   T01                 (pure helpers and shared fallback)
Wave 2   T02                 (duplicate-edge dialog; edits Multigraph.svelte)
Wave 3   T03                 (inline editor; also edits Multigraph.svelte, so it follows T02)
Wave 4   T04                 (integration stories depend on inline editor behavior)
```

Total: 4 tasks, fully sequential. T02 and T03 are logically independent but
both edit `Multigraph.svelte`, so they are serialized to avoid a same-wave
file conflict rather than parallelized.

A simple invariant to check before kicking off a wave: every task in the
wave has all its `Depends on` items already merged to `main`.

## Risks and rollback

- **Undirected duplicate matching may conflict with 04e.** Keep the helper
  named around "existing edge" rather than "directed edge" and document the
  temporary undirected behavior in its spec; 04e can change one helper instead
  of touching component code.
- **The local dialog could grow into a shared primitive too early.** Keep it
  private to `Multigraph`; extract only if another milestone needs the same
  confirmation shape.
- **Inline input focus can race Svelte rendering.** Use the existing
  `requestAnimationFrame` focus pattern from `NodeEditSheet`, and let the
  story assert focus after render.
- **If T01's title fallback shape is wrong**, both editing surfaces inherit
  it. Mitigation: keep the helper tiny, directly covered by specs, and review
  T01 before starting T03/T04.

## Definition of Done (this plan)

The plan is done when:

- All 4 tasks are merged to `main`.
- The acceptance criteria from the milestone doc are satisfied.
- `pnpm --filter mind-map-sv lint` passes.
- `pnpm --filter mind-map-sv check` passes.
- `pnpm --filter mind-map-sv test:unit -- --run` passes.
- Plan status is `done`, milestone status is `complete`, and roadmap status
  for the milestone is `complete` with a link back to this plan.

## Notes

- 2026-06-12: Existing `graph.ts` already has immutable `addEdge`,
  `removeEdge`, `addNode`, and `updateNodeContent`; this plan extends those
  helpers instead of reintroducing a mutation API.
