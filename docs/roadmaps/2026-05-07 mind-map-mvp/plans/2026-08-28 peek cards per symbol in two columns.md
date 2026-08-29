# Plan: Peek cards per symbol, in two columns

**Created:** 2026-08-28
**Author:** Claude agent
**Milestone:** none — contained follow-up polish on
[milestone 09](../milestones/09-variable-dataflow-layer.md) and
[milestone 11](../milestones/11-unified-hop-model-for-derived-edges.md)
**Status:** done
**Total estimated effort:** M

## Summary

Let a reader open a peek card for several quantities at once, laid out in two
columns under the input and output chips they came from, and make an output's
card answer the question its column implies: not "where is this defined?" but
"where does this go?".

## Open questions resolved

- **What a card answers.** **The direction the chip's column implies.** An input
  card looks upstream — who defines this — and an output card looks downstream —
  who consumes this. One sentence a reader never has to look up, and it matches
  the arrows in the graph. Today both directions ask the upstream question, which
  is why an output's card currently reports the node's own definition back at it.

- **Where direction comes from.** **The column the chip sits in, not its
  confirmed role.** A suggestion is a ghost in the column it would land in, so a
  suggested output opens a downstream card. Reading the role instead would make a
  ghost's card change meaning at the moment it is confirmed, which is the one
  moment the reader is looking at it.

- **Whether the output card keeps conflict rows.** **Yes, below the consumers,
  and only when there are any.** The output card is where a reader currently
  discovers that some _other_ node also defines their quantity, differently —
  `QuantityDesignationChips` calls it "where the conflicts show". Replacing that
  wholesale with consumers would delete the only path to that discovery. Listing
  other definers costs zero rows in the healthy case and is loud in exactly the
  case that is wrong. The current node is never among them; "other" means other.

- **Which consumers appear.** **Confirmed consumers only, straight off
  `consumerNodeIds`.** The input card additionally offers to confirm nodes whose
  _text_ defines the quantity, which is how upstream edges get wired. The
  downstream mirror — nodes that mention the quantity without designating it as
  an input — is derivable from the index's `byNode` text references, but it needs
  a new entry field, a second confirm path, and its own specs. Deferred: the
  downstream half of the card reads for now.

- **What an output with no consumers says.** **A plain statement and no action.**
  "Define X" has no downstream mirror worth offering — "add a node that uses
  this" is not a thing a reader wants a button for.

- **How drilling works.** **The cascade keeps flowing the way it started.** An
  upstream root drills definers → their inputs → those inputs' definers, as it
  does now. A downstream root drills consumers → their outputs → those outputs'
  consumers. Direction is a property of the whole cascade, not of a row: flipping
  it mid-tree makes "what am I looking at" unanswerable three levels down.

- **How many cards can be open.** **Any number, one per chip.** They are the
  reader's comparison set; capping it would take away the reason the feature
  exists.

- **What identifies a card.** **A cascade id assigned when it opens, plus the
  path within that cascade.** Quantity keys embed a NUL, which `CSS.escape`
  turns into U+FFFD rather than escaping, so a key cannot go in a selector — the
  chip refocus scan already works around this. A monotonic integer is
  selector-safe and doubles as the open-order stamp that dismissal needs.

- **Whether a quantity designated both ways gets one card or two.** **Two.** It
  appears as a chip in both columns, and under the direction rule those are two
  genuinely different questions. Identity is `(key, direction)`.

- **What closes a card.** **A press outside the designation section closes the
  most recently opened one; each card's own control closes that card; Escape
  closes the branch holding focus, then its root.** Closing them all on any stray
  press would destroy the comparison the feature is for.

- **What counts as "outside".** **Outside the whole designation section — chips
  and cards together.** The current guard exempts only the open card and the chip
  that opened it. Kept as-is with several cards open, opening a third would count
  as a press outside the second and close it on the way in, capping the reader at
  two cards forever.

- **What happens to a card whose quantity leaves the node.** **It stays until
  dismissed.** The card is a question the reader asked; answering it and then
  removing it because a designation was cycled off mid-read is the surprise this
  avoids. Today an effect drops the cascade in that case, and it goes.

- **Where the cards live in the DOM.** **A two-column grid in
  `NodeDetailsContent`, below the chips and matching their `1fr 1fr`.** Moving
  peek rendering inside `QuantityDesignationChips` would teach the chip component
  about cards, which it has stayed clear of across both surfaces that render it.

- **What happens on a narrow screen.** **One full-width column, stacked.** Two
  half-width columns of equations on a phone is unreadable; the chips' own
  columns are already tight there. The breakpoint is 640px, the one the edit
  sheet already uses.

## Out of scope (for this plan)

- Confirming an unconfirmed consumer from the output card, and the
  `textConsumerNodeIds` index field it needs.
- Any change to the input card's content: definers, text definers, the confirm
  action, and "Define X" all stay as they are.
- Peek on the edit-sheet surface, where a hold now writes the symbol into the
  text instead.
- Cards aligned horizontally with the individual chip that opened them. Chips
  wrap; only the column can line up.
- Dragging, reordering, or persisting the open set across a deep-zoom exit.

## Tasks

### T01 — Give a cascade a direction and let several coexist

|                |                                                                 |
| -------------- | --------------------------------------------------------------- |
| **Depends on** | —                                                               |
| **Wave**       | 1                                                               |
| **Agent**      | high-reasoning                                                  |
| **Effort**     | S                                                               |
| **Files**      | `lib/peekCascade.ts`, `lib/peekCascade.spec.ts`                 |
| **PR title**   | `feat(dataflow): let peek cascades carry direction and coexist` |

Add `direction: 'upstream' | 'downstream'` and a stable `id` to `PeekCascade`,
and a small collection API over them: open one for a `(key, direction)` that is
not already open, close by id, close the most recently opened, and read them back
in a caller-supplied chip order. The tree helpers — `isBranchOpen`,
`toggleBranch`, `closeBranch`, `isLoop` — are per-cascade and keep working
unchanged; only their caller changes.

Keep the collection pure and ordered explicitly: open order is what dismissal
needs, chip order is what rendering needs, and storing one and deriving the other
is what keeps them from disagreeing.

**Acceptance**

- Opening the same `(key, direction)` twice is idempotent; the same key in the
  other direction opens a second cascade.
- Closing the most recent returns the collection without it, and is a no-op on an
  empty collection.
- Reading in chip order puts cascades in the order their keys appear in a
  supplied list, and drops none when a key is absent from it — an orphan keeps
  its place rather than vanishing.
- `isLoop` still answers per cascade: the same quantity open upstream and
  downstream is not a loop.
- Ids are unique and increase with open order, so "most recent" needs no
  timestamp.
- No DOM types; nothing mutated in place.

### T02 — Make an output card look downstream

|                |                                                            |
| -------------- | ---------------------------------------------------------- |
| **Depends on** | T01                                                        |
| **Wave**       | 2                                                          |
| **Agent**      | high-reasoning                                             |
| **Effort**     | M                                                          |
| **Files**      | `QuantityPeekCard.svelte`, `NodeDetailsContent.svelte`     |
| **PR title**   | `feat(dataflow): answer an output peek with its consumers` |

A downstream card lists the nodes whose confirmed inputs include the quantity,
each with the jump the upstream rows already offer, then — only when there are
any — the _other_ nodes that define it, so a contradiction still surfaces where
the reader is looking. An upstream card is untouched.

Drilling follows the cascade's direction: a consumer row offers that node's
confirmed outputs as drill chips, the mirror of a definer row offering its
inputs. The loop marker, the "already open in this chain" title, and the
indentation all apply unchanged.

**Acceptance**

- An output chip's card lists confirmed consumers, in the index's sorted order,
  and says so plainly when there are none.
- Other definers appear below the consumers, never the current node, and the
  section is absent when nothing else defines the quantity.
- Drilling a consumer row opens a card for that node's output, which drills to
  _its_ consumers; the direction never flips within one cascade.
- An input chip's card renders exactly as before — definers, text definers,
  confirm, and "Define X" — proven by the existing stories still passing
  unchanged.
- A quantity with no consumers and no other definers still renders a card rather
  than nothing, so the gesture always visibly answers.

### T03 — Open several cards, in two columns

|                |                                                                |
| -------------- | -------------------------------------------------------------- |
| **Depends on** | T01, T02                                                       |
| **Wave**       | 3                                                              |
| **Agent**      | high-reasoning                                                 |
| **Effort**     | M                                                              |
| **Files**      | `NodeDetailsContent.svelte`, `QuantityDesignationChips.svelte` |
| **PR title**   | `feat(dataflow): open a peek card per symbol in two columns`   |

`NodeDetailsContent` holds a collection rather than one cascade, and renders it
as two columns below the chips: upstream cascades under the inputs, downstream
under the outputs, each in chip order, `1fr 1fr` to match the columns above and
one stacked full-width column below 640px.

Each card carries `data-peek-cascade` alongside its existing `data-peek-path`,
and every lookup that resolves a card or a drill chip is scoped by both — the
root path is `""` in every cascade, so without the id the first card answers for
all of them.

The dismissal rules:

1. A press outside the whole designation section closes the most recently opened
   cascade. Inside it — any chip, any card — closes nothing, which is what lets a
   third card open without dismissing the second.
2. Escape closes the branch holding focus, or that branch's root when focus is on
   a root card, leaving the rest open.
3. A card's own close control closes that cascade and returns focus to its chip.

`peekKey` on `QuantityDesignationChips` becomes the set of keys with a card open,
so a chip is marked while any of its cards is; the prop stays optional and the
edit sheet passes nothing, as now.

The effect that drops a cascade when its quantity leaves the node goes: an orphan
keeps its column position until dismissed.

**Acceptance**

- Right-clicking an input chip then an output chip leaves both cards open, both
  chips marked, one card per column.
- Opening a third card closes nothing.
- Cards appear in chip order, and stay in place when another is opened or closed.
- A press on the canvas outside the section closes the newest card only; four
  presses close four cards, newest first.
- Escape with focus in a nested card closes that branch; with focus on a root
  card it closes that cascade and leaves the others.
- Below 640px the columns stack into one full-width column, in input-then-output
  order.
- Cycling a designation off leaves its card open and in place.
- The same quantity confirmed as both input and output opens two cards, one per
  column, each answering its own direction.
- The edit sheet is untouched: no peek there, and the chips still insert.

### T04 — Cover the multi-card surface with stories

|                |                                                           |
| -------------- | --------------------------------------------------------- |
| **Depends on** | T03                                                       |
| **Wave**       | 4                                                         |
| **Agent**      | default workhorse                                         |
| **Effort**     | M                                                         |
| **Files**      | `NodeDetailsContent.stories.svelte`                       |
| **PR title**   | `test(dataflow): cover multiple peek cards and direction` |

Drive real gestures, reusing the existing `rightClickChip` and `holdChip`
helpers. Assert on what the reader sees — which cards exist, in which column,
in what order — rather than on the collection's shape.

**Acceptance**

- Story: two chips, two cards, one per column, both chips marked.
- Story: a third card opens without closing the second — the case the current
  dismissal guard would have made impossible.
- Story: an output card lists consumers and not the node's own definition.
- Story: an output whose quantity another node also defines shows that row; one
  where nothing else defines it shows no such section.
- Story: drilling a consumer row opens that node's output and drills downstream
  again.
- Story: outside presses close newest-first, one per press.
- Story: Escape closes the focused branch and leaves siblings open.
- Story: cards hold chip order across an unrelated open and close.
- Story: a cascade whose quantity is cycled off stays open.
- Story: the same quantity in both columns opens two independent cards.
- Manual browser smoke: the narrow-screen stack, real right-click and hold on
  touch, and a definition long enough to test the half-width column — the case
  that decides whether the two-column layout needs a horizontal scroll.

## Wave plan

```text
Wave 1   T01        (pure cascade collection and direction)
Wave 2   T02        (card content; depends on T01's direction)
Wave 3   T03        (state, layout, dismissal; depends on both)
Wave 4   T04        (stories)
```

Sequential by necessity: T02 and T03 both edit `NodeDetailsContent`, and T03's
dismissal rules only make sense once a card knows its direction.

## Risks and rollback

- **Half-width cards may not fit their content.** A definer row carries a
  rendered equation, a node title, drill chips, and buttons, and a nested card
  loses another 0.75rem per level up to four. If a real definition overflows, the
  cheap answers are a smaller indent in column mode or a horizontal scroll inside
  the card; the expensive one is abandoning the two-column layout. The manual
  smoke in T04 is what decides this, and it should happen before T03 is polished.
- **Dismissal is the part most likely to feel wrong.** Closing newest-first on an
  outside press means clearing four cards takes four presses, and a stray press
  in the details view erodes the set by one. The alternative — outside press
  clears all, Escape closes one at a time — is a one-line swap in T03 if it grates
  in use.
- **The root path collides across cascades.** Every root card serializes to `""`,
  and `rootCard()`, `drillChipFor`, and the Escape handler all resolve cards by
  that attribute today. Scoping every lookup by cascade id is not optional, and a
  missed one shows up as the wrong card closing.
- **Direction doubles the card's meanings.** A reader who learns "peek shows
  where it is defined" has to unlearn it for outputs. The hint line under the
  chips should say what each side answers rather than leaving it to be inferred.
- **Rollback is contained.** No schema, persistence, or graph mutation changes,
  and no edit-sheet changes. Reverting T02–T04 restores the single-cascade card;
  T01 stands alone.

## Definition of Done (this plan)

- T01–T04 acceptance criteria are satisfied and committed with the drafted
  Conventional Commit titles.
- `pnpm --filter mind-map-sv lint` passes.
- `pnpm --filter mind-map-sv check` passes with 0 errors and 0 warnings.
- `pnpm --filter mind-map-sv test:unit -- --run` passes.
- `pnpm --filter mind-map-sv test:e2e` passes as a regression gate.
- The manual smoke in T04 passes, including the narrow-screen stack.
- `apps/mind-map-sv/static/offline-app-shell.html` is regenerated in its own
  `chore(build)` commit.
- No edit-sheet, schema, persistence, or graph mutation changes.
- Plan status is `done`.

## Notes

- 2026-08-28: Reported as a bug — right-clicking an input then an output left one
  card, on the output, in the input's place. Reproduced in the app and found to
  be the design: `PeekCascade` carries a single `rootKey`, and the card renders
  full-width below both columns, so a replacement reads as the first card
  mutating. This plan is the feature that report implies.
- 2026-08-28: The hierarchy the request asked for already exists — drilled cards
  are separate cards, indented 0.75rem per level and capped at four. Only
  multiple roots and the two-column layout are new.
- 2026-08-28: `consumerNodeIds` is already on `QuantityIndexEntry`, so the
  downstream card needs no index change. Its unconfirmed mirror is not, and is
  the reason confirming a consumer is out of scope.
- 2026-08-29: Executed. The manual smoke earned its place in the plan twice.

  **The half-width question is answered: the columns fit.** A definition as
  awkward as `g = \frac{G M_{earth}}{r^2} + \delta_{tidal}` renders complete in
  a column at a 1280px viewport, and full width when the layout stacks below the
  breakpoint. No horizontal scroll and no reduced indent were needed, so the
  contingencies the risk section listed go unused.

  **And it caught what the stories could not.** The root card was absolutely
  positioned below the chips — correct for one card, wrong the moment there were
  several: every card landed at the same offset, stacked over the others, while
  its column collapsed to zero height. Two cards were in the DOM, in the right
  columns, in the right order, with the right directions, and one was visible.
  Every story passed throughout, because they assert structure and order rather
  than geometry.

- 2026-08-29: The first draft of the multi-card stories was vacuous and passed
  against the unfixed guard. They opened cards with a bare `contextmenu`, and the
  dismissal listener is on `pointerdown`, so the guard under test never ran.
  Caught by narrowing the guard back and finding the stories still green. With
  the full right-click they fail as they should: three right-clicks leave one
  card where three were asked for, which is the two-card cap the guard exists to
  prevent.

- 2026-08-29: Four existing stories asserted the old semantics for an output
  chip and were adapted. The one covering the reported `$y = 1$` bug now guards
  it from the other side — the card is asserted to say what uses y and
  specifically not to claim nothing defines it. The self-confirm offer that
  fixture also covered has no home on a downstream card, so confirming your own
  unconfirmed definition from a peek is no longer reachable; tap-to-cycle still
  does it, and confirming another node's text definition still works from an
  input card. Restoring it under its own heading is a small follow-up if the loss
  is felt.
