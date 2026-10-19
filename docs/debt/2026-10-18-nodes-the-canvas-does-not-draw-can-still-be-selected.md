# Nodes the canvas does not draw can still be selected

**Created:** 2026-10-18
**Area:** `apps/mind-map-sv/src/lib/components/ui/Multigraph/Multigraph.svelte`
(`commitPaste` → `selection.replace(arrivedNodeIds)`; the selection prune)
**Cost if ignored:** a paste past the hop limit selects nodes nobody can see;
Delete, Cut, Copy and the group drag then act on them too, which contradicts the
plan's rule that only drawn nodes are selectable (the box and Select all honour
it).

## What we did

After a paste the selection is every arrived id, as the plan specified, and
the prune only drops ids that name no node — it does not drop ids the hop
limit or the query hides. A node that later leaves the drawn set (its pin is
removed, a filter excludes it) stays selected as well.

## Why

Selecting the arrivals is what makes "paste, then drag it where you want"
work, and pruning to the drawn set on every visibility change would make a
selection vanish under the reader's hand when they unpin a neighbour. The
tension between the two rules was noticed during T06 and left for a ruling.

## What paying it off looks like

Decide the rule — probably "selection is pruned to the drawn set, and a paste
selects only the arrivals that are drawn" — and record it in `docs/ui-decisions/`.
Then prune against `visibleNodeIds` instead of `graph.nodes`, with a story that
pastes a component whose far nodes are beyond the hop limit and asserts the
count label.
