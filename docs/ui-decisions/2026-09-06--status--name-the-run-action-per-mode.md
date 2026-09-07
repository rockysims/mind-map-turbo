# Name the run action per mode

- Situation: the AI workbench's primary button starts a request that takes seconds, with a mode selector sitting beside it.
- Proposed: a generic `Run` label, the same in every mode and unchanged while the request is out.
- Chosen: the button names what this mode will do — `Run analysis`, `Run script`, `Refine` — and reads `Running…` in flight.
- Why: "the button names what it will run, with 'Running…' in flight" — a run in flight has to say so on the control that started it. (from the commit body)
- Pattern: status--name-the-pending-state-on-the-control
- Status: ruling
