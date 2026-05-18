# Plan: Mobile polish and node editing

**Created:** 2026-05-17
**Author:** Cursor agent
**Milestone:** [milestones/03-mobile-polish-and-editing.md](../milestones/03-mobile-polish-and-editing.md)
**Status:** draft
**Total estimated effort:** L

## Summary

This plan adds phone-friendly node inspection, editing, long-press actions, and
larger effective tap targets on top of the milestone 02 graph layout. It keeps
gesture recognition and graph mutations in pure modules first, then wires the
Stage, Multigraph, and Storybook harnesses through those contracts.

## Open questions resolved

- **Long-press vs accidental drag.** **Cancel long-press when pointer movement
  exceeds `LONG_PRESS_DIST`.** This matches the existing drag-threshold mental
  model and keeps a held drag from also opening a menu.
- **Sheet interaction with stage gestures.** **Use an overlaying dialog/sheet
  that owns pointer events while open; do not add a Stage `disabled` prop yet.**
  The sheet sits above the Stage, which keeps gesture code focused on graph
  interactions and avoids adding a broad Stage mode before it is needed.
- **Two-finger pinch starting on a node.** **Pinch takes precedence over node
  drag and long-press.** Stage already cancels pan when two pointers are active;
  this plan extends the same cancellation to long-press timers and active node
  drags.
- **Desktop vs mobile editing surface.** **Ship one responsive sheet component:
  centered modal sizing on desktop, bottom sheet sizing on mobile.** A single
  state boundary keeps the story surface small while preserving the mobile-first
  interaction.

## Out of scope (for this plan)

- Real persistence; editing updates in-memory `MultigraphData` only.
- Rich text, markdown, links, or image attachments in descriptions.
- Keyboard shortcuts beyond Esc-to-close.
- Full focus-trap and keyboard navigation polish beyond the minimum needed for
  accessible labels, focus return, and close controls.
- Undo/redo for edits or deletes.

## Tasks

> Each task is one PR's worth of work. If a task feels like more than one
> logical commit, split it. The PR title is drafted up front so reviewers and
> implementing agents start aligned.

### T01 - Add node content mutation

|                |                                                         |
| -------------- | ------------------------------------------------------- |
| **Depends on** | -                                                       |
| **Wave**       | 1                                                       |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`) |
| **Effort**     | S                                                       |
| **Files**      | `lib/graph.ts`, `lib/graph.spec.ts`, `lib/index.ts`     |
| **PR title**   | `feat(graph): add node content updates`                 |

Add an immutable graph mutation for updating a node's title and description.
Keep the API narrow enough for the edit sheet but general enough for future
persistence to call the same function.

**Acceptance**

- Updating title and description returns a new `MultigraphData` object and new
  node array without mutating the original graph.
- Unknown node ids are no-ops that return the original graph.
- Existing graph mutation specs still pass.
- Empty titles are normalized by the UI task, not by the graph helper.

### T02 - Add long-press recognition to Stage

|                |                                                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | -                                                                                                                                  |
| **Wave**       | 1                                                                                                                                  |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)                                                                            |
| **Effort**     | M                                                                                                                                  |
| **Files**      | `constants.ts`, new `lib/longPress.ts`, new `lib/longPress.spec.ts`, `Stage.svelte`, `StageHarness.svelte`, `Stage.stories.svelte` |
| **PR title**   | `feat(stage): recognize node long press`                                                                                           |

Add `LONG_PRESS_MS`, `LONG_PRESS_DIST`, and `recognizeLongPress({ duration,
distance })`. Wire Stage to report a node long-press without breaking existing
single-click, double-click, drag, pan, or pinch paths.

**Acceptance**

- Unit specs cover duration below/at/above threshold and movement below/above
  threshold.
- Long-press fires once after the threshold when the pointer remains on the
  same node.
- Moving beyond `LONG_PRESS_DIST`, starting a drag, leaving the node, pointer
  cancel, or a second active pointer cancels the long-press.
- Existing Stage stories for click, double-click, drag, pan, wheel zoom, and
  pinch still pass.

### T03 - Add minimum effective hit radius

|                |                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | -                                                                                                                                |
| **Wave**       | 1                                                                                                                                |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)                                                                          |
| **Effort**     | M                                                                                                                                |
| **Files**      | `constants.ts`, `lib/hitTest.ts`, `lib/hitTest.spec.ts`, `Multigraph.svelte`, `StageHarness.svelte`, `Multigraph.stories.svelte` |
| **PR title**   | `feat(multigraph): expand tiny node hit targets`                                                                                 |

Add `MIN_NODE_HIT_RADIUS` and `effectiveHitRadius(visualRadius,
minHitRadius)`. Use the helper anywhere a rendered node is hit-tested so
scaled-down nodes remain reachable on mobile.

**Acceptance**

- Unit specs cover visual radius below, equal to, and above the minimum.
- Multigraph and StageHarness use the same effective radius logic.
- A story taps a distant scaled node whose visual radius is below the minimum
  and observes the expected node interaction.
- Edge hit behavior is unchanged because edge SVGs remain pointer-events none.

### T04 - Add node contextual menu

|                |                                                                                   |
| -------------- | --------------------------------------------------------------------------------- |
| **Depends on** | T02, T03                                                                          |
| **Wave**       | 2                                                                                 |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)                           |
| **Effort**     | M                                                                                 |
| **Files**      | `Multigraph.svelte`, `Multigraph.stories.svelte`, new menu component if warranted |
| **PR title**   | `feat(multigraph): show node action menu on long press`                           |

Show a small floating menu for Pin/Unpin, Edit, and Delete after long-press.
Route Pin/Unpin and Delete through existing graph mutations and keep Edit as
the state transition that opens the sheet added in T05.

**Acceptance**

- Long-pressing a node opens a menu positioned near that node without panning
  the Stage.
- Menu actions call `togglePinned` and `removeNode` and update the rendered
  graph.
- The menu closes after action, Escape, outside click/tap, or pointer cancel.
- A story asserts the Pin / Edit / Delete actions are visible after long-press.

### T05 - Add responsive edit sheet

|                |                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| **Depends on** | T01, T04                                                                                               |
| **Wave**       | 3                                                                                                      |
| **Agent**      | high-reasoning (`claude-opus-4-7-thinking-xhigh` or `gpt-5.3-codex`)                                   |
| **Effort**     | L                                                                                                      |
| **Files**      | `Multigraph.svelte`, `Multigraph.stories.svelte`, optional `NodeEditSheet.svelte`, optional story file |
| **PR title**   | `feat(multigraph): edit node content in a sheet`                                                       |

Open a responsive sheet from single tap/click or the contextual menu. The sheet
shows title and description fields, Pin/Unpin, Save, Cancel, and Delete. Save
commits through the graph mutation from T01; Cancel restores the previous
values.

**Acceptance**

- Single tap/click on a node opens the sheet with current title and
  description.
- Editing the title and saving updates the rendered node title.
- Cancel closes the sheet without changing graph data.
- Pin/Unpin and Delete in the sheet use graph mutations and match the menu
  behavior.
- The sheet is bottom-aligned on mobile widths, modal-sized on desktop widths,
  and respects `prefers-reduced-motion`.

### T06 - Finish mobile polish and Storybook viewport defaults

|                |                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| **Depends on** | T04, T05                                                                                                  |
| **Wave**       | 4                                                                                                         |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)                                                   |
| **Effort**     | S                                                                                                         |
| **Files**      | `app.html`, `.storybook/main.ts`, `.storybook/preview.ts`, component styles touched by T04/T05, plan docs |
| **PR title**   | `feat(storybook): default stage stories to mobile viewport`                                               |

Tighten mobile platform defaults after the UI exists: disable iOS page
pinch-zoom, configure Storybook mobile viewport defaults for stage-related
stories, and audit hover-only affordances introduced or touched by the
milestone.

**Acceptance**

- `app.html` viewport disables page pinch zoom while preserving app-level Stage
  pinch behavior.
- Storybook viewport addon is configured and stage-related stories default to a
  mobile viewport.
- Interactive surfaces involved in drag or sheet/menu manipulation have
  appropriate `touch-action` rules.
- Any hover-only affordance in the touched components has an always-visible or
  tap-accessible equivalent.
- The PR records manual smoke-test status for real iOS Safari and Android
  Chrome. If a device is unavailable, the plan notes the gap before milestone
  closure.

## Wave plan

```
Wave 1   T01  ||  T02  ||  T03     independent pure/helper foundations
Wave 2   T04                       uses long-press and min-hit behavior
Wave 3   T05                       uses graph update mutation and menu entry
Wave 4   T06                       final platform and Storybook polish
```

Total: 6 tasks, ~4 sequential gates, max parallelism in wave 1.

Before starting a wave, verify every task in that wave has all dependencies
merged to the active base branch and that same-wave tasks do not touch the same
component file.

## Risks and rollback

- **T02 can regress click/double-click timing.** Keep long-press state isolated
  from the existing delayed single-click timer and rely on Stage story coverage
  before wiring UI.
- **T03 can make overlapping small nodes ambiguous.** Preserve the existing
  topmost-element-first lookup so larger hit targets do not randomly select
  covered nodes.
- **T05 can grow beyond one PR.** If the sheet needs a dedicated reusable
  primitive plus focus management, split that primitive into a separate prep
  task before wiring Multigraph.
- **Viewport changes can affect browser zoom accessibility.** Treat the
  viewport change as app-canvas-specific MVP polish and document the trade-off
  in the PR if reviewer concern remains.

## Definition of Done (this plan)

The plan is done when:

- All 6 tasks are merged to the active base branch.
- The acceptance criteria from the milestone doc are satisfied.
- The plan records manual smoke-test results for one real iOS Safari session
  and one real Android Chrome session, or explicitly notes any unavailable
  device before closure.
- Plan status is `done`, milestone status is `complete`, and roadmap status for
  the milestone is `complete` with a link back to this plan.
- The finished work has been committed unless the user explicitly asked not to
  commit yet.

## Notes

- 2026-05-17: Current code already has immutable graph mutations, Stage
  callback harnesses, pinned layout scaling, and `Node` read-only open/closed
  rendering. Missing pieces are content update mutation, long-press recognition,
  minimum effective hit radius, edit sheet/menu UI, viewport tightening, and
  Storybook viewport defaults.
