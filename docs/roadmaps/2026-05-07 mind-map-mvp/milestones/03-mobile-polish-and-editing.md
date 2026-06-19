# Milestone 03: Mobile polish and node editing UX

**Status:** in progress
**Depends on:** milestones 01 + 02 (graph data, all-node rendering).
**Plan:** [2026-05-17 03-mobile-polish-and-editing.md](../plans/2026-05-17%2003-mobile-polish-and-editing.md)

## Goal

Make the app pleasant on a phone and let users actually edit node
content. After this milestone, a non-technical user can capture a
mind-map during a phone-only conversation: tap to inspect, long-press
for actions, edit title/description in a sheet, pin/unpin/delete
without diving into a debug toast.

## Scope

### Editing UX

- Single tap (or click) on a node opens an **edit sheet / dialog** with
  fields for title and description, and a "Pin / Unpin" toggle.
  - On desktop: a side panel or modal.
  - On mobile: a bottom sheet (slide up from bottom, swipe-down to
    dismiss).
- Save = persists to the in-memory `MultigraphData` via `graph.ts`
  mutations. (Real persistence lands in milestone 04.)
- Cancel = restore previous values.

### Long-press contextual menu

- Long-press (≥ ~500 ms) on a node opens a small floating menu with
  Pin/Unpin, Edit, Delete. Same gesture works on desktop (mouse-down
  hold) and mobile (touch-and-hold).
- Add a `LONG_PRESS_MS` constant in `constants.ts`.
- Pure helper in `lib/longPress.ts`:
  `recognizeLongPress({ duration, distance }): boolean`.
- Wire into `Stage.svelte` alongside the existing pointer flow without
  breaking double-click semantics.

### Tap-target sizing

- Node hit areas honor a **minimum effective radius** in screen pixels
  (target 32–44 px) regardless of visual scale. Add to `hitTest.ts`:
  `effectiveHitRadius(visualRadius, minHitRadius): number`.
- When a small distant node is tapped, the contextual menu still
  appears and works.

### Mobile-specific polish

- Bottom-sheet animations respect `prefers-reduced-motion`.
- All interactive surfaces have `touch-action: none` where drag is
  meaningful.
- Disable iOS Safari pinch-to-zoom-the-page (we handle pinch on the
  Stage); set the appropriate `viewport` meta in `app.html`.
- Audit `:hover`-only affordances and replace with always-visible or
  on-tap variants.

## Acceptance criteria

- New unit specs for `recognizeLongPress`, `effectiveHitRadius`.
- New stories:
  - "User taps a node and the edit sheet appears with current values."
  - "User edits the title in the sheet and saves; node title updates."
  - "User long-presses a node and a contextual menu appears with
    Pin / Edit / Delete."
  - "User taps a tiny distant node (visual radius < min hit radius)
    and the menu still appears."
- Storybook viewport addon configured to make mobile viewports the
  default for stage-related stories.
- Manual smoke test on at least one real iOS Safari + one Android
  Chrome session before closing the milestone (no automated coverage
  for this — note in the plan).

## Non-goals

- **Rich text** in descriptions (markdown, links, images). MVP is
  plain text in a `<textarea>`.
- **Keyboard shortcuts** beyond Esc-to-close. Full keyboard nav can
  come later.
- **Internationalization.**
- **Theming / dark mode** beyond the app's base Tailwind theme.

## Risks and open questions

- **Long-press vs accidental-drag.** Long-press recognition must
  _cancel_ if pointer moves more than a few px (already similar to
  `dragThreshold` logic). Distance threshold goes in `LONG_PRESS_DIST`.
- **Sheet interaction with stage gestures.** When the sheet is open,
  stage pointer events should be paused. Decide via z-index + a
  `stage.disabled` prop or a focus-trap approach.
- **Two-finger pinch starting on a node.** Should pinch-zoom the stage,
  not move the node. The existing `Stage.svelte` already does this
  (`activePointers.size === 2` cancels `panStart`); confirm it also
  cancels node drag.

## References

- Add a focused modal/sheet primitive when this milestone starts; the
  earlier unused dialog scaffold was removed before milestone 01.
- `.cursor/rules/svelte.mdc` ("Mobile-first gotchas").
