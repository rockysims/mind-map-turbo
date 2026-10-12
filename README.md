# MindMap

This project aims to provide a way of constructing a mind map / knowledge web.
The goal is to make it so low friction that it can be used in real time during
a conversation by multiple people at once to, essentially, take notes. A key
goal is to be able to visualize the full mind map even if it becomes huge (via
resizing/rearranging all other nodes around the node(s) pinned by user) so
that the relevant nodes can be readable without entirely losing sight of the
whole.

## Roadmap

The active roadmap, milestones, and (when work is in flight) plans live under
[`docs/roadmaps/`](docs/roadmaps/). Start there for orientation:

- [Roadmap: MindMap MVP](docs/roadmaps/2026-05-07%20mind-map-mvp/roadmap.md)

## Finding your way around the canvas

Zoom is anchored to the pointer, so zooming into empty space moves the graph
away — far enough, and nothing is left in view. Press <kbd>F</kbd> to fit the
whole visible graph back into the window. It is the only canvas shortcut, and
when the graph really has gone off-view a hint saying so appears in the middle
of the empty canvas, so it does not have to be remembered.

Nodes are reachable from the keyboard: <kbd>Tab</kbd> moves between them and
<kbd>Enter</kbd> opens the focused node's details.

## Title syntax

A node's title carries more than its name. Three markers at the front of what
you type are read as instructions and then removed, so the title that gets
stored is only the words that are left:

- `#lab Filter rig` tags the node `lab` and titles it "Filter rig". Node tags
  colour the node's border.
- `@baseline Filter rig` tags the edge created alongside the new node
  `baseline`. It applies to that edge, not to the node.
- `!task Filter rig` gives the node the task add-on: a done checkbox in its
  details view and a small box on the canvas.
- `!ai Channel drift` gives the node the AI add-on: a prompt, a Run button and
  the analysis it produces. See [AI nodes](#ai-nodes) below.

The markers may be combined in any order, may abut, and may repeat, so
`!task #lab @bench Buy filters` and `#lab!task@bench Buy filters` both mean the
same thing. A name ends at the next marker or the next space, which is why a
tag name cannot itself contain `#`, `@` or `!`. A leading `>` or `<` before all
of that points the new edge: `>` draws the arrow towards the node you are
typing, `<` draws it back the other way, and without either the edge is
undirected.

Unlike `#` and `@`, which take any word you invent, `!` picks from a closed
list of add-ons — `task` and `ai` today. An unrecognised name is not an error
and does not vanish: `!important Read this` ends the marker run and stays in
the title exactly as typed.

The node edit sheet's title field reads `#` and `!` too, and adds to what is
already there rather than replacing it — the sheet's own tag list and add-on
toggles stay the way to remove one. It leaves `@` and a leading `>` or `<`
alone, because an existing node has no newly created edge to apply them to.

## Starting a map with an AI agent

Give the agent
[`apps/mind-map-sv/examples/ai-mind-map.html`](apps/mind-map-sv/examples/ai-mind-map.html).
It is a complete self-contained save file whose embedded graph is also a guide
to the file format and to how the graph appears to a reader. The instructions
beside its JSON payload tell an agent how to preserve the offline app shell and
replace only the graph; the visible nodes explain pins, positions, tags and tag
colours, directed and undirected edges, add-ons, assets, and the opening camera.

The example is generated from the same `static/offline-app-shell.html` used by
Download. `pnpm --filter mind-map-sv build` refreshes both files, and
`pnpm check:offline-shell` fails if either committed artifact is stale.

## AI nodes

`!ai Channel drift` gives a node the AI add-on. Open it and you get a
workbench: a prompt, the files and notes it can see, a Run button, and — once
a run finishes — a summary, the plots and tables it produced, and the Python
script that produced them. The inputs are listed under the node each one hangs
off, and can be edited there: **Add file** on this node, and on any file row
**Replace** (new bytes under the same name, so the stored script still opens it)
and **Remove**. Undo covers all three.

What actually happens on a run is worth being precise about, because it is
unusual: **Claude writes a script, and your browser runs it.** Nothing is
executed on a server. The node collects its inputs (attachments on the node
itself, and attachments and text on the nodes one edge away), measures each
file locally, and sends Claude the prompt, those measurements and the
neighbours' text. Claude replies with a complete `analysis.py`, which runs
here, in a Python runtime inside a Web Worker in this tab. What it printed and
what it saved go back to Claude, which looks at its own plots and can fix the
script and run it again — up to a small cap — before writing the summary. The
script is stored on the node, so a run can always be reproduced from the
document alone.

### Connecting a key

AI nodes need your own Anthropic API key; the toolbar's AI control opens the
one-screen setup for it. Two things about that screen are deliberate:

- **Use a key from its own workspace, with a spending limit.** That is the
  only thing that bounds what a mistake — or a leaked key — can cost, and it
  takes a minute to set up in the Anthropic console.
- **"Remember on this browser"** decides where the key lives. Left on, it is
  saved in this browser's storage, so it survives a reload and every graph you
  open here shares it. Turned off, it is held in memory for this tab only and
  you retype it next time. Either way it is never written into a graph file:
  a `.html` you send someone carries no key.

Under "Model, cost and data" the same screen picks the model, how many rows of
each file a request may carry, whether rendered plots are sent back for Claude
to check, and Forget key.

### The three modes

- **Write** — Claude writes a new script from the prompt and runs it. This is
  the first run, and the one to use when the question has changed.
- **Change** — Claude changes the stored script to match the prompt and runs
  it, keeping its output filenames so the node's figures update in place
  rather than accumulating. Cheaper and steadier than starting over.
- **Run** — runs the stored script again on the current files, with **no model
  call at all**. Free, and the right button after changing the data behind an
  attachment. A script that opens files by name won't notice a new one; a
  script that reads every attached file will (see below).

Every attached file — this node's and its one-hop neighbours' — reaches the
script on every run, under its own filename. So a script that reads every file
it is handed finds one you attached yesterday, and a script that opens fixed
filenames does not: it is given the new file and never reads it. When a file has
come or gone since the script was written the workbench says so above the
switch, naming it, and starts on **Change**, which is how the script catches up.
A file _replaced_ under the same name is the case Run was made for — the script
opens that name either way — so that one starts on **Run**, and the note says so
rather than pushing you at a model call.

An output can be promoted to a node of its own — the `⤴` button on its row. A
later run that produces the same filename swaps the image on that node, and one
that stops producing it leaves the last figure in place, marked stale.

### Carrying on: outputs, follow-ups and context

An AI node's outputs are data, so they flow like data. Whatever the **latest
finished run** wrote to `outputs/` becomes an input to any AI node that already
collects that node — the same one-hop rule the attachments use: an edge pointing
at you, or an undirected one. There is no promote step in between. They are
listed under their node as **From its last run**, with no Add, Replace or Remove
on those rows, because there is nothing behind those buttons for a file the
reader did not attach. If two of the files reaching one run share a name they are
renamed apart before anything sees them — `plot.png`, then `plot-2.png` — and the
same set of inputs always produces the same set of names.

**Ask a follow-up**, beside the outputs, is available once the node has a
finished run. It opens a composer in that node's own workbench, with the answer
you are responding to still on screen above it, and commits nothing: Cancel and
Escape both close it and leave the graph exactly as it was, and an empty draft
cannot be submitted (the notice line says why). Enter and Shift+Enter insert a
newline, like the prompt field beside it; Cmd/Ctrl+Enter submits.

Submitting is the press that does everything, in one history entry called
`ask a follow-up`: a new `!ai` node beside the parent carrying the prompt you
just wrote, a directed untagged edge from the parent to it, and the **pin
transfer** — a pinned parent hands its pin to the child and is left unpinned, so
the visibility budget follows your attention instead of accumulating one pin per
question; an unpinned parent makes an unpinned child. Then the app focuses the
child, leaves a Back crumb naming the parent, and starts the child's first run.
That run is in **Change** mode against the _parent's_ script, with a sentence
telling Claude the script came from the step before — the child has none of its
own, so Run is not offered until it has run once. A single Undo removes the
child, its prompt and the edge together, and gives the parent its pin back. (The
Back trail keeps eight steps; a chain longer than that quietly drops its oldest
crumb.)

A child's request also carries the **conversation so far**: up to three steps
back, reached by that same adjacency rule, each contributing its title, its
prompt and its latest summary, nearest first. The direct parent's `analysis.py`
comes along only in Write mode — a Change request is already sending that script
as the thing it is editing, and sending it twice would just be paying twice. The
whole section is capped in characters: over the cap, summaries are trimmed first,
then the farthest step is dropped whole and the section says how many were left
out. Prose reaches three hops; **files still reach one**. What will be sent is
shown verbatim under a **What Claude will see** disclosure in the run section —
naming how many steps and how many characters survived the cap — for the mode you
have selected. (There is nothing to preview in Run mode: it makes no request.)

### Numbers a run reports

Claude is asked to print any named number its analysis produced on a line of its
own:

```
RESULT R_{th} = 12.3 K/W
```

The symbol is LaTeX, the unit is optional free text, and one line carries one
result. They are read out of the full stdout of the run's final execution, and
only when that execution succeeded — a number from a script Claude then rewrote
is not the run's answer. A line whose value is not a number, or whose symbol
contains anything outside a small allowlist, is ignored rather than repaired.

What survives lands under **Results** on the node, rendered as display math like
any other equation, and stored on the run — so it is evicted when that run is,
and removing the `!ai` add-on takes it with it. Nothing is written into your
description.

Because the node now states `R_{th}`, the map's dataflow layer treats it as a
definition: open a node whose description references `$R_{th}$`, and its peek
card offers the recorded value as the definition with **Label as output**.
Confirm that, mark the consumer's own chip as an input, and the derived arrow
between them is drawn — by exactly the machinery that connects two nodes whose
equations you typed by hand. A number measured from bench data and a number
somebody typed land in the same notation, and the map does not care which is
which.

One consequence worth knowing: **a wrong symbol makes a wrong arrow.** If a
script prints `R` where the map means something else, the edge it draws goes
somewhere unrelated. Results are evicted with their run, so it is never
permanent, and tagging a node `#no-dataflow` keeps it out of the layer entirely.

**Values do not flow yet — only names.** A downstream script receives the
upstream node's _files_, not `R_th = 12.3`. Making the numbers themselves
available to a script is a later milestone; the structure is made visible and
checkable first.

### What leaves your machine

Only what a request needs, and it is built in one place so it can be checked:

- the prompt you wrote, and the title and description of connected nodes;
- a **digest** of each attached file — its name, size, column names and
  types, row count, and the first few rows (zero, five or twenty, your
  choice) — and, for a file that came from a neighbour's run, a line saying
  so;
- the "conversation so far" section above, when this node has AI ancestors;
- while a run is working, the tail of what the script printed to stdout and
  stderr, and the plots it rendered, if "send plots" is on.

**The files themselves never leave.** Neither does the rest of the graph. The
runtime that runs the script has no network access of its own.

### The first run is a big download

The Python runtime is not in the app — it would triple its size. The first run
in a browser fetches it from a CDN: roughly 39 MB for the runtime plus pandas,
numpy and matplotlib, about ten seconds on a decent connection, and anything
else a script imports on top of that. It is cached afterwards, so later runs
start in about a second — though browsers do evict the largest files, and a
run can occasionally pay for one again.

So: a run needs the network twice over — once for Claude, once for the
runtime. **Run** needs neither Claude nor, once the runtime is cached, anything
else, which makes it the mode that still works on a plane.

## Writing math in node descriptions

Node descriptions accept LaTeX between dollar delimiters: `$…$` renders inline
with the surrounding prose, and `$$…$$` renders as a centered display equation.
Write `\$` for a literal dollar sign. A delimiter that is never closed stays
ordinary text, so a stray `$` cannot blank out the rest of a description.

The node edit sheet shows a live preview as soon as a draft contains math, and
invalid LaTeX renders an inline error marker instead of blocking the save — the
description is always stored as the raw source you typed.

Expressions are typeset to MathML by [Temml](https://temml.org), which the
browser draws with its own math font. Temml's stylesheet and its one small
`woff2` are inlined into the downloadable HTML, so math still renders in a saved
file opened from disk with no network.

## Working on this project

Coding conventions, test discipline, and commit format are documented in:

- [`AGENTS.md`](AGENTS.md) — portable agent guide (also read by Codex, Aider, etc.)
- [`.cursor/rules/`](.cursor/rules) — Cursor-specific rules with file scoping

Read them before making non-trivial changes. The "Definition of Done" in
`.cursor/rules/core.mdc` is the gating checklist for every PR.

## Development

Install:

```
pnpm install
```

Run the app:

```
turbo run dev
```

Run the app after refreshing the self-contained HTML shell used by Download:

```
pnpm dev:downloadable
```

Verify the tracked downloadable shell is fresh after code changes:

```
pnpm check:offline-shell
```

Restarting `turbo dev` does not refresh the app code embedded in downloaded HTML
files; rebuild the offline shell when those files should carry new code forward.

Run storybook:

```
cd apps/mind-map-sv
pnpm run storybook
```

Push to Chromatic:

```
cd apps/mind-map-sv
pnpm run chromatic
```

Run the app in docker:

```
cd apps/mind-map-sv
docker compose up
```

The image builds from the repo root against the workspace lockfile — the same
one CI installs from — and serves the static build. There is a `db` service
alongside it for the server work that is planned; nothing talks to it yet, and
`docker compose up app` skips it.

Run tests:

```
pnpm --filter mind-map-sv test:unit -- --run
pnpm --filter mind-map-sv test:e2e
```
