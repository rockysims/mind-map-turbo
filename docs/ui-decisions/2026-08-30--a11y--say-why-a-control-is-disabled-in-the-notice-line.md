# Say why a control is disabled, in the notice line

- Situation: a control with nothing to do — Undo on a freshly opened file.
- Proposed: `disabled`, with a `title` carrying the explanation.
- Chosen: `aria-disabled` so the control still takes a tap, and the explanation goes to the app's status-notice line: `Nothing to undo. Opened files start fresh.`
- Why: "`title` is hover-only and this app is mobile-first…; the notice line is the one channel that reaches touch."
- Pattern: a11y--let-a-disabled-control-say-why
- Status: ruling
