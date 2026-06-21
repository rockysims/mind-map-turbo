# Milestone 04l: Self-contained HTML save files

**Status:** complete
**Depends on:** milestone 04c (JSON file import/export) and milestone 04
(persistence).
**Plan:** [2026-06-21 04l-self-contained-html-save-files.md](../plans/2026-06-21%2004l-self-contained-html-save-files.md)

## Goal

Make the app and each explicit save file self-propagating: a user should be able
to double-click a saved `.html` graph file, use the mind-map app entirely
offline, edit the graph, and export another `.html` graph file that carries both
the app code and the graph data forward.

This milestone turns file export from "portable graph backup" into "portable
app document" while keeping `localStorage` as the refresh-safe draft layer.

## Scope

### Single-file offline app build

- Produce a build artifact that is one self-contained `.html` file with the app
  code, styles, and required assets inlined.
- Remove server-only route requirements from the offline build path; offline
  documents always use local persistence.
- Ensure the app does not need network access, a development server, or adjacent
  `_app` asset files when opened from disk.
- Keep the app small enough that embedding it in every save file remains a
  practical distribution model.

### HTML graph document format

- Export graph save files as `.html` documents that contain the current app shell
  plus an inert embedded graph payload.
- Embed graph data in a known `type="application/json"` script tag, not in
  executable JavaScript, and escape payload text so graph content cannot break
  out of the tag.
- Include enough metadata to support stable document identity, draft recovery,
  schema compatibility checks, and future newer-app detection.
- Keep legacy `.json` graph imports working so existing exports remain usable.

### Import and boot behavior

- When opening a saved `.html` directly, load the embedded graph payload before
  falling back to ordinary saved graphs.
- Use `localStorage` for document-specific draft recovery so a refresh of an
  opened save file does not lose edits before the next explicit export.
- Let the Import button read both legacy `.json` files and self-contained `.html`
  save files without executing imported HTML.
- If the current app cannot parse a newer self-contained `.html` save, open the
  selected HTML file itself in a new tab so the app version embedded in that file
  can handle its own graph data.

### File-safe navigation

- Make graph selection and local graph switching work when the app is loaded from
  `file://`.
- Avoid route changes that assume a server root or a History API path that can be
  reloaded by a web server.

## Acceptance criteria

- The production build produces a self-contained `.html` artifact with no
  required sibling JS, CSS, or asset files.
- The self-contained artifact can be opened from disk and displays the default
  graph offline.
- Export downloads a `.html` save file containing the app and the current graph
  data/view state.
- Double-clicking an exported `.html` save file opens that graph offline.
- Editing an opened `.html` save file writes a document-specific local draft, and
  refresh restores the draft without requiring import.
- Exporting from an opened save file creates another self-contained `.html` save
  with the latest graph data.
- Import accepts both the new `.html` save format and legacy `.json` graph files.
- Importing a newer unsupported `.html` save opens that file in a new tab instead
  of attempting an unsafe or lossy migration.
- Specs cover HTML payload escaping, invalid payloads, legacy JSON compatibility,
  draft-key derivation, and newer-file fallback classification.
- Browser coverage verifies at least one offline open/export/import propagation
  flow.
- Lint, check, and unit tests pass.

## Non-goals

- Silently overwriting the same `.html` file that was double-clicked. Browser
  save/export remains an explicit download for this milestone.
- Native file handles or File System Access API save-in-place flows.
- Compression, binary save files, or app-code deduplication across documents.
- Cryptographic signing, trust warnings, or a sandboxed document viewer.
- Service workers, PWA install flows, or online app update checks.
- Server persistence, accounts, or multiplayer changes.

## Risks and open questions

Resolved in the plan; kept here for context.

- **Local file routing can break if it assumes a server root.** A `file://`
  document cannot safely navigate to `/` or rely on a server to serve fallback
  routes; the plan should choose hash/state navigation for offline use.
- **HTML save files are executable documents.** Import must treat selected files
  as text and extract only inert JSON, while double-clicking a file necessarily
  runs the app embedded in that file.
- **Local draft recovery can collide across copies.** Each exported document
  needs a stable identity so drafts for one graph file do not overwrite drafts
  for another.
- **Older app versions may not understand newer graph documents.** For HTML
  saves, opening the whole selected file in a new tab delegates parsing to the
  app copy embedded in that document.
- **Single-file size may grow.** Keep app assets small and defer compression
  until real save files prove size is a problem.
