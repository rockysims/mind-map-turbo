# `Saved` is the file; `cached` is the browser copy

- Situation: the same concept named inconsistently across toolbar, dialogs and sheets, with internal model terms leaking into the copy.
- Proposed: fixing labels one at a time, leaving `localStorage` called "saved" while the only durable action was called "Download".
- Chosen: the vocabulary is fixed app-wide in one pass. `Saved` means exactly one thing, the file on disk; the browser copy is `cached`; the toolbar reads `New / Open / Save`; a save confirms by naming the file it wrote; the node sheet commits with `Done` so nothing else claims the word. Also `Export`→`Download`, `Load HTML file`→`Load graph file`, visible `Load`→`Open`, and every repair action's "confirm"→"label".
- Why: the old wording was "inverting both words". And on the repair actions: "'Confirm' was a word for a concept nobody was ever shown — what they were shown is two columns of labels."
- Pattern: copy--fix-the-vocabulary-in-one-pass
- Status: ruling, except the node-sheet clause: superseded (2026-10-12) by `2026-10-12--editing--the-edit-sheet-saves-on-click-away.md`, which renames the sheet's `Done` to `Save` on the owner's word. The rest of the vocabulary stands.
