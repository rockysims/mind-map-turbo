# Agent guide

> This is a Turborepo with one SvelteKit 2 / Svelte 5 (runes mode) app at
> `apps/mind-map-sv`. Cursor-specific guidance lives in `.cursor/rules/*.mdc`;
> Codex reusable workflows live in `.agents/skills/*`. This file mirrors the
> universal parts so any agent (Codex, Aider, Cline, etc.) gets the same
> expectations.
>
> Keep this file lean — it is read every session. If any guidance needs more
> than ~4 lines, put the long form in `docs/` and leave a one-line pointer
> here.

## How to run things

| Goal                                  | Command                                        |
| ------------------------------------- | ---------------------------------------------- |
| Install                               | `pnpm install`                                 |
| Dev server                            | `pnpm -w dev` (or `turbo run dev`)             |
| Build                                 | `pnpm -w build`                                |
| Lint                                  | `pnpm --filter mind-map-sv lint`               |
| Type check                            | `pnpm --filter mind-map-sv check`              |
| Unit + browser + storybook tests      | `pnpm --filter mind-map-sv test:unit -- --run` |
| Dead code (unused files/exports/deps) | `pnpm --filter mind-map-sv knip`               |
| E2E                                   | `pnpm --filter mind-map-sv test:e2e`           |
| Storybook (interactive)               | `pnpm --filter mind-map-sv storybook`          |

Node ≥ 20 is required; the pnpm version comes from `packageManager` in the
root `package.json` (pnpm 11 at the time of writing) — run `corepack enable`
and let it pick that up rather than pinning a version by hand.

Dev, e2e-preview, and Storybook ports are derived per worktree from its path
(`pnpm dev-ports` prints them and regenerates `.claude/launch.json`; runs
automatically on install). Never assume a server on another worktree's port
is serving your code.

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
5. `pnpm --filter mind-map-sv knip` passes — nothing is exported that nothing
   imports, and no file or dependency is left unreferenced. Prefer deleting a
   symbol over exporting it "just in case"; if it is genuinely internal, drop
   the `export` keyword rather than adding it to an ignore list.
6. Commit messages follow Conventional Commits (`feat`, `fix`, `refactor`,
   `test`, `docs`, `chore`, etc.).
7. Anything real you found and deliberately did not fix is filed in
   `docs/debt/` — dropping it and widening the change are both wrong.
8. No tracked changes to `.svelte-kit/`, build outputs, or `*storybook*.log`.

You must actually run those commands and report results. Do not claim done
based on vibes.

While iterating, run only the specs affected by your change (vitest path
filters); save the full gate suite for once, before committing or claiming
done. The full runs are the ones that count — the point is not to pay for
them after every small edit.

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
| Technical debt            | `docs/debt/` (conventions in `docs/debt/README.md`)                     |
| Agent reporting / footer  | `docs/agent-reporting.md`                                               |
| Plan template             | `docs/roadmaps/PLAN_TEMPLATE.md`                                        |
| Codex plan workflow       | `.agents/skills/mm-plan/SKILL.md`                                       |

## Technical debt

`docs/debt/` records compromises we knowingly carry — one file per item, and
`ls docs/debt/` is the index. File one when something real is out of scope for
the change you are making (a review's out-of-scope findings belong here rather
than dropped or force-fixed). Conventions: `docs/debt/README.md`.

## Reporting back

End every substantive turn with the status footer (`STATUS` / `NEEDS YOU` /
`MERGE`) so the user can tell at a glance whether the thread needs them, and
batch questions into one numbered list. Format and rules:
`docs/agent-reporting.md`.

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

## Git across worktrees

Multiple agents run in worktrees under `.claude/worktrees/`; branches like
`temp` are shared. Never check out a shared branch inside your worktree to
merge into it — update it in place with `git push . HEAD:<branch>`, which
only fast-forwards and fails loudly if someone advanced the branch
concurrently. If it's not a fast-forward, merge the target branch into yours
first, then push again. Never use bare `git stash` (the stash stack is
shared); prefer a temporary WIP commit.

Merging into `temp` needs an explicit user go-ahead every time. When work is
complete and gates are green, report readiness and wait — do not merge on
your own initiative.

Before your first commit on an auto-generated branch named
`claude/<random-words>-<hash>` (words unrelated to the task), rename it:
`git branch -m claude/<topic-slug>-<hash>`, keeping the hash suffix.

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
