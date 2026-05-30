# Milestone 06: Search

**Status:** not started
**Depends on:** milestones 01 (graph data) and 03 (editing UX provides
the title/description content to search).
**Plan:** _none yet._

## Goal

Find any node in a large graph in under a second. Typing in a command
palette filters across titles and descriptions; selecting a result
pins (or focuses) the node so it scales up to full size.

## Scope

### Index

- New `lib/search.ts`:
  - `buildIndex(data: MultigraphData): SearchIndex` — flat array of
    `{ id, title, description }` with lowercased fields.
  - `query(index: SearchIndex, q: string, opts?: { limit?: number }):
SearchHit[]` — substring + fuzzy match (small custom scorer; no
    external dep needed for MVP).
- Index rebuilds on every state change (cheap for MVP; precompute and
  cache later).

### UI

- Cmd/Ctrl-K (or a search icon button) opens a command palette.
  Displays top N results as the user types. Arrow keys navigate;
  Enter selects.
- Selecting a result:
  - Toggles its pinned flag on (so layout milestone 02's BFS scaling
    centers on it), or
  - Pans / zooms the stage to put the node in view (in addition).
- Decision in the plan: "pin on select" vs "navigate-only" vs both.

### Mobile

- Same palette opens via a search button in a mobile toolbar. Inputs
  are full-width; results list is scrollable; tapping a result does
  the same thing as Enter.

## Acceptance criteria

- `search.spec.ts` covers:
  - Exact title match outranks description match.
  - Substring match in description still returns the hit.
  - Empty query returns `[]`.
  - Limit parameter respected.
- New stories:
  - "User opens command palette, types 'foo', selects the result, the
    matching node is pinned and centered."
  - "User types a query that matches nothing — palette shows an empty
    state."
- Search across a 1000-node graph completes in < 50 ms (perf assertion
  in the spec).

## Non-goals

- **Boolean operators** (AND / OR / NOT). Plain substring is fine.
- **Tag-based search/filtering.** Tags exist after milestones 04d and 04e,
  but the first search milestone stays focused on title and description.
- **Server-side search.** Index lives client-side only.
- **Full-text fuzzy ranking** with libraries like `fuse.js` or
  `flexsearch` — keep it simple for MVP and revisit if perf or
  relevance becomes a problem.

## Risks and open questions

- **Index freshness.** With multiplayer, the index needs to rebuild on
  remote edits too — Yjs adapter (milestone 05) emits change events;
  hook into them.
- **Long descriptions.** Strip / truncate for the result preview
  display; full text still searched.
- **Performance.** Linear scan is O(n × m) where m = avg description
  length. Fine for thousands of nodes; revisit if needed.

## References

- `.cursor/rules/typescript.mdc` (configurable defaults — pass `limit`
  in, don't hardcode).
- Cmd palette UI: choose a focused primitive during the milestone plan,
  or hand-roll a small `<dialog>`-based one.
