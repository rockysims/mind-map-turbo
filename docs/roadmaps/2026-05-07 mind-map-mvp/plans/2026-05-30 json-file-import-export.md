# Plan: JSON file import/export

**Created:** 2026-05-30
**Author:** Cursor agent
**Milestone:** [milestones/04c-json-file-import-export.md](../milestones/04c-json-file-import-export.md)
**Status:** draft
**Total estimated effort:** L

## Summary

Add explicit JSON backup and restore flows on top of the existing
local-first persistence layer. Exported files use the milestone-04 schema
envelope, include graph view state such as pan and zoom, validate before
replacing the active graph, and keep `localStorage` as the refresh-safe
autosave path.

## Open questions resolved

- **Download API in tests.** **Use a small injected browser-file adapter and
  test it through Storybook, with Playwright reserved for the full app
  round-trip.** Keeping `Blob`, object URL, anchor click, and file text reads
  behind one adapter makes export behavior assertable without brittle download
  plumbing in every component test.
- **Import confirmation.** **Use a local `window.confirm` hook for this MVP
  flow instead of introducing a reusable dialog primitive.** The milestone
  needs one destructive confirmation, and a full dialog system belongs with a
  broader UI pass.
- **Graph metadata shape.** **Export the complete `MultigraphData` inside the
  current schema envelope and keep validation centralized in migrations.** This
  lets milestone 04f widen the graph data shape in one place and have both
  autosave and file import/export inherit the same versioned contract.
- **Pan and zoom persistence.** **Store a small `viewState` object beside graph
  `data` in the persisted envelope, with defaults for older payloads.** Pan and
  zoom are graph-level context rather than node data, so keeping them adjacent
  to `data` preserves the immutable graph model while letting backups and
  refresh recovery restore the user's camera.

## Out of scope (for this plan)

- Cloud file pickers, native file-system handles, drag-and-drop import, or
  directory access.
- Merging imported data into the current graph; imports replace the active
  graph after confirmation.
- A reusable modal/dialog primitive.
- Schema version 2 or tag color config itself; this plan preserves the path
  for 04f but does not implement 04f.
- Server-side import/export endpoints.
- Per-device responsive viewport restoration beyond saved pan and zoom; if a
  graph is opened on a very different screen size, follow-up UX can add a
  "fit to graph" affordance.

## Tasks

### T01 — Add pure graph file serialization helpers

|                |                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                                                                      |
| **Wave**       | 1                                                                                                                                      |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)                                                                                |
| **Effort**     | M                                                                                                                                      |
| **Files**      | new `src/lib/graphFile.ts`, new `src/lib/graphFile.spec.ts`, `src/lib/migrations.ts`, `src/lib/migrations.spec.ts`, `src/lib/index.ts` |
| **PR title**   | `feat(persistence): add graph file serialization helpers`                                                                              |

Define a pure persisted graph document shape that contains `data:
MultigraphData` plus `viewState` (`panX`, `panY`, `scale` or equivalent).
Implement helpers for turning that document into downloadable JSON and parsing
uploaded JSON back through the existing schema envelope. The helpers should wrap
the migration APIs, format exported JSON consistently, translate validation
errors into import-friendly messages, clamp invalid zoom values, and avoid
browser globals.

**Acceptance**

- Specs cover envelope-only export round-trip for graph data plus `viewState`,
  including the absence of `updatedAt` in exported files.
- Specs cover older envelope payloads with no `viewState` and default them to
  neutral pan/zoom.
- Specs cover invalid view state, including non-finite pan values and out-of
  range zoom scale.
- Specs cover malformed JSON, malformed graph data, and unsupported schema
  versions with stable error codes/messages.
- Failed parse returns or throws before any caller-visible graph replacement can
  happen.
- The helper API is pure and can run in the server Vitest project.

### T02 — Expose stage view state changes from Multigraph

|                |                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------- |
| **Depends on** | T01                                                                                      |
| **Wave**       | 2                                                                                        |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)                                  |
| **Effort**     | M                                                                                        |
| **Files**      | `Stage.svelte`, `Stage.stories.svelte`, `Multigraph.svelte`, `Multigraph.stories.svelte` |
| **PR title**   | `feat(multigraph): expose persisted stage view state`                                    |

Thread view state through the graph UI without making `Stage` aware of
persistence. `Stage` should accept initial pan/zoom, emit changes after user
pan/zoom gestures, and let `Multigraph` expose those changes through callback
props alongside graph-data changes.

**Acceptance**

- Stories prove initial pan and zoom are applied on mount.
- Stories prove panning and zooming emit view-state changes through harness
  data attributes.
- Existing node drag, click, pinch, and wheel behavior remains covered.
- View-state callbacks are separate from graph-data mutation callbacks so moving
  the camera does not look like a node-data edit.

### T03 — Add a browser file adapter and toolbar actions

|                |                                                                                         |
| -------------- | --------------------------------------------------------------------------------------- |
| **Depends on** | T01                                                                                     |
| **Wave**       | 2                                                                                       |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)                                 |
| **Effort**     | M                                                                                       |
| **Files**      | new `src/lib/browserGraphFile.ts`, `GraphToolbar.svelte`, `GraphToolbar.stories.svelte` |
| **PR title**   | `feat(graph): add import and export toolbar controls`                                   |

Add toolbar UI for Export and Import next to the existing graph persistence
controls. Keep DOM-specific work in a tiny adapter that creates downloads,
reads `File` text, and resets the hidden file input so importing the same file
twice still fires a change event.

**Acceptance**

- `GraphToolbar` exposes callback props for export and import without knowing
  persistence internals.
- The import control accepts `.json` / `application/json` and remains reachable
  by accessible name.
- Story coverage proves clicking Export calls the export callback and selecting
  a file calls the import callback.
- The hidden file input is reset after each import attempt.

### T04 — Teach the persistence controller to import and export graph documents

|                |                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T01, T02                                                                                                             |
| **Wave**       | 3                                                                                                                    |
| **Agent**      | high-reasoning (`gpt-5.3-codex` or `claude-opus-4-8-thinking-high`)                                                  |
| **Effort**     | M                                                                                                                    |
| **Files**      | `src/lib/graphPersistenceController.ts`, `src/lib/graphPersistenceController.spec.ts`, `usePersistedGraph.svelte.ts` |
| **PR title**   | `feat(persistence): import and export persisted graph files`                                                         |

Add controller methods that export the current graph data and view state as
envelope JSON and import validated graph documents into the active graph id.
Import should flush pending saves first, confirm before replacing a non-empty
graph, update `graphGeneration`, save the replacement graph and view state,
refresh graph summaries, and emit notices for success, invalid files,
unsupported versions, read failures, and cancellation.

**Acceptance**

- Specs prove export returns the current graph and view state in
  schema-envelope JSON.
- Specs prove valid import replaces the active graph and view state, increments
  generation, saves to the currently loaded graph id, and refreshes summaries.
- Specs prove invalid or unsupported imports leave the graph, generation, and
  view state storage untouched.
- Specs prove pan/zoom changes autosave and refresh like graph data changes,
  without mutating node positions.
- Specs cover declined confirmation on a non-empty graph and import without a
  confirmation prompt for an empty/default-safe graph if that policy is chosen
  in implementation.

### T05 — Wire file actions into the page and persistence harness

|                |                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------- |
| **Depends on** | T03, T04                                                                                     |
| **Wave**       | 4                                                                                            |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)                                      |
| **Effort**     | M                                                                                            |
| **Files**      | `src/routes/+page.svelte`, `PersistedGraphHarness.svelte`, `GraphPersistence.stories.svelte` |
| **PR title**   | `feat(persistence): wire JSON file actions into the app shell`                               |

Connect toolbar file callbacks to the controller and browser adapter in the
real page, and extend the Storybook harness with injectable file contents,
download capture, and confirmation responses. Keep the graph component itself
unaware of files and storage.

**Acceptance**

- A story exports a saved graph, imports that same payload back into the
  harness, and asserts graph data, pan, zoom, and success notice.
- A story imports invalid JSON and proves the existing graph is still rendered.
- A story covers confirming replacement of a non-empty graph.
- The page uses the browser adapter only in client code and keeps server render
  paths free of DOM globals.

### T06 — Cover full app file and refresh behavior

|                |                                                          |
| -------------- | -------------------------------------------------------- |
| **Depends on** | T05                                                      |
| **Wave**       | 5                                                        |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)  |
| **Effort**     | S                                                        |
| **Files**      | `e2e/app.test.ts`                                        |
| **PR title**   | `test(persistence): cover JSON file import export flows` |

Extend Playwright coverage for the user-facing app flow: export a graph,
import the exported JSON back into the selected graph, and confirm refresh
recovery still comes from `localStorage` without any file import.

**Acceptance**

- The test creates a graph, edits a node, captures the downloaded JSON, and
  verifies it contains `schemaVersion: 1`, the edited graph data, and saved
  view state.
- The test imports that JSON into the app and sees the expected graph at the
  expected pan/zoom state.
- The test reloads after editing, panning, and zooming, then confirms graph data
  and view state restore from `localStorage` even when no import happens.
- Existing persistence e2e tests continue to pass from clean browser storage.

### T07 — Close documentation and status loop

|                |                                                                      |
| -------------- | -------------------------------------------------------------------- |
| **Depends on** | T06                                                                  |
| **Wave**       | 6                                                                    |
| **Agent**      | fast/cheap (`composer-2.5-fast` or `kimi-k2.5`)                      |
| **Effort**     | XS                                                                   |
| **Files**      | this plan, `milestones/04c-json-file-import-export.md`, `roadmap.md` |
| **PR title**   | `docs(roadmap): mark JSON file import export complete`               |

After implementation and validation land, update roadmap status fields and
capture any follow-up compatibility notes for milestone 04f.

**Acceptance**

- Plan status is `done`, milestone status is `complete`, and roadmap row 04c
  links both the milestone and this plan.
- Notes mention any schema-shape constraints that 04f must preserve or migrate.

## Wave plan

```
Wave 1   T01                 pure serialization/import validation foundation
Wave 2   T02  ‖  T03         view-state UI plumbing and toolbar/adapter in parallel
Wave 3   T04                 controller imports/exports graph data plus view state
Wave 4   T05                 app/harness integration after UI and controller APIs exist
Wave 5   T06                 full app coverage after integration
Wave 6   T07                 documentation/status closeout
```

Total: 7 tasks, ~6 sequential gates, max parallelism in wave 2.

Before starting a wave, verify every task in that wave has all dependencies
merged to `main`. T02 and T03 intentionally avoid touching the same primary
files so separate agents can run them in parallel.

## Risks and rollback

- **Export download behavior is browser-sensitive.** Keep the browser adapter
  tiny and injectable; if Storybook proves flaky, fall back to asserting the
  generated JSON through the controller and leave only one Playwright download
  assertion.
- **Import replacement can overwrite unsaved changes.** Flush pending saves
  before import, confirm replacement for non-empty graphs, and do not mutate
  controller state until validation succeeds.
- **Schema assumptions may drift before 04f.** Centralize all parsing and
  formatting through the migration helpers so future metadata additions change
  one contract instead of separate autosave and file formats.
- **View state can feel wrong across screen sizes.** Persist the raw pan and
  zoom for faithful restore, but keep the format small and optional so a later
  fit-to-graph control can override it without changing graph data.
- **Saving camera movement could create noisy writes.** Treat view state as part
  of the debounced persistence path and emit changes after gesture completion or
  throttled updates, not on every pointermove frame.
- **If T01's helper API is wrong**, later tasks can still rollback by keeping
  the existing persistence path untouched; no production state changes until
  T04/T05 wire imports into the controller/page.

## Definition of Done (this plan)

The plan is done when:

- All 7 tasks are merged to `main`.
- The acceptance criteria from the milestone doc are satisfied.
- `pnpm --filter mind-map-sv lint`, `pnpm --filter mind-map-sv check`, and
  `pnpm --filter mind-map-sv test:unit -- --run` pass.
- The relevant Storybook/browser coverage and Playwright e2e flow pass.
- Plan status is `done`, milestone status is `complete`, and roadmap status for
  04c is `complete` with a link back to this plan.
- The finished work has been committed unless the user explicitly asked not to
  commit yet.

## Notes

- 2026-05-30: Existing `LocalStoragePersistence` stores the same
  schema-envelope payload plus `updatedAt`. File export should use only the
  envelope so backups match the server persistence body and stay free of local
  autosave metadata.
- 2026-05-30: Pan and zoom should persist with both autosave and files. Model
  them as graph-level `viewState` adjacent to `data`, not as fields on
  `MultigraphData`, because node positions already capture graph geometry while
  pan/zoom capture the user's camera.
