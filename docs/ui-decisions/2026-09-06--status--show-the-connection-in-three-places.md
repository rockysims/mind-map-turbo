# Show the connection in three places, at three weights

- Situation: a feature that only works when an external service and its credential are configured.
- Proposed: one connected line inside the setup sheet, which the reader closes and never sees again.
- Chosen: a dot in the toolbar (ambient), a `Connected · <model>` line beside the run action (contextual), and a brief `Connected.` in the setup sheet held long enough to be read before the sheet closes (confirmation).
- Why: "The connection shows as a dot in the toolbar, a 'Connected · model' line beside Run, and a brief 'Connected.' in the sheet before it closes" — ambient state belongs where the action is taken, and a state change deserves a moment of acknowledgement before the surface that showed it disappears. (from the commit body)
- Pattern: status--show-critical-status-in-more-than-one-place
- Status: ruling
