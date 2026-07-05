# Plan: Node focus and rich media

**Created:** 2026-07-04
**Author:** Codex agent
**Milestone:** [milestones/06-node-focus-and-rich-media.md](../milestones/06-node-focus-and-rich-media.md)
**Status:** draft
**Total estimated effort:** XL (13 tasks across 7 waves; pre-work wave,
focus-mode foundation, asset storage, HTML asset propagation, and image zoom)

## Summary

Deliver a zoom-through node focus mode first, then extend node content with
offline image attachments that survive draft recovery and self-contained `.html`
save/export flows. A pre-work wave clears architectural blockers (live view
state, focal pinch zoom, async export, dead open-state UI, reduced-motion
handling) so the feature waves stay PR-sized. Graph camera behavior, focus
surface behavior, and image zoom behavior stay separated so each context has its
own clear clamps and gestures.

## Open questions resolved

- **Transition architecture.** **Use a full-screen transition overlay rather
  than animating the graph camera back out.** Once the trigger fires, unrelated
  graph content should already be off screen; an overlay preserves that illusion
  and prevents other graph elements from reappearing during the border-reveal
  and circle-to-rounded-rectangle morph.
- **Trigger semantics.** **Enter focus with a zoom-through gesture: once graph
  zoom reaches `maxScale` with the focal point over a node, continued deliberate
  zoom input past the clamp commits the transition.** A viewport-coverage
  trigger is unreachable for most nodes at the current max zoom (only pinned
  nodes can cover a desktop viewport), so the commit signal is extra zoom input
  beyond the clamp, not projected node size.
- **Bump protection.** **Use an overshoot accumulator with decay for both entry
  and exit.** Blocked zoom input at a boundary accumulates into a 0-to-1
  commitment value that decays back toward 0 when input pauses; a brief bump
  evaporates, a bold sustained gesture commits. The same pure model drives
  zoom-in entry, zoom-out exit from focus mode, and zoom-out exit from image
  zoom, and its progress value can drive visual feedback so users learn the
  gesture by seeing it start.
- **Gesture conflicts.** **Each mode owns its own gesture context: Stage owns
  graph pan/zoom/drag, node focus owns its full-screen surface, and image zoom
  owns image pan/zoom.** Explicit ownership avoids pointer events leaking from
  overlays into the graph.
- **Exit surface.** **Exit focus mode via Escape, a close control in the upper
  right, or a bold zoom-out; browser Back/history integration is out of
  scope.** History wiring would interact with the existing `file://` hash
  routing for little payoff in this milestone.
- **Discoverability.** **Add an explicit Focus action in the node action menu in
  addition to zoom-through.** The gesture can feel magical, but users still need
  a visible path into the mode.
- **Focus persistence.** **Treat focus mode as transient UI state, not persisted
  graph or view state.** Persisted `ViewState` can restore graph camera position,
  but it should not reopen a modal-like reading surface on load.
- **Storage architecture.** **Store asset metadata in the graph schema and draft
  image bytes in IndexedDB, scoped by the same draft graph id `persistence.ts`
  already uses (`document:{documentId}` or the URL graph id).** This keeps
  `localStorage` graph JSON small while preserving a graph-level asset manifest
  for import/export, and asset scope always matches the draft it belongs to.
- **HTML asset embedding.** **Embed each referenced asset as its own inert
  script tag (base64 body, asset id attribute) next to the existing graph
  payload script.** Per-asset tags keep the graph JSON payload small and
  parseable, avoid one giant base64-in-JSON string, and base64 bodies cannot
  contain `<`, which keeps escaping trivial.
- **Quota handling.** **Catch `QuotaExceededError` on every asset write and
  surface a typed recoverable result.** The storage-use display was dropped from
  scope; quota failures still need recoverable UI states.
- **Schema compatibility.** **Bump the graph schema to v4 and
  `GRAPH_HTML_READER_VERSION` to 2 together.** v4 defaults older nodes to empty
  content/assets. The reader bump matters because the open-in-new-tab fallback
  only triggers on `minReaderVersion`, not on graph `schemaVersion`; without it,
  older apps would show a dead-end error for asset-bearing saves instead of
  handing the file to its own embedded app.
- **Search semantics.** **Index image alt text and captions as node text for
  find/filter, but not raw image bytes.** Users expect captions to be findable;
  OCR and binary analysis are out of scope.
- **IndexedDB test strategy.** **Test the asset store with `fake-indexeddb` in
  the existing `server` Vitest project.** A dev-dependency plus a spec import is
  the simplest harness; the store's logic (scoping, replacement, error
  classification) does not need a real browser.

## Out of scope (for this plan)

- Markdown/rich-text descriptions.
- OCR, automatic alt text, AI image analysis, or generated images.
- Image cropping, drawing, annotations, or destructive edits.
- Remote image URLs as primary storage.
- Compression, app-code deduplication, or binary save-file formats.
- Silent save-in-place over the opened `.html` file.
- Server persistence, accounts, or multiplayer asset synchronization.
- Browser Back/history integration for exiting focus mode or image zoom.
- Storage-use display or export-size estimates.

## Tasks

> Tasks T01-T05 are a pre-work wave: small, independently shippable changes that
> clear architectural blockers and cruft before feature work. Each later task is
> one PR-sized unit.

### T01 - Expose full live view state and inverse coordinate helper

|                |                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| **Depends on** | -                                                                                                             |
| **Wave**       | 1                                                                                                             |
| **Agent**      | Default workhorse                                                                                             |
| **Effort**     | S                                                                                                             |
| **Files**      | `Stage.svelte`, `Multigraph.svelte`, `stageCoordinates.ts`, `stageCoordinates.spec.ts`, `StageHarness.svelte` |
| **PR title**   | `refactor(stage): expose live view state and graph-to-client helper`                                          |

Track the full live `{ panX, panY, scale }` in `Multigraph` (today only `scale`
is tracked live). Add `graphPointToClientPoint`, the inverse of
`clientPointToGraphPoint`, so overlay geometry can be computed from graph
positions.

**Acceptance**

- `Multigraph` receives live pan and scale via `onViewStateLiveChange`.
- `graphPointToClientPoint` round-trips with `clientPointToGraphPoint` in specs
  across pan, scale, and stage-rect variations.
- `StageHarness` records live view state as a `data-last-*` attribute; existing
  Stage stories still pass.

### T02 - Make pinch zoom focal like wheel zoom

|                |                                                                    |
| -------------- | ------------------------------------------------------------------ |
| **Depends on** | T01                                                                |
| **Wave**       | 2                                                                  |
| **Agent**      | Default workhorse                                                  |
| **Effort**     | S                                                                  |
| **Files**      | `Stage.svelte`, `graphMath.ts`, `graphMath.spec.ts`, Stage stories |
| **PR title**   | `fix(stage): zoom pinch gestures about the pinch centroid`         |

Wheel zoom keeps the point under the cursor fixed via
`zoomViewTransformAtPoint`, but pinch only rescales without adjusting pan. Make
pinch zoom about the pinch centroid so "the node under the zoom focal point" is
well defined on mobile before zoom-through semantics land.

**Acceptance**

- During a pinch, the graph point under the pinch centroid stays fixed on
  screen (pure math specs reuse `zoomViewTransformAtPoint`).
- `onViewStateChange` still fires once at pinch end.
- Story or harness coverage exercises a pinch and asserts the resulting view
  state.

### T03 - Make the document export pipeline async

|                |                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------- |
| **Depends on** | -                                                                                             |
| **Wave**       | 1                                                                                             |
| **Agent**      | Default workhorse                                                                             |
| **Effort**     | S                                                                                             |
| **Files**      | `graphPersistenceController.ts`, `browserGraphFile.ts`, `+page.svelte`, related specs/stories |
| **PR title**   | `refactor(files): make graph document export asynchronous`                                    |

`exportGraphDocument` and the download path are synchronous today; embedding
assets requires reading blobs from IndexedDB first. Convert the export/download
flow to async now, with no behavior change, so T12 stays focused on the asset
format.

**Acceptance**

- Export and download flows behave identically (existing export/propagation
  e2e tests pass unchanged).
- Export entry points return promises; no synchronous callers remain.

### T04 - Remove unused Node open-state UI

|                |                                                      |
| -------------- | ---------------------------------------------------- |
| **Depends on** | T01                                                  |
| **Wave**       | 2                                                    |
| **Agent**      | Fast / cheap                                         |
| **Effort**     | XS                                                   |
| **Files**      | `Node.svelte`, `Multigraph.svelte`, Node stories     |
| **PR title**   | `refactor(node): remove unused open-state rendering` |

`Node.isOpen` and its open-state rendering are never enabled from `Multigraph`.
The focus surface is an overlay, not a node state, so delete the dead path
before building the new surface next to it.

**Acceptance**

- `isOpen` prop and open-state markup/styles are gone from `Node.svelte` and
  its call sites.
- Lint, check, unit, and story tests pass with no visual change to rendered
  nodes.

### T05 - Centralize reduced-motion handling

|                |                                                                                |
| -------------- | ------------------------------------------------------------------------------ |
| **Depends on** | -                                                                              |
| **Wave**       | 1                                                                              |
| **Agent**      | Fast / cheap                                                                   |
| **Effort**     | XS                                                                             |
| **Files**      | new `src/lib/reducedMotion.ts` (or documented pattern), `NodeEditSheet.svelte` |
| **PR title**   | `refactor(ui): centralize reduced-motion handling`                             |

Reduced-motion support exists only as one ad hoc CSS block in `NodeEditSheet`.
Add a small shared helper (SSR-safe `prefersReducedMotion()` plus the CSS
convention) and adopt it in `NodeEditSheet`, so the focus morph (T07) and image
zoom (T13) reuse one pattern instead of adding two more ad hoc blocks.

**Acceptance**

- A shared helper/pattern exists with minimal test coverage.
- `NodeEditSheet` uses it; sheet behavior under reduced motion is unchanged.

### T06 - Add pure zoom-through focus geometry

|                |                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------- |
| **Depends on** | -                                                                                        |
| **Wave**       | 3                                                                                        |
| **Agent**      | Default workhorse                                                                        |
| **Effort**     | M                                                                                        |
| **Files**      | `Multigraph/lib/nodeFocus.ts`, `nodeFocus.spec.ts`, `appConfig.ts`, maybe `graphMath.ts` |
| **PR title**   | `feat(focus): add zoom-through trigger geometry`                                         |

Add pure helpers for node screen-circle bounds from live view state,
focal-node eligibility (focal point inside the node's projected circle at
`maxScale`), and the overshoot accumulator: blocked zoom input at a boundary
accumulates toward a commit threshold and decays with a half-life when input
pauses. Keep tunables explicit (commit threshold as a blocked-zoom factor,
decay half-life, eligibility coverage) with defaults in `appConfig.ts`.

**Acceptance**

- Specs cover centered and off-center nodes, stage pan/scale, node layout
  scale, focal point outside the node, and overlapping nodes.
- Accumulator specs prove: brief bumps decay without committing, sustained bold
  input commits, the model is symmetric for zoom-in entry and zoom-out exit,
  and hysteresis prevents an immediate re-trigger after a transition.
- Helpers do not import Svelte or DOM APIs; tunables are parameters with
  defaults.

### T07 - Enter and exit focus mode via zoom-through overlay

|                |                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T01, T02, T05, T06                                                                                                               |
| **Wave**       | 4                                                                                                                                |
| **Agent**      | High-reasoning                                                                                                                   |
| **Effort**     | L                                                                                                                                |
| **Files**      | `Stage.svelte`, `Multigraph.svelte`, new `focusRuntime.svelte.ts`, new `NodeFocusSurface.svelte`, `StageHarness.svelte`, stories |
| **PR title**   | `feat(focus): enter node focus from zoom-through`                                                                                |

Have Stage report blocked zoom input at the scale clamps (wheel and pinch, with
the focal point) so the T06 accumulator can run. Put focus-mode state in a new
`focusRuntime.svelte.ts` runes module following the `layoutRuntime.svelte.ts`
pattern — do not inline orchestration into the already-large
`Multigraph.svelte`. Add the full-screen focus surface and entry/exit
transition overlay that starts from the node's screen circle (via
`graphPointToClientPoint`), reveals the border, then morphs to a rounded
rectangular reading surface. Drive entry-progress visual feedback from the
accumulator value so a partial gesture shows a hint and backing off cancels.

**Acceptance**

- A bold zoom past max zoom with the focal point over a node enters focus mode;
  a brief bump shows partial feedback and decays without entering.
- A bold zoom-out inside focus mode exits; a brief bump does not.
- The transition uses an overlay; unrelated graph content does not reappear
  during the border reveal; entry/exit does not mutate graph data.
- Escape and the close control exit focus mode and return pointer ownership to
  the graph.
- Reduced motion (T05 pattern) skips or simplifies the morph.
- Story coverage asserts entry, both exit paths, and transient state.

### T08 - Add explicit Focus action and polish focus UX

|                |                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| **Depends on** | T07                                                                                                  |
| **Wave**       | 5                                                                                                    |
| **Agent**      | Default workhorse                                                                                    |
| **Effort**     | M                                                                                                    |
| **Files**      | `NodeActionMenu.svelte`, `Multigraph.svelte`, `NodeFocusSurface.svelte`, `Multigraph.stories.svelte` |
| **PR title**   | `feat(focus): add node action entry point`                                                           |

Add a visible Focus command to the node action menu and refine the focus surface
for title/description reading, an upper-right close control, keyboard dismissal,
focus return, and mobile layout.

**Acceptance**

- Long-pressing a node exposes a Focus command.
- Focus action and zoom-through land in the same focus mode.
- Title and description are readable on phone and desktop viewports; the close
  control sits in the upper right.
- Graph gestures do not fire through the focus surface.
- Stories cover explicit entry, mobile layout, and keyboard close.

### T09 - Add graph content and asset metadata schema (v4)

|                |                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | -                                                                                                                    |
| **Wave**       | 3                                                                                                                    |
| **Agent**      | High-reasoning                                                                                                       |
| **Effort**     | M                                                                                                                    |
| **Files**      | `types/node.ts`, `types/multigraph.ts`, `migrations.ts`, `migrations.spec.ts`, `graphQuery.ts`, `graphQuery.spec.ts` |
| **PR title**   | `feat(graph): add node content asset metadata`                                                                       |

Add typed node content blocks and graph-level asset metadata without storing
large bytes in the graph JSON. Bump `CURRENT_SCHEMA_VERSION` to 4 with a v3-to-v4
migration defaulting older payloads to empty content/assets (v3 validation is
strict, so optional-field sneaking is not an option). Include image alt
text/captions in node text search.

**Acceptance**

- v1/v2/v3 payloads unwrap with `content: []` (or equivalent) and no assets;
  unknown versions still throw `unsupported-version`.
- New image content blocks reference graph asset ids and validate mime/type
  metadata.
- `graphQuery` matches image alt text and captions as node text.
- Specs cover valid/invalid content blocks, migration defaults, and query
  matching.

### T10 - Add IndexedDB draft asset storage

|                |                                                                        |
| -------------- | ---------------------------------------------------------------------- |
| **Depends on** | T09                                                                    |
| **Wave**       | 4                                                                      |
| **Agent**      | High-reasoning                                                         |
| **Effort**     | L                                                                      |
| **Files**      | `src/lib/assets/*.ts`, `persistence.ts`, `appConfig.ts`, related specs |
| **PR title**   | `feat(persistence): store graph image assets in indexeddb`             |

Create a browser asset-store abstraction backed by IndexedDB for draft image
blobs, scoped by the same draft graph id `persistence.ts` uses for the graph
JSON (`document:{documentId}` or the URL graph id) plus asset id. Catch quota
errors and surface them through typed recoverable results without changing the
graph mutation API more than necessary.

**Acceptance**

- Asset store can put/get/delete/list image blobs keyed by draft graph id and
  asset id, and the scope key provably matches the draft key derivation in
  `persistence.ts`.
- Asset bytes are not serialized into `localStorage` draft graph JSON.
- `QuotaExceededError` (and quota-like failures) are caught and surfaced
  through a typed result.
- Specs run in the `server` Vitest project against `fake-indexeddb` and cover
  asset scoping, deletion, replacement, and error classification.

### T11 - Add image attachment editing and focus previews

|                |                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| **Depends on** | T08, T09, T10                                                                                             |
| **Wave**       | 6                                                                                                         |
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
- Adding an image only references the asset id after the blob write succeeds; a
  failed write surfaces a recoverable error.
- Focus mode shows image previews with title, description, captions, and alt
  text.
- Stories cover upload/add, reorder, remove, and focus preview states.

### T12 - Embed and hydrate assets in self-contained HTML saves

|                |                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Depends on** | T03, T09, T10                                                                                                            |
| **Wave**       | 6                                                                                                                        |
| **Agent**      | High-reasoning                                                                                                           |
| **Effort**     | L                                                                                                                        |
| **Files**      | `graphFile.ts`, `graphFile.spec.ts`, `browserGraphFile.ts`, `graphPersistenceController.ts`, boot/draft recovery helpers |
| **PR title**   | `feat(files): embed graph image assets in html saves`                                                                    |

Extend the self-contained HTML document envelope with one inert script tag per
referenced asset (base64 body, asset id attribute) alongside the existing graph
payload script, and bump `GRAPH_HTML_READER_VERSION` to 2 so older apps route
asset-bearing files to the established open-in-new-tab fallback. On export,
read draft blobs (async, per T03) and embed them. On import or direct boot,
parse embedded assets without executing imported HTML, hydrate the draft asset
store, and clear stale asset bytes for that document that are no longer
referenced (including when the user discards a draft in the recovery conflict
dialog).

Note: export-behavior changes require `pnpm --filter mind-map-sv build` to
refresh `static/offline-app-shell.html` before the e2e suite runs; the dev
server alone is not sufficient.

**Acceptance**

- Exported `.html` files include one asset script tag per referenced asset and
  export `minReaderVersion: 2`.
- Opening an exported file offline restores image previews without adjacent
  files or network access.
- Importing HTML with assets replaces graph data, hydrates corresponding asset
  bytes, and removes unreferenced asset bytes for that document id; the
  discard-draft path also cleans up.
- Specs cover payload escaping for alt/caption text, malformed asset payloads,
  missing referenced assets, unsupported mime types, and the reader-version
  fallback for older apps.
- E2E or browser coverage verifies export -> open/import -> image visible.

### T13 - Add deep image zoom and close out the milestone

|                |                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| **Depends on** | T11, T12                                                                                                 |
| **Wave**       | 7                                                                                                        |
| **Agent**      | Default workhorse                                                                                        |
| **Effort**     | M                                                                                                        |
| **Files**      | `NodeFocusSurface.svelte`, new `ImageZoomSurface.svelte`, `imageZoom.ts`, stories, e2e smoke tests, docs |
| **PR title**   | `feat(focus): inspect node images with deep zoom`                                                        |

Add an image-specific zoom surface from focus-mode previews. The surface starts
from a scaled-down preview, allows deep zoom up to a context-aware clamp based
on natural image size, and constrains pan so users cannot lose the image.
Zoom-out exit reuses the T06 overshoot accumulator so a bump at the floor does
not exit but a bold zoom-out does.

**Acceptance**

- Clicking/tapping an image preview enters image zoom without changing graph
  camera state.
- Wheel and pinch zoom target the image focal point.
- Image zoom clamps are deeper than graph zoom and based on image dimensions.
- Pan clamps keep at least part of the image in view.
- Escape, the close control, and a bold zoom-out return to node focus; a brief
  zoom-out bump does not; graph focus exits separately.
- Unit specs cover image zoom/pan math and the exit accumulator wiring; stories
  cover desktop and mobile image inspection.
- Final validation runs lint, check, unit tests, story tests, and the relevant
  e2e offline asset flow.
- Plan status is set to `done`, milestone 06 to `complete`, and the roadmap row
  is updated with this plan linked.

## Wave plan

```text
Wave 1   T01  |  T03  |  T05   (pre-work: live view state, async export, reduced motion)
Wave 2   T02  |  T04           (pre-work: focal pinch, remove open-state UI)
Wave 3   T06  |  T09           (zoom-through geometry and schema v4)
Wave 4   T07  |  T10           (focus shell and IndexedDB asset store)
Wave 5   T08                   (explicit focus entry and UX polish)
Wave 6   T11  |  T12           (image editing/previews and HTML asset propagation)
Wave 7   T13                   (deep image zoom, final verification, closeout)
```

Wave 1 tasks touch disjoint files; T02 and T04 wait for T01 because all three
touch `Stage.svelte` or `Multigraph.svelte`. T07 and T10 both add sections to
`appConfig.ts`, but the edits are independent config blocks. T11 depends on T08
for file reasons only (`NodeFocusSurface.svelte`), not logic — do not reorder it
earlier. T11 and T12 can proceed in parallel only after the T10 asset-store
interface is stable; coordinate on shared asset types before starting wave 6.

## Risks and rollback

- **Zoom-through tuning feels wrong.** The accumulator's commit threshold and
  decay half-life are explicit tunables with pinned specs; if the gesture tests
  poorly, retune constants or disable the automatic trigger while retaining the
  focus surface and the explicit Focus action.
- **Overlay geometry drifts from the selected node.** Keep the geometry pure and
  tested in T06; if the morph is unreliable, fall back to a simpler scale/fade
  overlay without changing focus-state semantics.
- **Pre-work regressions.** T01-T04 touch load-bearing gesture and export paths;
  each is small, behavior-preserving (except the pinch fix), and gated on the
  existing story/e2e suites so a bad change is cheap to revert.
- **IndexedDB behavior differs across browsers.** Hide storage implementation
  behind a narrow asset-store API and keep draft graph JSON readable without
  asset bytes.
- **Quota failures lose user-selected images.** Treat add-image as a write that
  must complete before graph content references the asset id; show a recoverable
  error if the blob cannot be stored.
- **HTML save files become huge.** Accept large files for this milestone and
  defer compression to a follow-up if real files become painful.
- **Asset metadata and bytes fall out of sync.** Add import/export validation
  for missing and unreferenced assets; prefer recoverable broken-image states
  over crashing.
- **Older app versions cannot parse asset-bearing saves.** The
  `GRAPH_HTML_READER_VERSION` bump routes them to the open-in-new-tab fallback;
  keep schema-version and reader-version tests explicit.
- **Image zoom conflicts with graph zoom.** Image zoom lives in its own overlay
  with its own pointer handlers and never forwards wheel/pinch events to Stage.

## Definition of Done (this plan)

- All 13 tasks are merged to `main`; milestone 06 acceptance criteria are
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

- 2026-07-04: Initial plan created from the zoom-through focus-mode discussion.
  Decision: use an overlay transition so hidden graph content does not need a
  non-selected fade path.
- 2026-07-04: Image assets should be available offline inside `.html` saves.
  Draft storage uses IndexedDB to avoid pushing binary data into `localStorage`.
- 2026-07-04: Plan revised after review. Trigger changed from viewport coverage
  (unreachable for most nodes at `maxScale: 4` on desktop) to zoom-through with
  an overshoot accumulator; entry and all zoom-out exits share the bump-proof
  commit model. Added pre-work wave (live view state + inverse coordinate
  helper, focal pinch zoom, async export, delete dead `Node.isOpen`, shared
  reduced-motion handling). Asset embedding switched to one script tag per
  asset with a `GRAPH_HTML_READER_VERSION` bump to 2 so older apps get the
  new-tab fallback. Asset scope pinned to the persistence draft key; IDB specs
  use `fake-indexeddb` in the server Vitest project. Dropped browser-Back exit
  and the storage-use display from scope. Fixed the plan date (was dated
  2026-07-05, created 2026-07-04).
