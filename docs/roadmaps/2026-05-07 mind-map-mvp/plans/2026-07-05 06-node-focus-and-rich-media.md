# Plan: Node focus and rich media

**Created:** 2026-07-05
**Author:** Codex agent
**Milestone:** [milestones/06-node-focus-and-rich-media.md](../milestones/06-node-focus-and-rich-media.md)
**Status:** draft
**Total estimated effort:** L (8 tasks; focus-mode foundation, asset storage,
HTML asset propagation, and image zoom)

## Summary

Deliver a zoom-triggered node focus mode first, then extend node content with
offline image attachments that survive draft recovery and self-contained `.html`
save/export flows. The plan keeps graph camera behavior, focus surface behavior,
and image zoom behavior separated so each context can have its own clear clamps
and gestures.

## Open questions resolved

- **Transition architecture.** **Use a full-screen transition overlay rather
  than animating the graph camera back out.** Once the trigger fires, unrelated
  graph content should already be off screen; an overlay preserves that illusion
  and prevents other graph elements from reappearing during the border-reveal
  and circle-to-rounded-rectangle morph.
- **Trigger semantics.** **Only the node under the zoom focal point can trigger
  focus mode, and the trigger fires when that node's projected circle covers the
  viewport with a margin.** This makes the interaction intentional and testable
  even in crowded graphs.
- **Gesture conflicts.** **Each mode owns its own gesture context: Stage owns
  graph pan/zoom/drag, node focus owns its full-screen surface, and image zoom
  owns image pan/zoom.** Explicit ownership avoids pointer events leaking from
  overlays into the graph.
- **Discoverability.** **Add an explicit Focus action in the node action menu in
  addition to zoom-through.** The gesture can feel magical, but users still need
  a visible path into the mode.
- **Focus persistence.** **Treat focus mode as transient UI state, not persisted
  graph or view state.** Persisted `ViewState` can restore graph camera position,
  but it should not reopen a modal-like reading surface on load.
- **Storage architecture.** **Store asset metadata in the graph schema and draft
  image bytes in IndexedDB.** This keeps `localStorage` graph JSON small while
  preserving a graph-level asset manifest for import/export and deduplication.
- **HTML asset embedding.** **Embed referenced asset bytes in the `.html`
  document envelope at export time.** Portability/offline behavior wins over
  small file size for this milestone.
- **Quota handling.** **Use `navigator.storage.estimate()` when available and
  catch `QuotaExceededError` on every asset write.** Browser quotas are large
  compared with `localStorage` but not guaranteed, so the UI needs recoverable
  failure states.
- **Schema compatibility.** **Bump the graph/document schema and default older
  nodes to empty content/assets.** Existing files should remain valid, and newer
  HTML saves should use the established unsupported-newer-file fallback.
- **Search semantics.** **Index image alt text and captions as node text for
  find/filter, but not raw image bytes.** Users expect captions to be findable;
  OCR and binary analysis are out of scope.

## Out of scope (for this plan)

- Markdown/rich-text descriptions.
- OCR, automatic alt text, AI image analysis, or generated images.
- Image cropping, drawing, annotations, or destructive edits.
- Remote image URLs as primary storage.
- Compression, app-code deduplication, or binary save-file formats.
- Silent save-in-place over the opened `.html` file.
- Server persistence, accounts, or multiplayer asset synchronization.

## Tasks

> Each task is one PR-sized unit. The first wave separates pure focus geometry
> from schema work so focus-mode implementation and media storage can proceed
> with less same-file contention.

### T01 - Add pure node-focus geometry helpers

|                |                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| **Depends on** | -                                                                                                               |
| **Wave**       | 1                                                                                                               |
| **Agent**      | Default workhorse                                                                                               |
| **Effort**     | M                                                                                                               |
| **Files**      | `apps/mind-map-sv/src/lib/components/ui/Multigraph/lib/nodeFocus.ts`, `nodeFocus.spec.ts`, maybe `graphMath.ts` |
| **PR title**   | `feat(focus): add node focus trigger geometry`                                                                  |

Add pure helpers for graph-to-screen node bounds, viewport coverage threshold,
focal-node eligibility, and enter/exit hysteresis. Keep tunables explicit:
viewport margin, trigger coverage, and release coverage.

**Acceptance**

- Specs cover centered and off-center nodes, stage pan/scale, node layout scale,
  viewport-corner coverage, focal point outside the node, and overlapping nodes.
- Specs prove hysteresis prevents repeated enter/exit flicker around the
  threshold.
- Helpers do not import Svelte or DOM APIs.

### T02 - Add focus mode shell and transition overlay

|                |                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T01                                                                                                                  |
| **Wave**       | 2                                                                                                                    |
| **Agent**      | High-reasoning                                                                                                       |
| **Effort**     | L                                                                                                                    |
| **Files**      | `Multigraph.svelte`, `Stage.svelte`, `NodeFocusSurface.svelte`, `StageHarness.svelte`, focus stories/specs as needed |
| **PR title**   | `feat(focus): enter node focus from deep zoom`                                                                       |

Wire the focus trigger into `Multigraph` using full live view state from
`Stage`. Add a full-screen focus surface and entry/exit transition overlay that
starts from the selected node's screen circle, reveals the border, then morphs
to a rounded rectangular reading surface.

**Acceptance**

- Zooming deeply into a node enters focus mode without mutating graph data.
- The transition uses an overlay; unrelated graph content does not reappear
  during the border reveal.
- Escape and close exit focus mode and return pointer ownership to the graph.
- Reduced-motion mode skips or simplifies the morph.
- Story coverage asserts focus entry, exit, and transient state.

### T03 - Add explicit Focus action and polish focus UX

|                |                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| **Depends on** | T02                                                                                                  |
| **Wave**       | 3                                                                                                    |
| **Agent**      | Default workhorse                                                                                    |
| **Effort**     | M                                                                                                    |
| **Files**      | `NodeActionMenu.svelte`, `Multigraph.svelte`, `NodeFocusSurface.svelte`, `Multigraph.stories.svelte` |
| **PR title**   | `feat(focus): add node action entry point`                                                           |

Add a visible Focus command to the node action menu and refine the focus surface
for title/description reading, keyboard dismissal, focus return, and mobile
layout.

**Acceptance**

- Long-pressing a node exposes a Focus command.
- Focus action and zoom-through land in the same focus mode.
- Title and description are readable on phone and desktop viewports.
- Graph gestures do not fire through the focus surface.
- Stories cover explicit entry, mobile layout, and keyboard close.

### T04 - Add graph content and asset metadata schema

|                |                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| **Depends on** | -                                                                                                               |
| **Wave**       | 1                                                                                                               |
| **Agent**      | High-reasoning                                                                                                  |
| **Effort**     | M                                                                                                               |
| **Files**      | `types/node.ts`, `types/multigraph.ts`, `migrations.ts`, `graph.spec.ts`, `graphQuery.ts`, `graphQuery.spec.ts` |
| **PR title**   | `feat(graph): add node content asset metadata`                                                                  |

Add typed node content blocks and graph-level asset metadata without storing
large bytes in the graph JSON. Migrate older schemas to empty content/assets and
include image alt text/captions in node text search.

**Acceptance**

- Older schema payloads unwrap with `content: []` or equivalent empty defaults
  and no assets.
- New image content blocks reference graph asset ids and validate mime/type
  metadata.
- `graphQuery` matches image alt text and captions as node text.
- Specs cover valid/invalid content blocks, migration defaults, and query
  matching.

### T05 - Add IndexedDB draft asset storage

|                |                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------- |
| **Depends on** | T04                                                                                         |
| **Wave**       | 2                                                                                           |
| **Agent**      | High-reasoning                                                                              |
| **Effort**     | L                                                                                           |
| **Files**      | `src/lib/assets/*.ts`, `persistence.ts`, `documentStatus.ts`, `appConfig.ts`, related specs |
| **PR title**   | `feat(persistence): store graph image assets in indexeddb`                                  |

Create a browser asset-store abstraction backed by IndexedDB for draft image
blobs, scoped by graph/document id and asset id. Add storage estimation and
recoverable quota/error reporting hooks without changing the graph mutation API
more than necessary.

**Acceptance**

- Asset store can put/get/delete/list image blobs by document and asset id.
- Asset bytes are not serialized into `localStorage` draft graph JSON.
- Quota errors are caught and surfaced through a typed result.
- Storage estimate returns approximate usage/quota when available and a safe
  unavailable state otherwise.
- Specs cover asset scoping, deletion, replacement, and error classification.

### T06 - Add image attachment editing and focus previews

|                |                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| **Depends on** | T03, T04, T05                                                                                             |
| **Wave**       | 4                                                                                                         |
| **Agent**      | Default workhorse                                                                                         |
| **Effort**     | L                                                                                                         |
| **Files**      | `NodeEditSheet.svelte`, `NodeFocusSurface.svelte`, `Multigraph.svelte`, `graph.ts`, related stories/specs |
| **PR title**   | `feat(node): attach images to focused nodes`                                                              |

Let users add images to a node, preview them, edit alt text/captions, reorder
them, and remove them. Render image previews in focus mode using object URLs
from the asset store.

**Acceptance**

- Node edit UI supports adding supported image files and rejects unsupported
  mime types with a recoverable message.
- Users can edit caption/alt text, reorder images, and remove images.
- Removing an image removes or dereferences its asset bytes when no node content
  references it.
- Focus mode shows image previews with title, description, captions, and alt
  text.
- Stories cover upload/add, reorder, remove, and focus preview states.

### T07 - Embed and hydrate assets in self-contained HTML saves

|                |                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Depends on** | T04, T05                                                                                                                 |
| **Wave**       | 4                                                                                                                        |
| **Agent**      | High-reasoning                                                                                                           |
| **Effort**     | L                                                                                                                        |
| **Files**      | `graphFile.ts`, `graphFile.spec.ts`, `browserGraphFile.ts`, `graphPersistenceController.ts`, boot/draft recovery helpers |
| **PR title**   | `feat(files): embed graph image assets in html saves`                                                                    |

Extend the self-contained HTML document envelope to include referenced image
assets. On export, read draft blobs and embed them safely. On import or direct
boot, parse embedded assets without executing imported HTML and hydrate the
local draft asset store.

**Acceptance**

- Exported `.html` files include all assets referenced by node content.
- Opening an exported file offline restores image previews without adjacent
  files or network access.
- Importing HTML with assets replaces graph data and hydrates corresponding
  asset bytes.
- Specs cover payload escaping for alt/caption text, malformed asset payloads,
  missing referenced assets, unsupported mime types, and newer document fallback.
- E2E or browser coverage verifies export -> open/import -> image visible.

### T08 - Add deep image zoom and final validation

|                |                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------- |
| **Depends on** | T06, T07                                                                                           |
| **Wave**       | 5                                                                                                  |
| **Agent**      | Default workhorse                                                                                  |
| **Effort**     | M                                                                                                  |
| **Files**      | `NodeFocusSurface.svelte`, new `ImageZoomSurface.svelte`, `imageZoom.ts`, stories, e2e smoke tests |
| **PR title**   | `feat(focus): inspect node images with deep zoom`                                                  |

Add an image-specific zoom surface from focus-mode previews. The surface should
start from a scaled-down preview, allow deep zoom up to a context-aware clamp
based on natural image size, and constrain pan so users cannot lose the image.

**Acceptance**

- Clicking/tapping an image preview enters image zoom without changing graph
  camera state.
- Wheel and pinch zoom target the image focal point.
- Image zoom clamps are deeper than graph zoom and based on image dimensions.
- Pan clamps keep at least part of the image in view.
- Escape/back returns to node focus, then graph focus exits separately.
- Unit specs cover image zoom/pan math; stories cover desktop and mobile image
  inspection.
- Final validation runs lint, check, unit tests, story tests, and the relevant
  e2e offline asset flow.

## Wave plan

```text
Wave 1   T01  |  T04          (pure focus geometry and schema metadata)
Wave 2   T02  |  T05          (focus shell and IndexedDB asset store)
Wave 3   T03                  (explicit focus entry and UX polish)
Wave 4   T06  |  T07          (image editing/previews and HTML asset propagation)
Wave 5   T08                  (deep image zoom and final verification)
```

T02 and T05 can proceed in parallel after wave 1 because they touch different
surfaces. T06 and T07 can proceed in parallel only after the T05 asset-store
interface is stable; coordinate on shared asset types before starting wave 4.
T03 is serialized after T02 because it touches the same focus components and
action-menu wiring.

## Risks and rollback

- **Focus trigger feels surprising.** Keep the explicit Focus action and make
  zoom-through reversible; if the gesture tests poorly, disable the automatic
  trigger while retaining the focus surface.
- **Overlay geometry drifts from the selected node.** Keep the geometry pure and
  tested in T01; if the morph is unreliable, fall back to a simpler scale/fade
  overlay without changing focus-state semantics.
- **IndexedDB behavior differs across browsers.** Hide storage implementation
  behind a narrow asset-store API and keep draft graph JSON readable without
  asset bytes.
- **Quota failures lose user-selected images.** Treat add-image as a write that
  must complete before graph content references the asset id; show a recoverable
  error if the blob cannot be stored.
- **HTML save files become huge.** Surface estimated export size once assets are
  embedded and defer compression to a follow-up if real files become painful.
- **Asset metadata and bytes fall out of sync.** Add import/export validation
  for missing and unreferenced assets; prefer recoverable broken-image states
  over crashing.
- **Older app versions cannot parse asset-bearing saves.** Reuse the newer-file
  fallback path from self-contained HTML saves and keep schema-version tests
  explicit.
- **Image zoom conflicts with graph zoom.** Image zoom lives in its own overlay
  with its own pointer handlers and never forwards wheel/pinch events to Stage.

## Definition of Done (this plan)

- All 8 tasks are merged to `main`; milestone 06 acceptance criteria are
  satisfied.
- `pnpm --filter mind-map-sv lint` passes.
- `pnpm --filter mind-map-sv check` passes.
- `pnpm --filter mind-map-sv test:unit -- --run` passes.
- `pnpm --filter mind-map-sv test:e2e` passes for the offline asset flow, or the
  plan notes a concrete browser/tooling limitation.
- Storybook behavior tests for focus mode, image attachment UI, and image zoom
  pass.
- Plan status is `done`, milestone status is `complete`, and the roadmap row for
  milestone 06 is updated to `complete`.
- The finished work has been committed unless the user explicitly asks not to
  commit yet.

## Notes

- 2026-07-05: Initial plan created from the zoom-through focus-mode discussion.
  Decision: use an overlay transition so hidden graph content does not need a
  non-selected fade path.
- 2026-07-05: Image assets should be available offline inside `.html` saves.
  Draft storage uses IndexedDB to avoid pushing binary data into `localStorage`.
