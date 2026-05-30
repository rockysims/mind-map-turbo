# Milestone 04d: Title syntax for direction and tags

**Status:** not started
**Depends on:** milestones 01 (graph mutations), 03 (editing UX), and 04c
(inline title entry).
**Plan:** _none yet._

## Goal

Let users type lightweight syntax into a node title to set edge direction
and node tags during creation or editing, while keeping the non-editing
node label clean.

## Scope

### Title parsing

- Add a pure parser for editable title text.
- If the first character is `<`, the new edge direction points from child
  to parent.
- If the first character is `>`, the new edge direction points from parent
  to child.
- If neither `<` nor `>` is first, the edge is undirected by default.
- After removing or ignoring the optional direction marker, parse leading
  tags in the form `:some-tagName_withoutASpaceOrColonCharacter`.
- Parsing stops at the first token that is not a leading tag. The remaining
  text is the displayed node title.

Example:

```text
>:abc:xyz :alsoFine The displayed node title part.
```

This means parent-to-child direction, tags `abc`, `xyz`, and `alsoFine`,
and displayed title `The displayed node title part.`

### Editing model

- Editable title fields show the full syntax-bearing text.
- Non-editable node labels show only the parsed display title.
- Preserve a user's tags and direction markers when reopening an editor,
  unless the plan chooses a structured editor that can round-trip the same
  information clearly.

### Directed edges

- Extend edge data to represent optional direction.
- Render an arrowhead at the pointed-to end when an edge is directed.
- Existing undirected edges remain visually unchanged.

### Tags

- Extend node data with a list of tags.
- Keep parsing, serialization, and display-title derivation in pure modules
  with colocated specs.

## Acceptance Criteria

- Parser specs cover no marker, `<`, `>`, multiple leading tags, malformed
  tag-like text, empty display titles, and whitespace around tags.
- Graph mutation specs cover creating a connected node with parsed
  direction and tags.
- Existing graphs without direction or tags still load through migrations.
- Story coverage shows inline creation with direction and tags, then plain
  display text after commit.
- Story coverage shows editing an existing node exposes the syntax-bearing
  editable text and saves updated tags/title.
- Directed edges render arrowheads on the correct endpoint.
- Lint, check, and unit tests pass.

## Non-goals

- Tag color management; that is milestone 04e.
- Full markdown or rich text in titles.
- Search/filtering by tag.

## Risks and Open Questions

- **Raw title vs. structured fields.** The plan should decide whether to
  store raw editable text, structured title/tags/direction fields, or both.
  Prefer structured graph data if round-tripping stays clear.
- **Direction ownership.** Direction belongs to the edge, while tags belong
  to the node. Creating a node from an edge gesture can set both; editing a
  standalone node title should not silently mutate unrelated edges.
- **Migration defaults.** Existing edges should migrate to undirected, and
  existing nodes should migrate to `tags: []`.
