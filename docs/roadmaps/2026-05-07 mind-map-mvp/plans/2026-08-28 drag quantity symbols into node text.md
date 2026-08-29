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
field's caret. Keep the whole interaction local to the edit sheet: no global
drag service, graph mutation, persistence change, or canvas gesture branch.

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

- **How a drag starts without breaking the existing chip gesture.** **Give every
  edit-mode chip a small, sibling grab/insert button; leave the chip body itself
  as the three-state designation cycle.** A dedicated handle makes the two
  actions explicit, keeps a touch scroll from accidentally cycling or dragging,
  and lets `touch-action: none` apply to the handle alone. `QuantityChip` and all
  view-mode peek/cycle behavior stay unchanged.

- **Desktop versus touch mechanics.** **Use one Pointer Events path with pointer
  capture, not native HTML drag-and-drop.** Native drag would be smaller on
  desktop but would create a second, incomplete touch path. The existing
  `APP_CONFIG.interaction.dragThresholdPx` remains the drag threshold tunable.

- **Keyboard and assistive-technology equivalent.** **The grab affordance is a
  real button whose ordinary activation inserts into the last active text field.**
  Its accessible name says, for example, “Insert v into title”; a short live
  status confirms the insertion. Pointer movement past the threshold converts
  the same press into a drag and suppresses its trailing click.

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
  confirmed, stale, or suggested.** Insertion is a text edit, not a designation
  mutation; role and freshness should not silently change what can be typed.
  Stale designations are especially useful because dragging one back into the
  text makes it current again.

- **When the graph changes.** **Never during the drag.** The draft title and
  description update on a successful drop, the existing preview/designation
  derivations react to that draft, and only the existing Save action commits the
  node. Cancel retains its current all-or-nothing behavior.

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
  quantity extraction and designation semantics.
- Schema, save-file, offline-shell format, or graph mutation changes.

## Tasks

### T01 — Add pure quantity-to-text insertion transactions

|                |                                                                                   |
| -------------- | --------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                 |
| **Wave**       | 1                                                                                 |
| **Agent**      | default workhorse                                                                 |
| **Effort**     | S                                                                                 |
| **Files**      | new `Multigraph/lib/quantityTextInsertion.ts` and `quantityTextInsertion.spec.ts` |
| **PR title**   | `feat(dataflow): add pure quantity text insertion`                                |

Implement a DOM-free transaction that accepts source text, a start/end
selection, and a `QuantitySymbol`, then returns the next text and collapsed
selection after the inserted source. Use cumulative `MathSegment.source`
lengths to classify the selection without changing `splitMathSegments` or
adding offsets to every existing consumer.

Keep serialization in this module: braced subscripts, normalized Unicode
identifiers, and no canonical NUL-containing key in text. Take segment parsing
and serialization options as parameters where a test needs to pin them.

**Acceptance**

- A bare `v`, Greek `α`, and subscripted `v_0` serialize to parseable source;
  `v_0` inserts as `v_{0}`.
- A collapsed or ranged selection wholly inside inline/display math gets raw
  symbol source with no nested delimiters.
- A selection in prose, at a math boundary, spanning segments, or inside an
  unterminated delimiter gets one self-contained inline segment.
- Replacing a range returns the exact next caret offset, including surrogate-pair
  Unicode cases.
- Integration specs render inserted Greek/subscripted source through the real
  math adapter and recover the same symbol key.
- The helper has no DOM types and does not mutate any argument.

### T02 — Add an editor-local quantity drag protocol

|                |                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| **Depends on** | T01                                                                                                    |
| **Wave**       | 2                                                                                                      |
| **Agent**      | high-reasoning                                                                                         |
| **Effort**     | M                                                                                                      |
| **Files**      | new `Multigraph/lib/quantityDrag.ts` + spec, `QuantityDesignationChips.svelte`, `NodeEditSheet.svelte` |
| **PR title**   | `feat(editor): drag quantity chips into node text`                                                     |

Add a small pure pointer-session reducer in `quantityDrag.ts`: begin with a
pointer id, symbol, and origin; update with points; become active after the
configured distance; finish or cancel only for the owning pointer. It knows
nothing about fields, Svelte, or the graph.

In edit mode, render a grab/insert button as a sibling of each existing
`QuantityChip`. It captures the pointer and forwards session updates. Do not add
drag props to the shared `QuantityChip`; view mode retains the current tap/hold/
right-click/keyboard contract byte-for-byte.

`NodeEditSheet` owns the only transfer UI state:

1. Record `{ start, end }` for title and description on focus, select, input,
   keyboard movement, and pointer caret placement.
2. During an active drag, use `document.elementFromPoint` only to choose one of
   two marked drop targets; never to derive a character offset.
3. On a valid drop or handle activation, run T01's transaction, update the local
   draft, await the render, focus the target, and restore the returned caret.
4. On release elsewhere, pointer cancel, Escape, sheet close, or component
   teardown, discard the session without editing text.
5. Show a fixed-position symbol ghost and target highlight only while the drag
   is active; honor reduced motion without needing an animation.

**Acceptance**

- The title remains the default insertion target because the sheet already
  focuses it; focusing the description changes the default.
- Dragging onto either field inserts at that field's remembered selection;
  releasing elsewhere changes neither draft.
- A sub-threshold press activates the handle once; an active drag suppresses
  the trailing click so it never inserts twice.
- Mouse, pen, and touch use the same handlers. Only the grab button has
  `touch-action: none`; the chip body and sheet keep normal scroll behavior.
- The chip body still cycles suggestions/inputs/outputs exactly as today.
- A successful insertion changes only local draft state and keeps Save/Cancel
  semantics unchanged.
- No document-global store or persistent listener is introduced; pointer capture
  and component cleanup bound the session to the sheet.

### T03 — Pin the interaction with browser stories and a real-input smoke test

|                |                                                                             |
| -------------- | --------------------------------------------------------------------------- |
| **Depends on** | T02                                                                         |
| **Wave**       | 3                                                                           |
| **Agent**      | default workhorse                                                           |
| **Effort**     | M                                                                           |
| **Files**      | `NodeEditSheet.stories.svelte`, possibly `DataflowHarness.svelte` + stories |
| **PR title**   | `test(editor): cover quantity drag insertion`                               |

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
- Story: handle click/keyboard activation inserts once; a threshold-crossing
  pointer drag followed by its click also inserts once.
- Story: the neighboring chip body still cycles its designation and never starts
  a text drag.
- Manual browser smoke covers mouse, touch emulation/real touch when available,
  keyboard-only insertion, target highlighting, sheet scrolling, and a stale
  designation becoming current after insertion.

## Wave plan

```text
Wave 1   T01        (pure source and insertion contract)
Wave 2   T02        (the only component integration; depends on T01)
Wave 3   T03        (browser behavior and real-input verification)
```

The sequence is intentionally narrow. There is no useful parallel component
wave: the same two edit-sheet files own both ends of the gesture, and splitting
them would manufacture an interface broader than the feature needs.

## Risks and rollback

- **Pointer capture can hide the element under the pointer.** Detection uses
  `elementFromPoint`, not the captured event target. A story must prove both
  fields are distinguishable while capture is active.
- **Focusing the grab button can erase the visible caret.** Pointerdown prevents
  default focus movement and the sheet keeps a selection snapshot. Keyboard
  activation necessarily focuses the button, then restores the stored field and
  returned caret after insertion.
- **Canonical source may not round-trip for every normalized MathML identifier.**
  Real-renderer integration cases cover the supported shapes before UI wiring.
  If a rare symbol cannot round-trip, disable its handle with an explanation
  rather than insert source that changes identity.
- **The extra grab affordance could make dense chip rows noisy.** Keep it edit
  mode only, visually subordinate, and inspect narrow/mobile stories. If it still
  reads poorly, a selected-chip “Insert” action can replace the handle without
  changing T01 or the sheet's target/caret contract.
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
- No graph type, persistence module, `Multigraph.svelte`, Stage/ZoomWorld
  gesture code, or view-mode chip behavior changes.
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
