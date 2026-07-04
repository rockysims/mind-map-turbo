# Milestone 04n: Reliable propagated HTML app shell

**Status:** complete
**Depends on:** milestone 04l (self-contained HTML save files) and milestone
04m (single-document save UX).
**Plan:** [2026-07-04 04n-reliable-propagated-html-app-shell.md](../plans/2026-07-04%2004n-reliable-propagated-html-app-shell.md)

## Goal

Make self-contained HTML documents reliably propagate the app, not the app's
already-rendered runtime DOM.

Users should be able to download a graph document from localhost or from an
opened `.html` save file, open the downloaded file, continue editing, and
download descendants without creating inert duplicate UI that blocks controls.
Developers should also have an explicit workflow for getting code changes into
the propagated offline shell.

## Scope

### Clean export shell boundary

- Separate "HTML that can run offline" from "HTML that is safe to reuse as an
  export template."
- Avoid using hydrated `document.documentElement.outerHTML` as the normal export
  shell.
- Capture or mark an export shell that contains the app boot code and static
  assets, but no rendered Svelte UI and no stale graph payload.
- Keep HTML graph payload insertion in the existing inert JSON script format.

### Propagation behavior

- Downloading from an opened self-contained `.html` save produces a clean
  descendant document with one active app instance and one embedded graph
  payload.
- Descendant files keep the same runnable app code unless the user explicitly
  downloads from a newer app shell.
- New, Open, Download, and graph interaction controls remain clickable across
  at least two generations of exported documents.

### Developer shell freshness

- Make it clear that restarting `turbo dev` is not sufficient to update
  propagated app code.
- Keep `static/offline-app-shell.html` aligned with the build output when code
  changes are intended to ship inside downloaded documents.
- Add validation or documentation so stale offline shell artifacts are caught
  before a change is called done.

## Acceptance criteria

- Export shell generation has a named, tested boundary separate from ordinary
  embedded-payload parsing.
- Downloaded HTML never includes a serialized `.page-shell`, `.graph-toolbar`,
  `.graph`, `#svelte-announcer`, or other rendered runtime DOM after the app
  boot scripts.
- Downloaded HTML contains exactly one `mind-map-embedded-graph` payload.
- Downloading from a downloaded file creates a second-generation file whose New,
  Open, and Download buttons are clickable.
- Browser coverage verifies localhost/app-shell download, open downloaded file,
  download a descendant, open the descendant, and interact with the toolbar.
- Browser coverage verifies a fixed working document can Open an old/broken HTML
  document as selected file text and then Download a clean working replacement.
- Developer validation explains or enforces that `pnpm --filter mind-map-sv build`
  refreshes the propagated offline shell; restarting `turbo dev` alone does not.
- Lint, check, unit tests, and relevant e2e propagation tests pass.

## Non-goals

- Native save-in-place or File System Access API flows.
- Repairing already-downloaded broken descendants in place.
- Changing the graph payload schema unless needed for a small app-shell marker.
- Compression, signing, encryption, sandboxing, or trust UI.
- Reintroducing a graph library or broad local draft manager.
- Server persistence, accounts, or multiplayer changes.

## Risks and open questions

Resolved in the plan; kept here for context.

- **How should the app obtain a clean export shell from an opened HTML file?**
  The plan should prefer a pre-hydration captured shell or explicit shell marker
  over broad DOM cleanup.
- **Should localhost Download package hot dev-server code?** The current model
  uses the generated offline shell; the plan should decide whether to preserve
  that model or add a development-only override.
- **How should stale `static/offline-app-shell.html` be prevented?** The plan
  should add a guardrail that catches forgotten builds without making ordinary
  development painful.
- **How much browser coverage is enough?** The plan should cover at least a
  second-generation document and toolbar clickability, because that is the
  failure mode that escaped earlier tests.
- **What should happen to already-broken files?** The plan should decide whether
  recovery should happen through the fixed app's Open flow rather than through
  the broken file's own blocked toolbar.
