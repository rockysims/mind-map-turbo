# Plan: AI-readable example save file

**Created:** 2026-09-22
**Author:** Codex agent
**Milestone:** none — contained follow-up on
[milestone 04l](../milestones/04l-self-contained-html-save-files.md),
[milestone 04m](../milestones/04m-single-document-save-ux.md), and
[milestone 04n](../milestones/04n-reliable-propagated-html-app-shell.md)
**Status:** done
**Total estimated effort:** M

## Summary

Ship one canonical, runnable HTML save that teaches an AI agent how to author a
new mind map while also showing the same concepts as a real graph. Generate it
from the current offline app shell and gate it against format and shell drift so
it remains a trustworthy starting point as the app evolves.

## Open questions resolved

- **Artifact format.** **Use a self-contained `.html` save, not a JSON-only
  fixture.** The resulting file is both editable source for an agent and the
  exact document a person opens in the offline app.
- **AI discoverability.** **Put a short machine-facing guide immediately beside
  the embedded JSON payload and repeat the durable details in visible graph
  nodes.** An agent can find the payload without reading minified app code, while
  a person sees the same documentation in the map.
- **Schema breadth.** **Demonstrate the core authoring fields and document the
  optional advanced fields without manufacturing fake attachments or AI run
  history.** Codebase maps need nodes, edges, tags, direction, positions,
  descriptions, pins, and view state; binary assets are a separate container
  concern and dangling examples would be invalid.
- **Source of truth.** **Keep the tutorial graph in a small checked JavaScript
  generator and build the committed HTML from `static/offline-app-shell.html`.**
  A spec will parse the result through production code and pin its copied format
  versions to the app constants.
- **Freshness.** **Regenerate the example during the normal app build and make
  the offline-shell freshness check compare it byte-for-byte with a fresh
  in-memory generation.** A changed schema, guide, or shell therefore cannot
  leave a stale example unnoticed.
- **Roadmap placement.** **Treat this as a standalone persistence follow-up.** It
  strengthens the completed portable-file work without expanding milestone 15's
  intentionally narrower in-app AI scope.

## Out of scope

- Letting an in-app AI edit the graph directly.
- A general template gallery or template-selection UI.
- Scraping or analysing a codebase inside the mind-map app.
- Embedding sample binary assets, API keys, or real AI run history.
- Redesigning the graph file schema solely to make the tutorial possible.

## Tasks

### ✓ T01 — Define the tutorial graph and agent-facing guide

|                |                                                    |
| -------------- | -------------------------------------------------- |
| **Depends on** | —                                                  |
| **Wave**       | 1                                                  |
| **Agent**      | Default workhorse                                  |
| **Effort**     | S                                                  |
| **Files**      | `apps/mind-map-sv/scripts/example-save-file.mjs`   |
| **PR title**   | `feat(files): add an AI-readable example mind map` |

**Acceptance**

- The graph teaches the safe copy-and-edit recipe and the required envelope.
- Visible examples cover pins, seeded positions, node and edge tags, tag
  colours, directed and undirected edges, descriptions, and an add-on.
- Every node is within the normal visible hop budget of the pinned guide node.
- The machine-facing note tells an agent exactly which script element to edit
  and forbids changing the app shell or inventing asset references.

### ✓ T02 — Generate and gate the runnable HTML save

|                |                                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T01                                                                                                               |
| **Wave**       | 2                                                                                                                 |
| **Agent**      | Default workhorse                                                                                                 |
| **Effort**     | M                                                                                                                 |
| **Files**      | `scripts/inline-static-build.mjs`, `scripts/check-offline-shell-fresh.mjs`, generated `examples/ai-mind-map.html` |
| **PR title**   | `feat(files): generate the AI example from the offline shell`                                                     |

**Acceptance**

- `pnpm --filter mind-map-sv build` writes the example from the same shell used
  by Download.
- The generated file has one graph payload, current app/schema/reader stamps,
  no asset payloads, and opens as a valid graph document.
- `pnpm check:offline-shell` fails if either the shell or generated example is
  stale.
- Generation is deterministic for a given shell and source graph.

### ✓ T03 — Document the artifact and prove its teaching contract

|                |                                                                   |
| -------------- | ----------------------------------------------------------------- |
| **Depends on** | T02                                                               |
| **Wave**       | 3                                                                 |
| **Agent**      | Default workhorse                                                 |
| **Effort**     | S                                                                 |
| **Files**      | `src/lib/exampleSaveFile.spec.ts`, `README.md`, plan/status notes |
| **PR title**   | `test(files): keep the AI example save current`                   |

**Acceptance**

- A unit spec parses the committed HTML through `parseGraphFileText`, compares
  it to the canonical graph, and asserts copied format versions match the app.
- The spec pins the core authoring instructions and representative visual
  examples so the file cannot degrade into an opaque fixture.
- README links the example and states that build refreshes it.
- Full repository gates pass before the plan is marked done.

## Wave plan

```text
Wave 1   T01
Wave 2   T02
Wave 3   T03
```

The generated artifact and its contract tests both depend on the tutorial graph
being settled, so this is intentionally sequential.

## Risks and rollback

- **The committed HTML duplicates the large offline shell.** This is the cost of
  making the example independently runnable and handable to an agent; rollback
  removes the generated artifact and its build hook without touching user saves.
- **A copied version constant drifts.** The production-parser spec compares every
  copied format constant to its source and fails on the schema-changing commit.
- **Long documentation makes the visual graph crowded.** Keep titles short and
  put detail in descriptions, which users reach by focusing a node.
- **The example becomes a second product shell.** Generate it only from the
  canonical offline shell; never patch app code inside the example.

## Definition of Done

- All three tasks and their acceptance checks are complete.
- `pnpm --filter mind-map-sv lint` passes.
- `pnpm --filter mind-map-sv check` passes.
- `pnpm --filter mind-map-sv test:unit -- --run` passes.
- `pnpm --filter mind-map-sv knip` passes.
- `pnpm check:offline-shell` passes.
- No tracked `.svelte-kit/`, build-output, or Storybook-log changes remain.
- The implementation is committed with a Conventional Commit.

## Notes

- 2026-09-22: Investigation found the current document format at schema 8 and
  HTML reader 4. HTML saves carry their graph in the inert
  `mind-map-embedded-graph` JSON script before the executable app bundle; this
  gives an agent one stable edit target while preserving the tested shell.
- 2026-09-22: The tutorial uses one pinned root and keeps every example within
  three authored-edge hops, matching the default visible-neighbourhood budget.
- 2026-09-22: The first production-parser test caught a literal `<script>` tag
  in the explanatory HTML comment being mistaken for the payload start. The
  guide now names the script element without reproducing its opening tag, and
  the contract test pins exactly one payload.
- 2026-09-22: The build now writes
  `apps/mind-map-sv/examples/ai-mind-map.html` from the current offline shell.
  The freshness command regenerates it in memory and compares byte-for-byte;
  the build stamp ignores both generated HTML products to avoid false `-dirty`
  stamps on repeated builds.
- 2026-09-22: Final validation passed:
  `pnpm --filter mind-map-sv build`;
  `pnpm --filter mind-map-sv lint`;
  `pnpm --filter mind-map-sv check`;
  `pnpm --filter mind-map-sv test:unit -- --run` (2,556 passed, 7 skipped);
  `pnpm --filter mind-map-sv knip`;
  `pnpm check:offline-shell`.
