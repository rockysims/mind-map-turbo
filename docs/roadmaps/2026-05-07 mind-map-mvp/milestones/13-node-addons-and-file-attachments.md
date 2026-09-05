# Milestone 13: Node add-ons and file attachments

**Status:** proposed
**Depends on:** milestone 04e (title syntax), 04f (tag colours), 06 (node
content blocks and image assets), 04l (self-contained HTML save files).
**Plan:** [2026-09-04 13-node-addons-and-file-attachments.md](../plans/2026-09-04%2013-node-addons-and-file-attachments.md)
**Feeds:** milestone 14 (AI nodes), which needs both halves of this one.

## Goal

Two foundations that are useful on their own and that milestone 14 cannot
start without.

**A third title marker, `!`, that gives a node a capability.** `#` names a
node tag and `@` names an edge tag; both are open-ended labels the user
invents. `!` is different in kind: it picks one entry from a closed registry
of _add-ons_ that change what the node can do. The first add-on is `!task`,
which gives the node a done checkbox. The second, `!ai`, arrives in milestone
14 and is the reason the registry exists.

**Files of any type as node attachments.** Today a node can carry images
and nothing else. The asset store underneath is already a generic blob store
in IndexedDB, and exports already embed assets as base64 inside the
self-contained `.html`; only the metadata and the UI are image-only. This
milestone generalises both so a node can hold a CSV of measurements, a PDF,
a spreadsheet, or anything else, with the same offline and portable
guarantees images have.

## Why now

Both halves are on the roadmap's TODO intake already (`!task` under "Later",
and "Need an easier way to add/remove tags"). What makes them urgent is
milestone 14: an AI node is an add-on, and the measurements it plots are file
attachments on neighbouring nodes. Landing the foundations first keeps the
AI milestone about the AI.

## Scope

### `!` add-ons

- **Syntax.** `!name` is parsed at the front of a title exactly where `#` and
  `@` are, in any order with them, and stripped from the display title. The
  marker is configured beside the other two in `APP_CONFIG`.
- **Closed registry.** Only registered names are consumed. `!important` at
  the front of a title is not an add-on, so it stays in the title as plain
  text rather than vanishing or erroring. This is the one place `!` differs
  from `#`, which accepts any word.
- **Own field, not a tag.** An add-on is stored as `addons?: { task?: … }`
  on `NodeData`, typed per add-on, never as a string in `tags`. Add-ons have
  no colour config and do not paint the border; they are shown as a small
  badge on the node instead. A node may carry any number of add-ons at once.
- **Two ways in.** Typing the marker in the title (inline title editor or
  the edit sheet's title field) and a per-add-on toggle in the edit sheet.
  Toggling on creates the add-on with its default data; toggling off removes
  it. Removing the marker from the title is the same as toggling off.
- **`!task`.** Data: `{ done: boolean; doneAt?: number }`. The badge shows an
  empty or checked box and is display-only: done is toggled in the details
  view or the edit sheet, never by tapping the canvas, so the badge does not
  compete with drag and double-tap. A done task's title is rendered muted on
  the canvas; nothing else changes about it.
- **Query.** `!task` in the query panel matches nodes carrying that add-on,
  with the same `+`/`-` prefixes the tag tokens take. Filtering by done
  state is out of scope for this milestone.

### File attachments

- **Data model.** `GraphAssetMetadata.kind` widens to `'image' | 'file'`.
  A new content block `NodeFileContent { type: 'file'; assetId; name;
caption? }` sits beside `NodeImageContent`. Images keep their block and
  their nested deep-zoom behaviour untouched.
- **Schema version 7.** Additive: version 6 data loads without rewriting.
  The validators widen to accept the new kind and block; the `image/` MIME
  check applies only to `kind: 'image'`.
- **Adding.** The edit sheet's uploader accepts any file. Image types keep
  becoming image blocks; everything else becomes a file block. Name and size
  come from the `File`.
- **Showing.** The details view lists file blocks as rows: name, type, size,
  optional caption, and an Open action that hands the blob to the browser
  through an object URL. The canvas shows an attachment count glyph on nodes
  that carry files, so a data node is recognisable at a glance.
- **Portability.** Exports embed file blobs exactly as they embed images;
  imports hydrate them the same way. Garbage collection
  (`referencedAssetIds`, `deleteUnreferenced`) counts file blocks.
- **Size honesty.** Files make the single-file export grow. Above a
  configured threshold per file the uploader warns and asks before adding;
  above a configured total the document status line says how big the
  export will be. Thresholds live in `APP_CONFIG`.

## Out of scope

- The `!ai` add-on and everything it needs (milestone 14).
- Filtering tasks by done state; task due dates; task lists.
- Rendering file contents inline (a CSV preview, a PDF viewer). Open in the
  browser is enough for now.
- Linked rather than embedded files. Every attachment is a copy inside the
  document, as images are.
- Changing how `#` and `@` behave. The TODO item about accepting `#` inside
  the edit sheet's title field stays where it is.

## Open questions (resolved 2026-09-04)

1. Should removing an add-on that holds data (a done task today, an AI run
   history tomorrow) confirm first? **Yes, until milestone 12's undo lands;
   then the confirm goes.**
2. Does a node carry at most one add-on? **No. All add-ons can coexist on
   one node.**
3. Should the task badge toggle on tap, or only in the details view?
   **Details view only for now.** The canvas badge shows state and nothing
   else.

## Acceptance criteria

1. Typing `!task Buy filters` as a title yields a node titled "Buy filters"
   with an unchecked task badge; `#lab !task Buy filters` and
   `!task #lab Buy filters` both yield the tag and the add-on.
2. Typing `!important Read this` yields a node titled "!important Read
   this" with no add-on.
3. Toggling done in the details view updates the badge and renders the node
   muted; the edit sheet shows the add-on in the matching state. Tapping the
   badge on the canvas does nothing beyond what tapping the node does.
4. Removing `!task` from the title, or toggling it off in the sheet, removes
   the add-on and its data; the sheet confirms first while there is no undo.
5. Attaching a `.csv` to a node stores it in IndexedDB, shows a file row in
   the details view with the right name and size, and Open shows the file
   in a new tab.
6. A document with a file attachment survives Download, a fresh browser
   profile, and Open from the picker with the file intact. The same
   document opened in the previous app version loads its graph and reports
   the newer schema the way it does today.
7. A version 6 document opens unchanged; its images are still images.
8. Deleting the only node that references a file removes the file from
   IndexedDB on the next sweep, and an export after that carries no orphan.
9. `!task` in the query panel matches task nodes; `-!task` hides them.
10. Every gate in `AGENTS.md` passes: lint, check, unit and story tests,
    knip.
