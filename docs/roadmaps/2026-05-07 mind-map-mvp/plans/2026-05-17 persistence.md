# Plan: Persistence

**Created:** 2026-05-17
**Author:** Cursor agent
**Milestone:** [milestones/04-persistence.md](../milestones/04-persistence.md)
**Status:** done
**Total estimated effort:** L

## Summary

Deliver local-first graph persistence behind a small interface, with a
versioned payload format and app wiring that can later swap to the server
implementation without rewriting the graph UI.

## Open questions resolved

- **Save granularity.** Save the whole `MultigraphData` blob for MVP.
  The current graph data is already immutable and small enough for a
  single-writer local-first flow; mutation deltas belong with multiplayer.
- **localStorage quotas.** Keep using `localStorage`, but add a namespace
  usage estimator and non-blocking warning when stored graph payloads exceed
  80% of a conservative 5 MB budget. Quota failures still surface through
  the same save-error notice.
- **Tab sync.** Listen for `storage` events for the active graph and reload
  the latest saved payload with a non-blocking notice. This avoids silent
  stale state without pretending to solve conflict resolution.
- **Graph id source.** Use the `graph` search param, defaulting to a stable
  `default` graph id. This preserves the existing `/` route and gives e2e
  tests a simple way to switch graphs.
- **Persistence selection.** Add a tiny `+page.server.ts` load that returns
  a serializable persistence kind from env. The browser constructs
  `LocalStoragePersistence` for MVP; `ServerPersistence` remains a thin
  fetch-backed implementation for the later backend milestone.

## Out of scope (for this plan)

- Server API routes, database schema, Drizzle migrations, and Postgres
  storage.
- Authentication, accounts, ownership, and per-user graph lists.
- Multi-writer merge semantics or CRDT integration.
- Undo/redo UI or version history beyond the schema-version envelope.
- Rich import/export flows; graph management stays in a small toolbar.

## Tasks

> Each task is one PR's worth of work. If a task feels like more than
> one logical commit, split it. The PR title is drafted up front so
> reviewers (and the model writing the commit) start aligned.

### ✓ T01 - Add schema envelope and migration helpers

|                |                                                               |
| -------------- | ------------------------------------------------------------- |
| **Depends on** | -                                                             |
| **Wave**       | 1                                                             |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)       |
| **Effort**     | S                                                             |
| **Files**      | new `src/lib/migrations.ts`, new `src/lib/migrations.spec.ts` |
| **PR title**   | `feat(persistence): add versioned graph payload migrations`   |

Implement the `schemaVersion: 1` envelope, `CURRENT_SCHEMA_VERSION`, and
helpers to wrap, unwrap, and migrate persisted payloads into
`MultigraphData`.

**Acceptance**

- Specs cover wrapping current graph data, reading version 1 payloads, and
  rejecting malformed or unsupported payloads with a typed error.
- The stored JSON shape includes `{ schemaVersion: 1, data: ... }`.
- Migration helpers do not read browser globals and remain unit-testable in
  the server Vitest project.

### ✓ T02 - Implement the persistence interface and storage backends

|                |                                                                                         |
| -------------- | --------------------------------------------------------------------------------------- |
| **Depends on** | T01                                                                                     |
| **Wave**       | 2                                                                                       |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)                                 |
| **Effort**     | M                                                                                       |
| **Files**      | new `src/lib/persistence.ts`, new `src/lib/persistence.spec.ts`, `src/lib/appConfig.ts` |
| **PR title**   | `feat(persistence): add local and server persistence adapters`                          |

Define the `Persistence` interface, implement `LocalStoragePersistence`
with an injected `Storage`, implement a thin `ServerPersistence` fetch
adapter, and expose a factory keyed by the server-provided persistence kind.

**Acceptance**

- `LocalStoragePersistence` specs cover round-trip load/save, list ordering
  by `updatedAt`, delete, missing graph returns `null`, namespace isolation,
  and schema envelope usage.
- `ServerPersistence` specs verify request method/path/body shape with an
  injected `fetch`.
- Config pins the storage namespace, debounce duration, and quota warning
  budget in `APP_CONFIG.persistence`.

### ✓ T03 - Add debounced save scheduling and status modeling

|                |                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------- |
| **Depends on** | T02                                                                                           |
| **Wave**       | 3                                                                                             |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)                                       |
| **Effort**     | M                                                                                             |
| **Files**      | new `src/lib/saveScheduler.ts`, new `src/lib/saveScheduler.spec.ts`, `src/lib/persistence.ts` |
| **PR title**   | `feat(persistence): debounce graph saves and report status`                                   |

Create a small scheduler that accepts graph changes, debounces saves,
supports an explicit flush, and reports `idle`, `saving`, `saved`,
`warning`, and `error` states for the page notice.

**Acceptance**

- Specs use fake timers to prove only the latest graph in a burst is saved.
- Specs cover explicit flush before graph switches/deletes and propagation
  of save errors without dropping the pending graph.
- Quota warning calculation is deterministic and testable without
  `localStorage`.

### ✓ T04 - Expose Multigraph change notifications without storage coupling

|                |                                                            |
| -------------- | ---------------------------------------------------------- |
| **Depends on** | T03                                                        |
| **Wave**       | 4                                                          |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)    |
| **Effort**     | M                                                          |
| **Files**      | `Multigraph.svelte`, `Multigraph.stories.svelte`           |
| **PR title**   | `feat(multigraph): notify callers when graph data changes` |

Add a callback prop such as `onMultigraphChange` and invoke it after user
mutations have produced the settled graph data the page should persist.
Keep `Multigraph` unaware of `Persistence`, `localStorage`, or save status.

**Acceptance**

- Storybook coverage proves add-node, move, edit, pin, delete, and edge
  mutations emit updated graph data through the callback.
- Existing stories keep using in-memory args and do not read or write
  `localStorage`.
- The prop-reset effect does not echo initial props as a user save.

### ✓ T05 - Wire page-level persistence and graph management UI

|                |                                                                                     |
| -------------- | ----------------------------------------------------------------------------------- |
| **Depends on** | T04                                                                                 |
| **Wave**       | 5                                                                                   |
| **Agent**      | high-reasoning (`gpt-5.3-codex` or `claude-opus-4-7-thinking-xhigh`)                |
| **Effort**     | L                                                                                   |
| **Files**      | `src/routes/+page.svelte`, new `src/routes/+page.server.ts`, `src/lib/appConfig.ts` |
| **PR title**   | `feat(persistence): persist graphs from the page shell`                             |

Replace the static page graph with load/save state, search-param graph ids,
the debounced scheduler, storage-event reloads, non-blocking notices, and
a compact toolbar for new/load/delete graph operations.

**Acceptance**

- Initial mount loads the selected graph or creates the default graph when
  none is stored.
- User graph changes schedule a debounced save, graph switches flush the
  current graph first, and delete removes the selected graph before routing
  to an existing or new graph.
- Save errors and quota warnings are visible but do not block graph editing.
- `+page.server.ts` returns only serializable config and defaults to local
  persistence when env is unset.

### ✓ T06 - Cover persistence with Playwright e2e flows

|                |                                                         |
| -------------- | ------------------------------------------------------- |
| **Depends on** | T05                                                     |
| **Wave**       | 6                                                       |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`) |
| **Effort**     | M                                                       |
| **Files**      | `e2e/app.test.ts`                                       |
| **PR title**   | `test(persistence): cover reload and multi-graph flows` |

Extend the existing e2e smoke test into persistence coverage for reloads
and switching between multiple local graphs.

**Acceptance**

- Test starts from clean browser storage.
- User adds or edits a node, reloads the page, and the node is still
  visible.
- User creates a second graph, switches between both graph ids, and each
  graph keeps its own persisted data.
- The test asserts the stored payload has `schemaVersion: 1`.

### ✓ T07 - Close documentation and status loop

|                |                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T06                                                                                                             |
| **Wave**       | 7                                                                                                               |
| **Agent**      | fast/cheap (`composer-2-fast` or `kimi-k2.5`)                                                                   |
| **Effort**     | XS                                                                                                              |
| **Files**      | this plan, `milestones/04-persistence.md`, `roadmap.md`, `.github/PULL_REQUEST_TEMPLATE.md` if checklist drifts |
| **PR title**   | `docs(roadmap): mark persistence milestone complete`                                                            |

Update statuses and links after the implementation tasks have merged and
the milestone acceptance criteria are satisfied.

**Acceptance**

- Plan status is `done`, milestone status is `complete`, and roadmap row 04
  links both the milestone and this plan.
- Any notes from implementation that affect milestone 05 are captured in
  the plan notes or the multiplayer milestone.

## Wave plan

```
Wave 1   T01                 schema envelope before any storage code
Wave 2   T02                 storage depends on versioned payloads
Wave 3   T03                 save scheduler depends on persistence API
Wave 4   T04                 component callback unblocks page wiring
Wave 5   T05                 app integration after primitives are stable
Wave 6   T06                 e2e after UI and storage behavior exist
Wave 7   T07                 final docs/status closeout
```

Total: 7 tasks, 7 sequential gates. This milestone has little safe
parallelism because the later UI and e2e work depends on the persistence
contract and scheduler semantics being stable first.

A simple invariant to check before kicking off a wave: every task in the
wave has all its `Depends on` items already merged to `main`.

## Risks and rollback

- **T05 can grow too large.** If page wiring starts mixing toolbar UI,
  route state, and storage events into one hard-to-review diff, split it
  into "load/save shell" and "graph management toolbar" before opening the
  PR.
- **Callback semantics in T04 may save layout settling noise too often.**
  Mitigation: persist only user-meaningful graph changes, and keep scheduler
  debounce behavior covered by T03 specs.
- **`localStorage` quota behavior differs by browser.** Treat exact quota
  as advisory, test the deterministic estimator, and rely on caught save
  errors for real browser quota failures.
- **Storage-event reload may overwrite unsaved local edits.** Flush before
  graph switches and keep tab-sync behavior intentionally simple; if this
  becomes confusing, roll back to a warning-only notice until multiplayer.

## Definition of Done (this plan)

The plan is done when:

- All 7 tasks are merged to `main`.
- The acceptance criteria from the milestone doc are satisfied.
- `pnpm --filter mind-map-sv lint`, `pnpm --filter mind-map-sv check`, and
  `pnpm --filter mind-map-sv test:unit -- --run` pass on the final branch.
- The Playwright persistence e2e flow passes locally or in CI.
- Plan status is `done`, milestone status is `complete`, and roadmap status
  for milestone 04 is `complete` with a link back to this plan.
- The finished work has been committed unless the user explicitly asked not
  to commit yet.

## Notes

- 2026-05-17: Current `+page.svelte` owns a static graph literal, and
  `Multigraph.svelte` owns internal graph mutations without an upward
  callback. The persistence work should keep graph mutation logic in
  `Multigraph` and add a narrow change-notification prop rather than
  duplicating mutations in the page.
- 2026-05-17: Implementation completed with local-first persistence,
  versioned payloads, debounced page saves, graph management controls,
  storage-event reloads, Storybook callback coverage, and Playwright
  reload/multi-graph coverage. Multiplayer can keep treating
  `ServerPersistence` as the later API boundary.
