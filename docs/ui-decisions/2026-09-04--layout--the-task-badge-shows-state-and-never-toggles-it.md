# The task badge shows state and never toggles it

- Situation: a small status indicator drawn on a canvas object that already carries a drag and a double-tap.
- Proposed: tapping the badge toggles the task done.
- Chosen: "No. The badge only shows state; done is toggled in the details view and the edit sheet." Badges sit in the band above the title, opposite the quantity chips, and take no pointer events, so tapping one is tapping the node. A done task's title is muted instead.
- Why: "Keeps every canvas tap for drag and double-tap and avoids a third gesture on the node. Decided by the user 2026-09-04."
- Pattern: layout--let-a-badge-show-state-without-taking-a-gesture
- Status: ruling
