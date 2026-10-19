# A paste into the same document reconnects the copies to their outside neighbours

- Situation: copying a subset of nodes whose edges reach nodes outside the subset, then pasting into the same document.
- Proposed: the induced subgraph only — the copied nodes and the edges among them; every edge that left the subset is dropped.
- Chosen: the copy also carries the edges that cross the subset's boundary. A paste into the document the copy came from recreates each one between the pasted copy and the original outside node, keeping its direction and tags, so A→B→C with B and C copied and pasted yields A→b→c beside A→B→C. A paste into another document, or one whose outside node is gone, drops those edges; node ids repeat across documents, so an outside id is only trusted where it was minted.
- Why: "lets make a pasted copy include the edges connecting the copies subset of nodes to non-selected nodes. So for example if we have A->B->C and then I copy B and C and then paste B and C, not only should the edge from B to C be copied but also from A to B so we end up with A->B->C and also A->b->c." (owner's words)
- Pattern: none
- Status: ruling
