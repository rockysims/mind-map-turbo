# "Select" in the background menu arms a selection box

- Situation: the selection box is a double-click-drag on empty canvas, which can be awkward on a touch device.
- Proposed: leave the box to the gesture alone.
- Chosen: the background menu offers "Select", or "Select more" while a selection exists. Tapping it arms one box anchored where the menu was opened; the box follows the pointer the way the menu-armed cut line does (hover on a mouse, a touch-drag on a phone), previews what it would select as the dragged box does, and the click or lift that ends it commits. "Select" replaces the selection; "Select more" adds to it, with no modifier needed. Escape, a second pointer or a press outside the canvas abandons it. The double-click-drag box is unchanged.
- Why: "It should start/arm a select (in case double click and drag is awkward such as on a touch device)." (owner's words)
- Pattern: keyboard--advertise-the-gesture-where-the-gesture-works
- Status: ruling
