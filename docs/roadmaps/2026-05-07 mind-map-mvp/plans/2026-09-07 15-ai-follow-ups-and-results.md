# Plan: AI follow-ups and results

**Created:** 2026-09-07
**Author:** Claude (Fable 5.1)
**Milestone:** [milestones/15-ai-follow-ups-and-results.md](../milestones/15-ai-follow-ups-and-results.md)
**Status:** draft
**Total estimated effort:** M

## Summary

Three things, built on milestone 14's `!ai` add-on and milestone 09's quantity
inference: a neighbour's run outputs become a node's inputs by the proximity
rule that already exists; "Ask a follow-up" opens a composer on the node the
reader is already looking at, and the press that submits it makes the child AI
node — prompt already in it, run already starting, holding the pin the parent
had; and a run that prints `RESULT R_{th} = 12.3 K/W` makes the node a definer
of `R_{th}`, so the derived edge to whoever uses it appears without anyone
drawing it. Nine tasks, pure modules first, and no new subsystem — every piece
hangs off machinery that shipped in 13, 14, 09 and 11.

Agents: Opus subagents implement. Fable reviews the `aiInputs` shape (T03), the
extractor's third source and its memoisation (T02), the ancestor cap (T04) and
the follow-up commit — the composer's submit path and the pin transfer — (T07),
re-runs the gates, and runs the end-to-end smoke test with a real key: a
two-step chain where the second step reads the first step's CSV and reports a
number that draws an arrow.

## Open questions resolved

Every open question from the milestone doc, with the decision and why. The first
five were settled with the owner before drafting; the last four were this plan's
own and are the ones the milestone points here for — and two of those (the
duplicated parent script, and whether submitting also runs) were ruled by the
owner in the 2026-09-07 readiness review, so nothing below is still open.

- **Do outputs reach downstream nodes automatically?** **Yes — the latest done
  run's outputs, to any neighbour the existing proximity rule already collects
  that node for.** No new visibility rule to learn, and it removes the reason a
  reader currently has to promote a CSV just to chain a step. Promote keeps its
  own job: putting a figure on the canvas.
- **How does a reader continue?** **"Ask a follow-up" opens a composer in the
  parent's workbench; submitting it creates the child AI node on a directed
  edge, with the composed prompt already set, and focuses it with a Back crumb.**
  Nothing is committed while composing, so Cancel and Escape create nothing. The
  map stays the record; a global chat was considered and rejected.
- **What does the child's request know?** **Up to three hops of AI ancestors,
  reached by the same adjacency rule the file inputs use — an incoming directed
  edge or an undirected one — prompt and latest summary each, plus the direct
  parent's script — but only when the request is not already carrying it — as
  prose in the user message under a hard character cap.**
  Files stay at one hop; the rule for _who is adjacent_ is one rule for both, and
  the directed-only variant was dropped because two adjacency rules is one more
  than a reader can predict. The "only when not already carried" clause is the
  owner's ruling of 2026-09-07 (_"drop it"_): a Change request already carries
  that script as `previousScript`, so repeating it in the prose section would
  send the largest thing in the request twice under two different labels. The
  context block carries it only when the request will not — a Write request,
  which has no `previousScript` of its own.
- **The child's default mode.** **Change, against the parent's script**, because
  a follow-up is an edit to what was just done. Write is offered; Run is not
  until the child has a script of its own.
- **How numbers enter the map.** **`RESULT <symbol> = <value> [unit]` on stdout,
  stored on the run, rendered as display math, read by the extractor.** Value
  injection into downstream scripts is deferred to a later milestone.
- **Where the rendered results block lives.** **A dedicated field —
  `AiRun.results` — with `nodeQuantities` taught a third source beside title and
  description.** The alternative, appending a delimited block to
  `node.description`, needs no plumbing and was still the wrong trade: a re-run
  would have to find and replace a region of a field the reader also edits by
  hand (a parser and an undo conflict in one), and the block would outlive the
  run that justified it — surviving eviction and surviving the add-on being
  removed, with nothing in the document able to say where the line came from. On
  a field, results are evicted with their run, an `!ai` removal takes them with
  it, and nothing ever rewrites the reader's prose. The accepted cost: an older
  build opens the file, keeps the field through a re-save, and draws no arrows
  from it. Migration is nil — a new optional field, absent everywhere in every
  existing document. The one real edge case is a node whose own text defines the
  same quantity a different way, which is milestone 09's within-node conflict and
  should read as one rather than being special-cased.
- **How run outputs fit `collectAiInputs`.** **They are `AiFileInput`s like any
  other, carrying the connecting edge's tag as their label, plus a required
  `origin: 'attachment' | 'run-output'` discriminator.** `AiInput` is computed
  from the graph on every collection and never persisted, so a required field
  costs no migration and forces every construction site to say which kind it is
  building. `AiInputGroup` gains an `outputs` list beside `files`, so the
  workbench renders them under their node as a labelled sub-list: Add, Replace
  and Remove hang off `files` and are simply not drawn for `outputs`, rather
  than being drawn disabled. The digest and the "What Claude will see"
  disclosure work unchanged, which is the point of making them ordinary files.
- **Eviction and the child's inputs.** **Nothing new is needed, and the debt
  file is not touched.** A parent's re-run rewrites the bytes behind names the
  child's stored script already opens: `inputsChangedSince` reports them as
  `replaced`, the amber line names them, and the default mode is Run — which is
  correct, because the script's job is to re-read them. A name that appeared or
  vanished defaults to Change. The parent's _latest_ run is never the one
  evicted, so the bytes a child needs are always in the store; a child's
  historical run record can name an asset that has since gone, which reads the
  same as a file the reader removed. `docs/debt/2026-09-04-promoted-output-binding-breaks-when-its-run-is-evicted.md`
  is untouched: this milestone makes promote-to-chain unnecessary, which lowers
  exposure to that hazard, but the name-binding through run history is unchanged
  and the fix filed there still stands.
- **The follow-up node's placement, pin, edge, label and focus.** **Placed
  beside the parent by the same offset Define and Promote use; carrying the
  parent's pin, which transfers; joined by a directed, untagged edge; committed
  as one entry labelled `ask a follow-up`; then focused with a nav entry pushed
  and its first run started.** The pin transfers rather than being withheld: a
  pinned parent is unpinned and the child created pinned, in that one commit, and
  an unpinned parent makes an unpinned child. A pin is the visibility budget the
  reader spent on where they were working, and a follow-up moves where they are
  working — so it moves with them, instead of accumulating one pin per question
  (the failure mode of pinning both) or dropping the reader's chain out of the
  neighbourhood the moment they leave it (the failure mode of pinning neither).
  The earlier draft's "not pinned, matching Define and Promote" is superseded:
  Define and Promote both leave the reader where they were, and a follow-up does
  not. Untagged because an edge tag _is_ the input's label in the request — a
  `@follow-up` on every such edge would put a meaningless role on every input the
  child collects and colour every one of those edges by milestone 04f's rule.
  One commit for node, add-on, prompt, edge and both pin changes so one Undo
  takes the whole thing — including giving the parent its pin back — per
  `docs/ui-decisions/2026-08-30--destructive--ship-new-destructive-actions-without-a-confirm.md`.
- **Does submitting the composer also start the child's run?** **Yes — the
  owner ruled it on 2026-09-07 (_"yes, auto-run on submit"_), logged in
  `docs/ui-decisions/2026-09-07--editing--submitting-a-follow-up-also-starts-its-run.md`.**
  The reader has just written a request and pressed a verb; making them find and
  press a second control on a node they did not choose to visit is a step that
  answers no question. It also makes the two-step shape honest: the composer is
  where you decide, and submit is where it happens. Named accordingly (`Ask`,
  saying so while it works), per
  `docs/ui-decisions/2026-09-06--status--name-the-run-action-per-mode.md`. The
  cost is that a mis-press spends tokens, which is why the composer is
  deliberate and Cancel sits beside Ask. It is settled rather than pending, so
  build it this way; if it is ever revisited, the way back is to create and
  focus without running and let the child's own `Change & run` start it — a
  one-line change in `askAiFollowUp` and one story rename, with nothing else in
  the plan depending on which way it goes.
- **What does focus land on, now that the prompt is already written?** **The
  child's workbench with its run in flight**, and no caret hand-off. The earlier
  draft ended by putting the caret in an empty prompt; there is nothing to type
  any more, so the prompt field renders the submitted prompt read-normally like
  any other node's and the reader's eye goes to the run status under it. Nothing
  steals focus from the surface, which also keeps the deep-zoom focus-scroll
  hazard `AiNodeContent` documents (a focused element inside a transform-scaled
  frame scrolls the frame) out of this path entirely.

## Out of scope (for this plan)

- Everything in the milestone's Out of scope list, above all value injection into
  downstream scripts.
- Any change to the promoted-output binding (the filed debt).
- Any change to the run loop's cancel, timeout, worker or key handling.
- Naming the follow-up node from its prompt or from the model's reply.
- Exposing the new `APP_CONFIG.ai` values in the settings sheet. They ship as
  config, the way `dataflowDisplayedLayers` did in milestone 11.
- Multi-parent merges as a first-class idea. A node with two AI parents already
  works — it collects both parents' outputs and both appear in the ancestor walk
  — but nothing here designs for it or gives it story coverage.

## Tasks

> **Nothing here starts before the owner says so.** The rulings of 2026-09-07
> came with "No plan execution until I explicitly say"; the tasks below are
> drafted and waiting (see Notes).
>
> One PR each. Every task runs the full gate set before it is claimed done:
> `pnpm --filter mind-map-sv lint`, `pnpm --filter mind-map-sv check`,
> `pnpm --filter mind-map-sv test:unit -- --run`, `pnpm --filter mind-map-sv knip`,
> plus `pnpm --filter mind-map-sv build` and `pnpm -w check:offline-shell` so the
> single-file shell is never left stale.

### T01 — `RESULT` lines: parse, render, store, validate

|                |                                                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                                                                                  |
| **Wave**       | 1                                                                                                                                                  |
| **Agent**      | opus                                                                                                                                               |
| **Effort**     | M                                                                                                                                                  |
| **Files**      | new `src/lib/ai/aiResults.ts` + `aiResults.spec.ts`, `src/lib/components/ui/types/node.ts`, `src/lib/migrations.ts` + spec, `src/lib/appConfig.ts` |
| **PR title**   | `feat(ai): parse named results out of a run's stdout and store them on the run`                                                                    |

`aiResults.ts` is pure and holds the whole contract:

- `interface AiResult { symbol: string; value: string; unit?: string }` — the
  symbol in LaTeX (`R_{th}`), the value as the script printed it, the unit as
  free text.
- `parseResultLines(stdout: string, options?): AiResult[]` — scans line by line
  for `RESULT <symbol> = <value> [unit]`, anchored at the start of a trimmed
  line. The symbol must match a conservative allowlist (ASCII letters, digits,
  `\`, `_`, `^`, `{`, `}`, and nothing else); the value must parse as a finite
  number; the unit is whatever follows, trimmed and truncated to
  `unitMaxChars`. Anything failing any of those is skipped, not repaired. At most
  `maxResults` are kept, first wins, and a repeated symbol keeps its last
  occurrence — a script that prints a running value should report the one it
  finished with.
- `renderResultTex(result: AiResult): string` — the single string both the UI and
  the extractor use: `R_{th} = 12.3\ \text{K/W}`, with the unit escaped for
  `\text{}` and omitted entirely when absent.

`types/node.ts` gains `AiRun.results?: AiResult[]` with a doc comment saying why
it lives on the run and not in the description. `migrations.ts`: `isAiRun`
accepts `results === undefined || every isAiResult`; the schema version and the
HTML reader version **do not move** — the field is optional, no add-on key is
added, and `isAiRun` ignores keys it does not know, so a milestone 14 build loads
a milestone 15 document rather than calling it malformed. `APP_CONFIG.ai` gains
`maxResultsPerRun` (20) and `resultUnitMaxChars` (32).

**Acceptance**

- Spec: a plain line parses; a line with no unit parses; leading and trailing
  whitespace is tolerated; `RESULT x = TBD` is skipped; a symbol containing a
  space, a `$`, or a backslash-escape outside the allowlist is skipped; the
  count cap holds; a repeated symbol resolves to the last one; a line that is
  merely _about_ results (`# RESULT lines follow`) is skipped.
- Spec: `renderResultTex` with and without a unit, and with a unit containing a
  character that must be escaped.
- Spec: a v8 payload with no `results` loads; one with valid `results` round
  trips through the graph file byte-for-byte; one with a malformed entry makes
  the node malformed.
- Grep gate: `CURRENT_SCHEMA_VERSION` and `GRAPH_HTML_READER_VERSION` are
  unchanged in the diff.

### T02 — Teach the quantity extractor a third source

|                |                                                                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T01, T05 (file only)                                                                                                                                             |
| **Wave**       | 2                                                                                                                                                                |
| **Agent**      | opus (Fable reviews the memoisation)                                                                                                                             |
| **Effort**     | M                                                                                                                                                                |
| **Files**      | `Multigraph/lib/nodeQuantities.ts` + spec, `Multigraph/lib/quantityIndex.ts` + spec, `Multigraph/lib/aiNode.ts` + spec, `Multigraph/lib/dataflowLayer.ts` + spec |
| **PR title**   | `feat(dataflow): read an ai node's recorded results as definitions`                                                                                              |

`QuantityBearingNode` gains `derivedMath?: readonly string[]` — LaTeX strings
this node states that are not in its title or description. `nodeQuantities`
reads them after title and description, in display mode, on exactly the same
terms (a single top-level equality with a single symbol on the left defines;
everything else references). The math module learns nothing about add-ons: the
strings arrive already rendered by their producer.

`aiNode.ts` gains `aiResultMath(node: NodeData): readonly string[]` — the latest
done run's results through `renderResultTex`, empty for a node with no add-on,
no done run or no results, and returning a shared empty array so identity
comparison is cheap.

The wiring is the part to get right, and it is not where the first draft put it.
`createQuantityIndexer` takes `IndexableNode[]`, and its only caller is
`createDataflowModel`, which passes `data.nodes` straight through
(`dataflowLayer.ts:48`). So **`dataflowLayer.ts` is where `aiResultMath` is
applied** — it maps each node to `{ ...node, derivedMath: aiResultMath(node) }`
before calling the index. `quantityIndex.ts` and `nodeQuantities.ts` stay
add-on-blind, which is the rule this task is otherwise about; having the index
import `aiNode.ts` would break it and add a Multigraph-lib import cycle risk for
nothing.

The memo is a **string** (`signatureOf`, `quantityIndex.ts:117`), not an object
identity: it must gain the rendered result strings joined with a separator above
`\u0000`, exactly as title, description and tags are joined now. A recorded run
then invalidates the node's entry and a position change still does not — which
is the load-bearing line of the task, because milestone 11 made a point of the
index surviving a drag and a naive key would undo it. `aiResultMath` returning a
shared empty array keeps the mapping cheap for the overwhelming majority of
nodes, which carry no add-on at all.

**Acceptance**

- Spec (`nodeQuantities`): a `derivedMath` entry defines a quantity; it can be
  referenced from a description; a node defining the same symbol two different
  ways across text and `derivedMath` reports two definitions (milestone 09's
  within-node conflict) rather than deduping; the dataflow opt-out tag suppresses
  `derivedMath` like everything else.
- Spec (`quantityIndex`): the same node with new results re-extracts; the same
  node at a new position does not, asserted with a counting extractor double the
  way the milestone 11 specs do.
- Spec (`dataflowLayer`): a node whose latest done run reports a result draws a
  derived edge end to end through `createDataflowModel`, and dragging that node
  returns the _same model object_ — the existing identity assertion, now with an
  ai node in the graph. `quantityIndex.ts` imports nothing from `aiNode.ts`.
- Spec (`aiNode`): `aiResultMath` on a node with no add-on, a node whose latest
  run is `error`, and a node whose latest done run carries two results.

### T03 — A neighbour's run outputs are inputs

|                |                                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | —                                                                                                                                                                                                 |
| **Wave**       | 1                                                                                                                                                                                                 |
| **Agent**      | opus (Fable reviews the `AiInput` shape)                                                                                                                                                          |
| **Effort**     | M                                                                                                                                                                                                 |
| **Files**      | `Multigraph/lib/aiInputs.ts` + spec, `src/lib/ai/inputFileName.ts` + spec, `src/lib/ai/aiRequest.ts` + spec, `src/lib/ai/pyExecutor.ts` + spec, `Multigraph/lib/aiRunController.svelte.ts` + spec |
| **PR title**   | `feat(ai): collect a neighbour's latest run outputs as inputs, with unique filenames`                                                                                                             |

`AiFileInput` gains a required `origin: 'attachment' | 'run-output'`.
`collectAiInputs` appends, for each qualifying neighbour carrying the `ai`
add-on, that neighbour's `latestDoneRun` outputs after its attachments, in run
order, with the same label the edge gave the neighbour. Order stays stable by
construction: attachments then outputs, within a neighbour, in `graph.nodes`
order. The node's own outputs are not collected — self is not a neighbour — and
an outgoing neighbour is still skipped, so a promoted output node still cannot
feed the run that made it.

`AiInputGroup` gains `outputs: AiFileInput[]`; `groupAiInputs` routes by
`origin`, so the workbench can draw the two lists differently without inspecting
anything else.

`inputFileName.ts` gains `disambiguateExecutorNames(names: readonly string[]):
string[]` — `executorInputName` applied to each, then a deterministic suffix on
every repeat (`plot.png`, `plot-2.png`, `plot-3.png`; the suffix goes before the
extension), first occurrence unchanged. Pure, order-dependent and only
order-dependent, so the same collected inputs always yield the same names.

**This cannot be a drop-in swap, and that is most of the task.** `executorInputName`
is applied _per name_ at five call sites in three modules today — `pyExecutor.ts:392`
(the write into `/work`), `aiRunController.svelte.ts:264` and `:270` (the
digest → asset-id map, which with two same-named files collapses both onto the
first asset id through its `if undefined` guard), and four spots in
`aiRequest.ts`. A list-wise rule cannot be reached from any of them. So the name
is decided **once per collection** and carried: the controller computes the
disambiguated list alongside `collectAiInputs`, and it is that list that feeds
`ExecutorFile.name`, the digest → asset-id map, the request render, and
`toRunInput`'s recorded `AiRunInput.name` — the fourth place, and the one the
workbench's amber changed-since line reads back, so a mismatch there names a
file the script never saw. `executorInputName` stays as the per-name
sanitisation the map is built out of; nothing else calls it directly on an input
name any more.

`aiRequest.ts`: a run-output file's digest line says so
(`plot.png — 41 KB — output of "Sweep A"`), because a model told a file is a
produced figure reads it differently from one told it is a measurement.

**Acceptance**

- Spec: a directed parent with a done run contributes its outputs; a parent with
  only a cancelled run contributes none; an undirected AI neighbour contributes
  its outputs; an outgoing AI neighbour contributes nothing; the node's own runs
  contribute nothing.
- Spec: outputs land in the neighbour's group under `outputs`, never under
  `files`; labels come from the edge exactly as for attachments.
- Spec: two neighbours each producing `plot.png` yield two distinct names; an
  attachment named the same as an output yields two distinct names; the mapping
  is stable across repeated calls and across an unrelated graph edit.
- Spec (controller, with the fakes): with two same-named inputs, the files
  written to `/work`, the digest rows in the workbench, the filenames in the
  request and the `name`s on the recorded `AiRunInput`s are the same four
  strings — no digest lands on the wrong asset, and `inputsChangedSince` against
  that run reports nothing changed when nothing has.
- Spec: the rendered request names a run output as one, and a request built from
  a parent output of 10,000 rows still carries only the configured preview rows.

### T04 — Ancestor context

|                |                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T03                                                                                                                                                                       |
| **Wave**       | 2                                                                                                                                                                         |
| **Agent**      | opus (Fable reviews the cap)                                                                                                                                              |
| **Effort**     | M                                                                                                                                                                         |
| **Files**      | new `Multigraph/lib/aiAncestry.ts` + spec, `Multigraph/lib/aiInputs.ts` (export the adjacency predicate) + spec, `src/lib/ai/aiRequest.ts` + spec, `src/lib/appConfig.ts` |
| **PR title**   | `feat(ai): carry the conversation so far into a follow-up's request`                                                                                                      |

`aiAncestry.ts`, pure:

- `collectAiAncestors(graph, nodeId, maxHops)` → `AiAncestor[]` of
  `{ nodeId; hops; title; prompt; summary; script? }`, nearest first, breadth
  first, stepping AI node to AI node by **the same adjacency rule
  `collectAiInputs` uses — an incoming directed edge or an undirected one** (a
  non-AI neighbour ends that branch; its text is already carried as a one-hop
  input). Share the predicate with the input collector rather than restating it:
  one exported helper, called from both, so the two can never drift into two
  rules. A visited set makes a cycle terminate — and under this rule an
  undirected pair of AI nodes is a cycle in the ordinary case, not a
  pathological one, so the set is load-bearing rather than defensive. Ties break
  in `graph.nodes` order so the list is stable. `script` is populated only for
  `hops === 1`; two direct parents resolve in `graph.nodes` order, matching
  `inheritedScript` in T05.
- `renderAncestorContext(ancestors, limits, { includeParentScript })` → the prose
  section, or `''` for no ancestors. Headed `Conversation so far (nearest first):`;
  each entry gives the title, `Asked:` and `Result:`; the direct parent's
  `analysis.py` follows in a fenced block **only when `includeParentScript` is
  true**. Over `maxChars`: trim each summary to `ancestorSummaryMaxChars` first,
  then drop the farthest ancestor whole and repeat, appending
  `(N earlier steps omitted.)`. When the parent's script is present it is the
  last thing dropped; the ancestors' prose goes first.
- **The script is never sent twice.** `buildRefineRequest` already appends
  `Previous analysis.py:` with the script Change mode is editing, so a Change
  request passes `includeParentScript: false` and a Write request passes `true`
  — for a fresh child the default mode is Change, which is the common path, and
  the first draft would have sent the largest block in the request twice under
  two labels. The caller decides, not the renderer: `aiRequest.ts` knows which
  builder it is about to call, and `renderAncestorContext` stays pure and
  ignorant of run modes. (Owner's ruling of 2026-09-07: _"drop it"_.)

`aiRequest.ts` puts the section in the **user message**, after the prompt and
before `Attached files:` — not in the system prompt, so the cached prefix
survives a session of Write, Change and Run. `buildAnalyseRequest` and
`buildRefineRequest` both take an optional `ancestorContext: string`.
`APP_CONFIG.ai.ancestorContext` gains `maxHops` (3), `maxChars` (12000) and
`ancestorSummaryMaxChars` (1200) — named in full rather than `summaryMaxChars`,
because `APP_CONFIG.ai.summaryMaxChars` already exists at 4000 (the cap a run
record's own summary is stored under) and two knobs sharing one name is a
question every reader of this file would have to answer twice.

**Acceptance**

- Spec: no ancestors; one; a three-node chain reporting two in order; a fourth
  step beyond `maxHops` excluded; **an AI neighbour joined by an undirected edge
  contributing on the same terms as one joined by an incoming directed edge**;
  **two AI nodes joined by one undirected edge, each reporting the other exactly
  once**; an _outgoing_ directed neighbour contributing nothing; a non-AI node
  between two AI nodes ending the branch; a two-node directed cycle terminating;
  two parents reported in a stable order.
- Spec: the adjacency predicate is the one `collectAiInputs` uses — a table-driven
  spec over the four edge orientations asserting that a neighbour contributing
  files also contributes prose, and one contributing neither contributes neither.
- Spec: only the direct parent carries a script; an ancestor whose latest run is
  not `done` contributes its prompt and an empty summary.
- Spec: a chain whose rendered section exceeds `maxChars` trims summaries first,
  then drops the farthest ancestor, keeps the parent's script when it is
  included at all, and says how many were omitted; the result is never longer
  than `maxChars`.
- Spec: `includeParentScript: false` renders no script block, and the built
  Change request contains the parent's script **exactly once** — under
  `Previous analysis.py:` and nowhere else; a Write request built from the same
  graph carries it once, in the context section.
- Spec: the built request carries the section in the user message and the system
  prompt is byte-identical to the one built without it.

### T05 — The follow-up mutation and the mode rules

|                |                                                                               |
| -------------- | ----------------------------------------------------------------------------- |
| **Depends on** | —                                                                             |
| **Wave**       | 1                                                                             |
| **Agent**      | opus                                                                          |
| **Effort**     | M                                                                             |
| **Files**      | `Multigraph/lib/aiNode.ts` + spec, `Multigraph/lib/aiWorkbenchView.ts` + spec |
| **PR title**   | `feat(graph): create a follow-up ai node joined to the node that spawned it`  |

`aiNode.ts`:

- `createFollowUpNode(data, aiNodeId, { prompt, position, nodeId? })` →
  `{ graph, nodeId }`. Adds a node titled `!ai Follow-up` — the marker so a later
  title edit does not strip the capability, the word so the canvas has something
  to draw — carrying `addons.ai` at the registry default (via `withNodeAddon`,
  not a literal, so a registry change cannot drift from it) **with `prompt`
  already set**, an empty description; then a directed, untagged edge from the
  parent; then the pin transfer. `prompt` is required and trimmed; an empty or
  whitespace-only prompt returns the same graph object, so the "cannot submit
  empty" rule holds at the mutation as well as at the button. Same graph object
  back for an unknown node, or a node without the add-on. Placement is the
  caller's, exactly as for `promoteAiOutput`. Note that `AddNodeInput`
  (`graph.ts:21`) carries no `addons` field and does not gain one here: add the
  node, then apply `withNodeAddon` and the prompt to the node `addNode`
  appended, the way `promoteAiOutput` already works with what it is handed.
  `graph.ts` is not in this task's file list and does not need to be.
- The pin transfer, in that same returned graph: if the parent is pinned, unpin
  it with `setNodePinned(data, aiNodeId, false)` (`Multigraph/lib/graph.ts`,
  which `togglePinned` delegates to) **first**, then add the child with
  `addNode`'s `pinned: true`. Order is the whole subtlety: both calls stamp
  `lastPinnedSeq` from `nextPinSequence`, and the beacon rule reads the highest
  stamp, so unpinning last would leave the parent — the node that is no longer
  pinned — as the most recently touched. Parent not pinned: neither call
  happens and the child is created unpinned, `pinSequence` untouched.
- `inheritedScript(data, nodeId)` → the direct AI parent's stored `analysis.py`,
  or `undefined`. Nearest parent only; two parents with scripts resolve in
  `graph.nodes` order and the spec pins that.

`aiWorkbenchView.ts`:

- `defaultRunMode(ai, inputs?, options?)` gains `options.inheritedScript`: a node
  with no run and no script of its own but an inherited one defaults to
  `refine`; with neither it stays `analyse`. Every existing rule is unchanged.
- `availableRunModes(ai, options?)` → which of Write / Change / Run the switch
  may offer: Write always; Change when a script is reachable, own or inherited;
  Run only when the node has a script of its own. It returns a reason string per
  unavailable mode for the notice line, per
  `docs/ui-decisions/2026-08-30--a11y--say-why-a-control-is-disabled-in-the-notice-line.md`.

**Acceptance**

- Spec: the created node carries the add-on with the passed prompt, no runs and
  no promoted bindings; the edge is directed parent → child with no tags; a
  second call makes a second child (a follow-up is not idempotent — two questions
  are two nodes); an unknown parent, a parent without the add-on, and an empty or
  whitespace-only prompt each return the same graph object.
- Spec: the pin transfer. A pinned parent yields `parent.pinned === false` and
  `child.pinned === true` in the one returned graph, with the child's
  `lastPinnedSeq` the higher of the two; an unpinned parent yields an unpinned
  child and leaves `pinSequence` and every `lastPinnedSeq` untouched; a parent
  pinned twice over (pin, unpin, pin) still transfers exactly one pin.
- Spec: the child is collected as an _outgoing_ neighbour of the parent, so it
  never feeds the parent's own run — asserted through `collectAiInputs`.
- Spec: `inheritedScript` with no parent, a non-AI parent, a parent with no
  script, and two AI parents.
- Spec: mode defaults and availability across the four states (no run; own
  script; inherited script only; both).

### T06 — Workbench: results, grouped outputs, context preview, the follow-up control

|                |                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T02, T03, T04, T05                                                                                             |
| **Wave**       | 3                                                                                                              |
| **Agent**      | opus                                                                                                           |
| **Effort**     | L                                                                                                              |
| **Files**      | `Multigraph/AiNodeContent.svelte` + `AiNodeContent.stories.svelte`, `Multigraph/lib/aiWorkbenchView.ts` + spec |
| **PR title**   | `feat(ai): show results, a parent's outputs, the ancestor context and Ask a follow-up`                         |

Four additions to the workbench, each following the rulings already in
`docs/ui-decisions/`:

1. A **Results** section under Outputs, drawn only when the latest done run
   reported some, rendering each `renderResultTex` string as display math
   through the existing `MathText` path. `data-ai-result={symbol}` per row.
2. A neighbour group carrying `ai` shows its run outputs as a second, labelled
   sub-list under its files (`data-ai-input-kind="output"`), with no Add,
   Replace or Remove — those controls are not drawn rather than drawn disabled,
   because there is no action behind them to explain.
3. A **What Claude will see** disclosure in the run section for the ancestor
   context, matching the per-file one 14 shipped: closed by default, its summary
   line naming the number of steps and the character count, its body the
   rendered section verbatim. `data-ai-context`. It renders the section **for
   the currently selected mode**: T04 omits the parent's script from a Change
   request's context (the request carries it separately), so a preview that
   ignored the mode would show the reader something other than what is about to
   be sent — which is the one thing milestone 14's promise does not allow.
4. **Ask a follow-up**, a labelled button beside the outputs, `aria-disabled`
   with the reason in the notice line until the node has a done run. It does not
   create anything: it opens a composer in this workbench, and only the
   composer's submit calls `onAskFollowUp(prompt)`.

The composer has three states and the component owns all three, because none of
them is graph state until the last one commits:

- **closed** — nothing rendered but the button.
- **composing** — `data-ai-follow-up` on the container, `data-ai-follow-up-prompt`
  on the textarea, `data-ai-follow-up-submit` on the submit and
  `data-ai-follow-up-cancel` on Cancel. The textarea grows to its text the way
  the prompt field does (the same `auto`-then-`scrollHeight` effect), so no inner
  scroller competes with the root's `data-zoom-scroll`
  (`docs/ui-decisions/2026-09-06--pointer--mark-scrollers-so-the-zoom-yields-the-wheel.md`).
  The draft lives in a `$state` string and is dropped on close — a discarded
  draft is not worth persisting, and persisting it would mean deciding when it
  expires.
- **submitting** — the submit is labelled `Ask` and says so while it works, per
  `docs/ui-decisions/2026-09-06--status--name-the-run-action-per-mode.md`; both
  controls are `aria-disabled` for the moment between the press and the focus
  change, so a double-tap cannot commit twice.

Keyboard, mirroring `handlePromptKeydown` beside it: Cmd/Ctrl+Enter submits,
Enter and Shift+Enter both insert a newline — a follow-up is prose and often more
than one line, and the field next to it already reads Enter that way, so making
this one differ would be the surprise. Escape closes the composer and calls
`stopPropagation` so the focus layer does not also act on it; this is the first
handler in the file to take Escape, and the header comment that says Escape
belongs to the focus layer gets a sentence saying which key now has an exception
and why. Submit is `aria-disabled` with the reason in the notice line while the
draft is empty or whitespace-only, per
`docs/ui-decisions/2026-08-30--a11y--say-why-a-control-is-disabled-in-the-notice-line.md`;
the guard is the same pure predicate `createFollowUpNode` uses, not a second
`trim()` that can drift from it.

`aiWorkbenchView.ts` gains the pure view helpers these need — the results rows,
the context summary line, and the follow-up's disabled reason — so the component
stays a shell. The mode switch reads `availableRunModes` from T05, keeping the
labelled segmented control and the per-mode button name from
`docs/ui-decisions/2026-09-06--copy--label-the-mode-switch-so-three-modes-read-as-one-choice.md`
and `…2026-09-06--status--name-the-run-action-per-mode.md`.

**Acceptance**

- Stories with the fake client and executor: a done run with two results renders
  two display-math rows; a run with none renders no Results section; a child node
  lists its parent's outputs in their own sub-list with no Replace or Remove; the
  ancestor disclosure opens and shows the rendered section; Ask a follow-up is
  `aria-disabled` with a reason before the first run and enabled after it; the
  mode switch on a fresh child offers Write and Change with Change selected and
  does not offer Run.
- Story: pressing Ask a follow-up shows `[data-ai-follow-up]` and fires no
  callback; typing into `[data-ai-follow-up-prompt]` and pressing
  `[data-ai-follow-up-submit]` fires `onAskFollowUp` once with the typed string,
  reported through the harness as `data-last-follow-up-prompt`.
- Story: `[data-ai-follow-up-cancel]` closes the composer and fires nothing;
  Escape inside the prompt closes the composer, fires nothing, and does not reach
  the focus layer; re-opening the composer shows an empty field.
- Story: submit is `aria-disabled` with a reason in the notice line while the
  field is empty and while it holds only spaces and newlines, and pressing it
  then fires nothing; Cmd+Enter and Ctrl+Enter each submit, and a bare Enter and
  a Shift+Enter each insert a newline instead.
- The new disclosure and the composer both open on a real press inside the focus
  frame (the `interactiveContent.ts` rule from milestone 14's third session), and
  the workbench still scrolls under the wheel with `data-zoom-scroll`
  (`docs/ui-decisions/2026-09-06--pointer--mark-scrollers-so-the-zoom-yields-the-wheel.md`).
- No new window-level keyboard shortcut, so
  `docs/ui-decisions/2026-08-30--keyboard--guard-every-shortcut-while-typing.md`
  is satisfied by construction — the composer's two keys are handled on its own
  textarea, not at the window; the new controls are real buttons reachable by
  Tab.

### T07 — Wiring: collect results on a run, and the follow-up flow

|                |                                                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | T06                                                                                                                     |
| **Wave**       | 4                                                                                                                       |
| **Agent**      | opus (Fable reviews the commit and the focus hand-off)                                                                  |
| **Effort**     | L                                                                                                                       |
| **Files**      | `Multigraph/lib/aiRunController.svelte.ts` + spec, `Multigraph.svelte`, `src/routes/+page.svelte` if the props reach it |
| **PR title**   | `feat(ai): record run results and turn a composed follow-up into a focused, running node`                               |

The controller: parse `RESULT` lines from the **full** stdout of the run's
**final** execution, and only when that execution exited 0 — not "the last
execution that exited 0", which would reach back past a failure. A run whose
final execution failed reports no results even if an earlier one printed some:
a number from a script Claude then rewrote is not the run's answer. The full
string is available because the worker joins every chunk before it replies; the
`stdoutTailChars` cut is applied at render time in `aiRequest.ts` and by `tail()`
for the live run state, so it never touches what the parser sees. The parsed
results go onto the terminal run record through the existing `replaceAiRun`
commit — no second write path. Requests are built with `collectAiAncestors` + `renderAncestorContext`,
and Change mode falls back to `inheritedScript` with a second instruction
(`INHERITED_REFINE_INSTRUCTION`: "The previous analysis.py is from the step
before this one. Modify it to satisfy the request above.") when the node has no
script of its own.

`Multigraph.svelte` gains `askAiFollowUp(aiNodeId, prompt)`, which is
`createDefiningNode`'s shape with the ending swapped. The prompt arrives from the
composer, so this function neither opens nor closes anything — by the time it
runs, the reader has already decided:

1. Read the departure state first — `focusRootNodeId`, `focus.isFocused` and the
   live `stageViewState` — because `focusRootNodeId` is null once focus is gone.
2. `createFollowUpNode(graph, aiNodeId, { prompt, position })` at
   `{ x: origin.x + NODE_RADIUS * 2.5, y: origin.y }`, beside rather than below so
   a follow-up and a promoted figure do not land on the same spot. The returned
   graph already carries the prompt, the edge and the pin transfer; if it is the
   same object (empty prompt, unknown parent) return without committing. Commit
   through `commitUserGraph(layoutRuntime.relaxAfterMutation(…),
editIntent('ask a follow-up'))` — one entry, so one Undo removes the child and
   gives the parent its pin back together.
3. Push a nav entry for the departure node with `revealedNodeId: null` — the
   child is joined by an authored edge and is visible on its own account.
4. `fitViewRequest` onto the child, then `enterFocusOnNode(child.id)`.
5. Start the child's first run, last, through the same controller entry point the
   workbench's run button uses — mode resolved by `defaultRunMode` with
   `inheritedScript`, which for a fresh child is Change against the parent's
   script. No caret hand-off and no `promptEditContext`: the prompt is already
   written, so there is nothing to type, and nothing takes DOM focus off the
   surface. Focus lands on the child's workbench with the run in flight and its
   control naming what it is doing.

Steps 3 and 4 are `jumpToNode`'s body; extract the shared part rather than
copying it, so a third caller does not become a third divergence. Extract the
placement too, but as an offset helper rather than a shared constant: promote
(`Multigraph.svelte:618`) and define (`:1909`) both place at
`origin.y + NODE_RADIUS * 2.5`, and a follow-up places _beside_ at
`origin.x + NODE_RADIUS * 2.5` so it does not land on the same spot as a
promoted figure. One helper taking the direction, three callers — not a third
caller of the below-placement, which is what an earlier draft of this line
claimed.

One consequence of step 5 to build deliberately: `startAiRun` opens the key
sheet when a run comes back `needs-key`, so a reader with no key configured
submits a follow-up and lands on a brand-new node with the settings sheet over
it. That is the right outcome — the run is what they asked for and the key is
what it needs — but the story that covers it should assert the child is created
and focused regardless, so a missing key never costs the node.

The auto-run itself is settled (owner, 2026-09-07). If it is ever revisited,
step 5 is the only thing that goes and the rest of the flow is unchanged.

**Acceptance**

- Controller spec with the fakes: a run whose last execution printed two
  `RESULT` lines commits a run carrying both; a run whose _earlier_ execution
  printed them and whose last one did not commits none; a run whose last
  execution failed after an earlier one printed results commits none; a result printed beyond
  `stdoutTailChars` is still recorded; a cancelled run records none.
- Controller spec: a child with no script builds a Change request carrying the
  parent's script and the inherited instruction; the ancestor section is present
  and within the cap.
- Story: opening the composer and pressing Cancel, and opening it and pressing
  Escape, each commit nothing — the graph, the node count and the undo depth are
  all unchanged.
- Story: composing a prompt and submitting commits exactly one graph change with
  the label `ask a follow-up`; focus lands on the new node, its prompt field
  holds the submitted text, its run is in flight, and `[data-nav-back]` names the
  parent.
- Story: Back from the child returns to the parent's workbench at the camera the
  reader left, matching `BackAfterDefineReturnsToTheConsumersDetails`.
- Story: a follow-up from a **pinned** parent leaves the child pinned and the
  parent unpinned; one Undo restores both and removes the child and the edge, in
  one step.
- Story: one Undo after a follow-up from an unpinned parent removes the child and
  the edge together and pins nothing.

### T08 — Stories for the chain and the derived edge

|                |                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| **Depends on** | T07                                                                                                    |
| **Wave**       | 5                                                                                                      |
| **Agent**      | opus                                                                                                   |
| **Effort**     | M                                                                                                      |
| **Files**      | `Multigraph/Multigraph.stories.svelte`, `Multigraph/lib/testFixtures.ts` if a fixture is worth sharing |
| **PR title**   | `test(ai): cover the follow-up chain, inherited outputs and result-driven edges`                       |

The behaviour tests that prove the milestone rather than its parts, named as
sentences in the house style:

- `AFollowUpNodeReadsItsParentsOutputs` — a parent with a done run producing
  `clean.csv`, a follow-up child; the child's inputs list shows `clean.csv` under
  the parent as an output, with no Replace or Remove.
- `RerunningTheParentMarksTheChildsInputsChanged` — the amber line names the file
  and the child's default mode is Run.
- `ComposingAFollowUpCreatesNothingUntilItIsSubmitted` — the composer opens, the
  reader types, Cancel and Escape each leave the graph exactly as it was.
- `SubmittingAFollowUpFocusesTheNewNodeWithItsPromptAlreadyRunning` and
  `BackFromAFollowUpReturnsToTheParentsWorkbench` — the round trip, modelled on
  the three define/back-trail stories at `Multigraph.stories.svelte:6083–6200`.
- `AFollowUpTakesThePinFromItsParent` — a pinned parent, a follow-up, the pin on
  the child and the parent unpinned; one Undo puts it back.
- `ARecordedResultMakesTheNodeADefiner` — a run recording `R_{th}` gives the node
  a definer chip and draws a derived edge to a node whose description references
  `R_{th}`; removing the run's node removes the edge.
- `AResultThatContradictsTheNodesOwnEquationReadsAsAConflict` — milestone 09's
  within-node conflict state, unchanged and now reachable a second way.

**Acceptance**

- All eight pass in both the Storybook UI and the `storybook` Vitest project.
- Each asserts through harness attributes (`data-ai-*`, `data-nav-back`,
  `data-designation-*`) rather than internals.

### T09 — Polish, docs, and the size measurement

|                |                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Depends on** | T08                                                                                                                |
| **Wave**       | 6                                                                                                                  |
| **Agent**      | opus                                                                                                               |
| **Effort**     | S                                                                                                                  |
| **Files**      | `README.md`, `docs/roadmaps/TODO.md`, this plan, the milestone, `roadmap.md`, `docs/ui-decisions/*`, `docs/debt/*` |
| **PR title**   | `docs(ai): document follow-ups and results, and record the shell delta`                                            |

README section: what a follow-up is (compose on the parent, submit to create),
what the pin transfer does, what a child reads from its parent, how far context
reaches and what it costs, what a `RESULT` line does, and the sentence that
values do not flow yet. Record the offline shell size before and after in Notes.
The owner's four rulings of 2026-09-07 are already logged in
`docs/ui-decisions/` (the composer instead of create-then-type, the pin
transferring from parent to child, one adjacency rule for files and prose, and
submitting a follow-up starting its run). Nothing here is waiting on a first use
to become a ruling. Write a file for every further ruling made at the smoke test
— the control's label and the composer owning Escape are the two most likely —
following `docs/ui-decisions/README.md`. File `docs/debt/` entries for anything
real found and deliberately not fixed. Flip the plan to `done`, the milestone to
`complete`, and the roadmap row with it.

**Acceptance**

- Shell size delta in Notes; README section present; any smoke-test rulings
  written to `docs/ui-decisions/`; every gate green;
  no tracked changes under `.svelte-kit/` or any `*storybook*.log`.

## Wave plan

```
Wave 1   T01  ‖  T03  ‖  T05     (results parser; inputs; follow-up mutation — disjoint)
Wave 2   T02  ‖  T04             (extractor needs T01 and T05's aiNode.ts; context needs T03's aiRequest.ts)
Wave 3   T06                     (workbench; needs all four pure layers)
Wave 4   T07                     (wiring and the focus hand-off)
Wave 5   T08                     (behaviour stories)
Wave 6   T09                     (docs and measurement)
```

Nine tasks, six gates. The only file collisions are `aiNode.ts` between T05 and
T02 and `aiRequest.ts` between T03 and T04, and the wave order sequences both.
Before kicking off a wave, every task in it has all its `Depends on` items
merged.

## Risks and rollback

- **The model does not print `RESULT` lines reliably.** The most likely failure,
  and the cheapest to see: the smoke test either finds them or does not. The
  prompt rule is one config-adjacent string; if it still drifts, the fallback is
  a second sentence naming the exact format in the _user_ message for a node
  whose neighbours reference undefined quantities, which is where the need is
  known. Nothing else in the milestone depends on it.
- **A wrong symbol makes a wrong arrow.** A misprinted `R` where the map means
  something else creates a derived edge to an unrelated node. Milestone 09's
  per-node opt-out tag is the existing escape hatch, and results are evicted with
  their run, so the wrong edge is never permanent. Worth a sentence in the
  README rather than a mechanism.
- **The memoisation key regresses the drag path.** T02's own spec is the guard,
  and it is the reason Fable reviews that task. Note the memo is a _string_
  signature, so "key on the array identity instead" is not available as a
  fallback without changing the cache's shape; if the counting double shows a
  rebuild per frame, the cause will be the mapping in `dataflowLayer.ts`
  allocating a fresh object per node per frame rather than the key itself, and
  the fix is to skip the spread for a node with no results (the shared empty
  array makes that a cheap check).
- **Context makes runs cost more.** Three hops of prose is added to every request
  on a chained node, and the metadata line already shows tokens per run. If the
  smoke test says it is expensive, `maxHops` and `maxChars` are one config change
  and the preview already tells the reader what they are paying for.
- **Filename disambiguation changes what a stored script opens.** A script
  written when a parent produced one `plot.png` will not find `plot-2.png` if a
  second parent appears. This is exactly the added/removed case the amber line
  and the Change default already handle, but it now fires for a reason the reader
  did not cause; T06's copy must survive that reading.
- **Two AI nodes pointing at each other, or joined by an undirected edge.** Input
  collection cannot loop; the ancestor walk can, and under the one-rule adjacency
  an undirected pair is mutual ancestry by construction rather than by accident.
  The visited set is the answer and T04 specs it directly. If a real graph
  produces a confusing chain anyway, the answer is a diagnostic, not a
  restriction — nothing here forbids the shape, and the preview shows what was
  sent.
- **A submit that also runs spends tokens on a mis-press.** Ask both creates the
  node and starts its request, so a stray press costs money rather than an
  `Undo`. The mitigation is the shape the owner asked for: the composer is a
  deliberate two-step — open it, write a prompt, then submit — an empty prompt
  cannot be submitted at all, and Cancel sits beside Ask so the way out is as
  close to hand as the way on. The owner ruled for it on 2026-09-07 knowing the
  cost, so it is not an open question; if it is ever revisited, the way back is
  T07's step 5 alone: create and focus without running, and let the child's own
  `Change & run` start it.
- **The pin transfer moves something the reader did not press pin on.** Following
  up on a pinned node silently unpins it. The label says what happened
  (`ask a follow-up`), one Undo puts it back with the child, and the two changes
  are in one entry so they can never come apart. Worth watching in the smoke
  test: if a reader pins a parent precisely to keep it on screen while working
  downstream, this is the ruling to revisit, and it is one line in
  `createFollowUpNode` plus its spec.

## Definition of Done (this plan)

- All nine tasks merged to the session branch and reported ready.
- The milestone's acceptance criteria satisfied (linked, not copied).
- Plan `done`, milestone `complete`, roadmap row `complete` with a link back here.
- Fable's end-to-end smoke test with the user's real key recorded in Notes: a
  parent node over two bench CSVs, a follow-up that reads its outputs and reports
  a number, and the derived edge that number draws.
- The finished work committed unless the user has asked otherwise.

## Notes

- 2026-09-07: **the owner ruled on the three open items, in these words.** On the
  follow-up flow: _"Lets have the user compose the follow up prompt from the
  original !ai node and only when they click submit (or w/e) does it create the
  new node and move them there."_ On the pin: _"If parent is pinned, unpin parent
  and pin child (so basically follow up transfers pin to follow up)."_ On the
  ancestor walk, after the directed-only draft: _"not sure I fully understand but
  I like the simplicity of one rule."_ This revision carries all three: the
  composer replaces the create-then-type shape, the pin transfers in the same
  commit, and the walk uses the same adjacency rule as input collection. **No
  plan execution until the owner explicitly says so** — this document is drafted
  and waiting, and no task is to be started before that go-ahead.
- 2026-09-07: whether submitting also starts the child's first run was left to
  this plan, which answered **yes**, and the owner then ruled the same way in
  review: _"yes, auto-run on submit"_. Logged as
  `docs/ui-decisions/2026-09-07--editing--submitting-a-follow-up-also-starts-its-run.md`.
  One consequence still worth raising at the smoke test rather than guessing at:
  the `Ask` label itself.
- 2026-09-07: plan drafted, not started. Written against the milestone 14 code as
  it stands after the 2026-09-07 evening session (scripts run in `/work`, the cap
  is twelve executions, inputs are grouped by node with Add/Replace/Remove).
- 2026-09-07: the `origin.y + NODE_RADIUS * 2.5` placement is already duplicated
  verbatim between `promoteAiOutputToNode` (`Multigraph.svelte:618`) and
  `createDefiningNode` (`Multigraph.svelte:1909`, the function opens at
  `:1883`). T07 adds a third _caller_ of a placement helper but not a third copy
  of that offset — a follow-up places beside, not below — so the helper takes
  the direction. If T07 slips, the existing duplication is worth filing as debt
  rather than leaving unremarked.
- 2026-09-07: **readiness review against the code, before any execution.** Every
  file, function and ui-decision the plan names exists; M14 is complete; the wave
  order sequences both real file collisions; `inputsChangedSince` does report a
  re-run parent's outputs as `replaced` and `defaultRunMode` does return `rerun`
  for that, so acceptance criterion 2 holds as written; the executor's result
  carries full stdout, so criterion 12 is reachable; and `aiRun.run` is already
  callable from `Multigraph.svelte` via `runAiNode`, so T07 step 5 needs no new
  plumbing. Six things were wrong and are fixed above: T03 was two files short
  and could not have met criterion 3 (the disambiguated name has to be decided
  once and carried through the executor, the digest map, the request and the run
  record); the parent's script was being sent twice in the default Change path;
  T02 had no wiring file and mis-stated the memo as an object key; T07 stated
  the results rule two ways and had a dropped clause; T07's placement extraction
  claimed a third caller it does not have; and the second `summaryMaxChars` was
  renamed. The owner ruled on the two open items the same day (auto-run: yes;
  duplicated script: drop it). **Still no go-ahead to execute** — the plan is
  patched and holding.
- 2026-09-07: `NAV_STACK_LIMIT` is 8. A chain of more than eight follow-ups
  silently loses the oldest crumb. Not addressed here; noted so a "Back stopped
  going far enough" report has an answer.

### Draft system prompt addition (T01, iterate during the smoke test)

Appended to the existing rules list in `systemPromptBody`, before the summary
rule:

```
- When your analysis produces a named numeric result — a fitted constant, a mean,
  a threshold — print it on its own line as
  RESULT <symbol> = <value> <unit>
  with the symbol written in LaTeX and the unit omitted if there is none, for
  example: RESULT R_{th} = 12.3 K/W. One result per line, printed at the end.
  These become quantities in the mind map, so use the symbol the map would use.
```

The rule sits in the system prompt rather than the user message because it is a
rule about how to report, not about this request, and the system prompt has to
stay byte-identical between modes for the cached prefix to survive.

### Draft ancestor section shape (T04)

````text
Conversation so far (nearest first):

1 step back — Sweep A cleanup
Asked: drop the first 200 samples from each file and save one cleaned CSV per file
Result: Three files, 41k rows each. Removed the settling region and wrote clean_a.csv,
clean_b.csv and clean_c.csv. Channel 2 in file B drifts by 4% over the run.

Its analysis.py:
```python
…
```

2 steps back — Raw import
Asked: …
Result: …

(1 earlier step omitted.)
````
