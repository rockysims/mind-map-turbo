# A follow-up takes the pin from its parent

- Situation: a node created from another node, where the visibility budget is anchored on pinned nodes and the reader's attention moves to the new one.
- Proposed: leave the new node unpinned, the way Define and Promote do.
- Chosen: the creating commit transfers the pin. A pinned parent is unpinned and the child pinned; an unpinned parent's child is unpinned. One Undo restores both.
- Why: "If parent is pinned, unpin parent and pin child (so basically follow up transfers pin to follow up)." (owner's words)
- Pattern: layout--no matching library entry.
- Status: ruling
