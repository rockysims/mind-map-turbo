# Double-click-drag on empty canvas boxes a selection

- Situation: a pan-and-zoom canvas whose only background gesture is pan, needing a way to select several nodes on desktop and on touch.
- Proposed: a Shift-drag on the background, desktop only; or a double-click-drag on the background.
- Chosen: double-click-drag (double-tap-drag on touch) on empty canvas draws the selection box. It is the background twin of the node gesture that already grows the graph: from a node the motion creates, from empty space it gathers. A box with no modifier replaces the selection; Shift held on release adds to it. A plain click on empty canvas or Escape clears the selection. Hold (touch) and right-click on the background open a background menu; a plain tap on a node stays a no-op, because it is the first half of a double-click.
- Why: no reason given beyond "recommended"; the case put to the owner was that it works on touch, needs no modifier, and reuses a motion the reader already knows.
- Pattern: pointer--state-a-precedence-for-competing-gestures
- Status: ruling
