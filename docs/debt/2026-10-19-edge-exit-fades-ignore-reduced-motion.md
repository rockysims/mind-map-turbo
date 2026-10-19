# Edge exit fades ignore reduced motion

**Created:** 2026-10-19
**Area:** `apps/mind-map-sv/src/lib/components/ui/Multigraph/Multigraph.svelte`
(`removeNodes`, `removeEdges`, the exiting-edge buffer and `enterExitDurationMs`)
**Cost if ignored:** a reader who asked the OS for reduced motion still gets a
fading edge on every delete, cut and node removal, against the standing rule in
`docs/ui-decisions/README.md` that reduced motion skips the animation and
reaches the same end state.

## What we did

The edge exit fade takes its duration from `enterExitDurationMs` without
consulting `prefersReducedMotion`; only the creation preview's
`previewDurationMs` checks it. T10's `removeEdges` inherited the behaviour from
the single-edge path it generalised, and `removeNodes` had it from `deleteNode`.

## Why

The reduced-motion gate was added to the preview when the preview was built
and never swept across the older exit paths; nothing surfaced it until T10's
review listed every animation the cut touches.

## What paying it off looks like

Resolve the exit duration through the same reduced-motion check the preview
uses, in one place the three removal paths share, and a story under
`prefers-reduced-motion: reduce` that deletes an edge and asserts it is gone
on the next frame with no exiting entry.
