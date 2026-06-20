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
- Add text size control (slider).
- Scale arrow size with node.
- Tabs look like buttons. UI should visually indicate its a tab by giving it a flat bottom and perhaps drawing an outline or adding a background to the contents of the tab.
- Find a more elegant way to view/edit/delete tags (plain text doesn't immediately suggest its tags nor make it visually clear at a glance where one tag starts and another begins).
- Allow tags at the end of the title too when creating a node.
- New, Load, Save, and Settings (no need for delete graph. Note: Load and Save are just new names for import and export). "New" should require confirmation. Settings can be the place to adjust tag colors and it can be a catch all place for future settings (such as how fast node size drops off due to distance from pinned node, font size, border width, etc.).
- Add another edge type for double sided arrow.

PROBLEMS:

- When a graph is disconnected from all pinned nodes, it is invisible (no way to interact).

BUGS:

- Edit dialog background (click to close) has very rounded edges and padding so it doesn't cover the full Stage.

MAYBE:

- Make power of physics reduce by an order of magnitude for each hop from pinned (instead of layer by layer layout process)?
