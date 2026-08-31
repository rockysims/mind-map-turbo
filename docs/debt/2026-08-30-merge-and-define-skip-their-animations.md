# A merge and a Define both change the graph without animating what changed

**Created:** 2026-08-30
**Area:** `apps/mind-map-sv/src/lib/components/ui/Multigraph/Multigraph.svelte`
(`applyNodeMerge`, `createDefiningNode`)
**Cost if ignored:** Two mutations pop instead of animating, in an app where
every other add and remove fades. A merge makes a node disappear with no exit
fade; Define makes one appear at full size with no enter growth. Both read as a
rendering glitch rather than as the edit they are.

## What we did

`deleteNode` pays for its own exit animation by naming the node and its edges
into the exiting buffer, and the creation gestures pay for their enter
animations the same way — the buffers are explicit-call state and nothing diffs
for them. `applyNodeMerge` and `createDefiningNode` never learned to, and
milestone 12 did not teach them: it added the diff-and-animate pass for restores
(`animateRestoreDifference`) without retrofitting these two paths.

## Why

Found while reading the commit funnel for the undo plan, which is to say
adjacent to the work rather than in it. `applyNodeMerge`'s nav-stack prune was
one line and went in; the animation is a fistful of buffer bookkeeping per
removed edge, and widening a ten-task milestone for a cosmetic gap in an
unrelated gesture is how milestones stop landing.

## What paying it off looks like

`animateRestoreDifference` already does exactly this job — diff two graphs, grow
what arrived, fade what left — and is not restore-specific. Point both call
sites at it (or at whatever it becomes once it has a second caller) and delete
the special-cased buffer code in `deleteNode` if the general version covers it.
The check is a story `play` at the phone viewport asserting the absorbed node
carries `data-node-exiting` for a frame after a merge, and that a Define'd node
starts below its target scale.
