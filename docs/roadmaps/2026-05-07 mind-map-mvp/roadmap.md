# Roadmap: MindMap MVP

**Started:** 2026-05-07
**Status:** Active

## North star

A low-friction mind-map / knowledge web that can be used live during a
conversation by one or more people. Critically: the graph remains
_usable_ even when very large, by **pinning** nodes of interest at full
size while their neighbors scale down with hop distance. Users can pan,
zoom, drag, add nodes/edges, and have the layout self-tidy via gentle
overlap repulsion. Mobile-first input.

## Design principles

1. **Pure logic first.** Behavior lives in `lib/*.ts` modules with
   colocated specs. Components are thin shells around them.
2. **One gesture vocabulary across desktop and mobile.** Pointer Events
   only; the same handler works for mouse, touch, and pen.
3. **Tests describe behavior, not implementation.** Storybook story
   names read like sentences ("User pins a node and neighbors scale
   down"). Unit specs cover pure functions exhaustively.
4. **Local-first, then server.** Persistence starts with `localStorage`
   behind an interface; swapping to Postgres/Yjs later is a backend
   change, not a UI change.

## Milestones (medium granularity)

Six milestones, each landing as a small set of PRs. Each has a milestone
doc describing scope, acceptance criteria, and risks. When work on a
milestone is about to start, we write a dated **plan** in `plans/` that
breaks it into individual PR-sized tasks.

| #   | Milestone                                          | Status      | Doc                                                                                                                |
| --- | -------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| 01  | Graph mutations and pinning                        | complete    | [milestone](milestones/01-graph-mutations-and-pinning.md), [plan](plans/2026-05-15 graph-mutations-and-pinning.md) |
| 02  | Layout: hop-distance scaling and overlap repulsion | complete    | [milestone](milestones/02-layout-and-repulsion.md), [plan](plans/2026-05-15 layout-and-repulsion.md)               |
| 03  | Mobile polish and node editing UX                  | not started | [milestones/03-mobile-polish-and-editing.md](milestones/03-mobile-polish-and-editing.md)                           |
| 04  | Persistence (local-first → server)                 | not started | [milestones/04-persistence.md](milestones/04-persistence.md)                                                       |
| 05  | Multiplayer                                        | not started | [milestones/05-multiplayer.md](milestones/05-multiplayer.md)                                                       |
| 06  | Search                                             | not started | [milestones/06-search.md](milestones/06-search.md)                                                                 |

## How this directory is organized

```
docs/roadmaps/2026-05-07 mind-map-mvp/
  roadmap.md                              ← this file (big picture)
  milestones/
    01-<name>.md                          ← scope + acceptance criteria per milestone
    02-<name>.md
    ...
  plans/
    YYYY-MM-DD <name>.md                  ← dated plan for executing one milestone
```

A **milestone** says "what" and "done means". A **plan** says "how" and
"in what order, in which PRs". Plans are dated and may be replaced if
we change approach mid-stream — old plans stay as historical record.

## Out of scope (for now)

- Authentication and accounts (deferred; blocks Multiplayer #5).
- Rich text / markdown / images in node descriptions (post-MVP).
- Versioning / undo-redo UI (the immutable-update pattern enables it; a
  UI for it can come later).
- AI-generated nodes / auto-suggest edges (interesting future direction;
  no MVP commitment).

## Pre-roadmap foundations (already done before milestone 01)

- Cursor rules and `AGENTS.md` for AI-assisted development.
- `.gitignore` cleanup (no more `.svelte-kit/` noise in diffs).
- PR template with Definition of Done.
- `testFixtures.ts` builder for graph test data.
- Existing infrastructure (Turborepo, SvelteKit, Vitest 3-project setup,
  Storybook with `play` test integration, Playwright e2e, Chromatic).

## Source notes

The original brainstorm that became this roadmap is preserved in the
`# TODO:` section of the project README at the time this roadmap was
created — see commit history.
