# Deleting the last pinned node pops the graph down to its beacons instead of fading

**Created:** 2026-09-07
**Area:** `apps/mind-map-sv/src/lib/components/ui/Multigraph/Multigraph.svelte` (`deleteNode`), `lib/severedComponent.ts`, `lib/layoutRuntime.svelte.ts` (`beginScaleChange`)
**Cost if ignored:** Cosmetic. One removal — the one that orphans _every_ candidate — skips the reveal wave that every other orphaning removal plays, so the reader sees the neighbourhood vanish in a frame rather than shrink into its beacon.

## What we did

`severedComponentAfterMutation` now reports `severed` whenever a removal orphaned
any candidate, so the beacon election is hinted toward the removal in the
last-pin case too. The reveal wave still runs only when there is a survivor:

```js
if (severed && survivorNodeId !== null) {
  /* beginScaleChange */
} else {
  /* relaxAfterMutation */
}
```

Deleting the only pinned node leaves `survivorNodeId === null`, so the graph
takes the plain relax path: the beacon is correct and stays on screen, but its
neighbours disappear without the fade a severing deletion gives them.

## Why

`beginScaleChange` needs a focal node to anchor the scale animation on, and the
survivor is what names one. With nothing pinned anywhere, the only sensible
focal node is the elected beacon itself, which means computing the beacon set
inside `deleteNode` to find it — a change to how the delete path and the beacon
election are wired, beyond fixing the reported disappearance.

## What paying it off looks like

Pass the beacon adjacent to the deletion as the focal node when there is no
survivor (`beaconsWithTransientReveals(nextGraph)` intersected with
`neighborIds`), and take the same `beginScaleChange` branch. A story like
`UserDeletesTheOnlyPinnedNode` would then also assert
`dataset.nodeRevealBuffer === 'true'` on a neighbour that is leaving, exactly as
`UserDeletesNodeOrphaningAComponent` does.
