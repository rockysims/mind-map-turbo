# The box preview does not follow nodes that move under a still pointer

**Created:** 2026-10-19
**Area:** `apps/mind-map-sv/src/lib/components/ui/Multigraph/Multigraph.svelte`
(`handleSelectionBoxUpdate`, `boxedSelection`)
**Cost if ignored:** while a selection box is open and the pointer holds still,
a node that drifts into or out of the box — a layout settle, an enter
animation, a wheel zoom mid-drag — keeps its old ring until the next pointer
move; the release recomputes from live geometry and is always right, but it can
differ from the last frame the reader saw.

## What we did

The preview is recomputed on every pointer move and on every Shift press or
release, which is what the Stage reports. Nothing recomputes it when only the
layout or the view changes under a still box.

## Why

Recomputing on every layout frame would run the hit test on every animation
tick for as long as a box is open; the common case (a pointer that keeps
moving) already refreshes it, and the commit is correct regardless.

## What paying it off looks like

Recompute the preview from an effect over the layout positions and the view
state while a box is open, throttled to a frame. A story that opens a box over
a settling cluster, holds the pointer still, and asserts the rings match the
release proves it.
