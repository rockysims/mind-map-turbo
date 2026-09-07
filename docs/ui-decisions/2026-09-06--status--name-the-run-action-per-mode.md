# Name the run action per mode

- Situation: the AI workbench's primary button starts a request that takes seconds, with a mode selector sitting beside it.
- Proposed: a generic `Run` label, the same in every mode and unchanged while the request is out.
- Chosen: the button names what this mode will do — `Write & run`, `Change & run`, `Run` — and says so in flight.
- Why: a run in flight has to say so on the control that started it, and the same button runs three different things, so a bare spinner cannot say which. (from the commit body)
- Pattern: status--name-the-pending-state-on-the-control
- Status: ruling
