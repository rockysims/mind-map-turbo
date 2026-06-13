# Milestone 04e: Title syntax for direction and tags, with edge editing

**Status:** not started
**Depends on:** milestones 01 (graph mutations), 03 (editing UX), and 04d
(inline title entry).
**Plan:** [2026-06-12 title syntax for direction and tags](../plans/2026-06-12%20title-syntax-for-direction-and-tags.md)

## Goal

Let users type lightweight syntax into a node title to set edge direction,
node tags, and edge tags during creation, and edit those properties later
through a tabbed node editor — while keeping the non-editing node label clean
and the whole flow mobile-friendly.

## Scope

### Title parsing

- Add a pure parser for editable title text.
- If the first character is `<`, the new edge direction points from child
  to parent.
- If the first character is `>`, the new edge direction points from parent
  to child.
- If neither `<` nor `>` is first, the edge is undirected by default.
- After removing or ignoring the optional direction marker, parse leading
  tags:
  - `:tagName` applies the tag to the **node**.
  - `;tagName` applies the tag to the **edge** created by the gesture.
  - Tag names contain no space, colon, or semicolon characters.
- Parsing stops at the first token that is not a leading tag. The remaining
  text is the displayed node title.
- Direction and `;` edge tags only apply when the gesture creates an edge
  (i.e. creating a connected node). Editing a standalone node never mutates
  unrelated edges.

Example:

```text
>:abc ;rel The displayed node title part.
```

This means parent-to-child direction, node tag `abc`, edge tag `rel`, and
displayed title `The displayed node title part.`

### Editing model

- Title syntax is a **creation-time shortcut** only. It is parsed into
  structured graph fields; the editor does not round-trip raw syntax.
- Non-editable node labels show only the parsed display title.
- The node edit sheet gains a tab switcher:
  - **Node** tab: today's title / description / pin / delete UI.
  - **Edges** tab: a scrollable list of the edges incident to this node, one
    row per neighbor. Each row edits that edge's direction and tags.
- The Edges tab is the mobile-friendly path to any edge: every edge is
  reachable from either endpoint's list, so users tap node-sized targets and
  full-width rows instead of a hairline edge.

### Directed edges

- Extend `EdgeData` with `directed?: boolean`; the arrow points from
  `sourceNodeId` to `targetNodeId` when `directed` is true.
- Flipping direction in the Edges tab swaps the edge's source/target
  endpoints (endpoint order is already cosmetic across layout, physics, and
  undirected duplicate matching).
- Render an arrowhead at the pointed-to end when an edge is directed.
- Existing undirected edges remain visually unchanged.

### Tags

- Extend `NodeData` with a list of tags and `EdgeData` with a list of tags.
- Add a pure `updateEdge(data, edgeId, patch)` mutation mirroring
  `updateNodeContent`, with a colocated spec.
- Keep parsing, serialization, and display-title derivation in pure modules
  with colocated specs.

## Acceptance Criteria

- Parser specs cover no marker, `<`, `>`, multiple leading node tags (`:`),
  edge tags (`;`), mixed node/edge tags, malformed tag-like text, empty
  display titles, and whitespace around tags.
- Graph mutation specs cover creating a connected node with parsed
  direction, node tags, and edge tags, plus `updateEdge` returning new graph
  data without mutating the original.
- Existing graphs without direction or tags still load through migrations
  (edges → undirected with `tags: []`, nodes → `tags: []`).
- Story coverage shows inline creation with direction and tags, then plain
  display text after commit.
- Story coverage shows the node edit sheet's Node/Edges tabs, and that the
  Edges tab edits an existing edge's direction and tags.
- Directed edges render arrowheads on the correct endpoint, including after
  a flip in the Edges tab.
- Lint, check, and unit tests pass.

## Non-goals

- Tag color management; that is milestone 04f.
- Full markdown or rich text in titles.
- Search/filtering by tag.
- Direct edge hit-testing / tap-an-edge selection on the canvas (the Edges
  tab covers editing; canvas edge picking can be a later enhancement).

## Risks and Open Questions

- **Storage is structured, not raw text.** Title syntax parses into
  `NodeData.tags`, `EdgeData.tags`, and `EdgeData.directed`; the editor reads
  and writes those fields directly so round-tripping stays clear.
- **Direction and edge tags are gesture-scoped.** `<`/`>` and `;` only
  affect the edge created alongside a new node; editing a standalone node
  title never mutates unrelated edges. Per-edge changes happen in the Edges
  tab.
- **Migration defaults.** Existing edges migrate to `directed: false` /
  `tags: []`; existing nodes migrate to `tags: []`. Bump the schema version
  and extend `isEdgeData` validation accordingly.
- **First tab UI in the codebase.** No existing tab pattern; align with the
  sheet's pill-button styling and use `role="tablist"`/`role="tabpanel"` for
  a11y.
