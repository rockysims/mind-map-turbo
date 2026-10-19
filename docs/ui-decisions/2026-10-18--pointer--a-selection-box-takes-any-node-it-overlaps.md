# A selection box takes any node it overlaps

- Situation: a marquee over large circular nodes of varying on-screen size, deciding which nodes it selects.
- Proposed: a node is selected when its centre is inside the box, so a brushed neighbour is not taken.
- Chosen: a node is selected when its on-screen circle overlaps the box at all. The rule stays a parameter of the pure hit test (`'intersect' | 'center' | 'enclose'`), defaulting to overlap and pinned by its spec.
- Why: no reason given.
- Pattern: none
- Status: ruling
