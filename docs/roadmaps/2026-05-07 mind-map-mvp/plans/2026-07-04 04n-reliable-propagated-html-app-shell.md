# Plan: Reliable propagated HTML app shell

**Created:** 2026-07-04
**Author:** Codex agent
**Milestone:** [milestones/04n-reliable-propagated-html-app-shell.md](../milestones/04n-reliable-propagated-html-app-shell.md)
**Status:** done
**Total estimated effort:** M (4 tasks; shell boundary, propagation coverage,
developer guardrail, and docs/status updates)

## Summary

Introduce a clean export-shell contract so self-contained HTML documents
propagate app code without serializing hydrated Svelte UI. Add second-generation
browser coverage and developer guardrails for refreshing the offline shell before
downloaded documents are treated as current.

## Open questions resolved

- **Clean shell source.** **Capture or derive a clean app shell before it is used
  for export, not by serializing live rendered DOM.** This keeps the export
  boundary independent of Svelte's current runtime DOM shape.
- **Legacy and broken document recovery.** **Recover old or broken HTML
  documents through a fixed app's Open flow, then Download a clean replacement.**
  This avoids making the broken file's own blocked toolbar or broad DOM cleanup
  part of the primary repair path.
- **Localhost Download and hot dev code.** **Preserve the generated offline
  shell model.** `Download` from localhost should package
  `static/offline-app-shell.html`; developers must run
  `pnpm --filter mind-map-sv build` when code changes should propagate.
- **Stale offline shell prevention.** **Add a validation guardrail instead of
  relying on memory.** A check should fail when the tracked offline shell is
  stale relative to the current build, or the standard validation should include
  a build step and diff check.
- **Propagation coverage depth.** **Test at least two generations.** The escaped
  bug appears only after downloading from an already-downloaded file, so one
  generation is not enough.
- **Already-broken files.** **Do not repair files in place or rely on their own
  toolbar.** Users can open the broken HTML from a fixed working document and
  then Download a clean replacement.

## Out of scope (for this plan)

- Save-in-place or File System Access API support.
- In-place mutation or rewriting of existing broken files in Downloads.
- New user-facing recovery UI beyond the existing Open flow.
- Direct self-healing when a broken file's inert serialized toolbar blocks its
  own Download button.
- Compression, signing, trust prompts, or app-shell deduplication.
- Multiplayer or server persistence changes.

## Tasks

> Each task is one PR-sized unit. T01 defines the contract, T02 proves the user
> flow, T03 makes the developer workflow explicit, and T04 updates roadmap
> status after implementation lands.

### ✓ T01 - Add a clean export-shell contract

|                |                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------- |
| **Depends on** | -                                                                                                  |
| **Wave**       | 1                                                                                                  |
| **Agent**      | High-reasoning                                                                                     |
| **Effort**     | M                                                                                                  |
| **Files**      | `apps/mind-map-sv/src/lib/htmlShell.ts`, `apps/mind-map-sv/src/routes/+page.svelte`, related specs |
| **PR title**   | `fix(files): export clean propagated html shell`                                                   |

Replace the current "self-contained means reusable" decision with a named clean
export-shell API. Prefer a shell captured or marked before Svelte renders, and
avoid using broad hydrated-DOM cleanup as the normal export path.

**Acceptance**

- Export shell generation is covered by unit specs for a pristine shell, a
  shell with the explicit clean-shell marker/capture, and a shell containing an
  old embedded graph payload.
- `exportHtmlShell()` no longer returns raw `currentHtmlShell()` merely because
  it is self-contained.
- Export shell output contains app boot scripts and styles, but no rendered
  `.page-shell`, `.graph-toolbar`, `.graph`, or `#svelte-announcer` markup.
- Existing embedded graph boot and Open flows still parse selected HTML as text
  without executing imported HTML.

### ✓ T02 - Verify second-generation HTML propagation

|                |                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------- |
| **Depends on** | T01                                                                                       |
| **Wave**       | 2                                                                                         |
| **Agent**      | Default workhorse                                                                         |
| **Effort**     | M                                                                                         |
| **Files**      | `apps/mind-map-sv/e2e/app.test.ts`, helper fixtures in the same file or nearby test utils |
| **PR title**   | `test(files): cover propagated html descendants`                                          |

Extend e2e coverage to download a document, open it, download a descendant, open
the descendant, and verify toolbar controls still work. Also cover the user
recovery path for old/broken documents by opening a broken HTML file through a
known-good app document and downloading a clean replacement.

**Acceptance**

- Browser test covers localhost or build-shell download -> open downloaded file
  -> download descendant -> open descendant.
- The test asserts the descendant contains exactly one graph payload.
- The test asserts serialized downloaded HTML does not include rendered runtime
  app containers after the boot scripts.
- The test clicks at least New, Open, and Download in a descendant document or
  otherwise proves those controls are live.
- A recovery test opens an old/broken HTML document through a fixed document's
  Open flow, downloads the selected graph, and opens the replacement with live
  toolbar controls.

### ✓ T03 - Add offline shell freshness guardrails

|                |                                                                                |
| -------------- | ------------------------------------------------------------------------------ |
| **Depends on** | -                                                                              |
| **Wave**       | 1                                                                              |
| **Agent**      | Default workhorse                                                              |
| **Effort**     | S                                                                              |
| **Files**      | `apps/mind-map-sv/package.json`, scripts/docs as needed, CI or validation docs |
| **PR title**   | `chore(files): guard offline shell freshness`                                  |

Make the developer workflow explicit: code changes do not reach propagated HTML
documents until the offline shell is rebuilt. Add a script, check, or documented
validation step that catches stale `static/offline-app-shell.html`.

**Acceptance**

- The repo exposes a clear command or validation step for refreshing/verifying
  the propagated offline shell.
- Documentation or package-script naming states that restarting `turbo dev` does
  not refresh downloaded app code.
- The guardrail can be run in CI or local validation without requiring network
  access.
- The plan's final validation includes the guardrail.

### ✓ T04 - Close roadmap status after validation

|                |                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------- |
| **Depends on** | T01, T02, T03                                                                                  |
| **Wave**       | 3                                                                                              |
| **Agent**      | Fast / cheap                                                                                   |
| **Effort**     | XS                                                                                             |
| **Files**      | `docs/roadmaps/2026-05-07 mind-map-mvp/roadmap.md`, this plan, milestone doc if status changes |
| **PR title**   | `docs(roadmap): mark propagated html shell milestone complete`                                 |

After implementation and validation, update milestone, plan, and roadmap status
without changing the historical 04l/04m records.

**Acceptance**

- Plan status changes from `draft` or `executing` to `done` only after all tasks
  and validation pass.
- Milestone and roadmap rows are updated consistently.
- Notes include final validation commands and any remaining shell-freshness
  caveats.

## Wave plan

```text
Wave 1   T01  |  T03
Wave 2   T02
Wave 3   T04
```

T01 and T03 can run together because the shell export contract and developer
guardrail mostly touch different files. T02 waits for the new export behavior so
the browser test verifies the final flow rather than the known broken state.

## Risks and rollback

- **Pre-hydration shell capture is hard to wire into SvelteKit boot timing.**
  Use an explicit clean-shell marker generated by the build step, while keeping
  tests that forbid rendered runtime DOM in downloads.
- **Build output is not byte-for-byte deterministic enough for a simple diff
  guard.** Fall back to a targeted freshness marker or documented build step
  plus e2e coverage rather than blocking development on noisy diffs.
- **Second-generation e2e tests are slow or browser-sensitive.** Keep the test
  focused on one graph, one descendant, and toolbar clickability; move broader
  browser matrices out of scope.
- **Existing broken files remain confusing.** Document that fixed app Open can
  recover their embedded payload and produce a clean replacement, but avoid
  expanding this plan into repair UI.

## Definition of Done (this plan)

- All 4 tasks are merged to `main`.
- The acceptance criteria from the milestone doc are satisfied.
- `pnpm --filter mind-map-sv lint` passes.
- `pnpm --filter mind-map-sv check` passes.
- `pnpm --filter mind-map-sv test:unit -- --run` passes.
- Relevant e2e propagation coverage passes.
- Offline shell freshness validation passes or its limitation is documented in
  the final notes.
- No tracked changes to `.svelte-kit/`, build outputs, or `*storybook*.log`.
- The finished work has been committed unless the user explicitly asks not to
  commit yet.

## Notes

- 2026-07-04: Investigation found that first-generation downloads from
  localhost use `static/offline-app-shell.html`, while second-generation
  downloads from an opened save file can reuse hydrated `outerHTML` and capture
  inert rendered controls. This plan treats that as a missing clean-shell
  boundary.
- 2026-07-04: Restarting `turbo dev` is not enough to update propagated app
  code. The offline shell is generated by `pnpm --filter mind-map-sv build`, and
  descendants inherit whatever app shell their parent file contains.
- 2026-07-04: User direction for old broken documents: it is sufficient to open
  a fixed working document, use Open to load the broken file as selected HTML
  text, then Download a clean replacement. The broken file does not need to
  repair itself through its own blocked toolbar.
- 2026-07-04: Implemented pre-hydration export-shell capture in the inlined
  offline shell, with export cleanup for old embedded graph payloads. Descendant
  downloads now reuse the clean captured shell instead of hydrated runtime DOM.
- 2026-07-04: Added e2e coverage for downloaded file -> descendant download ->
  descendant toolbar clickability, plus fixed-document Open recovery for a
  broken HTML document.
- 2026-07-04: Added `pnpm dev:downloadable` for the safe local ritual and
  `pnpm check:offline-shell` as a deterministic source-fingerprint guardrail.
  A raw build-output diff was too noisy because SvelteKit/minification can emit
  different internal symbols across fresh builds.
- 2026-07-04: Final validation passed:
  `pnpm --filter mind-map-sv lint`;
  `pnpm --filter mind-map-sv check`;
  `pnpm --filter mind-map-sv test:unit -- --run`;
  `pnpm --filter mind-map-sv test:e2e`;
  `pnpm check:offline-shell`.
