<!--
  Title should follow Conventional Commits, e.g.:
    feat(graph): add togglePinned mutation with hops recomputation
  Full convention: .cursor/rules/commits.mdc
-->

## What

<!-- One or two sentences describing the user-visible change. -->

## Why

<!-- Why this change exists. Link the milestone/plan it delivers against. -->

- Milestone: `docs/roadmaps/<roadmap>/milestones/<milestone>.md`
- Plan: `docs/roadmaps/<roadmap>/plans/<YYYY-MM-DD> <name>.md` (if applicable)

## How

<!-- Brief notes on approach, alternatives considered, trade-offs. -->

## Definition of Done

- [ ] New behavior has tests
  - [ ] Pure functions: unit spec colocated with the source
  - [ ] Component behavior: Storybook story with `play`
  - [ ] Persistence / multi-page flow: Playwright e2e
- [ ] `pnpm --filter mind-map-sv lint` passes
- [ ] `pnpm --filter mind-map-sv check` passes (svelte-check)
- [ ] `pnpm --filter mind-map-sv test:unit -- --run` passes
- [ ] Touched gestures / layout / visuals? Story renders correctly in
      `pnpm --filter mind-map-sv storybook`
- [ ] Commits follow Conventional Commits, one logical change per commit
- [ ] No tracked changes to `.svelte-kit/`, build outputs, or
      `*storybook*.log`
- [ ] Updated docs / rules / milestone status if behavior or conventions
      changed

## Screenshots / video (if visual)

<!-- Drop screenshots, screen recordings, or Chromatic links here. -->
