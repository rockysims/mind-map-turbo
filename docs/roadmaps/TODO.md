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
