# Plan: Title syntax for direction and tags

**Created:** 2026-06-12
**Author:** Cursor agent
**Milestone:** [milestones/04e-title-syntax-for-direction-and-tags.md](../milestones/04e-title-syntax-for-direction-and-tags.md)
**Status:** draft
**Total estimated effort:** L

## Summary

This plan turns inline title entry into a creation-time shortcut for
direction and tags, then exposes the same structured fields through a
mobile-friendly Node/Edges edit sheet.

## Open questions resolved

- **Storage format.** **Store parsed fields structurally, not as raw title
  syntax.** Node labels, editor controls, persistence, and future tag color
  work should all read `tags` / `directed` fields directly instead of
  reparsing display text.
- **Creation-time scope.** **Apply `<`, `>`, and `;edgeTag` only to the edge
  created with a newly added node.** This keeps standalone title edits from
  surprising users by mutating unrelated incident edges.
- **Schema migration.** **Bump the graph file schema and migrate version 1
  data into the new shape.** Existing nodes get `tags: []`; existing edges get
  `tags: []` and remain undirected by leaving `directed` false/absent.
- **Edge edit UI.** **Use a local tabbed `NodeEditSheet` instead of creating a
  shared tabs component.** This is the first tab UI in the app; a local,
  accessible implementation avoids freezing a reusable primitive too early.
- **Tag editing controls.** **Use plain text inputs that normalize
  whitespace-separated tag names.** This keeps mobile editing simple now while
  still enforcing the parser's no-space, no-colon, no-semicolon tag invariant;
  any syntactically valid new tag name is accepted and created on use.
- **Directed duplicate behavior.** **Do not introduce parallel opposite
  directed edges in this milestone.** Duplicate-edge detection only applies to
  the existing-node-to-existing-node gesture from milestone 04d; title syntax
  applies to newly created nodes, so it does not create a duplicate edge path.

## Out of scope (for this plan)

- Tag color config and multi-color node borders from milestone 04f.
- Searching, filtering, grouping, or bulk editing by tag.
- Direct canvas edge hit-testing or tap-to-select-edge gestures.
- Parallel edges between the same two nodes.
- Rich title syntax beyond the first-character direction marker and leading
  `:` / `;` tags.

## Tasks

> Each task is one PR's worth of work. If a task feels like more than one
> logical commit, split it. The PR title is drafted up front so reviewers
> (and the model writing the commit) start aligned.

### T01 — Extend graph data and persistence schema for tags and direction

|                |                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                                                                                     |
| **Wave**       | 1                                                                                                                                                     |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)                                                                                               |
| **Effort**     | M                                                                                                                                                     |
| **Files**      | `types/node.ts`, `types/edge.ts`, `migrations.ts`, `migrations.spec.ts`, `graphFile.spec.ts`, `persistence.spec.ts`, `Multigraph/lib/testFixtures.ts` |
| **PR title**   | `feat(graph): add structured tags and directed edges`                                                                                                 |

Add `tags: string[]` to `NodeData` and `EdgeData`, plus `directed?: boolean`
to `EdgeData`. Update fixture builders and persistence validation/migration so
version 1 graph files load with empty tag arrays and undirected edges.

**Acceptance**

- Migration specs cover version 1 nodes/edges gaining empty tags and
  undirected edges.
- Current-version validation rejects malformed `tags` values and malformed
  `directed` values.
- Fixture specs can build tagged nodes, tagged edges, and directed edges.
- Existing graph, persistence, and Storybook fixtures compile without callers
  hand-writing default tags everywhere.

### T02 — Add pure title syntax parsing and tag normalization

|                |                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                                        |
| **Wave**       | 1                                                                                                        |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)                                                  |
| **Effort**     | M                                                                                                        |
| **Files**      | new `Multigraph/lib/titleSyntax.ts`, new `Multigraph/lib/titleSyntax.spec.ts`, `Multigraph/lib/index.ts` |
| **PR title**   | `feat(multigraph): parse title syntax for tags and direction`                                            |

Implement a parser that reads an optional first-character direction marker,
then consumes leading `:nodeTag` and `;edgeTag` tokens until the first
non-tag token. Add a small tag-list normalizer for sheet inputs using the
same tag-name rules.

**Acceptance**

- Specs cover no marker, `<`, `>`, multiple node tags, edge tags, mixed tags,
  malformed tag-like text, empty display titles, and whitespace around tags.
- Specs prove `>` maps to parent-to-child, `<` maps to child-to-parent, and no
  marker stays undirected.
- Parser returns the plain display title separately from node tags, edge tags,
  and direction intent.
- Tag normalization drops empty tokens and rejects or ignores invalid tag
  names consistently with parser rules.

### T03 — Add graph mutations for parsed node creation and edge editing

|                |                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------ |
| **Depends on** | T01, T02                                                                                   |
| **Wave**       | 2                                                                                          |
| **Agent**      | high-reasoning (`gpt-5.3-codex`)                                                           |
| **Effort**     | M                                                                                          |
| **Files**      | `Multigraph/lib/graph.ts`, `Multigraph/lib/graph.spec.ts`, `Multigraph/lib/titleSyntax.ts` |
| **PR title**   | `feat(graph): apply parsed title syntax to connected nodes`                                |

Extend `addNode` / `addEdge` inputs for tags and direction, add
`updateEdge(data, edgeId, patch)`, and add a pure helper that commits raw
inline title text to a newly created node plus the one edge created by the
gesture.

**Acceptance**

- Specs cover creating a connected node where `>` creates `parent -> child`,
  `<` creates `child -> parent`, and no marker creates an undirected edge.
- Specs cover node tags, edge tags, and plain display title being committed
  from the same raw inline title text.
- Specs cover standalone node creation applying node tags/display title while
  ignoring direction and edge tags because no edge is created.
- `updateEdge` returns new graph data, preserves unrelated edges, and is a
  no-op for unknown edge ids.

### T04 — Wire inline creation syntax into `Multigraph`

|                |                                                                      |
| -------------- | -------------------------------------------------------------------- |
| **Depends on** | T03                                                                  |
| **Wave**       | 3                                                                    |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)              |
| **Effort**     | M                                                                    |
| **Files**      | `Multigraph.svelte`, `Multigraph.stories.svelte`, `Node/Node.svelte` |
| **PR title**   | `feat(multigraph): apply title syntax during inline creation`        |

Track the inline-edit context as the newly created node plus its created edge,
then commit the raw title through the T03 pure helper. Non-editable labels show
only the parser's display title.

**Acceptance**

- Story coverage shows a user creating a connected node, entering
  `>:abc ;rel The displayed title`, and seeing only `The displayed title`
  after commit.
- Story assertions prove the created node receives `abc`, the created edge
  receives `rel`, and the edge direction is parent-to-child.
- Existing inline title stories still cover empty-title fallback and pointer
  propagation behavior.
- Editing an existing node title does not mutate incident edge tags or
  direction.

### T05 — Add Node/Edges tabs and structured tag/direction editing

|                |                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------- |
| **Depends on** | T03, T04                                                                                            |
| **Wave**       | 4                                                                                                   |
| **Agent**      | high-reasoning (`gpt-5.3-codex`)                                                                    |
| **Effort**     | L                                                                                                   |
| **Files**      | `NodeEditSheet.svelte`, `Multigraph.svelte`, `Multigraph.stories.svelte`, `Multigraph/lib/graph.ts` |
| **PR title**   | `feat(multigraph): edit incident edge direction and tags`                                           |

Convert `NodeEditSheet` into a local tabbed sheet. The Node tab keeps the
current node fields and adds node tag editing for already-created nodes; the
Edges tab lists incident edges with neighbor labels, direction controls, and
edge tag inputs.

**Acceptance**

- The tab switcher uses `role="tablist"`, `role="tab"`, and `role="tabpanel"`
  with clear accessible names.
- Story coverage opens the sheet, switches to Edges, edits an existing edge's
  tags, and saves them through `updateEdge`.
- Story coverage flips an edge direction from either endpoint's sheet and the
  underlying edge still connects the same two nodes.
- The Edges tab remains scrollable and usable at mobile sheet width with
  full-row controls.
- Node tag edits update `NodeData.tags` without changing the node title.

### T06 — Render directed edges with arrowheads

|                |                                                         |
| -------------- | ------------------------------------------------------- |
| **Depends on** | T05                                                     |
| **Wave**       | 5                                                       |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`) |
| **Effort**     | S                                                       |
| **Files**      | `Multigraph.svelte`, `Multigraph.stories.svelte`        |
| **PR title**   | `feat(multigraph): render directed edge arrowheads`     |

Render an arrowhead at the directed edge's target endpoint while leaving
undirected and boundary-fade edges visually unchanged.

**Acceptance**

- Directed visible edges show an arrowhead at the target endpoint.
- Flipping direction in the Edges tab moves the arrowhead to the other
  endpoint.
- Undirected edges, hidden edges, and boundary-fade edges retain existing
  visual behavior apart from any test-stable data attributes needed for
  assertions.
- Storybook play assertions cover the correct endpoint before and after a
  direction flip.

## Wave plan

```
Wave 1   T01  ||  T02         (schema and parser can land independently)
Wave 2   T03                  (combines schema + parser into graph mutations)
Wave 3   T04                  (inline creation wiring)
Wave 4   T05                  (sheet tabs and structured editing)
Wave 5   T06                  (arrow rendering after direction editing exists)
```

Total: 6 tasks, ~5 sequential gates, max parallelism in wave 1.

Before kicking off a wave, every task in that wave should have all of its
`Depends on` items merged to `main`. T04–T06 are deliberately sequential
because they all touch `Multigraph.svelte` / `Multigraph.stories.svelte`.

## Risks and rollback

- **Schema migration touches persistence broadly.** Keep T01 focused and
  reviewed before UI work starts; rollback is reverting the schema commit
  before any version 2 files are written.
- **Direction semantics can leak into existing undirected helpers.** T03 should
  keep layout, visibility, and neighbor traversal endpoint-order agnostic, and
  isolate direction-specific behavior to mutation/edit/render paths.
- **The sheet can become too large for one component.** If T05 grows beyond a
  reviewable diff, split local child components such as `EdgeEditRow.svelte`
  without creating a shared tabs abstraction.
- **Story tests may become brittle around arrow geometry.** Prefer stable data
  attributes for source/target/directed assertions and keep visual geometry
  checks minimal.

## Definition of Done (this plan)

The plan is done when:

- All 6 tasks are merged to `main`.
- The acceptance criteria from the milestone doc are satisfied.
- `pnpm --filter mind-map-sv lint`, `pnpm --filter mind-map-sv check`, and
  `pnpm --filter mind-map-sv test:unit -- --run` pass after the final task.
- Plan status is `done`, milestone status is `complete`, and roadmap status
  for the milestone is `complete` with a link back to this plan.
- The finished work has been committed unless the user explicitly asked not to
  commit yet.

## Notes

- 2026-06-12: plan written against the post-04d code shape, where inline title
  creation and duplicate-edge confirmation already live in `Multigraph`.
