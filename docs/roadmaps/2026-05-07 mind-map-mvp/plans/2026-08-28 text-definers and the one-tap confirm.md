# Plan: Text-definers and the one-tap confirm

**Created:** 2026-08-28
**Author:** Claude agent
**Milestone:** none — a bug-fix follow-up on the manual-dataflow work that sits
on top of [milestone 09](../milestones/09-variable-dataflow-layer.md) and
[milestone 11](../milestones/11-unified-hop-model-for-derived-edges.md), and
directly on [the chip-cycling and define-flow plan](<./2026-08-28 deep-zoom chip cycling and the define flow.md>).
Reported from using that feature; no milestone doc of its own.
**Status:** executing
**Total estimated effort:** M

## Summary

A node titled `$y = 1$` opened its own peek card and was told
"Nothing defines y yet." — and offered to define it. The index's
`definerNodeIds` holds only **confirmed** outputs, so a symbol whose only
definers are parsed-but-unconfirmed rendered the empty-definers state. This plan
gives the index a **text-definers** facet, shows those definers as unconfirmed
ghost rows with a one-tap confirm, and teaches the diagnostics the same
in-between state.

## The bug family

One root cause, four symptoms:

1. **The misleading empty peek.** "Nothing defines y yet." over an equation that
   plainly defines y.
2. **The duplicate trap (worse).** That empty state offers "Define y", and taking
   the offer creates a _second_ node saying what the first already says.
3. **The same lie in the diagnostics.** "is not defined anywhere", with the same
   Define button beside it.
4. **A blank output ghost.** Peeking an output the reader's own equation defines
   answered with the empty state.

## Open questions resolved

- **Where the facet lives.** **On `QuantityIndexEntry`, as a mirror of the
  confirmed pair** (`textDefinerNodeIds` + `textDefinitions`, same record shape,
  same sort). A separate lookup would have to be recomputed by every caller that
  already holds an entry.
- **Whether the new fields are optional.** **Required.** The compiler then finds
  every hand-built fixture, which is where a missed construction site would
  otherwise show up as a runtime blank.
- **Whether a text definer is tracked.** **No.** `isTracked` /
  `trackedQuantities` / `deriveDataflowEdges` are untouched: an equation nobody
  confirmed still draws no chip on the canvas and no edge. Pinned with specs.
- **What a confirmed-and-written node is.** **A definer, once.** The index
  subtracts the confirmed set out of the text set, so a node never appears on
  both lists and confirming _moves_ its row rather than duplicating it.
- **How confirm mutates.** **A new `designateAs`, never `cycleDesignation`.**
  See the correctness catch below.
- **Whether the diagnostics split `unconfirmed` on visibility.** **No.** The
  repair is a confirmation the reader makes from where they are, so whether the
  writer is on screen changes nothing about what to do next.
- **Whether an output ghost gets a diagnostics item.** **No.** Symptom 4 is
  fixed by the peek card; the diagnostics report confirmed claims only.

## The correctness catch (do not use the cycle to confirm)

`cycleDesignation(io, sym, 'output')` treats the _input_ column as the terminal
state, so a node that currently has the symbol confirmed **as an input** —
reachable in two taps from any ghost chip — would be **unassigned** by a
"confirm" built on the cycle. `designateAs` drops the key from both columns and
appends to the target, which is idempotent by construction. The spec asserts the
two side by side; that assertion is the tripwire.

## Out of scope (for this plan)

- Drill lines on unconfirmed rows staying confirmed-only. They already are: a
  drill line reads the _row node's_ confirmed inputs, and showing those under an
  unconfirmed row is correct (facts are facts). A second row-kind would be worse.
- Conflict reporting. A conflict needs ≥2 confirmed bodyKeys, so it cannot
  co-occur with `unconfirmed`.
- Any change to what the canvas draws.

## Tasks

All paths relative to `apps/mind-map-sv/src/lib/components/ui/`.

### T1 — Index facet (pure)

|                |                                                    |
| -------------- | -------------------------------------------------- |
| **Depends on** | —                                                  |
| **Wave**       | 1                                                  |
| **Effort**     | S                                                  |
| **Files**      | `Multigraph/lib/quantityIndex.ts` (+ spec)         |
| **PR title**   | `feat(dataflow): index who writes a quantity down` |

`QuantityIndexEntry` gains required `textDefinerNodeIds: string[]` and
`textDefinitions: QuantityDefinitionRecord[]`. `entryFor` seeds `[]`; the
extraction pass pushes a record per parsed define (guarded on the opt-out tag —
belt and braces, extraction already returns empty for an opted-out node); the
final sort loop subtracts the confirmed set, sorts both record lists through one
module-level `byNodeThenBody`, and derives the ids as distinct-and-sorted.

**Acceptance**

- The facet is a pure function of (extraction, confirmed outputs), so the
  existing dual signatures still cover it and confirming does **not** re-extract.
- `isTracked` / `trackedQuantities` / `deriveDataflowEdges` unchanged, pinned.

### T2 — `designateAs` (pure)

|                |                                                   |
| -------------- | ------------------------------------------------- |
| **Depends on** | —                                                 |
| **Wave**       | 1 (parallel with T1)                              |
| **Effort**     | XS                                                |
| **Files**      | `Multigraph/lib/quantityDesignations.ts` (+ spec) |
| **PR title**   | `feat(dataflow): add an idempotent designateAs`   |

`designateAs(io, symbol, role)` — `withoutKey` both columns, append to the
target. The doc says why it is not the cycle.

**Acceptance**

- Assigns unassigned, moves input→output and output→input, collapses repeats,
  preserves other entries' order.
- **Idempotent exactly where the cycle unassigns**, asserted side by side.

### T3 — Peek card rows (render; fixes symptoms 1, 2 and 4)

|                |                                                             |
| -------------- | ----------------------------------------------------------- |
| **Depends on** | T1                                                          |
| **Wave**       | 2                                                           |
| **Effort**     | M                                                           |
| **Files**      | `Multigraph/QuantityPeekCard.svelte`, its stories           |
| **PR title**   | `fix(dataflow): show unconfirmed definers in the peek card` |

Unify the list into `DefinerRow {nodeId, confirmed, definitions}` = confirmed
rows then text rows. `data-peek-definer-state="confirmed"|"unconfirmed"` on each
`li`; the existing `[data-peek-definer]` selectors keep working. Unconfirmed
rows render through the same `MathText` path and take the ghost treatment. The
empty state becomes `rows.length === 0`, which is the single change that closes
the duplicate trap.

**Acceptance**

- **`{#each}` keyed on `row.nodeId` alone.** A composite key would tear the row
  down on confirm, taking any nested cascade, scroll and focus with it.
- "Go to node" on both row kinds except the current node's row.
- The `titleForNodeId` fallback stays confirmed-only by construction.

### T4 — One-tap confirm (mutation)

|                |                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T2, T3                                                                                                                |
| **Wave**       | 3                                                                                                                     |
| **Effort**     | S                                                                                                                     |
| **Files**      | `Multigraph/QuantityPeekCard.svelte`, `Multigraph/NodeDetailsContent.svelte`, `Multigraph/Multigraph.svelte`, stories |
| **PR title**   | `feat(dataflow): confirm a definer from the peek card`                                                                |

New prop `onConfirmDefiner?: (definerNodeId, quantityKey) => void`, threaded
NodeDetailsContent → PeekCard → the recursive `<PeekCard>`. The key rather than
the symbol matches the `onCreateDefiningNode` precedent and lets the diagnostics
reuse it. The control renders on unconfirmed rows only, **after** "Go to node"
in the DOM. `Multigraph.confirmDefinerOutput` resolves the symbol off the index
and commits `setNodeDesignations(…, designateAs(…, 'output'))` through
`commitContentGraph`.

**Acceptance**

- Callback absent ⇒ no control, mirroring Define.
- Reactivity is free (commit → new graph → new index → `peekEntry` re-reads);
  the cascade-close effect needs no change.
- The first affordance that mutates a **non-focused** node. Confirming may
  surface a conflict diagnostic immediately, which is correct.

### T5 — Diagnostics (fixes symptom 3)

|                |                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T1, T4                                                                                                                                      |
| **Wave**       | 4                                                                                                                                           |
| **Effort**     | S                                                                                                                                           |
| **Files**      | `Multigraph/lib/dataflowDiagnostics.ts`, `Multigraph/lib/nodeDiagnosticsView.ts`, `Multigraph/NodeDetailsContent.svelte` (+ specs, stories) |
| **PR title**   | `fix(dataflow): report a written-but-unconfirmed quantity as such`                                                                          |

New `ReferenceState` `'unconfirmed'`; `ReferenceDiagnostic` gains
`textDefinerNodeIds`. `referenceState`: confirmed definers → resolved/out-of-view
unchanged, else text definers → `unconfirmed`, else `unresolved`. The view's
state union picks it up through `Exclude<ReferenceState, 'resolved'>`;
`STATE_ORDER` puts `unconfirmed` first (most-actionable-first). The details view
gets the copy, a `data-confirm-definer` control beside each related node, and
informational grey rather than the unresolved amber.

**Acceptance**

- The Define predicate stays `state === 'unresolved'`, with a comment saying why
  so nobody widens it back.
- `nodeIds` for `unconfirmed` are the text definers.

## Wave plan

```
Wave 1   T1  ‖  T2      (both pure, independent)
Wave 2   T3              (shippable alone: fixes the reported bug + the trap)
Wave 3   T4
Wave 4   T5
```

## Gates

`pnpm --filter mind-map-sv lint` · `check` (0/0) · `test:unit -- --run` (both
projects) after T3 and at the end, then `build` +
`scripts/check-offline-shell-fresh.mjs`. The regenerated shell gets its own
`chore(build):` commit.

## Risks and rollback

- **The cycle-vs-assign trap.** T2 exists for it; the side-by-side spec is the
  tripwire.
- **Row keying.** `nodeId` alone, or confirming tears down nested cascades.
- **Mount focus** may land on the confirm button for a self-row card. Focus is
  not activation; story-pinned.
- **Confirming can immediately surface a conflict.** Correct, and commented.
- **Fixture churn from the required fields is deliberate** — type-forced
  discovery. Keep the T1 story edits mechanical; behavior changes live in T3+.

## Definition of Done (this plan)

- All five tasks landed, with a spec for each pure change and a story `play` for
  each component behavior.
- Lint, check and both vitest projects green; build succeeds and the offline
  shell reports fresh.
- Manual browser smoke: the literal repro, confirm-from-peek wiring an edge
  live, and the diagnostics copy for an unconfirmed input.

## Notes

- 2026-08-28: **T1–T5 landed** in one working tree, in order.
  `quantityIndex` gained `textDefinerNodeIds` / `textDefinitions` (both
  **required**) and a module-level `byNodeThenBody` now shared by `definitions`
  and `textDefinitions`; the confirmed set is subtracted in the same sort loop.
  `quantityDesignations` gained `designateAs`. `QuantityPeekCard` renders one
  `DefinerRow[]` keyed on `row.nodeId`, stamps
  `data-peek-definer-state`, fades unconfirmed rows to the ghost chip's exact
  `color`/`opacity`, and offers `button.confirm[data-peek-confirm]` after "Go to
  node". `NodeDetailsContent` threads `onConfirmDefiner` to the card and renders
  `button.confirm[data-confirm-definer]` beside each related node of an
  `unconfirmed` diagnostic. `Multigraph.confirmDefinerOutput` is the mutation.
- 2026-08-28: Story-fixture churn from the required fields hit exactly one file,
  `NodeDetailsContent.stories.svelte` (four hand-built entries and `entryOf`,
  which now takes a third `textDefiners` argument). Nothing else constructs a
  `QuantityIndexEntry`.
- 2026-08-28: The `unconfirmed` state deliberately does **not** split on
  visibility, and there is deliberately no diagnostics item for an unconfirmed
  _output_ ghost — the peek card is where that reads.
- 2026-08-28: Gates — both vitest projects green at **1488** tests (1441
  baseline + 17 `quantityIndex` + 8 `quantityDesignations` + 6
  `dataflowDiagnostics` + 5 `nodeDiagnosticsView` + 8 `NodeDetailsContent`
  stories + 3 `Multigraph` stories), `svelte-check` 0/0, `eslint` and Prettier
  clean, `pnpm --filter mind-map-sv build` succeeds and
  `check-offline-shell-fresh.mjs` reports fresh. Still unrun: `test:e2e` and the
  manual browser smoke. Nothing is committed; the regenerated
  `static/offline-app-shell.html` awaits its own `chore(build):` commit.
