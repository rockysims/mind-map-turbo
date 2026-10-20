# An edge the cut line would take goes dotted and keeps its colour

- Situation: showing, while the "Cut edges" line moves, which edges it would delete.
- Proposed: paint the targeted edges in the cut gesture's red, dashed, so line and targets read as one.
- Chosen: a targeted edge keeps its own colour — its tag colours, its spotlight — and becomes a dotted line; its arrowhead keeps its colour too. The cut line itself stays red and dashed. The breaks in the edge are the signal: part of the line is already gone, which points at the rest going.
- Why: "instead of indicating with a color lets make them dotted lines. That way we keep the tag color and breaks in the edge line help indicate the edge line is being targeted for removal (because some of the line is being removed it points to more of it being removed)." (owner's words)
- Pattern: a11y--never-let-colour-carry-meaning-alone
- Status: ruling
