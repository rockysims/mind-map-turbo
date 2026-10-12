# Make the status line's name the control that changes it

- Situation: a status line naming the one variable a costly action runs against — `Connected · claude-sonnet-5` beside the AI node's Run button — with the setting itself living in an app-wide settings sheet.
- Proposed: leave the line read-only and send the reader to the settings sheet, where the model is one control among the cost and data preferences.
- Chosen: the model name on the line _is_ the picker, and the pick sticks to the node it was made on; the sheet's control becomes the "Default model" that nodes without a pick of their own follow.
- Why: "Where it says 'Connected · claude-sonnet-5' I'd like to be able to click on 'claude-sonnet-5' and switch to another model (sticky per node model choice)" (owner's words) — the question comes up beside the button that spends the tokens, and the answer belongs to the work, not to the session.
- Pattern: layout--let-a-badge-show-state-without-taking-a-gesture (overridden here: the surface has room, the picker is not a badge on a node that already carries three gestures, and the state is a choice rather than a report)
- Status: ruling
