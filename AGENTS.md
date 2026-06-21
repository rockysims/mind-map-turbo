# Agent guide

> This is a Turborepo with one SvelteKit 2 / Svelte 5 (runes mode) app at
> `apps/mind-map-sv`. Cursor-specific guidance lives in `.cursor/rules/*.mdc`;
> Codex reusable workflows live in `.agents/skills/*`. This file mirrors the
> universal parts so any agent (Codex, Aider, Cline, etc.) gets the same
> expectations.

## How to run things

| Goal                             | Command                                        |
| -------------------------------- | ---------------------------------------------- |
| Install                          | `pnpm install`                                 |
| Dev server                       | `pnpm -w dev` (or `turbo run dev`)             |
| Build                            | `pnpm -w build`                                |
| Lint                             | `pnpm --filter mind-map-sv lint`               |
| Type check                       | `pnpm --filter mind-map-sv check`              |
| Unit + browser + storybook tests | `pnpm --filter mind-map-sv test:unit -- --run` |
| E2E                              | `pnpm --filter mind-map-sv test:e2e`           |
| Storybook (interactive)          | `pnpm --filter mind-map-sv storybook`          |

Node ≥ 20 and pnpm 9 are required.

## Architecture

- **Pure logic first.** Behavior goes in pure TypeScript modules under
  `src/lib/components/<Component>/lib/*.ts`, each with a colocated
  `*.spec.ts`. Components hold state and wire up the pure functions.
- **Three Vitest projects.** `server` (node, pure specs), `client`
  (browser, component-level), `storybook` (browser, story `play` functions).
  See `apps/mind-map-sv/vite.config.ts`.
- **Storybook stories double as behavior tests** via `play` functions, run
  by both Storybook UI and the `storybook` Vitest project. Use the
  `StageHarness.svelte` pattern: harness exposes callback firings as
  `data-last-*` attributes; story `play` asserts on those.

## Definition of Done

Every change must satisfy these before being claimed complete:

1. New behavior has tests (unit spec for pure functions; story `play` for
   component behavior).
2. `pnpm --filter mind-map-sv lint` passes.
3. `pnpm --filter mind-map-sv check` passes.
4. `pnpm --filter mind-map-sv test:unit -- --run` passes.
5. Commit messages follow Conventional Commits (`feat`, `fix`, `refactor`,
   `test`, `docs`, `chore`, etc.).
6. No tracked changes to `.svelte-kit/`, build outputs, or `*storybook*.log`.

You must actually run those commands and report results. Do not claim done
based on vibes.

## Where things live

| Concern                   | Path                                                                    |
| ------------------------- | ----------------------------------------------------------------------- |
| Pure graph/layout/physics | `apps/mind-map-sv/src/lib/components/ui/Multigraph/lib/*.ts`            |
| Components                | `apps/mind-map-sv/src/lib/components/ui/<Name>/<Name>.svelte`           |
| Stories                   | `apps/mind-map-sv/src/lib/components/ui/<Name>/<Name>.stories.svelte`   |
| Unit specs                | colocated next to the source as `*.spec.ts`                             |
| Test fixtures             | `apps/mind-map-sv/src/lib/components/ui/Multigraph/lib/testFixtures.ts` |
| Shared types              | `apps/mind-map-sv/src/lib/components/ui/types/*.ts`                     |
| Constants                 | `apps/mind-map-sv/src/lib/constants.ts`                                 |
| E2E                       | `apps/mind-map-sv/e2e/*.test.ts`                                        |
| Roadmaps & plans          | `docs/roadmaps/<YYYY-MM-DD> <name>/`                                    |
| Plan template             | `docs/roadmaps/PLAN_TEMPLATE.md`                                        |
| Codex plan workflow       | `.agents/skills/mm-plan/SKILL.md`                                       |

## Coding conventions (highlights)

- **Svelte 5 runes only.** `$state`, `$derived`, `$props`, `$effect`. No
  `$:`, no `export let`, no `on:click` (use `onclick`).
- **Immutable updates.** Mutations to `MultigraphData` must return a new
  object — never assign in place. Wrap any state change in a tested pure
  function in `lib/graph.ts` (or similar).
- **Tunables as parameters.** Functions that depend on a constant (radius,
  falloff, threshold) take it as a parameter with a default. Tests pin it.
- **Pointer Events** for all gesture work. Reference: `Stage.svelte`.
- **No `any`, no unexplained `as` casts.** If you need an assertion, add a
  one-line comment explaining why TS can't see it.

## Commits

Conventional Commits, one logical change per commit. Body explains _why_,
diff shows _what_.

```
feat(graph): add togglePinned mutation with hops recomputation
fix(stage): release pointer capture on pointercancel during pinch
refactor(node): extract description scroll into its own container
test(layout): cover scaleByHops floor and falloff edge cases
docs(roadmap): mark milestone 02 complete
chore(deps): bump @storybook/addon-vitest to ^10.3
```

Full details: `.cursor/rules/commits.mdc`.

## Process for new work

1. Read the active roadmap in `docs/roadmaps/` and the relevant milestone
   doc to confirm scope.
2. If the milestone doesn't have a current plan, write one in
   `plans/<YYYY-MM-DD> <name>.md` before coding. Use the structure in
   `docs/roadmaps/PLAN_TEMPLATE.md` (resolves open questions, decomposes
   into PR-sized tasks, lays out a parallel wave plan, and recommends an
   agent class per task). In Codex, use `$mm-plan`; in Cursor, use
   `.cursor/rules/plans.mdc`.
3. Add the pure function + spec first; wire it into the component second.
4. Add or update the relevant story.
5. Run lint, check, and tests; fix any failures.
6. If executing a roadmap plan, update the plan, milestone, and roadmap
   statuses before closing out.
7. Commit with Conventional Commits after validation passes unless the user
   explicitly asked not to commit yet.

If anything is ambiguous, prefer pausing to ask over guessing.
