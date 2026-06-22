# Plan: Filter / find / search

**Created:** 2026-06-22
**Author:** Codex
**Milestone:** [milestones/05-filter-find-search.md](../milestones/05-filter-find-search.md)
**Status:** done
**Total estimated effort:** L

## Summary

Deliver local graph query as a visual mask: users can filter by text, node tags,
and edge tags while preserving layout context. The implementation keeps query
semantics pure, then wires a compact Find / Filter panel, render states, and
region navigation into the existing Multigraph surfaces.

## Open questions resolved

- **Stage camera control.** **Add a narrow fit-region request prop to Stage.**
  Result navigation needs controlled pan/zoom, but Stage should still own normal
  gesture state.
- **Visual noise.** **Use persistent halos for spotlight plus optional one-shot
  pulse.** This keeps attention durable without constant flashing.
- **Mobile density.** **Use a compact overlay that becomes a bottom sheet on
  small screens.** The query UI needs to stay available without turning into a
  full settings modal.
- **Index freshness with multiplayer.** **Keep query state local and derived
  from current graph data.** Milestone 06 can rebuild query results from remote
  graph changes without changing the query semantics.

## Out of scope

- Layout isolation mode where hidden query elements stop influencing layout.
- Saved filters or persisted query state.
- Boolean AND/grouping beyond ORed positive tokens and excluding tokens.
- Tag rename/merge or color editing changes.
- Server-side search.

## Tasks

### T01 done — Add pure graph query parsing and evaluation

|                |                                                                                     |
| -------------- | ----------------------------------------------------------------------------------- |
| **Depends on** | -                                                                                   |
| **Wave**       | 1                                                                                   |
| **Agent**      | Default workhorse                                                                   |
| **Effort**     | M                                                                                   |
| **Files**      | `Multigraph/lib/graphQuery.ts`, `Multigraph/lib/graphQuery.spec.ts`, `lib/index.ts` |
| **PR title**   | `feat(multigraph): add graph query model`                                           |

Implement token parsing, role resolution, query color precedence, context
endpoints for edge matches, exclusion semantics, and connected result regions.

**Acceptance**

- Specs cover all milestone query-model acceptance criteria.
- Empty queries return normal/default render state.
- Query evaluation remains deterministic and does not mutate `MultigraphData`.

### T02 done — Render query visual states in Multigraph

|                |                                                                 |
| -------------- | --------------------------------------------------------------- |
| **Depends on** | T01                                                             |
| **Wave**       | 2                                                               |
| **Agent**      | Default workhorse                                               |
| **Effort**     | M                                                               |
| **Files**      | `Multigraph.svelte`, `Node.svelte`, `Multigraph.stories.svelte` |
| **PR title**   | `feat(multigraph): render graph query highlights`               |

Wire query evaluation into existing node/edge rendering. Add opacity, hidden
render filtering, node halos, edge halos, and edge spotlight stroke-color
override while preserving layout inputs.

**Acceptance**

- Hidden query results stop rendering without changing the layout graph.
- Node spotlight preserves tag-border segments and adds a matched-color halo.
- Edge spotlight uses the matched tag color for stroke and halo.

### T03 done — Add Find / Filter panel

|                |                                                                     |
| -------------- | ------------------------------------------------------------------- |
| **Depends on** | T01, T02                                                            |
| **Wave**       | 3                                                                   |
| **Agent**      | Default workhorse                                                   |
| **Effort**     | M                                                                   |
| **Files**      | `GraphQueryPanel.svelte`, `Multigraph.svelte`, panel story if split |
| **PR title**   | `feat(multigraph): add find filter panel`                           |

Create a compact panel opened by a graph control and Cmd/Ctrl-K. It provides a
query input, color-coded parsed chips, tag suggestions, counts, and hover/focus
spotlight previews.

**Acceptance**

- Users can add text, node-tag, edge-tag, spotlight, and exclusion tokens.
- Tag suggestions use existing configured/fallback colors.
- Emptying the input restores normal graph rendering.

### T04 done — Add result-region navigation

|                |                                                                    |
| -------------- | ------------------------------------------------------------------ |
| **Depends on** | T01, T03                                                           |
| **Wave**       | 4                                                                  |
| **Agent**      | Default workhorse                                                  |
| **Effort**     | M                                                                  |
| **Files**      | `Stage.svelte`, `graphMath.ts`, `Multigraph.svelte`, stories/specs |
| **PR title**   | `feat(multigraph): navigate graph query regions`                   |

Add a controlled fit-region request and next/previous region buttons so users
can jump between connected focused regions without pinning nodes or mutating
graph data.

**Acceptance**

- Region navigation adjusts view state only.
- Navigation has story coverage and pure camera math specs where applicable.
- Existing pan/zoom gestures still work.

### T05 done — Final docs/status closeout

|                |                                                   |
| -------------- | ------------------------------------------------- |
| **Depends on** | T01, T02, T03, T04                                |
| **Wave**       | 5                                                 |
| **Agent**      | Fast / cheap                                      |
| **Effort**     | XS                                                |
| **Files**      | milestone, plan, roadmap                          |
| **PR title**   | `docs(roadmap): mark filter find search complete` |

Update plan notes/status and mark milestone 05 complete after validation.

**Acceptance**

- Plan status is `done`.
- Milestone 05 and roadmap row are `complete` and link the plan.
- Required validation commands pass.

## Wave plan

```text
Wave 1   T01
Wave 2   T02
Wave 3   T03
Wave 4   T04
Wave 5   T05
```

This is mostly sequential because the panel and navigation depend on stable pure
query results and render-state semantics.

## Risks and rollback

- **Query UI grows too large.** Keep the first panel plain and functional; split
  visual polish into a follow-up only if needed.
- **Stage camera control regresses gestures.** Add a request-id based prop so
  controlled navigation is explicit and one-shot.
- **Spotlight styling conflicts with tag borders.** Put node halo outside the
  existing border and edge halo behind the base edge stroke.
- **Story tests become brittle around animation.** Assert durable data attrs and
  styles; keep one-shot pulse behavior secondary.

## Definition of Done

- All milestone acceptance criteria are implemented or explicitly documented as
  deferred.
- `pnpm --filter mind-map-sv lint` passes.
- `pnpm --filter mind-map-sv check` passes.
- `pnpm --filter mind-map-sv test:unit -- --run` passes.
- Plan status, milestone status, and roadmap status are updated.
- The finished work is committed, excluding unrelated user edits.

## Notes

- 2026-06-22: Execution started. Keep `docs/roadmaps/TODO.md` uncommitted per
  user request from the prior commit.
- 2026-06-22: Implemented the pure graph query model, visual query mask,
  Find / Filter panel, spotlight coloring rules, render-only exclusion, and
  result-region navigation. Validation passed locally.
