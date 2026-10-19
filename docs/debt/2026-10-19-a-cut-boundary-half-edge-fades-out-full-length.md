# A cut or deleted boundary half-edge fades out at full length

**Created:** 2026-10-19
**Area:** `apps/mind-map-sv/src/lib/components/ui/Multigraph/Multigraph.svelte`
(`exitingOnlyEdges`, the exiting-edge buffer fed by `removeEdges` and `removeNodes`)
**Cost if ignored:** cutting the half-edge drawn to a hidden node fades out a
line that runs all the way to the hidden node's centre — a line the reader
never saw — so the delete reads as something appearing and vanishing rather
than the half-edge going.

## What we did

The exit buffer draws a fading edge centre to centre from `graph.posByNodeId`,
not from the trimmed, half-length geometry the live loop drew it with. T10
noticed it for cuts; `removeNodes` has had it for boundary edges since the
multi-node delete.

## Why

The exit buffer predates boundary half-edges and records only the two
endpoints; carrying the drawn geometry into it is a change to the buffer's
shape, out of scope for both tasks.

## What paying it off looks like

Record the drawn `source`/`target` (and the boundary fade) when an edge enters
the exit buffer, and draw the ghost from those. A story that cuts the boundary
edge of `HOP_LIMITED_CHAIN` and asserts the ghost's length equals the half-edge's.
