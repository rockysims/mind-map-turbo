# Milestone 07: Node focus and rich media

**Status:** not started
**Depends on:** milestones 03 (node editing UX), 04l/04m/04n
(self-contained HTML document saves), and 05 (find/filter camera navigation).
**Plan:** [2026-07-05 07-node-focus-and-rich-media.md](../plans/2026-07-05%2007-node-focus-and-rich-media.md)

## Goal

Let users zoom through a graph node into a calm, full-screen node focus mode
where the selected node becomes the whole workspace. The first version should
make title and description easier to read, then add offline image attachments
that are saved inside portable `.html` graph documents and can be inspected at
full detail with deep image zoom.

The interaction should feel continuous: zooming far enough into a node triggers
a transition that reveals the whole node border again, morphs the circle into a
rounded rectangular focus surface, and brings node content into view without a
hard cut.

## Scope

### Zoom-triggered node focus mode

- Detect when the node under the zoom focal point has grown large enough that
  its projected border fully contains the viewport.
- Use hysteresis and explicit exit behavior so focus mode cannot flicker around
  the threshold.
- Provide a discoverable "Focus" action from the node action menu in addition
  to the zoom-through gesture.
- Keep focus mode transient; opening a graph from persisted `ViewState` should
  not automatically reopen focus mode.
- Implement the entry transition with a full-screen overlay that starts from
  the selected node's current screen geometry, reveals the full border, then
  morphs the circle into a rounded rectangular content surface.
- Keep `Stage` responsible for camera gestures and let `Multigraph` orchestrate
  focus-mode state and rendering.
- Exit via Escape, Back, an explicit close control, or zooming out from focus
  mode.

### Focus content surface

- Render the node title and description in a full-screen surface sized for
  reading, not inside the existing small graph node.
- Own pointer events while focused so graph pan/drag gestures do not leak
  through.
- Preserve reduced-motion support by using instant or simplified state changes
  when motion is disabled.
- Return focus and camera context to the graph cleanly after exit.

### Offline node images

- Add a node content model that can reference image attachments while preserving
  the current plain title/description fields.
- Store draft image bytes outside `localStorage`, using IndexedDB so large
  binary assets do not consume the current small JSON storage budget.
- Keep graph-local asset metadata in the graph schema and store image bytes in a
  document/draft-scoped asset store.
- Export portable `.html` graph documents with all referenced image bytes
  embedded, so a saved document works offline with no adjacent asset files.
- Import/open saved `.html` documents with embedded assets and hydrate the
  local draft asset store safely.
- Show estimated storage use and handle quota failures with recoverable user
  feedback.

### Image viewing

- Show image attachments in focus mode as scaled-down previews with alt text and
  optional captions.
- Let users zoom deeply into an image to inspect the original detail while
  clamping pan/zoom to the image context.
- Keep graph zoom and image zoom as separate interaction contexts so background
  graph zoom remains bounded.

## Acceptance criteria

- Pure specs cover focus trigger geometry, threshold hysteresis, and graph
  camera-to-screen coordinate helpers.
- Story coverage shows:
  - zooming far enough into a node enters focus mode,
  - the explicit Focus action enters the same mode,
  - focus entry/exit does not mutate graph data,
  - Escape/close returns to the graph,
  - reduced-motion users avoid the animated morph.
- Focus mode renders title and description in a full-screen node surface without
  graph pointer events leaking through.
- A schema migration adds node content/asset metadata while older graph files
  load with empty content/assets.
- IndexedDB-backed draft asset storage handles image blobs, reports
  `navigator.storage.estimate()` data when available, and catches quota errors.
- Node edit UI supports adding, previewing, captioning, reordering, and removing
  image attachments.
- Self-contained `.html` export embeds all referenced image bytes; opening or
  importing that file offline restores the images.
- Imported asset captions/alt text cannot break out of the inert HTML payload.
- Image previews in focus mode can enter a deep zoom surface with context-aware
  zoom and pan clamps.
- Lint, check, unit/browser/story tests, and relevant e2e flows pass.

## Non-goals

- Markdown or rich text editing for descriptions.
- OCR, AI image analysis, image generation, or automatic alt text.
- In-app image cropping, drawing, annotation, or destructive image editing.
- Remote image URLs as primary storage. The portable document model requires
  local embedded bytes.
- Silent save-in-place over the opened `.html` file.
- Compression or deduplicated app-code bundles across save documents.
- Server persistence, accounts, or multiplayer asset synchronization.

## Risks and open questions

Resolved in the plan; kept here for context.

- **Transition architecture.** A graph-camera transition could reveal unrelated
  graph content while zooming back; the plan should decide whether to animate
  the graph itself or an overlay.
- **Trigger semantics.** The plan should define exactly which node is eligible
  for focus when multiple nodes overlap or the zoom focal point is between
  nodes.
- **Gesture conflicts.** Focus mode, graph zoom, image zoom, node drag, and
  long-press actions need a clear ownership boundary.
- **Storage architecture.** Large images cannot live comfortably in
  `localStorage`; the plan should decide how graph metadata, draft asset bytes,
  and exported embedded bytes relate.
- **HTML document size.** Embedding images keeps documents portable but can
  produce very large files.
- **Quota and eviction behavior.** Browser storage policies differ, and
  IndexedDB writes can fail under storage pressure or user settings.
- **Schema compatibility.** Older graph files must keep loading, and newer
  asset-bearing saves must fail or fall back safely in older app versions.
- **Search semantics.** The plan should decide whether image alt text and
  captions participate in the existing find/filter query model.
