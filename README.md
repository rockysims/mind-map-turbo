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

Run tests:
```
pnpm --filter mind-map-sv test:unit -- --run
pnpm --filter mind-map-sv test:e2e
```
