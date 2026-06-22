# Plan: Single-document save UX

**Created:** 2026-06-21
**Author:** Codex agent
**Milestone:** [milestones/04m-single-document-save-ux.md](../milestones/04m-single-document-save-ux.md)
**Status:** done
**Total estimated effort:** L (4 tasks; status model, controller behavior,
toolbar simplification, and browser coverage)

## Summary

Streamline the persistence experience around one active graph per browser tab.
The app keeps local drafts for recovery, exposes Download as the explicit file
action, and replaces graph-library controls with status text that explains
whether the local draft matches the file/download baseline.

## Open questions resolved

- **Multiple local graphs vs. one active document.** **Use one browser tab equals
  one graph.** This matches the self-contained HTML document model and removes
  the confusing graph-library surface from the primary UI.
- **Import entry point.** **Remove the main Import UI.** Opening a document should
  happen by opening the `.html` file itself; pure parsers can stay for legacy
  compatibility and tests.
- **Delete entry point.** **Remove the main Delete UI without deleting existing
  stored data.** Draft cleanup needs its own recovery/storage design and should
  not ride along with the primary editing toolbar.
- **Export naming.** **Rename Export to Download.** The browser action creates a
  downloaded artifact and cannot honestly promise that the opened file was
  overwritten.
- **New graph cleanliness.** **Treat the default new-graph template as clean.**
  The status should not ask for Download until graph data differs from the
  template, so opening the app to a blank/default graph does not create false
  urgency.
- **Dirty status scope.** **Base user-facing "download needed" on graph-data
  changes, not view-only navigation.** View state remains part of downloaded
  documents, but pan/zoom alone should not look like unsaved graph work.
- **Draft vs. embedded file precedence.** **Dirty local draft wins.** If an
  embedded HTML payload and a local draft share a document id, preserving local
  edits is safer than silently reseeding from the file.
- **Cross-tab storage updates.** **Do not silently reload over dirty work.** A
  clean tab may accept external storage changes, but a dirty tab should keep its
  current draft and surface status instead of replacing it.

## Out of scope (for this plan)

- Native save-in-place or File System Access API flows.
- A local graph browser, draft manager, or storage cleanup UI.
- Deleting, rewriting, or migrating legacy local graph keys.
- Merge/conflict UI for simultaneous dirty edits in multiple tabs.
- Removing pure legacy JSON/HTML import compatibility.
- Server persistence, accounts, or multiplayer work.

## Tasks

> Each task is one PR-sized unit. The work is intentionally sequenced because
> the persistence controller, route page, and toolbar all participate in the same
> user-visible state machine.

### ✓ T01 - Add document fingerprint and status helpers

|                |                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------- |
| **Depends on** | -                                                                                                   |
| **Wave**       | 1                                                                                                   |
| **Agent**      | Default workhorse                                                                                   |
| **Effort**     | M                                                                                                   |
| **Files**      | `apps/mind-map-sv/src/lib/*document*.ts`, colocated specs, maybe `graphFile.ts` or `persistence.ts` |
| **PR title**   | `feat(persistence): model document draft status`                                                    |

Add pure helpers for comparing the active graph to its file/download baseline
and to the default new-graph template. The helper should produce stable status
states such as clean file, dirty draft, recovered draft, clean new graph, and
downloaded current version without depending on autosave metadata.

**Acceptance**

- Specs cover clean opened file, dirty opened file, recovered dirty draft, clean
  new graph, edited new graph, and just-downloaded graph states.
- User-facing dirty/download-needed status ignores view-only navigation while
  preserving view state in the file payload.
- Fingerprints exclude autosave-only metadata such as `updatedAt` and are stable
  across save/load cycles for the same graph data.
- The helper returns copy-neutral state identifiers; component wording remains
  outside the pure module.

### ✓ T02 - Preserve dirty document drafts during boot and autosave

|                |                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T01                                                                                                                              |
| **Wave**       | 2                                                                                                                                |
| **Agent**      | High-reasoning                                                                                                                   |
| **Effort**     | L                                                                                                                                |
| **Files**      | `+page.svelte`, `graphPersistenceController.ts`, `usePersistedGraph.svelte.ts`, `persistence.ts`, related controller specs/tests |
| **PR title**   | `fix(persistence): prefer recovered document drafts`                                                                             |

Replace the current "seed embedded payload into localStorage, then load" boot
path with draft-aware document loading. Opening a saved HTML file should use the
embedded payload only when it will not clobber a dirty local draft for the same
document id.

**Acceptance**

- Opening an HTML document with no existing dirty draft loads the embedded graph
  and initializes the document baseline.
- Opening or refreshing an HTML document with a dirty draft for the same
  document id loads the draft and records a recovered/differs status.
- The embedded payload never overwrites a dirty local draft during boot.
- Storage events from another tab do not silently replace the current tab's dirty
  graph.
- New graph creates a clean active document based on the default template and
  does not show download-needed status until graph data changes.
- Controller specs cover embedded-vs-draft precedence, new graph reset behavior,
  and external storage reload behavior.

### ✓ T03 - Simplify the toolbar to document controls

|                |                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T02                                                                                                                                    |
| **Wave**       | 3                                                                                                                                      |
| **Agent**      | Default workhorse                                                                                                                      |
| **Effort**     | M                                                                                                                                      |
| **Files**      | `GraphToolbar.svelte`, `GraphToolbar.stories.svelte`, `GraphPersistence.stories.svelte`, `+page.svelte`, `usePersistedGraph.svelte.ts` |
| **PR title**   | `feat(toolbar): simplify document save controls`                                                                                       |

Remove the graph dropdown, Import control, and Delete button from the primary
toolbar. Keep New, rename Export to Download, and map the document status model
to concise right-side copy.

**Acceptance**

- The toolbar renders New, Download, and status text only for persistence
  controls.
- Accessible labels and story names use Download terminology instead of Export.
- New prompts before replacing a dirty active document, then resets the graph to
  the clean default-template baseline when confirmed.
- Status copy distinguishes at least: clean opened/downloaded file, local draft
  differs from file, recovered local edits, clean new graph, edited new graph,
  and download just completed.
- Story coverage asserts the simplified toolbar surface and representative
  status copy.

### ✓ T04 - Verify the single-document offline flow

|                |                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| **Depends on** | T03                                                                                                     |
| **Wave**       | 4                                                                                                       |
| **Agent**      | Default workhorse                                                                                       |
| **Effort**     | M                                                                                                       |
| **Files**      | `apps/mind-map-sv/e2e/app.test.ts`, related unit/story specs, milestone/plan status updates after merge |
| **PR title**   | `test(app): cover single-document save ux`                                                              |

Update browser and story coverage around the new product contract. Replace
graph-dropdown/import/delete expectations with open/edit/refresh/download/open
document flows and dirty-draft recovery checks.

**Acceptance**

- E2E verifies opening a self-contained HTML document, editing it, refreshing,
  recovering the local draft, downloading, and opening the downloaded file.
- E2E verifies dirty local drafts win over stale embedded payloads for the same
  document id.
- E2E verifies the toolbar no longer exposes graph selection, Import, or Delete.
- Existing HTML export/download payload checks still prove the file is
  self-contained and includes current graph data.
- Legacy JSON parsing remains covered by unit specs even without a primary
  Import button.
- Lint, check, unit tests, and relevant e2e tests pass.

## Wave plan

```text
Wave 1   T01
Wave 2   T02
Wave 3   T03
Wave 4   T04
```

The waves are serialized because T02 and T03 both reshape the same
controller/page/toolbar contract, and T04 should validate the final user-facing
surface rather than an intermediate one.

## Risks and rollback

- **Existing local graphs become less discoverable.** Do not delete old storage
  keys; rollback can re-expose the dropdown while a separate recovery surface is
  designed.
- **Dirty status may under-report view-only changes.** The helper isolates the
  decision so the product can later include view state without rewriting the
  toolbar or persistence controller.
- **Download status could sound like save-in-place.** Keep copy explicit:
  "Downloaded" or "Matches downloaded file", never "Saved to this file".
- **Recovered draft precedence can surprise users who expected the embedded
  file.** Prefer protecting work now; add an "open file version" recovery action
  later if real users need it.
- **Cross-tab behavior can get complicated.** This plan prevents silent
  overwrite/reload first and defers merge UI to a future milestone.
- **Removing Import might strand legacy JSON users.** Retain pure parser coverage
  and leave room for a later lower-priority Open/Recover affordance.

## Definition of Done (this plan)

- All 4 tasks are merged to `main`.
- The acceptance criteria from the milestone doc are satisfied.
- Plan status is `done`, milestone status is `complete`, and the roadmap row for
  04m links back to this plan.
- `pnpm --filter mind-map-sv lint` passes.
- `pnpm --filter mind-map-sv check` passes.
- `pnpm --filter mind-map-sv test:unit -- --run` passes.
- Relevant browser/e2e coverage for the offline document flow passes.
- No tracked changes to `.svelte-kit/`, build outputs, or `*storybook*.log`.

## Notes

- 2026-06-21: User confirmed the direction: one browser tab is one graph; no
  graph dropdown, Import, or Delete; Export becomes Download; status should show
  whether the draft differs from the file/download baseline; new default graphs
  should not show download-needed until graph data differs from the template.
- 2026-06-21: Executed all four waves in one implementation pass. The final
  behavior keeps Import parsing APIs for compatibility while removing the primary
  Import UI, treats ordinary local graph drafts as dirty relative to the default
  new-graph template, and does not seed embedded file payloads into localStorage
  until autosave activity creates a draft.
