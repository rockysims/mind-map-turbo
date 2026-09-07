# Prefer a prior click and plain buttons to drag-and-drop

- Situation: inserting palette content into one of several text fields, and reordering chips in an ordered list.
- Proposed: drag-and-drop, rejected after costing it out.
- Chosen: the caret decides both the field and the offset — "the author who wants the other field clicks it first, which is the same click that sets their caret." Reordering uses accessible up/down buttons per chip.
- Why: drag-and-drop's only remaining job would be choosing between two fields, bought with "a pointer-session reducer, pointer capture, `elementFromPoint` targeting, a drag ghost, drop-target highlighting, a narrowed `touch-action` on a scrollable sheet, and a 5px threshold that a finger starting a scroll crosses by accident." For reordering: "Buttons are simpler and more reliable on mobile than drag-and-drop, and they preserve keyboard access."
- Pattern: pointer--prefer-a-prior-click-to-drag-and-drop
- Status: ruling
