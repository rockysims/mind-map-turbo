# Guard every app shortcut with `keyboardIsInTextEntry()`

- Situation: window-level keydown handlers living alongside the app's text fields.
- Proposed: binding shortcuts at the window and letting focus sort it out.
- Chosen: every app shortcut calls `keyboardIsInTextEntry()` first — `Cmd/Ctrl+Z`, `Shift+Cmd/Ctrl+Z`, `Ctrl+Y`, bare `F`. `Cmd/Ctrl+K` still does not, and that is filed as debt and still open.
- Why: "Typing `Cmd+K` inside a node description — a real shortcut in other editors, and a plausible slip — throws the reader out of the field they were writing in and onto the query panel, with the edit sheet closed under them."
- Pattern: keyboard--guard-shortcuts-while-the-reader-is-typing
- Status: open
