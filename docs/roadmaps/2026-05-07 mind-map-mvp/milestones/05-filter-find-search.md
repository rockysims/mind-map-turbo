# Milestone 05: Filter / find / search

**Status:** complete
**Depends on:** milestones 01 (graph data), 03 (editing UX provides
title/description content), 04e (node/edge tags), and 04f (tag colors).
**Plan:** [2026-06-22 05-filter-find-search.md](../plans/2026-06-22%2005-filter-find-search.md)
**Follow-up plans:**
[2026-10-11 query tag buttons cycle modes.md](../plans/2026-10-11%20query%20tag%20buttons%20cycle%20modes.md),
[2026-10-11 excluded elements leave the layout.md](../plans/2026-10-11%20excluded%20elements%20leave%20the%20layout.md)

## Goal

Help users find text, tags, and meaningful subsections in a large graph without
losing spatial context. A filter/find panel lets users query node titles,
descriptions, node tags, and edge tags; the graph spotlights, focuses, or dims
matching elements while preserving the underlying layout, and takes excluded
elements out of the graph entirely, letting the rest of it settle.

## Scope

### Query model

- New pure `lib/graphQuery.ts`:
  - Parses free text, quoted phrases, node-tag tokens, edge-tag tokens, and
    optional token modes.
  - Evaluates matches against `MultigraphData` and returns per-node and
    per-edge query roles.
  - Computes connected result regions from focused matches so the UI can jump
    between visible subsections of the graph.
- Query tokens:
  - `#tag` targets node tags.
  - `@tag` targets edge tags.
  - Plain words and quoted phrases target node title/description text.
  - A leading `+` makes the token a temporary attention/spotlight request.
  - A leading `-` excludes matching elements from rendering.
  - No prefix means matching elements are focused at full opacity.
- Multiple positive tokens are ORed for the first milestone. AND/grouping can
  come later if real use demands it.

### Visual states

The query model separates semantic role from layout participation:

- `spotlight`: rendered full opacity with a persistent halo; adding or
  re-targeting a spotlight may also play a short one-shot pulse.
- `focus`: rendered full opacity.
- `context`: rendered dimmed to orient the user.
- `background`: rendered very dimmed.
- `excluded`: not rendered and removed from layout: no physics, hop routing,
  beacon election, occlusion, focus or fit.

Dimmed `context` and `background` treatment only applies when the active query
contains at least one positive token: text, `#tag`, `@tag`, `+#tag`, or `+@tag`.
Exclude-only queries, such as `-#archived`, hide the excluded matches while
leaving the rest of the rendered graph at normal opacity.

Owner ruling, 2026-10-11: excluded elements are effectively gone from the
graph while the exclusion lasts. Exclusion always isolates; there is no
separate mode. The remaining graph reflows and settles, excluded nodes fade
out, and their positions are kept, so clearing the exclusion brings them back
where they were. This reverses the original "visual mask only" ruling. The
earlier requirement that isolation be "an explicit mode with its own transition
and status indicator" is dropped: the transition is the exclusion's own fade,
and the missing status indicator is filed as debt
(`docs/debt/2026-10-11-active-filter-has-no-indicator-once-the-panel-closes.md`).
See
[2026-10-11 excluded elements leave the layout.md](../plans/2026-10-11%20excluded%20elements%20leave%20the%20layout.md).

### Node and edge semantics

- Focused node-tag and text matches render matching nodes at full opacity.
- A node matches a node-tag token when any of its tags match. For plain `#tag`
  focus, the node keeps its existing multi-tag border segments unchanged. For
  `+#tag` spotlight, the node keeps its existing border segments and gains a
  persistent halo in the matched tag's color while the spotlight is active.
- If multiple `+#tag` tokens match the same node, the earliest matching
  spotlight token in query order chooses the active node halo color.
- Focused edge-tag matches render matching edges at full opacity and keep both
  endpoint nodes visible as dimmed `context`, unless an endpoint also matches a
  focus/spotlight token.
- An edge matches an edge-tag token when any of its tags match. For plain
  `@tag` focus, the edge keeps the existing base stroke rule: the first edge tag
  controls the stroke color. For `+@tag` spotlight, the matching spotlight tag
  takes visual priority: the edge stroke and persistent halo use that tag's
  color while the spotlight is active.
- If multiple `+@tag` tokens match the same edge, the earliest matching
  spotlight token in query order chooses the active edge stroke/halo color.
- Excluding a node hides that node and its incident edges from rendering.
- Excluding an edge hides only that edge from rendering.
- Exclusion wins over focus and spotlight.
- When at least one positive token is active, background nodes/edges remain
  rendered but dimmed so users can preserve their mental map while filtering.

### UI

- A Find / Filter affordance opens from Cmd/Ctrl-K and a discoverable toolbar or
  graph control.
- The panel includes:
  - A token input that converts recognized text into chips.
  - Node-tag and edge-tag suggestions sourced from the existing tag legend data.
    Each suggestion is a button that cycles its tag's query token none →
    focus (`#tag`) → spotlight (`+#tag`) → exclude (`-#tag`) → none, editing
    only that token in the typed query, and shows the tag's current mode
    (exclusion wins when the query names the tag more than once).
  - Color-coded tag chips/swatches using the configured or fallback tag colors.
  - Result counts for focused nodes, focused edges, and connected regions.
  - Next/previous result-region navigation.
- Hovering or keyboard-focusing a tag suggestion whose tag is not already in the
  query temporarily spotlights matching graph elements so users can connect tag
  names, colors, and physical graph locations. A tag already in the query
  previews nothing, and a preview never excludes.
- The panel is a bottom sheet on mobile and a compact overlay on larger
  screens.

### Camera navigation

- Add a controlled way for `Multigraph`/`Stage` to fit or pan to a query result
  region.
- Region navigation should preserve the current query and animate/pan the view
  rather than pinning nodes or mutating graph data.

## Acceptance criteria

- `graphQuery.spec.ts` covers:
  - Parsing `#nodeTag`, `@edgeTag`, plain words, quoted phrases, `+`, and `-`.
  - Text matching against node titles and descriptions.
  - Node-tag focus and edge-tag focus.
  - Node-tag spotlight adding a persistent halo in the matched tag color while
    preserving the node's existing tag-border segments.
  - Query-order precedence when multiple spotlight node tags match one node.
  - Edge-tag focus keeping endpoint nodes as dimmed context.
  - Edge-tag spotlight overriding edge stroke/halo color with the matched tag
    color, including multiple-tag edges where the first edge tag does not match.
  - Query-order precedence when multiple spotlight edge tags match one edge.
  - Node exclusion hiding incident edges from rendering.
  - Edge exclusion hiding only that edge.
  - Exclusion precedence over focus/spotlight.
  - Region computation for connected focused matches.
- New story coverage shows:
  - A user opens Find / Filter, adds a node tag, and matching nodes stay full
    opacity while unrelated graph elements dim.
  - A user adds a spotlight node tag, and matching nodes keep their tag-border
    segments while gaining a persistent halo in the matched tag color.
  - A user adds an edge tag, and matching edges stay full opacity while endpoint
    nodes remain visible as dimmed context.
  - A user adds a spotlight edge tag, and matching edges use that tag's color
    for the stroke and persistent halo while the query is active.
  - A user excludes a node tag and matching nodes plus incident edges stop
    rendering and leave the layout; the remaining graph settles.
  - Hovering or focusing a tag suggestion not already in the query spotlights
    matching graph locations, and clicking a tag suggestion cycles its token
    through focus, spotlight and exclude back to none.
  - Region navigation pans/fits the stage to the selected result region.
  - An empty query restores the normal graph rendering.
- Query evaluation across a 1000-node graph completes in < 50 ms in a pure spec.
- Reduced-motion users get a non-animated halo/state change instead of pulse
  animation.

## Non-goals

- **Boolean query language.** No AND/grouping/parser precedence beyond the
  token modes described above.
- **Server-side search.** Query evaluation is client-side only.
- **Persisted/saved filters.** The filter is session UI state, not graph data.
- **Tag rename/merge workflows.** Tag management stays with the tag/settings
  surfaces.

Exclusion leaving the layout was added after this milestone shipped; see
[2026-10-11 excluded elements leave the layout.md](../plans/2026-10-11%20excluded%20elements%20leave%20the%20layout.md).

## Risks and open questions

- **Stage camera control.** `Stage` currently owns pan/zoom internally and emits
  view changes. The plan must decide the smallest controlled-camera API needed
  for result-region navigation.
- **Visual noise.** Too much pulse/halo animation can become distracting. Prefer
  one-shot attention feedback and persistent quiet state.
- **Mobile density.** Token chips, suggestions, and results need a bottom-sheet
  layout that does not cover the whole graph for simple queries.
- **Index freshness with multiplayer.** After milestone 07, remote edits need to
  rebuild the local query model without changing the query semantics.

## References

- Existing tag color and legend helpers in
  `src/lib/components/ui/Multigraph/lib/tagColors.ts`.
- Existing render opacity seams in `Multigraph.svelte`.
- Existing pure camera math in `Multigraph/lib/graphMath.ts`.
