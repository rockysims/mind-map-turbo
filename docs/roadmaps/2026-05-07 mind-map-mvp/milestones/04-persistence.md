# Milestone 04: Persistence

**Status:** complete
**Depends on:** milestone 01 (canonical mutation API to persist
against).
**Plans:**

- [2026-05-17 04-persistence.md](../plans/2026-05-17%2004-persistence.md) — original delivery (status: done).
- [2026-05-17 04-persistence-architecture.md](../plans/2026-05-17%2004-persistence-architecture.md) — follow-up
  architectural refactor extracting the controller from `+page.svelte` (status: executing).

## Goal

Stop losing the mind-map when the tab closes. Start with `localStorage`
behind a small `Persistence` interface; later swap the implementation
for a SvelteKit API + Postgres without touching any UI code.

## Scope

### Persistence interface

- New `lib/persistence.ts`:

  ```ts
  export interface Persistence {
    load(id: string): Promise<MultigraphData | null>;
    save(id: string, data: MultigraphData): Promise<void>;
    list(): Promise<{ id: string; updatedAt: number }[]>;
    delete(id: string): Promise<void>;
  }
  ```

- Two implementations behind a factory:
  - `LocalStoragePersistence` — JSON in `localStorage` under a
    namespaced key. Default for the MVP.
  - `ServerPersistence` — `fetch` against SvelteKit endpoints. Stub for
    now; full backend in a later milestone.
- App-level `+page.server.ts` (or a `+layout.server.ts`) chooses
  implementation via env, defaulting to local.

### Wiring

- Page mounts with a `graphId` (URL param or default). Loads on mount,
  saves on every state change with **debounced** flush (~500 ms).
- Save errors surface through a small non-blocking notice.
- A small toolbar control to "New graph" / "Load graph" / "Delete" that
  uses `list()` and `delete()`.

### Schema versioning

- Store the data with a `schemaVersion: 1` envelope:

  ```json
  { "schemaVersion": 1, "data": { "nodes": [...], "edges": [...], ... } }
  ```

- A `lib/migrations.ts` with a version-by-version migrator. Empty for
  now (only one version); the structure is what matters.

## Acceptance criteria

- `persistence.spec.ts` covers `LocalStoragePersistence` round-trip,
  list ordering by `updatedAt`, delete + reload returns null.
- New unit spec for the debounce + save scheduler.
- New e2e (Playwright) test:
  - User adds a node, reloads the page, the node is still there.
  - User creates a second graph, switches between them, both persist.
- Schema-version envelope present in stored payloads.
- Storybook stories don't depend on `localStorage` (use an in-memory
  test impl injected via prop / context).

## Non-goals

- **Server backend implementation.** `ServerPersistence` is a stub /
  thin fetch wrapper; the actual Postgres + SvelteKit API endpoints
  ship in a separate milestone with multiplayer (`05`) — they share
  infrastructure.
- **Authentication / accounts.** Until 05, "user" = a browser. Graphs
  live by id in the chosen backend.
- **Conflict resolution.** Single-writer assumption. Multi-writer is
  milestone 05.

## Risks and open questions

- **Save granularity.** Save the entire `MultigraphData` blob, or
  per-mutation deltas? For local-first → MVP, blob is fine. Deltas
  matter for multiplayer (already a milestone 05 concern; Yjs handles
  them transparently).
- **localStorage quotas.** Roughly 5–10 MB. A graph with thousands of
  nodes + descriptions could hit this. Acceptable for MVP — surface a
  warning when >80% used.
- **Tab sync.** Two tabs open on the same graph will clobber each
  other. Cheap mitigation: listen for the `storage` event and reload.
  Real fix is multiplayer.

## References

- `.cursor/rules/core.mdc` (where pure modules live).
- Eventual server choice: Postgres + Drizzle (simple, type-safe, easy
  to deploy via Docker — Dockerfile already exists in
  `apps/mind-map-sv/`).
