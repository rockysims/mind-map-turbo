# Milestone 14: AI nodes

**Status:** complete
**Depends on:** milestone 13 (add-on registry, file attachments), milestone 12
(undo, which is what makes removing an add-on that holds data safe), 06/06d
(focus surface, nested image zoom), 04l/04n (self-contained HTML saves).
**Plan:** [2026-09-04 14-ai-nodes.md](../plans/2026-09-04%2014-ai-nodes.md)
**Relates to:** milestone 07 (multiplayer) will need per-user keys and a
proxy, which this milestone deliberately does not build.

## Goal

An `!ai` node holds a saved prompt. Run it, and Claude writes a Python script
for the files and text attached to the node and its neighbours; the script
runs in this browser, on the files as they are, and the node keeps what came
back: a short summary, the script that produced the outputs, and the outputs
themselves as attachments. Any output can be promoted to a node of its own,
joined by an edge, and refreshed in place the next time the AI node runs.

The first job is measurements to meaningful plots. Attach a few CSVs from the
bench to nodes, connect them to an `!ai` node, write "plot channel 2 against
time for each file on shared axes, normalised to the first sample", run, look,
refine.

## Why now

The TODO intake carries three AI ideas: scraping a site into a map, growing a
map from notes, and this. This is the narrowest of the three and the only one
with a daily use behind it. Milestone 13 supplies the two foundations it
needs. Milestone 09 already taught the app that a node can have inputs and
outputs with edges derived from them. Deep zoom already gives every node a
full-screen surface to work in. And because the app is a single static file,
the one API it needs can be called straight from the browser with the user's
own key, so there is nothing to deploy before the idea can be tried.

## The shape, and the decisions behind it

**The prompt is a spec, not a chat.** The node stores one editable prompt.
Refining means editing the prompt and running again. A chat thread would let
the node's meaning drift with every message and make a run impossible to
reproduce, which is the wrong trade for scientific data. Continuity comes
from the script instead (next point).

**The script is the artifact.** Every run asks Claude to keep its work in one
file, `analysis.py`, and to produce every output by running that file. The
node stores the script beside the prompt. It earns its place three times
over: the user can read exactly what was done to the data; a refine run sends
the previous script back with the instruction to edit it rather than start
over, so figures stay stable between runs; and a plain re-run on new data
executes the stored script again with no model call at all, which costs
nothing and works offline once the runtime is cached.

**Results live on the AI node. Outputs are promoted, not spawned.** Re-running
is the common case, and one node per output per run would litter the map.
The AI node keeps the summary, the script and an output grid; nested image
zoom already makes a plot readable at full size there. A single action
promotes one output to its own node, bound to the output by filename, so a
later run refreshes the promoted node in place. Promoted data outputs (a
cleaned CSV) are ordinary file attachments and can feed a second AI node,
which is how pipelines happen without any new machinery.

**Inputs are collected by proximity.** Everything attached to the AI node
itself, plus the files, titles and descriptions of its one-hop neighbours
across incoming and undirected edges, are the inputs. Outgoing edges are
outputs and are excluded, which is also what keeps a promoted node from
feeding its own source. An edge tag becomes the input's label, so `@baseline`
is how a file gets a role without new UI. The workbench lists the collected
inputs before Run so there are no surprises.

**The script runs in this browser; Claude is called through the Messages API
and nothing else.** Claude gets one client-side tool, `run_analysis`, whose
only argument is the whole script. The browser runs it in a Python runtime
(Pyodide, with pandas, numpy, scipy and matplotlib) inside a Web Worker,
against the attached files as they are, and answers with stdout, stderr, the
exit code, the files the script wrote to `outputs/`, and each PNG among them
as an image, so Claude can look at its own plot and fix the axis it got wrong.
Claude fixing its own errors inside that loop is most of the value for "get
me a plot fast", and it works the same way here as it would in a hosted
sandbox. The milestone was first drafted around Anthropic's code execution
sandbox with the Files API moving inputs and outputs; the 2026-09-04 review
sent cross-origin preflights to the live API and found that only
`/v1/messages` answers a browser page, while the Files endpoints refuse every
origin. A relay would bring the sandbox back and belongs with the login
server; the local executor was the milestone's own "later" and is now its
"first". The runtime is not bundled: it loads from a CDN on the first run in a
browser (tens of megabytes, cached by the browser after that), so the offline
shell stays small and a graph that never runs an AI node pays nothing. A run
needs the network anyway.

**What leaves the machine is the request, and the request is inspectable.**
The Messages API keeps nothing local by itself; what keeps the data local is
that the script runs here. A request carries the user's prompt, the
neighbours' titles and descriptions, and for each attached file a digest the
runtime computes locally: name, size, columns, types, row count and the first
few rows. During the loop it carries the tool results: tails of stdout and
stderr, output filenames, and the rendered plots. The files themselves never
leave. Everything that does leave is retained by Anthropic under the API's
retention policy. The workbench shows the digests before Run, and how many
rows a digest may show is a setting.

**Named by capability.** `!ai`, not `!claude`. The run record stores which
model produced it, so the node stays honest if the model changes.

## Scope

### Settings, kept to one screen

- Nothing to configure up front. The first Run on an `!ai` node with no key
  opens one sheet: a field for the Anthropic API key, a link to where keys
  are made, and a Connect button that validates the key with the cheapest
  Messages call there is (one output token; the models endpoint is not
  reachable from a browser) and saves it. Two sentences under the field:
  _Stays in this browser. Never saved in your graph files._ and _Use a key
  from its own workspace with a spending limit._ Connect succeeds, the sheet
  closes, the run continues.
- The key is app-level. Entered once per browser, it serves every `!ai`
  node in every graph; a second AI node never asks again.
- A collapsed section titled _Model, cost and data_: default model (Opus 5
  or Sonnet 5), preview rows sent per file (none, 5, 20, or the whole file
  up to a configured size), whether rendered plots go back to Claude for
  checking, and Forget key. Thinking effort has no control in this
  milestone; it is fixed per run mode in `APP_CONFIG`.
- Reachable later from a toolbar control that also shows connected state,
  and from a small control in the workbench.
- The key lives in its own storage entry through the same storage resolver
  the graph uses (so a browser that blocks site data falls back to memory
  and asks again), under a prefix outside the graph namespace so the quota
  estimate does not count it. It is never part of graph data, never in an
  export. Opening an exported document in another browser asks for a key
  again; the sentence under the field is why. A "Remember on this browser"
  choice on the sheet, off for a memory-only key that lasts the tab, is the
  one hardening control (resolved question 6).

### Data model

- `addons.ai: { prompt; model?; script?; runs: AiRun[]; promoted:
Record<outputName, nodeId> }`.
- `AiRun { id; startedAt; finishedAt?; status: 'done' | 'error' |
'cancelled' | 'interrupted'; mode: 'analyse' | 'refine' | 'rerun'; model?;
runtime: string; inputs: { nodeId; assetId?; label? }[]; summary; outputs:
{ name; assetId; mimeType }[]; usage?: { inputTokens; outputTokens };
toolCalls: number; error? }`. A re-run has no model and no usage.
- A run is never persisted as running. In-flight state is UI state; a
  reload turns it into `interrupted`.
- History is bounded by a configured count (default 3). Output assets of
  evicted runs are tombstoned and collected by milestone 12's sweep once no
  history entry can reach them, unless a promoted node still points at them.
- Output files from the runtime are stored as ordinary assets: PNG and SVG
  as `kind: 'image'`, everything else as `kind: 'file'`, so the rest of the
  app needs no new rendering.

### The workbench

A new focus-content variant beside `NodeDetailsContent`, chosen when the
focused node carries the `ai` add-on: prompt editor, collected inputs list
with labels and the digest each will send, Run and Cancel, a mode switch
(Refine after the prompt changed, Re-run script when it has not), a live
section that shows Claude's text as it streams and each script execution as
a step with its stdout tail, the output grid with nested image zoom, file
rows for non-image outputs, a collapsed script panel, and one line of run
metadata: model, duration, tokens, tool calls. A runtime line says when the
Python runtime is loading for the first time and how large it is. Errors and
refusals are shown in the same place the response would be. Every output has
a Promote action; a promoted output shows which node it lives in.

### The run pipeline

1. Ensure a key; open the settings sheet if not.
2. Collect inputs (pure). Load the runtime if it is not loaded, write the
   input blobs into its filesystem, and compute each file's digest with a
   fixed probe script.
3. Build the request (pure): a fixed system prompt (drafted in the plan),
   the `run_analysis` tool, the user's prompt, the inputs with their labels
   and digests, and the previous script for Refine mode.
4. Loop. Stream a Messages call; on a `run_analysis` call, run the script in
   the worker under a timeout and send back the tool result (stdout and
   stderr tails, exit code, the output list, PNGs as images); continue until
   `end_turn`, the configured cap on tool calls, `max_tokens`, or a
   `refusal`. Reuse the loaded runtime across calls and runs.
5. Read the final state (pure): the last script that ran to completion, the
   summary text, usage summed over the calls.
6. Store outputs as assets, commit the run through the single graph write
   path with the label "run AI node", refresh promoted nodes, tombstone
   evicted assets.
7. Cancel aborts the in-flight request, terminates the worker, and records a
   cancelled run. Re-run script mode skips steps 3 to 5: it executes the
   stored script and records a run with no model.

### Promote and refresh

- `promoteAiOutput(graph, aiNodeId, outputName)` creates a node titled by
  the output name, carrying the same asset as its content block, joined by
  a directed edge from the AI node, and records the binding.
- After a run, every bound output name that was produced again replaces the
  promoted node's content block with the new asset. A bound name the run
  did not produce leaves the promoted node as it was and marks it stale in
  the workbench.

## Out of scope

- Chat threads per node. See "The prompt is a spec".
- Anthropic's code execution sandbox and the Files API. Verified unreachable
  from a browser page on 2026-09-04; a relay would bring them back and
  belongs with the login server.
- A server proxy and per-user keys. Comes with the login server.
- Letting the AI edit the graph: creating nodes from a website, suggesting
  edges, growing a map from notes. A different conversation.
- Web search, Anthropic skills, MCP servers. None are needed for plots.
- Bundling the Python runtime into the offline shell. It loads from a CDN on
  first use.
- Showing a promoted plot as the node's background on the canvas. The TODO
  intake already has "image as node background"; it pairs naturally with
  this milestone and should be scheduled after it.

## Hard parts

- **Data leaves the machine, in a bounded way.** Only what the request
  carries: digests, prompt, neighbour text, stdout and stderr tails, and the
  plots. The digest depth is a setting, the workbench shows what will go,
  and a spec pins that a request built from a large file contains no more
  rows than configured. It is still retained on Anthropic's side under the
  API retention policy.
- **Runtime weight and the first-run wait.** Tens of megabytes from a CDN
  the first time a browser runs an AI node, then cached. The workbench says
  so while it happens. A run also needs the network for the model, so the
  offline promise is unchanged: re-runs of a stored script work offline once
  the runtime is cached, a fresh analysis never did.
- **Long runs.** A run with thinking and several script executions can take
  a minute or more. Streaming from the first token with thinking summaries
  shown, a visible Cancel, and never persisting an in-flight run are the
  three rules.
- **Cancel kills the runtime.** A `file://` page cannot use the shared
  memory that interrupting Pyodide needs, so Cancel terminates the worker
  and the next run reloads the runtime from cache, seconds rather than
  minutes. A script that never ends hits a timeout and is treated the same
  way.
- **Bundle weight.** The Messages client is a raw `fetch` with a small SSE
  parser; the SDK is a devDependency for its types only, since its runtime
  adds a third to the offline shell no matter how little is imported. The
  plan measures the shell before and after and records the delta.
- **Storage budgets.** Assets live in IndexedDB, but run records with
  summaries and scripts go into the autosaved JSON under the localStorage
  budget, and now into milestone 12's history tail as deltas. Bounded
  history and a capped summary length keep that in check.
- **API edge cases.** `refusal` with its category, `max_tokens`, rate
  limits, an invalid key, and the tool-call cap. Each has a named state in
  the run record and a sentence in the workbench.
- **Data files are data.** The system prompt says text found inside input
  files is content to analyse, not commands. The runtime has no network, so
  the blast radius is a bad plot or a hung worker, and the timeout ends the
  latter.
- **The key has a threat model.** The shell opens from `file://`, and in
  Chrome every local file shares one localStorage, which already holds the
  graph drafts; the key raises what a leak costs. Any script that runs in
  the page could read it too, and the page now renders model output and
  attachment names. The sheet copy recommends a key from its own workspace
  with a spending limit, which bounds the damage of any leak; the plan's
  spike checks whether a content-security policy in the shell restricting
  where the page may connect coexists with the runtime and `file://`.
- **Reproducibility.** Every run must be rebuildable from the prompt, the
  script and the assets in the document alone. The runtime version is
  pinned in `APP_CONFIG` and recorded on each run, so a later runtime that
  draws differently is a visible difference rather than a silent one.

## Open questions

1. Should the key persist across browser sessions (localStorage) or be asked
   for per session (sessionStorage)? **localStorage**, through the storage
   resolver the graph already uses. (Resolved 2026-09-04.)
2. How many runs to keep. **Three**, as a config value. (Resolved
   2026-09-04.)
3. Is the AI node's own attachment list an input as well as its neighbours'?
   **Yes**, so the simplest case needs no edges at all. (Resolved
   2026-09-04.)
4. Default effort. **Fixed per run mode, no control in this milestone:
   `high` for a fresh analysis, `medium` for refine; re-run makes no model
   call.** A fresh analysis is agentic coding in miniature; refine edits a
   known script. Every run records its token usage, so the smoke test can
   move these. If they turn out to need varying per user, the follow-up is a
   three-stop _Thoroughness_ control (Quick, Standard, Thorough) in the
   settings section, not a raw effort picker. (Resolved 2026-09-04.)
5. Which Python runtime version to pin, and from which CDN. **The spike
   decides.** (Replaces the earlier question about the code execution tool
   version, which no longer applies.)
6. Key hardening beyond localStorage. A per-document wrapping key stored in
   the graph HTML was proposed and pushed back on: it defends against other
   local files reading the shared storage, but not against a script in this
   page; it breaks the one-key-per-browser promise; and it puts key material
   into the file the user shares. **Plain localStorage, with three
   mitigations instead: a "Remember on this browser" choice on the sheet,
   the spending-limit advice in the sheet copy, and the content-security
   policy the spike checks.** Decided by the user 2026-09-04.

## Acceptance criteria

1. In a fresh browser profile, Run on an `!ai` node opens the key sheet once;
   an invalid key is refused with a clear message; after Connect the run
   proceeds without a second click. The key appears in no export and in no
   storage entry under the graph namespace.
2. Two nodes each carrying a CSV, both connected to an `!ai` node whose
   prompt asks for a plot per file on shared axes: Run streams a response,
   the script runs in this browser, at least one PNG lands in the node's
   output grid, nested zoom opens it at full size, and the script panel
   shows `analysis.py`.
3. Editing the prompt to add "log scale on y" and running again in Refine
   mode produces a figure with the same filename, and a node promoted from
   that figure shows the new image without any further action.
4. Re-run script mode executes the stored script with no request to the API
   (a spy on the client sees none), completes with the network off once the
   runtime is cached, and records `mode: 'rerun'` with no model.
5. Cancel during a run leaves the previous run intact and records a
   cancelled one. Reloading during a run shows it as interrupted, never as
   running.
6. The AI node, its runs, its outputs and its promoted nodes survive
   Download and Open in a fresh profile, with every image visible.
7. A promoted node whose output name the latest run did not produce keeps
   its image and is marked stale in the workbench.
8. Removing `!ai` from the node removes the runs and tombstones output
   assets that no promoted node references, with no confirm; one Undo brings
   the add-on, its runs and its outputs back.
9. Every run shows model, duration, token counts and tool calls in the
   workbench.
10. A request built for a 10,000-row CSV carries only the configured preview
    rows of it, pinned by a spec on the pure request builder; the workbench
    shows the same digest before Run.
11. Every gate in `AGENTS.md` passes, and the offline shell size delta and
    the runtime's first-load size are recorded in the plan's notes.
