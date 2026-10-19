# The merge ring and the focus outline shrink with the node and the zoom

**Created:** 2026-10-18
**Area:** `apps/mind-map-sv/src/lib/components/ui/Multigraph/Multigraph.svelte`
(`.node-wrapper.merge-target :global(.circle)`, `.node-wrapper:focus-visible`)
**Cost if ignored:** at fit zoom on a phone the 4 px merge ring and the 3 px
focus outline draw at about a pixel or less, so the merge target and the
keyboard focus are hard to see exactly where a reader is least able to zoom in
first.

## What we did

T04 found that the selection ring, drawn the same way, measured about 0.8 px on
screen and sized it in screen pixels through a per-node `--screen-px` custom
property. The two older rings were left as they were, outside the task's scope.

## Why

Both rings are box-shadows inside a wrapper that carries the node's scale
transform under the stage's zoom, so they shrink twice; nobody had measured
them at phone fit zoom before.

## What paying it off looks like

Set `--screen-px` on every node wrapper (not only selected ones) and express
both rings in it, as the selection ring does. Also give the merge-target rule
the extra specificity the selection rule has, so a pinned merge target's ring
does not depend on stylesheet order. A story at the phone viewport measures the
ring width on screen.
