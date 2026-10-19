# Cut edges is armed from the background menu, with no mouse shortcut

- Situation: deleting several edges at once by dragging a line across them on the canvas.
- Proposed: a double right-click on empty canvas starting a dashed-line drag (the owner's first sketch), then a menu-armed gesture plus a mouse accelerator (Shift+right-drag) as the agent's recommendation.
- Chosen: menu-armed only. "Cut edges" in the background menu arms one dashed line anchored at the menu's own press point; the line follows the pointer the way the menu-armed "Add node/edge" drag does (hover on a mouse, a touch-drag on a phone), the edges it would cut show as such while it moves, and the click or release that ends it deletes them as one undo entry with no confirm. Escape, a second pointer or a press outside the canvas abandons it. The line cuts authored edges only — including the half-edges drawn to hidden nodes — and never a derived dataflow edge, which is recomputed from the maths. No double-right-click and no Shift+right-drag.
- Why: "menu-armed only is enough" (owner's words); the mouse-only route carried a menu-interception problem and an OS difference in when the context-menu event fires.
- Pattern: pointer--state-a-precedence-for-competing-gestures
- Status: ruling
