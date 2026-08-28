# Plan: LaTeX math in node descriptions

**Created:** 2026-08-27
**Author:** Cursor agent
**Milestone:** [milestones/08-latex-math-in-node-descriptions.md](../milestones/08-latex-math-in-node-descriptions.md)
**Status:** draft
**Total estimated effort:** M

## Summary

Add Temml-rendered LaTeX to node descriptions, packaged so the self-contained
offline shell stays one file, and establish the render adapter that milestone 09
will read MathML from.

## Open questions resolved

- **How the math font gets into the single-file build.** **Raise Vite's
  `build.assetsInlineLimit` to 16 KB rather than extending
  `inline-static-build.mjs`.** Temml ships one 9.4 KB `woff2`, so the bundler
  base64s it into the CSS text that `inlineStylesheets()` already inlines, and
  the app's only other asset is an SVG favicon that `inlineIcons()` handles on
  its own path — so the blast radius of raising the threshold is nil. **Verified
  by a throwaway spike on 2026-08-27** (see Notes): `build/` held only
  `index.html`, the shell contained exactly one base64 asset
  (`src:url(data:font/woff2;base64,…)`) and no residual `Temml.woff2`
  reference, and no change to `inline-static-build.mjs` was needed.
- **Which Temml stylesheet, and whether to ship its companion font.**
  **`Temml-Local.css` plus the bundled `Temml.woff2`.** Local delegates the main
  math face to the OS (Cambria Math on Windows, STIX Two on macOS/iOS, Noto Sans
  Math on Android) so we pay 9 KB instead of a full math family, while the
  companion font restores script letters and correct prime alignment in
  Chromium.
- **Engine coupling.** **All Temml calls go through one adapter module; no
  component imports Temml directly.** If MathML fidelity proves unacceptable in
  real use, swapping to KaTeX with a font subset (~455 KB instead of ~185 KB) is
  then a one-file change rather than a rewrite.
- **String output versus rendering into the DOM.** **Use `renderToString` and
  `{@html}`, with `trust: false`.** A string is cacheable, testable in the node
  project, and directly parseable by milestone 09; Temml documents its output as
  injection-safe, and T03 pins that with a spec. Rendering into an element via
  an effect is the rollback if that spec finds a gap.
- **Which delimiters define math.** **`$$…$$` for display, `$…$` for inline,
  `\$` for a literal dollar.** This matches Temml's own `$` fences option and
  the convention users already expect; longest-delimiter-first matching keeps
  `$$` from being read as an empty inline expression.
- **What happens to malformed input.** **Unterminated delimiters stay literal
  text; invalid LaTeX renders as a marked inline error.** A typo mid-description
  must never swallow the rest of the text or blank the focus surface.
- **Wide display equations on a surface with no scroll container.** **Scale
  overflowing display math down to fit its container**, reusing the
  measure-then-`transform: scale()` approach already proven in
  `SquareText.svelte`. The focus surface deliberately omits scroll containers so
  wheel input reaches `ZoomWorld`, and `NodeChrome` clips overflow, so
  fit-to-width is the only option that neither clips nor steals the gesture.
- **Render cost.** **Memoize in a module-level map keyed by display mode plus
  LaTeX source, bounded at 500 entries.** Rendering is driven from a `$derived`
  on the description, so it only runs when text changes, and identical
  expressions repeated across nodes cost nothing after the first.
- **Size budget.** **Report the shell's size change in every PR that rebuilds
  it; do not fail on a threshold.** Measured baseline is 278,791 bytes and the
  spike measured the real addition at 226,790 bytes (~221 KB) for a
  505,581-byte shell. The addition exceeds the ~185 KB predicted from published
  file sizes because Vite bundles and minifies `temml.mjs` itself rather than
  consuming Temml's pre-minified `temml.min.js`. An earlier draft of this plan
  set a hard 600 KB gate, which was dropped once milestones 09 and 10 came into
  view: all three inline into the same tracked file, a fixed ceiling would have
  left them roughly 106 KB between them, and the gate would have failed at the
  very end of milestone 10 rather than where the cost was incurred. Visibility
  on each change is what actually prevents a silent regression to
  KaTeX-with-all-fonts scale.

## Out of scope (for this plan)

- Symbol extraction, variables, derived edges, and diagnostics (milestone 09).
- Tracing, jump-to-definition, and query integration (milestone 10).
- Math anywhere other than descriptions: titles, tags, edge labels, and the
  search input all stay plain text.
- Math on the compact canvas node. Milestone 09 introduces on-node quantity
  chips; until then descriptions render only in focus mode and the edit sheet.
- Markdown or any other rich text.
- Equation palette, LaTeX autocomplete, or a visual editor.
- Temml extension packages (`mhchem`, `physics`, `texvc`).
- Copy-as-LaTeX and MathML export.

## Tasks

> Each task is one PR's worth of work. If a task feels like more than
> one logical commit, split it. The PR title is drafted up front so
> reviewers (and the model writing the commit) start aligned.

### T01 — Add Temml and prove it inlines into the single-file build

|                |                                                                     |
| -------------- | ------------------------------------------------------------------- |
| **Depends on** | —                                                                   |
| **Wave**       | 1                                                                   |
| **Agent**      | high-reasoning (`claude-opus-4-8-thinking-high` or `gpt-5.3-codex`) |
| **Effort**     | S                                                                   |
| **Files**      | `package.json`, `vite.config.ts`, `src/routes/layout.css`           |
| **PR title**   | `build(math): add temml and inline its font into the offline shell` |

Add `temml` as the app's first runtime dependency. Import `Temml-Local.css` from
`src/routes/layout.css` (which both the app layout and `.storybook/preview.ts`
already load). Set `build.assetsInlineLimit` to `16384` in `vite.config.ts`.

A throwaway spike on 2026-08-27 confirmed this exact recipe works end to end, so
this task is a known quantity rather than an experiment. `import temml from
'temml'` resolves cleanly (package `exports` maps `.` to `dist/temml.mjs`), and
`temml/dist/Temml-Local.css` resolves through the `./*` export. Do not write
component code here — the deliverable is the packaging plus its regression
checks.

**Acceptance**

- `pnpm --filter mind-map-sv build` succeeds and `build/` contains only
  `index.html`.
- The built `index.html` contains no `url(` reference that points at a file
  path; the Temml font is present as a `data:` URI.
- A scratch page rendering one expression displays typeset math when
  `build/index.html` is opened directly from disk via `file://`, with no console
  errors and no failed requests.
- `document.fonts.check('16px Temml')` is true in that page, proving the inlined
  font loads rather than silently falling back. Rendering `\mathscr{L}` is a
  quick visual equivalent, since that glyph exists only in `Temml.woff2`.
- Record the before/after byte size of `build/index.html` in the PR body and in
  this plan's Notes.
- Lint and check pass.

### T02 — Split descriptions into text and math segments

|                |                                                                              |
| -------------- | ---------------------------------------------------------------------------- |
| **Depends on** | —                                                                            |
| **Wave**       | 1 (parallel with T01)                                                        |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)                      |
| **Effort**     | S                                                                            |
| **Files**      | new `components/ui/MathText/lib/mathSegments.ts`, new `mathSegments.spec.ts` |
| **PR title**   | `feat(math): add pure description segmentation for inline and display math`  |

Pure function turning a description string into an ordered list of
discriminated segments: text, inline math, or display math. Match `$$` before
`$`. Treat `\$` as a literal dollar in text and do not open a segment on it.
Leave an unterminated delimiter as literal text rather than consuming to the end
of the string. No DOM, no Temml — this task must not depend on T01.

**Acceptance**

- Spec covers: display only, inline only, both in one description, adjacent
  expressions with no gap, escaped `\$` in text, an unterminated `$`, an
  unterminated `$$`, an empty expression, and a description with no math at all.
- A description with no math returns exactly one text segment whose content is
  byte-identical to the input.
- Concatenating every segment's source reproduces the original string.
- Delimiter characters are excluded from math segment content.

### T03 — Add the Temml render adapter with a bounded cache

|                |                                                                          |
| -------------- | ------------------------------------------------------------------------ |
| **Depends on** | T01                                                                      |
| **Wave**       | 2                                                                        |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)                  |
| **Effort**     | S                                                                        |
| **Files**      | new `components/ui/MathText/lib/mathRender.ts`, new `mathRender.spec.ts` |
| **PR title**   | `feat(math): add temml render adapter with safe options and memoization` |

The single place Temml is imported. Take display mode and the security tunables
as parameters with defaults per the repo's configurable-not-constant rule. Fixed
defaults: `trust: false`, `throwOnError: false`, capped `maxSize` and
`maxExpand`. Memoize in a module-level map keyed by display mode plus source,
evicting when the map exceeds 500 entries.

**Render through `temml.__renderToMathMLTree`, not `renderToString`, and return
both the tree and its markup:**

```ts
type MathRenderResult =
  | { ok: true; markup: string; tree: MathNode }
  | { ok: false; markup: string; message: string };
```

This contract exists because milestone 09 must walk the MathML to extract
symbols, and per repo convention that pure logic gets a spec in the `server`
project — where `DOMParser` is `undefined` and no DOM or HTML parser is
declared anywhere in the repo. Returning only a markup string would force 09 to
either add a parser dependency or move its core spec into the browser project.
`__renderToMathMLTree` avoids both: it runs DOM-free under Node and returns a
plain `MathNode` of `{ type, attributes, children, classes, style, label }` that
a recursive walk traverses directly. Rendering once and deriving markup from
`tree.toMarkup()` also avoids a redundant second parse.

Discriminate the branches on the returned node's `type`. A success returns a
`MathNode` with `type === 'math'`; an error returns a `Span` whose `type` is
`undefined`, carrying the `temml-error` markup with the source and parse
message. That is a structural check rather than sniffing the markup string for
a class name. Extract `message` for T04 by walking the Span's text children with
the same DOM-free traversal.

**Acceptance**

- Spec runs in the `server` project (Temml's ESM build works under Node).
- Valid input returns `ok: true` with `markup` containing a `<math>` element.
- `tree.toMarkup()` is byte-identical to `renderToString()` for the same source
  and options. This pins the `__`-prefixed internal API so a Temml upgrade that
  changes it fails a test instead of silently degrading milestone 09.
- A recursive walk of `tree` collects the expected `mi`/`mn`/`mo` nodes with no
  DOM present, proving milestone 09's extraction can be a pure `server` spec.
- Invalid LaTeX returns `ok: false` rather than throwing, and the branch carries
  the parse message.
- A description containing a `<script>` tag inside `\text{}` produces output
  with no `<script>` element; an `\includegraphics`-style payload produces no
  external resource URL. The spike confirmed both hold with `trust: false`:
  script tags are escaped inside `<mtext>` and `\href` emits no URL at all.
- A macro loop terminates rather than hanging, proving `maxExpand` is applied.
- Repeated identical calls return cache-identical results, and the cache evicts
  past its bound.
- Display and inline mode produce different output for the same source.

### T04 — Add the MathText component

|                |                                                                               |
| -------------- | ----------------------------------------------------------------------------- |
| **Depends on** | T02, T03                                                                      |
| **Wave**       | 3                                                                             |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)                       |
| **Effort**     | M                                                                             |
| **Files**      | new `components/ui/MathText/MathText.svelte`, new `MathText.stories.svelte`   |
| **PR title**   | `feat(math): add MathText component rendering descriptions with typeset math` |

Takes a description string, derives segments via T02, renders text segments as
text and math segments via `{@html}` from T03. Preserve the current
`white-space: pre-wrap` behavior for text segments. For the error branch, prefer
rendering Temml's own `span.temml-error` markup over inventing a second error
style; it already carries the source and the parse message. Scale display math
down when its rendered width exceeds the container, using
`min(1, container.clientWidth / math.scrollWidth)` on a `transform-origin` at
the leading edge.

**Acceptance**

- Story: a description with inline and display math renders `math` elements in
  both positions with surrounding text intact.
- Story: an invalid expression renders the error marker and the rest of the
  description still renders.
- Story: a description with no math renders identically to a plain paragraph,
  including preserved newlines.
- Story: an over-wide display equation is scaled to fit rather than clipped.
- Story names read like sentences, per the roadmap's design principles.
- No `any` and no uncommented `as` casts.

### T05 — Render math in the focus description surface

|                |                                                                                        |
| -------------- | -------------------------------------------------------------------------------------- |
| **Depends on** | T04                                                                                    |
| **Wave**       | 4                                                                                      |
| **Agent**      | fast/cheap (`composer-2.5-fast`)                                                       |
| **Effort**     | S                                                                                      |
| **Files**      | `Multigraph/NodeDetailsContent.svelte`, `Multigraph/NodeDetailsContent.stories.svelte` |
| **PR title**   | `feat(multigraph): render node descriptions as typeset math in focus mode`             |

Replace `<p class="description">{node.description}</p>` with `MathText`, keeping
the existing `.description` typography. Do not change the image block markup or
the `focus-content` layout.

**Acceptance**

- Story: focusing a node whose description contains math shows typeset output.
- Existing `NodeDetailsContent` and focus-mode stories still pass unchanged.
- Descriptions without math are visually unchanged, newlines included.
- The surface still has no scroll container, so wheel input reaches `ZoomWorld`.

### T06 — Preview rendered math while editing

|                |                                                                              |
| -------------- | ---------------------------------------------------------------------------- |
| **Depends on** | T04                                                                          |
| **Wave**       | 4 (parallel with T05)                                                        |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)                      |
| **Effort**     | S                                                                            |
| **Files**      | `Multigraph/NodeEditSheet.svelte`, `Multigraph/NodeEditSheet.stories.svelte` |
| **PR title**   | `feat(multigraph): preview typeset description math in the node edit sheet`  |

Add a live preview below the description `<textarea>` in the node tab, rendering
the current draft through `MathText`. Show it only when the draft contains math
delimiters, so nodes without math keep the current compact form. Do not change
save semantics.

**Acceptance**

- Story: typing a display expression into the textarea updates the preview.
- Story: a draft with no math shows no preview region.
- Story: invalid LaTeX shows the error marker in the preview without blocking
  Save.
- Editing and saving still round-trips the raw description text unchanged.

### T07 — Rebuild the offline shell and cover math under `file://`

|                |                                                                            |
| -------------- | -------------------------------------------------------------------------- |
| **Depends on** | T05, T06                                                                   |
| **Wave**       | 5                                                                          |
| **Agent**      | default workhorse (`claude-4.6-sonnet-medium-thinking`)                    |
| **Effort**     | S                                                                          |
| **Files**      | `static/offline-app-shell.html`, `e2e/app.test.ts`, `README.md`            |
| **PR title**   | `chore(math): rebuild offline shell and cover typeset math in offline e2e` |

Rebuild and commit the propagated shell so descendant downloads carry math
support forward. Extend the offline e2e flow to assert that a graph whose node
description contains math renders a `math` element when opened from disk.

**Acceptance**

- `pnpm check:offline-shell` passes, so the committed shell matches current
  sources.
- The offline e2e test asserts a `math` element renders from `file://`, within
  Playwright's configured 30 second timeout.
- The PR body states the shell's before and after byte size and the delta, and
  the measured size is recorded in this plan's Notes. There is no pass/fail
  threshold — the point is that the cost is visible at the moment it is paid.
- Full Definition of Done from `core.mdc`: lint, check, and
  `test:unit -- --run` all pass.

## Wave plan

```
Wave 1   T01  ‖  T02         (T01 is the packaging unknown and lands alone
                              in its files; T02 is pure and touches none of
                              them, so the two are safely concurrent)
Wave 2   T03                 (needs Temml resolvable from T01)
Wave 3   T04                 (integration of T02 segments and T03 rendering)
Wave 4   T05  ‖  T06         (two different consumer components)
Wave 5   T07                 (shell rebuild must follow all app changes)
```

Total: 7 tasks, 5 sequential gates, parallelism in waves 1 and 4.

A simple invariant to check before kicking off a wave: every task in the wave
has all its `Depends on` items already merged to `main`.

## Risks and rollback

- **T01 was the plan's single point of failure; the spike retired it.** The
  `assetsInlineLimit` route was verified end to end on 2026-08-27. Kept for the
  record: if a future dependency bump breaks font inlining, the fallback is to
  extend `inline-static-build.mjs` with a step that rewrites remaining `url()`
  references to data URIs before `removeSiblingArtifacts()` runs.
- **MathML fidelity may disappoint.** Chromium and WebKit render extensible
  arrows and radical degrees worse than Gecko, and quality depends on the
  installed OS math font. The T03 adapter boundary is the mitigation: switching
  to KaTeX with a subset of its fonts is a one-module change costing roughly
  270 KB more in the shell. Do not scatter Temml imports across components, or
  this escape hatch disappears.
- **Shell growth is permanent git history.** Every build rewrites a tracked
  file, so a bad size decision compounds. Mitigated by reporting the size delta
  in T07's PR and by rebuilding the shell once at the end of the milestone
  rather than once per task.
- **First `{@html}` in the codebase.** The spike found no escaping gap, but if
  T03's safety spec finds one, switch that module to render into a detached
  element and hand `MathText` a cloned node instead of a string, which removes
  the injection surface entirely at the cost of a slightly heavier cache.
- **T03 depends on `__renderToMathMLTree`, a `__`-prefixed internal.** It is
  declared in Temml's shipped `.d.ts`, so it is semi-public rather than private,
  but it carries weaker stability guarantees than `renderToString`. Mitigated by
  the design already in place: Temml is imported in exactly one module, and
  T03's spec asserts `tree.toMarkup() === renderToString(...)`, so a breaking
  upgrade surfaces as a failing test. If it ever disappears, the fallback is to
  parse the markup string with `linkedom` behind the same adapter signature,
  which changes one module rather than milestone 09's call sites.
- **Build output is not byte-reproducible.** Rebuilding without any source
  change still rewrites the tracked shell, because SvelteKit emits a random
  `__sveltekit_<token>` namespace and the minifier reshuffles local names.
  Expect a nonzero diff on every rebuild and do not treat one as evidence of a
  real change; `pnpm check:offline-shell` compares the source fingerprint, not
  the bytes.
- **Storybook assertions should test structure, not pixels.** Story `play`
  functions run in headless Chromium where math metrics depend on available
  fonts; assert on the presence and content of `math` elements rather than on
  measured geometry.

## Definition of Done (this plan)

The plan is done when:

- All 7 tasks are merged to `main`.
- The acceptance criteria from the milestone doc are satisfied (no need to copy
  them here — link, don't duplicate).
- Plan status is `done`, milestone status is `complete`, and the roadmap status
  for milestone 08 is `complete` with a link back to this plan.
- The finished work has been committed unless the user explicitly asked not to
  commit yet.

## Notes

Free-form scratchpad for things that come up during execution and don't yet have
a home: questions to revisit, follow-up ideas, links to discussions. Date
entries when you add them.

- 2026-08-27: Sizes researched while writing this plan, from the npm registry
  and jsDelivr. Temml 0.13.4: `temml.min.js` 167,555 B, `Temml-Local.css`
  8,975 B, `Temml.woff2` 9,404 B (~12.5 KB once base64'd) — about 185 KB total.
  KaTeX 0.18.4 for comparison: `katex.min.js` 272,179 B, `katex.min.css`
  24,727 B, and 259,792 B across 20 `woff2` faces (~347 KB base64'd), so roughly
  640 KB for the full package or ~455 KB with a seven-face subset. Baseline
  `static/offline-app-shell.html` is 278,791 B. Record the measured post-T01 and
  post-T07 sizes here.
- 2026-08-27: Throwaway spike run to de-risk T01, then fully reverted. Results:
  shell went 278,791 B to 505,581 B, so **+226,790 B (~221 KB)** against a
  then-current 600 KB budget. `build/` contained only `index.html`;
  the file held exactly one base64 asset, `data:font/woff2`, and no residual
  `Temml.woff2` reference. Opened from `file://` in Chromium: four `<math>`
  elements rendered, `document.fonts.check('16px Temml')` was true, and there
  were zero console errors and zero failed requests. `\mathscr{L}`,
  `\sum` with limits, nested `\sqrt`, and `\oint` all rendered correctly.
  No change to `inline-static-build.mjs` was required.
- 2026-08-27: T03's return contract was settled before coding, against milestone
  09's needs. `temml.__renderToMathMLTree` was verified to run with
  `DOMParser === undefined`, to return a walkable plain-object `MathNode`, and
  to produce `toMarkup()` byte-identical to `renderToString()`. Invalid input
  returns a `Span` with `type === undefined` instead of throwing, and a
  recursive macro is capped by `maxExpand` rather than hanging. So the adapter
  returns tree plus markup, and milestone 09 needs no DOM, no re-parse, and no
  new dependency. Supersedes the earlier note here that suggested returning
  markup alone.
- 2026-08-27: The spike confirmed 09's core premise directly: `v_0` and `v_{0}` both render to byte-identical
  `<msub><mi>v</mi><mn>0</mn></msub>`, and `\alpha` and a literal `α` both
  render to `<mi>α</mi>`. Output carries no `<annotation>` element by default
  (`annotate` defaults to false), so the tree stays compact for walking.
- 2026-08-27: `vite.config.ts` sets `expect.requireAssertions: true`, so every
  new spec must assert something — watch for placeholder tests.
