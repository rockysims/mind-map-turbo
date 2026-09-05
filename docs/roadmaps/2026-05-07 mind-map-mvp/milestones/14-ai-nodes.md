# Milestone 14: AI nodes

**Status:** proposed
**Depends on:** milestone 13 (add-on registry, file attachments), 06/06d
(focus surface, nested image zoom), 04l/04n (self-contained HTML saves).
**Plan:** [2026-09-04 14-ai-nodes.md](../plans/2026-09-04%2014-ai-nodes.md)
**Relates to:** milestone 12 (undo) is what makes removing an add-on that
holds data safe; milestone 07 (multiplayer) will need per-user keys and a
proxy, which this milestone deliberately does not build.

## Goal

An `!ai` node holds a saved prompt. Run it, and Claude works on the files and
text attached to the node and its neighbours, in a sandbox with Python and
matplotlib, and the node keeps what came back: a short summary, the script that
produced the outputs, and the outputs themselves as attachments. Any output can
be promoted to a node of its own, joined by an edge, and refreshed in place the
next time the AI node runs.

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
the API can be called straight from the browser with the user's own key, so
there is nothing to deploy before the idea can be tried.

## The shape, and the decisions behind it

**The prompt is a spec, not a chat.** The node stores one editable prompt.
Refining means editing the prompt and running again. A chat thread would let
the node's meaning drift with every message and make a run impossible to
reproduce, which is the wrong trade for scientific data. Continuity comes
from the script instead (next point).

**The script is the artifact.** Every run asks Claude to keep its work in one
file, `analysis.py`, and to produce every output by running that file last.
The node stores the script beside the prompt. It earns its place three
times over: the user can read exactly what was done to the data; a refine run
sends the previous script back with the instruction to edit it rather than
start over, so figures stay stable between runs; and a plain re-run on new
data can send the script unchanged with a cheap, low-effort instruction to
execute it, which costs a fraction of a fresh analysis. It is also the seam a
local executor would plug into later without touching the data model.

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

**Execution happens in Claude's sandbox, called from the browser.** The code
execution tool gives Claude a container with pandas, numpy, scipy, matplotlib
and seaborn preinstalled and no network. Inputs go up once through the Files
API and are referenced by id; outputs come back as file ids and are stored as
assets. Claude fixes its own script errors inside the loop, which is most of
the value for "get me a plot fast". The official TypeScript SDK runs in a
browser behind an explicit opt-in, so no server is needed. Running Python in
the browser instead would keep data local and make re-runs free, but it is a
large download that does not fit the offline shell; the run record is shaped
so that executor can be added later.

**Named by capability.** `!ai`, not `!claude`. The run record stores which
model produced it, so the node stays honest if the model changes.

## Scope

### Settings, kept to one screen

- Nothing to configure up front. The first Run on an `!ai` node with no key
  opens one sheet: a field for the Anthropic API key, a link to where keys
  are made, and a Connect button that validates the key with a free call
  and saves it. One sentence under the field: _Stays in this browser. Never
  saved in your graph files._ Connect succeeds, the sheet closes, the run
  continues.
- The key is app-level. Entered once per browser, it serves every `!ai`
  node in every graph; a second AI node never asks again.
- A collapsed section titled _Model, cost and data_: default model (Opus 5
  or Sonnet 5), how long uploaded files stay on Anthropic's side (default
  30 days), Forget key. Thinking effort has no control in this milestone;
  it is fixed per run mode in `APP_CONFIG` (see the resolved questions).
- Reachable later from a toolbar control that also shows connected state,
  and from a small control in the workbench.
- The key lives in its own storage entry through the same storage resolver
  the graph uses (so a browser that blocks site data falls back to memory
  and asks again). It is never part of graph data, never in an export.
  Opening an exported document in another browser asks for a key again;
  the sentence under the field is why.

### Data model

- `addons.ai: { prompt; model?; script?; runs: AiRun[]; promoted:
Record<outputName, nodeId>; container?: { id; expiresAt } }`.
- `AiRun { id; startedAt; finishedAt?; status: 'done' | 'error' |
'cancelled' | 'interrupted'; mode: 'analyse' | 'refine' | 'rerun'; model;
inputs: { nodeId; assetId?; label? }[]; summary; outputs: { name; assetId;
mimeType }[]; usage: { inputTokens; outputTokens }; error? }`.
- A run is never persisted as running. In-flight state is UI state; a
  reload turns it into `interrupted`.
- History is bounded by a configured count (default 3). Output assets of
  evicted runs become unreferenced and are swept, unless a promoted node
  still points at them.
- Output files from the sandbox are stored as ordinary assets: PNG and SVG
  as `kind: 'image'`, everything else as `kind: 'file'`, so the rest of the
  app needs no new rendering.

### The workbench

A new focus-content variant beside `NodeDetailsContent`, chosen when the
focused node carries the `ai` add-on: prompt editor, collected inputs list
with labels, Run and Cancel, a mode switch (Refine after the prompt changed,
Re-run script when it has not), the streamed response, the output grid with
nested image zoom, file rows for non-image outputs, a collapsed script panel,
and one line of run metadata: model, duration, tokens. Errors and refusals
are shown in the same place the response would be. Every output has a
Promote action; a promoted output shows which node it lives in.

### The run pipeline

1. Ensure a key; open the settings sheet if not.
2. Collect inputs (pure). Upload each input file whose content hash has no
   cached file id; cache ids outside graph data.
3. Build the request (pure): a fixed system prompt (drafted in the plan),
   the user's prompt, the input files as container uploads with their
   labels, the previous script for Refine and Re-run modes, and the code
   execution tool.
4. Stream. Resume `pause_turn` up to a configured number of times. Reuse
   the container id while it is valid.
5. Read the final message (pure): summary text, output file ids, the
   script as an output named `analysis.py`.
6. Download outputs, store as assets, commit the run through the single
   graph write path, refresh promoted nodes.
7. Cancel aborts the request and records a cancelled run.

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
- Running code locally in the browser. The seam is designed in; the
  executor is not built.
- A server proxy and per-user keys. Comes with the login server.
- Letting the AI edit the graph: creating nodes from a website, suggesting
  edges, growing a map from notes. A different conversation.
- Web search, Anthropic skills, MCP servers. None are needed for plots.
- Showing a promoted plot as the node's background on the canvas. The TODO
  intake already has "image as node background"; it pairs naturally with
  this milestone and should be scheduled after it.

## Hard parts

- **Data leaves the machine.** Files API uploads are visible to the whole
  workspace behind the key. Fine for a personal key. Every upload sets an
  expiry so Anthropic-side storage self-cleans, and the hash cache means a
  file is uploaded once, not once per run.
- **Long runs.** A run with thinking and several sandbox iterations can take
  a minute or more. Streaming from the first token, a visible Cancel, and
  never persisting an in-flight run are the three rules.
- **Bundle weight.** The SDK joins the inline single-file bundle. The plan
  measures the offline shell before and after and records the delta.
- **Storage budgets.** Assets live in IndexedDB, but run records with
  summaries and scripts go into the autosaved JSON under the localStorage
  budget. Bounded history and a capped summary length keep that in check.
- **API edge cases.** `pause_turn`, `refusal` with its category, rate
  limits, an invalid key, an expired file id, and a container that has
  aged out. Each has a named state in the run record and a sentence in the
  workbench.
- **Data files are data.** The system prompt says instructions found inside
  input files are content to analyse, not commands. The sandbox has no
  network, so the blast radius is a bad plot.
- **Reproducibility has a horizon.** Containers age out after thirty days and
  cached file ids can expire. Every run must be rebuildable from the assets
  in the document alone; the container and the cache are only speed-ups.

## Open questions (resolved 2026-09-04)

1. Should the key persist across browser sessions (localStorage) or be asked
   for per session (sessionStorage)? **localStorage**, through the storage
   resolver the graph already uses.
2. How many runs to keep. **Three**, as a config value.
3. Is the AI node's own attachment list an input as well as its neighbours'?
   **Yes**, so the simplest case needs no edges at all.
4. Default effort. **Fixed per run mode, no control in this milestone:
   `high` for a fresh analysis, `medium` for refine, `low` for re-run
   script.** A fresh analysis is agentic coding in miniature and gets the
   API default; refine edits a known script; re-run only executes one. Every
   run records its token usage, so the smoke test can move these. If they
   turn out to need varying per user, the follow-up is a three-stop
   _Thoroughness_ control (Quick, Standard, Thorough) in the settings
   section, not a raw effort picker.
5. Which of the code execution tool versions to pin. **The spike decides.**

## Acceptance criteria

1. In a fresh browser profile, Run on an `!ai` node opens the key sheet once;
   an invalid key is refused with a clear message; after Connect the run
   proceeds without a second click. The key appears in no export and in no
   storage entry under the graph namespace.
2. Two nodes each carrying a CSV, both connected to an `!ai` node whose
   prompt asks for a plot per file on shared axes: Run streams a response,
   at least one PNG lands in the node's output grid, nested zoom opens it at
   full size, and the script panel shows `analysis.py`.
3. Editing the prompt to add "log scale on y" and running again in Refine
   mode produces a figure with the same filename, and a node promoted from
   that figure shows the new image without any further action.
4. Re-run script mode sends the stored script unchanged, completes with the
   configured cheaper model, and records `mode: 'rerun'`.
5. Cancel during a run leaves the previous run intact and records a
   cancelled one. Reloading during a run shows it as interrupted, never as
   running.
6. The AI node, its runs, its outputs and its promoted nodes survive
   Download and Open in a fresh profile, with every image visible.
7. A promoted node whose output name the latest run did not produce keeps
   its image and is marked stale in the workbench.
8. Removing `!ai` from the node confirms, removes the runs, and sweeps
   output assets that no promoted node references.
9. Every run shows model, duration and token counts in the workbench.
10. A file uploaded for one run is not uploaded again for the next run of
    the same content.
11. Every gate in `AGENTS.md` passes, and the offline shell size delta is
    recorded in the plan's notes.
