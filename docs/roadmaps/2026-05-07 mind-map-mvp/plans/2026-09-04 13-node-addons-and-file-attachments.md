# Plan: Node add-ons and file attachments

**Created:** 2026-09-04
**Author:** Claude (Fable 5.1)
**Milestone:** [milestones/13-node-addons-and-file-attachments.md](../milestones/13-node-addons-and-file-attachments.md)
**Status:** draft
**Total estimated effort:** M

## Summary

Add the `!` add-on marker with a closed registry and `!task` as its first
entry, and widen node attachments from images to any file, on schema version 7. Both are small on their own and both are prerequisites for milestone 14,
which is why they ship together and first. Milestone 12 (undo) merges into
`temp` before any task starts: it changes the commit path and asset removal
that every task here builds on.

Agents: implementation tasks go to Opus subagents with a precise brief; Fable
reviews the crux diffs (T01 parsing rules, T02 schema validators), re-runs the
gates, and does the browser smoke test.

## Open questions resolved

- **Removing an add-on that holds data.** **No confirm.** Milestone 12 is
  complete on its branch and merges first, so the removal is one history
  entry with a label ("remove task add-on") and Undo is the safety net.
  Revised 2026-09-04 after the review found undo already built; the first
  answer had it confirming until undo landed.
- **One add-on per node or several?** **Several; all add-ons coexist on one
  node.** Forbidding would cost a rule with no case behind it. Confirmed by
  the user 2026-09-04.
- **Task badge toggles on tap?** **No. The badge only shows state; done is
  toggled in the details view and the edit sheet.** Keeps every canvas tap
  for drag and double-tap and avoids a third gesture on the node. Decided by
  the user 2026-09-04.
- **Marker rule for `!`.** **Same as `#` and `@`: the direction prefix and
  all three markers are consumed from the front in any order and count, may
  abut, and a name ends at whitespace or the next marker.** One rule to
  learn and one parser loop; the cost is that a tag name cannot contain `!`,
  which it already cannot for the other two. An unregistered `!name` ends
  the run and stays in the title with everything after it. Decided by the
  user 2026-09-04 (`!task #nodish @edgish !ai Test` reads as title "Test"
  and the rest special).
- **Markers in the edit sheet's title field.** **Parse `#` and `!` there,
  additively.** The sheet is the only title editor for an existing node (the
  inline editor opens for new nodes and the initial root only, and replaces
  tags wholesale on commit), so without this `!task` on an existing node is
  toggle-only and `#lab` typed there keeps failing silently, the open TODO.
  `@` and the direction prefix stay as typed: the sheet has no created edge
  to apply them to. Confirmed by the user 2026-09-04.

## Out of scope (for this plan)

- The `!ai` add-on (milestone 14 plan).
- Filtering by task done state; task ordering.
- Inline previews of file contents.
- `@` and direction markers in the edit sheet's title field (no edge to
  apply them to; they stay as typed).

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
treat `!` as a third marker in the same loop as `#` and `@` (any order, any
count, abutting allowed, a name ends at whitespace or the next marker) and
return `addons: string[]`, consuming only registered names; an unregistered
`!word` ends the marker run and stays in the display title with everything
after it. `isValidTagName` rejects `!` in a name as it rejects the other
markers. Extend `commitInlineTitleSyntax` and a new `setNodeAddon` /
`removeNodeAddon` pair in `graph.ts` so a marker creates the add-on with its
default when absent and leaves existing data alone when present. Validators in
`migrations.ts` accept the field; the version bump itself is T02's.

**Acceptance**

- Spec table for the milestone's syntax cases: `!task Title`,
  `#lab !task Title`, `!task #lab Title`, `!task #nodish @edgish Title`
  (title "Title", one tag, one edge tag, one add-on), `#a!task Title`
  (abutting), `!important Title` (no add-on, title intact),
  `!important #lab Title` (no tag either; the run ended), `!task!task Title`
  (one add-on), `! Title` (title "! Title", as `# Title` stays today), and
  `#wow! Title` (tag `wow`, title "! Title").
- `setNodeAddon` on a node that already has the add-on returns the same
  graph object.
- Round trip: a graph with `addons` survives `serializeGraphFile` and
  `parseGraphFile`.
- Immutability spec for every new mutation.

### T02 — Schema 7: `file` asset kind and `NodeFileContent`

|                |                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                                                                                             |
| **Wave**       | 1                                                                                                                                                             |
| **Agent**      | opus (Fable reviews the validators and the GC change)                                                                                                         |
| **Effort**     | M                                                                                                                                                             |
| **Files**      | `types/node.ts`, `types/multigraph.ts`, `migrations.ts` + spec, `Multigraph/lib/graph.ts` + spec, `graphFile.ts` + spec, `graphPersistenceController.ts` spec |
| **PR title**   | `feat(persistence): schema 7 with file attachments of any type`                                                                                               |

Widen `GraphAssetMetadata.kind` to `'image' | 'file'`; add `NodeFileContent`
to the `NodeContentBlock` union. Bump `CURRENT_SCHEMA_VERSION` to 7 with a
named no-op `migrateGraphDataToV7` and a version 6 branch in
`unwrapPersistedGraph`, and `GRAPH_HTML_READER_VERSION` to 3 so an older app
routes a version 7 HTML file to its own embedded shell (the
`unsupported-app-version` path from milestone 04n) instead of refusing it as
an unsupported schema. Validators: the `image/` MIME check applies only to
`kind: 'image'`; file blocks need `assetId` and `name`; the HTML asset
parser in `graphFile.ts` (`extractHtmlAssetPayloads`) drops its own `image/`
check, which today rejects any other embedded asset as malformed. Generalise
`addNodeImageContent` / `removeNodeImageContent` into `addNodeContentBlock` /
`removeNodeContentBlock` that take either block (keep the image names as thin
wrappers only if call sites make that cheaper than renaming); removal keeps
returning the asset ids that became unreferenced, which the caller tombstones
through milestone 12's `assetTrash.ts` rather than deleting.
`referencedAssetIds` counts both block types.

**Acceptance**

- A version 6 fixture loads unchanged; a version 7 fixture with a file block
  loads; a version 7 fixture with `kind: 'file'` and an `image/` MIME type
  is accepted (a PNG attached as a plain file is legal).
- A hand-edited payload with `schemaVersion: 8` is refused with
  `unsupported-version`, as today; an HTML file with `minReaderVersion: 4`
  is refused with `unsupported-app-version`, and a version 7 HTML file
  parsed by the version 6 parser (a fixture pinned from before this task)
  reports the same, not a malformed asset.
- A version 7 HTML fixture with an embedded `text/csv` asset parses.
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

Rename the Images panel to Attachments. Keep the Add image input with its
`image/*` filter (phones offer the camera for it) and add an Add file input
beside it that accepts any type; both go through one generalised add path in
`Multigraph.svelte`, where the file's type decides the block kind, so an image
picked through Add file is still an image block. File rows show name, type,
size, an editable caption, reorder and remove; removing one tombstones the
asset the way image removal does after milestone 12. Add an Add-ons group
rendered from the registry: one toggle per entry, checked when the node
carries it; unchecking removes the add-on and its data with no confirm, and
the commit carries the label "remove task add-on" so Undo names it. The
title field parses `#` and `!` on save (resolved question above): the display
title is stored, parsed tags are unioned with the tags field, parsed add-ons
are created if absent, and `@` or a direction prefix stay in the title as
typed. Add `attachments.warnBytesPerFile` and `attachments.warnTotalBytes` to
`APP_CONFIG`; the uploader warns and asks before adding a file over the
per-file threshold (a size warning, not a destructive confirm, so it stays).

**Acceptance**

- Story: user attaches a CSV through Add file and a row appears with name
  and size.
- Story: user attaches a PNG through Add image and it still appears in the
  image list with nested zoom intact; a PNG through Add file lands there too.
- Story: user toggles Task on, saves, and the node data carries
  `addons.task`; toggling off on a done task removes it with no dialog, and
  the commit label reads "remove task add-on".
- Story: user types `#lab !task Buy filters` into the title field, saves,
  and the node has title "Buy filters", the tag `lab` added to its existing
  tags, and the task add-on.
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
`commitUserGraph` with the label "mark task done" / "mark task not done". A
done task renders its title muted.

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
with the same `+`/`-` prefix semantics: `!` joins `startsWithTagMarker`, so it
ends text and tag tokens the way `#` and `@` do. Matching checks `node.addons`
for the named key. Unregistered names match nothing rather than erroring.

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

Sum referenced asset sizes from metadata (no blob reads), scaled by 4/3 for
the base64 the HTML embeds, and, above `warnTotalBytes`, add a notice line
saying roughly how large the download will be. Give the README a title-syntax
section covering all three markers (it has none today; the math section is
the model) and strike the three TODO items this milestone closes: the `!task`
checkbox, `#` in the edit sheet's title field, and the easier way to add
tags.

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

- **Milestone 12 lands first.** Its branch conflicts with `temp` in the
  persistence controller, its spec and the offline shell; the merge is
  prepared on `claude/undo-merge-temp-548d62` and goes into `temp` before
  wave 1. Every task here uses the post-merge API: `commitUserGraph` takes
  an intent with a label, and asset removal tombstones.
- **Parsing regressions in existing titles.** A title that starts with `!`
  today is prose. The registry rule keeps it prose unless the word is
  `task`; the spec table in T01 pins that. A saved tag containing `!` (none
  known) is cut at the `!` only if its title is typed again, since tags are
  stored parsed. There is no escape for a title that must begin with `!task`
  (the parser trims leading space); accept that until a real case appears.
- **Schema 7 and the propagated shell.** An older shell cannot read version
  7 at all; the reader-version bump in T02 is what makes it hand the file to
  the file's own shell (milestone 04n) rather than say "Unsupported file
  version". Verify both directions in the smoke test, including an older
  shell finding a version 7 draft in the shared `file://` storage.
- **Node badge clutter.** Two glyphs at most per node in this milestone.
  If the AI badge in milestone 14 makes three, revisit the placement then.

## Definition of Done (this plan)

- All 6 tasks merged to `main`.
- Milestone acceptance criteria satisfied (linked, not copied).
- Plan status `done`, milestone `complete`, roadmap row updated.
- Fable smoke test: attach a CSV, download, open in a fresh profile, see the
  file; pick the same file in an older shell and land in the new tab; toggle
  a task in the details view and undo it.

## Notes

- 2026-09-04: plan drafted from the feature conversation. Not started.
- 2026-09-04: reviewed against the code before execution. Found: milestone
  12 complete but unmerged (`claude/undo-redo-feature-548d62`), so the
  confirm decision flipped and the removal paths now tombstone; the HTML
  asset parser's `image/` check and the reader-version gate, both missing
  from T02; the edit sheet's title field is not parsed at all today, so the
  milestone's "second way in" needed a decision; and the `!` splitting rule
  needed pinning. All folded in above. The user's example for the rule:
  `!task #nodish @edgish !ai Test` reads as title "Test" with the rest
  special.
