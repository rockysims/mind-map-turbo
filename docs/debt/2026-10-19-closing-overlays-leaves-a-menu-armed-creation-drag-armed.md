# Closing overlays leaves a menu-armed creation drag armed

**Created:** 2026-10-19
**Area:** `apps/mind-map-sv/src/lib/components/ui/Multigraph/Multigraph.svelte`
(`closeOverlays`, `armCreationGesture`), `Stage.svelte` (`creationArmRequest`)
**Cost if ignored:** after "Add node/edge" or "Merge" from the node menu, an
undo, Cmd/Ctrl+K or any other path through `closeOverlays()` drops the preview
but not the Stage's armed session, so the next click on the canvas silently
creates a node or merges, with no preview to warn the reader.

## What we did

T10 gave the cut gesture a `edgeCutCancelRequest` so `closeOverlays()` can
disarm it, and found that the older creation session has no such path: the
Stage only tears it down on Escape, a press outside the stage, or completion.

## Why

The creation session was built before `closeOverlays()` grew the callers it
has now; a cancel request for it is the same shape as the one T10 added but
touches the creation story set, out of scope there.

## What paying it off looks like

A `creationCancelRequest` (or one shared cancel request for both armed
sessions) sent from `closeOverlays()` when a creation session is armed, and a
story: arm from the node menu, press Cmd/Ctrl+K, close the panel, click the
canvas, assert no node was added.
