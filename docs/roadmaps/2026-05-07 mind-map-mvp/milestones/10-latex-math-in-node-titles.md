# Milestone 10: LaTeX math in node titles

**Status:** complete
**Depends on:** milestone 08 (LaTeX math in node descriptions) and milestone 09
(variable dataflow layer).
**Plan:** [plans/2026-08-27 10-latex-math-in-node-titles.md](../plans/2026-08-27%2010-latex-math-in-node-titles.md)

## Goal

Let a node be titled with the mathematics it is about. Milestone 08 made
descriptions typeset, but the title is what you read at graph scale, and a node
whose subject is a quantity currently has to spell it out in prose or show raw
`$v_0$` source on its face.

The work is smaller than milestone 08 because the rendering already exists. What
makes it a milestone rather than a patch is that a title is not only drawn: it is
the node's accessible name, its heading in two sheets, its label in menus, and
what a text search matches against. Every one of those wants plain text, and
rendered math is not plain text.

## Scope

### Typeset the title on the canvas

- Render math in a title on the compact node, using the same segmentation and
  engine as descriptions rather than a second path.
- Keep the existing auto-fit behavior, so a title with math still grows to fill
  the inscribed square and shrinks when it is long.
- Re-fit once math fonts have loaded. The fit measures text, and measuring
  against fallback metrics leaves the title settled at the wrong size.
- Degrade to the raw source when an expression does not parse, matching how
  descriptions already behave mid-keystroke.

### Keep a plain-text projection

- Derive a plain-text form of a title and use it everywhere a string is
  required rather than rendered content: the focus dialog's accessible name, the
  edit sheet heading, the action menu label, the duplicate-edge dialog, and the
  dataflow diagnostics buttons.
- Decide what a symbol reads as, so a screen reader announces something a person
  would recognize.
- Keep text search working against titles that contain math, without requiring
  the searcher to know LaTeX source.

### Author the title

- Editing continues to show LaTeX source, matching description editing.
- The existing inline title syntax for tags keeps working alongside math.

## Acceptance criteria

- Pure specs cover the plain-text projection, including a title that is entirely
  math, one that mixes prose and math, and one whose math does not parse.
- Pure specs cover search matching a title containing math.
- Story coverage shows a typeset title on a compact node, and shows it re-fitting
  rather than staying mis-sized after fonts load.
- Story coverage shows a title with unparseable math falling back to source
  rather than rendering an error into the node.
- The focus dialog's accessible name contains no LaTeX source.
- A title with no math renders byte-identically to today.
- Lint, check, and unit/browser/story tests pass.

## Non-goals

- Math in edge labels or tag names.
- A rich-text or WYSIWYG equation editor for titles.
- Changing how descriptions render.

## Risks and open questions

All resolved in the plan; the reasoning lives there.

- **Whether a title participates in the dataflow layer.** Resolved: yes, on the
  same terms as a description.
- **What a symbol reads as aloud.** Resolved: MathML's own text content, so
  `\alpha` is announced as `α`.
- **When the re-fit runs.** Resolved: once per component on a document-level
  `fonts.ready`, and only for content containing math.
- **Whether search matches source, projection, or both.** Resolved: both.
- **Cost at graph scale.** Resolved: math-free text short-circuits before
  segmentation, and math renders through the existing memoized cache.

One thing this milestone did not anticipate: `SquareText`'s fit tracked only its
element binding, not its text, so a retitle kept the size found for the previous
string. Harmless while titles were static prose and load-bearing once they can
change shape. Fixed here.

## References

- Rendering and segmentation: `MathText/MathText.svelte`,
  `MathText/lib/mathRender.ts`, `MathText/lib/mathSegments.ts`.
- Auto-fit: `SquareText/SquareText.svelte`.
- Title syntax: `Multigraph/lib/titleSyntax.ts`.
- Symbol canonicalization: `MathText/lib/mathSymbols.ts`.
