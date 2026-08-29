# Plan: Drag quantity symbols into node text

**Created:** 2026-08-28
**Author:** Codex agent
**Milestone:** none — contained follow-up polish on
[milestone 09](../milestones/09-variable-dataflow-layer.md),
[milestone 10](../milestones/10-latex-math-in-node-titles.md), and
[milestone 11](../milestones/11-unified-hop-model-for-derived-edges.md)
**Status:** draft
**Total estimated effort:** L

## Summary

Let an author drag any visible input/output quantity chip onto the title or
description in the node edit sheet, inserting reusable LaTeX source at that
field's caret and, once per symbol in the authoring session, confirming the role
implied by an unambiguous equality. Keep the interaction out of graph schema,
persistence, and canvas gesture code.

## Open questions resolved

There is no milestone doc with open questions to carry over, so these are the
product and engineering decisions resolved from the current implementation.

- **Where the feature lives.** **Only in `NodeEditSheet` edit mode.** That is the
  one surface where the quantity columns and both editable text fields already
  coexist; adding transfer state to the deep-zoom reader, canvas, or inline new-node
  title editor would spread one authoring shortcut through unrelated interaction
  systems.

- **What “drop position” means.** **The drag chooses title versus description;
  the field's current or most recently remembered selection chooses the exact
  insertion point.** Put the caret where the symbol belongs, then drag it to that
  field. A field that has never been focused appends. This avoids a mirrored-text
  layout engine whose only job would be converting pointer coordinates to a
  character offset inside `<input>` and `<textarea>` controls.

- **How a drag starts without breaking the existing chip gesture.** **Use the
  chip body for both, following Stage's node recognizer: a press/release below
  `dragThresholdPx` remains the existing click-to-cycle, while movement across
  the threshold becomes a drag.** There is no new persistent visual affordance.
  Unlike Stage, the chip is a real button and the browser emits a trailing
  `click` after pointer-up, so a completed drag must set a one-shot suppression
  flag that only that click consumes.

- **Desktop versus touch mechanics.** **Use one Pointer Events path with pointer
  capture, not native HTML drag-and-drop.** Native drag would be smaller on
  desktop but would create a second, incomplete touch path. The existing
  `APP_CONFIG.interaction.dragThresholdPx` remains the drag threshold tunable.
  Replace the edit sheet container's current blanket `touch-action: none` with
  `pan-y`, then apply `none` only to edit-mode draggable chips. View-mode chips
  keep their current scroll-cancels-hold behavior.

- **Keyboard and assistive-technology equivalent.** **Keep Enter/Space and
  ordinary button activation as “cycle”; use Shift+Enter as “insert into the
  last active text field at its caret.”** This matches the view chip's existing
  convention that Shift+Enter invokes its secondary action (peek) without adding
  another control. A section hint and each chip's accessible description name
  “activate to cycle, drag to choose a field, Shift+Enter to insert”; a polite
  live status confirms the field and symbol after insertion.

- **What source gets inserted.** **Serialize the chip's structural identity,
  never its canonical key and never remembered author spelling.** A bare or
  Unicode identifier inserts as itself; a subscript uses braced source such as
  `v_{0}` so multi-character subscripts remain one subscript. Real-renderer
  integration specs must prove representative Greek and subscripted symbols
  round-trip to the same quantity key.

- **Whether to add math delimiters.** **Inside an existing inline or display
  math segment, insert only the symbol source; everywhere else, insert one inline
  segment such as `$v_{0}$`.** Reuse `splitMathSegments` and its lossless source
  slices to locate the selection. A selection that crosses a delimiter is treated
  as prose and replaced with a self-contained inline segment rather than risking
  malformed surrounding math.

- **Which chips can be transferred.** **Every chip visible in the edit columns:
  confirmed, stale, or suggested.** Role and freshness do not gate what can be
  typed. Stale designations are especially useful because dragging one back into
  the text makes it current again.

- **When insertion confirms a role.** **On a symbol's first eligible insertion
  in the session, use `designateAs` to make it an output when the updated math is
  a valid single-symbol definition with that symbol on the left, or an input
  when the insertion is to the right of the expression's one top-level `=`.**
  No equality, chained equalities, invalid math, a selection crossing segments,
  or a non-single-symbol left side produces no automatic output decision. This
  keeps the shortcut aligned with `nodeQuantities` instead of confirming a role
  the parser immediately contradicts.

- **What “only once” counts.** **Recommended: once per symbol, not once total for
  the node.** The first eligible insertion of `m` should not prevent `g` from
  receiving the same help. A successful automatic decision consumes the symbol's
  opportunity even when it was already in the inferred role, and a manual chip
  cycle consumes it too; either event means the author has seen or stated a
  preference that later dragging must not fight. Ineligible drops do not consume
  the opportunity.

- **Which lifecycle resets automatic designation.** **ASK USER:** the current
  app never shows `NodeEditSheet` inside deep zoom: the sheet opens only from the
  canvas action menu, and entering focus closes it. Recommended: define the
  authoring session as one edit-sheet opening and reset on Save, Cancel, or
  close. If “exit deep zoom” is the required boundary, this plan must also add a
  deep-zoom edit entry point or lift the guard into `Multigraph`, widening the
  containment boundary.

- **When the graph changes.** **Never during the drag or automatic designation.**
  A successful drop updates the draft title/description and, when eligible, the
  draft input/output arrays. The existing preview and designation derivations
  react locally; only Save commits the node, and Cancel retains its current
  all-or-nothing behavior.

## Out of scope (for this plan)

- Mapping the pointer's x/y position to an exact character offset. The caret is
  the insertion marker; the drag only chooses a field.
- Dragging from view-mode/deep-zoom chips, across nodes, between browser windows,
  or from the operating system.
- Adding the quantity palette to the canvas's inline new-node title editor.
- Auto-scrolling the sheet during a drag. The source chips and both targets are
  adjacent in the node tab; real use can justify this later if needed.
- Dragging equations, operators, units, arbitrary MathML fragments, tags, or
  edge labels.
- Rename-everywhere, autocomplete, a WYSIWYG equation editor, or any change to
  quantity extraction semantics.
- Schema, save-file, offline-shell format, or graph mutation changes.

## Tasks

### T01 — Add pure quantity insertion and role-hint transactions

|                |                                                                                   |
| -------------- | --------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                 |
| **Wave**       | 1                                                                                 |
| **Agent**      | high-reasoning                                                                    |
| **Effort**     | M                                                                                 |
| **Files**      | new `Multigraph/lib/quantityTextInsertion.ts` and `quantityTextInsertion.spec.ts` |
| **PR title**   | `feat(dataflow): add pure quantity insertion hints`                               |

Implement a DOM-free transaction that accepts source text, a start/end
selection, and a `QuantitySymbol`, then returns the next text and collapsed
selection after the inserted source plus an optional `input`/`output` hint. Use
cumulative `MathSegment.source` lengths to classify the selection without
changing `splitMathSegments` or adding offsets to every existing consumer.

Keep serialization in this module: braced subscripts, normalized Unicode
identifiers, and no canonical NUL-containing key in text. Take segment parsing
and serialization options as parameters where a test needs to pin them. Role
classification must be about the target math segment and insertion offset, not
about whether the same symbol happens to appear elsewhere in the node.

**Acceptance**

- A bare `v`, Greek `α`, and subscripted `v_0` serialize to parseable source;
  `v_0` inserts as `v_{0}`.
- A collapsed or ranged selection wholly inside inline/display math gets raw
  symbol source with no nested delimiters.
- A selection in prose, at a math boundary, spanning segments, or inside an
  unterminated delimiter gets one self-contained inline segment.
- Replacing a range returns the exact next caret offset, including surrogate-pair
  Unicode cases.
- Inserting the single left-hand symbol of one valid top-level equality hints
  `output`; inserting to the right hints `input`.
- No equality, a chained equality, invalid math, a drop on the equality itself,
  or a left side that remains more than one symbol yields no output hint.
- Nested equality signs such as `\sum_{i=1}` do not split the outer equation.
- Integration specs render inserted Greek/subscripted source through the real
  math adapter and recover the same symbol key.
- The helper has no DOM types and does not mutate any argument.

### T02 — Add an editor-local quantity drag protocol

|                |                                                                                                                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T01                                                                                                                                                                                                 |
| **Wave**       | 2                                                                                                                                                                                                   |
| **Agent**      | high-reasoning                                                                                                                                                                                      |
| **Effort**     | M                                                                                                                                                                                                   |
| **Files**      | new `Multigraph/lib/quantityDrag.ts` + spec, `QuantityChip.svelte`, `QuantityDesignationChips.svelte`, `NodeEditSheet.svelte`; `Multigraph.svelte` only if the deep-zoom reset boundary is selected |
| **PR title**   | `feat(editor): drag quantity chips into node text`                                                                                                                                                  |

Add a small pure pointer-session reducer in `quantityDrag.ts`: begin with a
pointer id, symbol, and origin; update with points; become active after the
configured distance; finish or cancel only for the owning pointer. It knows
nothing about fields, Svelte, or the graph.

In edit mode, the existing `QuantityChip` captures the primary pointer and
forwards session updates. Below threshold it does nothing special and the
button's real click continues to cycle. Once the session becomes a drag it
suppresses the trailing click, updates the drag preview, and resolves the drop.
View mode retains the current tap/hold/right-click/Shift+Enter contract.

`NodeEditSheet` owns the only transfer UI state:

1. Record `{ start, end }` for title and description on focus, select, input,
   keyboard movement, and pointer caret placement.
2. During an active drag, use `document.elementFromPoint` only to choose one of
   two marked drop targets; never to derive a character offset.
3. On a valid drop or Shift+Enter insertion, run T01's transaction, update the local
   draft, apply the eligible one-time role hint through `designateAs`, await the
   render, focus the target, and restore the returned caret.
4. On release elsewhere, pointer cancel, Escape, sheet close, or component
   teardown, discard the session without editing text.
5. Show a fixed-position symbol ghost and target highlight only while the drag
   is active; honor reduced motion without needing an animation.
6. On Shift+Enter, skip drag targeting and insert into the remembered field using
   the same transaction and one-time role rule.
7. Narrow touch suppression from the whole sheet to draggable edit chips so a
   touch beginning elsewhere can scroll the overflow container vertically.

The automatic-role guard is a `Set` of symbol keys, not saved state. Under the
recommended edit-sheet-session boundary it stays inside `NodeEditSheet` and a
manual `cycle` adds the key before changing the draft. If the user chooses the
deep-zoom boundary, lift only this set/lifecycle signal to `Multigraph`; do not
move pointer or insertion state with it.

**Acceptance**

- The title remains the default insertion target because the sheet already
  focuses it; focusing the description changes the default.
- Dragging onto either field inserts at that field's remembered selection;
  releasing elsewhere changes neither draft.
- A sub-threshold press/release cycles once and inserts nothing; an active drag
  inserts once and suppresses the trailing cycle click.
- Mouse, pen, and touch use the same handlers. Only edit-mode draggable chips
  have `touch-action: none`; the sheet uses `pan-y`, and view-mode chip
  scrolling/hold cancellation stays unchanged.
- The chip body still cycles suggestions/inputs/outputs exactly as today.
- Shift+Enter inserts into the remembered field; Enter/Space still cycle.
- The first eligible insertion of a symbol sets its draft role; after a manual
  cycle or automatic decision, later insertions of that symbol change text only
  until the selected session boundary resets.
- A successful insertion and role hint change only local draft state and keep
  Save/Cancel semantics unchanged.
- No document-global store or persistent listener is introduced; pointer capture
  and component cleanup bound the session to the sheet.

### T03 — Pin the interaction with browser stories and a real-input smoke test

|                |                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------- |
| **Depends on** | T02                                                                                               |
| **Wave**       | 3                                                                                                 |
| **Agent**      | default workhorse                                                                                 |
| **Effort**     | M                                                                                                 |
| **Files**      | `NodeEditSheet.stories.svelte`; possibly `Multigraph.stories.svelte` for a deep-zoom-scoped reset |
| **PR title**   | `test(editor): cover quantity drag insertion`                                                     |

Keep the behavior coverage on the edit-sheet surface rather than adding a
top-level `Multigraph` harness unless pointer capture cannot be exercised there.
Use actual `PointerEvent` sequences and selection assertions; do not replace the
gesture with direct callback calls.

**Acceptance**

- Story: caret in prose title + drag `v_0` to title inserts `$v_{0}$` and leaves
  the caret after the closing delimiter.
- Story: caret inside existing description math + drag `m` inserts `m` without
  nested `$` delimiters.
- Story: a selected range is replaced and Save emits the resulting raw source.
- Story: dropping on the other field uses that field's remembered caret; an
  untouched field defaults to its end.
- Story: release outside, pointer cancel, and Escape each leave both drafts
  unchanged and remove drag feedback.
- Story: a sub-threshold click cycles once; a threshold-crossing drag followed by
  its browser click inserts once and never cycles.
- Story: Shift+Enter inserts at the remembered caret while Enter/Space cycle.
- Story: the first drop onto a valid left-hand side confirms output and the first
  drop onto a right-hand side confirms input.
- Story: manually cycling a symbol prevents a later drop from overriding it;
  likewise, a second eligible drop after automatic confirmation changes text but
  not role.
- Story: no/ambiguous/invalid equality changes text without confirming a role or
  consuming the symbol's future eligible inference.
- Story or top-level integration (depending on the user's lifecycle decision):
  closing the chosen session resets eligibility.
- Manual browser smoke covers mouse, touch emulation/real touch when available,
  keyboard/assistive secondary action, accessible help text, target highlighting,
  sheet scrolling, and a stale designation becoming current after insertion.

## Wave plan

```text
Wave 1   T01        (pure source, insertion, and role-hint contract)
Wave 2   T02        (the only component integration; depends on T01)
Wave 3   T03        (browser behavior and real-input verification)
```

The sequence is intentionally narrow. There is no useful parallel component
wave: the same chip/edit-sheet files own both ends of the gesture, and splitting
them would manufacture an interface broader than the feature needs.

## Risks and rollback

- **Pointer capture can hide the element under the pointer.** Detection uses
  `elementFromPoint`, not the captured event target. A story must prove both
  fields are distinguishable while capture is active.
- **One button now recognizes click and drag.** The Stage node recognizer is the
  precedent, but a DOM button adds a trailing native click. The suppression flag
  must survive pointer-up and be consumed only by that click; clearing it during
  pointer-up is the double-action bug to guard against.
- **Touch drag and touch scroll begin with the same motion.** The sheet currently
  disables both with a blanket `touch-action: none`; narrowing that rule to the
  draggable chips and giving the container `pan-y` is part of T02. Manual
  narrow/mobile review must confirm a dense chip row does not make the sheet feel
  trapped or regress backdrop/Stage isolation.
- **The secondary keyboard action is less visible than a second control.** Keep
  the no-new-affordance benefit only if the section hint, per-chip accessible
  description, and live insertion result make Shift+Enter discoverable in a
  screen reader pass. If not, a context-menu command is the contained fallback.
- **Canonical source may not round-trip for every normalized MathML identifier.**
  Real-renderer integration cases cover the supported shapes before UI wiring.
  If a rare symbol cannot round-trip, make that chip non-transferable with an explanation
  rather than insert source that changes identity.
- **Automatic designation can feel like the app is undoing a correction.** A
  per-symbol one-shot guard, consumed by either inference or manual cycling,
  prevents repeat overrides. Ambiguous equations produce no role and do not
  consume the opportunity.
- **The requested reset boundary does not match today's component lifecycle.**
  The edit sheet and deep zoom are mutually exclusive. Resolve the `ASK USER`
  item before execution; otherwise the implementation would either reset too
  often or introduce wider session state without an agreed product reason.
- **Draft re-parsing can reorder or remove a suggestion after insertion.** The
  session carries an immutable symbol value, not a live DOM-node reference, and
  completes before the draft update triggers that re-render.
- **Rollback is low risk.** No schema or saved representation changes. Reverting
  T02/T03 removes the UI; any already-inserted text is ordinary LaTeX source the
  app already supports. T01 can be removed independently if no other caller uses
  it.

## Definition of Done (this plan)

- T01–T03 acceptance criteria are satisfied and committed with the drafted
  Conventional Commit titles (T03 may fold into T02 if keeping the suite green
  requires one commit).
- `pnpm --filter mind-map-sv lint` passes.
- `pnpm --filter mind-map-sv check` passes with 0 errors and 0 warnings.
- `pnpm --filter mind-map-sv test:unit -- --run` passes, including server,
  client/browser, and Storybook projects.
- `pnpm --filter mind-map-sv test:e2e` passes as a regression gate.
- The manual real-input smoke in T03 passes.
- No graph type, persistence module, Stage/ZoomWorld gesture code, or view-mode
  chip behavior changes. `Multigraph.svelte` remains untouched under the
  recommended edit-sheet-session boundary and may own only the one-shot guard
  if the user explicitly chooses the deep-zoom boundary.
- Plan status is `done`; completed implementation is committed unless the user
  explicitly asks otherwise.

## Notes

- 2026-08-28: Planning investigation found that `NodeEditSheet` already derives
  the chip suggestions live from its title/description drafts, while
  `QuantityDesignationChips` already separates edit and view modes. That makes
  the edit sheet a natural containment boundary.
- 2026-08-28: Exact pointer-to-character placement was rejected for the first
  version. Native text controls do not expose a small cross-browser coordinate
  API for this use, and a mirrored typography implementation would cost more
  and leak further than the authoring shortcut itself.
- 2026-08-28: User preferred the chip itself as the drag source. The revised
  gesture mirrors Stage's node click/drag threshold and keeps a keyboard
  equivalent on Shift+Enter rather than adding a persistent handle.
- 2026-08-28: User added one-shot role inference from equality side. Planning
  found one lifecycle mismatch to resolve before execution: `NodeEditSheet` is
  canvas-only today and entering deep zoom closes it, so “exit deep zoom resets
  it” is not currently an edit-sheet boundary.
