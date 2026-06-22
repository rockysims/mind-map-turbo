# Milestone 04m: Single-document save UX

**Status:** not started
**Depends on:** milestone 04l (self-contained HTML save files).
**Plan:** [2026-06-21 04m-single-document-save-ux.md](../plans/2026-06-21%2004m-single-document-save-ux.md)

## Goal

Make the persistence UI match the new portable HTML document model: one browser
tab edits one graph, local storage is recovery draft storage, and the explicit
file action is a user-controlled Download.

Users should be able to double-click a saved `.html` graph document, edit it,
refresh without losing work, see whether their local draft differs from the file
version, and download a new self-contained `.html` when they want a durable
portable copy.

## Scope

### Single document per tab

- Remove the graph dropdown from the main toolbar. The active graph is the graph
  opened in this tab: an embedded HTML document payload, a recovered local draft,
  or a newly-created default graph.
- Keep a New action, but make it replace the current tab's active document after
  protecting dirty work with an explicit confirmation.
- Treat existing `localStorage` graph-list data as legacy/internal recovery data,
  not as a user-facing library to browse from the primary UI.

### File controls

- Remove the primary Import button. Users open `.html` save files by
  double-clicking them or choosing them from the browser/OS file picker outside
  the app.
- Remove the primary Delete button. Draft cleanup and local-storage management
  can be designed later as a separate recovery/settings surface.
- Rename Export to Download so the UI does not imply silent overwrite or
  save-in-place behavior that browsers do not guarantee.
- Keep downloaded artifacts self-contained HTML documents with the current app,
  graph data, view state, document id, and compatibility metadata.

### Draft and file status

- Replace the toolbar's right-side text with document status copy that tells the
  user whether the local draft matches the opened/downloaded file version or
  differs from it.
- Prefer recovered dirty local drafts over embedded file payloads for the same
  document id, and clearly say when local edits were recovered.
- For a newly-created graph, do not show a "download needed" state until the graph
  data differs from the default new-graph template.
- After Download, update the in-memory baseline so the status reflects that the
  current draft matches the downloaded content, while avoiding copy that claims
  the original file was overwritten.

### Safety and compatibility

- Never overwrite a dirty local draft just because the user opened or refreshed a
  `.html` document with the same document id.
- Avoid silently reloading another tab's storage update over dirty work in the
  current tab.
- Keep legacy JSON and HTML parsing helpers available for compatibility and
  tests, even if the main toolbar no longer exposes Import.

## Acceptance criteria

- The toolbar exposes only the primary document controls needed for this model:
  New, Download, and status text.
- The toolbar no longer shows a graph dropdown, Import button, or Delete button.
- Download produces a self-contained `.html` graph document and uses user-facing
  "Download" naming in labels, status, and tests.
- Opening a saved `.html` with no dirty draft loads the embedded graph.
- Opening or refreshing a saved `.html` with a dirty draft for the same document
  id auto-opens the draft and indicates that local edits were recovered or differ
  from the file version.
- A newly-created graph starts clean; the status does not ask for Download until
  its graph data differs from the default template.
- Editing graph data changes the status to indicate a local draft exists that
  should be downloaded for a durable file copy.
- Downloading the current draft updates the status baseline without claiming the
  original file was overwritten.
- Cross-tab storage updates do not silently replace dirty work in the current
  tab.
- Specs cover status derivation, new-template cleanliness, dirty draft recovery,
  and dirty-draft precedence over embedded payloads.
- Browser coverage verifies open/edit/refresh/download/open propagation and the
  simplified toolbar surface.
- Lint, check, unit tests, and relevant browser tests pass.

## Non-goals

- Native save-in-place or File System Access API file handles.
- A local graph library, local draft manager, or storage cleanup UI.
- Reintroducing Import through another primary toolbar affordance.
- Deleting or migrating existing local graph keys created by earlier milestones.
- Merge UI for two actively-edited dirty tabs of the same document.
- Compression, signing, encryption, or trust warnings for HTML documents.
- Server persistence, accounts, or multiplayer changes.

## Risks and open questions

Resolved in the plan; kept here for context.

- **Dirty status can become noisy if view-only navigation counts as unsaved
  work.** The plan should decide whether user-facing "download needed" tracks
  graph data only or the full exported payload.
- **Removing the graph dropdown can hide legacy local graphs.** The plan should
  preserve data and defer any recovery/cleanup surface rather than deleting
  existing user drafts.
- **Download copy can overpromise.** The UI should say "Downloaded" or "Matches
  downloaded file", not "Saved", because the browser may create a copy instead of
  overwriting the opened file.
- **Auto-opening recovered drafts protects work but can surprise users expecting
  the file payload.** Status copy and a future "open file version" recovery
  action can address this without risking data loss.
- **Cross-tab draft conflicts can still happen.** The milestone should prevent
  silent overwrites first and defer merge/conflict-resolution UI until real usage
  demands it.
