# Milestone 04e: Tag colors and graph tag config

**Status:** not started
**Depends on:** milestones 04b (JSON import/export) and 04d (tag data).
**Plan:** _none yet._

## Goal

Make node tags visible at a glance by coloring node borders, with tag color
configuration stored as part of the multigraph and included in local saves
and exported JSON.

## Scope

### Graph config

- Add graph-level config that maps tag names to colors.
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

### Color management UI

- Add a small way to view and edit the color for known tags.
- Keep the first version scoped to color assignment only: no tag rename,
  merge, or delete workflow unless the plan finds a cheap local pattern.

## Acceptance Criteria

- Unit specs cover tag color lookup, deterministic fallback colors, and
  multi-tag segment calculation.
- Migration specs cover adding empty tag config to existing persisted
  graphs.
- JSON export/import preserves tag color config.
- Story coverage shows no-tag, one-tag, and multi-tag node borders.
- Story coverage shows changing a tag color updates all nodes with that
  tag.
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
- **Color accessibility.** Border color alone may be insufficient for some
  users; consider tooltip/title text or a future tag legend without
  expanding this milestone too far.
- **Unknown tags.** Decide whether creating a tag through title syntax also
  inserts a config entry immediately or relies on fallback color until the
  user edits it.
