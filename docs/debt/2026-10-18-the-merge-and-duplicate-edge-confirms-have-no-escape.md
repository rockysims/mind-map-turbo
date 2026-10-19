# The merge and duplicate-edge confirms have no Escape to cancel

**Created:** 2026-10-18
**Area:** `apps/mind-map-sv/src/lib/components/ui/Multigraph/MergeConfirmDialog.svelte`,
`apps/mind-map-sv/src/lib/components/ui/Multigraph/DuplicateEdgeDialog.svelte`
**Cost if ignored:** a keyboard reader facing either dialog has to Tab to
Cancel; Escape, which closes every other layer in the app one level at a time,
does nothing here. The new `PasteSizeConfirmDialog` does cancel on Escape, so
the three confirms now disagree.

## What we did

T06 built the paste-size dialog on the merge dialog's shape and added a window
Escape handler, then noticed the two it was copied from never had one. Fixing
them was outside the plan's file list.

## Why

Both older dialogs predate the Escape-walks-out-one-level rule the focus
overlay and the selection follow, and nothing had forced the question.

## What paying it off looks like

Give both dialogs the same window Escape handler (cancel, `preventDefault`,
ignored while an action is pending), and a story per dialog that opens it,
presses Escape and asserts the graph is untouched. If the three dialogs keep
drifting, extract one `ConfirmDialog` as the menus extracted `ActionMenuPill`.
