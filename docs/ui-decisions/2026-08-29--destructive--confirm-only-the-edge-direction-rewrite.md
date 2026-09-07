# Confirm only the edge-direction rewrite in a merge

- Situation: a compound edit — merging one node into another — where most of the effect is recoverable and one part is not.
- Proposed: one confirmation for the whole merge, plus an import option that merged nodes sharing a title.
- Chosen: the drop target survives and the dragged node is absorbed, "matching the 'drag a file into a folder' reading"; descriptions concatenate with a blank line between and never ask; only edge-_direction_ rewriting stops, names how many edges it affects, and asks. A merge with no direction conflicts commits immediately with no dialog. Import stays purely additive — the "merge nodes with the same title" checkbox was dropped.
- Why: "Silent direction rewriting is the one genuinely lossy part of a merge, so it is the one part that stops and asks"; concatenation "is ugly but recoverable in the edit sheet, and a merge is a deliberate act, so the reader is already right there." On import: "a merge that fires during an import hides a destructive edit inside an additive one."
- Pattern: destructive--confirm-only-the-lossy-part-and-name-it
- Status: ruling
