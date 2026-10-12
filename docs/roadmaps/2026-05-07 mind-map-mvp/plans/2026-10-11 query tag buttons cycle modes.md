# Plan: Query tag buttons cycle focus, spotlight and exclude

**Created:** 2026-10-11
**Author:** Claude agent
**Milestone:** none — extends [milestone 05](../milestones/05-filter-find-search.md) (Find / Filter panel)
**Status:** done
**Total estimated effort:** M

## Summary

Make each node-tag and edge-tag button in the Find / Filter panel a four-state
toggle for its own query token — none → `#tag` → `+#tag` → `-#tag` → none — that
edits the typed query surgically and shows which state it is in. Today the
buttons can only ever append a plain focus token, so the only way to spotlight,
exclude or remove a tag is to retype the query by hand.

## The problem this solves

Paths below are relative to `apps/mind-map-sv/src/lib/components/ui/Multigraph/`.

- **A click only ever appends.** Both button groups call
  `appendToken('#tag')` / `appendToken('@tag')` (`GraphQueryPanel.svelte:120`,
  `:143`), and `appendToken` is `${query.trim()} ${token}` (`:39-41`). A second
  click adds a duplicate `#tag`; nothing removes one, and nothing reaches the
  `+` or `-` modes the grammar supports.
- **The buttons have no state.** Each renders a swatch plus the literal
  `{marker}{tag}` (`:126-127`, `:149-150`) whatever the query holds. The parsed
  chips list does show modes, styled by `[data-mode]` (`:76-82`, `:238-244`),
  but it is read-only and lives in a different place.
- **Editing in place needs positions the parser throws away.**
  `parseGraphQuery` walks the input by index (`lib/graphQuery.ts:47-106`) but
  emits only `{ mode, target, value }` (`:13-17`). Without source ranges the
  only way to change one token is to regenerate the query from tokens, which
  would discard the user's spacing, ordering and any text that parsed to
  nothing (an empty `""`, a bare `#`).
- **The panel has no stories of its own.** There is no
  `GraphQueryPanel.stories.svelte`; the panel is only reached through
  `Multigraph.stories.svelte` (`UserFiltersGraphByNodeTag` `:5315`,
  `UserSpotlightsNodeTagWithMatchedColor` `:5398`,
  `UserExcludesNodeTagWithoutRelayout` `:5463`, `UserNavigatesQueryRegions`
  `:5507`), and every one of those types into the input — no story clicks or
  hovers a tag button.

## Open questions resolved

- **What a click does.** **It cycles that tag's token through four states:
  none → `#tag` (focus) → `+#tag` (spotlight) → `-#tag` (exclude) → none.**
  Edge tags cycle identically with the edge marker (`@`). The order is the
  grammar's own escalation — show it, emphasise it, hide it, forget it — so one
  button reaches every mode with no second control.

  > **Superseded 2026-10-11 (owner request, same day):** the cycle skips plain
  > focus — none → `+#tag` → `-#tag` → none — and a tag with no token appends
  > the spotlight token. A hand-typed `#tag` still counts as in the query and
  > steps on to `+#tag`. The hover/focus preview resolution below is superseded
  > with it. See the Notes addendum and
  > `docs/ui-decisions/2026-10-11--pointer--a-tag-button-cycles-spotlight-and-exclude-and-hover-previews-the-next-click.md`.

- **How the query is edited.** **Surgically, by source range.**
  `GraphQueryToken` gains `start` and `end`: a half-open index range into the
  input covering the `+`/`-` prefix when present, the marker or opening quote,
  the value, and the closing quote when present, so
  `input.slice(token.start, token.end)` is exactly what was typed. The parser
  already tracks `index` through the prefix check (`lib/graphQuery.ts:61-69`)
  and every reader returns `nextIndex` (`:377-433`), so this is bookkeeping:
  capture `start` before the prefix check, set `end` to `parsed.nextIndex` at
  each of the three pushes (`:75`, `:88-92`, `:100`). Empty tokens that push
  nothing (`""`, `#`, `+#`) keep no range, so the cycle never touches them.

- **Where the cycling lives.** **A new pure module `lib/queryTokenCycle.ts`
  with a colocated spec**, not more code in `lib/graphQuery.ts` (461 lines,
  owning parse, evaluate and regions). It exports exactly what the panel
  imports: `tagTokenMode`, `cycleTagToken` and `tagTokenText` (below). Both
  functions take `target: 'nodeTag' | 'edgeTag'` and a `tagSyntax` parameter
  defaulting to `DEFAULT_TAG_SYNTAX` (`lib/titleSyntax.ts:42`), per the
  tunables-as-parameters convention.

- **What counts as "the same tag".** **One definition, shared with
  evaluation.** `matchingTag` compares through `normalize`
  (`toLocaleLowerCase`, `lib/graphQuery.ts:330-333`, `:369-371`). T02 extracts
  that comparison as an exported `tagNamesMatch(a, b)` in `graphQuery.ts`,
  which `matchingTag` then calls, and the cycle module uses it too. If the
  button and the graph disagreed about whether `#Lab` is `lab`, the button
  would light up for a token that matches nothing, or vice versa.

- **The cycle rule, exactly.** **`cycleTagToken(query, target, tag)`**:
  1. Find every parsed token with that `target` whose value
     `tagNamesMatch`es `tag`. Text tokens (including a quoted `"#lab"`) and
     add-on tokens never match.
  2. The current mode is the **effective** mode: `exclude` if any match is an
     exclude token (evaluation gives exclusion precedence regardless of order,
     `lib/graphQuery.ts:298-302`), otherwise the mode of the **last** match, or
     `null` if there is none. Next mode: `null → focus → spotlight → exclude →
null`. Reading the effective mode keeps the button and the graph in
     agreement for a hand-typed `-#lab #lab`: both say excluded.
  3. Remove every match except the last by splicing out its range, applying the
     whitespace rule below. Splice right to left so earlier ranges stay valid.
  4. If the next mode is non-null, replace the last match's range with
     `tagTokenText(nextMode, target, tag)` — no whitespace changes, since the
     token is written where the user put it. If the next mode is null, remove
     the last match too.
  5. If there was no match, append the new focus token: `query + token` when
     `query` is empty or already ends in whitespace, otherwise
     `query + ' ' + token`. Unlike today's `appendToken`, the query is **not**
     trimmed — the user's text is never rewritten outside the token's own range.

  The written token uses the **button's spelling** of the tag (the legend's
  `tag.tag`), since that is what the user clicked; a typed `#LAB` cycled once
  becomes `+#lab`.

- **The whitespace rule for a removal.** **Collapse only the gap the token
  leaves behind.** For a removed range: (a) if it is preceded by whitespace or
  the start of the input and followed by whitespace, also delete the whitespace
  run after it; (b) otherwise, if nothing but end of input follows it, delete
  the whitespace run before it; (c) otherwise (it touches another token, as in
  `#a#lab #b`), delete nothing extra. So `#a #lab #b` → `#a #b`,
  `#a  #lab  #b` → `#a  #b` (the user's double space before is kept),
  `#a #lab` → `#a`, `#lab #a` → `#a`, `#a#lab #b` → `#a #b`, `hello#lab` →
  `hello`, and `#lab` → the empty string.

- **What the button shows.** **`tagTokenMode(query, target, tag)` returns the
  current mode or `null` (step 2 above), and the button renders from it.** Its
  visible label is the token as it would be typed: `#lab`, `+#lab`, `-#lab`;
  with no token it reads `#lab` as today. `tagTokenText(mode, target, tag)`
  builds that string (`+`/`-` prefix from the mode, marker from `tagSyntax`)
  and is the same function the cycle writes with, so the label and the query
  cannot drift.

- **How "none" and "focus" are told apart, since both read `#lab`.**
  **`aria-pressed`, `data-mode`, and a visible treatment that does not rely on
  hue alone.** `aria-pressed="false"` and `data-mode="none"` with no token;
  `aria-pressed="true"` and `data-mode="focus" | "spotlight" | "exclude"`
  otherwise. Styling extends the existing `.tag-list button` rule
  (`GraphQueryPanel.svelte:280-287`) and reuses the chip palette
  (`:229-244`): none keeps today's `#f8fafc` fill and `#cbd5e1` border; every
  pressed mode gets a `#0f172a` border and semibold label; focus fills
  `#e2e8f0`, spotlight `#fef3c7`, exclude `#fee2e2` with the label struck
  through. The border weight is the non-colour cue between none and focus; the
  `+`/`-` prefix is the cue between the other modes.

- **Accessible name.** **`Node tag lab, <state>` / `Edge tag rel, <state>`,
  set with `aria-label`**, where `<state>` is `not in query`, `in focus`,
  `spotlighted` or `excluded`. "Focused" is avoided because screen readers
  already announce "focused" for keyboard focus, and "Node tag lab, focused"
  would read as a statement about the caret. The name contains the speakable
  part of the visible label (`lab`), so voice control still finds it.

- **Hover and keyboard-focus preview.** **Never preview an exclude, and never
  preview over an existing token.** A tag with no token previews `+#tag`
  exactly as today (`previewToken`, `GraphQueryPanel.svelte:43-45`, wired at
  `:121`/`:123` and `:144`/`:146`); a tag that already has a token previews
  nothing (`previewToken(null)`). The preview is deliberately not "what the
  next click would do": a separate plan makes excluded nodes leave the layout
  (today they keep their place — milestone 05, "excluded: not rendered, but
  still participates in layout"), so previewing an exclude on hover would
  reflow the graph under the pointer. Note this narrows today's code, which
  appends `+#tag` unconditionally: over an existing `#tag` that turns the
  token into a spotlight for the duration of the hover, and over `-#tag` it
  does nothing visible because exclusion wins
  (`lib/graphQuery.ts:298-302`). Showing nothing is the honest preview once the
  user has chosen a state.

  > **Superseded 2026-10-11 (owner request, same day):** hover and keyboard
  > focus now preview exactly what the next click would do — the whole query
  > `cycleTagToken` would produce — including an exclusion, whose nodes leave
  > the layout while hovered. The owner accepted that reflow ("show how it will
  > look if clicked"). See the Notes addendum.

- **What happens to the preview after a click.** **Nothing new — it is already
  cleared.** `Multigraph.svelte` sets `graphQueryPreviewText = null` on every
  committed query change (`:3797-3800`), and `activeGraphQueryText` falls back
  to the committed text (`:1056`). After `exclude → none` the pointer is still
  over a button whose tag now has no token, but no preview appears until the
  pointer leaves and re-enters. Accepted: the click just removed the tag, and
  re-spotlighting it under the pointer would contradict that.

  > **Still holds after the 2026-10-11 revision**, and matters more: the click
  > commits the previewed text verbatim, so the canvas does not move on the
  > click, and not re-previewing afterwards keeps a spotlight → exclude click
  > from immediately previewing the removal and bringing the nodes straight
  > back under the pointer.

- **No hint line explaining the cycle.** **None.** The label changes on every
  click (`#lab` → `+#lab` → `-#lab` → `#lab`), which teaches the cycle in the
  act of using it, and the panel's placeholder already shows the `+` and `-`
  syntax (`GraphQueryPanel.svelte:71`).

## Out of scope (for this plan)

- **Buttons for add-on tokens** (`!task`, `!ai`). The legend that feeds the
  buttons (`collectLegendTags`, `lib/tagColors.ts:78-83`) has no add-ons; adding
  a third button group is its own change.
- **Clicking or removing a chip in the parsed-tokens list**
  (`GraphQueryPanel.svelte:76-82`). Offsets make it cheap later — a remove is
  one splice through the same whitespace rule — but it is a separate
  interaction with its own affordance question.
- **Cycling backwards.** The repo's second-action triple (hold, right-click,
  Shift+Enter — `docs/ui-decisions/2026-08-28--pointer--hold-right-click-and-shift-enter-for-a-second-action.md`)
  would be the way to add it; not needed until someone misses it.
- **Making excluded nodes leave the layout.** That is the separate plan this
  one's hover rule defends against; nothing here depends on it landing.
- **Reconciling "last token wins" with "exclusion wins".** See Risks.

## Tasks

> Each task is one PR's worth of work. Paths are relative to
> `apps/mind-map-sv/src/lib/components/ui/Multigraph/` unless they start with
> `docs/`.

### T01 — Record each query token's source range

|                |                                                              |
| -------------- | ------------------------------------------------------------ |
| **Depends on** | —                                                            |
| **Wave**       | 1                                                            |
| **Agent**      | default (opus)                                               |
| **Effort**     | S                                                            |
| **Files**      | `lib/graphQuery.ts`, `lib/graphQuery.spec.ts`                |
| **PR title**   | `feat(graph-query): record each parsed token's source range` |

Add `start: number` and `end: number` to `GraphQueryToken`
(`lib/graphQuery.ts:13-17`) with a doc comment stating the half-open range and
the `slice` round-trip. In `parseGraphQuery`, capture `start` at the top of the
loop body after whitespace skipping (before the `+`/`-` check at `:61-69`) and
set `end = parsed.nextIndex` at each push (`:75`, `:88-92`, `:100`).

The existing parse specs compare whole tokens with `toEqual`
(`lib/graphQuery.spec.ts:31-43`, `:47-61`, `:236-242`, `:246-248`,
`:252-255`, `:259-266`, `:270-272`); switch those to `toMatchObject`, which
still checks array length and every listed field. Evaluation results carry the
tokens too (`GraphQueryResult.tokens`), but no spec compares them whole.

**Acceptance**

- New spec: for each of a set of queries — the existing mixed query
  `+@edgy +#nodal@link #dialog-#modal -@edgo Some words "and a phrase"`, a
  quoted phrase with inner spaces, an unclosed quote, adjacent tokens with no
  whitespace (`hello#lab`, `#a#b`), a configured-marker query — every token
  satisfies `query.slice(t.start, t.end)` equals the raw typed token, and for
  tag tokens equals prefix + marker + value.
- New spec: `""`, `#` and `+#` produce no token and so no range.
- Every existing `graphQuery.spec.ts` case passes, including the 1000-node
  perf budget.

### T02 — Pure tag-token cycle and mode lookup

|                |                                                                                      |
| -------------- | ------------------------------------------------------------------------------------ |
| **Depends on** | T01                                                                                  |
| **Wave**       | 2                                                                                    |
| **Agent**      | default (opus)                                                                       |
| **Effort**     | S                                                                                    |
| **Files**      | new `lib/queryTokenCycle.ts`, new `lib/queryTokenCycle.spec.ts`, `lib/graphQuery.ts` |
| **PR title**   | `feat(graph-query): cycle a tag's query token through focus, spotlight and exclude`  |

In `lib/graphQuery.ts`, export `tagNamesMatch(a, b)` (the `normalize`
comparison) and route `matchingTag` (`:330-333`) through it. In the new module,
implement `tagTokenText`, `tagTokenMode` and `cycleTagToken` exactly as the
"cycle rule" and "whitespace rule" resolutions specify. Export nothing else —
knip fails on unused exports, and the panel is the only caller.

**Acceptance** — `queryTokenCycle.spec.ts` covers:

- The full cycle from an empty query: `''` → `#lab` → `+#lab` → `-#lab` →
  `''`, and the same for an edge tag with `@`.
- A tag inside a longer typed query: `"lab notes" #a +#lab x` cycles to
  `"lab notes" #a -#lab x` and then to `"lab notes" #a x`; every other
  character is unchanged.
- A tag appearing twice with different modes: `-#lab #b #lab` reads as
  `exclude` (exclusion wins) and one click gives `#b` — both tokens are
  removed. `#lab #b +#lab` reads as `spotlight` (last wins among non-exclude
  tokens) and one click gives `#b -#lab` — the earlier `#lab` is removed and
  the new token sits where the last one was.
- Whitespace preservation: each example in the whitespace rule, plus a
  trailing space the user is still typing after (`#a ` → `#a #lab`).
- Case-insensitive matching: `#LAB` is found by tag `lab`, cycles to `+#lab`;
  a second legend spelling (`Lab`) sees the same mode.
- Untouched neighbours: a quoted `"#lab"`, the bare word `lab`, `!lab` and
  `@lab` (when cycling the node tag) all survive every step.
- `tagTokenMode` returns `null` for an absent tag, `exclude` when any
  matching token excludes, and the last matching token's mode otherwise;
  `tagTokenText` honours a configured `tagSyntax`.
- Round-trip: parsing every output of `cycleTagToken` yields exactly one
  token for the tag (or none after `exclude`), with the expected mode.

### T03 — Wire the cycle into the panel, with panel and canvas stories

|                |                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T02                                                                                                                              |
| **Wave**       | 3                                                                                                                                |
| **Agent**      | default (opus)                                                                                                                   |
| **Effort**     | M                                                                                                                                |
| **Files**      | `GraphQueryPanel.svelte`, new `GraphQueryPanelHarness.svelte`, new `GraphQueryPanel.stories.svelte`, `Multigraph.stories.svelte` |
| **PR title**   | `feat(query-panel): tag buttons cycle their token and show its mode`                                                             |

In `GraphQueryPanel.svelte`:

- Replace `appendToken` (`:39-41`) with a `cycleTag(target, tag)` that calls
  `updateQuery(cycleTagToken(query, target, tag, tagSyntax))`. Delete
  `appendToken` — nothing else uses it.
- Derive each button's mode with `tagTokenMode`, and render the label via
  `tagTokenText`, `aria-pressed`, `data-mode` and `aria-label` per the
  resolutions. Both `{#each}` blocks (`:117-129`, `:140-152`) get the same
  treatment; factor a snippet if it keeps them identical.
- Gate the preview: `onmouseenter`/`onfocus` call `previewToken('+…')` only
  when the mode is `null`, else `previewToken(null)`. `previewToken` itself
  (`:43-45`) is unchanged.
- Add the `[data-mode]` button styles next to `.tag-list button`
  (`:280-287`).

New `GraphQueryPanelHarness.svelte`, following the `NodeEditSheetHarness.svelte`
pattern (a doc comment saying what it supplies, state in `$state`, results as
`data-*` attributes): takes a `MultigraphData` and an `initialQuery`, holds
`query` and `preview` in `$state`, passes `collectLegendTags(graph)` and
`evaluateGraphQuery(graph, preview ?? query)` to the panel, feeds
`onQueryChange` / `onPreviewQueryChange` back into its state, and renders
`data-query` and `data-preview` on a wrapper. The panel is controlled, so a
`fn()` spy as in `TagColorLegend.stories.svelte` cannot carry a query across
four clicks.

New `GraphQueryPanel.stories.svelte` (title `Components/Multigraph/GraphQueryPanel`):

- `UserCyclesNodeTagThroughEveryMode` — clicks the `lab` button four times,
  asserting after each click `data-query` (`#lab`, `+#lab`, `-#lab`, `''`),
  the button's `aria-pressed`, `data-mode`, visible label and accessible name.
- `UserCyclesEdgeTagWithEdgeMarker` — the same for an edge tag, at least
  through `@rel` and `+@rel`.
- `CyclingEditsOnlyThatTagInATypedQuery` — starts from
  `"lab notes" #a +#lab x`, clicks once, asserts
  `"lab notes" #a -#lab x`.
- `HoverPreviewsSpotlightOnlyForATagNotInTheQuery` — `mouseenter` on an
  absent tag sets `data-preview` to the query plus `+#tag`; on a tag already
  in the query `data-preview` stays empty; `mouseleave` clears it.

In `Multigraph.stories.svelte`, add `UserCyclesNodeTagButtonIntoQuery` beside
`UserFiltersGraphByNodeTag` (`:5315`), reusing its graph and its helpers
(`getNodeWrapper` `:145`, `sleep` `:329`, `waitForLayout` `:333`): open
Find / Filter, click the `topic` button, assert `n0`/`n1` have
`data-query-role="focus"` and `n2` `background`; click again, assert
`spotlight` on `n0`/`n1`. It stops before exclude on purpose, so it does not
couple to the separate plan that changes what exclude does to layout.

**Acceptance**

- All four panel stories and the canvas story pass in the `storybook` Vitest
  project; every existing `Multigraph.stories.svelte` query story still
  passes unchanged (none of them touch the buttons).
- Keyboard: Tab to a tag button, Enter and Space each advance the cycle.
- `knip` clean: the harness is imported by the stories, and
  `appendToken` is gone.

### T04 — Update milestone 05 and record the ruling

|                |                                                                                                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T03                                                                                                                                                                                            |
| **Wave**       | 4                                                                                                                                                                                              |
| **Agent**      | fast/cheap                                                                                                                                                                                     |
| **Effort**     | XS                                                                                                                                                                                             |
| **Files**      | `docs/roadmaps/2026-05-07 mind-map-mvp/milestones/05-filter-find-search.md`, new `docs/ui-decisions/2026-10-11--pointer--a-tag-button-cycles-its-token-and-hover-never-excludes.md`, this plan |
| **PR title**   | `docs(milestone-05): describe cycling tag buttons`                                                                                                                                             |

- Milestone 05: rewrite the suggestions bullet (line 89, "Node-tag and
  edge-tag suggestions sourced from the existing tag legend data.") to say
  each suggestion is a button that cycles its tag's token none → focus →
  spotlight → exclude → none and shows the current mode; rewrite the hover
  bullet (lines 93-95) to say it spotlights only a tag not already in the
  query; amend the matching acceptance line (134). Add a line under the
  header linking this plan as a follow-up. Leave the milestone's status
  `complete`.
- Write the ui-decisions ruling in the directory's format (Situation /
  Proposed / Chosen / Why / Pattern / Status), recording the cycle order and
  the "hover never previews exclude" rule with its layout-reflow reason.
- If any `src/**` change has landed since the last shell build, regenerate the
  offline shell (`pnpm --filter mind-map-sv build`) and commit it on its own,
  as in `cb5371f` — CI runs `pnpm run check:offline-shell`.
- Set this plan's status to `done`.

**Acceptance**

- The milestone no longer describes the buttons as append-only suggestions.
- `pnpm run check:offline-shell` passes.

## Wave plan

```
Wave 1   T01   token source ranges
Wave 2   T02   pure cycle + mode lookup (needs T01's ranges)
Wave 3   T03   panel wiring + stories (needs T02's functions)
Wave 4   T04   docs, ruling, shell regeneration
```

Deliberately sequential: each task consumes the previous one's API, and T01
and T02 both touch `lib/graphQuery.ts`. T01 and T02 are small enough that one
agent can carry them as two commits in one session.

## Risks and rollback

- **Duplicate tokens with mixed modes.** A hand-typed `-#lab #lab` reads as
  excluded (effective mode), so one click removes both tokens and the tag
  leaves the query; a hand-typed `#lab +#lab` reads as spotlighted and one
  click turns it into a single `-#lab`. Both normalise to one token, and the
  button never disagrees with what the graph shows.
- **Two legend spellings share one token.** Legend tags are collected by exact
  string (`lib/tagColors.ts:101-120`), so `Lab` and `lab` are two buttons but,
  matched case-insensitively, one token — clicking either cycles both. This is
  the same equivalence evaluation already applies, so the buttons reflect the
  graph truthfully.
- **Tag names that do not round-trip.** Tag names cannot contain whitespace or
  any marker (`isValidTagName`, `lib/titleSyntax.ts:168-176`), but nothing
  forbids `+"` or `-"` inside one, which the tag reader treats as a token
  boundary (`lib/graphQuery.ts:400-401`). Today's `appendToken` has the same
  gap; not widened here.
- **Offsets add two fields to every token.** Negligible next to evaluation; the
  1000-node perf spec guards it.
- **Rollback.** T03 is the only user-visible change and reverts alone; T01 and
  T02 are additive and harmless without it.

## Definition of Done (this plan)

- All four tasks merged.
- `pnpm --filter mind-map-sv lint` passes.
- `pnpm --filter mind-map-sv check` passes.
- `pnpm --filter mind-map-sv test:unit -- --run` passes (server, client and
  storybook projects, including the new spec and stories).
- `pnpm --filter mind-map-sv knip` passes.
- `pnpm run check:offline-shell` passes with a regenerated shell committed.
  _Not done in T04: one regeneration is deferred until all four 2026-10-11
  plans have landed on `feature/graph-tunables` (see Notes)._
- Clicking a tag button four times in the running app walks the query through
  `#tag`, `+#tag`, `-#tag` and back, leaving any other typed text intact.
- Milestone 05's UI bullets describe the new behaviour, the ruling is filed in
  `docs/ui-decisions/`, and this plan's status is `done`.

## Notes

- 2026-10-11: drafted from a decided design; the open questions above record
  decisions already made, not proposals.
- 2026-10-11: executed. What landed:
  - T01 — `GraphQueryToken` carries a half-open `start`/`end` source range, so
    `query.slice(token.start, token.end)` is exactly what was typed; empty
    tokens (`""`, `#`, `+#`) still push nothing.
  - T02 — new pure `lib/queryTokenCycle.ts` (`tagTokenText`, `tagTokenMode`,
    `cycleTagToken`) with `lib/queryTokenCycle.spec.ts`; `graphQuery.ts`
    exports `tagNamesMatch`, which `matchingTag` now calls.
  - T03 — `GraphQueryPanel.svelte` renders both tag groups through one
    `tagButton` snippet carrying `aria-pressed`, `data-mode`, the token as
    typed for its label and a `Node tag lab, <state>` accessible name;
    `appendToken` is gone and the hover/focus preview fires only for a tag not
    in the query. New `GraphQueryPanelHarness.svelte` and
    `GraphQueryPanel.stories.svelte` (four stories), plus
    `UserCyclesNodeTagButtonIntoQuery` in `Multigraph.stories.svelte`.
  - T04 — milestone 05's suggestion and hover bullets and the matching
    acceptance line describe the cycle; the ruling is filed as
    `docs/ui-decisions/2026-10-11--pointer--a-tag-button-cycles-its-token-and-hover-never-excludes.md`.
  - T03's agent observed that the tag buttons sit below the 44px touch-target
    floor. That predates this plan and was left alone; it is filed as
    `docs/debt/2026-10-11-query-panel-tag-buttons-under-touch-target-floor.md`.
  - The offline shell was **not** regenerated in T04: it will be rebuilt once,
    after all four 2026-10-11 plans land, so `check:offline-shell` is still
    owed for this plan's `src/**` changes.
- 2026-10-11 (later the same day): the owner revised two resolutions, and this
  addendum supersedes them; the text above is left as it was decided.
  - **The cycle skips plain focus.** A button now walks none → `+#tag`
    (spotlight) → `-#tag` (exclude) → none, and a tag with no token appends
    `+#tag`. A hand-typed `#tag` still counts as in the query (`aria-pressed`
    true, `data-mode="focus"`, "in focus") and its next click gives `+#tag`.
    `NEXT_MODE` in `lib/queryTokenCycle.ts` keeps focus → spotlight → exclude
    → null; only the no-token branch changed. `tagTokenMode` is unchanged.
    Labels are unchanged: the resting label is the bare `#tag`, the pressed
    ones `+#tag` / `-#tag`.
  - **Hover and keyboard focus preview exactly what the next click would do.**
    `previewTag` previews `cycleTagToken(query, target, tag)`: a tag with no
    token previews `+#tag` as before, a spotlit tag previews its exclusion, an
    excluded tag previews the query without it. The panel's `previewToken`
    (which appended) became `previewQuery`, which passes a whole query. The
    owner accepted that a previewed exclusion takes nodes out of the layout on
    hover. `Multigraph.svelte`'s exclusion effect already keys on
    `activeGraphQueryText` (preview, else committed), so a preview exclusion
    fades the leavers and settles the rest, and leaving the button grows them
    back the same way; a click commits the previewed text verbatim, so it
    changes nothing further. No debounce: the owner will ask for one if hover
    flicker bites.
  - Specs and stories follow the new order.
    `HoverPreviewsSpotlightOnlyForATagNotInTheQuery` became
    `HoverPreviewsWhatTheNextClickWouldDo`; new
    `UserCyclesATypedFocusTagOnToSpotlight` (panel) and
    `UserHoversAnExcludedTagAndPreviewsItsRemoval` (canvas);
    `UserCyclesNodeTagButtonIntoQuery` now walks spotlight → exclude (the
    nodes leave) → none (they return).
  - Ruling:
    `docs/ui-decisions/2026-10-11--pointer--a-tag-button-cycles-spotlight-and-exclude-and-hover-previews-the-next-click.md`,
    which supersedes
    `docs/ui-decisions/2026-10-11--pointer--a-tag-button-cycles-its-token-and-hover-never-excludes.md`.
  - The offline shell is owed again for these `src/**` changes.
- 2026-10-12: the owner removed the parsed-token chip list from the panel.
  The `<ul aria-label="Parsed query tokens">` of `li[data-mode][data-target]`
  chips appeared and vanished as a tag button cycled to and from none, so the
  panel jumped; the tag buttons already show each tag's state and the input
  shows the text. `tokenLabel` and the chip-only CSS went with it; the counts
  row, Previous/Next and the tag buttons' mode fills are unchanged. New panel
  story `PanelHeightHoldsStillAsATagCyclesInAndOut` asserts the panel's height
  stays within 1 px across none → `+#lab` → `-#lab` → none, and
  `UserFiltersGraphByNodeAddon` now checks the counts row instead of a chip.
  The offline shell is owed again for this `src/**` change.
