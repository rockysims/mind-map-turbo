# The node menu can open under the toolbar on a phone

**Created:** 2026-10-18
**Area:** `apps/mind-map-sv/src/lib/components/ui/Multigraph/ActionMenuPill.svelte`
(`nudgeIntoViewport`), `apps/mind-map-sv/src/lib/components/ui/GraphToolbar/GraphToolbar.svelte`
(z-index 40 against the menu layer's 20)
**Cost if ignored:** a hold on a node just under the toolbar on a phone opens a
pill whose first items are drawn beneath the toolbar's settings gear and cannot
be tapped; the reader sees a menu and cannot use part of it.

## What we did

T07's shared pill keeps itself inside the viewport (it slides sideways and
drops below the press when there is no room above). It does not know about the
toolbar, which overlays the top of the canvas with a higher z-index, so "inside
the viewport" can still mean "under the toolbar". Seen in the dev app during
T04's smoke test.

## Why

The nudge was written against the viewport because that is what the pill can
measure on its own; the toolbar's clearance is published as a CSS variable
(`--graph-toolbar-clearance`) that the pill does not yet read.

## What paying it off looks like

Treat the toolbar's clearance as the top edge of the usable area in
`nudgeIntoViewport` (read the variable the count label already uses, or pass
the clearance in), and a story at the phone viewport that opens the menu on a
node at the top of the canvas and asserts every item is the topmost element at
its centre.
