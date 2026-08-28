# Third-party notices

This project is MIT licensed (see `LICENSE`). The components below are covered
by their own licenses, all of which permit redistribution in a free or
commercial product. None of them are copyleft.

This file exists mainly because the production build is a single
`index.html`: `apps/mind-map-sv/scripts/inline-static-build.mjs` inlines every
stylesheet, script, and asset into it and deletes the siblings. That makes the
distributed artifact a concatenation of our code and everything below, so the
notices have to travel separately rather than as adjacent files.

## Temml — MIT

The only runtime dependency. Parses LaTeX-like math notation and emits MathML;
see `src/lib/components/ui/MathText/lib/mathRender.ts`.

- Copyright (c) 2020 Ron Kok
- https://github.com/ronkok/Temml
- Full text: `node_modules/temml/LICENSE`

A copy of Temml's `dist/Temml-Local.css` is vendored at
`apps/mind-map-sv/src/lib/vendor/temml-local.css`, modified only in its
`font-family` declarations. Its header records the deviations.

Note that Temml is not TeX or LaTeX, and contains no code from either. It
implements a compatible input syntax. The LaTeX Project Public License and
Donald Knuth's TeX license therefore do not apply to this project.

## MindMapScript-Regular.woff2 — SIL Open Font License 1.1

`apps/mind-map-sv/src/lib/fonts/MindMapScript-Regular.woff2` renders `\mathscr`
script capitals. It is a derivative of KaTeX_Script-Regular with the outlines
untouched and the character map moved from ASCII to the Unicode Mathematical
Alphanumeric Symbols script capitals.

- Copyright (c) 2009-2010 Design Science, Inc.
- Copyright (c) 2014-2018 Khan Academy
- Modifications copyright (c) 2026 Rocky Sims
- Full text: `apps/mind-map-sv/src/lib/fonts/OFL.txt`

OFL 1.1 permits bundling and embedding in commercial software. It requires that
each copy carry the copyright notice and license, and forbids a derivative from
using a Reserved Font Name. Both are handled: the notice is in the font's own
name table (viewable in any font inspector) and in `OFL.txt`, and the family was
renamed away from the reserved `KaTeX_Script`.

### Why we build this font instead of using Temml's

Temml ships an equivalent file at `temml/dist/Temml.woff2`, and importing
Temml's stylesheet from `node_modules` would inline it into our build. We do not
use it, because its name table declares:

```
This font is made with the home edition of FontCreator.
You may not use this font for commercial purposes.
https://www.high-logic.com/font-license-agreement
```

That string is an artifact of the tool that built the file, not the intent of
Temml's author — Temml is MIT throughout, and High-Logic dropped the
restriction for all FontCreator editions in November 2022, before this font was
built in October 2023. It is also inconsistent with the OFL that the upstream
KaTeX glyphs are licensed under, which OFL 1.1 §5 does not allow to be replaced
with different terms.

So the practical risk of shipping it is low, but redistributing a binary that
states "you may not use this font for commercial purposes" is a claim we would
rather not make on someone else's behalf, and it trips license scanners.
`apps/mind-map-sv/scripts/build-math-script-font.py` regenerates our copy from
KaTeX's original, which carries the correct OFL notice.

The upstream font also contains seven prime glyphs (U+2032–U+2037, U+2057) that
KaTeX does not ship and that we therefore do not reproduce. Primes fall back to
the system math font, the same path every non-script character already takes.

## Build and development dependencies

Svelte, SvelteKit, Vite, Vitest, Tailwind CSS, Storybook, Playwright, ESLint,
Prettier, TypeScript, and Turborepo are all MIT licensed and are development
dependencies. Their compiled runtime output (Svelte's and Tailwind's) is part of
the shipped bundle under the MIT terms in their respective packages.
