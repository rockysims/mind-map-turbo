# Plan: LaTeX math in node titles

**Created:** 2026-08-27
**Author:** Cursor agent
**Milestone:** [milestones/10-latex-math-in-node-titles.md](../milestones/10-latex-math-in-node-titles.md)
**Status:** done
**Total estimated effort:** M (six tasks, four waves)

## Summary

Typeset math in node titles using the milestone 08 renderer, and give every place
that needs a title as a string a plain-text projection instead of raw LaTeX.

## Open questions resolved

- **Whether a title participates in the dataflow layer.** **Yes, on exactly the
  same terms as a description: the title and description are concatenated for
  inference.** We just fixed the mirror image of this bug, where `$x = 1$` in a
  description did not define because it used the wrong delimiter, and the lesson
  was that authors do not model the parser's internal distinctions. A person who
  titles a node `$x = 1$` and writes nothing else has defined `x` by any reading,
  and a rule that says otherwise will be discovered as a bug rather than learned.
  The equality requirement still keeps a decorative title like `Energy $E$` from
  manufacturing anything.

- **What a symbol reads as aloud.** **The projection uses the MathML tree's own
  text content, not the LaTeX source and not the dataflow label.** Temml already
  emits `α` for `\alpha`, which is what a person would say, whereas the source
  says `\alpha` and the dataflow label is canonicalized for identity rather than
  for reading. The three agree for plain letters and diverge exactly where the
  source is least readable.

- **When the re-fit runs.** **`SquareText` re-fits once, on a document-level
  `fonts.ready` resolution, and only when its content contains math.** Font
  loading is a one-time document event rather than a per-node one, so watching it
  per node would run the same fit hundreds of times for one cause. Math-free
  titles skip it entirely, which keeps the common case free.

- **Whether search matches source, projection, or both.** **Both.** Matching only
  the projection makes `\alpha`
  unfindable by anyone who typed what they wrote; matching only the source makes
  `α` unfindable by anyone reading the screen. Both is explainable in one
  sentence — "you can search for what you see or what you typed" — which is the
  bar that matters, since the alternative is a user who concludes search is
  broken.

- **Cost at graph scale.** **Render titles through the existing memoized render
  cache, and short-circuit before segmentation when a title has no `$`.** Every
  visible node draws a title, so this path is hundreds of times hotter than
  descriptions. The short-circuit is what makes a math-free graph provably pay
  nothing, and T01 asserts it rather than assuming it.

## Out of scope (for this plan)

- Math in edge labels, tag names, or the graph title.
- A WYSIWYG equation editor.
- Any change to how descriptions render.
- Re-fitting on container resize, which `SquareText` does not do today either.

## Tasks

### T01 — Project a title containing math to plain text

|                |                                                              |
| -------------- | ------------------------------------------------------------ |
| **Depends on** | —                                                            |
| **Wave**       | 1                                                            |
| **Agent**      | default workhorse                                            |
| **Files**      | new `MathText/lib/mathPlainText.ts` and spec                 |
| **Effort**     | S                                                            |
| **PR title**   | `feat(math): project math-bearing text to a plain-text form` |

Walk the rendered MathML tree for its text content and splice it back into the
surrounding prose, so a title becomes a string a screen reader can announce and a
search can match.

**Acceptance**

- Specs cover an all-math title, a mixed one, and one whose math does not parse
  and must fall back to source.
- `\alpha` projects to `α`; a subscript projects readably.
- A title with no `$` returns the identical string, asserted by identity so the
  hot path provably allocates nothing.

### T02 — Render math in `SquareText` and re-fit after fonts load

|                |                                                      |
| -------------- | ---------------------------------------------------- |
| **Depends on** | —                                                    |
| **Wave**       | 1                                                    |
| **Agent**      | high-reasoning                                       |
| **Files**      | `SquareText/SquareText.svelte`, stories              |
| **Effort**     | M                                                    |
| **PR title**   | `feat(node): typeset math in auto-fitted title text` |

The binary-search fit compares `scrollWidth` against `clientWidth` and is content
agnostic, so MathML needs no new fitting algorithm. The trap is timing: the fit
runs in an effect on mount, math fonts load asynchronously, and a title measured
against fallback metrics settles at the wrong size and stays there.

**Acceptance**

- A story shows a typeset title on a compact node.
- A story asserts the fitted size changes after `document.fonts.ready`, which is
  the assertion that would fail if the re-fit were dropped.
- A math-free title renders byte-identically to today.
- Unparseable math falls back to source rather than rendering an error.

### T03 — Use the projection everywhere a title must be a string

|                |                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------- |
| **Depends on** | T01                                                                                             |
| **Wave**       | 2                                                                                               |
| **Agent**      | fast/cheap                                                                                      |
| **Files**      | `NodeDetailsLayer.svelte`, `NodeEditSheet.svelte`, `NodeActionMenu.svelte`, `Multigraph.svelte` |
| **Effort**     | S                                                                                               |
| **PR title**   | `fix(a11y): keep LaTeX source out of accessible names and labels`                               |

The focus dialog's accessible name, the edit sheet heading, the action menu's
`aria-label`, the duplicate-edge dialog, and the dataflow diagnostics buttons all
take a title as a string today.

**Acceptance**

- A story asserts the focus dialog's accessible name contains no `$` and no
  backslash.
- Each listed surface is covered, so none is silently missed.

### T04 — Match titles containing math in text search

|                |                                                             |
| -------------- | ----------------------------------------------------------- |
| **Depends on** | T01                                                         |
| **Wave**       | 2                                                           |
| **Agent**      | default workhorse                                           |
| **Files**      | `Multigraph/lib/graphQuery.ts`, spec                        |
| **Effort**     | S                                                           |
| **PR title**   | `feat(query): match math titles by rendered text or source` |

**Acceptance**

- Specs cover finding a node by what is displayed and by what was typed.
- A math-free graph's matching behavior is unchanged, asserted directly.

### T05 — Include titles in dataflow inference

|                |                                                              |
| -------------- | ------------------------------------------------------------ |
| **Depends on** | —                                                            |
| **Wave**       | 1                                                            |
| **Agent**      | default workhorse                                            |
| **Files**      | `Multigraph/lib/nodeQuantities.ts`, spec, `quantityIndex.ts` |
| **Effort**     | S                                                            |
| **PR title**   | `feat(multigraph): infer quantities from node titles too`    |

A node titled `$x = 1$` defines `x`. Note the memoization signature in
`quantityIndex.ts` currently hashes description and tags; it must include the
title or edits to a title will not invalidate the cache.

**Acceptance**

- A spec covers a title-only definition and a title/description pair.
- A spec covers the cache invalidating on a title edit, which is the failure
  mode most likely to ship unnoticed.
- A decorative title like `Energy $E$` still defines nothing.

### T06 — Author math in a title

|                |                                                 |
| -------------- | ----------------------------------------------- |
| **Depends on** | T02                                             |
| **Wave**       | 3                                               |
| **Agent**      | fast/cheap                                      |
| **Files**      | `NodeCompactContent.svelte`, stories            |
| **Effort**     | XS                                              |
| **PR title**   | `feat(node): edit a math title as LaTeX source` |

Inline title editing already uses a plain `<input>`, so source editing mostly
falls out. Confirm the tag syntax still parses alongside `$`.

**Acceptance**

- A story edits a math title and asserts it re-renders typeset on commit.
- A story asserts `#tag` in a title with math still creates the tag.

## Wave plan

```
Wave 1   T01  ‖  T02  ‖  T05     (independent: projection, rendering, inference)
Wave 2   T03  ‖  T04             (both need T01's projection, different files)
Wave 3   T06                     (needs T02's rendering)
```

## Risks and rollback

- **The re-fit fires for every node at once when fonts resolve.** On a large
  graph that is a synchronous storm of layout reads. If T02 shows jank, batch the
  re-fit or gate it to visible nodes rather than reverting typeset titles.
- **T05 makes titles define quantities that authors intended decoratively.** The
  equality requirement is the guard, and it is the same guard descriptions use.
  If it proves too eager, the narrowing belongs in `nodeQuantities.ts` where both
  sources share it, not in a title-specific branch.
- **The stale memoization signature in T05.** A title edit that does not
  invalidate the quantity cache produces a graph that is correct on reload and
  wrong until then, which is the hardest class of bug to notice. Its spec is the
  mitigation.
- **Search matching both forms surprises someone.** Cheap to narrow later; the
  pure function is the only place it lives.

## Definition of Done (this plan)

- All six tasks merged to `main`.
- The milestone's acceptance criteria are satisfied.
- Plan status `done`, milestone status `complete`, roadmap row `complete` with a
  link back to this plan.
- The offline shell is rebuilt and its size change reported.

## Notes

- 2026-08-27: This milestone replaced a planned dataflow tracing and navigation
  milestone, cut because visualizing the dataflow proved sufficient on its own.
- 2026-08-27: T05's decision was shaped by a bug found the same day, where
  requiring `$$` to define meant `$x = 1$` in a description defined nothing and
  then reported itself undefined. The general lesson — authors do not model the
  parser's internal distinctions — is why titles infer on the same terms as
  descriptions rather than on their own.

### Execution notes

- **Search tests the source first, not the projection.** The plan said projection
  first. For a boolean OR the order cannot change the answer, only the cost, and
  the source test is a substring check on a string already in hand while the
  projection has to render. The stated semantics are unchanged.
- **T04 was applied to descriptions as well as titles.** Descriptions have had
  rendered math since milestone 08 and carried the identical gap. The fix is the
  same call on the same helper, so scoping it to titles would have left a known
  bug in place for no reason.
- **`SquareText`'s fit did not track its text.** The effect read only the element
  binding, so a retitle kept the size found for the previous string. Latent before
  this milestone and load-bearing after it, since titles now change shape. Fixed
  in T02 and covered in T06.
- **The first version of that re-fit test passed against the unfixed code**,
  because changing from plain text to math also trips the font effect, which calls
  the same fit. Rewritten with two math-free strings and confirmed to fail with the
  fix reverted. Worth recording as a pattern: a component with two effects calling
  one function will happily accept a test that proves nothing.
- **`MathText` gained a `singleLine` mode.** Its display-math path installs a
  `ResizeObserver` on its parent to scale the equation, and `SquareText` fits by
  repeatedly resizing that same parent. Routing display segments through the inline
  path sidesteps the interaction instead of arbitrating it.
- **Titles and descriptions were already `$`-guarded, but not equally.** T02
  initially used a substring test where `hasMath` already existed and is stricter,
  so `Costs \$5` would have taken the math path. Now guarded by the cheap test
  followed by the real one.
