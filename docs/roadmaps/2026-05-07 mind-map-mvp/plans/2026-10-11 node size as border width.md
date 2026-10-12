# Plan: Node size as border width

**Created:** 2026-10-11
**Author:** Claude agent
**Milestone:** none — extends [milestone 13](../milestones/13-node-addons-and-file-attachments.md) (node data) and [milestone 04f](../milestones/04f-tag-colors-and-graph-tag-config.md) (border rendering)
**Status:** done
**Total estimated effort:** M

## Summary

Let a node carry the size of the thing it stands for, as a new optional
`NodeData.sizeBytes` written by whatever importer or scraper built the graph,
and draw that size as the node's border width on a bounded logarithmic scale.
The motivating case is the scraped Canvas course in
`apps/mind-map-sv/examples/PHYS-121-canvas-course-1921499.html` (210 nodes, 21
tagged `file`): a reader should be able to see at a glance which lecture PDF is
the 40 MB one. This plan ships the field, the mapping, the rendering and a
read-only display; populating the field is the scraper's job and is not here.

Paths below are relative to `apps/mind-map-sv/src/lib/` unless they start with
`apps/`, `scripts/` or `docs/`. Every file:line reference was read on
`feature/graph-tunables` at `cb5371f`.

## How node size works today

- **Size means hop distance and nothing else.** `scaleByHops`
  (`components/ui/Multigraph/lib/layout.ts:58-72`) gives every node
  `max(minScale, scaleFalloff ** hops)`, and `radiusOf` (`:74-81`) turns that
  into `baseRadius * scale` for layout, edge trimming and hit testing. The DOM
  draws every node at the same base diameter and applies the hop scale as a CSS
  transform: `transform: translate(-50%, -50%) scale(${nodeScale})`
  (`components/ui/Multigraph/Multigraph.svelte:3395`).
- **Every node gets the same chrome numbers.** `Multigraph.svelte:539-544`
  builds one `nodeChromeTunables` (radius, border width, pinned border width,
  font size) from `cfg` (`:468`, `:492-494`) and spreads it into both
  `<Node>` sites: the `passiveNode` snippet (`:2991-3009`) and the live node loop
  (`:3350`, `<Node {...nodeChromeTunables}` at `:3397-3398`).
- **The border is drawn inside the circle.** `Node.svelte:80-90` hands the
  widths to `NodeChrome.svelte`, which sets `--node-border-width` and
  `--pinned-node-border-width` (`NodeChrome.svelte:50`). `.circle` is
  `box-sizing: border-box` with `overflow: hidden` (`:58-70`), so a thicker
  border eats into the content area rather than growing the node. Pinned nodes
  switch to the pinned width, a darker colour and a white halo (`:72-76`).
- **Tag colours are painted into the border.** `nodeBorderSegments` and
  `tagBorderBackground` (`components/ui/Multigraph/lib/tagColors.ts:52-71`)
  build a conic gradient that `.circle[data-tag-border='true']` paints on the
  border box under a padding-box fill (`NodeChrome.svelte:78-84`). A wider
  border is therefore a wider coloured ring for free.
- **Defaults.** `appConfig.ts:1` `NODE_RADIUS_PX = 200`; `:80-81`
  `nodeBorderWidthPx: 8`, `pinnedNodeBorderWidthPx: 8`; `:79`
  `nodeTextFontSizePx: 38`.
- **No size on the node.** `NodeData` (`components/ui/types/node.ts:174-189`)
  has no size or weight. Assets carry a byte `size`
  (`components/ui/types/multigraph.ts:27`), but the owner ruled that is not the
  source here. `formatByteSize` already exists
  (`components/ui/Multigraph/lib/byteSize.ts:25`) and the details view already
  uses it for file rows (`components/ui/Multigraph/NodeDetailsContent.svelte:12`,
  `:654`).

## Open questions resolved

- **Where the size comes from.** **A new optional `NodeData.sizeBytes?: number`,
  set when the graph is created** by an importer or scraper (owner, 2026-10-11:
  "the node size will be set when the mind map is created, based on scraped data
  from websites, files, etc."). The number describes the external thing the
  node represents — a web page, a PDF on Canvas, a file on disk — which the app
  has no other way to know.

- **Whether to derive it from attachments.** **No — an explicit non-goal.**
  Attachments are what the reader chose to embed, not what the node stands for,
  and the motivating graph has no attachments at all. Summing
  `GraphAssetMetadata.size` over a node's `content` blocks remains a plausible
  _fallback_ for nodes with no `sizeBytes`; it is noted here and deliberately not
  built.

- **Which visual carries it.** **Border width, not node scale.** Owner's
  reason, recorded so nobody re-derives it: scale already encodes hop distance
  from the pinned nodes, and giving it a second meaning would muddy both.
  Border width also leaves layout, edge trimming, edge occlusion, hit testing and
  physics untouched — they all read `radiusByNodeId`, which this plan never
  changes.

- **The mapping.** **Logarithmic and bounded**, as a pure function in a new
  `components/ui/Multigraph/lib/sizeBorder.ts`:

  ```ts
  borderWidthFactorForSize(sizeBytes, settings) = clamp(
    1 + widthPerDoubling * log2(sizeBytes / referenceBytes),
    minFactor,
    maxFactor,
  );
  ```

  Sizes scraped from the web span six orders of magnitude, so a linear mapping
  would draw every node either invisible or enormous. With the defaults below
  the floor lands near 100 KiB (`2^(-0.5/0.15)` × 1 MiB ≈ 101.6 KiB), the
  factor doubles at ≈ 101.6 MiB (`2^(1/0.15)` ≈ 101.6), and the cap lands near
  10 GiB (`2^(2/0.15)` ≈ 10,321 MiB) — a useful spread for course files, which
  sit between those.

- **Defaults and where they live.** **A new `APP_CONFIG.multigraph.sizeBorder`
  group**: `referenceBytes: 1048576` (1 MiB, the size that draws exactly the
  configured border), `widthPerDoubling: 0.15`, `minFactor: 0.5`,
  `maxFactor: 3`. Declared directly after `minNodeHitRadiusPx` and before
  `edgeArrow` (`appConfig.ts:82-83`), so the panel section sits next to the
  existing border fields.

- **What counts as "no size".** **`undefined`, `0`, `NaN` and ±`Infinity` all
  map to factor 1** (owner ruling). Zero is the value a scraper writes when it
  could not measure, so it reads as "unknown", not "tiny". Likewise a degenerate
  _setting_ — `referenceBytes` ≤ 0 or non-finite, or a non-finite
  `widthPerDoubling` — returns 1 rather than `NaN`, because the paired numeric
  inputs in the settings panel accept out-of-range values by design.

- **Crossed bounds.** **The clamp is order-insensitive**: it clamps to
  `[min(minFactor, maxFactor), max(minFactor, maxFactor)]`. The panel can set
  the two independently, and a reader who drags the floor past the cap should
  see a flat border, not a function that ignores one of them.

- **How invalid stored values are handled.** **Dropped on load; the file still
  opens.** `isNodeData` (`migrations.ts:433-455`) is all-or-nothing, so adding
  `sizeBytes` to it would make one bad number from a scraper reject an otherwise
  good 210-node graph. Instead `isNodeData` stays as it is (it already ignores
  keys it does not check), and a new `withValidNodeSizes` pass runs after
  validation, next to `withSeededComponentPins` in `unwrapPersistedGraph`
  (`migrations.ts:161-163`). It removes any `sizeBytes` that is not a finite
  number ≥ 0 and returns the input by identity when there is nothing to drop.
  Both load paths go through it: `persistence.ts:76/104/130` and
  `graphFile.ts:250`.

- **Schema bump.** **Not needed.** `CURRENT_SCHEMA_VERSION` stays 8
  (`migrations.ts:26`). The field is optional and additive like `inputs`,
  `outputs` and `addons` before it (`migrations.ts:345-347`). An older v8 app
  opening a file with `sizeBytes` passes it through `isNodeData` untouched, keeps
  it through every `{ ...node }` spread, and simply draws the default border.

- **What a merge does with it.** **The survivor's size wins; the absorbed node's
  is used only when the survivor has none.** `mergeNodeFields`
  (`components/ui/Multigraph/lib/nodeMerge.ts:81-92`) already spreads
  `...survivor`, so today the absorbed size would silently vanish. Merging is
  how a reader unites duplicates, and summing two scrapes of the same file would
  double it.

- **Where the factor is applied.** **One `nodeChromeFor(node)` function in
  `Multigraph.svelte`**, returning `nodeChromeTunables` with both widths
  multiplied by the node's factor (and returning `nodeChromeTunables` itself by
  identity when the factor is 1). It replaces the spread at both `<Node>` sites,
  which covers every ring the canvas draws:

  | Site                                                      | Where                                | Effect                                    |
  | --------------------------------------------------------- | ------------------------------------ | ----------------------------------------- |
  | Live node loop                                            | `Multigraph.svelte:3397-3398`        | sized                                     |
  | Reveal-wave buffer (`passiveNode`)                        | `:3432-3447` → snippet `:3003-3004`  | sized — no width jump as a node leaves    |
  | Exiting ghosts (`passiveNode`)                            | `:3449-3458` → snippet               | sized — a deleted node fades at its size  |
  | Creation preview (`passiveNode`)                          | `:3460-3469` → snippet               | factor 1 (`CREATION_PREVIEW_NODE`)        |
  | Focus morph source end                                    | `geometryForFocusLevel` `:1977-1982` | sized — see next item                     |
  | Focused details frame (`NodeChrome`)                      | `focusFrame` snippet `:3519-3548`    | unchanged — takes the morph's width       |
  | `StageHarness.svelte:168`, `NodeDetailsHarness.svelte:46` | `<Node nodeData={node} />`           | unchanged — test harnesses with no config |

- **Focus morph.** **Factor the source end only.** `frameGeometry`
  (`components/ui/Multigraph/lib/frameGeometry.ts:83-89`) interpolates from the
  node's on-screen border (`nodeBorderWidthPx` or `pinnedNodeBorderWidthPx` ×
  stage scale × node scale) to `focus.detailsBorderWidthPx`. Passing the
  factored widths from `geometryForFocusLevel` keeps progress 0 pixel-identical
  to the canvas node, which the existing
  `MorphSurfaceMatchesInStageNodeAtProgressZero` story
  (`Multigraph.stories.svelte:2461`) pins. The fully focused frame keeps the
  shared `detailsBorderWidthPx`: at that point the reader is in the node, and the
  size is shown as text in the details view instead. `frameGeometry.ts` itself
  does not change.

- **Settings panel exposure.** **All four fields basic tier,
  `preview: 'instant'`**, so they appear as a "Size border" section
  (`humanizeSectionPrefix('multigraph.sizeBorder')`,
  `components/ui/SettingsPanel/lib/panelSections.ts:73`) with no panel code.
  `Multigraph.svelte` already re-reads `cfg` per render, so instant is honest.
  Controls, chosen for usability rather than legality as the schema's own
  comment asks:

  | Path                                     | Control                                               | Label              |
  | ---------------------------------------- | ----------------------------------------------------- | ------------------ |
  | `multigraph.sizeBorder.referenceBytes`   | `number`, `min: 1`, `step: 1024`, `integer`, unit `B` | Reference size     |
  | `multigraph.sizeBorder.widthPerDoubling` | `range` `0..0.5` step `0.01`                          | Width per doubling |
  | `multigraph.sizeBorder.minFactor`        | `range` `0.1..1` step `0.05`, unit `×`                | Thinnest border    |
  | `multigraph.sizeBorder.maxFactor`        | `range` `1..4` step `0.1`, unit `×`                   | Thickest border    |

  Help text says what each does in reader terms ("A node of this many bytes
  draws the normal border.", "How much thicker the border gets each time the
  size doubles."). `referenceBytes` is a `number` because a byte count spans too
  many orders of magnitude for a slider; precedent is `math.maxExpand`
  (`config/configSchema.ts:184-193`).

- **Readability at the cap.** **Keep `maxFactor: 3`** (owner ruling); the
  arithmetic, at the default 200 px radius:
  - The border is 8 × 3 = **24 px per side**, leaving a 352 px padding-box
    circle (88 % of the 400 px diameter; 384 px at the default 8 px).
  - The title's auto-fitting box is `.square`, 400/√2 ≈ **282.8 px**
    (`Node/NodeCompactContent.svelte:214-215`). Its edge midpoints sit 141.4 px
    from the centre, well inside the 176 px padding radius, so a title is never
    cut off at the top, bottom or sides. Its corners already sit on the outer
    edge (radius 200) and are already clipped at the default width; at ×3 the
    square guaranteed fully visible shrinks from 271.5 px to **248.9 px**
    (176 × √2). Text is centred, so only a title long enough to fill the square's
    corners loses anything.
  - **The badge and chip bands do clip at the cap.** The add-on badge row sits
    directly above the square (`NodeCompactContent.svelte:142-162`) and is
    ≈ 41 px tall (0.9 × 38 px × line-height 1.2), reaching 182.4 px from the
    centre; the quantity-chip row below (`:171-187`) is ≈ 39.9 px
    (0.75 × 38 px × 1.4), reaching 181.3 px. Both clear the default 192 px
    padding radius and lose **≈ 6 px** to a 176 px one. The largest factor that
    clears both is ≈ **2.2** (border ≤ 17.6 px). Recorded under Risks; it is a
    one-line default change if the owner prefers it.
  - `minFactor` 0.5 gives a 4 px border, which only ever adds room.

- **Showing the number.** **One muted "Size" line in the details view, only
  when `sizeBytes` is present**, formatted with `formatByteSize`. It goes
  between the task toggle (`NodeDetailsContent.svelte:464`) and the description
  (`:483`), so it reads as a fact about the node rather than about any one
  attachment. A stored `0` shows "0 B": the view reports what is stored; the
  border's "treat 0 as unknown" is a drawing rule.

## Out of scope (for this plan)

- Editing `sizeBytes` in the edit sheet or anywhere else in the UI.
- Deriving size from attachments (see the resolution above).
- The scraper or importer that writes `sizeBytes`, including back-filling the
  PHYS-121 example. That file is untracked and must not be modified.
- Mapping size to node scale, radius, layout or physics.
- A legend or scale bar explaining border widths.
- Size in search, filter or graph queries.
- Showing size on the `!ai` workbench focus surface (`Multigraph.svelte`
  `{#if detailsNode?.addons?.ai}` branch), which does not render
  `NodeDetailsContent`.
- Changing `frameGeometry.ts` or `NodeChrome.svelte`.

## Tasks

### T01 — Pure size-to-border mapping, config group and schema entries

|                |                                                                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                                                                                                                |
| **Wave**       | 1                                                                                                                                                                                |
| **Agent**      | fast/cheap                                                                                                                                                                       |
| **Effort**     | S                                                                                                                                                                                |
| **Files**      | `appConfig.ts`, new `components/ui/Multigraph/lib/sizeBorder.ts`, new `components/ui/Multigraph/lib/sizeBorder.spec.ts`, `config/configSchema.ts`, `config/configSchema.spec.ts` |
| **PR title**   | `feat(graph): add a bounded log mapping from node size to border width`                                                                                                          |

Add the `multigraph.sizeBorder` group to `APP_CONFIG` with the four defaults and
inline comments in the file's existing style. Add the four `CONFIG_SCHEMA`
entries from the table above, declared directly after
`'multigraph.minNodeHitRadiusPx'` (`config/configSchema.ts:230-240`) so the
"Size border" section lands after the node fields. Bump the pinned leaf count in
`config/configSchema.spec.ts:78-81` from 106 to 110.

`sizeBorder.ts` exports one function:

```ts
borderWidthFactorForSize(
  sizeBytes: number | undefined,
  settings: Partial<SizeBorderSettings> = {}
): number
```

Missing settings fall back to `APP_CONFIG.multigraph.sizeBorder` at call time,
following the "tunables as parameters" convention. Keep the settings type
unexported unless something outside the module imports it (knip).

**Acceptance**

- `sizeBorder.spec.ts`, with every case passing explicit settings so the
  defaults can change without breaking it:
  - size equal to `referenceBytes` → exactly 1;
  - twice the reference → `1 + widthPerDoubling`; half → `1 - widthPerDoubling`;
  - a size far below the reference → `minFactor`; far above → `maxFactor`;
  - `undefined`, `0`, `NaN`, `Infinity`, `-Infinity` and a negative size → 1;
  - `referenceBytes` 0 / negative / `NaN`, and `widthPerDoubling` `NaN` → 1;
  - crossed bounds (`minFactor` 2, `maxFactor` 1.5) clamp to `[1.5, 2]`;
  - calling with no settings uses the shipped defaults (1 MiB → 1).
- The existing `configSchema.spec.ts` checks pass: every leaf classified, range
  defaults inside their bounds, the `number` default inside its bounds.
- `pnpm --filter mind-map-sv check` passes (the mapped type proves the schema
  covers the new leaves).

### T02 — `sizeBytes` on NodeData: type, load-time cleaning, merge, fixtures

|                |                                                                                                                                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Depends on** | —                                                                                                                                                                                                                                                                        |
| **Wave**       | 1 (parallel with T01)                                                                                                                                                                                                                                                    |
| **Agent**      | default (opus)                                                                                                                                                                                                                                                           |
| **Effort**     | S                                                                                                                                                                                                                                                                        |
| **Files**      | `components/ui/types/node.ts`, `migrations.ts`, `migrations.spec.ts`, `components/ui/Multigraph/lib/nodeMerge.ts`, `components/ui/Multigraph/lib/nodeMerge.spec.ts`, `components/ui/Multigraph/lib/testFixtures.ts`, `components/ui/Multigraph/lib/testFixtures.spec.ts` |
| **PR title**   | `feat(graph): add optional sizeBytes to nodes and drop invalid sizes on load`                                                                                                                                                                                            |

- `node.ts`: add `sizeBytes?: number` to `NodeData` with a doc comment saying
  who writes it (importers and scrapers), what it measures (the external thing
  the node stands for, not its attachments) and that absent means unknown.
- `migrations.ts`: add `withValidNodeSizes(data)` and compose it in
  `unwrapPersistedGraph` (`:161-163`) as
  `withSeededComponentPins(withValidNodeSizes(unwrapPersistedGraphData(payload)))`.
  It returns `data` by identity when no node needs cleaning, and otherwise a new
  object with only the offending nodes rebuilt (key removed, not set to
  `undefined`, so a re-save does not write `"sizeBytes": null`). Leave
  `isNodeData` and `CURRENT_SCHEMA_VERSION` alone.
- `nodeMerge.ts`: in `mergeNodeFields` (`:81-92`) set
  `sizeBytes: survivor.sizeBytes ?? absorbed.sizeBytes`, the same shape as the
  neighbouring `lastPinnedSeq: maxDefined(...)` (`:87`, `:122-126`).
- `testFixtures.ts`: `makeGraph` gains an optional `sizeBytes` record, keyed by generated index or explicit id exactly like `pinHistory`
  (`:33`, `:52-61`). Explicit `nodes` already accept the field through
  `MakeNodeInput`.

**Acceptance**

- `migrations.spec.ts`: a v8 payload with valid `sizeBytes` (including `0`)
  round-trips through `wrapPersistedGraph` → `unwrapPersistedGraph` unchanged;
  a payload whose nodes carry `-1`, `"12"`, `null` and a non-numeric object loads
  with those keys absent and every other field intact; a payload with no sizes
  comes back by identity from the cleaning pass; `CURRENT_SCHEMA_VERSION` is
  still 8. (`NaN`/`Infinity` cannot survive `JSON.parse`, so cover them with a
  direct `unwrapPersistedGraph` call on an object.)
- `nodeMerge.spec.ts`: survivor size wins; absorbed size fills a sizeless
  survivor; two sizeless nodes merge to
  `sizeBytes` `undefined`.
- `testFixtures.spec.ts`: `sizeBytes: { 0: 10, n2: 20 }` lands on the right
  nodes and nowhere else.
- No existing spec changes other than additions.

### T03 — Draw the size as border width on the canvas and in the focus morph

|                |                                                                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T01, T02                                                                                                                                     |
| **Wave**       | 2                                                                                                                                            |
| **Agent**      | default (opus)                                                                                                                               |
| **Effort**     | M                                                                                                                                            |
| **Files**      | `components/ui/Multigraph/Multigraph.svelte`, `components/ui/Multigraph/Multigraph.stories.svelte`, `components/ui/Node/Node.stories.svelte` |
| **PR title**   | `feat(multigraph): draw node size as border width`                                                                                           |

The integration task. In `Multigraph.svelte`:

- Add `nodeChromeFor(node: NodeData)` beside `nodeChromeTunables`
  (`:539-544`): compute the factor with `borderWidthFactorForSize`
  from `node.sizeBytes` and `cfg.multigraph.sizeBorder`; return `nodeChromeTunables` unchanged when the
  factor is 1, otherwise a copy with `borderWidthPx` and `pinnedBorderWidthPx`
  multiplied. Reading `cfg` inside it is what makes the settings `instant`.
- Replace `{...nodeChromeTunables}` with `{...nodeChromeFor(entry.nodeData)}` in
  the `passiveNode` snippet (`:3003-3004`) and `{...nodeChromeFor(node)}` in the
  live loop (`:3397-3398`). That covers the live nodes, reveal-wave buffer,
  exiting ghosts and creation preview with no other change (see the site table).
- In `geometryForFocusLevel` (`:1977-1982`), pass the subject node's factored
  `nodeBorderWidthPx` and `pinnedNodeBorderWidthPx` to `frameGeometry`.
  `focusNodeLayout` (`:1912-1922`) already looks the node up.
- Do not touch `NodeChrome.svelte`, `Node.svelte`, `frameGeometry.ts`, layout,
  or anything that reads `radiusByNodeId`.

**Acceptance** (story `play` functions, asserting on the `.circle`'s inline
`--node-border-width` / `--pinned-node-border-width` and computed
`borderTopWidth`):

- `Multigraph.stories.svelte` — **"nodes with larger sizes draw thicker
  borders"**: three unpinned-but-visible nodes built with
  `makeGraph({ sizeBytes })` at 10 KiB, 1 MiB and 100 MiB, with
  `relaxIterations: 0`, draw strictly increasing border widths: 4 px (floored),
  8 px, ≈ 15.97 px. A fourth node with no size draws 8 px.
- **"a pinned sized node scales its pinned border"**: a pinned 100 MiB node's
  `--pinned-node-border-width` is ≈ 15.97 px and the node keeps
  `data-pinned="true"`.
- **"tag colours fill a sized border"**: a tagged 100 MiB node keeps
  `data-tag-border="true"` and the wider width.
- **"dragging width per doubling re-draws borders live"**: using
  `MultigraphSettingsHarness` with `panelOpenAtMount`, drag the "Width per
  doubling" slider from 0.15 to 0.25 _without releasing_ (existing
  `dragSettingsSlider(slider, steps, false)` helper) and assert the 100 MiB
  node's border reaches ≈ 21.3 px during the drag while
  `settingsChangeCount` is still 0; release and assert one change with
  `{ 'multigraph.sizeBorder.widthPerDoubling': 0.25 }`.
- **A sized variant of `MorphSurfaceMatchesInStageNodeAtProgressZero`**
  (`:2461`): focusing a 100 MiB node starts the morph at the canvas node's own
  visual border width (the existing
  `localBorder * visualScale ≈ morph.borderWidth` check), so entering focus does not jump.
- `Node.stories.svelte` — **"title stays inside the circle at the thickest
  border"**: mount `Node` with `borderWidthPx` and `pinnedBorderWidthPx` set to
  `nodeBorderWidthPx × maxFactor` (read from `APP_CONFIG`, so the story follows
  the default) and assert the `.title` element is visible, its text matches, and
  its bounding rect lies inside the circle's rect inset by the computed border
  width on every side. Run it for the existing short title and the long title
  used by `LongClosed` (`Node.stories.svelte:197`).
- Existing `Multigraph.stories.svelte` and `Node.stories.svelte` stories pass
  unchanged — no graph in them carries `sizeBytes`, so every factor is 1.

### T04 — Show the stored size in the details view

|                |                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Depends on** | T02                                                                                                                |
| **Wave**       | 2 (parallel with T03)                                                                                              |
| **Agent**      | fast/cheap                                                                                                         |
| **Effort**     | XS                                                                                                                 |
| **Files**      | `components/ui/Multigraph/NodeDetailsContent.svelte`, `components/ui/Multigraph/NodeDetailsContent.stories.svelte` |
| **PR title**   | `feat(details): show a node's size in its details view`                                                            |

Between the task toggle block (`NodeDetailsContent.svelte:464`) and the
description (`:483`), render
`<p class="node-size" data-node-size><span class="node-size-label">Size</span> {formatByteSize(node.sizeBytes)}</p>`
only when `node.sizeBytes !== undefined`. Style it in the same muted slate the
file rows use for their size, at the details body size; no new colours.

**Acceptance**

- Story `play`: a node with `sizeBytes: 3_355_443` shows "Size 3.2 MB".
- Story `play`: a node with no `sizeBytes` renders no `[data-node-size]`.
- Story `play`: `sizeBytes: 0` shows "Size 0 B".
- The existing details stories pass unchanged.

### T05 — Teach the authoring guide about `sizeBytes`; regenerate generated files

|                |                                                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T03, T04                                                                                                                                                                        |
| **Wave**       | 3                                                                                                                                                                               |
| **Agent**      | fast/cheap                                                                                                                                                                      |
| **Effort**     | XS                                                                                                                                                                              |
| **Files**      | `apps/mind-map-sv/scripts/example-save-file.mjs`, generated `apps/mind-map-sv/examples/ai-mind-map.html`, generated `apps/mind-map-sv/static/offline-app-shell.html`, this plan |
| **PR title**   | `docs(files): document node sizeBytes in the AI authoring guide`                                                                                                                |

The AI-readable example save (plan `2026-09-22 ai-readable-example-save-file.md`)
is where an importer or scraper learns the node schema, so that is the doc that
must mention the new field. In `scripts/example-save-file.mjs`, extend the node
fields description (`:52`) with one sentence: optional `sizeBytes` is the size
in bytes of the thing the node represents (page, file, download), a finite
number ≥ 0, drawn as border thickness on a log scale; omit it when unknown.
Optionally give one guide node a `sizeBytes` so the example demonstrates it.

Then run `pnpm --filter mind-map-sv build`, confirm `pnpm check:offline-shell`
passes, and commit the regenerated shell and example as their own `chore(build)`
commit, in the established pattern. Set this plan's status to `done` and add a
dated execution note.

**Acceptance**

- `pnpm check:offline-shell` passes.
- `src/lib/exampleSaveFile.spec.ts` passes (the example still parses through
  production code).
- The regenerated example's guide text mentions `sizeBytes`.

## Wave plan

```
Wave 1   T01  ‖  T02     (disjoint: config + new pure module  /  node type,
                          migrations, merge, fixtures)
Wave 2   T03  ‖  T04     (T03 needs T01 + T02; T04 needs only T02;
                          disjoint files: Multigraph.* + Node.stories  /
                          NodeDetailsContent.*)
Wave 3   T05             (shell + example regeneration must come last, after
                          every src/** change)
```

Total: 5 tasks, 3 waves. T03 is the one that warrants a focused review: it is
the only task in `Multigraph.svelte`, and its correctness is "every ring the
canvas draws agrees", which the site table above lets a reviewer check line by
line. If one agent carries T01 and T02 together they can land as one PR; the
split exists only so they can run in parallel.

## Risks and rollback

- **Badge and chip rows clip by ≈ 6 px at the ×3 cap** (arithmetic under
  "Readability at the cap"). Only nodes near the cap (≈ 10 GiB with the
  defaults) are affected, and the title is not. If the owner wants no clipping,
  set `maxFactor` to 2.2 — one line in `appConfig.ts`, and the T03 readability
  story follows it automatically. If it is kept at 3 and the clipping is visible
  in real use, file it in `docs/debt/` rather than widening this plan into
  moving the bands.
- **A zero base width hides size entirely.** The factor multiplies
  `nodeBorderWidthPx`; a reader who sets it to 0 in the panel sees no size. That
  is consistent ("you turned borders off") and needs no special case.
- **A thick grey border could be mistaken for "pinned".** Pinned nodes differ by
  colour (`#555` vs `#aaa`) and a white halo, not by width (both 8 px by
  default), so width does not collide with the pin signal. If a reader has
  configured pinned borders wider than normal ones, the factor multiplies both,
  preserving their ratio.
- **The size compounds with hop scale.** A far node at `minScale` 0.1 shows a
  ×0.5 border as 0.4 px. Acceptable: far nodes are small on purpose, and the
  size is legible again as soon as the reader pins closer.
- **Missing a ring site makes a node's border jump** (when it starts exiting,
  joins the reveal-wave buffer, or enters focus). Routing both `<Node>` sites
  through one `nodeChromeFor` and pinning the focus handoff with a sized story
  are the mitigations; the site table is the review checklist.
- **Merge semantics may be wrong for some real case** (two genuinely different
  files merged on purpose). It is one line in `nodeMerge.ts` and does not affect
  stored data shape, so revisiting it is cheap.
- **Rollback.** Every task is additive. Reverting T03 alone returns the canvas to
  uniform borders while keeping the data, the settings and the details line;
  reverting T02 is safe because older builds already ignore the key.

## Definition of Done (this plan)

- All five tasks merged.
- `pnpm --filter mind-map-sv lint`, `check`, `test:unit -- --run` and `knip`
  pass; `pnpm check:offline-shell` passes with the regenerated shell and example
  committed.
- A graph whose nodes carry `sizeBytes` draws visibly graded borders, with tag
  colours and pinned styling intact, and the details view names each size.
- The "Size border" section appears in the settings panel and every one of its
  fields re-draws borders while dragging.
- The PHYS-121 example (no sizes) opens and draws exactly as before — manual
  smoke check, since every factor is 1.
- Plan status is `done`.

## Notes

- 2026-10-11: The motivating example carries no sizes yet (`grep -c sizeBytes`
  on it returns 0), so this plan ships the rendering ahead of the data on
  purpose; the scraper change that fills `sizeBytes` is separate and can be
  tested against T05's guide.
- 2026-10-11: Owner confirmed `maxFactor: 3` over the clip-free 2.2, to be
  revisited once sized graphs are seen in use.
- 2026-10-11: Considered and rejected: validating `sizeBytes` inside
  `isNodeData`. It would make one malformed number reject a whole scraped graph,
  which is the opposite of the "drop invalid values" ruling.
- 2026-10-11: If an attachment-sum fallback is ever wanted, it belongs in
  `nodeChromeFor` (`node.sizeBytes ?? attachmentBytes(node, graph.assets)`) and
  `sizeBorder.ts` needs no change.
- 2026-10-11: executed. What landed:
  - T01 — new pure `lib/sizeBorder.ts` exporting `borderWidthFactorForSize`
    (bounded log2 mapping, order-insensitive clamp, factor 1 for an unknown,
    zero or non-finite size and for degenerate settings), the
    `APP_CONFIG.multigraph.sizeBorder` group with the four defaults, and the
    four basic-tier `instant` schema entries that make the "Size border"
    panel section. The pinned leaf count in `configSchema.spec.ts` is now 110.
  - T02 — optional `NodeData.sizeBytes`; `withValidNodeSizes` drops any size
    that is not a finite number ≥ 0 (key removed, input returned by identity
    when clean) and is composed in `unwrapPersistedGraph` after the per-tag
    physics plan's `withSanitizedTagPhysicsConfig` and before
    `withSeededComponentPins`. `mergeNodeFields` keeps the survivor's size and
    falls back to the absorbed node's; `makeGraph` takes a `sizeBytes` record
    keyed by index or id. No schema bump.
  - T03 — `nodeChromeFor(node)` in `Multigraph.svelte` feeds all three ring
    sites: the live node loop, the `passiveNode` snippet (reveal-wave buffer,
    exiting ghosts, creation preview) and the focus morph's source end in
    `geometryForFocusLevel`. Stories: `NodesWithLargerSizesDrawThickerBorders`,
    `APinnedSizedNodeScalesItsPinnedBorder`, `TagColoursFillASizedBorder`,
    `DraggingWidthPerDoublingRedrawsBordersLive`,
    `SizedMorphSurfaceMatchesInStageNodeAtProgressZero`, and in
    `Node.stories.svelte` the short- and long-title
    `…StaysInsideTheCircleAtTheThickestBorder` pair. The T03 agent found that
    Chromium rounds a fractional border width down to whole device pixels (a
    15.97 px border draws as 15 px at a device pixel ratio of 1), so the
    stories assert the inline CSS custom property exactly and the drawn
    `borderTopWidth` to within one device pixel below it.
  - T04 — a muted "Size" line (`[data-node-size]`, `formatByteSize`) between
    the task toggle and the description, shown only when `sizeBytes` is
    present; stories `ShowsAStoredSizeAboveTheDescription`,
    `ShowsNoSizeLineWhenNoSizeIsStored` and `ShowsAStoredZeroSizeAsZeroBytes`.
  - T05 — `scripts/example-save-file.mjs` gained one sentence in the node
    fields paragraph, and the Database example node carries
    `sizeBytes: 52428800` (50 MiB) so the example draws one thicker border.
- 2026-10-11: `maxFactor` stays at 3 per the owner. The motivating PHYS-121
  example still carries no sizes; the scraper work that fills `sizeBytes` is
  separate.
- 2026-10-11: the offline shell and `examples/ai-mind-map.html` were **not**
  regenerated by T05: the orchestrator runs one build that regenerates both
  after all four 2026-10-11 plans land. Until then `pnpm check:offline-shell`
  and the two deterministic `exampleSaveFile.spec.ts` cases are owed, as for
  the sibling plans.
