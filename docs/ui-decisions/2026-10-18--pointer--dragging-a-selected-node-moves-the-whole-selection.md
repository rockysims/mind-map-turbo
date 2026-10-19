# Dragging a selected node moves the whole selection

- Situation: a node selection on a canvas where a single-click-drag already moves one node.
- Proposed: ship selection with copy, cut, paste and delete, and defer moving a selection as a group to a later plan.
- Chosen: group drag is in scope. Dragging a node that is in the selection moves every selected node by the same delta, keeping their relative layout, as one undo entry; dragging a node outside the selection moves only that node and leaves the selection as it was.
- Why: no reason given ("include group drag").
- Pattern: editing--match-undo-granularity-to-what-the-hand-did
- Status: ruling
