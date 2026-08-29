# Plan: Insert quantity symbols into node text

**Created:** 2026-08-28
**Author:** Codex agent
**Milestone:** none — contained follow-up polish on
[milestone 09](../milestones/09-variable-dataflow-layer.md),
[milestone 10](../milestones/10-latex-math-in-node-titles.md), and
[milestone 11](../milestones/11-unified-hop-model-for-derived-edges.md)
**Status:** done
**Total estimated effort:** M

## Summary

Let an author send any visible input/output quantity chip into the title or
description in the node edit sheet, writing reusable LaTeX source at that
field's caret and, once per symbol in the authoring session, accepting the role
the parser already suggests. The chip's tap keeps cycling; the new action is a
hold, a right-click, or Shift+Enter. Nothing enters graph schema, persistence,
or canvas gesture code.

## Open questions resolved

There is no milestone doc with open questions to carry over, so these are the
product and engineering decisions resolved from the current implementation.

- **Where the feature lives.** **Only in `NodeEditSheet` edit mode.** That is the
  one surface where the quantity columns and both editable text fields already
  coexist; adding transfer state to the deep-zoom reader, canvas, or inline
  new-node title editor would spread one authoring shortcut through unrelated
  interaction systems.

- **What decides where the symbol lands.** **The caret, for both the field and
  the offset.** The sheet remembers the last active text field and its selection;
  an insertion goes there. Put the caret where the symbol belongs, then invoke
  the chip. A session that has focused neither field appends to the title, which
  is where the sheet already puts focus on open.

- **Why not drag-and-drop.** **Rejected after costing it.** A drag's only
  remaining job would be choosing between two fields, since the caret was already
  going to decide the offset. Buying that costs a pointer-session reducer,
  pointer capture, `elementFromPoint` targeting, a drag ghost, drop-target
  highlighting, a narrowed `touch-action` on a scrollable sheet, and a 5px
  threshold that a finger starting a scroll crosses by accident. The author who
  wants the other field clicks it first — which is the same click that sets their
  caret.

- **Why not double-click.** **It collides with the primary action.** A chip's
  single click cycles, so a double-click would cycle twice before inserting. The
  only ways out are deferring every cycle by `doubleClickMs` — 250ms of lag on
  the action used most, with the chip visibly unresponsive — or applying and
  reverting two cycles, which flickers and lies if a re-render lands between.
  `Stage` can afford double-tap on a node only because a node's single tap does
  nothing but record a timestamp.

- **How an insertion is invoked.** **Hold on the chip, right-click on the chip,
  or Shift+Enter — the same three gestures view mode already binds to its own
  secondary action.** Hold is the touch-and-everything path; right-click is the
  desktop fast path with no wait; Shift+Enter is the keyboard and
  assistive-technology path. Tap still cycles, and nothing new is drawn on the
  chip. `QuantityDesignationChips` already reads "tap decides, hold asks"; edit
  mode becomes "tap decides, hold inserts."

- **How the text is written.** **`document.execCommand('insertText', …)` into the
  focused field, not an assignment to the bound state.** Assigning the value from
  script clears that field's native undo stack, so Cmd/Ctrl+Z after an insertion
  would do nothing or restore a much older value, leaving manual deletion or
  Cancel as the only recovery. `insertText` preserves undo, places the caret
  after the insertion for free, and fires the `input` event that `bind:value`
  needs. A direct assignment with a restored caret stays as the fallback for the
  rare browser that reports failure, accepting the undo loss there.

- **Where focus ends up.** **In the target field, after the inserted source.**
  The point of the shortcut is to keep writing. A polite live status names the
  symbol and the field so the keyboard path does not move focus silently.

- **What source gets inserted.** **Serialize the chip's structural identity,
  verified by re-parsing it.** A bare or Unicode identifier inserts as itself and
  a subscript uses braced source such as `v_{0}`, but the serializer proves that
  rather than assuming it: it renders its own output, extracts symbols, and
  requires exactly one whose key matches. Real Temml round-trips `α`, `θ_{max}`,
  `v_{0}`, `𝐯`, `ℓ`, and `ℏ`, but not every chip — `\mathrm{Re}` yields a single
  identifier whose base is `Re`, and re-inserting `Re` parses as two symbols. On
  failure the serializer retries `\mathrm{<base>}`, which recovers the bare
  multi-letter case; on a second failure it returns null and the chip is not
  transferable.

- **Whether to add math delimiters.** **Inside an existing inline or display
  math segment, insert only the symbol source; everywhere else, insert one inline
  segment such as `$v_{0}$`.** Reuse `splitMathSegments` and its lossless source
  slices to locate the selection. A selection touching a delimiter or crossing
  segments is treated as prose and gets a self-contained inline segment rather
  than risking malformed surrounding math.

- **Which chips can insert text.** **Every chip visible in the edit columns:
  confirmed, stale, or suggested.** Role and freshness do not gate what can be
  typed. A stale designation becomes current again by this route with no
  designation change at all: `stale` means _confirmed but the parser no longer
  finds it_, so writing the symbol back into the text clears the flag by itself.

- **When an insertion confirms a role.** **When the symbol is still undecided,
  by asking the parser rather than by re-deriving equality rules.** After the
  insertion, re-run `nodeQuantities` on the drafts: a symbol it now `defines` is
  an output, one it now `references` is an input, and one it no longer sees at
  all yields nothing. That is the same rule `designationView` uses to place a
  ghost and the same role a tap would enter at, so the automatic decision can
  never contradict the chip the author is looking at. Chained equalities, invalid
  math, nested `=` inside `\sum_{i=1}^{n}`, and non-single-symbol left sides all
  fall out of rules `nodeQuantities` already owns and specs.

- **Whether an insertion may change a confirmed role.** **No — only a chip whose
  role is `suggestion` is eligible.** Otherwise a stale confirmed output dropped
  into `$x = v + 1$` would infer `input`, and `designateAs` would move it,
  silently dropping a dataflow edge the author had confirmed, from a gesture they
  read as "write this symbol."

- **What "only once" counts.** **Once per symbol, not once total for the node.**
  The first eligible insertion of `m` should not spend `g`'s opportunity. A
  successful automatic decision consumes that symbol's opportunity, and a manual
  chip cycle consumes it too; either event means the author has seen or stated a
  preference that later insertions must not fight. An insertion that produces no
  role consumes nothing.

- **Which lifecycle resets automatic designation.** **One edit-sheet opening is
  one authoring session; Save, Cancel, backdrop/Close, or any other unmount
  resets every symbol's eligibility.** This is the user's chosen boundary and
  keeps the guard as local component state instead of coupling it to deep zoom or
  `Multigraph`.

- **When the graph changes.** **Never during the insertion.** It updates the
  draft title/description and, when eligible, the draft input/output arrays. The
  existing preview and designation derivations react locally; only Save commits
  the node, and Cancel retains its current all-or-nothing behavior.

## Out of scope (for this plan)

- Dragging a chip anywhere, and mapping a pointer's x/y position to a character
  offset. The caret is the insertion point; the gesture only says "now."
- Inserting from view-mode/deep-zoom chips, across nodes, between browser
  windows, or from the operating system.
- Adding the quantity palette to the canvas's inline new-node title editor.
- Inserting equations, operators, units, arbitrary MathML fragments, tags, or
  edge labels.
- Rename-everywhere, autocomplete, a WYSIWYG equation editor, or any change to
  quantity extraction semantics.
- An application-level undo. This plan only preserves the undo each text field
  already has.
- Schema, save-file, offline-shell format, or graph mutation changes.

## Tasks

### T01 — Let the node edit sheet scroll on touch

|                |                                                        |
| -------------- | ------------------------------------------------------ |
| **Depends on** | —                                                      |
| **Wave**       | 1                                                      |
| **Agent**      | fast/cheap                                             |
| **Effort**     | XS                                                     |
| **Files**      | `NodeEditSheet.svelte`, `NodeEditSheet.stories.svelte` |
| **PR title**   | `fix(editor): let the node edit sheet scroll on touch` |

An independent pre-existing bug, landed first because the rest of this plan
touches the same file. `.node-edit-sheet` and `.edges-tab` are both
`overflow: auto` and both carry `touch-action: none`, so neither can be scrolled
by touch at all. Give both `pan-y`.

Note in the CSS comment why this diverges from the blanket `touch-action: none`
that `DeepZoomLayer`, `NodeActionMenu`, `TagColorLegend`, `Stage`, and
`ZoomWorld` use: those are not scrollable containers and these two are. The
backdrop keeps `none` — it must not scroll anything.

**Acceptance**

- Both scroll containers declare `pan-y`; the backdrop still declares `none`.
- A story scrolls the node tab with a touch pointer sequence and asserts
  `scrollTop` moved.
- Backdrop and Stage isolation are unchanged: a touch on the backdrop still
  cancels rather than panning the canvas underneath.

### T02 — Add pure quantity source serialization and text insertion

|                |                                                                                   |
| -------------- | --------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                 |
| **Wave**       | 1                                                                                 |
| **Agent**      | high-reasoning                                                                    |
| **Effort**     | M                                                                                 |
| **Files**      | new `Multigraph/lib/quantityTextInsertion.ts` and `quantityTextInsertion.spec.ts` |
| **PR title**   | `feat(dataflow): add verified quantity source serialization`                      |

Two DOM-free functions, no role logic:

1. `serializeSymbol(symbol, options?): string | null` — LaTeX source for one
   `QuantitySymbol`, verified by rendering its own output through `renderMath`,
   extracting symbols, and requiring exactly one with the same key. Braced
   subscripts; the canonical NUL-bearing key never reaches text. On failure retry
   `\mathrm{<base>}`; on a second failure return null.
2. `insertionFor(text, start, end, source): { insert: string }` — decides
   delimiters. Classify the selection against cumulative `MathSegment.source`
   lengths from `splitMathSegments`: wholly inside one segment's content region
   means raw source, anything else means one `$…$` segment. Do not change
   `splitMathSegments` or add offsets to its existing consumers.

Also export `applyInsertion(text, start, end, insert): { text, caret }` for the
`execCommand`-unavailable fallback in T03, so that path is tested rather than
hoped for.

Take segment parsing and symbol-extraction options as parameters where a test
needs to pin them.

**Acceptance**

- `v`, `α`, `v_0`, `θ_max`, `𝐯`, `ℓ`, and `ℏ` serialize and round-trip to the
  same key through the real math adapter; `v_0` serializes as `v_{0}`.
- A symbol whose base is a multi-character identifier (`Re`, from
  `\mathrm{Re}`) round-trips only via the `\mathrm{…}` retry, and the spec pins
  that it does.
- A symbol that survives neither attempt serializes to null.
- A collapsed or ranged selection wholly inside inline or display math yields
  raw symbol source with no nested delimiters.
- A selection in prose, touching a delimiter, spanning segments, or inside an
  unterminated delimiter yields one self-contained inline segment.
- An escaped dollar is handled in source offsets, not content offsets. In
  `Costs \$5`, `\$` is two source characters and one content character inside a
  _text_ segment, so a caret after it inserts `$v$` without the new delimiter
  pairing with the escaped one. `f840454` is evidence authors write this and that
  surfaces get it wrong.
- `applyInsertion` replaces a range and returns the exact next caret offset,
  including surrogate-pair cases.
- Neither function has DOM types, and neither mutates an argument.

### T03 — Insert quantities from the edit sheet chips

|                |                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------ |
| **Depends on** | T01, T02                                                                                         |
| **Wave**       | 2                                                                                                |
| **Agent**      | high-reasoning                                                                                   |
| **Effort**     | M                                                                                                |
| **Files**      | `QuantityDesignationChips.svelte`, `NodeEditSheet.svelte`, `QuantityChip.svelte`, `appConfig.ts` |
| **PR title**   | `feat(editor): insert quantity symbols into node text`                                           |

Ownership boundary, stated because it is the crux of the design:
`QuantityChip` stays presentational and gains nothing but a `transferable` flag
if styling needs one — it already accepts every pointer handler as a prop.
`QuantityDesignationChips` recognizes the gesture, because it already owns
`chipPress` and the click-suppression flag. `NodeEditSheet` owns the caret
memory, the insertion, and the role decision. Every new prop is optional:
`NodeDetailsContent` renders this component too.

In `QuantityDesignationChips`, mirror the view-mode peek wiring for edit mode,
against a new `onInsert?(symbol)` prop:

1. Hold recognition reuses `beginChipPress`/`trackChipPress`/`isChipLongPress`
   against a new `chipInsertLongPressMs` tunable in `appConfig` (start at 500 to
   match the peek hold). No new recognizer module.
2. Reuse the existing `suppressClickForKey`, do not add a second flag, and adopt
   its post-`68a8d17` shape rather than the one this plan first described. It is
   set before the callback, cleared only by the click it exists to swallow, and
   cleared again at the next `pointerdown` — _before_ the button check, so a
   right-click's own pointerdown disarms a leftover on the chip it is aimed at.
   That ordering keeps a hold whose click was lost to a wandering pointer from
   silently swallowing the next gesture, and it is load-bearing here precisely
   because edit mode now binds right-click too.
3. `oncontextmenu` in edit mode calls `preventDefault()`, ends the press, then
   inserts — but returns early only when `suppressClickForKey === chip.symbol.key`.
   Scoping the guard to this chip's own key is the whole of `68a8d17`: read as a
   bare "is it set?", one stale flag made the right-click on _every_ chip do
   nothing. The guard exists for Android, which synthesizes a contextmenu from a
   touch long-press on the very chip whose key was just set; in edit mode what it
   prevents is inserting the same symbol twice.
4. `onkeydown` in edit mode handles Shift+Enter and must call `preventDefault()`,
   or the browser activates the button as well and the chip inserts _and_ cycles.
   Plain Enter and Space keep cycling.
5. `chipTitle` and the section hint name both actions in edit mode, the way view
   mode already composes its two.
6. `touch-action` on the chip stays untouched. A scroll that cancels the hold is
   the right outcome, which is exactly what the existing comment in
   `QuantityChip` argues.

In `NodeEditSheet`:

1. Remember one `{ field, start, end }` for the last active text field, updated
   on `focus`, `select`, `input`, `keyup`, and `pointerup` on the title input and
   description textarea. Initialize it to the end of the title, since the sheet
   already focuses the title on open.
2. On insert: serialize (a null aborts with no change), compute the delimiter
   decision from the remembered selection, focus the field, restore the
   selection, and call `execCommand('insertText', false, insert)`. If it reports
   failure, fall back to `applyInsertion` plus an explicit caret restore.
3. Decide the role from the _post-insertion_ drafts by calling `nodeQuantities`
   on them directly — a defined symbol is an output, a referenced one an input,
   an absent one nothing. Read the field's own value rather than relying on
   derived timing.
4. Apply it through `designateAs` only when all three hold: the symbol's key is
   not in the session guard set, the symbol is currently in neither draft column,
   and the parse produced a role. Then add the key to the guard set. `cycle` adds
   the key too, before it changes the draft.
5. Announce the result in a visually hidden `role="status"` region naming the
   symbol and the field, since focus has moved.

The guard is a plain `Set<string>` of symbol keys in component state, never
saved. Unmounting discards it, so Save, Cancel, backdrop/Close, and node changes
all start a fresh authoring session with no reset callback and no wider store.

**Acceptance**

- A hold, a right-click, and Shift+Enter each insert once at the remembered
  caret; a tap still cycles exactly as today.
- A hold that inserts suppresses its trailing click, so the chip never cycles as
  well; a hold that drifts past the drift threshold cancels and the tap cycles.
- Shift+Enter inserts without also cycling; Enter and Space still cycle.
- Mouse, pen, and touch use the same handlers, and no chip's `touch-action`
  changes.
- The title is the default target because the sheet focuses it; focusing the
  description changes the target.
- After an insertion, focus is in the target field with the caret after the
  inserted source, and Cmd/Ctrl+Z undoes the insertion.
- A chip whose symbol cannot be serialized does not insert and says why.
- The first eligible insertion of an undecided symbol sets its draft role to the
  role the parser now reports; a symbol already in either column is never
  re-designated.
- After a manual cycle or an automatic decision, later insertions of that symbol
  change text only, until the sheet closes and a fresh opening resets the guard.
- An insertion producing no role leaves that symbol still eligible.
- Inserting a stale symbol's source clears its stale flag with no designation
  change.
- Insertions and role decisions change only local draft state; Save and Cancel
  semantics are unchanged.
- View mode is untouched: tap, hold-to-peek, right-click, and Shift+Enter behave
  exactly as before, on both surfaces that render these chips.
- No document-global store or persistent listener is introduced.

### T04 — Pin the interaction with browser stories and a real-input smoke test

|                |                                                 |
| -------------- | ----------------------------------------------- |
| **Depends on** | T03                                             |
| **Wave**       | 3                                               |
| **Agent**      | default workhorse                               |
| **Effort**     | M                                               |
| **Files**      | `NodeEditSheet.stories.svelte`                  |
| **PR title**   | `test(editor): cover quantity symbol insertion` |

Keep behavior coverage on the edit-sheet surface rather than adding a top-level
`Multigraph` harness. Drive real `PointerEvent`, `MouseEvent`, and
`KeyboardEvent` sequences with selection assertions; do not replace a gesture
with a direct callback call.

Lift the `holdChip` and `rightClickChip` helpers from
`NodeDetailsContent.stories.svelte` rather than writing new ones. `rightClickChip`
in particular dispatches the secondary-button `pointerdown` before the
`contextmenu`, because that pointerdown is what disarms a leftover suppression —
dispatching `contextmenu` alone tests the guard without the thing that clears it,
which is how the bug `68a8d17` fixed survived its first round of stories.

**Acceptance**

- Story: caret in prose title, hold `v_0`, inserts `$v_{0}$` and leaves the
  caret after the closing delimiter.
- Story: caret inside existing description math, hold `m`, inserts `m` with no
  nested `$` delimiters.
- Story: a selected range is replaced, and Save emits the resulting raw source.
- Story: focusing the description then inserting targets the description; a
  session that focused neither appends to the title.
- Story: right-click inserts once with no wait and no cycle.
- Story: a tap cycles once and inserts nothing; a hold inserts once and its
  trailing click never cycles.
- Story: Shift+Enter inserts at the remembered caret while Enter and Space
  cycle.
- Story: a hold that drifts past the drift threshold cancels, and the tap that
  ends it cycles.
- Story: a hold whose trailing click is lost to a wandering pointer does not
  swallow the next chip's right-click — the edit-mode twin of
  `RightClickStillAnswersAfterAHoldThatLostItsClick`.
- Story: the first insertion of an undecided symbol onto a valid left-hand side
  confirms output; onto a right-hand side confirms input.
- Story: an insertion that re-designates nothing — a symbol already confirmed in
  either column, including a stale one — changes text only, and the stale flag
  clears.
- Story: manually cycling a symbol prevents a later insertion from overriding it;
  a second eligible insertion after an automatic decision changes text but not
  role.
- Story: no, ambiguous, or invalid equality changes text without confirming a
  role or consuming that symbol's future eligibility.
- Story: closing and reopening the sheet resets eligibility, and closing neither
  persists nor mutates the discarded draft.
- Story: the live status names the symbol and the field after an insertion.
- Manual browser smoke covers mouse, real touch where available, keyboard and
  assistive secondary action, accessible help text, undo after an insertion,
  sheet scrolling, and a stale designation becoming current.

## Wave plan

```text
Wave 1   T01  ‖  T02   (independent: a CSS fix and a pure module)
Wave 2   T03           (the only component integration; depends on both)
Wave 3   T04           (browser behavior and real-input verification)
```

T01 and T02 share no files and can run in parallel; T01 lands first among them
so T03 rebases onto the final `NodeEditSheet` CSS. Past wave 1 the sequence is
intentionally narrow — the same chip and edit-sheet files own the whole gesture,
and splitting them would manufacture an interface broader than the feature
needs.

## Risks and rollback

- **One chip now answers four ways.** Tap cycles, hold and right-click insert,
  Shift+Enter inserts. View mode already carries the same four-way split for
  peek, and the suppression flag that makes it work is reused rather than
  rewritten. The classic bug to guard against is clearing that flag on
  `pointerup`, before the click it exists to swallow has happened.
- **Hold is less discoverable than a visible control.** Keep the
  no-new-affordance benefit only if the section hint, the per-chip title, and the
  live status make it findable in a screen-reader pass. If not, the contained
  fallback is a small per-chip insert control — not a revived drag.
- **Repeated insertion costs a hold each time.** Right-click is the desktop
  answer and Shift+Enter the keyboard one; touch has neither. If building an
  equation by hold feels slow in the manual smoke, lowering
  `chipInsertLongPressMs` is a one-line tunable change.
- **`execCommand` is deprecated.** It is also the only way to keep a text
  field's native undo, it is supported in every browser this app targets, and the
  stories run in a real browser so a regression surfaces as a failing test rather
  than a silent loss. The `applyInsertion` fallback covers failure.
- **Canonical source may not round-trip for every normalized identifier.** The
  serializer proves each one instead of assuming, with a `\mathrm{…}` retry and a
  non-transferable outcome as the floor. `\mathrm{Re}` is the known case and is
  spec'd.
- **Automatic designation can feel like the app undoing a correction.** It only
  ever acts on an undecided symbol, only once per symbol, and only in the role
  the ghost already showed. Ambiguous equations produce nothing and consume
  nothing.
- **T01 changes touch behavior on a modal surface.** Manual narrow/mobile review
  must confirm the sheet scrolls, the backdrop still cancels, and the canvas
  underneath still does not pan.
- **Rollback is low risk.** No schema or saved representation changes. Reverting
  T03/T04 removes the feature; any already-inserted text is ordinary LaTeX the
  app already supports. T01 and T02 stand alone and can be reverted
  independently.

## Definition of Done (this plan)

- T01–T04 acceptance criteria are satisfied and committed with the drafted
  Conventional Commit titles (T04 may fold into T03 if keeping the suite green
  requires one commit).
- `pnpm --filter mind-map-sv lint` passes.
- `pnpm --filter mind-map-sv check` passes with 0 errors and 0 warnings.
- `pnpm --filter mind-map-sv test:unit -- --run` passes, including server,
  client/browser, and Storybook projects.
- `pnpm --filter mind-map-sv test:e2e` passes as a regression gate.
- The manual real-input smoke in T04 passes.
- `apps/mind-map-sv/static/offline-app-shell.html` is regenerated by `pnpm -w build`
  and committed as its own `chore(build)` commit, which is what every feature
  touching app code in this roadmap has done.
- No graph type, persistence module, `Multigraph.svelte`, Stage/ZoomWorld gesture
  code, or view-mode chip behavior changes.
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
- 2026-08-28: User added one-shot role inference from equality side. Planning
  found one lifecycle mismatch to resolve before execution: `NodeEditSheet` is
  canvas-only today and entering deep zoom closes it, so "exit deep zoom resets
  it" is not currently an edit-sheet boundary.
- 2026-08-28: User resolved that mismatch in favor of the contained boundary:
  one edit-sheet opening is one authoring session, and closing it resets the
  per-symbol guard.
- 2026-08-28: Review pass replaced drag-and-drop with hold / right-click /
  Shift+Enter. The drag's only remaining job was choosing between two fields,
  and it was paying for that with a pointer-session reducer, `elementFromPoint`
  targeting, a ghost element, a narrowed `touch-action` on a scrollable sheet,
  and a 5px threshold in conflict with touch scrolling. Effort dropped from L to
  M and three named risks disappeared with it.
- 2026-08-28: Same pass replaced the plan's own equality parser with a re-run of
  `nodeQuantities` over the post-insertion drafts. The hand-rolled version was
  re-deriving `definitionOf` and could disagree with the ghost chip the author
  was looking at — for instance on `v` dropped into `$x = v + 1$` in a node that
  also says `$v = 2$`, where whole-draft parsing says output and the chip agrees.
- 2026-08-28: Round-trip serialization was verified against Temml 0.13.4 rather
  than assumed. `α`, `θ_{max}`, `v_{0}`, `𝐯` (`\mathbf{v}`), `ℓ`, and `ℏ` all
  recover the same key. `\mathrm{Re}` does not: its base is the two-character
  identifier `Re`, which re-parses as `R` and `e`. Hence the verified serializer
  with a `\mathrm{…}` retry.
- 2026-08-28: Rebased onto five commits that landed on `temp` after this plan was
  drafted. Two of them change what T02/T03 must do. `68a8d17` fixed the peek's
  click suppression — the guard is scoped to the chip's own key and the flag is
  cleared before the button check — and this plan's first draft described the
  pre-fix shape, so following it verbatim would have reintroduced that bug in edit
  mode with right-click added. `f840454` is evidence that `\$` reaches real titles,
  hence the escaped-dollar case in T02. The other three (`17548f5` physics,
  `da9b1b2` conflict naming, `1d59d15` shell regen) leave the plan unchanged;
  `da9b1b2` independently reinforces the decision not to treat a stale designation
  as a live claim.
- 2026-08-28: Executed. Four things the plan got wrong, found by building it.

  **T01's story could not be written as specified.** The acceptance asked for a
  touch pointer sequence asserting `scrollTop` moved, but `touch-action` governs
  the browser's own gesture handling: dispatched PointerEvents scroll nothing and
  `scrollTop = n` works whatever the rule says, so that story would have passed
  with the bug still in place. It asserts the computed `touch-action` instead.

  **The "no role, eligibility preserved" case is unreachable from the UI.** With
  whole-draft parsing a suggestion chip exists _because_ the parser sees its
  symbol, so after writing that symbol in again the parser still sees it and
  always returns a role. The branch stays as defensive code but has no story; the
  acceptance bullet was inherited from the per-segment design, where "no
  equality" was an ordinary outcome, and did not survive the switch.

  **Undo cannot be asserted in a story.** `execCommand` reports success and then
  does nothing when the browsing context is not the focused one, which is the
  norm headless — so the suite exercises the fallback path, and the undo the
  `execCommand` path exists for belongs to the manual smoke. That discovery also
  changed the component: the return value is not trusted, the resulting text is
  compared against what was expected, and the fallback runs on mismatch.

  **Reopening the sheet is not story-testable** — a play function cannot remount
  its own component — so the per-symbol guard reset is covered by the node effect
  and the manual smoke rather than a story.

- 2026-08-28: Two bugs worth remembering, both about `NodeEditSheet` timing.
  The draft-reset `$effect` must never read the `title` draft it writes: an
  earlier version initialised the caret from `title.length`, which made the effect
  depend on its own output, so every insertion re-ran the reset and threw the edit
  away. And the mount-time `requestAnimationFrame` focus can steal a caret placed
  within that same frame, which no author can hit but every story can — so the
  story helpers wait a frame before placing one.
