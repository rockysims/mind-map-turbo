# TODO intake

**Status:** folded into the MindMap MVP roadmap as milestones 04b-04f.

- Remove fibonacci idea in favor of only displaying nodes that are within displayedLayers (10?) hops of a pinned node. The edges to the displayedLayers+1 layer should be shown but fade out half way along to the displayedLayers+1 layer node(s).

- Keep layer by layer layout (or think of a better way to make nodes closer to pinned nodes have more influence on the layout?) but do it in memory only. The visible part should be all the nodes at once animating to their new position. No need to keep the 0.5 opacity thing either since there is nothing to indicate.

- Add a way to save/load a multigraph to/from a .json file. This can be instead of localstorage just to keep things simple except I'd like localstorage to remember the current graph so you can refresh without losing your place.

- When the user adds an edge that already exists, remove the edge (with small confirmation dialog).

- When a new node is created (double-click-drag to background), show an inline
  title input on the node instead of the default "New Node" label — focus it
  immediately so the user can type. Commit on blur / click-away (Enter optional);
  then render plain text like today. Track editing with UI-only state in
  Multigraph (`titleEditNodeId`), extend `Node.svelte` with an editing mode, and
  stop pointer propagation so Stage doesn't start a drag. Unify empty-title
  fallback with the edit sheet `New Node`.

- I'd like to introduce some key words/characters that can be used in the title (they should be shown when editing the title (in either way) but should be edited out of the title when the title is shown in a non editable form).
  - If the very first character in the title is "<" it means the edge should have a direction and it should point from the child to the parent. ">" is the same except from parent to child. if neither "<" or ">" is the first character, default to not having a direction. Direction just means when the edge is displayed there is an arrow on the end being pointed to.
  - Once the "<" or ">" (or neither) has been removed/ignored, look for tags that follow the format :some-tagName_withoutASpaceOrColonCharacter so title ">:abc:xyz :alsoFine The displayed node title part." would mean the new node should have a direction pointing from the parent to the child, it should have the tags ['abc', 'xyz', 'alsoFine'] and since it no longer follows the tags structure after that, the rest is the displayed title.

- Nodes should have a list of tags associated with them (see above) and I'd like to indicate which tags a node has by the color of the border. If there are multiple tags, share the 360 degrees equally among the colors. That also means we need a config (associated with the multipgraph and saved in the json) that maps tags to colors so the user can give their tags a color.

## Roadmap mapping

- `04b-bounded-pinned-neighborhood-visibility.md`: displayed layers, boundary edge fade, and in-memory relayout with one visible animation.
- `04c-json-file-import-export.md`: JSON save/load plus refresh-safe local persistence.
- `04d-edge-toggle-and-inline-node-creation.md`: existing-edge removal confirmation and inline title input for newly created nodes.
- `04e-title-syntax-for-direction-and-tags.md`: editable title syntax, directed edges, parsed display titles, and node tag data.
- `04f-tag-colors-and-graph-tag-config.md`: graph-level tag color config and multi-tag border rendering.

More TODO:

- Eliminate all abruptness:
- - - Scale into and out of existence (or fade into and out of existence if scale doesn't work well such as for edges).
- - Add node & edge / remove edge currently appear instantly.
- - When a node is pinned and, as a result, new nodes appear they currently appear instantly.
- - - SOLUTION?: Imagine a path from the upscaled (pinned) node to the other node in question (one of the dis/appearing nodes due to un/pin). Reveal stuff along that path such that the fraction of the path that is revealed matches the fraction of the rescaling during any given frame. The revealing wave front should have a thickness where the opacity goes from 0 to 1 quickly but not instantly so the reveal wave front is not abrupt.
- - Give new nodes lots of friction when first created (reduce to normal friction over a few seconds). Then make new nodes unpinned by default. Should solve issue where new node moved immediately to new position and the user's eye couldn't follow it.

IMPROVEMENTS:

- If creating a new node and user hits esc, cancel (remove) new node & edge.
- On new node submit (click away / blur / whatever), if title is empty, cancel (remove) new node & edge.
- Add text size control (slider). Wait on this until settings dialog.
- Scale arrow size with node.
- Tabs look like buttons. UI should visually indicate its a tab by giving it a flat bottom and perhaps drawing an outline or adding a background to the contents of the tab.
- Find a more elegant way to view/edit/delete tags (plain text doesn't immediately suggest its tags nor make it visually clear at a glance where one tag starts and another begins).
- Allow tags at the end of the title too when creating a node.
- New, Load, Save, and Settings (no need for delete graph. Note: Load and Save are just new names for import and export). "New" should require confirmation. Settings can be the place to adjust tag colors and it can be a catch all place for future settings (such as how fast node size drops off due to distance from pinned node, font size, border width, etc.).
- Add another edge type for double sided arrow.
- Node/edge create/edit dialog needs a UI overhall.

PROBLEMS:

BUGS:

- Edit dialog background (click to close) has very rounded edges and padding so it doesn't cover the full Stage.
- Pinned node doesn't show description.
- e2e `reload restores graph data and viewState from localStorage without file
import` flakes under a full parallel run: the failure snapshot shows the title
  as `RootRefresh Test Node`, so `editFirstNodeTitle`'s `fill` landed before the
  title input had cleared its initial value. Passes 3/3 in isolation. The helper
  should wait for the field to hold what it typed before moving on.
- e2e `deep zoom nests a node image as a second level and pops back to the node`
  fails: the assertion after the first wheel-in reads `data-zoom-world-scale` as
  1. Confirmed pre-existing on a clean tree at 5517f5c (checked while landing
     milestone 12, which does not touch the zoom path). Still failing at the same
     line after the ZoomWorld subject-sizing fix, and the failure snapshot says
     why: it is reading the wrong world. That first `deltaY: -3000` asks for
     `e^6 ≈ 403x`, far past `maxScale * (1 + preInscribeZoneFraction)`, so
     `descendBoundaryDelta` saturates at 1 and the descend fires on that same
     wheel — the node world unmounts (level 1 freezes) and `.zoom-world.first()`
     is the fresh depth-2 image world, sitting at scale 1. Either the test should
     zoom in with a wheel that does not also saturate the descend zone, or a
     descend should need more than one event's worth of pressure.
- e2e `app.test.ts` "deep zoom nests a node image as a second level and pops back
  to the node" fails at the `data-zoom-world-scale` assertion (line ~784): a wheel
  event over the nested image leaves the world scale at 1. Reproduces on `temp`
  alone in a clean detached worktree, so it predates the settings panel and is not
  a merge artifact. Unknown whether the zoom-world behaviour or the test's
  expectation is the wrong one.
- e2e `app.test.ts` is intermittently flaky around `waitForStoredTitle`: a
  different test times out waiting on localStorage on different runs (seen under
  both 2 workers and `--workers=1`), and each passes in isolation. Smells like
  cross-test storage or webServer contention rather than a product bug.

MAYBE:

- Make power of physics reduce by an order of magnitude for each hop from pinned (instead of layer by layer layout process)?

Planned and executed 2026-10-11 as five standalone plans (all `done`) in
`2026-05-07 mind-map-mvp/plans/` (execute in this order; the first two are
disjoint and may run in parallel):

- `2026-10-11 query tag buttons cycle modes.md` — a Find / Filter tag button
  cycles its token none → `+#tag` → `-#tag` → none (plain `#tag` dropped from
  the cycle the same day), editing the typed query in place; hover previews
  the next click.
- `2026-10-11 excluded elements leave the layout.md` — `-#tag` / `-@tag`
  removes the matches from physics, hops, beacons, occlusion, focus and fit,
  not just from the paint (reverses milestone 05's mask-only ruling).
- `2026-10-11 per-tag edge length and node spacing.md` — a slider per tag in
  the Tag colors legend: edge tags scale edge rest length, node tags scale hop
  repulsion clearance; factors travel with the graph.
- `2026-10-11 node size as border width.md` — optional `sizeBytes` on a node
  (written by scrapers/importers) drawn as border width on a bounded log scale.
- `2026-10-11 border width sources and node weight.md` — a per-graph "Border
  shows" setting picks what border width draws (size, a generic node `weight`
  named by the graph's `weightConfig`, edge count, attachments, description
  length, or nothing); the details view names the weight with the graph's label.

UNSORTED TODO:
open node/edges edit dialog (with edges pre-selected) when trying to add a second edge (instead of current confirm delete dialog)
make status info (to the right of Download button) show part 1 and part 2 on 2 different lines
or better yet find a way to say both parts visually with icons?

folded into 05-filter-find-search.md milestone:
I'd like to be able to show only nodes/edges with/without certain tags and/or phrases
For example: +@edgy +#nodish@link #dialog-#nodal#modal -@edgo Some words in title/description "and a phrase in title/description"
Translates as:
edge tags: edgy, link
node tags: nodish, nodal, modal
the + means edgy tagged edges and nodish tagged nodes should flash (or draw attention in some way TBD)
the - means any node tagged nodal and any edge tagged edgo should be hidden (and hide their edges? TBD)
no + or - prefix means edges tagged link and nodes tagged modal or dialog should be shown in full opacity (and all others faded? TBD)
the non tag related part of the search is saying any nodes with any of the character sequences ['Some','words','in','title/description', 'and a phrase in title/description'] should be show in full opacity (and all others faded? TBD)
seems like filter input text box should open via key combo (with another way in a menu for discoverability) but I'm not sure
it would also be really nice if tags could be color coded as the user types them in
and maybe bounce (scale up and down a little on repeat) the most recent tag/word/phrase added to the search

- When node is unpinned, trigger relayout (currently have to manually drag any node to trigger relayout of newly unpinned node)
- When a graph becomes two disconnected graphs, I'd like the beacon node(s) to be the node/edge adjacent to the removal that severed the graph. It looks weird to remove an edge and have the node in the, now severed, graph disappear.

folded into the 08/09/10 math and dataflow milestones:

- New feature to support latex (math) within node description. Also I want to be able to visualize input variables as coming from nodes (description would include the variable as a latex object) with directed edges that go to other nodes where those variables are used (in latex objects in the node description) and also output latex object(s) in turn to be used in yet other nodes.
  - `08-latex-math-in-node-descriptions.md`: Temml-rendered LaTeX in descriptions, `$`/`$$` syntax, and offline single-file packaging of the math engine.
  - `09-variable-dataflow-layer.md`: inferring definitions and references from the rendered MathML, derived producer-to-consumer edges, on-canvas quantity chips, and unresolved/conflict/cycle diagnostics.
  - `10-dataflow-tracing-and-navigation.md`: tracing a quantity across the graph, upstream/downstream chain walking, jump-to-definition, the quantities panel, and query integration.

- Consider allowing deep zoom to show iframe (with url configured by node) so third party websites can be accessed smoothly via deep zoom

TODO: make long press work too even if its not a mobile device

- Scrape from website after (establishing the pattern)
  Maybe we need a built in AI assistant that can be given a url to scrape from?
  Or a document?
  Need to be able to chat with it a little to tell it what you want and modify the resulting graph until its right

- Add container nodes (basically a group of nodes that sits within a cirlce)
  need to be able to attach to container node
  container node should be a full fledged node in terms of being taggable, having edges, etc.
- Add scale factor to nodes (on top of existing scaling)
  2026-10-11: owner ruled node scale stays reserved for hop distance; a
  per-node number now draws as border width instead (see the two border-width
  plans above and `docs/ui-decisions/2026-10-11--display--border-width-shows-a-chosen-node-number.md`).
  Reopen only if a scale factor separate from that number is still wanted.

- Input notes (repeatedly over time so mind map grows/changes as more input notes/data is added) and visualize the notes in a mind map (via AI) and also have the AI notice and add connections. Should be able to start with a template graph where the super structure (non placeholder nodes) is set and there are specific placeholder nodes for the AI to replace. For example, there might be a structural node for the people involved (with a placeholder node to indicate where/how to add more people and how to shape that info) and another structural node for goals (also with placeholder to establish the pattern/shape).

Later:

- Show image as node background with title over it

from the 2026-08-28 derived-edges review (small math-layer improvements; the
big findings became milestone 11 and two standalone bug-fix tasks):

- Render cache is FIFO, not LRU — a hit should refresh recency (delete+reinsert), or long-lived expressions get evicted while typing fills the cache with dead prefixes. Also `cacheMaxEntries` as a per-call option on a module-global cache means the effective cap is whoever called last.
- Accept `\text{}` subscripts in symbol keys so `T_{\text{max}}` doesn't collapse to `T` (word subscripts are everywhere in physics notes).
- Accept `≔` / `\equiv` as definition operators — those are the symbols people reach for precisely when they mean _definition_, and today only `=` defines.
- Edit-sheet note for "looks like a definition but isn't" (chained equalities, `f(x) = …`, rejected left sides currently fail silently; extraction already knows why). Canvas stays quiet; the note is focus-only.
- `hasDerivedEdges` guard has no production caller — wire it into the save path or drop it.
- Group diagnostics references by node id at compute time (`referencesForNode` is a linear scan per rendered node).

TODO: look into vector embedding search (using transform) so users can search title, description, images (later videos), etc.

TODO: show first image as node background (high value, low lift probably)
TODO: global AI chat that can edit the graph for the user (and, ideally, scrap data from a url or uploaded file)
TODO: try to figure out how to make deep zoom properly sticky so I don't accidently keep overshooting one way or the other
TODO: make sure AI output nodes / promoted nodes in general have meaningful names

from the 2026-10-18 selection and clipboard plan (`2026-05-07 mind-map-mvp/plans/2026-10-18 select nodes and copy paste.md`):

- Paste plain text as a new node: a non-graph clipboard is ignored today; "paste a sentence" could create a node titled with it at the anchor.
- A richer clipboard flavour: the copy is the graph-file JSON (or the HTML form when attachments ride along) as `text/plain`, so pasting into a text editor dumps that; a titles-only `text/plain` beside a custom type would read better outside the app.
- Marquee selection of edges, and dragging a selection into another window, were both left out on purpose.
