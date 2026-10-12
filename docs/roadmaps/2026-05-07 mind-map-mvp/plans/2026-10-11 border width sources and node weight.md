# Plan: Border width sources and node weight

**Created:** 2026-10-11
**Author:** Claude agent
**Milestone:** none — extends [2026-10-11 node size as border width](./2026-10-11%20node%20size%20as%20border%20width.md)
**Status:** done
**Total estimated effort:** M

## Summary

The node-size plan made border width show one number, `NodeData.sizeBytes`.
This plan lets each graph choose what the border width shows. A new per-graph
setting picks the source: nothing, size, a new generic `NodeData.weight`, or one
of three values computed from the graph (edge count, attachment count,
description length). All sources share the bounded log curve that already
exists. Importers and scrapers can write `weight` and name it for the graph
(`weightConfig: { label: 'Word count' }`), and the details view shows it as
"Word count 4,200". The owner ruled on 2026-10-11: "a source selector with a few
computed sources plus a generic weight".

The default source is `size`, so a graph with no settings draws exactly as it
does today.

Paths below are relative to `apps/mind-map-sv/src/lib/` unless they start with
`apps/`, `scripts/` or `docs/`. Every file:line reference was checked on
`feature/graph-tunables` at `956654c`.

## How it works today

- **One source, hard-wired.** `nodeChromeFor(node)`
  (`components/ui/Multigraph/Multigraph.svelte:550-567`) calls
  `borderWidthFactorForSize(node.sizeBytes, cfg.multigraph.sizeBorder)` and
  multiplies both border widths of `nodeChromeTunables` (`:544-549`) by the
  result. It feeds all three ring sites: the `passiveNode` snippet (`:3302`),
  the live node loop (`:3689`) and the focus morph's source end in
  `geometryForFocusLevel` (`:2231-2239`). It is imported at `:260`.
- **The curve.** `components/ui/Multigraph/lib/sizeBorder.ts:43-64` computes
  `clamp(1 + widthPerDoubling * log2(sizeBytes / referenceBytes), min, max)`.
  The clamp works whichever bound is larger. It returns 1 for an undefined, 0,
  negative or non-finite size, and for a degenerate setting.
- **Config.** `appConfig.ts:83-91` declares `multigraph.sizeBorder =
{ referenceBytes: 1048576, widthPerDoubling: 0.15, minFactor: 0.5,
maxFactor: 3 }`. Four basic-tier, `instant` schema entries cover it
  (`config/configSchema.ts:242-284`). The panel builds a "Size border" section
  from them with no panel-specific code.
- **Data.** `NodeData.sizeBytes?` (`components/ui/types/node.ts:189-197`).
  `withValidNodeSizes` (`migrations.ts:169-199`) runs after
  `withSanitizedTagPhysicsConfig` (`:201-218`) in `unwrapPersistedGraph`
  (`:163-167`) and drops any size that is not a finite number ≥ 0. When nodes
  merge, `mergeNodeFields` keeps the survivor's size
  (`components/ui/Multigraph/lib/nodeMerge.ts:81-96`). `makeGraph` accepts a
  `sizeBytes` record (`components/ui/Multigraph/lib/testFixtures.ts:39-40`,
  `:68`, `:74`).
- **Details.** The details view shows a muted "Size" line between the task
  toggle and the description, only when `sizeBytes` is present
  (`components/ui/Multigraph/NodeDetailsContent.svelte:483-494`, styles
  `:721-729`). It has no access to graph-level fields other than `assets`,
  which is passed in at the single mount, `Multigraph.svelte:3921-3923`.
- **The schema machinery has no string control.** `FieldSpec`
  (`config/configSchema.ts:17-48`) has four variants: `hidden`, `toggle`,
  `range` and `number`. `SettingField.svelte:41-61` maps each variant to a
  view, and drops the field when the runtime type of the value does not match
  the control. `coerceToSchema` (`config/configOverrides.ts:159-179`) handles
  hidden and toggle, then drops anything that is not a number. The spec
  explicitly forbids exposing a string leaf
  (`config/configSchema.spec.ts:167-172`).
- **String leaves already flow through the types.** `ConfigValue` is
  `number | boolean | string` (`config/configPaths.ts:4`), and `LeafPaths`
  (`:24-28`) ends a path at any `ConfigValue`. `ai.defaultModel` and
  `ai.effort.analyse` are string leaves today, both hidden. `WidenConfigValue`
  (`:10-16`) and `WidenConfigBranch` (`configOverrides.ts:21-28`) widen
  `APP_CONFIG`'s `as const` literal `'size'` to `string`. So
  `ResolvedConfig['multigraph']['borderWeight']['source']` is `string`, not a
  union, and the pure code below accepts `string` for that reason.
  `readConfigDefault` (`configOverrides.ts:39-49`) and `setOverride`
  (`:99-114`) already handle strings.
- **The section heading is the last segment of the path prefix.**
  `humanizeSectionPrefix` (`components/ui/SettingsPanel/lib/panelSections.ts:73-77`)
  takes only the last segment, so `multigraph.borderWeight.reference.size`
  would land in a section titled just "Reference".
- **`graph` is reassigned on every relax frame.** `applyGraph: (nextGraph) => {
graph = nextGraph; }` (`Multigraph.svelte:976-978`). Anything derived from
  `graph` recomputes per frame, so a per-node scan of the edges would cost
  O(N·E) per frame.
- **Derived dataflow edges are never in `graph.edges`.** They are composed
  into `visibleGraph` (`Multigraph.svelte:1167-1171`), marked with the
  `dataflow:` id prefix (`components/ui/Multigraph/lib/derivedEdges.ts:16-26`),
  and filtered out on import (`components/ui/Multigraph/lib/graphImport.ts:60-63`).
- **Graph-level optional fields have a fixed set of touchpoints.**
  `tagPhysicsConfig` is the model for `weightConfig`:
  - type: `components/ui/types/multigraph.ts:52`
  - load cleaning: `migrations.ts:201-251`
  - undo deltas: `graphDelta.ts:55-63`, `:66-81`, `:84-119`, `:144-157`
  - history identity: `components/ui/Multigraph/lib/graphIdentity.ts:34-43`,
    `:55-64`
  - import merge: `graphImport.ts:104`, `:121`, `:137-149`
  - fixtures: `testFixtures.ts:46`, `:100`

## Open questions resolved

- **Where the source is chosen.** **A per-graph setting,
  `multigraph.borderWeight.source`**, a string leaf that takes one of `'none' |
'size' | 'weight' | 'degree' | 'attachments' | 'descriptionLength'`.
  **Default `'size'`**, so every existing graph and story draws as it does now.
  Settings are already per graph and travel with the file, which fits: what a
  border means is a property of the graph, not of the browser.

- **The `select` control.** **A new `FieldSpec` variant**:

  ```ts
  | {
      control: 'select';
      label: string;
      help?: string;
      tier: Tier;
      preview: Preview;
      options: readonly { value: string; label: string }[];
    }
  ```

  It is rendered by a new `SettingsPanel/SettingSelect.svelte`, a native
  `<select>` that sits beside `SettingToggle`/`SettingRange`. **A change
  commits at once and never previews**, as a toggle does
  (`SettingToggle.svelte:2-4`): choosing an option is already the whole gesture.
  It has a Reset button when the value differs from the default.
  `SettingField` gains a `select` view, used only when the value is a string
  that is one of the options. Any other value drops the field, matching the
  existing rule that a mistyped override must not cost the panel its other
  fields (`SettingField.svelte:19-21`).
  `coerceToSchema` gains a branch: a string that is one of the options is kept,
  anything else is dropped with the reason `expected one of: none, size, …`.
  **`settingValue.ts` does not change.** Its helpers format and parse numbers
  for text boxes, and a select has no text box. **`panelSections.ts` does not
  change** either: it groups by path and ignores the control type.
  A native select is used because six options do not fit as a segmented
  control in the panel's width, and on touch devices it opens the platform
  picker.

- **Option labels.** The labels use the reader's words. The stored values do
  not change (the same split as the ruling in
  `docs/ui-decisions/2026-09-06--copy--label-the-mode-switch-so-three-modes-read-as-one-choice.md`).
  The field is labelled **"Border shows"**, with help text "Which number about
  each node its border thickness shows." The options:

  | value               | label              |
  | ------------------- | ------------------ |
  | `none`              | Nothing            |
  | `size`              | Size               |
  | `weight`            | Node weight        |
  | `degree`            | Edge count         |
  | `attachments`       | Attachments        |
  | `descriptionLength` | Description length |

  The settings panel already says "edge" (the "Edge arrow" and "Edge stroke"
  sections), so the label is "Edge count", not "Degree" or "Connections".
  "Node weight" rather than plain "Weight" keeps the option distinct from the
  section heading "Border weight". The labels are static: when a graph's
  `weightConfig.label` is "Importance", the option still says "Node weight".
  Labels that follow the graph are out of scope.

- **The computed sources.** **They live in a new pure module,
  `components/ui/Multigraph/lib/nodeWeight.ts`**:

  | Source              | Value                            | No value (factor 1)                        |
  | ------------------- | -------------------------------- | ------------------------------------------ |
  | `none`              | —                                | always                                     |
  | `size`              | `node.sizeBytes`                 | absent or `0` (owner ruling: 0 is unknown) |
  | `weight`            | `node.weight`                    | absent                                     |
  | `degree`            | authored edges touching the node | never — 0 is a real count                  |
  | `attachments`       | `node.content?.length ?? 0`      | never                                      |
  | `descriptionLength` | `node.description.length`        | never                                      |
  | anything else       | —                                | always                                     |
  - **Degree counts authored edges only, in both directions.** An edge counts
    once for each endpoint, directed or not, and parallel edges each count
    (this is a multigraph). A self-loop counts once. Edges with derived ids are
    skipped even when present, so a caller that passes a render graph still
    gets the authored count. **Why derived dataflow edges are excluded:** they
    are a view of the quantity index, recomputed every render
    (`derivedEdges.ts:1-6`). They are not relations the reader drew. Counting
    them would change a node's border when someone types a symbol in another
    node, and when one quantity is both a dataflow edge and a drawn edge, the
    relation would count twice.
  - **Degree is counted on the full authored `graph`, not on `visibleGraph`.**
    The border describes the node, not the current view. With a `-#tag` filter
    or a reveal wave, a node's border should not change as its neighbours leave
    the layout.
  - **Attachments are content blocks.** `NodeContentBlock` is
    `NodeImageContent | NodeFileContent` (`types/node.ts:23`), so every block is
    an attachment. `node.content?.length ?? 0` is the count.
  - **Description length is `node.description.length`** in UTF-16 code units,
    on the raw stored text, with math left as typed and no trimming. On a log
    scale, the difference from code points or from trimmed text is too small
    to see.

- **API shape: precompute the degree map instead of passing the graph (a
  change from the brief's `nodeBorderValue(node, graph, source)`).**
  `graph` is reassigned on every relax frame (`Multigraph.svelte:976-978`). A
  function that scans `graph.edges` once per node would cost O(N·E) per frame.
  So `nodeWeight.ts` exports:

  ```ts
  authoredDegrees(edges: readonly EdgeData[]): ReadonlyMap<string, number>   // O(E)
  nodeBorderValue(node: NodeData, source: string, degrees: ReadonlyMap<string, number>): number | undefined
  formatNodeWeight(weight: number, config: WeightConfig | undefined): { label: string; text: string }
  ```

  `Multigraph.svelte` keeps `const degreeByNodeId = $derived(source === 'degree'
? authoredDegrees(graph.edges) : EMPTY_DEGREES)`. Under every other source
  this costs nothing per frame. Under `degree` it costs O(E) per frame, which
  is small next to the physics step. `nodeBorderValue` reads only the node
  plus that map. Exiting ghosts are no longer in `graph`, but they keep their
  size, weight, attachment and description values, because those sources read
  only the node. The source type stays private unless knip says otherwise.

- **Generic weight.** **`NodeData.weight?: number`.** Importers and scrapers
  write it, it must be a finite number ≥ 0, and the doc comment says it is
  whatever number the importer chose to rank nodes by. **Unlike `sizeBytes`, a
  stored `0` is a real value** and draws the thinnest border. A size of 0 means
  "could not measure"; a weight of 0 means "weighs nothing".

- **Weight display metadata.** **`MultigraphData.weightConfig?: WeightConfig`**,
  with `interface WeightConfig { label: string; unit?: string }` in
  `types/multigraph.ts`. It is graph content, like `tagColorConfig`, and is
  absent unless an importer writes it. It goes everywhere `tagPhysicsConfig`
  goes:
  - load-time cleaning: `withSanitizedWeightConfig` in `migrations.ts`. A
    non-record value, or a `label` that is not a non-blank string, drops the
    whole field. A `unit` that is not a non-blank string is dropped by itself.
    Extra keys are dropped. When the field is absent the input is returned by
    identity.
  - `GraphDelta` (`weightConfig?: WeightConfig | null`), in all four functions
    listed above.
  - `semanticallyUnchanged` and `semanticFingerprint`.
  - `importGraphData`: **the host wins, and the config is taken whole**:
    `host.weightConfig ?? incoming.weightConfig`. It is not merged key by key,
    because a label and a unit belong together. When neither side has one, the
    result has none.

  The delta and identity touchpoints matter because an import can add
  `weightConfig`, and an import can be undone. Without them, undoing an import
  would leave the incoming label behind.

- **One cleaning pass for both node numbers.** `withValidNodeSizes` becomes
  **`withValidNodeNumbers`**. It loops over the keys `['sizeBytes', 'weight']`
  and drops any value that is not a finite number ≥ 0, with the same identity
  and key-removal rules as before. The composition becomes
  `withSeededComponentPins(withValidNodeNumbers(withSanitizedWeightConfig(withSanitizedTagPhysicsConfig(unwrapPersistedGraphData(payload)))))`.
  **No schema bump**, for the same reason as the node-size plan: the fields are
  optional and additive.

- **Merge.** **The survivor's weight wins** (`weight: survivor.weight ??
absorbed.weight`), on the same reasoning as `sizeBytes`: a merge unites
  duplicates. `weightConfig` is graph-level and a merge does not touch it.

- **The curve, generalised.** **`lib/sizeBorder.ts` is renamed to
  `lib/borderWeight.ts`**. `borderWidthFactorForSize` becomes:

  ```ts
  borderWidthFactorForValue(
    value: number | undefined,
    settings: { reference: number } & Partial<{ widthPerDoubling: number; minFactor: number; maxFactor: number }>
  ): number
  ```

  **`reference` is required.** It depends on the source, so no single default
  makes sense. The slope and bounds fall back to `APP_CONFIG` as they do today.
  **One edge rule changes:** an exact `0` now passes through the log and lands
  on the floor (`log2(0) = −∞`, which clamps to `min(minFactor, maxFactor)`),
  where before it returned 1. `undefined`, negative, `NaN` and ±`Infinity`
  still return 1, and so does every degenerate setting (reference ≤ 0 or
  non-finite, non-finite slope). A slope of 0 still gives 1 everywhere,
  because `0 × −∞` is `NaN` and the existing non-finite guard catches it.
  **Size behaves exactly as before**: the `size` source maps a stored 0 to
  `undefined` before calling the curve. The rule changed because, under
  `degree`, an isolated node returning 1 would draw a thicker border than a
  leaf with one edge (factor 0.76).

  `borderWeight.ts` also exports the composition, so `Multigraph.svelte` stays
  one call:

  ```ts
  borderFactorForNode(node, degrees, settings: {
    source: string;
    reference: Readonly<Record<'size' | 'weight' | 'degree' | 'attachments' | 'descriptionLength', number>>;
    widthPerDoubling: number; minFactor: number; maxFactor: number;
  }): number
  ```

  `none` and unknown sources return 1. Otherwise the function looks up
  `reference[source]` with an own-key guard and calls
  `borderWidthFactorForValue(nodeBorderValue(node, source, degrees), …)`.

- **Where the per-source references live: a sibling group,
  `multigraph.borderReference`, not `multigraph.borderWeight.reference` (a
  change from the brief).** A panel section's heading is the last segment of
  its path prefix (`panelSections.ts:73-77`). A nested `reference` group would
  be headed just "Reference", and its reset button would read "Reset Reference
  section". A sibling group is headed **"Border reference"** and sits directly
  under **"Border weight"**, with no panel change. The code still sees one
  object: `Multigraph.svelte` derives `{ ...cfg.multigraph.borderWeight,
reference: cfg.multigraph.borderReference }`.

  ```ts
  // Border width can show one number per node on a bounded log scale:
  // `clamp(1 + widthPerDoubling * log2(value / reference), minFactor, maxFactor)`
  // multiplies both border widths above. `source` picks the number; a node with
  // no value for it draws the widths as-is.
  borderWeight: {
    source: 'size', // none | size | weight | degree | attachments | descriptionLength
    widthPerDoubling: 0.15, // factor added each time the value doubles
    minFactor: 0.5, // thinnest border, as a multiple of the configured width
    maxFactor: 3 // thickest border, as a multiple of the configured width
  },
  // The value that draws exactly the configured border, per source.
  borderReference: {
    size: 1048576, // bytes (1 MiB)
    weight: 1,
    degree: 3, // edges
    attachments: 1,
    descriptionLength: 200 // characters
  },
  ```

  Both groups replace `sizeBorder` at `appConfig.ts:83-91`, in the same place.
  The slope, the bounds and their schema entries keep their labels, ranges and
  help text. Only the help for "Width per doubling" changes, to say "value"
  instead of "size".

- **Reference fields in the schema.** All five are basic tier, `instant`,
  `number` controls, with the help text "A node at this value draws the normal
  border."

  | Path                                           | Label                        | Bounds                                        |
  | ---------------------------------------------- | ---------------------------- | --------------------------------------------- |
  | `multigraph.borderReference.size`              | Reference size               | `min: 1`, `step: 1024`, `integer`, unit `B`   |
  | `multigraph.borderReference.weight`            | Reference node weight        | none (see below)                              |
  | `multigraph.borderReference.degree`            | Reference edge count         | `min: 1`, `step: 1`, `integer`                |
  | `multigraph.borderReference.attachments`       | Reference attachment count   | `min: 1`, `step: 1`, `integer`                |
  | `multigraph.borderReference.descriptionLength` | Reference description length | `min: 1`, `step: 10`, `integer`, unit `chars` |

  **Reference node weight has no `min`.** Weights can be fractional and of any
  scale, `number` bounds clamp hard (`configOverrides.ts:144-157`), and there is
  no honest smallest positive number to use. A reference ≤ 0 already draws the
  normal border.
  **All five are always shown**, whichever source is selected. The panel cannot
  show a field conditionally, and adding that is out of scope. Each label names
  its source, so the reader can tell which one applies.
  The leaf count in `configSchema.spec.ts:78-81` goes **110 → 115**: four
  `sizeBorder` leaves are removed, and four `borderWeight` leaves plus five
  `borderReference` leaves are added.

- **Old `multigraph.sizeBorder.*` overrides.** **Dropped by
  `sanitizeOverrides`, not migrated.** The keys are a day old and have never
  reached `main`. Dropping is what the trust boundary already does with an
  unknown key (`configOverrides.ts:215-218`). Normal loads drop it silently
  (`persistence.ts:214`, `config/settingsSeed.ts:44`). Importing settings from
  a file shows the standard "Unknown setting … was dropped" warning
  (`graphFile.ts:212-231`). A spec case pins this behaviour.

- **Schema spec changes.** The test "never exposes a string leaf to a numeric
  control" (`configSchema.spec.ts:167-172`) is replaced by three tests:
  - every exposed string leaf uses `select`, and every `select` sits on a
    string leaf;
  - every `select` default is one of its options;
  - every `select` has at least two options, and their values are distinct.

- **How weight shows in the details view.** **A muted line directly under the
  "Size" line**, shown only when `node.weight !== undefined`. Its label is
  `weightConfig?.label ?? 'Weight'`, followed by the value and, if there is
  one, the unit: "Word count 4,200", "Mass 12.5 kg", "Weight 7". A stored 0
  shows "Weight 0".
  **The number is formatted with `Intl.NumberFormat('en-US', {
maximumFractionDigits: 2 })`.** The UI is English, grouping makes a number
  like 4,200 readable, and a fixed locale keeps the stories deterministic.
  `NodeDetailsContent` gets an optional `weightConfig?: WeightConfig` prop,
  which `Multigraph.svelte:3921` passes as `weightConfig={graph.weightConfig}`.
  The existing `.node-size` CSS rule is generalised to a shared `.node-fact`
  class used by both lines. The data attributes `data-node-size` and the new
  `data-node-weight` stay separate, so the existing stories still select the
  size line. Weight cannot be edited.

## Out of scope (for this plan)

- Tag-driven width (a × factor per node tag).
- Editing `weight` or `weightConfig` in the UI.
- A legend or scale bar explaining border widths.
- Mapping any source to node scale, radius, layout or physics.
- Option labels that follow `weightConfig.label`, and showing settings fields
  conditionally (e.g. only the active source's reference).
- A separate slope per source (see Risks).
- Weight in search, filter or graph queries, and on the `!ai` workbench focus
  surface. Both are excluded for the same reasons the node-size plan gave.
- The scraper or importer that writes `weight`/`weightConfig`.
- Changes to `frameGeometry.ts`, `NodeChrome.svelte`, `Node.svelte`,
  `panelSections.ts` or `settingValue.ts`.

## Tasks

### T01 — A `select` control in the settings machinery

|                |                                                                                                                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                                                                                                                                          |
| **Wave**       | 1                                                                                                                                                                                                          |
| **Agent**      | default (opus)                                                                                                                                                                                             |
| **Effort**     | S                                                                                                                                                                                                          |
| **Files**      | `config/configSchema.ts` (type only), new `components/ui/SettingsPanel/SettingSelect.svelte`, `components/ui/SettingsPanel/SettingField.svelte`, `components/ui/SettingsPanel/SettingField.stories.svelte` |
| **PR title**   | `feat(settings): add a select control to the schema-driven panel`                                                                                                                                          |

- Add the `select` variant to `FieldSpec` (`configSchema.ts:17-48`). Add no
  schema entries yet: T03 adds the first `select` leaf.
- `SettingSelect.svelte`: a native `<select>` with `aria-label={label}` and
  `title={help}`, plus one `<option>` per spec option. A change calls
  `onCommit(value)`. There is no `onPreview` prop. It shows the same Reset
  button as `SettingToggle` (`:41-45`) when `isModified`. Its height matches
  `SettingNumber`'s input.
- `SettingField.svelte`: add `SelectSpec` and a `{ kind: 'select'; spec;
value: string }` view. Use it only when `typeof value === 'string'` and the
  value is one of `spec.options`; otherwise the field is dropped (`null`).
  Dispatch to `SettingSelect`.
- `coerceToSchema` is left unchanged here. With no `select` leaf, its numeric
  fall-through is unreachable for a select. T03 adds the branch together with
  the first leaf, so its spec cases can use a real path.

**Acceptance** (`SettingField.stories.svelte`, each with a fixture spec like
the existing `HiddenFieldRendersNothing` at `:272`):

- **"user picks an option and it commits immediately"**: changing the select
  fires exactly one commit carrying the option's value and no previews
  (`data-preview-count` stays 0).
- **"user sees the reset button once an option differs from the default"**.
- **"the select is named for assistive tech"**: `getByRole('combobox', { name:
<label> })` finds it, and it has one option per spec option, with the spec's
  labels.
- **"a value outside the options renders nothing"**.
- Existing `SettingField`, `SettingsPanel` and `configSchema` specs and stories
  pass unchanged.

### T02 — Node weight data: types, `nodeWeight.ts`, cleaning, merge, import, undo

|                |                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Wave**       | 1 (parallel with T01)                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Agent**      | default (opus)                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Effort**     | M                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Files**      | `components/ui/types/node.ts`, `components/ui/types/multigraph.ts`, new `components/ui/Multigraph/lib/nodeWeight.ts` + `.spec.ts`, `migrations.ts` + `.spec.ts`, `components/ui/Multigraph/lib/nodeMerge.ts` + `.spec.ts`, `components/ui/Multigraph/lib/graphImport.ts` + `.spec.ts`, `graphDelta.ts` + `.spec.ts`, `components/ui/Multigraph/lib/graphIdentity.ts` + `.spec.ts`, `components/ui/Multigraph/lib/testFixtures.ts` + `.spec.ts` |
| **PR title**   | `feat(graph): add node weight, graph weight labels and computed border values`                                                                                                                                                                                                                                                                                                                                                                 |

- Types: `NodeData.weight?: number`, with a doc comment covering who writes it,
  what it means, that it must be finite and ≥ 0, that 0 is a real value, and
  that invalid values are dropped on load. `WeightConfig` and
  `MultigraphData.weightConfig?`.
- `nodeWeight.ts`: `authoredDegrees`, `nodeBorderValue` and `formatNodeWeight`
  as specified above. Keep the source union type private unless something
  outside the module imports it.
- `migrations.ts`: rename `withValidNodeSizes` to `withValidNodeNumbers`
  (`:169-199`) and cover `weight`. Add `withSanitizedWeightConfig` beside
  `withSanitizedTagPhysicsConfig` (`:201-218`) and compose both as above
  (`:163-167`). Leave `isNodeData`, `isMultigraphData` and
  `CURRENT_SCHEMA_VERSION` alone.
- `nodeMerge.ts:81-96`: add `weight: survivor.weight ?? absorbed.weight`.
- `graphImport.ts`: `const weightConfig = host.weightConfig ??
incoming.weightConfig`, spread in when it is defined (next to `:121`).
- `graphDelta.ts` and `graphIdentity.ts`: add `weightConfig` everywhere
  `tagPhysicsConfig` appears.
- `testFixtures.ts`: `makeGraph` gains a `weight` record (keyed like
  `sizeBytes`) and an optional `weightConfig`, which is omitted unless given.

**Acceptance**

- `nodeWeight.spec.ts`:
  - `authoredDegrees`: a star of five edges gives the hub 5 and each leaf 1.
    Directed and undirected edges count the same. Two parallel edges count 2.
    A self-loop counts 1. A `dataflow:`-prefixed edge counts 0.
  - `nodeBorderValue`: each source per the table, including `size` 0 →
    `undefined`, `weight` 0 → 0, no `content` → 0, an empty description → 0,
    `degree` for a node missing from the map → 0, and `'none'` or `'bogus'` →
    `undefined`.
  - `formatNodeWeight`: `(4200, { label: 'Word count' })` →
    `{ label: 'Word count', text: '4,200' }`; `(12.5, { label: 'Mass', unit:
'kg' })` → text `'12.5 kg'`; `(7, undefined)` → label `'Weight'`;
    `1/3` → `'0.33'`.
- `migrations.spec.ts`: `weight` gets the same cases as `sizeBytes` (a valid
  value, including 0, round-trips; `-1`, `"7"`, `null`, `NaN` and objects are
  dropped with every other field intact). `weightConfig` cases:
  - a valid config round-trips;
  - a blank `unit` is dropped and the label kept;
  - a missing or blank `label` drops the whole config;
  - a non-record value drops the field;
  - a graph with neither field comes back by identity.

  The existing `sizeBytes` cases pass unchanged.

- `nodeMerge.spec.ts`: the survivor's weight wins, the absorbed node's weight
  fills a gap, and the survivor's 0 beats the absorbed node's 5.
- `graphImport.spec.ts`: the host's config wins whole; an incoming config is
  adopted into a host that has none; neither side having one gives no field.
- `graphDelta.spec.ts`: a delta adds, changes and removes `weightConfig`
  (`null`), and `isEmptyDelta` is false when only `weightConfig` changed.
  `graphIdentity.spec.ts`: a graph that differs only in `weightConfig` is not
  `semanticallyUnchanged` and has a different fingerprint.
- `testFixtures.spec.ts`: `weight: { 0: 3, n2: 0 }` lands on exactly those
  nodes.

### T03 — Rename the config to `borderWeight`, add the source select and wire the canvas

|                |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T01, T02                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Wave**       | 2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Agent**      | default (opus)                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Effort**     | M                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Files**      | `appConfig.ts`, `components/ui/Multigraph/lib/sizeBorder.ts` → `borderWeight.ts` (+ spec, renamed with `git mv`), `config/configSchema.ts`, `config/configSchema.spec.ts`, `config/configOverrides.ts`, `config/configOverrides.spec.ts`, `components/ui/Multigraph/Multigraph.svelte`, `components/ui/Multigraph/Multigraph.stories.svelte` (path rename only), `components/ui/Node/Node.stories.svelte` (path rename only), `components/ui/SettingsPanel/SettingsPanel.stories.svelte` |
| **PR title**   | `feat(multigraph): let each graph choose what border width shows`                                                                                                                                                                                                                                                                                                                                                                                                                        |

This task carries out the rename completely, so that the gates are green when
it lands.

- `appConfig.ts:83-91`: replace `sizeBorder` with the `borderWeight` and
  `borderReference` groups above.
- `configSchema.ts:242-284`: replace the four entries with the `select`
  source entry first, then slope, floor and cap, then the five references, in
  that order. Update `configSchema.spec.ts`: the count goes to 115, and the
  string-leaf test is replaced by the three `select` tests.
- `configOverrides.ts` `coerceToSchema` (`:159-179`): add the `select` branch
  before the numeric fall-through.
- `git mv lib/sizeBorder.ts lib/borderWeight.ts` (and its spec). Generalise to
  `borderWidthFactorForValue` and add `borderFactorForNode`.
- `Multigraph.svelte`:
  - change the import (`:260`);
  - add `borderWeightSettings = $derived({ ...cfg.multigraph.borderWeight,
reference: cfg.multigraph.borderReference })` and the gated
    `degreeByNodeId` derived described above;
  - make `nodeChromeFor` (`:559-567`) call `borderFactorForNode(node,
degreeByNodeId, borderWeightSettings)`, and update its doc comment ("Size
    border" becomes "Border weight").

  The three ring sites and the focus morph need no change: they already go
  through `nodeChromeFor`.

- Mechanical renames that keep existing stories compiling and passing:
  - `Multigraph.stories.svelte:8399`, `:8491` and `:8517`: the expected
    settings key becomes `'multigraph.borderWeight.widthPerDoubling'`;
  - `Node.stories.svelte:172-176`: read `APP_CONFIG.multigraph.borderWeight.maxFactor`.

**Acceptance**

- `borderWeight.spec.ts`: every existing `sizeBorder.spec.ts` case passes
  against `borderWidthFactorForValue` with `reference` in place of
  `referenceBytes`, except the 0 case. That case now expects the floor: 0
  draws `minFactor`, crossed bounds give the lower bound, and a slope of 0
  gives 1. New `borderFactorForNode` cases:
  - `'none'` → 1, and `'bogus'` → 1;
  - `size` with a 2 MiB node → 1.15, and with a 0-byte node → 1;
  - `degree` 5 against reference 3 → `1 + 0.15·log2(5/3)` ≈ 1.1105;
  - `degree` 0 → `minFactor`;
  - the reference is read from the selected source's entry.
- `configOverrides.spec.ts`:
  - `clampToSchema('multigraph.borderWeight.source', 'degree')` → `'degree'`;
    `'bogus'`, `3` and `true` → `undefined`;
  - `sanitizeOverrides({ 'multigraph.sizeBorder.widthPerDoubling': 0.25 })`
    drops the key with an "Unknown setting" warning (pins the "dropped, not
    migrated" decision);
  - `setOverride(…, 'multigraph.borderWeight.source', 'size')` clears the key.
- `SettingsPanel.stories.svelte`, **"the border weight section offers a source
  select"**: the basic tier shows a "Border weight" section whose first field
  is a "Border shows" combobox with the six labelled options and "Size"
  selected, followed by a "Border reference" section with five numeric fields.
- Every existing size story passes with the default source:
  `NodesWithLargerSizesDrawThickerBorders`, `APinnedSizedNodeScalesItsPinnedBorder`,
  `TagColoursFillASizedBorder`, `DraggingWidthPerDoublingRedrawsBordersLive`
  (with the renamed key), `SizedMorphSurfaceMatchesInStageNodeAtProgressZero`,
  and the two `Node.stories.svelte` readability stories.
- `pnpm --filter mind-map-sv check` passes, which shows that the mapped schema
  type covers the new leaves and that `ResolvedConfig` exposes `source: string`.

### T04 — Canvas stories for every source and for switching live

|                |                                                      |
| -------------- | ---------------------------------------------------- |
| **Depends on** | T03                                                  |
| **Wave**       | 3                                                    |
| **Agent**      | default (opus)                                       |
| **Effort**     | S                                                    |
| **Files**      | `components/ui/Multigraph/Multigraph.stories.svelte` |
| **PR title**   | `test(multigraph): cover each border weight source`  |

Add these stories next to the size stories (`:8398-8590`). Each one passes
`settings: { 'multigraph.borderWeight.source': … }` and `relaxIterations: 0`.
Assert on the `.circle`'s inline `--node-border-width` /
`--pinned-node-border-width`, and on the drawn `borderTopWidth` to within one
device pixel below it, using the existing `expectDrawnBorder` helper (the
rounding finding in the node-size plan's execution notes). The expected values
assume an 8 px base:

- **"a hub draws a thicker border than its leaves under edge count"**: a pinned
  hub with five spokes. The hub's pinned width is ≈ 8.88 px
  (`8 × (1 + 0.15·log2(5/3))`) and each leaf's normal width ≈ 6.10 px
  (`8 × (1 + 0.15·log2(1/3))`), so the hub is strictly greater.
- **"nodes with more attachments draw thicker borders"**: spokes carrying 0, 1
  and 4 file blocks, with matching `assets` metadata so the canvas renders
  them as it would a real graph, draw 4, 8 and 10.4 px.
- **"longer descriptions draw thicker borders"**: descriptions of 0, 50, 200
  and 800 characters draw 4, 5.6, 8 and 10.4 px.
- **"node weight draws the border and zero is the thinnest"**: weights absent,
  0, 1 and 8 draw 8, 4, 8 and 11.6 px.
- **"choosing nothing draws every border the same"**: `SIZED_SPOKES`
  (`:1562-1579`) under `'none'` draws 8 px on every spoke, including the
  100 MiB one.
- **"choosing a source in settings redraws borders at once"**: uses
  `MultigraphSettingsHarness` with `SIZED_SPOKES` and `panelOpenAtMount`.
  1. The 100 MiB node starts at ≈ 15.97 px.
  2. Choose "Nothing" in the "Border shows" select. Assert 8 px,
     `settingsChangeCount` 1, and settings `{ 'multigraph.borderWeight.source':
'none' }`.
  3. Choose "Size" again. Assert ≈ 15.97 px and settings `{}`.
- **"the morph starts from a degree-weighted border"**: the
  `SizedMorphSurfaceMatchesInStageNodeAtProgressZero` check, run on the hub
  under `degree`.

**Acceptance**: the new stories pass in the `storybook` Vitest project, and
every existing `Multigraph.stories.svelte` story still passes.

### T05 — Show a node's weight in its details view

|                |                                                                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T02, T03 (both edit `Multigraph.svelte`)                                                                                                                                               |
| **Wave**       | 3 (parallel with T04)                                                                                                                                                                  |
| **Agent**      | fast/cheap                                                                                                                                                                             |
| **Effort**     | XS                                                                                                                                                                                     |
| **Files**      | `components/ui/Multigraph/NodeDetailsContent.svelte`, `components/ui/Multigraph/NodeDetailsContent.stories.svelte`, `components/ui/Multigraph/Multigraph.svelte` (one prop at `:3921`) |
| **PR title**   | `feat(details): show a node's weight under its size`                                                                                                                                   |

- Add the `weightConfig?: WeightConfig` prop.
- Directly after the size block (`NodeDetailsContent.svelte:489-494`), render
  `<p class="node-fact" data-node-weight><span class="node-fact-label">{label}</span> {text}</p>`
  using `formatNodeWeight(node.weight, weightConfig)`, only when `node.weight
!== undefined`.
- Rename `.node-size`/`.node-size-label` (`:721-729`) to
  `.node-fact`/`.node-fact-label` and apply them to both lines. Keep
  `data-node-size` on the size line.
- In `Multigraph.svelte:3921`, pass `weightConfig={graph.weightConfig}`.

**Acceptance** (stories next to the size ones at `:2057-2088`, using
`args={{ node, weightConfig }}`):

- `weight: 4200` with `{ label: 'Word count' }` shows "Word count 4,200".
- `weight: 12.5` with `{ label: 'Mass', unit: 'kg' }` shows "Mass 12.5 kg".
- `weight: 7` with no config shows "Weight 7". `weight: 0` shows "Weight 0".
- No `weight` renders no `[data-node-weight]`.
- A node with both size and weight shows the size line first, then the weight
  line, both before the description (`compareDocumentPosition`, as in
  `ShowsAStoredSizeAboveTheDescription`).
- The three existing size stories pass unchanged.

### T06 — Authoring guide and plan close-out

|                |                                                                                      |
| -------------- | ------------------------------------------------------------------------------------ |
| **Depends on** | T04, T05                                                                             |
| **Wave**       | 4                                                                                    |
| **Agent**      | fast/cheap                                                                           |
| **Effort**     | XS                                                                                   |
| **Files**      | `apps/mind-map-sv/scripts/example-save-file.mjs`, `docs/roadmaps/TODO.md`, this plan |
| **PR title**   | `docs(files): document node weight and weightConfig in the AI authoring guide`       |

- In `scripts/example-save-file.mjs`:
  - **Nodes paragraph (`:49-56`).** Change the `sizeBytes` sentence: size is
    drawn as border thickness "when the graph's border source is size (the
    default)". Add one sentence on `weight`: optional, a finite number ≥ 0
    that ranks the node by whatever the importer measured (word count,
    importance, citations); 0 is a real value; omit it when unknown.
  - **Envelope paragraph (`:65`).** Add a sentence on `data.weightConfig`:
    optional `{ label, unit? }` that names what `weight` means in this graph.
    The details view reads "label value unit". Omit it to show "Weight".
  - **Optional.** Give two example nodes a `weight`, and give the example graph
    a `weightConfig: { label: 'Importance' }`.
- In `docs/roadmaps/TODO.md`, add this plan to the 2026-10-11 list after the
  node-size entry (`:108-109`).
- Set this plan's status to `done` and add a dated execution note.
- **Do not regenerate the offline shell or `examples/ai-mind-map.html`.** The
  orchestrator runs the one build that regenerates both once every concurrent
  plan has landed, as it did for the four previous 2026-10-11 plans. Until
  then, `pnpm check:offline-shell` and the deterministic
  `exampleSaveFile.spec.ts` cases are expected to fail. Say so in the
  execution note.

**Acceptance**: `src/lib/exampleSaveFile.spec.ts` passes for every case that
does not compare against the regenerated file. The guide text in the script
mentions `weight` and `weightConfig`.

## Wave plan

```
Wave 1   T01  ‖  T02     (disjoint: settings UI + FieldSpec type  /
                          node and graph data, nodeWeight.ts, cleaning,
                          merge, import, undo)
Wave 2   T03             (needs the select variant from T01 and nodeWeight.ts
                          from T02; owns the rename end to end, including the
                          three existing references it would otherwise break)
Wave 3   T04  ‖  T05     (T04 touches only Multigraph.stories.svelte;
                          T05 touches NodeDetailsContent.* and one prop line
                          in Multigraph.svelte — disjoint files)
Wave 4   T06             (docs and close-out after every src/** change)
```

Total: 6 tasks, 4 waves. **T03 needs a focused review.** It is the only task
that changes behaviour in `Multigraph.svelte`, and a mistake there would show
up as a ring site or the focus morph disagreeing about a border. The node-size
plan's site table is still the checklist. T03 renames a config group, so it
must land before anything else on the branch reads `cfg.multigraph.sizeBorder`.

## Risks and rollback

- **The slope is tuned for bytes, so the count sources look subtle.** With
  0.15 per doubling, a degree-1 leaf draws 6.1 px and a degree-5 hub 8.9 px,
  while bytes span twenty doublings. Readers who use a count source can raise
  "Width per doubling" (0.5 gives ×0.5 at degree 1 and ×1.5 at degree 6). A
  slope per source is the follow-up if that is not enough. It would be one
  more reference-style group, and the curve would not change.
- **Exiting ghosts thin under `degree`.** A deleted node's edges go with it,
  so during its fade (`enterExitDurationMs`, 180 ms) its count is 0 and it
  draws the floor. The other sources read only the node, so their ghosts keep
  their width. Snapshotting a factor on exit would cost more than the flash
  is worth. If it shows up in use, record it in `docs/debt/`.
- **Changing the rule for 0.** `borderWidthFactorForValue(0)` now returns the
  floor instead of 1. Only the curve function sees this change: the `size`
  source maps 0 to `undefined`, and the existing size stories and specs pin
  that behaviour.
- **Importing a graph's `weightConfig` relabels the host's weights** when the
  host has no config of its own. This follows from "host wins, else adopt",
  as it does for tag colours. Fixing it would mean a config per node, and
  nothing so far calls for that.
- **Static option labels.** "Node weight" does not become "Importance" when
  the graph names it so. This is listed under out of scope.
- **Old overrides are dropped.** A dev graph tuned on `multigraph.sizeBorder.*`
  in the last day loses that tuning on load. The keys never reached `main`.
- **The rename collides with concurrent work** that reads
  `cfg.multigraph.sizeBorder` or edits `Multigraph.svelte:544-567`. Run T03 in
  a quiet window on the branch.
- **Rollback.** Revert T03 to restore the size-only canvas. The weight data,
  the details line and the select control are additive and can stay. Reverting
  T02 is safe, because older builds already ignore both keys.

## Definition of Done (this plan)

- All six tasks merged.
- `pnpm --filter mind-map-sv lint`, `check`, `test:unit -- --run` and `knip`
  pass.
- The settings panel's "Border shows" select switches the canvas between all
  six sources immediately, and the change is saved with the graph.
- With the default source, every existing size story and the PHYS-121 example
  (which has no sizes) draw exactly as before. This is a manual smoke check.
- A node with `weight` shows a labelled weight line in its details.
- The offline shell and example regeneration is handed to the orchestrator
  (see T06).
- Plan status is `done`.

## Notes

- 2026-10-11: Two places where this plan departs from the brief, both
  explained above: the references sit in a sibling `borderReference` group
  (to get a readable panel heading), and `nodeBorderValue` takes a precomputed
  degree map rather than the graph (because `graph` is reassigned on every
  relax frame).
- 2026-10-11: Considered and rejected: `log2(value + 1)` for the count
  sources, which would avoid special-casing 0. It would give count sources a
  different curve from size and weight, so the same "Reference" and "Width per
  doubling" settings would mean two different things.
- 2026-10-11: Considered and rejected: migrating `multigraph.sizeBorder.*`
  overrides into the new keys. That would mean a permanent rename table in the
  trust boundary to protect one day of dev-only tuning.
- 2026-10-11: executed. What landed:
  - T01 — a `select` variant of `FieldSpec` in `configSchema.ts` and a new
    `SettingsPanel/SettingSelect.svelte`: a native `<select>` that commits on
    change without a preview and shows the shared Reset button when the value
    differs from the default. `SettingField` dispatches to it only for a string
    value that is one of the options. Stories in `SettingField.stories.svelte`.
  - T02 — optional `NodeData.weight` (finite ≥ 0, where 0 is a real value) and
    `MultigraphData.weightConfig { label, unit? }`. The new pure
    `lib/nodeWeight.ts` has `authoredDegrees` (an O(E) degree map that skips
    derived edges) and `nodeBorderValue`, which applies the per-source zero
    rule: a size of 0 means unknown, while a weight of 0 and every count are
    real values. It also has `formatNodeWeight`. `withValidNodeSizes` became
    `withValidNodeNumbers`, and `withSanitizedWeightConfig` was added to load
    cleaning. Merge keeps the survivor's weight; import keeps the host's
    `weightConfig` whole; deltas, `semanticallyUnchanged` and the fingerprint
    track the new field, so undoing an import removes an adopted label.
  - T03 — `sizeBorder` was renamed to `borderWeight` (`source` plus the shared
    curve) and a sibling `borderReference` group with one reference per
    source. `lib/sizeBorder.ts` became `lib/borderWeight.ts`, with
    `borderWidthFactorForValue` and `borderFactorForNode`. A value of 0 now
    lands on the floor, and the size source still maps a stored 0 to "no
    value". The "Border shows" select is the first schema `select`. Old
    `multigraph.sizeBorder.*` overrides are dropped by `sanitizeOverrides`, and
    a spec pins that. The canvas builds the degree map only under the `degree`
    source. The pinned leaf count in `configSchema.spec.ts` is now 115.
  - T04 — `Multigraph.stories.svelte` covers every source (edge count,
    attachments, description length, node weight where 0 draws the thinnest
    border, and nothing), a degree-weighted focus morph check, and a settings
    story that switches the source live: Size → Edge count → Nothing → Size.
  - T05 — `NodeDetailsContent` shows a muted weight line under the Size line
    (`[data-node-weight]`), labelled with `weightConfig.label` or "Weight", plus
    the unit when there is one. The number is formatted with `en-US` grouping.
    Both lines share the generalised `.node-fact` class.
  - T06 — the AI authoring guide in `scripts/example-save-file.mjs` documents
    `weight`, `weightConfig` and the per-graph border source. The example graph
    gained `weightConfig: { label: 'Importance' }`, and the Web application and
    API service nodes carry weights of 3 and 5. The ruling is recorded in
    `docs/ui-decisions/2026-10-11--display--border-width-shows-a-chosen-node-number.md`.
- 2026-10-11: orchestrator browser check. Switching "Border shows" from Size to
  Edge count redrew the two-edge nodes at 7.30 px and the one-edge nodes at
  6.10 px. Nothing drew 8 px everywhere. Choosing Size again restored the
  size borders and cleared the override.
- 2026-10-11: known subtlety, not a bug. The 0.15 "Width per doubling" slope is
  tuned for bytes, which span about twenty doublings, so the count sources look
  subtle until a reader raises it. A slope per source is the follow-up if that
  proves not to be enough (see Risks).
- 2026-10-11: the offline shell and `examples/ai-mind-map.html` were **not**
  regenerated by T06. The orchestrator rebuilds both right after this plan
  lands. Until then `pnpm check:offline-shell` and the two deterministic
  `exampleSaveFile.spec.ts` cases are expected to fail.
- 2026-10-12: the separate pinned border width (`pinnedNodeBorderWidthPx`) was removed by owner ruling; pinned nodes now draw the same weighted `nodeBorderWidthPx`, so the "pinned" widths above are that one width and `APinnedSizedNodeScalesItsPinnedBorder` is now `APinnedSizedNodeScalesItsBorderLikeAnyOther` (`docs/ui-decisions/2026-10-12--display--pinned-nodes-share-the-node-border-width.md`).
- 2026-10-12: weight became editable in the node edit sheet by owner request, lifting the "Editing `weight`" half of Out of scope (`weightConfig` stays import-only). A numeric field after Node tags, labelled with `weightConfig.label` (else "Weight") plus its unit, saves through `updateNodeContent` with the other drafted fields: blank removes the key, a negative clamps to 0, unreadable text keeps the stored weight. `weightName` and `weightFromDraft` in `lib/nodeWeight.ts` hold the label and parsing rules (`docs/ui-decisions/2026-10-12--editing--node-weight-is-edited-in-the-sheet.md`).
