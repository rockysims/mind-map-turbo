# Nothing says a filter is active once the Find / Filter panel closes

**Created:** 2026-10-11
**Area:** `apps/mind-map-sv/src/lib/components/ui/Multigraph/Multigraph.svelte`
(the Find / Filter toolbar button, the `GraphQueryPanel` `onClose` handler, the
`.lost-graph-hint` block), `apps/mind-map-sv/src/lib/components/ui/Multigraph/lib/graphOnScreen.ts`
(`graphIsLost`)
**Cost if ignored:** A reader who closes the panel with an exclusion in the
query, or comes back to the canvas later, sees a graph with nodes missing and
nothing explaining why. Since 2026-10-11 excluded nodes leave the layout as
well as the paint, so the remaining graph has also moved. Excluding every node
leaves a blank canvas with no hint at all, which reads as lost data.

## What we did

The query is session UI state that outlives the panel: `onClose` only sets
`graphQueryPanelOpen = false` and drops the hover preview, so `graphQueryText`
stays applied. The Find / Filter toolbar button looks the same whether or not a
query is active. When every node is excluded, `visibleNodeScreenCircles` is
empty and `graphIsLost` returns `false` for zero circles
(`graphOnScreen.ts:59`), so the "graph lost" hint that would otherwise offer a
way back does not appear either.

## Why

The gap predates the change that made it sharper. Milestone 05 originally
required any layout isolation to be "an explicit mode with its own transition
and status indicator"; the 2026-10-11 owner ruling made exclusion always
isolate and dropped that requirement, and the plan that implemented it
(`docs/roadmaps/2026-05-07 mind-map-mvp/plans/2026-10-11 excluded elements leave the layout.md`)
kept the indicator out of scope rather than designing toolbar state inside a
layout change.

## What paying it off looks like

The Find / Filter button shows that a query is active (for example a count of
excluded or matched elements, or an "active" state with a one-tap clear), and
a canvas whose every node is excluded shows a hint that says so and offers to
clear the filter, distinct from the "graph lost" hint. Verify with stories:
close the panel with `-#tag` active and assert the button's active state; then
exclude every node and assert the hint appears and clearing it brings the
nodes back.
