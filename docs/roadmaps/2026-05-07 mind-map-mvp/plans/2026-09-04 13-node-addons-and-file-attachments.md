# Plan: Node add-ons and file attachments

**Created:** 2026-09-04
**Author:** Claude (Fable 5.1)
**Milestone:** [milestones/13-node-addons-and-file-attachments.md](../milestones/13-node-addons-and-file-attachments.md)
**Status:** draft
**Total estimated effort:** M

## Summary

Add the `!` add-on marker with a closed registry and `!task` as its first
entry, and widen node attachments from images to any file, on schema version 7. Both are small on their own and both are prerequisites for milestone 14,
which is why they ship together and first.

Agents: implementation tasks go to Opus subagents with a precise brief; Fable
reviews the crux diffs (T01 parsing rules, T02 schema validators), re-runs the
gates, and does the browser smoke test.

## Open questions resolved

- **Removing an add-on that holds data.** **Confirm in the edit sheet while
  there is no undo; drop the confirm when milestone 12 lands.** Same rule the
  tag-delete path uses today. Confirmed by the user 2026-09-04.
- **One add-on per node or several?** **Several; all add-ons coexist on one
  node.** Forbidding would cost a rule with no case behind it. Confirmed by
  the user 2026-09-04.
- **Task badge toggles on tap?** **No. The badge only shows state; done is
  toggled in the details view and the edit sheet.** Keeps every canvas tap
  for drag and double-tap and avoids a third gesture on the node. Decided by
  the user 2026-09-04.

## Out of scope (for this plan)

- The `!ai` add-on (milestone 14 plan).
- Filtering by task done state; task ordering.
- Inline previews of file contents.
- Accepting `#` inside the edit sheet's title field (existing TODO).

## Tasks

### T01 — `!` marker, add-on registry, and `addons` on NodeData

|                |                                                                                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                                                                                                            |
| **Wave**       | 1                                                                                                                                                                            |
| **Agent**      | opus (Fable reviews the parsing rules)                                                                                                                                       |
| **Effort**     | M                                                                                                                                                                            |
| **Files**      | `appConfig.ts`, `types/node.ts`, new `Multigraph/lib/nodeAddons.ts` + spec, `Multigraph/lib/titleSyntax.ts` + spec, `Multigraph/lib/graph.ts` + spec, `migrations.ts` + spec |
| **PR title**   | `feat(graph): parse ! add-on markers into a typed addons field`                                                                                                              |

Add `addonMarker: '!'` beside the two tag markers in `APP_CONFIG`. Create
`nodeAddons.ts` with the registry: `task` with `createDefault()` returning
`{ done: false }`, a label and a glyph, and `isRegisteredAddon(name)`. Add
`addons?: { task?: TaskAddon }` to `NodeData`. Extend `parseTitleSyntax` to
recognise the marker and return `addons: string[]`, consuming only registered
names; an unregistered `!word` ends the marker run and stays in the display
title. Extend `commitInlineTitleSyntax` and a new `setNodeAddon` /
`removeNodeAddon` pair in `graph.ts` so a marker creates the add-on with its
default when absent and leaves existing data alone when present. Validators in
`migrations.ts` accept the field. No schema bump: the field is additive and
version 6 readers ignore unknown keys.

**Acceptance**

- Spec table for the milestone's syntax cases: `!task Title`,
  `#lab !task Title`, `!task #lab Title`, `!important Title` (no add-on,
  title intact), `!task!task Title` (one add-on), `! Title`.
- `setNodeAddon` on a node that already has the add-on returns the same
  graph object.
- Round trip: a graph with `addons` survives `serializeGraphFile` and
  `parseGraphFile`.
- Immutability spec for every new mutation.

### T02 — Schema 7: `file` asset kind and `NodeFileContent`

|                |                                                                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                                                                                           |
| **Wave**       | 1                                                                                                                                                           |
| **Agent**      | opus (Fable reviews the validators and the GC change)                                                                                                       |
| **Effort**     | M                                                                                                                                                           |
| **Files**      | `types/node.ts`, `types/multigraph.ts`, `migrations.ts` + spec, `Multigraph/lib/graph.ts` + spec, `graphFile.ts` spec, `graphPersistenceController.ts` spec |
| **PR title**   | `feat(persistence): schema 7 with file attachments of any type`                                                                                             |

Widen `GraphAssetMetadata.kind` to `'image' | 'file'`; add `NodeFileContent`
to the `NodeContentBlock` union. Bump `CURRENT_SCHEMA_VERSION` to 7 with a
named no-op `migrateGraphDataToV7` and a version 6 branch in
`unwrapPersistedGraph`. Validators: the `image/` MIME check applies only to
`kind: 'image'`; file blocks need `assetId` and `name`. Generalise
`addNodeImageContent` / `removeNodeImageContent` into `addNodeContentBlock` /
`removeNodeContentBlock` that take either block (keep the image names as thin
wrappers only if call sites make that cheaper than renaming). `referencedAssetIds`
counts both block types.

**Acceptance**

- A version 6 fixture loads unchanged; a version 7 fixture with a file block
  loads; a version 7 fixture with `kind: 'file'` and an `image/` MIME type
  is accepted (a PNG attached as a plain file is legal).
- A hand-edited payload with `schemaVersion: 8` is refused with
  `unsupported-version`, as today.
- `referencedAssetIds` spec covers image-only, file-only, and mixed nodes.
- Export embeds a file asset and import hydrates it (controller spec with
  `MemoryGraphAssetStore`).

### T03 — Edit sheet: any-file upload and add-on toggles

|                |                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------ |
| **Depends on** | T01, T02                                                                                         |
| **Wave**       | 2                                                                                                |
| **Agent**      | opus                                                                                             |
| **Effort**     | M                                                                                                |
| **Files**      | `NodeEditSheet.svelte` + stories, `Multigraph.svelte` (wiring only), `appConfig.ts` (thresholds) |
| **PR title**   | `feat(edit-sheet): attach any file type and toggle node add-ons`                                 |

Rename the Images panel to Attachments. The uploader drops its `image/*`
accept filter; image types still become image blocks, everything else becomes
a file block via the generalised add path in `Multigraph.svelte`. File rows
show name, type, size, an editable caption, reorder and remove. Add an
Add-ons group rendered from the registry: one toggle per entry, checked when
the node carries it, with the confirm from the resolved question when
unchecking one that holds data. Add `attachments.warnBytesPerFile` and
`attachments.warnTotalBytes` to `APP_CONFIG`; the uploader warns and asks
before adding a file over the per-file threshold.

**Acceptance**

- Story: user attaches a CSV and a row appears with name and size.
- Story: user attaches a PNG and it still appears in the image list with
  nested zoom intact.
- Story: user toggles Task on, saves, and the node data carries
  `addons.task`; toggling off on a done task shows the confirm.
- Story: a file over the per-file threshold prompts before adding.

### T04 — Details view file rows and task toggle, canvas badges

|                |                                                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T01, T02, T03                                                                                                                           |
| **Wave**       | 3                                                                                                                                       |
| **Agent**      | opus                                                                                                                                    |
| **Effort**     | M                                                                                                                                       |
| **Files**      | `NodeDetailsContent.svelte` + stories, `Node/Node.svelte` + stories, new `Node/lib/addonBadges.ts` + spec, `Multigraph.svelte` (wiring) |
| **PR title**   | `feat(node): show file attachments, add-on badges, and a task toggle`                                                                   |

Details view: a file list under the image grid with name, type, size, caption
and Open (object URL in a new tab, revoked after a minute as the HTML opener
does). Canvas: a pure `addonBadges(node)` decides which glyphs a node shows
(task unchecked, task checked, attachment count); `Node.svelte` renders them
on the border opposite the title baseline, sized with the node. The badges
are display-only and take no pointer events of their own. The details view
carries the large task control, which calls `onToggleTaskDone`, routed through
`commitUserGraph`. A done task renders its title muted.

**Acceptance**

- Story: a node with a file attachment shows the count glyph; details view
  lists the file and Open is a link with a `blob:` href.
- Story: toggling done in the details view updates the badge and the muted
  style; tapping the badge on the canvas behaves exactly like tapping the
  node.
- Story: details view shows the large task control in the matching state.
- Reduced motion respected; no new pointer handler on `Stage`.

### T05 — `!name` tokens in the query panel

|                |                                                                             |
| -------------- | --------------------------------------------------------------------------- |
| **Depends on** | T01                                                                         |
| **Wave**       | 2                                                                           |
| **Agent**      | opus                                                                        |
| **Effort**     | S                                                                           |
| **Files**      | `Multigraph/lib/graphQuery.ts` + spec, `GraphQueryPanel.svelte` (help text) |
| **PR title**   | `feat(query): filter nodes by add-on with ! tokens`                         |

Teach `parseGraphQuery` the add-on marker as a third token target, `addon`,
with the same `+`/`-` prefix semantics. Matching checks `node.addons` for the
named key. Unregistered names match nothing rather than erroring.

**Acceptance**

- Spec: `!task`, `+!task`, `-!task`, `!nothing`, and `!task #lab` combined.
- The panel's inline help lists the marker beside `#` and `@`.

### T06 — Export size line and docs

|                |                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T02, T03                                                                                                               |
| **Wave**       | 3                                                                                                                      |
| **Agent**      | opus                                                                                                                   |
| **Effort**     | S                                                                                                                      |
| **Files**      | `graphPersistenceController.ts` + spec, `GraphToolbar/lib/noticeLines.ts` + spec, `README.md`, `docs/roadmaps/TODO.md` |
| **PR title**   | `feat(persistence): report export size when attachments grow it`                                                       |

Sum referenced asset sizes from metadata (no blob reads) and, above
`warnTotalBytes`, add a notice line saying roughly how large the download will
be. Update the README's title-syntax section for `!` and strike the two TODO
items this milestone closes.

**Acceptance**

- Spec: no line under the threshold; one line with a rounded size above it.
- README shows the three markers with one example each.

## Wave plan

```
Wave 1   T01  ‖  T02         (pure data and parsing; disjoint files)
Wave 2   T03  ‖  T05         (sheet wiring; query tokens)
Wave 3   T04  ‖  T06         (details/canvas; export notice)
```

Total: 6 tasks, three gates. T03 and T04 both touch `Multigraph.svelte`, which
is why T04 waits a wave.

## Risks and rollback

- **Parsing regressions in existing titles.** A title that starts with `!`
  today is prose. The registry rule keeps it prose unless the word is
  `task`; the spec table in T01 pins that. If a real graph turns up with
  `!task` as prose, the fix is a leading space, and the notice can say so.
- **Schema 7 and the propagated shell.** A document saved by this build
  opens in an older shell with the newer-app warning already in place
  (milestone 04n). No new mechanism needed; verify it in the smoke test.
- **Node badge clutter.** Two glyphs at most per node in this milestone.
  If the AI badge in milestone 14 makes three, revisit the placement then.

## Definition of Done (this plan)

- All 6 tasks merged to `main`.
- Milestone acceptance criteria satisfied (linked, not copied).
- Plan status `done`, milestone `complete`, roadmap row updated.
- Fable smoke test: attach a CSV, download, open in a fresh profile, see
  the file; toggle a task in the details view.

## Notes

- 2026-09-04: plan drafted from the feature conversation. Not started.
