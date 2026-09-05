# A promoted node stops refreshing once the run behind its current figure falls out of history

**Created:** 2026-09-04
**Area:** `apps/mind-map-sv/src/lib/components/ui/Multigraph/lib/aiNode.ts` (`refreshPromotedOutputs`, `withRefreshedBlock`, `assetIdsForOutputName`)
**Cost if ignored:** A reader who promotes a figure, then runs the node several more times without opening it in between, is left with a node showing an old plot that no later run will ever update — and nothing says so.

## What we did

A promoted output is bound by **name**: `ai.promoted` maps an output filename
to the node it was promoted into. To refresh that node, `withRefreshedBlock`
has to find which of its content blocks is the one to swap, and it does that by
asking `assetIdsForOutputName` for every asset any **still-stored** run wrote
under that name, then finding the block holding one of them.

Run history is bounded (`APP_CONFIG.ai.historyLength`, three). So if the run
that produced the block's current asset is evicted before a refresh reaches the
node, that asset is no longer in the set, `findIndex` returns `-1`, and the swap
silently does nothing. The binding survives, the node keeps the stale image, and
it is not reported in `staleOutputNames` either — the latest run *did* produce
the name, so by the refresh's own reckoning the binding is healthy.

Reaching it takes four runs without an intervening refresh, which the workbench
usually prevents by refreshing after each run. It is the promote-then-run-in-
another-tab, or promote-then-run-from-a-restored-draft, shapes that get there.

## Why

Binding by name is what makes the feature legible: the model is asked for
stable output filenames, and "this node holds `drift.png`" is a rule a reader
can hold in their head. Binding by asset id would be exact but would break on
the very thing promote exists for — a re-run writing a new asset under the same
name. The lookup through run history was the cheap way to find the block to
replace without storing anything new on the node, and within the history window
it is correct.

## What paying it off looks like

Record the binding on the promoted node itself rather than inferring it: the
content block a promotion created carries `{ fromAiNode, outputName }`, and
`withRefreshedBlock` finds it by that instead of by asset identity. Then history
depth stops mattering, an emptied node is still distinguishable from a bound
one, and a block the user replaced by hand can opt out by losing the marker. A
spec would record four runs against a two-run history and assert the promoted
node holds the newest asset.
