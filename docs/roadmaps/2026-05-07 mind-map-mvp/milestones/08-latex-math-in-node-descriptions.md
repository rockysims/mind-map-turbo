# Milestone 08: LaTeX math in node descriptions

**Status:** not started
**Depends on:** milestone 03 (node editing UX), milestone 04l/04n
(self-contained offline HTML app shell), and milestone 06 (node focus content
surface).
**Plan:** [2026-08-27 08-latex-math-in-node-descriptions.md](../plans/2026-08-27%2008-latex-math-in-node-descriptions.md)

## Goal

Let users write mathematical notation in node descriptions and see it typeset,
so a mind map can carry real equations instead of ASCII approximations like
`v = v0 + a*t`.

This milestone delivers math rendering on its own terms: descriptions become
typeset documents, and nothing about the graph model changes. It also
establishes the rendering substrate that milestone 09 builds on, because the
variable dataflow layer identifies symbols by walking rendered MathML rather
than by pattern-matching LaTeX source.

The hard constraint is the offline document model from 04l/04n. Every save file
carries the whole app inside it, so a math engine must inline completely into
one `.html` file with no sibling font or stylesheet requests.

## Scope

### Math engine and offline packaging

- Render LaTeX to MathML with Temml, letting the browser draw the math. This
  avoids shipping a family of web fonts inside every save file.
- Keep the engine behind a thin internal adapter so it can be swapped without
  touching component code.
- Inline the engine's stylesheet and its single small font into the
  self-contained build, so `build/index.html` remains the only build artifact.
- Keep the shell's growth proportionate: math support should cost well under
  half a megabyte in the propagated app shell.

### Description math syntax

- Support display math with `$$…$$` and inline math with `$…$`.
- Treat a backslash-escaped `\$` as a literal dollar sign so prices and shell
  snippets keep working.
- Leave unbalanced or unterminated delimiters as literal text rather than
  swallowing the rest of the description.
- Preserve the existing plain-text behavior of everything outside math
  delimiters, including the current newline handling.

### Rendering surfaces

- Render typeset math in the focus-mode description surface, replacing the
  current plain-text paragraph.
- Show a live preview of the rendered description while editing in the node
  edit sheet, so authors can verify notation before saving.
- Render invalid LaTeX as a visibly marked inline error that names the problem,
  instead of throwing, blanking the description, or breaking focus mode.
- Keep rendered math legible through the nested transform scaling used by the
  focus morph surface and zoom world.

### Safety and performance

- Configure the engine so untrusted graph documents cannot inject markup or
  external resource loads through description content.
- Cap expansion and sizing options so a hostile or accidental macro loop cannot
  hang the app or blow up layout.
- Memoize rendering so panning, zooming, and layout ticks do not re-typeset
  unchanged expressions.

## Acceptance criteria

- Pure specs cover math/text segmentation, including `$$` versus `$`, escaped
  `\$`, adjacent expressions, and unterminated delimiters.
- Pure specs cover the render adapter's caching behavior and its handling of
  invalid input.
- Story coverage shows a description containing inline and display math
  rendering as MathML in focus mode, and an invalid expression rendering as a
  marked error without breaking the surrounding description.
- Story coverage shows the edit sheet preview updating as the description
  changes.
- Descriptions with no math render exactly as they do today.
- The production build still emits a single self-contained `.html` file with no
  required sibling assets, and the math font is embedded in it.
- Browser coverage verifies math renders when the app is opened from `file://`.
- `static/offline-app-shell.html` is rebuilt, committed, and passes
  `pnpm check:offline-shell`.
- Lint, check, unit/browser/story tests, and relevant e2e flows pass.

## Non-goals

- Markdown or any other rich text in descriptions. Math delimiters are the only
  new syntax.
- Math in node titles, edge labels, tags, or the search query input.
- A visual equation editor, palette, or LaTeX autocomplete.
- Variable extraction, dataflow edges, or any graph semantics derived from math.
  That is milestone 09.
- Numeric evaluation, computer algebra, or unit checking.
- Chemistry, commutative diagram, or other Temml extension packages.
- Copy-as-LaTeX, MathML export, or accessibility annotations beyond what the
  engine emits by default.

## Risks and open questions

Resolved in the plan; kept here for context.

- **Font inlining was the one genuine unknown; a spike settled it.** The build
  inlines stylesheet text but does not itself rewrite `url()` references, and it
  deletes every sibling file afterward. Raising the bundler's asset inlining
  threshold proved sufficient, verified from `file://`, with no change to the
  inlining script.
- **MathML rendering quality varies by engine and by installed math font.**
  Extensible arrows and radical degrees are known to render worse in Chromium
  and WebKit than in Gecko. The plan should decide whether to ship the engine's
  small companion font, and which stylesheet variant to use.
- **Shell size is committed to git on every build.** The propagated shell is a
  tracked file, so its growth is permanent history cost. Measured at ~221 KB
  added, taking the shell from 278,791 to 505,581 bytes.
- **This is the first use of `{@html}` in the codebase.** Descriptions arrive
  from untrusted save files, so the plan should state the exact engine options
  that make injection impossible and cover them with a spec.
- **The focus surface deliberately avoids scroll containers** so wheel input
  reaches the zoom world. Wide display equations could overflow. The plan should
  decide between soft line breaking, horizontal overflow, or scaling.
- **Rendering cost is unbounded if done naively.** The plan should specify the
  cache key and where rendering happens relative to the render loop.

## References

- Temml administration and browser compatibility notes:
  <https://temml.org/docs/en/administration>
- Offline shell mechanics: `scripts/inline-static-build.mjs`,
  `scripts/offline-shell-fingerprint.mjs`, milestone 04n.
- Current description rendering: `Multigraph/NodeDetailsContent.svelte`.
