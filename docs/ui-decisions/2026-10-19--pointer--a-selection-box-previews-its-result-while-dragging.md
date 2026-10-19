# A selection box previews its result while it is dragged

- Situation: the double-click-drag box on empty canvas, before the pointer is released.
- Proposed: draw the box only, and mark nodes as selected on release.
- Chosen: while the box is open, every node that would be selected if the drag ended now already shows as selected, and nothing else does — with Shift held that is the existing selection plus the box's nodes, without it the box's nodes alone. Release commits exactly what was shown; a cancel puts the previous selection back.
- Why: "while dragging to select, the selected indicator should show as selected whatever nodes would be selected if the user released the selection dragging gesture at the current moment." (owner's words)
- Pattern: none
- Status: ruling
