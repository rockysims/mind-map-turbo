# Plan: Self-contained HTML save files

**Created:** 2026-06-21
**Author:** Codex agent
**Milestone:** [milestones/04l-self-contained-html-save-files.md](../milestones/04l-self-contained-html-save-files.md)
**Status:** draft
**Total estimated effort:** L (6 tasks; build target, file format, boot/draft
recovery, and offline verification)

## Summary

Deliver a single-file offline app build and make exported graph files into
self-contained `.html` documents that embed both the app and graph data. The
implementation preserves legacy JSON imports while shifting the primary sharing
model to portable app documents.

## Open questions resolved

- **Save-in-place vs. download new file.** **Download a new `.html` file for each
  explicit export.** Browsers cannot silently rewrite the file that was opened by
  double-click; native save-in-place can wait for a File System Access API follow-up.
- **File URL routing.** **Use file-safe hash/state navigation for offline
  documents.** Current query/path navigation can accidentally point at a server
  root such as `/` or a nonexistent local path when opened from `file://`, while
  hash changes stay inside the same physical HTML file and do not require a
  server fallback.
- **Draft recovery.** **Use `localStorage` for document-specific drafts.** The
  embedded HTML payload is the portable baseline, and `localStorage` protects
  refreshes or accidental tab closes until the user exports a new file.
- **Document identity.** **Add a stable document id to exported HTML payloads.**
  Draft keys should be scoped by document id so copies of one graph do not
  collide with unrelated saved documents.
- **Unsupported newer HTML saves.** **Open the selected HTML file itself in a new
  tab.** If an older app cannot parse a newer embedded payload, the app copy
  inside that save file is the best available reader for its own data.
- **Import safety.** **Never execute imported HTML in the Import flow.** The
  importer reads file text, extracts the known inert JSON script tag, and parses
  that payload; double-click/open-new-tab is the only path that runs a saved
  document.
- **Payload escaping.** **Escape `<` in embedded JSON and test `</script>` graph
  content.** This prevents user-authored node text from terminating the JSON
  script tag.
- **Primary file format.** **Export `.html` by default and keep `.json` import
  compatibility.** Existing backups should remain importable, but new saves
  should propagate the app.
- **Single-file implementation.** **Prefer a minimal Vite/SvelteKit single-file
  build path over custom app bootstrapping.** The app is already mostly
  client-side, so a static adapter plus inlining step is lower risk than
  replacing SvelteKit.

## Out of scope (for this plan)

- Silent overwrite of the currently opened `.html` file.
- File System Access API save handles or native app packaging.
- Compression, encrypted files, signatures, or trust UI.
- Service worker/PWA install behavior.
- Server persistence, multiplayer, accounts, or graph merge import.
- Rich-text/image payloads inside graph nodes.

## Tasks

> Each task is one PR-sized unit. Build and pure file-format work can start in
> parallel; route/page integration waits until the artifact and envelope shapes
> are known.

### T01 — Emit a self-contained offline app artifact

|                |                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------- |
| **Depends on** | -                                                                                            |
| **Wave**       | 1                                                                                            |
| **Agent**      | Default workhorse                                                                            |
| **Effort**     | M                                                                                            |
| **Files**      | `apps/mind-map-sv/package.json`, `svelte.config.js`, `vite.config.ts`, maybe `scripts/*.mjs` |
| **PR title**   | `build(app): emit self-contained offline html`                                               |

Switch the production/offline build path from server-shaped output to a static
single-file artifact. Remove or bypass the route-level server load for the
offline build, inline generated JS/CSS/assets, and keep local persistence as the
offline default.

**Acceptance**

- `pnpm --filter mind-map-sv build` or a clearly named build script produces a
  single `.html` app artifact.
- Opening the artifact from disk renders the default graph without network
  access or sibling asset files.
- The build output does not require `_app/immutable/*.js`, CSS files, favicon
  files, or `version.json` at runtime.
- Existing dev server workflow still works for local development.

### T02 — Add a pure HTML graph document envelope

|                |                                                                                       |
| -------------- | ------------------------------------------------------------------------------------- |
| **Depends on** | -                                                                                     |
| **Wave**       | 1                                                                                     |
| **Agent**      | Default workhorse                                                                     |
| **Effort**     | M                                                                                     |
| **Files**      | `apps/mind-map-sv/src/lib/graphFile.ts`, `apps/mind-map-sv/src/lib/graphFile.spec.ts` |
| **PR title**   | `feat(files): add html graph document envelope`                                       |

Extend the pure graph-file module with format-aware serialization/parsing. The
new HTML envelope should embed the schema payload in a known inert JSON script
tag and include document metadata such as document id, exporter/app compatibility
marker, and exported timestamp.

**Acceptance**

- HTML export/import round-trips graph data and view state through the pure API.
- Legacy JSON strings still parse through the same import entry point.
- Specs cover missing script tag, malformed JSON, unsupported schema, unsupported
  newer-app marker, and `</script>`/`<img onerror=...>` node text.
- The parser never uses DOM execution or `innerHTML`; it extracts text from the
  known payload marker safely.

### T03 — Wire HTML export/import through the UI and controller

|                |                                                                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T02                                                                                                                                                 |
| **Wave**       | 2                                                                                                                                                   |
| **Agent**      | Default workhorse                                                                                                                                   |
| **Effort**     | M                                                                                                                                                   |
| **Files**      | `graphPersistenceController.ts`, `browserGraphFile.ts`, `usePersistedGraph.svelte.ts`, `GraphToolbar.svelte`, `+page.svelte`, related specs/stories |
| **PR title**   | `feat(files): export and import html graph files`                                                                                                   |

Make Export download `.html` artifacts by default and make Import accept both
HTML save files and legacy JSON files. Keep import confirmation and invalid-file
notices aligned with the existing persistence controller behavior.

**Acceptance**

- Export downloads `${graphId}.html` with MIME type `text/html`.
- Import accepts `.html`, `text/html`, `.json`, and `application/json`.
- Importing an HTML save replaces the current graph and view state after the
  existing replacement confirmation.
- Importing a legacy JSON backup still succeeds.
- Story or browser coverage exercises the new import/export controls.

### T04 — Add document boot seeding and draft recovery

|                |                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T02, T03                                                                                                                         |
| **Wave**       | 3                                                                                                                                |
| **Agent**      | High-reasoning                                                                                                                   |
| **Effort**     | L                                                                                                                                |
| **Files**      | `+page.svelte`, `graphPersistenceController.ts`, `persistence.ts`, `appConfig.ts`, new pure draft-key helper and specs if useful |
| **PR title**   | `feat(persistence): recover drafts for html documents`                                                                           |

Teach the app to detect an embedded graph payload on initial boot and seed the
active graph from that payload before ordinary local graph loading. Add
document-id-scoped draft persistence so refreshes of an opened HTML save restore
the latest local edits until the user exports a new file.

**Acceptance**

- A directly opened HTML save shows its embedded graph even if unrelated
  `localStorage` graphs already exist.
- Edits to an opened HTML save are autosaved under a document-specific key.
- Refresh restores the local draft for that document id.
- Export from a document uses the latest draft data, not the original embedded
  payload.
- Specs cover draft-key derivation, draft-vs-embedded precedence, and isolation
  between two document ids.

### T05 — Make graph switching safe under `file://`

|                |                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------- |
| **Depends on** | T01, T03                                                                                 |
| **Wave**       | 4                                                                                        |
| **Agent**      | Default workhorse                                                                        |
| **Effort**     | S                                                                                        |
| **Files**      | `graphRoute.ts`, `+page.svelte`, `graphRoute.spec.ts`, `GraphPersistence.stories.svelte` |
| **PR title**   | `fix(routes): make graph navigation file-url safe`                                       |

Adjust graph selection/new-graph routing so the offline app never navigates away
from the physical HTML file. Prefer hash/state updates for file-loaded documents
while preserving normal dev-server behavior where practical.

**Acceptance**

- Selecting or creating a graph while opened from `file://` does not navigate to
  `/`, a directory, or another nonexistent local path.
- Refreshing a file-loaded document restores the selected graph/document state.
- Existing query-param behavior in dev/preview remains covered or is replaced by
  equivalent tested hash behavior.
- Pure route specs explain and cover the file URL case.

### T06 — Add newer-save fallback and offline propagation verification

|                |                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------- |
| **Depends on** | T01, T02, T03, T04, T05                                                                   |
| **Wave**       | 5                                                                                         |
| **Agent**      | Default workhorse                                                                         |
| **Effort**     | M                                                                                         |
| **Files**      | `browserGraphFile.ts`, `graphPersistenceController.ts`, `e2e/app.test.ts`, docs as needed |
| **PR title**   | `test(app): verify offline html propagation flow`                                         |

Finish the compatibility fallback and prove the full offline propagation loop:
open a self-contained app, create/edit graph data, export HTML, open/import that
HTML, and export again.

**Acceptance**

- Importing a self-contained HTML file with a newer unsupported app/payload
  marker opens the selected file in a new tab through a browser adapter.
- If popup behavior blocks the new tab, the app shows a recoverable notice or
  link instead of treating the file as invalid graph data.
- E2E coverage opens a self-contained HTML artifact via `file://` or an
  equivalent offline harness and verifies no network/sibling asset dependency.
- E2E coverage verifies export -> open/import -> edit -> export propagation.
- The final docs or notes mention that shared HTML save files are executable app
  documents and should be opened only when trusted.

## Wave plan

```text
Wave 1   T01  |  T02          (build artifact and pure envelope are independent)
Wave 2   T03                  (UI/controller import-export wiring)
Wave 3   T04                  (embedded boot and draft recovery)
Wave 4   T05                  (file-safe graph switching after page wiring settles)
Wave 5   T06                  (fallback behavior and end-to-end offline proof)
```

T03, T04, and T05 all touch `+page.svelte` and persistence coordination, so they
are intentionally serialized after the independent first wave. Before starting a
wave, verify every listed dependency has landed or been merged into the working
branch.

## Risks and rollback

- **Single-file build tooling is brittle with SvelteKit output.** Keep T01 in its
  own PR so rollback can restore the previous adapter/build config without
  touching file-format work.
- **File URL routing behaves differently across browsers.** Cover Chromium first
  with Playwright and isolate the route helper so Firefox/Safari differences can
  be fixed without changing graph persistence.
- **Local draft recovery loads stale data when the user expected the embedded
  payload.** Scope drafts by document id and expose a clear status notice when a
  recovered draft is newer than the embedded save.
- **HTML import security regresses.** Keep HTML parsing in pure text helpers and
  test script-breakout content; rollback T03/T06 UI wiring if import safety is
  uncertain.
- **Newer-file fallback opens a popup too late after async file reads.** If
  direct `window.open` is blocked, fall back to creating a visible user-clickable
  link backed by the selected file object URL.
- **Save files become too large.** Keep the milestone uncompressed, measure real
  artifact size in T06, and create a follow-up if size becomes painful.

## Definition of Done (this plan)

- All 6 tasks are merged to `main`; milestone 04l acceptance criteria are
  satisfied.
- `pnpm --filter mind-map-sv lint` passes.
- `pnpm --filter mind-map-sv check` passes.
- `pnpm --filter mind-map-sv test:unit -- --run` passes.
- `pnpm --filter mind-map-sv test:e2e` passes or any browser-specific limitation
  is documented with a narrower passing offline verification.
- Plan status is `done`, milestone status is `complete`, and roadmap status for
  04l is `complete` with a link back to this plan.
- The finished work has been committed unless the user explicitly asks not to
  commit yet.

## Notes

- 2026-06-21: User direction: downloading a new file is fine; localStorage draft
  recovery is desirable; exported documents should use stable ids; old apps
  should open newer HTML saves in a new tab instead of attempting migrations; app
  size is expected to remain small.
- 2026-06-21: The file URL routing issue is mostly about physical document
  identity. From `file:///.../graph.html`, navigating to `/` or relying on a
  server fallback can leave the opened file behind; hash/state navigation keeps
  the user inside that same HTML document.
