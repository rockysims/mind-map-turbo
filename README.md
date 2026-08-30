# MindMap

This project aims to provide a way of constructing a mind map / knowledge web.
The goal is to make it so low friction that it can be used in real time during
a conversation by multiple people at once to, essentially, take notes. A key
goal is to be able to visualize the full mind map even if it becomes huge (via
resizing/rearranging all other nodes around the node(s) pinned by user) so
that the relevant nodes can be readable without entirely losing sight of the
whole.

## Roadmap

The active roadmap, milestones, and (when work is in flight) plans live under
[`docs/roadmaps/`](docs/roadmaps/). Start there for orientation:

- [Roadmap: MindMap MVP](docs/roadmaps/2026-05-07%20mind-map-mvp/roadmap.md)

## Finding your way around the canvas

Zoom is anchored to the pointer, so zooming into empty space moves the graph
away — far enough, and nothing is left in view. Press <kbd>F</kbd> to fit the
whole visible graph back into the window. It is the only canvas shortcut, and
when the graph really has gone off-view a hint saying so appears in the middle
of the empty canvas, so it does not have to be remembered.

Nodes are reachable from the keyboard: <kbd>Tab</kbd> moves between them and
<kbd>Enter</kbd> opens the focused node's details.

## Writing math in node descriptions

Node descriptions accept LaTeX between dollar delimiters: `$…$` renders inline
with the surrounding prose, and `$$…$$` renders as a centered display equation.
Write `\$` for a literal dollar sign. A delimiter that is never closed stays
ordinary text, so a stray `$` cannot blank out the rest of a description.

The node edit sheet shows a live preview as soon as a draft contains math, and
invalid LaTeX renders an inline error marker instead of blocking the save — the
description is always stored as the raw source you typed.

Expressions are typeset to MathML by [Temml](https://temml.org), which the
browser draws with its own math font. Temml's stylesheet and its one small
`woff2` are inlined into the downloadable HTML, so math still renders in a saved
file opened from disk with no network.

## Working on this project

Coding conventions, test discipline, and commit format are documented in:

- [`AGENTS.md`](AGENTS.md) — portable agent guide (also read by Codex, Aider, etc.)
- [`.cursor/rules/`](.cursor/rules) — Cursor-specific rules with file scoping

Read them before making non-trivial changes. The "Definition of Done" in
`.cursor/rules/core.mdc` is the gating checklist for every PR.

## Development

Install:

```
pnpm install
```

Run the app:

```
turbo run dev
```

Run the app after refreshing the self-contained HTML shell used by Download:

```
pnpm dev:downloadable
```

Verify the tracked downloadable shell is fresh after code changes:

```
pnpm check:offline-shell
```

Restarting `turbo dev` does not refresh the app code embedded in downloaded HTML
files; rebuild the offline shell when those files should carry new code forward.

Run storybook:

```
cd apps/mind-map-sv
pnpm run storybook
```

Push to Chromatic:

```
cd apps/mind-map-sv
pnpm run chromatic
```

Run the app in docker:

```
cd apps/mind-map-sv
docker compose up
```

The image builds from the repo root against the workspace lockfile — the same
one CI installs from — and serves the static build. There is a `db` service
alongside it for the server work that is planned; nothing talks to it yet, and
`docker compose up app` skips it.

Run tests:

```
pnpm --filter mind-map-sv test:unit -- --run
pnpm --filter mind-map-sv test:e2e
```
