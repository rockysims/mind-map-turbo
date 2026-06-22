# Roadmap: MindMap MVP

**Started:** 2026-05-07
**Status:** Active

## North star

A low-friction mind-map / knowledge web that can be used live during a
conversation by one or more people. Critically: the graph remains
_usable_ even when very large, by **pinning** nodes of interest at full
size while showing only the useful neighborhood around those pins. Users
can pan, zoom, drag, add nodes/edges, label and tag nodes quickly, save
their work locally or as portable files, and have the layout self-tidy via
gentle overlap repulsion. Mobile-first input.

## Design principles

1. **Pure logic first.** Behavior lives in `lib/*.ts` modules with
   colocated specs. Components are thin shells around them.
2. **One gesture vocabulary across desktop and mobile.** Pointer Events
   only; the same handler works for mouse, touch, and pen.
3. **Tests describe behavior, not implementation.** Storybook story
   names read like sentences ("User pins a node and the visible
   neighborhood stays readable"). Unit specs cover pure functions
   exhaustively.
4. **Local-first, then server.** Persistence starts with `localStorage`
   behind an interface and JSON import/export for user-controlled files;
   swapping to Postgres/Yjs later is a backend change, not a UI change.

## Milestones (medium granularity)

Milestones land as small sets of PRs. Each has a milestone doc describing
scope, acceptance criteria, and risks. When work on a milestone is about
to start, we write a dated **plan** in `plans/` that breaks it into
individual PR-sized tasks.

| #   | Milestone                                          | Status      | Doc                                                                                                                                             |
| --- | -------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 01  | Graph mutations and pinning                        | complete    | [milestone](milestones/01-graph-mutations-and-pinning.md), [plan](plans/2026-05-15 01-graph-mutations-and-pinning.md)                           |
| 02  | Layout: hop-distance scaling and overlap repulsion | complete    | [milestone](milestones/02-layout-and-repulsion.md), [plan](plans/2026-05-15 02-layout-and-repulsion.md)                                         |
| 03  | Mobile polish and node editing UX                  | in progress | [milestone](milestones/03-mobile-polish-and-editing.md), [plan](plans/2026-05-17%2003-mobile-polish-and-editing.md)                             |
| 04  | Persistence (local-first → server)                 | complete    | [milestone](milestones/04-persistence.md), [plan](plans/2026-05-17%2004-persistence.md)                                                         |
| 04a | Layered pin relayout                               | complete    | [milestone](milestones/04a-layered-pin-relayout.md), [plan](plans/2026-05-25%2004a-layered-pin-relayout.md)                                     |
| 04b | Bounded pinned-neighborhood visibility             | complete    | [milestone](milestones/04b-bounded-pinned-neighborhood-visibility.md), [plan](plans/2026-05-30%2004b-bounded-pinned-neighborhood-visibility.md) |
| 04c | JSON file import/export                            | complete    | [milestone](milestones/04c-json-file-import-export.md), [plan](plans/2026-05-30%2004c-json-file-import-export.md)                               |
| 04d | Edge toggle and inline node creation               | complete    | [milestone](milestones/04d-edge-toggle-and-inline-node-creation.md), [plan](plans/2026-06-12%2004d-edge-toggle-and-inline-node-creation.md)     |
| 04e | Title syntax for direction and tags                | complete    | [milestone](milestones/04e-title-syntax-for-direction-and-tags.md), [plan](plans/2026-06-12%2004e-title-syntax-for-direction-and-tags.md)       |
| 04f | Tag colors and graph tag config                    | complete    | [milestone](milestones/04f-tag-colors-and-graph-tag-config.md), [plan](plans/2026-06-12%2004f-node-and-edge-tag-colors.md)                      |
| 04g | Layout settle: eliminate endless drift/rotation    | complete    | [milestone](milestones/04g-layout-settle-eliminate-drift.md), [plan](plans/2026-06-13%2004g-layout-settle-rigid-motion.md)                      |
| 04h | Thin the Multigraph component (refactor)           | complete    | [milestone](milestones/04h-multigraph-thin-component-refactor.md), [plan](plans/2026-06-13%2004h-multigraph-thin-component-refactor.md)         |
| 04i | Eliminate appearance/disappearance abruptness      | complete    | [milestone](milestones/04i-eliminate-appearance-abruptness.md), [plan](plans/2026-06-13%2004i-enter-exit-and-reveal-wave.md)                    |
| 04j | Edge occlusion fade near unrelated nodes           | complete    | [milestone](milestones/04j-edge-occlusion-fade.md), [plan](plans/2026-06-13%2004j-edge-occlusion-fade.md)                                       |
| 04k | Parallel edge visualization                        | complete    | [milestone](milestones/04k-parallel-edge-visualization.md), [plan](plans/2026-06-18%2004k-parallel-edge-visualization.md)                       |
| 04l | Self-contained HTML save files                     | complete    | [milestone](milestones/04l-self-contained-html-save-files.md), [plan](plans/2026-06-21%2004l-self-contained-html-save-files.md)                 |
| 04m | Single-document save UX                            | complete    | [milestone](milestones/04m-single-document-save-ux.md), [plan](plans/2026-06-21%2004m-single-document-save-ux.md)                               |
| 05  | Multiplayer                                        | not started | [milestones/05-multiplayer.md](milestones/05-multiplayer.md)                                                                                    |
| 06  | Search                                             | not started | [milestones/06-search.md](milestones/06-search.md)                                                                                              |

Milestones 04a-04l sit between persistence and multiplayer. Milestone 04b
intentionally supersedes 04a's Fibonacci reveal and dimming behavior. Milestone
04h is a behavior-preserving refactor, not new product scope. Milestone 04i adds
enter/exit and pin reveal-wave animation as pure modules so 04h can absorb the
wiring; if 04h lands first, 04i targets the post-split files. Milestone 04j adds
edge-local fade windows for visual underpasses without changing graph
connectivity or layout routing. Milestone 04k makes parallel edges visible with
render offsets while deferring UI creation of duplicate edges. Milestone 04l
evolves explicit graph files from JSON backups into self-contained offline HTML
documents. Milestone 04m streamlines that file model into a single-document
toolbar with Download and draft-vs-file status instead of graph-library controls.

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
