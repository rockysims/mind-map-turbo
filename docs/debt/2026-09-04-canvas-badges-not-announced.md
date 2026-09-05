# Task and attachment badges on the canvas are silent to screen readers

**Created:** 2026-09-04
**Area:** `apps/mind-map-sv/src/lib/components/ui/Node/NodeCompactContent.svelte`
(the badge row), `apps/mind-map-sv/src/lib/components/ui/Multigraph/lib/`
(`nodeAccessibleName`)
**Cost if ignored:** A reader using assistive tech hears a task node's name
but not that it is a task, nor whether it is done, nor that it carries files.
The sighted reader gets all three at a glance.

## What we did

Each badge carries `role="img"` and an `aria-label`, but every canvas node is
wrapped in a `role="button"` whose `aria-label` comes from
`nodeAccessibleName(node)`, and that label overrides the descendants. The
labels exist; nothing reads them.

## Why

Milestone 13's T04 owned the node and details components, not the accessible
name helper in the Multigraph library, and extending that helper touches every
node's announced name. It was the wrong place to widen a task that was already
the milestone's largest UI change.

## What paying it off looks like

`nodeAccessibleName` appends the badge labels from `addonBadges(node)` ("Buy
filters, task, done, 2 attachments"), with a spec for each state, and the
node story asserts the accessible name of a done task with files.
