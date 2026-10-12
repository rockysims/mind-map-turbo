# Plan: Schema-driven settings panel for appConfig

**Created:** 2026-08-29
**Author:** Claude agent
**Milestone:** none — new cross-cutting capability touching
[milestone 04f](../milestones/04f-tag-colors-and-graph-tag-config.md) (per-graph
config precedent) and
[milestone 05](../milestones/05-filter-find-search.md) (left-panel precedent)
**Status:** done
**Total estimated effort:** L

## Summary

Give each graph its own copy of the `APP_CONFIG` tunables, editable from a
left-side settings panel whose controls are generated from a schema rather than
hand-built per field. Sliders apply live so the effect on the graph is visible
while dragging. Adding a new key to `APP_CONFIG` should cost one schema line and
zero UI work — enforced by the type system, not by discipline.

## Open questions resolved

- **Schema derivation vs. hand-written descriptors.** **Hand-written
  descriptors, made non-optional by a mapped type.** Inferring a control from
  `typeof value` cannot supply range, step, unit, or label, and would be wrong
  by default for nearly every numeric field (`scaleFalloff` is legally unbounded
  but only useful in `0..1`). Instead `CONFIG_SCHEMA` is typed
  `{ [K in ConfigPath]: FieldSpec }` where `ConfigPath` is a union of dotted leaf
  paths computed from `typeof APP_CONFIG`. Adding a key to `APP_CONFIG` is then a
  **compile error** until it is described, so `pnpm check` prevents drift.

- **Where the config values live.** **`APP_CONFIG` is unchanged.** Values stay
  literal and flat. Wrapping each leaf as `{ value, ui }` would churn all 28
  importing files and make every read noisy. The schema is a sibling module keyed
  by path.

- **Where a graph's overrides are persisted.** **Beside `viewState` in the
  persisted payload envelope, _not_ inside `MultigraphData`.** `viewState` is
  already per-graph, already travels with export, and already has its own change
  channel (`notifyViewStateChanged`) that does not touch `graph`. That last point
  is decisive: settings inside `MultigraphData` would re-run
  `evaluateGraphQuery`, `collectLegendTags`, and `dataflowModel` on every slider
  tick. `tagColorConfig` lives in `MultigraphData` because tags are graph
  _content_; settings are presentation, like `viewState`.

- **Schema version bump.** **Not needed.** `unwrapPersistedGraph` validates only
  `payload.data`, so an added optional `settings` key on the payload passes v6
  validation untouched. Older readers (and the shipped offline shell, at
  `GRAPH_HTML_READER_VERSION = 2`) simply ignore it. Forward and backward
  compatible.

- **How overrides are stored.** **Sparse.** Only keys the user actually changed
  are recorded, at every layer (graph, seed, exported file). A dense snapshot
  would freeze today's shipped defaults into every saved graph, so future
  improvements to a default would never reach existing graphs.

- **Global reactive config singleton vs. threading.** **Threading, via one
  `resolvedConfig` derived per component.** A `$state` singleton in a
  `.svelte.ts` module would drag the Svelte runtime into the pure `server`
  Vitest project and fight the repo's "tunables as parameters" convention.
  Instead `Multigraph.svelte` derives one `resolvedConfig` and passes values into
  the pure functions that already accept them as optional parameters — which is
  most of them (see next item). Pure modules and their specs stay pure.

- **How much re-plumbing live updates actually need.** **Very little.** Most
  `APP_CONFIG` reads in `lib/*.ts` are _default parameter values_
  (`zoneFraction = APP_CONFIG.multigraph.focus.preInscribeZoneFraction`), which
  re-evaluate per call, and `layoutRuntime` already takes
  `getLayoutSettings: () => Partial<LayoutSettings>` — a getter re-read every
  frame. The complete set of sites that freeze a value at module init is:
  `constants.ts` (17 consts), `graphMath.ts:8-9`, `chipPress.ts:41-42`,
  `titleSyntax.ts:17`, `layoutSettings.ts` (`DEFAULT_LAYOUT_SETTINGS`),
  `Multigraph.svelte:195` (`FOCUS_TRANSITION_MS`) and `:197`
  (`NODE_DIAMETER_PX`). That list is the whole of T04.

- **`nodeRadiusPx` vs `layout.baseRadius`.** **Expose `baseRadius` only.** Both
  derive from the same `NODE_RADIUS_PX = 200` source; two independent sliders
  would let node chrome and layout disagree with no way to notice. `nodeRadiusPx`
  is marked `hidden` and follows `baseRadius`.

- **Which groups are excluded entirely.** **`persistence.*` and
  `multigraph.tagSyntax.*`.** `persistence` is constructed once in `onMount` into
  `createPersistence` + `SaveScheduler`, and under per-graph scope
  `storageNamespace` is circular — you need the namespace to load the graph that
  contains it. `tagSyntax` markers retroactively reinterpret every stored node
  title, which is a data migration wearing a slider's clothes. Both are `hidden`
  in the schema (still classified, so the mapped type stays exhaustive).

- **Preview during drag vs. commit.** **Transient preview, commit on release.**
  A component-local `settingsPreview` override feeds `resolvedConfig` while the
  pointer is down; only `pointerup` writes through to the persisted overrides.
  This is the same shape as the existing `graphQueryPreviewText`, and it keeps
  60 mutations/sec away from `SaveScheduler`.

- **Reusing tuning across graphs.** **Import settings from any saved graph file;
  no settings file format at all.** Because settings ride in the payload envelope
  (previous decision), every exported `.html` and `.json` graph _already_ carries
  its own tuning. So "import settings" is a file picker over the graphs the user
  already has, and there is nothing extra to save. This removes a bespoke file
  format, an export action, two pure functions and their specs — and, more
  importantly, removes the second place settings could live and drift. A graph
  file is also self-describing in a way a bare `settings.json` is not: you can
  open it and see the graph the tuning produced.

  Cost accepted: sharing tuning _without_ the graph content is no longer
  possible. For a personal tool this is rare, and the workaround (export a
  throwaway graph) is acceptable.

- **The new-graph seed is still needed.** A file only helps if the user remembers
  to load it, and graph creation has no file picker in it. So a one-click "use as
  seed for new graphs" still writes a single sparse blob to `localStorage`.
  Resolution order is `APP_CONFIG` → this graph's overrides. The seed is
  **stamped at creation** into a new graph's overrides rather than acting as a
  live layer, so changing it never retroactively retunes existing graphs.

- **How settings are read out of a graph file.** **Payload script only, never
  the assets.** `parseGraphFileText` extracts the payload
  (`extractHtmlGraphPayload`) and the base64 asset scripts
  (`extractHtmlAssetPayloads`) in two separate steps, so a settings-only read
  calls the first and skips the second entirely — no base64 decode, no
  IndexedDB writes, no graph hydration. Reading a settings blob out of a
  100 MB illustrated graph costs one regex match and one `JSON.parse`.

- **Button placement.** **A second pill immediately right of `GraphToolbar`,
  both wrapped in one centered flex row.** The two existing Multigraph panel
  buttons sit at `bottom: 0.75rem; left` and `bottom: 0.75rem; right`; a third
  would land dead center over the graph. `.graph-toolbar` is centered with
  `left: 50%; transform: translateX(-50%)` and contains a variable-width
  `<p role="status">`, so an independently-positioned sibling would shift
  horizontally whenever a notice appears — hence one wrapper that centers the
  pair as a unit. Multigraph still owns the config; `GraphToolbar` gains an
  `onOpenSettings` callback and `Multigraph` a `settingsPanelOpen` prop.

- **Fields with no visible effect.** **Advanced section, explicitly marked
  "no live preview."** `interaction.*`, `math.*`, focus timings and settle-frame
  caps are all live-applied but show nothing while dragged. Marking them stops
  users from concluding the panel is broken.

## Live-update classification

Every non-hidden key falls into one of four behaviors. This drives both the
`FieldSpec.preview` field and the section ordering.

| Behavior                                                     | Keys                                                                                                                                                                                                                                                                                                                                                        | Mechanism                                                                                                                                                                                       |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`instant`** — redraws while dragging                       | `edgeArrow.*` (3), `edgeStroke.*` (2), `nodeTextFontSizePx`, `nodeBorderWidthPx`, `pinnedNodeBorderWidthPx`, `minNodeHitRadiusPx`, `layout.parallelEdge*` (2), `layout.edgeOcclusion*` (4), `dataflow.label*` (3), `dataflow.chip{MinOnScreenDiameterPx,MaxVisibleQuantities}` (2), `focus.details{CornerRadiusPx,BorderWidthPx}` (2)                       | Already read inside `$derived` / templates                                                                                                                                                      |
| **`resize-only`** — resizes but does not reflow              | `layout.baseRadius`, `layout.scaleFalloff`, `layout.minScale`, `layout.displayedLayers`, `layout.dataflowDisplayedLayers`                                                                                                                                                                                                                                   | `graphLayout` is `$derived` with `relaxIterations: 0`, so scale and radius recompute but positions pass through unchanged — nodes resize in place and overlap. **Needs the settle kick (T05).** |
| **`physics`** — invisible at rest                            | `edgeSpringStrength`, `derivedEdgeSpringFactor`, `hopRepulsion*` (4), `edgeGap{Min,Max}RadiusFactor`, `relaxIterations`, `normalizeRelaxation*` (2), `maxRelaxationRotationPerFrameRad`                                                                                                                                                                     | Read per-frame through `getLayoutSettings()`; live _while the loop runs_. **Needs the settle kick (T05).**                                                                                      |
| **`gesture`** — only observable during a specific transition | `enterExitDurationMs`, `scaleAnimationDurationMs`, `revealFrontWidthHops`, `postDragSettle*` (2), `postScaleChangeSettleMaxFrames`, `layeredRelayout*` (3), `focus.entry*` (3), `focus.{preInscribeZoneFraction,subFitExitZoneFraction,eligibilityCoverageRatio,boundaryNearTouchMarginPx,worldWheelSensitivity,worldMaxScale}`, `zoom.{minScale,maxScale}` | Correct immediately; requires the user to pin / drag / focus / zoom to see                                                                                                                      |
| **`none`** — nothing to see                                  | `interaction.*` (4), `math.*` (4), `dataflow.chip{Peek,Insert}LongPressMs`                                                                                                                                                                                                                                                                                  | Live-applied, no visual feedback                                                                                                                                                                |
| **`hidden`** — not exposed                                   | `persistence.*` (4), `tagSyntax.*` (2), `nodeRadiusPx`                                                                                                                                                                                                                                                                                                      | Excluded, with reasons above                                                                                                                                                                    |

76 keys total: 69 exposed (15 basic, 54 advanced), 7 hidden.

## Out of scope (for this plan)

- Undo/redo for settings changes. Reset-to-default is the only escape.
- Named preset management inside the app (list / rename / delete). Importing
  from an existing graph plus a single seed cover the need; a preset library can
  come later.
- A settings-only file format. Settings ride in graph files; adding a second
  artifact type would create a second place for them to drift.
- Per-node or per-subgraph overrides.
- Migrating `persistence.*` or `tagSyntax.*` into anything user-editable.
- Turning `layoutRuntime` into a general "settings changed" observer. T05 adds
  exactly one method.

## Tasks

### T01 — Leaf-path types and the exhaustive config schema

|                |                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                                        |
| **Wave**       | 1                                                                                                        |
| **Agent**      | default (opus)                                                                                           |
| **Effort**     | M                                                                                                        |
| **Files**      | new `lib/config/configPaths.ts`, new `lib/config/configSchema.ts`, new `lib/config/configSchema.spec.ts` |
| **PR title**   | `feat(config): add leaf-path types and an exhaustive field schema`                                       |

Add `ConfigPath` — a recursive mapped type producing the union of dotted leaf
paths of `typeof APP_CONFIG` — plus `ConfigValueAt<P>` for the value type at a
path. Add `FieldSpec`:

```ts
type FieldSpec =
  | { control: "hidden"; reason: string }
  | {
      control: "toggle";
      label: string;
      help?: string;
      tier: Tier;
      preview: Preview;
    }
  | {
      control: "range";
      label: string;
      help?: string;
      tier: Tier;
      preview: Preview;
      min: number;
      max: number;
      step: number;
      unit?: string;
    }
  | {
      control: "number";
      label: string;
      help?: string;
      tier: Tier;
      preview: Preview;
      min?: number;
      max?: number;
      step?: number;
      integer?: boolean;
      unit?: string;
    };

type Tier = "basic" | "advanced";
type Preview = "instant" | "resize-only" | "physics" | "gesture" | "none";
```

Then `export const CONFIG_SCHEMA: { [K in ConfigPath]: FieldSpec }` with all 76
keys classified per the table above. Slider ranges are chosen for usability, not
legality (`scaleFalloff` → `0..1 step 0.05` even though the type allows more);
the `number` control in Advanced remains the out-of-range escape.

**Acceptance**

- `pnpm --filter mind-map-sv check` passes.
- A spec asserts every `ConfigPath` has an entry and no entry names a
  non-existent path (iterate `Object.keys(CONFIG_SCHEMA)` against a runtime path
  walk of `APP_CONFIG`).
- A spec asserts adding a key to a fixture config object without a schema entry
  fails to type-check (via `@ts-expect-error`).
- Every `range` spec's default value from `APP_CONFIG` lies within its own
  `min..max`, or the field is `number` instead. Covered by a spec that walks all
  entries — this is the check that catches a badly chosen slider range.

### T02 — Sparse override model: merge, clamp, sanitize

|                |                                                                               |
| -------------- | ----------------------------------------------------------------------------- |
| **Depends on** | T01                                                                           |
| **Wave**       | 2                                                                             |
| **Agent**      | default (opus)                                                                |
| **Effort**     | M                                                                             |
| **Files**      | new `lib/config/configOverrides.ts`, new `lib/config/configOverrides.spec.ts` |
| **PR title**   | `feat(config): add sparse override merge, clamping and sanitizing`            |

`ConfigOverrides = Partial<Record<ConfigPath, ConfigValue>>` — a flat, dotted-key
map, deliberately not a nested partial (flat keys make diffing, resetting a
single field, and file round-tripping trivial).

- `resolveConfig(overrides): ResolvedConfig` — deep-merges into a full config
  object shaped like `APP_CONFIG`.
- `setOverride(overrides, path, value)` / `clearOverride(overrides, path)` /
  `clearSection(overrides, prefix)` — immutable, and `setOverride` **drops the
  key when the value equals the shipped default**, so overrides never
  accumulate no-ops.
- `clampToSchema(path, value)` — coerces and bounds per `FieldSpec`.
- `sanitizeOverrides(unknown): { overrides, warnings }` — the trust boundary for
  anything arriving from a file or from `localStorage`. **Drops unknown paths
  with a collected warning list** rather than throwing, and clamps every value it
  keeps, so a hand-edited file, an older graph, or a graph saved by a future
  version can never wedge the app. There is no settings file format of its own —
  this runs on the `settings` blob lifted out of a graph file (T09).

**Acceptance**

- Spec: setting a value equal to the default removes the key.
- Spec: unknown paths are dropped and reported, not thrown.
- Spec: out-of-range and wrong-typed values are clamped or dropped;
  `resolveConfig` on the result deep-equals a valid config shape.
- Spec: `resolveConfig({})` deep-equals `APP_CONFIG`.
- Spec: `sanitizeOverrides` is idempotent — running it twice changes nothing.

### T03 — Persist settings beside `viewState`

|                |                                                                                                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T02                                                                                                                                                                                     |
| **Wave**       | 3                                                                                                                                                                                       |
| **Agent**      | default (opus)                                                                                                                                                                          |
| **Effort**     | M                                                                                                                                                                                       |
| **Files**      | `lib/migrations.ts`, `lib/graphFile.ts`, `lib/graphPersistenceController.ts`, `lib/saveScheduler.ts`, `lib/components/ui/GraphPersistence/usePersistedGraph.svelte.ts`, colocated specs |
| **PR title**   | `feat(persistence): carry per-graph settings alongside view state`                                                                                                                      |

Add optional `settings?: ConfigOverrides` to `PersistedGraphPayload`,
`GraphFilePayload` and `GraphFileDocument`, mirroring `viewState` at every step.
Add `notifySettingsChanged(overrides, { syncView })` to the controller, mirroring
`notifyViewStateChanged` — it must **not** bump `graphGeneration` (that would
remount `Multigraph` through the `{#key}` in `+page.svelte:414`) and must not
touch `view.graph`. Thread `settings` through `SaveScheduler.schedule`.

**Acceptance**

- Spec: a v6 payload with no `settings` key loads unchanged (no migration path
  added, no version bump).
- Spec: a payload carrying `settings` survives save → load → export → import.
- Spec: `notifySettingsChanged` leaves `graphGeneration` untouched and leaves
  `view.graph` referentially identical.
- Existing `persistence.spec.ts` and `graphFile` specs pass unchanged.

### T04 — Unfreeze the module-init capture sites

|                |                                                                                                                                                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                                                                                                                                                                                  |
| **Wave**       | 1 (parallel with T01, T05)                                                                                                                                                                                                                         |
| **Agent**      | default (opus)                                                                                                                                                                                                                                     |
| **Effort**     | M                                                                                                                                                                                                                                                  |
| **Files**      | `lib/constants.ts`, `Multigraph/lib/graphMath.ts`, `Multigraph/lib/chipPress.ts`, `Multigraph/lib/titleSyntax.ts`, `Multigraph/lib/layoutSettings.ts`, `Multigraph/Multigraph.svelte`, `Multigraph/Stage.svelte`, `Multigraph/QuantityChip.svelte` |
| **PR title**   | `refactor(config): make tunables readable at call time, not import time`                                                                                                                                                                           |

Pure refactor, **no behavior change and no new feature**. Convert every value
frozen at module init into something readable per call, following the repo's
existing "tunables as parameters" convention:

- `constants.ts` — the 17 consts become the parameter defaults / call-time reads
  their consumers already want. Consumers in `Stage.svelte`, `Node.svelte`,
  `StageHarness.svelte` and `Multigraph.svelte` read from `resolvedConfig` where
  one is in scope.
- `Multigraph.svelte:195` `FOCUS_TRANSITION_MS` and `:197` `NODE_DIAMETER_PX`
  become `$derived`.
- `graphMath.ts:8-9`, `chipPress.ts:41-42`, `titleSyntax.ts:17` and
  `DEFAULT_LAYOUT_SETTINGS` keep their exported names (specs pin them) but stop
  being the only path a component can take to the value.

**Rule for this task: a prop default is never the live-config path.**
`Stage.svelte:158` (`dragThreshold = DRAG_THRESHOLD`) and
`QuantityChip.svelte:50` (`holdMs = CHIP_PEEK_LONG_PRESS_MS`) currently get their
value from a prop fallback. Rather than depending on whether Svelte 5
re-evaluates a prop default when its source changes, sidestep the question: have
the parent pass the value explicitly from `resolvedConfig`. The default then
survives only as a fallback for stories and specs that pass nothing, and its
reactivity stops mattering. Two lines each, no uncertainty, and it is the same
"tunables as parameters" convention the repo already follows.

**Acceptance**

- `pnpm --filter mind-map-sv lint`, `check`, and `test:unit -- --run` all pass
  with **no spec changes** — this task must be invisible to behavior.
- All `Multigraph.stories.svelte` stories that pin `layoutSettings` still pass;
  they are the regression net for this refactor.

### T05 — `settleAfterSettingsChange()` on `layoutRuntime`

|                |                                                                                  |
| -------------- | -------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                |
| **Wave**       | 1 (parallel with T01, T04)                                                       |
| **Agent**      | default (opus)                                                                   |
| **Effort**     | S                                                                                |
| **Files**      | `Multigraph/lib/layoutRuntime.svelte.ts`, `Multigraph/lib/layoutRuntime.spec.ts` |
| **PR title**   | `feat(layout): add a settle kick for layout setting changes`                     |

The single new primitive the whole live-update story needs. Model it directly on
the existing `settleAfterDrag()`:

```ts
settleAfterSettingsChange(): void {
  this.settleFramesRemaining = Math.max(
    this.settleFramesRemaining,
    this.#resolvedSettings().postDragSettleMaxFrames
  );
  this.start();
}
```

Note the `Math.max` **top-up** rather than an assignment: called on every
pointermove of a slider drag, a plain assignment would restart the budget each
frame and the settle would never converge while the pointer is down.

**Acceptance**

- Spec: calling it from idle starts the frame loop.
- Spec: calling it repeatedly does not reduce `settleFramesRemaining` below what
  a single call would have set, and does not extend it beyond the cap.
- Spec: calling it mid-drag does not clobber `beginDrag`'s
  `settleFramesRemaining = 0`.

### T06 — Field control components

|                |                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Depends on** | T01                                                                                                                                        |
| **Wave**       | 2 (parallel with T02)                                                                                                                      |
| **Agent**      | default (opus)                                                                                                                             |
| **Effort**     | M                                                                                                                                          |
| **Files**      | new `ui/SettingsPanel/SettingField.svelte`, `SettingRange.svelte`, `SettingToggle.svelte`, `SettingNumber.svelte`, plus `*.stories.svelte` |
| **PR title**   | `feat(settings): add schema-driven field controls`                                                                                         |

Three controls, dispatched from `FieldSpec.control`. `SettingField` is the
dispatcher and owns the shared chrome: label, help text, unit suffix, "modified"
dot, and a per-field reset button that only appears when the field is overridden.

`SettingRange` emits **two distinct events**: a continuous `onPreview(value)`
during pointer movement and a single `onCommit(value)` on release / blur /
keyboard change. Every range also renders a paired numeric input that accepts
out-of-range values, so the slider bounds are a convenience rather than a cage.

**Acceptance**

- Story `play` covers: dragging a range fires `onPreview` repeatedly and
  `onCommit` exactly once on release (asserted via `data-last-*` harness attrs,
  per the `StageHarness` pattern).
- Story `play`: typing an out-of-range value into a range's numeric input is
  accepted and reflected.
- Story `play`: the reset button is absent for a default-valued field and
  present once modified; clicking it restores the default.
- Keyboard: arrow keys on the slider commit without a preview storm.

### T07 — `SettingsPanel.svelte`

|                |                                                                             |
| -------------- | --------------------------------------------------------------------------- |
| **Depends on** | T02, T06                                                                    |
| **Wave**       | 3 (parallel with T03)                                                       |
| **Agent**      | default (opus)                                                              |
| **Effort**     | M                                                                           |
| **Files**      | new `ui/SettingsPanel/SettingsPanel.svelte`, `SettingsPanel.stories.svelte` |
| **PR title**   | `feat(settings): add the schema-driven settings panel`                      |

Left-side panel matching `GraphQueryPanel`'s geometry
(`position: absolute; left: 0.75rem; top: 0.75rem; width: min(30rem, …)`).
Renders `basic` fields grouped by config section, then a collapsed **Advanced**
section holding the rest. Sections whose fields are all `preview: 'none'` or
`'gesture'` carry a "changes here have no live preview" note.

Per-section and global reset. The panel takes `overrides` plus `onPreview` and
`onCommit` callbacks and holds no config state of its own.

**Acceptance**

- Story `play`: toggling Advanced reveals advanced fields and hides them again.
- Story `play`: changing a field then clicking section reset restores every field
  in that section and only that section.
- Story `play`: global reset clears all overrides.
- Story: a fixture with ~10 overrides across sections renders with correct
  "modified" indicators.
- No `hidden` field renders anywhere in the panel.

### T08 — Wire the panel in: toolbar button, preview/commit, settle kick

|                |                                                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T03, T04, T05, T07                                                                                                                             |
| **Wave**       | 4                                                                                                                                              |
| **Agent**      | default (opus)                                                                                                                                 |
| **Effort**     | L                                                                                                                                              |
| **Files**      | `ui/GraphToolbar/GraphToolbar.svelte` + stories, `routes/+page.svelte`, `Multigraph/Multigraph.svelte`, `Multigraph/Multigraph.stories.svelte` |
| **PR title**   | `feat(settings): open per-graph settings from the graph toolbar`                                                                               |

The integration task, and the one that must be reviewed most carefully.

- `GraphToolbar` wraps its existing pill and a new single-button **Settings**
  pill in one centered flex row (`display: flex; gap: 0.5rem`), so the pair
  centers as a unit and the variable-width `<p role="status">` cannot push the
  new button around. The existing `@media (max-width: 640px)` full-width
  treatment moves to the wrapper.
- `GraphToolbar` gains `onOpenSettings`; `+page.svelte` holds `settingsPanelOpen`
  and passes it plus `settings` / `onSettingsChange` into `Multigraph`.
- `Multigraph` derives `resolvedConfig = $derived(resolveConfig({ ...settings,
...settingsPreview }))` and routes `resolvedLayoutSettings` through it.
  `settingsPreview` is component-local and cleared on commit.
- An `$effect` watching only the `resize-only` and `physics` paths calls
  `layoutRuntime.settleAfterSettingsChange()`.

**Acceptance**

- Story `play`: opening the panel, dragging `scaleFalloff`, and asserting node
  radii change **during** the drag (not only on release).
- Story `play`: dragging `edgeSpringStrength` starts the frame loop and node
  positions change; at rest before the change they did not.
- Story `play`: releasing the slider persists via `onSettingsChange` exactly
  once; dragging fires it zero times.
- Story `play`: the panel does not remount the canvas — a node dragged to a
  custom position keeps it across a settings change.
- E2E: settings survive a reload and ride along in an exported `.html` file.
- Manual: drag `scaleFalloff` end to end and confirm the settle does not visibly
  thrash. If it does, damp it here rather than in T05.

### T09 — Import settings from a graph file, and the new-graph seed

|                |                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T08                                                                                                                                                                       |
| **Wave**       | 5                                                                                                                                                                         |
| **Agent**      | default (opus)                                                                                                                                                            |
| **Effort**     | M                                                                                                                                                                         |
| **Files**      | `lib/graphFile.ts`, `lib/browserGraphFile.ts`, `ui/SettingsPanel/SettingsPanel.svelte`, `lib/config/settingsSeed.ts` + spec, `routes/+page.svelte`, `lib/defaultGraph.ts` |
| **PR title**   | `feat(settings): import settings from any saved graph and seed new graphs`                                                                                                |

Two actions in the panel footer. There is deliberately **no settings export** —
every graph export already carries its settings, so the save side is free.

- **`readSettingsFromGraphFileText(text)`** in `graphFile.ts` — lifts just the
  `settings` blob out of a `.html` or `.json` graph file and runs it through
  `sanitizeOverrides`. It calls `extractHtmlGraphPayload` and deliberately
  **does not** call `extractHtmlAssetPayloads`, so an illustrated graph costs one
  regex match and one `JSON.parse` rather than a base64 decode of every image.
  It must not require the payload's `data` to validate as a graph — settings are
  readable from a file whose graph this build could not open.
- **Import settings from a graph** — file picker over `.html` / `.json`, then
  apply. Three outcomes must be distinguishable in the UI: applied (with a count
  of keys), _the file parsed but carried no custom settings_ (an older or
  untuned graph — this is the common confusing case, not an error), and
  unreadable. Any keys dropped by `sanitizeOverrides` are named inline.
- **Use as seed for new graphs** — writes the current sparse overrides to a
  single `localStorage` key. `createDefaultGraph` stamps that blob into a new
  graph's overrides at creation. Sparse in, sparse out.

**Acceptance**

- Spec: settings round-trip graph A → export `.html` → import into graph B,
  yielding identical `resolveConfig` output for both.
- Spec: reading settings from a file with embedded image assets never decodes
  them (assert via a spy or by timing a large fixture).
- Spec: a graph file with no `settings` key yields the "no custom settings"
  outcome, not an error and not silence.
- Spec: settings are readable from a payload whose `data` fails graph
  validation.
- Spec: the seed is copied at creation, so clearing or changing it afterwards
  leaves existing graphs untouched.
- Story `play`: importing a file containing an unknown path applies the known
  keys and shows a warning naming the dropped one.
- Manual: New → confirm the seed applied.

### T10 — `?resetSettings=1` escape hatch

|                |                                                                |
| -------------- | -------------------------------------------------------------- |
| **Depends on** | T08                                                            |
| **Wave**       | 5 (parallel with T09)                                          |
| **Agent**      | fast/cheap                                                     |
| **Effort**     | XS                                                             |
| **Files**      | `routes/+page.svelte`, e2e                                     |
| **PR title**   | `feat(settings): add a URL escape hatch for unusable settings` |

With 69 live knobs it is possible to reach a state where the graph — and so the
button that opens the panel — is unusable. A `?resetSettings=1` query param
clears the loaded graph's overrides before first render, then strips itself from
the URL.

**Acceptance**

- E2E: load a graph with hostile overrides (`minScale: 0.001`,
  `displayedLayers: 0`), confirm the app is recoverable via the param.
- The param does not touch the seed or any other graph.

## Wave plan

```
Wave 1   T01  ‖  T04  ‖  T05     (disjoint: new files / constants+components /
                                  layoutRuntime)
Wave 2   T02  ‖  T06             (both depend only on T01)
Wave 3   T03  ‖  T07             (T03 needs T02; T07 needs T02 + T06;
                                  disjoint files)
Wave 4   T08                     (integration gate — needs everything)
Wave 5   T09  ‖  T10             (both depend on T08, disjoint)
```

Total: 10 tasks, 5 waves. T04 and T08 are the two that warrant a focused review
pass before the next wave starts — T04 because it touches shared constants with
no test surface of its own, T08 because it is where all five prior threads meet.

## Risks and rollback

- **T04 is a wide, low-signal refactor.** It touches `constants.ts`, which
  reaches `Stage.svelte`, `Node.svelte` and `Multigraph.svelte`, and it must
  produce zero behavior change. Mitigation: no spec may change in T04. If a
  story breaks, the refactor is wrong, not the story. It lands alone in wave 1
  so a revert is clean.

- **Prop defaults could silently swallow a live update.** `Stage.svelte:158` and
  `QuantityChip.svelte:50` read module consts as prop defaults, and whether
  Svelte 5 re-evaluates those when the source changes is not something this plan
  wants to depend on. Neutralized by T04's rule — the parent passes the value
  explicitly, so the default is only a fallback for stories. Reviewers of T04
  should check no _new_ prop default reads `resolvedConfig`.

- **The settle kick may look like thrashing.** Dragging `scaleFalloff` continuously
  re-kicks physics on a graph that is simultaneously resizing. The `Math.max`
  top-up in T05 is the first defense; if it still churns, damp in T08 by kicking
  on commit only for `physics` fields while leaving `resize-only` live. That
  degradation is acceptable and should be taken rather than shipping something
  nauseating.

- **`resolvedConfig` recompute cost.** It is derived from a sparse merge on every
  preview tick. It must not be placed upstream of `evaluateGraphQuery`,
  `collectLegendTags` or `dataflowModel` — keeping settings out of
  `MultigraphData` (T03) is precisely what prevents that, and a review of T08
  should confirm no accidental coupling crept back in.

- **Schema range choices will be wrong on first contact.** The T01 spec that
  asserts each default lies inside its own slider range catches the worst cases,
  but real ranges only reveal themselves in use. Expect a follow-up tuning pass
  after T08; that is cheap, since ranges are one line each.

- **Hidden fields are a judgment call that may be revisited.** `persistence.*`
  and `tagSyntax.*` are excluded for real reasons, but they stay classified in
  the schema, so exposing one later is a one-line change plus whatever plumbing
  that specific key needs.

## Definition of Done (this plan)

- All 10 tasks merged.
- `pnpm --filter mind-map-sv lint`, `check`, `test:unit -- --run` and
  `test:e2e` all pass.
- Adding a new key to `APP_CONFIG` fails `check` until a `CONFIG_SCHEMA` entry
  exists, and needs no other UI work — verified by actually doing it once.
- Per-graph settings survive reload, ride along in exported `.html` and `.json`,
  and can be lifted out of any saved graph file into another graph.
- Reading settings out of a graph file never decodes its embedded assets.
- Plan status is `done`.

## Notes

- 2026-08-29: Counted 76 config leaves — `interaction` 4, `persistence` 4,
  `math` 4, `multigraph` top-level 5, `edgeArrow` 3, `edgeStroke` 2, `zoom` 2,
  `focus` 11, `tagSyntax` 2, `layout` 32, `dataflow` 7.
- 2026-08-29: Dropped the settings `.json` format in favour of importing from
  any saved graph file — every export already carries its settings, so the save
  side is free and there is only ever one artifact holding settings. Cost: you
  cannot share tuning without also sharing the graph.
- 2026-08-30: Executed, all 10 tasks. Notes from execution:
  - The settle kick did NOT need damping: dragging `scaleFalloff` end to end
    resizes live and settles with no visible thrash, so every `resize-only` and
    `physics` field stays fully live. The schema's `preview` values match
    reality as shipped.
  - T04's prop-default question was sidestepped as planned (parents pass
    explicitly); no spike was needed.
  - T09 layering deviation: `SettingsPanel`'s `onImportSettings`/`onSaveSeed`
    props default to the real `graphFile`/`settingsSeed` implementations
    instead of being wired through `Multigraph`, which was frozen during that
    task. Works end-to-end; re-thread through `Multigraph` if the panel should
    stay free of persistence imports.
  - T10 found a real hash-router quirk: a second navigation during e2e-style
    `goto` can tear down the debounced save, so the `resetSettings` flag is
    stripped from the URL only after `saveDebounceMs`, and is left in place
    (idempotent retry) if a reload beats it.
  - Two pre-existing issues found and filed separately: the centered toolbar
    overlaps the left panels' Close buttons at narrower widths (z-index 40 vs
    30), and `offline-app-shell.html` regenerates non-deterministically on
    every build.
  - The DoD's "adding a key fails check" guarantee was verified by actually
    adding a dummy key: `svelte-check` reports the missing `CONFIG_SCHEMA`
    entry as a type error.
- 2026-08-29: If the settle kick has to be damped in T08, record which fields
  ended up commit-only here so the schema's `preview` values can be corrected to
  match reality.
