# Milestone 15: AI follow-ups and results

**Status:** proposed
**Depends on:** milestone 14 (the `!ai` add-on, the run loop, the workbench),
milestone 09 (quantity inference and derived edges), milestone 11 (the unified
hop model those edges live in), milestone 06b/06d (the focus stack and the
back trail), milestone 12 (undo, which is what lets a follow-up node be created
without a confirm).
**Plan:** [2026-09-07 15-ai-follow-ups-and-results.md](../plans/2026-09-07%2015-ai-follow-ups-and-results.md)
**Relates to:** milestone 07 (multiplayer), which will have to decide whose
run a shared node's results belong to. Nothing here assumes one author, but
nothing here tests two.

## Goal

Make an analysis something you can carry on with, in the map rather than beside
it. Three changes, and they are one change:

An AI node's outputs feed the AI nodes downstream of it, with no promote step:
whatever the latest run wrote to `outputs/` is an input to any neighbour that
already collects that node by the proximity rule. "Ask a follow-up" makes the
next step in one press — a child AI node on a directed edge, focused with an
empty prompt and the caret in it, and a Back crumb to the node you came from.
And a run that prints a named number reports it as a quantity, so the node
becomes a definer of `R_{th}` and milestone 09 draws the arrow to whoever's
equation uses it.

The end state is a chain of small nodes, each with its own prompt, its own
script and its own figures, each spot-checkable on its own, joined by edges that
say which way the data went — and quantities flowing across the same map by the
mechanism that was already there.

## Why now

The first weeks of real use found the same three walls, and the owner named
them:

**Exploration overwrites itself.** A node keeps three runs, shows the outputs of
the latest, and refreshes promoted nodes in place. That is right for "run it
again on new data" and wrong for "now try it the other way": every follow-up
destroys the last answer's plots. The reader who wants both has to promote
everything first, and promoting is not what they were thinking about.

**A conversation with the AI has no home.** The prompt is a spec, deliberately
(milestone 14, "The prompt is a spec, not a chat"). Change mode gives one turn
of continuity — this script, edited. A second thought is a new node, which means
promoting a CSV, making a node, drawing an edge, and retyping the context.

**Chaining costs too many gestures.** Three deliberate acts to do what the map
already looks like it can do.

A global chat was considered and rejected. It would answer all three and cost
the thing the app is for: the map would become a side effect of a transcript
rather than the record itself. What the owner asked for instead is the map doing
the work — nodes, edges and tags breaking an analysis into steps a human can
check one at a time — and a LaTeX view of the data flowing between them. This
milestone is that, built on machinery that already exists in both halves: the
proximity rule and the run record on one side, quantity inference and derived
edges on the other.

## The shape, and the decisions behind it

**Outputs are data, so they flow like data.** The latest done run's outputs are
that node's files for the purpose of collecting inputs. No new rule about who
sees them: the existing proximity rule decides (incoming or undirected edge, one
hop), so a node reads its parent's figures for exactly the same reason it reads
its parent's CSVs. Latest run only — a run's outputs are the node's current
answer, and offering three generations of `drift.png` to a script would make the
filename meaningless. Promote does not go away and does not change meaning: it
is how a plot gets onto the canvas for a person to look at, not how it reaches
the next script.

**A follow-up is a node, and making one is a single press.** The workbench gains
one control. It creates a node carrying `!ai`, joins it to the parent with a
directed edge, focuses it, and leaves the caret in an empty prompt with a Back
crumb pointing at the parent. Everything after the first press is typing. The
mechanism is the one Define already uses — commit, push a nav entry, fit the
camera, hand over the caret — with the difference that a follow-up enters focus
on the new node rather than dropping to the canvas, because a prompt is written
in the workbench and a title is not.

**The child starts from the parent's script.** A child has no script of its own,
so its default mode is Change against the parent's: "here is what was done, do
this to it". That is the continuity the prompt-as-spec model gave up, put back
where it belongs — in the script, which was always the artifact. Write is
offered for a follow-up that is a different question rather than a next step;
Run is not offered until the child has run once, because there is nothing of its
own to run.

**Context is the ancestors' prose, capped.** A request carries a
"conversation so far" section built by walking incoming edges from AI node to AI
node, up to three hops. Each ancestor contributes its prompt and the summary of
its latest done run; only the direct parent contributes its script. This is
prose in the user message, separate from the file inputs, and it is subject to a
byte cap in `APP_CONFIG` that drops the farthest ancestors first. The workbench's
"What Claude will see" disclosure shows it verbatim, because the milestone 14
promise — everything that leaves the machine is inspectable before it leaves —
is not something a new section gets an exemption from. The one-hop rule for
_data_ is unchanged: three hops of prose, one hop of files.

**A named result is a quantity.** The system prompt asks Claude to print any
named numeric result on its own line as `RESULT <symbol> = <value> [unit]`, the
symbol in LaTeX. The run loop reads those lines out of the final execution's
stdout and the finished run stores them. The node renders them as display math,
and — this is the whole point — the dataflow extractor is taught to read them,
so milestone 09's inference makes the node a definer of `R_{th}` and milestone
11 draws the derived edge to any node whose equation references it. A number
computed from bench data lands in the same notation as a number someone typed,
and the map does not care which is which.

**Results ride on the run, not in the description.** The obvious alternative was
appending the block to `node.description`, where the extractor already looks and
no plumbing is needed. It was rejected: a re-run would then have to find and
replace a region of a plain-text field the reader also edits, which is a parsing
problem and an undo problem at once, and the prose would outlive the run that
justified it — surviving eviction, surviving the add-on being removed, with
nothing left in the document able to explain where a line came from. Results are
a fact about a run, so they are stored on the run, and the extractor gains a
third source beside title and description. The cost is real and accepted: an
older app opening the file keeps the field but draws no arrows from it.

**Values do not flow yet, only names.** A downstream script does not receive
`R_th = 12.3`. Making upstream quantities available to a script — as a JSON file
beside the inputs, most likely — is a later milestone. What this one buys is that
the _structure_ is visible and checkable first, which is the same order
milestones 08 to 11 took: draw the dependency before evaluating it.

## Scope

### Outputs as inputs

- `collectAiInputs` also collects, for each qualifying neighbour that carries
  the `ai` add-on, the outputs of that neighbour's latest done run. They are
  file inputs like any other, with the connecting edge's tag as their label, so
  the request builder, the digest probe and the executor need no new concept.
- A file input says where it came from: an attachment the reader added, or a
  neighbour's run output. The distinction is not persisted — it is recomputed
  from the graph on every collection — and it drives three things: the workbench
  lists run outputs under their node in a group of their own, Add/Replace/Remove
  are absent from those rows, and the digest's first line tells the model the
  file is a produced one.
- Filename collisions get a rule. Two neighbours can each produce `plot.png`,
  and an attachment can be called the same as an output. The name a file takes
  inside the runtime is decided in one place already (`inputFileName.ts`); it
  gains a deterministic disambiguation pass over the whole collected list, so
  every name in a run is unique and the same set of inputs always produces the
  same set of names.
- The AI node's own outputs are not its own inputs. Self is not a neighbour, and
  a promoted output node is an outgoing neighbour and still skipped, so a run
  still cannot feed itself its own figures.

### Ask a follow-up

- One control in the workbench, available once the node has a done run.
- It commits, in one entry labelled `ask a follow-up`: a new node carrying the
  `ai` add-on at its registry default with an empty prompt, titled so the `!ai`
  marker and the add-on agree; a directed, untagged edge from the parent; and a
  position beside the parent, which the layout then settles.
- The new node is not pinned. Define and Promote both leave the nodes they make
  unpinned, an authored edge already puts the child inside the parent's
  neighbourhood, and a pin per follow-up would quietly rewrite what is visible
  after three of them.
- The edge is untagged. An edge tag is the input's _label_ in the request, which
  is a role the reader chose (`@baseline`); stamping every follow-up edge with
  the same word would put a meaningless role on every input the child collects,
  and colour every one of those edges by milestone 04f's rule.
- After the commit the app pushes a nav entry for the node the reader was
  looking at, fits the camera to the child, enters focus on it, and puts the
  caret in the prompt. The trail and the floating Back button are the ones that
  already exist; nothing new renders.

### Ancestor context

- A pure walk from the node along incoming directed edges, AI node to AI node,
  bounded by hops and by a visited set, nearest first. Directed only: an
  undirected edge says two nodes are related, not which came first, and the
  follow-up edge this feature creates is directed.
- Each ancestor contributes its title, its prompt and its latest done run's
  summary. The direct parent also contributes `analysis.py`.
- The rendered section goes in the user message rather than the system prompt,
  so the system prompt stays byte-identical between modes and the cached prefix
  survives a session of Write, Change, Run.
- Two caps in `APP_CONFIG`: the hop limit, and a hard character cap on the whole
  section. Over the cap, summaries are trimmed first and then the farthest
  ancestor is dropped whole, with a line saying how many steps were left out.
- The workbench shows the section as it will be sent, under the same "What
  Claude will see" disclosure the digests use.

### Results as quantities

- A rule in the system prompt asking for `RESULT <symbol> = <value> [unit]`
  lines, one per line, symbol in LaTeX.
- A pure parser over the **full** stdout of the last execution that exited 0 —
  not the tail the request carried, which is capped at `stdoutTailChars` and would silently lose
  results from a chatty script. The parser accepts a conservative symbol
  charset, requires the value to parse as a finite number, truncates the unit,
  and caps how many results one run may report.
- `AiRun` gains an optional `results` field. It is written when the run finishes,
  like the summary and the outputs, and it is evicted with its run.
- A pure renderer turns one result into the LaTeX the node shows and the
  extractor reads, so there is exactly one string and not two that must agree.
- `nodeQuantities` gains a third source beside title and description; the
  quantity indexer feeds it the latest done run's results and includes them in
  its memoisation key. Everything downstream — definer chips, derived edges,
  diagnostics, conflicts — then works with no further change.
- A node whose own text defines the same quantity a different way is milestone
  09's within-node conflict, and reads as one. That is correct: the reader wrote
  one number and the machine measured another, and being told so is the point.

### Save files

- New optional fields only: `AiRun.results`. No new add-on key, no new field on
  `NodeData`, no change to anything required.
- So the schema version and the HTML reader version both stay where milestone 14
  left them. A milestone 14 app opens a milestone 15 document, keeps the field
  through a re-save, and simply draws no arrows from it. If any task turns out to
  need a required field or a second add-on key, the bump rule from milestones 13
  and 14 applies and both versions move together.

## Out of scope

- Injecting upstream quantity _values_ into a downstream script. Names and
  structure first; a later milestone decides how a script receives them.
- A chat thread on a node. The prompt is still a spec; the conversation is the
  chain of nodes.
- Letting the AI create nodes or edges on its own. The follow-up node is created
  by the reader's press, not by the model, and that is the only kind of node this
  milestone lets the AI have.
- Growing a map from notes or from the web. Still a different conversation.
- More than one hop of _files_. Prose reaches three hops back; data does not.
- Naming the follow-up node from its prompt, or from the model's answer. It gets
  a plain title and the reader renames it like any other node.
- Fixing the promoted-output binding hazard in
  `docs/debt/2026-09-04-promoted-output-binding-breaks-when-its-run-is-evicted.md`.
  This milestone reduces how often a reader has to promote in order to chain,
  which reduces exposure to it, but the name-binding through run history is
  untouched and the filed fix still stands.
- Units. A unit is a string that renders; nothing checks it or converts it, and
  the dataflow layer never sees it.

## Hard parts

- **A file input can now change without anyone touching a file.** A parent's
  re-run rewrites the bytes behind the child's inputs. The machinery for saying
  so exists — the run record stores the name each input was sent under, and the
  workbench already computes added, replaced and removed since the stored script
  was written — and the outcomes fall out correctly: the same names over new
  bytes default to Run, a name that appeared or vanished defaults to Change. What
  has to be checked is the wording, which was written for a reader who had just
  pressed Replace and must not now claim they did.
- **Asset lifetime across nodes.** A child reads its parent's outputs live, at
  run time, and holds no reference to them. `recordAiRun` evicts an output asset
  only when nothing in the resulting graph reaches it, and the parent's _latest_
  run is never the one evicted, so the bytes a child needs are always there. A
  child's _historical_ run record can still name an asset that has since gone —
  the same as any file the reader removed — and must read as that rather than as
  damage.
- **Cycles.** Two AI nodes can point at each other. Input collection is one hop
  and cannot loop, but the ancestor walk can, and needs a visited set and a
  deterministic order rather than a recursion that happens not to recurse.
- **Context growth is the cost that creeps.** Three hops of prompts and summaries
  is small until a node has four ancestors with long summaries and the request
  quietly doubles. The cap is a hard character count applied by a pure function
  with a spec, and the preview shows the result, so the number that leaves is the
  number the reader can see.
- **The results parser reads model-authored text.** It runs over stdout, which is
  script output, which is partly whatever the data contained. The symbol charset
  is a small allowlist, the value must be a number, the unit is truncated and
  rendered inside `\text{}`; anything else on the line is ignored. The renderer's
  output is LaTeX that goes to the same engine everything else does, with the
  same caps (`math.maxSizeEm`, `maxExpand`) already in `APP_CONFIG`.
- **The extractor is on the hot path.** The quantity index memoises per node and
  milestone 11 made a point of it: dragging must not rebuild it. Adding a third
  source means adding it to the memo key, and a spec has to hold the line that a
  position change still costs nothing while a recorded run does invalidate.
- **A chain of follow-ups is a chain of nav entries.** The trail keeps eight
  (`NAV_STACK_LIMIT`), which is a lot of follow-ups but not an infinite number;
  past that the oldest is dropped and Back goes one step less far than the reader
  might expect. Accepted, and worth knowing.
- **The child's first request has no script of its own.** Change mode has to take
  the parent's, which means the refine path needs a second instruction — "the
  previous script is from the step before" — and the mode-availability rules need
  to distinguish "has a script" from "can reach one".

## Open questions

All resolved with the owner before drafting. Recorded here so they are not
reopened.

1. Does an AI node's output reach downstream nodes automatically, or only via
   Promote? **Automatically, latest done run only, by the existing proximity
   rule.** Promote keeps its job of putting a figure on the canvas.
   (Resolved 2026-09-07.)
2. How does a reader continue a conversation? **"Ask a follow-up" creates a
   child AI node on a directed edge, focuses it with an empty prompt ready to
   type, and leaves a Back crumb** — the Define-from-deep-zoom mechanism, reused.
   Not a chat thread, and not a global chat: the map stays the record.
   (Resolved 2026-09-07.)
3. What does the child's request know about the parent? **Up to three hops of AI
   ancestors along incoming edges, each contributing its prompt and its latest
   summary, with the direct parent also contributing its script; capped in bytes
   and shown in the request preview.** Data stays at one hop.
   (Resolved 2026-09-07.)
4. What is the child's default mode? **Change, against the parent's script.**
   Write is available; Run is not until the child has a script of its own.
   (Resolved 2026-09-07.)
5. How do numbers get into the map? **`RESULT <symbol> = <value> [unit]` lines
   on stdout, stored on the run, rendered as display math, read by the dataflow
   extractor.** Value injection into downstream scripts is deferred.
   (Resolved 2026-09-07.)
6. Where does the rendered results block live — in the node description, or in a
   field of its own? **A field of its own on the run, with the extractor taught
   to read it.** Decided in the plan; see "Results ride on the run" above for the
   reasoning and the accepted cost. (Resolved 2026-09-07.)
7. Is the follow-up node pinned, and is its edge tagged? **Neither.** Both follow
   the precedent Define and Promote set, and both avoid writing meaning the
   reader did not ask for. (Resolved 2026-09-07.)

Still binding from milestone 14 and not reopened here: Messages API only, called
with a raw `fetch`; the executor is local Pyodide in a worker; the key is never
in graph data; mutations are immutable pure functions with colocated specs;
stories are the behaviour tests; every graph write goes through `commitUserGraph`
with an edit-intent label; the add-on registry in `nodeAddons.ts` stays closed.

## Acceptance criteria

1. Two AI nodes joined by a directed edge: the child's collected inputs include
   the parent's latest run outputs, listed under the parent in the workbench as
   its outputs, with no Replace or Remove on those rows, and the same files
   appear in the request preview with their digests.
2. Re-running the parent so an output's bytes change, then opening the child,
   shows the amber "changed since the last run" line naming that file and
   defaults the child to Run. An output the parent stopped producing defaults it
   to Change and is named as removed.
3. Two neighbours each producing a file of the same name send two distinct
   filenames, and the same collection of inputs produces the same names every
   time.
4. "Ask a follow-up" on a node with a done run creates one child node with the
   `ai` add-on and a directed edge from the parent, enters focus on the child
   with the caret in an empty prompt, and shows a Back crumb naming the parent.
   Back returns to the parent's workbench and the camera the reader left.
5. One Undo after a follow-up removes the child, its add-on and the edge
   together, under the label `ask a follow-up`.
6. The child's mode switch offers Write and Change with Change selected, and does
   not offer Run. Its Change request carries the parent's script and an
   instruction saying it came from the previous step.
7. The request preview for a node three steps into a chain shows a
   "conversation so far" section with its ancestors' prompts and summaries,
   nearest first, and no more than the configured number of characters; a spec
   pins that a chain long enough to exceed the cap drops the farthest ancestor
   and says so.
8. A run whose script prints `RESULT R_{th} = 12.3 K/W` records that result,
   shows `R_{th} = 12.3\ \text{K/W}` as display math on the node, makes the node
   a definer of `R_{th}`, and draws a derived edge to a node whose description
   references `R_{th}`. A run that prints no such line changes nothing.
9. A `RESULT` line whose value is not a number, or whose symbol contains
   anything outside the allowed set, is ignored; a run printing more of them than
   configured keeps the configured number.
10. Results are parsed from the full stdout of the final execution, pinned by a
    spec in which the tail limit would have cut the result off.
11. Dragging a node does not rebuild the quantity index; recording a run with
    results does.
12. A document with follow-up chains, results and cross-node outputs survives
    Download and Open in a fresh profile, with every figure visible and every
    derived edge redrawn. A milestone 14 build opens the same file without
    calling it malformed.
13. Every gate in `AGENTS.md` passes, the offline shell still builds to one file,
    and its size delta is recorded in the plan's notes.
