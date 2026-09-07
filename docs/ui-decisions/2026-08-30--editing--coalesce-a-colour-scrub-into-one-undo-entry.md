# Coalesce a colour scrub into one undo entry

- Situation: deciding what counts as one undo entry across controls that commit at very different rates.
- Proposed: one entry per commit, which would have buried a graph edit under dozens of `oninput` commits from a single colour drag.
- Chosen: every graph commit names an intent — the label the control says, the canvas state a restore must put back, and a coalesce key that folds a colour scrub's `oninput` commits into one entry while the canvas still previews live. Designation-chip taps stay one entry per tap. A restore puts back the document and the pin and beacon pointers; open overlays, animation buffers and nav crumbs are deliberately not resurrected.
- Why: "the cycle is at most two taps in either direction, so undo mirrors what the thumb did, and predictability beats cleverness there." And: "Undo is for the document, not for replaying the session."
- Pattern: editing--match-undo-granularity-to-what-the-hand-did
- Status: ruling
