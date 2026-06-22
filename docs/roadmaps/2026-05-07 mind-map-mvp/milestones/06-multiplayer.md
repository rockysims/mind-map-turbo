# Milestone 06: Multiplayer

**Status:** not started
**Depends on:** milestones 01 (mutations), 04 (persistence interface),
and 05 (local filter/find semantics).
**Plan:** _none yet._

## Goal

Two or more people can edit the same mind-map at the same time, in real
time, without stomping each other's edits. Conflicts resolve
automatically; users see each other's cursors / selections.

## Scope

### Approach: Yjs + WebSocket relay

A graph is a near-perfect fit for CRDTs. Use **Yjs** with `Y.Map` for
`posByNodeId` and node/edge collections. The "server" is just a thin
WebSocket relay (e.g. `y-websocket`) plus periodic snapshots to
Postgres for durability.

- New `lib/multiplayer/yjsAdapter.ts`:
  - Two-way binding between `MultigraphData` and a Yjs document.
  - Immutable mutations from milestone 01 still work — they just
    replay through the Yjs document on apply.
- Presence:
  - Each user has a colored cursor / pointer indicator drawn at their
    last known stage coordinates.
  - "Someone is editing this node" indicator on the node being typed
    in via the edit sheet.
- Server:
  - SvelteKit endpoint or separate Node service running `y-websocket`.
  - Snapshot to Postgres every N edits or every M seconds.
  - On connect: client joins room (graphId), receives snapshot +
    in-flight ops.

### Auth (lightweight)

- Anonymous sessions to start. A user picks a display name and color;
  stored in `localStorage`. No login required for MVP multiplayer.
- Rooms protected by an unguessable graph id (URL contains it). Real
  auth comes in a follow-up milestone.

## Acceptance criteria

- Two browser tabs editing the same graph see each other's edits within
  ~200 ms over localhost.
- Concurrent moves of the same node converge (Yjs handles this; verify
  with a story / e2e that races two writes).
- Closing one tab doesn't lose unsynced edits in the other (snapshot
  test: bring tab A offline, edit, bring it online; edits apply).
- Presence cursors render and don't fight stage gestures.
- Persistence (milestone 04) still works: opening a graph with no
  active peers loads the latest snapshot from Postgres.
- New unit specs for `yjsAdapter` covering the round-trip
  `MultigraphData ↔ Yjs document`.
- New e2e Playwright test driving two browser contexts.

## Non-goals

- **Permissions / roles** (read-only viewers, etc.). Everyone with the
  link is a writer.
- **Operational transform** (we use CRDT instead — strictly easier).
- **Per-character live cursor** inside the description text. Just a
  "user X is editing this node" indicator is enough.
- **Conflict UI.** CRDTs auto-resolve; no manual conflict resolution
  needed.

## Risks and open questions

- **Yjs bundle size.** ~30 KB gzipped — acceptable.
- **Hosting the WebSocket relay.** Self-host alongside the SvelteKit
  app, or use a managed service (e.g. PartyKit, Liveblocks)? Cost vs.
  ops trade-off — decide in the plan.
- **Yjs over `Map<string, Point>`.** `Y.Map` doesn't preserve insertion
  order semantics our code might assume. Confirm in the plan.
- **Migrations.** Yjs documents have their own internal version; pair
  with the milestone-04 schema-version envelope on snapshots.

## References

- [Yjs](https://yjs.dev/), [y-websocket](https://github.com/yjs/y-websocket).
- Persistence interface from milestone 04 wraps Yjs snapshotting.
