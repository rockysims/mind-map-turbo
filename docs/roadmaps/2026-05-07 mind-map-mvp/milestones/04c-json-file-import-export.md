# Milestone 04c: JSON file import/export

**Status:** complete
**Depends on:** milestone 04 (persistence).
**Plan:** [2026-05-30 json-file-import-export.md](../plans/2026-05-30%20json-file-import-export.md)

## Goal

Let users save and load a multigraph as a `.json` file while keeping the
current graph refresh-safe in `localStorage`. File export gives users a
simple backup and sharing path before multiplayer or accounts exist.

## Scope

### File operations

- Add an export action that serializes the current graph and view state
  to a `.json` file.
- Add an import action that reads a `.json` file and replaces the current
  graph and view state after validation.
- Reuse the milestone-04 schema envelope and migrations rather than adding
  a second ad hoc file format.
- Surface import errors in a non-blocking UI notice with enough detail to
  understand whether the file is invalid, unsupported, or failed to read.

### Local refresh recovery

- Keep `localStorage` responsible for remembering the current graph, graph
  id, pan, and zoom so a refresh does not lose the user's place.
- JSON files are explicit import/export artifacts, not a replacement for
  the autosave path.

### UX

- Put file actions near the existing graph persistence controls.
- Confirm before replacing a non-empty current graph during import.
- Preserve graph metadata that belongs to the multigraph, including future
  tag color config from milestone 04f.
- Preserve view state that belongs to the user's current graph context,
  including pan and zoom.

## Acceptance Criteria

- Unit specs cover schema-envelope round-trip for exported files,
  including pan and zoom.
- Unit specs cover import validation failures without mutating the current
  graph or view state.
- A story or browser test covers exporting a graph and importing the same
  payload back into the app.
- A browser test confirms refresh still restores the current graph, pan, and
  zoom without requiring a file import.
- Lint, check, and unit tests pass.

## Non-goals

- Cloud file pickers or native file-system write handles.
- Merge import into the current graph. Import replaces the current graph
  for MVP simplicity.
- Compression or binary formats.

## Risks and Open Questions

- **Download API in tests.** The plan should pick the smallest reliable
  browser-test strategy for asserting export behavior.
- **Import confirmation.** Decide whether the confirmation belongs in a
  reusable dialog primitive or a small local control.
- **Graph metadata shape.** Coordinate with milestone 04f so tag color
  config persists in both local autosaves and exported files.

## Notes

- 2026-05-30 (04f handoff): **schemaVersion 1** payloads carry `data` plus
  optional `viewState`. Local autosaves also include `updatedAt`; exported
  `.json` files omit `updatedAt` on purpose. Milestone 04f should extend or
  migrate this contract in one place (migrations) so autosave and file
  import/export stay aligned.
