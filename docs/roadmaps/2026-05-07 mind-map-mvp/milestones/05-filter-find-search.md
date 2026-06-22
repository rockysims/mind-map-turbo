# Milestone 05: Filter / find / search

**Status:** not started
**Depends on:** milestones 01 (graph data), 03 (editing UX provides
title/description content), 04e (node/edge tags), and 04f (tag colors).
**Plan:** _none yet._

## Goal

Help users find text, tags, and meaningful subsections in a large graph without
losing spatial context. A filter/find panel lets users query node titles,
descriptions, node tags, and edge tags; the graph responds with a visual mask
that spotlights, focuses, dims, or hides rendered elements while preserving the
underlying layout.

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
- `excluded`: not rendered, but still participates in layout.

This milestone implements a visual mask only. Querying must not cause layout
reflow. A later isolation mode may let users remove non-matches from both
rendering and layout influence, but that must be an explicit mode with its own
transition and status indicator.

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
- Background nodes/edges remain rendered but dimmed so users can preserve their
  mental map while filtering.

### UI

- A Find / Filter affordance opens from Cmd/Ctrl-K and a discoverable toolbar or
  graph control.
- The panel includes:
  - A token input that converts recognized text into chips.
  - Node-tag and edge-tag suggestions sourced from the existing tag legend data.
  - Color-coded tag chips/swatches using the configured or fallback tag colors.
  - Result counts for focused nodes, focused edges, and connected regions.
  - Next/previous result-region navigation.
- Hovering or keyboard-focusing a tag suggestion temporarily spotlights matching
  graph elements so users can connect tag names, colors, and physical graph
  locations.
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
    rendering without layout reflow.
  - Hovering or focusing a tag suggestion spotlights matching graph locations.
  - Region navigation pans/fits the stage to the selected result region.
  - An empty query restores the normal graph rendering.
- Query evaluation across a 1000-node graph completes in < 50 ms in a pure spec.
- Reduced-motion users get a non-animated halo/state change instead of pulse
  animation.

## Non-goals

- **Layout isolation mode.** Query hiding is a visual mask only; non-rendered
  query exclusions still influence layout until a later explicit isolation mode.
- **Boolean query language.** No AND/grouping/parser precedence beyond the
  token modes described above.
- **Server-side search.** Query evaluation is client-side only.
- **Persisted/saved filters.** The filter is session UI state, not graph data.
- **Tag rename/merge workflows.** Tag management stays with the tag/settings
  surfaces.

## Risks and open questions

- **Stage camera control.** `Stage` currently owns pan/zoom internally and emits
  view changes. The plan must decide the smallest controlled-camera API needed
  for result-region navigation.
- **Visual noise.** Too much pulse/halo animation can become distracting. Prefer
  one-shot attention feedback and persistent quiet state.
- **Mobile density.** Token chips, suggestions, and results need a bottom-sheet
  layout that does not cover the whole graph for simple queries.
- **Index freshness with multiplayer.** After milestone 06, remote edits need to
  rebuild the local query model without changing the query semantics.

## References

- Existing tag color and legend helpers in
  `src/lib/components/ui/Multigraph/lib/tagColors.ts`.
- Existing render opacity seams in `Multigraph.svelte`.
- Existing pure camera math in `Multigraph/lib/graphMath.ts`.
