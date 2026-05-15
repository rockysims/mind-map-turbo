<!--
This is the canonical template for milestone plans. Copy it to
  docs/roadmaps/<roadmap>/plans/<YYYY-MM-DD> <plan-name>.md
and replace the placeholder content with your milestone's specifics.

A plan answers HOW we deliver a milestone (the milestone doc says WHAT
and WHY). Do not duplicate milestone scope or acceptance criteria; link
back to the milestone and add only the task-level detail needed to execute.
It exists to:
- Resolve the milestone's open questions before code is written.
- Decompose the work into PR-sized tasks.
- Annotate every task with what kind of AI agent / model fits best.
- Lay out which tasks can run in parallel vs. must run in sequence.

Format conventions are documented in .cursor/rules/plans.mdc.
Delete this comment block when filling in the template.
-->

# Plan: <plan name, e.g. "Graph mutations and pinning">

**Created:** <YYYY-MM-DD>
**Author:** <name or "Cursor agent">
**Milestone:** [milestones/<NN>-<name>.md](../milestones/<NN>-<name>.md)
**Status:** draft / executing / done
**Total estimated effort:** <S / M / L>

## Summary

One or two sentences describing what this plan delivers and why now.

## Open questions resolved

Carry over every open question from the milestone doc and write the
decision in **bold**, with a one-sentence rationale.

- **Edge id strategy.** Use `crypto.randomUUID()`. Cheap, collision-free,
  no shared counter to coordinate with future multiplayer work.
- **Drop-onto-self semantics.** **Treat as drop-onto-background** (i.e.
  add a new connected node from the source). Keeps gesture vocabulary
  small; self-loop edges are out of scope until a real use case appears.
- **Render-all-nodes vs. only-primary.** **Render all nodes now**, with
  naive layout (centered for primary, jittered offset for the rest).
  Milestone 02 will replace the layout; touching the rendering path
  here lets us add story coverage for "many nodes visible" up front.

## Out of scope (for this plan)

Things this plan deliberately defers, even though they touch nearby
code. Use this section to head off scope creep.

- BFS-based scaling and overlap repulsion (milestone 02).
- Edit sheet / long-press menu (milestone 03).
- Persistence — mutations remain in-memory only (milestone 04).

## Tasks

> Each task is one PR's worth of work. If a task feels like more than
> one logical commit, split it. The PR title is drafted up front so
> reviewers (and the model writing the commit) start aligned.

### T01 — Add `pinned` to NodeData and extend testFixtures

|                |                                                                    |
| -------------- | ------------------------------------------------------------------ |
| **Depends on** | —                                                                  |
| **Wave**       | 1                                                                  |
| **Agent**      | fast/cheap (composer-2-fast or kimi-k2.5)                          |
| **Effort**     | XS                                                                 |
| **Files**      | `types/node.ts`, `lib/testFixtures.ts`, `lib/testFixtures.spec.ts` |
| **PR title**   | `feat(graph): add pinned flag to NodeData and fixtures`            |

Add `pinned?: boolean` to `NodeData`. Extend `MakeGraphInput` with
`pinned?: Array<number | string>` and decorate generated nodes
accordingly. Add a fixture spec covering `pinned: [0]` and
`pinned: ['n1']`.

**Acceptance**

- `tsc` and `svelte-check` clean.
- New fixture spec passes; existing testFixtures specs still pass.
- No call sites broken (search for `NodeData{` usages).

### T02 — Pure mutation API in `lib/graph.ts`

|                |                                                                     |
| -------------- | ------------------------------------------------------------------- |
| **Depends on** | T01                                                                 |
| **Wave**       | 2                                                                   |
| **Agent**      | default (claude-4.6-sonnet)                                         |
| **Effort**     | M                                                                   |
| **Files**      | new `lib/graph.ts`, new `lib/graph.spec.ts`                         |
| **PR title**   | `feat(graph): add pure mutation API (add/remove/move/togglePinned)` |

Implement `addNode`, `removeNode`, `addEdge`, `removeEdge`,
`togglePinned`, `moveNode`, `neighborsOf`. All immutable: each returns
a new `MultigraphData`.

**Acceptance**

- Spec covers immutability (`expect(orig).toBe(orig)` after mutation).
- `removeNode` removes incident edges (covered with a 3-node, 2-edge
  fixture).
- `togglePinned` is its own inverse.
- Idempotency on missing ids: each remove is a no-op for unknown id.

### T03 — Wire `Multigraph.svelte` to mutation API and render all nodes

|                |                                                              |
| -------------- | ------------------------------------------------------------ |
| **Depends on** | T02                                                          |
| **Wave**       | 3                                                            |
| **Agent**      | default (claude-4.6-sonnet)                                  |
| **Effort**     | M                                                            |
| **Files**      | `Multigraph.svelte`, `Multigraph.stories.svelte`             |
| **PR title**   | `refactor(multigraph): route state changes through graph.ts` |

Replace in-place position assignment in `handleNodeMoved` with
`moveNode(...)`. Render all nodes with a placeholder layout (jittered
offsets around the primary). Pinned nodes get a thicker border.

**Acceptance**

- Existing stories still pass.
- New story `MultiNodeBasic` covers a 5-node graph rendering.
- A11y: each node has `data-node-id` and a clear focus ring.

### T04 — Repurpose double-tap to `togglePinned`

|                |                                                     |
| -------------- | --------------------------------------------------- |
| **Depends on** | T02                                                 |
| **Wave**       | 3 (parallel with T03)                               |
| **Agent**      | default (claude-4.6-sonnet)                         |
| **Effort**     | S                                                   |
| **Files**      | `Multigraph.svelte`, `Stage.stories.svelte`         |
| **PR title**   | `feat(multigraph): map double-tap to toggle pinned` |

Wire `onNodeMakePrimary` to call `togglePinned`. Update the story TODO
left in `Stage.stories.svelte` (drop-onto-self decision) to assert the
final behavior.

**Acceptance**

- Updated story names read like sentences ("user double-taps a node and
  it becomes pinned"; "user double-taps a pinned node and it becomes
  unpinned").
- Visual indicator appears in the harness data-attrs.

### T05 — Edge addition via double-tap-drag

|                |                                                                     |
| -------------- | ------------------------------------------------------------------- |
| **Depends on** | T02, T03                                                            |
| **Wave**       | 4                                                                   |
| **Agent**      | default (claude-4.6-sonnet)                                         |
| **Effort**     | S                                                                   |
| **Files**      | `Multigraph.svelte`, `Multigraph.stories.svelte`                    |
| **PR title**   | `feat(multigraph): add edges via double-tap-drag onto another node` |

Hook `onNodeDoubleClickDropOntoNode` to `addEdge`. Hook
`onNodeDoubleClickDropOntoBackground` to `addNode` + `addEdge` from the
source. Initial position: drop point in stage-local coordinates.

**Acceptance**

- New story: "user double-tap-drags from N1 to background → new node
  appears connected to N1."
- New story: "user double-tap-drags from N1 to N2 → an edge appears."

## Wave plan

```
Wave 1   T01                 (foundational; nothing parallel)
Wave 2   T02                 (depends on T01; nothing parallel — others
                              all depend on T02)
Wave 3   T03  ‖  T04         (both depend only on T02 → run in parallel)
Wave 4   T05                 (integration; depends on T03 and T02)
```

Total: 5 tasks, ~3 sequential gates, max parallelism in wave 3.

A simple invariant to check before kicking off a wave: every task in
the wave has all its `Depends on` items already merged to `main`.

## Risks and rollback

- **T03 placeholder layout looks bad with > ~10 nodes.** Acceptable for
  this plan; milestone 02 replaces it. Add a TODO in the code linking
  to milestone 02.
- **Existing story tests are coupled to current `handleNodeMoved`
  in-place mutation.** If T03 breaks a story play function, prefer
  fixing the story to assert via the harness's `data-last-*` attributes
  rather than reverting the immutable refactor.
- **If T02's mutation API design ends up wrong**, every later task
  rebases against it. Mitigation: T02 lands first and gets a focused
  review pass before T03/T04 start.

## Definition of Done (this plan)

The plan is done when:

- All 5 tasks are merged to `main`.
- The acceptance criteria from the milestone doc are satisfied (no need
  to copy them here — link, don't duplicate).
- Plan status is `done`, milestone status is `complete`, and roadmap
  status for the milestone is `complete` with a link back to this plan.
- The finished work has been committed unless the user explicitly asked
  not to commit yet.

## Notes

Free-form scratchpad for things that come up during execution and don't
yet have a home: questions to revisit, follow-up ideas, links to
discussions. Date entries when you add them.

- 2026-05-08: noticed `removeNode` may want a `cascade?: boolean` flag
  if we ever want to keep dangling edges as "ghost" markers. Defer.
