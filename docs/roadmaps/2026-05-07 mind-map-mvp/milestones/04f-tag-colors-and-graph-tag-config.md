# Milestone 04f: Node and edge tag colors

**Status:** not started
**Depends on:** milestones 04c (JSON import/export) and 04e (tag data).
**Plan:** _none yet._

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
  assigns a color.

### Edge rendering

- An edge with one or more tags renders its stroke in the first edge tag's
  color.
- An edge with no tags keeps the existing stroke style.
- Edge tags without explicit colors use a deterministic fallback from the
  edge-tag color namespace until the user assigns a color.
- The Edges tab supports reordering an edge's tags because tag order controls
  the rendered edge color.

### Color management UI

- Add a small way to view and edit the color for known node tags and edge
  tags.
- Keep the first version scoped to color assignment only: no tag rename,
  merge, or delete workflow unless the plan finds a cheap local pattern.

## Acceptance Criteria

- Unit specs cover separate node/edge tag color lookup, deterministic fallback
  colors, multi-tag node segment calculation, and first-edge-tag color
  selection.
- Migration specs cover adding empty tag config to existing persisted
  graphs.
- JSON export/import preserves tag color config.
- Story coverage shows no-tag, one-tag, and multi-tag node borders.
- Story coverage shows changing a tag color updates all nodes with that
  tag.
- Story coverage shows edge stroke color follows the first edge tag and
  updates when edge tags are reordered in the Edges tab.
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
- **Edge color precedence.** Edges use the first edge tag only, so the Edges
  tab needs an accessible reordering control that works on mobile.
- **Color accessibility.** Border color alone may be insufficient for some
  users, and colored edge strokes may have similar contrast issues; consider
  tooltip/title text or a future tag legend without
  expanding this milestone too far.
- **Unknown tags.** Decide whether creating a tag through title syntax also
  inserts a config entry in the relevant node-tag or edge-tag map immediately
  or relies on fallback color until the user edits it.
