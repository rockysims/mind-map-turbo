# Cmd/Ctrl+K opens the query panel even while the reader is typing

**Created:** 2026-08-30
**Area:** `apps/mind-map-sv/src/lib/components/ui/Multigraph/Multigraph.svelte`
(the window `keydown` handler)
**Cost if ignored:** Typing `Cmd+K` inside a node description — a real shortcut
in other editors, and a plausible slip — throws the reader out of the field they
were writing in and onto the query panel, with the edit sheet closed under them
by `closeOverlays()`.

## What we did

The modifier branch of the keyboard handler guards `Cmd/Ctrl+Z` and `Ctrl+Y`
with `keyboardIsInTextEntry()`, because the description field's native undo is
something this codebase has deliberately protected twice. `Cmd/Ctrl+K` sits in
the same branch and skips the guard, as it did before milestone 12.

## Why

Milestone 12 added the guard for its own shortcuts and left the neighbouring one
alone: changing when an existing shortcut fires is a behaviour change with its
own story to write, and folding it into the undo work would have hidden it in a
diff about something else.

## What paying it off looks like

One `keyboardIsInTextEntry()` check on the `k` branch, and a story `play`
asserting that `Cmd+K` inside a focused description leaves the sheet open and
the panel closed — beside the existing one that asserts it opens the panel from
the canvas.
