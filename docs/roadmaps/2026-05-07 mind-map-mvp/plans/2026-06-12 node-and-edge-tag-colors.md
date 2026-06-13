# Plan: Node and edge tag colors

**Created:** 2026-06-12
**Author:** Cursor agent
**Milestone:** [milestones/04f-tag-colors-and-graph-tag-config.md](../milestones/04f-tag-colors-and-graph-tag-config.md)
**Status:** draft
**Total estimated effort:** L

## Summary

This plan adds persisted node-tag and edge-tag color config, derives node
borders and edge strokes from tags, and gives users a global legend panel for
editing colors. It builds on milestone 04e's structured node/edge tags and
removes the legacy per-edge color field in the same schema step.

## Open questions resolved

- **Segment rendering technique.** **Use a CSS conic-gradient ring for
  multi-tag node borders.** It keeps `Node.svelte` in the existing DOM/CSS
  rendering path and avoids adding SVG hit-testing or layout concerns.
- **Removing `EdgeData.color`.** **Drop `EdgeData.color` in the schema-v3
  migration that also adds tag color config.** One schema bump avoids carrying
  both per-edge color and tag-derived color semantics.
- **Edge color precedence.** **Use the first edge tag only.** Reordering edge
  tags in the Edges tab is the explicit way to choose the rendered edge color.
- **Edge tag reordering control.** **Use accessible up/down buttons per tag
  chip.** Buttons are simpler and more reliable on mobile than drag-and-drop,
  and they preserve keyboard access.
- **Color accessibility.** **Show tag names next to every swatch in the legend
  and keep fuller contrast tooling out of scope.** Labels prevent color from
  being the only way to identify tags while keeping this milestone focused.
- **Unknown tags resolved.** **Do not create config entries until the user
  assigns a color.** In-use tags render with deterministic fallback colors and
  appear in the legend where they can be promoted to explicit config.
- **Legend deletion semantics.** **Deleting a tag from the legend removes the
  tag everywhere.** If the tag is unused, delete only its explicit config entry
  without confirmation; if the tag is used, confirm first, include the usage
  count in the message, then remove it from every node/edge and delete its
  explicit config entry.
- **Fallback namespace.** **Compute fallback color from tag name only, not the
  node/edge namespace.** The same text should look the same by default even
  though explicit config maps are separate.
- **Legend placement.** **Render the legend as a global `Multigraph` overlay,
  not inside the node edit sheet.** `Multigraph` already owns graph mutation
  callbacks, and the panel remains available without selecting a node.
- **Color input.** **Use native `<input type="color">` controls.** They are
  cheap, mobile-friendly, and can write hex values directly into graph config.

## Out of scope (for this plan)

- Tag filtering/search UI.
- Tag rename or merge workflows.
- Custom palette design, contrast scoring, or color accessibility audits.
- Direct edge hit-testing or tap-edge editing on the canvas.
- Server-side sharing beyond the existing graph persistence payload.

## Tasks

> Each task is one PR's worth of work. If a task feels like more than one
> logical commit, split it. The PR title is drafted up front so reviewers (and
> the model writing the commit) start aligned.

### T01 — Add tag color config and remove edge colors from the schema

|                |                                                                                                                                                                                                                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                                                                                                                                                                                                                                                     |
| **Wave**       | 1                                                                                                                                                                                                                                                                                                                     |
| **Agent**      | high-reasoning (`gpt-5.3-codex` or `claude-opus-4-8-thinking-high`)                                                                                                                                                                                                                                                   |
| **Effort**     | M                                                                                                                                                                                                                                                                                                                     |
| **Files**      | `types/multigraph.ts`, `types/edge.ts`, `Multigraph/lib/graph.ts`, `Multigraph/lib/graph.spec.ts`, `Multigraph/lib/testFixtures.ts`, `Multigraph/lib/testFixtures.spec.ts`, `migrations.ts`, `migrations.spec.ts`, `graphFile.spec.ts`, `persistence.spec.ts`, `graphPersistenceController.spec.ts`, affected stories |
| **PR title**   | `feat(graph): add tag color config to multigraph data`                                                                                                                                                                                                                                                                |

Extend `MultigraphData` with graph-level tag color config, e.g.
`tagColorConfig: { nodeTags: Record<string, string>; edgeTags: Record<string, string> }`.
Bump persisted graphs to schema v3, migrate v1/v2 graphs by adding empty
config, and remove the legacy `EdgeData.color` field from types, `addEdge`,
fixtures, validation, and tests. Persisted v1/v2 edge `color` values are
ignored rather than translated.

**Acceptance**

- `EdgeData` no longer exposes `color`, `AddEdgeInput` no longer accepts color,
  and `addEdge` no longer has a string color shorthand.
- v1 graphs migrate through v2 tag/direction defaults and v3 empty tag color
  config.
- v2 graphs migrate to v3 by adding empty tag color config and dropping edge
  colors.
- New/default graphs and `makeGraph` include empty tag color config.
- Import/export and persistence specs cover the v3 payload shape.

### T02 — Add pure tag color lookup and render-model helpers

|                |                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------- |
| **Depends on** | T01                                                                                                 |
| **Wave**       | 2                                                                                                   |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)                                             |
| **Effort**     | M                                                                                                   |
| **Files**      | new `Multigraph/lib/tagColors.ts`, new `Multigraph/lib/tagColors.spec.ts`, `appConfig.ts` if needed |
| **PR title**   | `feat(multigraph): derive colors from node and edge tags`                                           |

Add pure helpers for deterministic fallback colors, separate node/edge config
lookup, legend-tag collection with usage counts, multi-tag node border
segments, first-edge-tag stroke selection, and neutral untagged edge color.

**Acceptance**

- Specs prove fallback colors are deterministic, valid hex colors, and based
  on tag name only.
- Specs cover explicit node-tag and edge-tag config maps remaining separate.
- Specs cover legend tags as the union of in-use tags and configured tags, with
  usage counts per namespace. Tags in use always appear; configured unused tags
  appear until deleted.
- Specs cover node segment calculation for zero, one, and many tags.
- Specs cover edge stroke color for no tags, unknown first tag, configured
  first tag, and multiple tags.

### T03 — Render tag-derived node borders and edge strokes

|                |                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------ |
| **Depends on** | T02                                                                                              |
| **Wave**       | 3                                                                                                |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)                                          |
| **Effort**     | M                                                                                                |
| **Files**      | `Node/Node.svelte`, `Node/Node.stories.svelte`, `Multigraph.svelte`, `Multigraph.stories.svelte` |
| **PR title**   | `feat(multigraph): render tag colors on nodes and edges`                                         |

Wire the pure render-model helpers into `Node.svelte` and `Multigraph.svelte`.
Nodes receive CSS variables or a small render model for their border ring;
edges use the derived stroke color in both fully visible and faded-edge
rendering.

**Acceptance**

- Node story coverage shows no-tag, one-tag, and multi-tag borders.
- Multigraph story coverage shows edge strokes using the first edge tag.
- Untagged edges render with the neutral default stroke color.
- Faded hidden-neighborhood edges use the same derived source color in their
  gradient.
- Existing pinned-node visual treatment remains distinguishable.

### T04 — Build the global tag color legend panel

|                |                                                                                        |
| -------------- | -------------------------------------------------------------------------------------- |
| **Depends on** | T02                                                                                    |
| **Wave**       | 3 (parallel with T03)                                                                  |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)                                |
| **Effort**     | S                                                                                      |
| **Files**      | new `Multigraph/TagColorLegend.svelte`, new `Multigraph/TagColorLegend.stories.svelte` |
| **PR title**   | `feat(multigraph): add tag color legend panel`                                         |

Create a reusable legend/palette panel component that groups node tags and edge
tags, displays each tag name with its current swatch, and emits color updates
from native color inputs. It also shows a delete button for every legend tag
and emits delete requests. This task can be developed against fixture data
without integrating the panel into `Multigraph.svelte`.

**Acceptance**

- The legend lists node tags and edge tags in separate labeled groups.
- It includes tags that are in use but have no config entry, shown at fallback
  color.
- Each row has a native color input with an accessible label naming the tag and
  namespace.
- Every tag row has an accessible delete button.
- The component story proves changing a color emits the tag namespace, tag
  name, and selected hex color.
- The component story proves clicking delete emits the tag namespace and tag
  name without mutating local fixture data.

### T05 — Integrate legend color editing with graph updates

|                |                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| **Depends on** | T03, T04                                                                                                    |
| **Wave**       | 4                                                                                                           |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)                                                     |
| **Effort**     | M                                                                                                           |
| **Files**      | `Multigraph.svelte`, `Multigraph.stories.svelte`, `Multigraph/lib/graph.ts`, `Multigraph/lib/graph.spec.ts` |
| **PR title**   | `feat(multigraph): edit tag colors from graph legend`                                                       |

Add a small global control in `Multigraph` to open the legend overlay, wire
legend changes and deletes through immutable graph update helpers, and close
the panel without interfering with the node edit sheet or action menu. Deleting
an unused configured tag happens immediately and removes its explicit config
entry. Deleting a used tag asks for confirmation, includes the usage count in
the message, then removes the tag from every node/edge in that namespace and
removes its explicit config entry.

**Acceptance**

- Pure graph specs cover setting node-tag and edge-tag colors immutably.
- Opening the legend does not require selecting a node.
- Changing a node-tag color updates every node with that tag.
- Changing an edge-tag color updates every edge whose first tag is that tag.
- Deleting an unused configured tag removes the explicit config entry without
  confirmation.
- Deleting a used tag asks for confirmation and the message includes how many
  node/edge tag uses will be removed.
- Confirming used-tag deletion removes that tag from every node/edge in the
  selected namespace and removes its explicit config entry.
- Canceling that confirmation leaves the config unchanged.
- The panel works on mobile-sized viewports and has dialog/panel labeling that
  screen readers can announce.

### T06 — Add accessible edge tag reordering

|                |                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T03, T05                                                                                                                  |
| **Wave**       | 5                                                                                                                         |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)                                                                   |
| **Effort**     | M                                                                                                                         |
| **Files**      | `Multigraph/NodeEditSheet.svelte`, `Multigraph.stories.svelte`, `Multigraph/lib/graph.ts`, `Multigraph/lib/graph.spec.ts` |
| **PR title**   | `feat(multigraph): reorder edge tags in the edit sheet`                                                                   |

Replace or augment the Edges tab's free-text edge tag input with ordered tag
chips and accessible move-up/move-down controls. Saving the reordered tags
updates the edge's ordered `tags[]`, which controls the rendered stroke color.

**Acceptance**

- Edge tags can be moved earlier/later with buttons that have accessible names.
- Reordering preserves all existing tag names and does not mutate unrelated
  edges.
- A story shows an edge's stroke color follows the first tag after reordering.
- The UI remains usable from either endpoint's Edges tab.

## Wave plan

```
Wave 1   T01                 (schema/data foundation)
Wave 2   T02                 (pure color render model)
Wave 3   T03  ‖  T04         (rendering and standalone legend component)
Wave 4   T05                 (integrate legend into Multigraph)
Wave 5   T06                 (edge tag reordering and visual precedence story)
```

Total: 6 tasks, 5 sequential gates. T03 and T04 can run in parallel because
T03 touches rendering while T04 builds a standalone component and fixture story;
all shared `tagColors.ts` helper API must land in T02.

A simple invariant to check before kicking off a wave: every task in the wave
has all its `Depends on` items already merged to `main`.

## Risks and rollback

- **Schema-v3 foundation is high blast radius.** If T01 goes wrong, later PRs
  inherit bad data shape assumptions. Mitigation: land and review T01 before
  any render/UI work starts, and keep the migration specs explicit for v1 and
  v2 payloads.
- **Removing `EdgeData.color` may break many fixture-based tests.** Prefer
  fixing the fixture builder and affected expectations rather than temporarily
  preserving the old field.
- **CSS conic-gradient borders may not clip cleanly with the existing node
  shape.** If the ring technique fails, swap only the implementation inside
  `Node.svelte` while keeping T02's segment render model stable.
- **Legend integration could conflict with existing overlays.** Keep the
  legend's open/close state in `Multigraph` and route it through the same
  close-overlays discipline used by the action menu, edit sheet, and inline
  title editor.
- **Deleting used tags is destructive.** Require confirmation for used tags and
  include the usage count so users know how many node/edge tag assignments will
  be removed.
- **Edge tag chips may be too much UI for small screens.** Use full-width rows
  and button controls instead of drag-and-drop; if needed, defer chip editing
  polish while keeping ordered tags and move buttons working.

## Definition of Done (this plan)

The plan is done when:

- All 6 tasks are merged to `main`.
- The acceptance criteria from the milestone doc are satisfied.
- `pnpm --filter mind-map-sv lint` passes.
- `pnpm --filter mind-map-sv check` passes.
- `pnpm --filter mind-map-sv test:unit -- --run` passes.
- Plan status is `done`, milestone status is `complete`, and roadmap status
  for the milestone is `complete` with a link back to this plan.

## Notes

- 2026-06-12: Milestone 04e is marked complete and the current code has
  `NodeData.tags`, `EdgeData.tags`, `EdgeData.directed`, and schema v2, but
  still carries required `EdgeData.color`. This plan treats 04f as the schema
  v3 step that removes `color` while adding tag color config.
