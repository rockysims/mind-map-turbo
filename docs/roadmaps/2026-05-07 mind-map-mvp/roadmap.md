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

| #   | Milestone                                          | Status      | Doc                                                                                                                                                   |
| --- | -------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01  | Graph mutations and pinning                        | complete    | [milestone](milestones/01-graph-mutations-and-pinning.md), [plan](plans/2026-05-15 01-graph-mutations-and-pinning.md)                                 |
| 02  | Layout: hop-distance scaling and overlap repulsion | complete    | [milestone](milestones/02-layout-and-repulsion.md), [plan](plans/2026-05-15 02-layout-and-repulsion.md)                                               |
| 03  | Mobile polish and node editing UX                  | in progress | [milestone](milestones/03-mobile-polish-and-editing.md), [plan](plans/2026-05-17%2003-mobile-polish-and-editing.md)                                   |
| 04  | Persistence (local-first → server)                 | complete    | [milestone](milestones/04-persistence.md), [plan](plans/2026-05-17%2004-persistence.md)                                                               |
| 04a | Layered pin relayout                               | complete    | [milestone](milestones/04a-layered-pin-relayout.md), [plan](plans/2026-05-25%2004a-layered-pin-relayout.md)                                           |
| 04b | Bounded pinned-neighborhood visibility             | complete    | [milestone](milestones/04b-bounded-pinned-neighborhood-visibility.md), [plan](plans/2026-05-30%2004b-bounded-pinned-neighborhood-visibility.md)       |
| 04c | JSON file import/export                            | complete    | [milestone](milestones/04c-json-file-import-export.md), [plan](plans/2026-05-30%2004c-json-file-import-export.md)                                     |
| 04d | Edge toggle and inline node creation               | complete    | [milestone](milestones/04d-edge-toggle-and-inline-node-creation.md), [plan](plans/2026-06-12%2004d-edge-toggle-and-inline-node-creation.md)           |
| 04e | Title syntax for direction and tags                | complete    | [milestone](milestones/04e-title-syntax-for-direction-and-tags.md), [plan](plans/2026-06-12%2004e-title-syntax-for-direction-and-tags.md)             |
| 04f | Tag colors and graph tag config                    | complete    | [milestone](milestones/04f-tag-colors-and-graph-tag-config.md), [plan](plans/2026-06-12%2004f-node-and-edge-tag-colors.md)                            |
| 04g | Layout settle: eliminate endless drift/rotation    | complete    | [milestone](milestones/04g-layout-settle-eliminate-drift.md), [plan](plans/2026-06-13%2004g-layout-settle-rigid-motion.md)                            |
| 04h | Thin the Multigraph component (refactor)           | complete    | [milestone](milestones/04h-multigraph-thin-component-refactor.md), [plan](plans/2026-06-13%2004h-multigraph-thin-component-refactor.md)               |
| 04i | Eliminate appearance/disappearance abruptness      | complete    | [milestone](milestones/04i-eliminate-appearance-abruptness.md), [plan](plans/2026-06-13%2004i-enter-exit-and-reveal-wave.md)                          |
| 04j | Edge occlusion fade near unrelated nodes           | complete    | [milestone](milestones/04j-edge-occlusion-fade.md), [plan](plans/2026-06-13%2004j-edge-occlusion-fade.md)                                             |
| 04k | Parallel edge visualization                        | complete    | [milestone](milestones/04k-parallel-edge-visualization.md), [plan](plans/2026-06-18%2004k-parallel-edge-visualization.md)                             |
| 04l | Self-contained HTML save files                     | complete    | [milestone](milestones/04l-self-contained-html-save-files.md), [plan](plans/2026-06-21%2004l-self-contained-html-save-files.md)                       |
| 04m | Single-document save UX                            | complete    | [milestone](milestones/04m-single-document-save-ux.md), [plan](plans/2026-06-21%2004m-single-document-save-ux.md)                                     |
| 04n | Reliable propagated HTML app shell                 | complete    | [milestone](milestones/04n-reliable-propagated-html-app-shell.md), [plan](plans/2026-07-04%2004n-reliable-propagated-html-app-shell.md)               |
| 05  | Filter / find / search                             | complete    | [milestone](milestones/05-filter-find-search.md), [plan](plans/2026-06-22%2005-filter-find-search.md)                                                 |
| 06  | Node focus and rich media                          | complete    | [milestone](milestones/06-node-focus-and-rich-media.md), [plan](plans/2026-07-04%2006-node-focus-and-rich-media.md)                                   |
| 06a | Continuous deep zoom                               | complete    | [milestone](milestones/06a-continuous-deep-zoom.md), [plan](plans/2026-07-04%2006a-continuous-deep-zoom.md)                                           |
| 06b | Recursive deep zoom (single-element morph)         | complete    | [milestone](milestones/06b-recursive-deep-zoom.md), [plan](plans/2026-07-10%2006b-recursive-deep-zoom.md)                                             |
| 06c | Single-surface morph (one frame element)           | complete    | [milestone](milestones/06c-single-surface-morph.md), [plan](plans/2026-07-10%2006c-single-surface-morph.md)                                           |
| 06d | Deep zoom hardening and nested image zoom          | complete    | [milestone](milestones/06d-deep-zoom-hardening-and-nested-image-zoom.md), [plan](plans/2026-07-11%2006d-deep-zoom-hardening-and-nested-image-zoom.md) |
| 07  | Multiplayer                                        | not started | [milestones/07-multiplayer.md](milestones/07-multiplayer.md)                                                                                          |
| 08  | LaTeX math in node descriptions                    | complete    | [milestone](milestones/08-latex-math-in-node-descriptions.md), [plan](plans/2026-08-27%2008-latex-math-in-node-descriptions.md)                       |
| 09  | Variable dataflow layer                            | complete    | [milestone](milestones/09-variable-dataflow-layer.md), [plan](plans/2026-08-27%2009-variable-dataflow-layer.md)                                       |
| 10  | LaTeX math in node titles                          | complete    | [milestone](milestones/10-latex-math-in-node-titles.md), [plan](plans/2026-08-27%2010-latex-math-in-node-titles.md)                                   |
| 11  | Unified hop model for derived edges                | complete    | [milestone](milestones/11-unified-hop-model-for-derived-edges.md), [plan](plans/2026-08-28%2011-unified-hop-model-for-derived-edges.md)               |
| 12  | Undo and redo                                      | proposed    | [milestone](milestones/12-undo-and-redo.md), [plan](plans/2026-08-30%2012-undo-and-redo.md)                                                           |
| 13  | Node add-ons and file attachments                  | proposed    | [milestone](milestones/13-node-addons-and-file-attachments.md), [plan](plans/2026-09-04%2013-node-addons-and-file-attachments.md)                     |
| 14  | AI nodes                                           | proposed    | [milestone](milestones/14-ai-nodes.md), [plan](plans/2026-09-04%2014-ai-nodes.md)                                                                     |

Milestones 04a-04m deepen the local-first graph experience before multiplayer.
Milestone 04b intentionally supersedes 04a's Fibonacci reveal and dimming
behavior. Milestone 04h is a behavior-preserving refactor, not new product
scope. Milestone 04i adds enter/exit and pin reveal-wave animation as pure
modules so 04h can absorb the wiring; if 04h lands first, 04i targets the
post-split files. Milestone 04j adds edge-local fade windows for visual
underpasses without changing graph connectivity or layout routing. Milestone
04k makes parallel edges visible with render offsets while deferring UI creation
of duplicate edges. Milestone 04l evolves explicit graph files from JSON
backups into self-contained offline HTML documents. Milestone 04m streamlines
that file model into a single-document toolbar with Download and draft-vs-file
status instead of graph-library controls. Milestone 04n hardens the propagated
HTML shell so descendant downloads carry app code forward without serializing
hydrated runtime UI.
Milestone 05 intentionally lands before milestone 06 so local filter/find
semantics, visual query states, and camera navigation are settled before the
zoom-through node focus mode reuses camera geometry. Milestone 06 adds a
transient zoom-through node focus mode and offline image attachments carried
inside self-contained HTML save files. Milestone 06a reworks the deep-zoom
gestures into one continuous nested-zoom model: the real node morphs in place
(border radius as bold-zoom feedback), the focus dialog is the node component
in a details mode, and dialog/image zoom are nested gated levels of the same
interaction. Milestone 06b supersedes 06a's transition mechanism: instead of
crossfading to a viewport-centered replica node, the real element genuinely
morphs into the fullscreen surface via a single 0→1 geometry function, on a
depth-agnostic focus stack so deep zoom nests to any number of levels; the node
level lands first and images/other blocks follow as consumers of the same
primitives. Milestone 06c finishes 06b's single-element intent: one morph
surface owns the frame for the entire deep-zoom round trip (driven by a pure
frame-geometry function with a derived, never-measured source rect), content
crossfades inside it as fixed-layout transform-scaled layers, and the
recursive stack becomes the production focus path. Milestone 06d hardens that
mechanic — removing 06a/06b/06c scaffolding, unifying the split focus ownership
into one `FocusController` with a single input surface — and then proves the
recursive stack for real by making images inside a focused node their own nested
zoom level (the first production consumer at depth 2). Milestone 07 follows with
multiplayer after rich local document behavior is settled.
Milestones 08-10 add mathematical notation and the quantity dataflow it makes
possible, as an escalator where each step ships on its own. Milestone 08 renders
LaTeX in node descriptions as MathML, chosen over a font-shipping renderer so the
propagated offline shell stays small. Milestone 09 reads that rendered MathML to
infer which node defines a quantity and which nodes use it, then draws the
resulting producer-to-consumer arrows as derived edges that are computed rather
than stored; there is no new authoring syntax, so writing the equation is the
whole interaction. Milestone 10 finishes the notation story by typesetting titles
too, so a node about a quantity can be titled with it rather than describing it
in prose. Milestone 11 reworks how milestone 09's derived edges meet the hop
system: a 2026-08-28 review traced the recurring dataflow sizing/visibility
bugs to four parallel hop computations patched into agreement, and replaces
them with one bounded computation where a derived edge differs from an
authored one in exactly one way — its own visibility budget
(`dataflowDisplayedLayers`, default 1). It supersedes milestone 09's
`dataflowInLayout` toggle.

Making that dataflow structure traversable — tracing a quantity across the graph,
walking upstream and downstream, jumping to a definition — was planned as a
milestone and cut on 2026-08-27: seeing the structure turned out to be the
valuable part, and the navigation on top of it was not worth its cost. The
dropped milestone and its plan are recoverable from git history if that judgement
changes.

Numeric evaluation and units stay out of scope throughout; these milestones
visualize structure, not results.

Milestones 13 and 14 bring outside data and an analysis engine into the map.
Milestone 13 adds a third title marker, `!`, that gives a node a capability
from a closed registry (first `!task`, a done checkbox), and lets a node attach
files of any type with the same offline and portable guarantees images have.
Milestone 14 builds the `!ai` add-on on both: a node with a saved prompt that
runs Claude against the files and text on its neighbours in a server-side
sandbox, keeps the summary, the script that produced the outputs and the
outputs themselves, and can promote an output to its own node that refreshes
on re-run. Its first job is turning bench measurements into readable plots.
The API is called from the browser with the user's own key, so nothing has to
be deployed to try it; a proxy comes with the login server.

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

- Authentication and accounts (deferred; blocks Multiplayer #7).
- Rich text / markdown in node descriptions (post-MVP). Image attachments are
  tracked separately in milestone 06, and LaTeX math in milestone 08; neither
  opens the door to general markdown.
- Versioning / undo-redo UI (the immutable-update pattern enables it; a
  UI for it can come later).
- AI-generated graph structure (scraping a site into nodes, suggesting
  edges, growing a map from notes). Milestone 14 deliberately limits AI to
  analysis inside one node; letting it write the map is a later conversation.

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
