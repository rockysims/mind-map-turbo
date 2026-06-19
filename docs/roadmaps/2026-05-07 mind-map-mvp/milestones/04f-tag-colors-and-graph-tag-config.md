# Milestone 04f: Node and edge tag colors

**Status:** complete
**Depends on:** milestones 04c (JSON import/export) and 04e (tag data).
**Plan:** [2026-06-12 04f-node-and-edge-tag-colors.md](../plans/2026-06-12%2004f-node-and-edge-tag-colors.md)

## Goal

Make node and edge tags visible at a glance by coloring node borders and edge
strokes, with separate node-tag and edge-tag color configuration stored as
part of the multigraph and included in local saves and exported JSON.

## Scope

### Graph config

- Add graph-level config with separate maps for node tag names and edge tag
  names to colors.
- Persist the config through the same schema envelope used by local
  autosave and JSON import/export.
- Provide migrations for graphs that do not yet have tag config.

### Border rendering

- A node with one tag renders its border in that tag's color.
- A node with multiple tags splits the border evenly around 360 degrees,
  one segment per tag color.
- A node with no tags keeps the existing border style.
- Tags without explicit colors use a deterministic fallback until the user
  assigns a color. The fallback is a pure function of the tag name, so the
  same name looks the same whether it is used as a node tag or an edge tag,
  even though their config maps are separate.

### Edge rendering

- Remove the per-edge `EdgeData.color` field; edge stroke color is derived
  entirely from edge tags and the edge-tag color config. Coordinate the
  schema bump and `isEdgeData` change with milestone 04e, which already
  touches `EdgeData` to add tags.
- An edge with one or more tags renders its stroke in the first edge tag's
  color.
- An edge with no tags renders in a single neutral default stroke color.
- Edge tags without explicit config colors use the deterministic fallback
  until the user assigns one.
- The Edges tab supports reordering an edge's tags because tag order controls
  the rendered edge color.

### Color management UI

- Add a global tag legend/palette panel that lists all known tags, grouped by
  node tags and edge tags, each with its current color swatch.
- "Known tags" is the union of tags currently in use on any node/edge and
  tags that already have a config entry. In-use tags appear immediately at
  their fallback color, so no config entry is required before editing.
- Use a native `<input type="color">` per tag for color assignment (hex,
  mobile-friendly). Editing a color writes to the relevant node-tag or
  edge-tag config map.
- Include a delete action for each legend tag. Deleting an unused configured
  tag removes its config entry immediately; deleting a used tag confirms first
  and includes how many node/edge tag uses will be removed.
- Keep the first version scoped to color assignment and deletion only: no tag
  rename or merge workflow unless the plan finds a cheap local pattern.

## Acceptance Criteria

- Unit specs cover separate node/edge tag color lookup, deterministic fallback
  colors, multi-tag node segment calculation, and first-edge-tag color
  selection.
- Migration specs cover adding empty tag config to existing persisted graphs
  and dropping the legacy `EdgeData.color` field.
- JSON export/import preserves tag color config.
- Story coverage shows no-tag, one-tag, and multi-tag node borders.
- Story coverage shows changing a tag color in the legend panel updates all
  nodes (and edges) with that tag.
- Story coverage shows edge stroke color follows the first edge tag and
  updates when edge tags are reordered in the Edges tab.
- Story coverage shows the legend lists in-use tags that have no config entry
  at their fallback color and lets the user assign a color.
- Story coverage shows deleting an unused configured tag removes it without
  confirmation, while deleting a used tag confirms with its usage count and
  removes it from all nodes/edges in that namespace.
- Lint, check, and unit tests pass.

## Non-goals

- Tag filtering/search UI.
- Tag rename/merge workflows.
- Server-side tag color sharing beyond whatever future multiplayer
  persistence naturally syncs.

## Risks and Open Questions

- **Segment rendering technique.** The plan should choose between CSS
  gradients, SVG overlays, or another local pattern that works with the
  current node shape and test harness.
- **Removing `EdgeData.color`.** Edge stroke color now comes only from tags,
  so the plan must drop `color` from `EdgeData`, `addEdge`, `isEdgeData`, and
  any fixtures/stories that set it, then migrate persisted edges by ignoring
  the old field. Sequence this with milestone 04e so the two `EdgeData`
  schema changes land on one coherent version, not two conflicting bumps.
- **Edge color precedence.** Edges use the first edge tag only, so the Edges
  tab needs an accessible reordering control that works on mobile.
- **Color accessibility.** Border color alone may be insufficient for some
  users, and colored edge strokes may have similar contrast issues; the
  legend panel can carry tag-name labels next to swatches, but a fuller a11y
  treatment stays out of scope here.
- **Unknown tags resolved.** Tags created through title syntax do not need a
  config entry; they render at their deterministic fallback color and appear
  in the legend (as in-use tags) where the user can assign a color.
