# Plan: Persistence architecture refactor

**Created:** 2026-05-17
**Author:** Cursor agent
**Milestone:** [milestones/04-persistence.md](../milestones/04-persistence.md)
**Status:** executing
**Total estimated effort:** L

## Summary

Pull persistence, save scheduling, routing, and status mapping out of
`+page.svelte` into a pure `GraphPersistenceController` with its own
spec and a thin Svelte adapter, so the route file becomes a wiring
shell that conforms to `core.mdc`. No user-visible behavior changes.

## Open questions resolved

Milestone 04's persistence behavior shipped in
[plans/2026-05-17 persistence.md](2026-05-17%20persistence.md). This
follow-up plan owns its own (architecture-level) decisions:

- **Should the controller be a class or a function returning a
  store-like object?** **Class with `subscribe(listener)` and a
  `getView()` snapshot.** Mirrors `SaveScheduler` (already a class),
  keeps the surface unit-testable in Node, and lets the Svelte adapter
  be a 20-line `.svelte.ts` wrapper instead of a tangled rune graph.
- **How does the controller talk to SvelteKit routing?** **Via an
  injected `navigate(graphId)` callback.** Keeps the controller free
  of `$app/navigation` and `$app/paths` imports so it stays
  unit-testable; the page provides the `goto`+`resolve` implementation.
- **Where does the "Loaded …", "Reloaded …", "Saved." notice mapping
  live?** **Inside the controller as a single `ControllerStatus`
  discriminated union + a pure `statusToNotice` helper.** Today the
  page splits this between `loadGraph` (load-side strings) and
  `handleSaveStatus` (save-side strings); consolidating in the
  controller removes the only branchy logic still in the `.svelte`
  file.
- **Where does default-graph creation live?** **Stays as a factory
  passed into the controller (`createDefaultGraph`).** The default
  graph is product configuration, not persistence behavior; injecting
  it keeps the controller spec free of seed-data noise.
- **Does the controller own the storage-event listener?** **No — the
  page subscribes and forwards events as `controller.handleStorageEvent({ key })`.**
  Keeps the controller pure (no `window`); the page already owns DOM
  lifecycle via `onMount`.
- **Should we extract a `createGraphPersistenceStack` factory at the
  same time?** **No, defer.** Construction noise in the page is small
  once load/save/route logic has moved out; revisit only if the page
  still feels heavy after T03 lands.

## Out of scope (for this plan)

- Any change to the `Persistence` interface, `SaveScheduler` API, or
  schema envelope. Behavior parity is the bar.
- Server backend, Drizzle, Postgres — still milestone 05 territory.
- Multi-tab conflict resolution beyond the existing storage-event
  reload.
- Undo/redo, version history, or richer notice UX (toasts, etc.).
- Adding new persistence features (export/import, rename, duplicate);
  this plan keeps the toolbar contract identical.
- Replacing the existing Playwright e2e coverage with story coverage —
  e2e remains the source of truth for end-to-end persistence flows.

## Tasks

> Each task is one PR's worth of work. If a task feels like more than
> one logical commit, split it. The PR title is drafted up front so
> reviewers (and the model writing the commit) start aligned.

### T01 — Extract graph route helpers

|                |                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                        |
| **Wave**       | 1                                                                                        |
| **Agent**      | fast/cheap (`composer-2-fast` or `kimi-k2.5`)                                            |
| **Effort**     | XS                                                                                       |
| **Files**      | new `src/lib/graphRoute.ts`, new `src/lib/graphRoute.spec.ts`, `src/routes/+page.svelte` |
| **PR title**   | `refactor(persistence): extract graph route helpers`                                     |

Move `DEFAULT_GRAPH_ID` and the inline `graphSearch(graphId)` helper
out of `+page.svelte` into a pure module. Add a `resolveGraphHref`
helper that takes a SvelteKit `resolve` function plus a graph id and
returns the fully-resolved path — this kills the two
`// eslint-disable-next-line svelte/no-navigation-without-resolve`
comments currently in the page.

**Acceptance**

- Specs cover: default id → `'/'`, custom id → `'/?graph=<encoded>'`,
  ids containing reserved URL characters round-trip via
  `URLSearchParams`.
- `+page.svelte` no longer defines `DEFAULT_GRAPH_ID` or
  `graphSearch`; both `goto(...)` call sites use `resolveGraphHref`.
- No eslint-disable comments remain in `+page.svelte`.
- `pnpm --filter mind-map-sv lint`, `check`, and
  `test:unit -- --run` all pass.

### T02 — Add `GraphPersistenceController` and spec

|                |                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                             |
| **Wave**       | 1                                                                                             |
| **Agent**      | high-reasoning (`gpt-5.3-codex` or `claude-opus-4-7-thinking-xhigh`)                          |
| **Effort**     | L                                                                                             |
| **Files**      | new `src/lib/graphPersistenceController.ts`, new `src/lib/graphPersistenceController.spec.ts` |
| **PR title**   | `feat(persistence): add GraphPersistenceController for load/save/route orchestration`         |

Introduce a pure controller class that owns the load/save lifecycle,
graph list, loaded graph id, and a `ControllerStatus` discriminated
union (`loading | loaded | reloaded | saving | saved | warning | error`).
Dependencies (`Persistence`, `SaveScheduler`, `createDefaultGraph`,
`navigate`, `now`) are injected. The page is **not** wired up yet —
this PR delivers the controller and its spec only.

Public surface:

```ts
new GraphPersistenceController(deps);
controller.subscribe(listener);                 // returns unsubscribe
controller.getView();                           // ControllerView snapshot
controller.load(graphId, opts?);                // initial / switch / external reload
controller.notifyGraphChanged(data);            // wired to Multigraph callback
controller.selectGraph(graphId);                // flushes then calls deps.navigate
controller.createGraph(id?);                    // routes to a new generated id
controller.deleteGraph(graphId);                // deletes, only navigates when needed
controller.handleStorageEvent({ key });         // reload if key belongs to loaded graph
controller.dispose();
```

Plus a pure `statusToNotice(status: ControllerStatus): string` helper
exported from the same module.

**Acceptance**

- Specs run in the Node Vitest project (no `window`, no `localStorage`,
  no `goto`).
- Specs cover: initial load when no saved graph exists schedules and
  flushes a save; load of an existing graph emits a `loaded` status
  with the graph id; `selectGraph` flushes the pending save before
  calling `navigate`; `deleteGraph` does **not** navigate when the
  deleted graph is the only one (reloads default in place);
  `deleteGraph` does navigate to the next available graph when one
  exists; `handleStorageEvent` ignores keys that don't belong to the
  currently loaded graph; a save error transitions to `error` status
  without dropping the pending graph (mirrors existing
  `SaveScheduler` behavior); `statusToNotice` returns deterministic
  strings for every `ControllerStatus` kind.
- No imports of `$app/*`, `svelte`, or `localStorage` in the
  controller module.

### T03 — Wire the page through a Svelte adapter

|                |                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------- |
| **Depends on** | T01, T02                                                                                            |
| **Wave**       | 2                                                                                                   |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)                                             |
| **Effort**     | M                                                                                                   |
| **Files**      | new `src/lib/components/ui/GraphPersistence/usePersistedGraph.svelte.ts`, `src/routes/+page.svelte` |
| **PR title**   | `refactor(persistence): move page load/save logic into a controller adapter`                        |

Add the thin Svelte adapter (`usePersistedGraph.svelte.ts`) that
constructs the controller, mirrors its view into a `$state`, and
returns method bindings plus the reactive view. Rewrite `+page.svelte`
to delegate every load/save/route concern to the adapter; the page
becomes URL→adapter wiring plus `GraphToolbar`/`Multigraph` render.

**Acceptance**

- `+page.svelte` no longer contains: `loadGraph`, `handleSaveStatus`,
  `refreshGraphList`, `flushPendingSave`, `deleteSelectedGraph`'s
  navigation branch, or the storage-event reload branch logic. It
  may still construct `Persistence` and `SaveScheduler` and forward
  the storage event.
- Existing Playwright e2e tests (`home page renders the graph
entrypoint`, `persists edited nodes across reloads and graph
switches`, `deletes the selected graph without recreating it when
another graph exists`) pass unchanged.
- Existing Storybook stories (Multigraph, GraphToolbar) pass
  unchanged.
- `pnpm --filter mind-map-sv lint`, `check`,
  `test:unit -- --run`, and `test:e2e` all pass.

### T04 — Storybook coverage for the persistence shell

|                |                                                                                                                                                                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T03                                                                                                                                                                                                                                       |
| **Wave**       | 3                                                                                                                                                                                                                                         |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)                                                                                                                                                                                   |
| **Effort**     | M                                                                                                                                                                                                                                         |
| **Files**      | new `src/lib/components/ui/GraphPersistence/PersistedGraphHarness.svelte`, new `src/lib/components/ui/GraphPersistence/GraphPersistence.stories.svelte`, new `src/lib/components/ui/GraphPersistence/inMemoryPersistence.ts` (or similar) |
| **PR title**   | `test(persistence): cover the persistence shell with story play functions`                                                                                                                                                                |

Build a `PersistedGraphHarness` that renders `GraphToolbar` +
`Multigraph` driven by `usePersistedGraph` against an in-memory
`Persistence` implementation. The harness exposes the controller's
view via `data-last-*` attributes the same way `StageHarness` exposes
Stage callbacks. Stories: load existing graph, edit-and-save, create
a new graph, delete with another graph remaining, delete the last
graph (default fallback), external storage event triggers a reload.

**Acceptance**

- New stories use only the in-memory persistence; no story reads or
  writes `localStorage`.
- Each story's `play` function asserts on harness `data-*` attributes,
  not on internal controller state.
- Story names read like sentences (`UserCreatesAndSwitchesGraphs`,
  `DeletingLastGraphResetsToDefault`, etc.).
- `pnpm --filter mind-map-sv test:unit -- --run` runs the new
  story-project tests.

### T05 — Close documentation and status loop

|                |                                                                                 |
| -------------- | ------------------------------------------------------------------------------- |
| **Depends on** | T04                                                                             |
| **Wave**       | 4                                                                               |
| **Agent**      | fast/cheap (`composer-2-fast` or `kimi-k2.5`)                                   |
| **Effort**     | XS                                                                              |
| **Files**      | this plan, `docs/roadmaps/2026-05-07 mind-map-mvp/milestones/04-persistence.md` |
| **PR title**   | `docs(roadmap): mark persistence architecture refactor complete`                |

Mark this plan `done`, tick the task list, and note any lessons
learned in the milestone's References / follow-up section. Milestone
04 stays `complete` (feature shipped earlier); we just keep its plan
links accurate.

**Acceptance**

- Plan status is `done`; every task line has `✓`.
- Milestone 04 doc lists both the original plan and this follow-up.
- Roadmap row 04 still links the milestone; no row reshuffle needed
  because this is an architectural follow-up, not a new milestone.

## Wave plan

```
Wave 1   T01  ‖  T02         (T01: new helpers + tiny page edit;
                              T02: new controller module + spec.
                              They touch disjoint files.)
Wave 2   T03                 (page rewrite; depends on T01 and T02)
Wave 3   T04                 (Storybook harness; depends on T03's
                              adapter API being stable)
Wave 4   T05                 (docs closeout)
```

Total: 5 tasks, max parallelism in wave 1. Wave 2 onwards is
sequential because T03/T04/T05 each touch artifacts the previous wave
produced.

A simple invariant to check before kicking off a wave: every task in
the wave has all its `Depends on` items already merged to `main`.

## Risks and rollback

- **T02 controller API ends up wrong once T03 wires it up.** Most
  likely failure mode: `selectGraph`/`deleteGraph` need to await
  navigation differently than the spec assumed. Mitigation: T02's
  spec covers _behavior contracts_ (flush before navigate, only
  navigate when target id differs) rather than internal call order;
  T03 may add one revision PR to the controller if needed. If the
  controller's surface ends up materially different from the one
  proposed above, update T02's PR description and rerun T03 against
  the new shape — do not let the plan diverge from reality.
- **Behavior regression hidden in the page rewrite.** Mitigation: the
  full Playwright suite (3 tests) is the regression guard. Run it
  before and after T03. The toolbar contract is unchanged, so
  Storybook coverage from milestone 04 stays green by construction.
- **Status text drift.** `loadGraph` currently emits "Loaded …" /
  "Reloaded …" strings the original plan never asserted in e2e. After
  T02, those strings come from `statusToNotice`. Mitigation: pin the
  exact strings in `statusToNotice` specs so future edits are
  intentional.
- **Adapter `$effect` cleanup leaks.** Mitigation: T03's adapter
  returns the controller's `dispose` via `$effect(() => dispose)`;
  add a smoke story in T04 that mounts and unmounts the harness to
  prove no listeners leak between scenarios.
- **Storage event subscription stays in the page.** This is
  intentional (controller stays DOM-free), but if a future agent
  forgets to forward `storage` events the controller becomes silent.
  Mitigation: T04 includes a story that fires a synthetic storage
  event through the harness and asserts the controller reloads — same
  bug catches in CI.

## Definition of Done (this plan)

The plan is done when:

- All 5 tasks are merged to `main`.
- `pnpm --filter mind-map-sv lint`, `pnpm --filter mind-map-sv check`,
  `pnpm --filter mind-map-sv test:unit -- --run`, and
  `pnpm --filter mind-map-sv test:e2e` all pass on the final branch.
- `+page.svelte` is back under ~60 lines and contains no
  `loadGraph` / `handleSaveStatus` / `refreshGraphList` /
  `flushPendingSave` / `graphSearch` definitions.
- The controller has full Node-side spec coverage; the adapter is
  the only Svelte-aware file in the persistence stack.
- Plan status is `done`. Milestone 04 stays `complete` and links both
  this plan and the original persistence plan.
- The finished work has been committed unless the user explicitly
  asked not to commit yet.

## Notes

Free-form scratchpad for things that come up during execution.

- 2026-05-17: The current page mixes `selectedGraphId` (from URL) and
  `loadedGraphId` (from state) with a `$effect` that calls
  `loadGraph` when they diverge. The controller can keep both, but a
  cleaner model is: URL→`load(graphId)` is the only entry point, and
  the controller's internal `loadedGraphId` is just bookkeeping for
  storage-event filtering. T02 should pick whichever is easier to
  spec; revisit in T03 review if the page still needs both.
- 2026-05-17: `createGraphPersistenceStack` factory was considered
  and rejected for now (see Open questions resolved). If the page
  feels heavy after T03 lands, re-open this as a follow-up XS task.
- 2026-05-17: The `flush` in `selectGraph` / `deleteGraph` currently
  swallows errors so navigation isn't blocked. Preserve this contract
  in the controller — add a spec proving `selectGraph` resolves even
  when `scheduler.flush` rejects.
