# Hold, right-click and Shift+Enter are the second action

- Situation: a control whose primary tap already does something (a chip whose tap cycles) that needs a second action.
- Proposed: double-click.
- Chosen: one triple bound everywhere — hold (touch and everything else), right-click (desktop fast path, no wait) and Shift+Enter (keyboard and assistive tech). Nothing new is drawn on the control. The recognizer lives in the shared chip component so the surfaces cannot drift apart, and each surface says only what its secondary action is; edit mode sets its own `chipInsertLongPressMs`. Plain Enter and Space still activate a chip that has no tap of its own.
- Why: "A chip's single click cycles, so a double-click would cycle twice before inserting. The only ways out are deferring every cycle by `doubleClickMs` — 250ms of lag on the action used most, with the chip visibly unresponsive — or applying and reverting two cycles, which flickers and lies if a re-render lands between." And: "a focusable button that ignores its own activation keys is broken however consistent its pointer gestures are."
- Pattern: pointer--give-a-secondary-action-one-gesture-triple
- Status: ruling
