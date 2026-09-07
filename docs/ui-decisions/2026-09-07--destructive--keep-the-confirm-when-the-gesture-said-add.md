# Keep the confirm when the gesture that reached it said "add"

- Situation: a gesture named for what it usually does — draw an edge between two nodes — landing on the one state where it would do the opposite and remove the edge that is already there. Every destructive action shipped since undo landed has dropped its dialog.
- Proposed: drop this one too, remove the edge on the gesture, and let Undo carry it like the rest.
- Chosen: `DuplicateEdgeDialog` stays. The gesture still stops and asks before removing an existing edge.
- Why: "deleting edge after saying add edge would be confusing", and "this will later allow multiple edges between the same 2 nodes so dialog will change and grow later." (owner's words, 2026-09-07)
- Pattern: destructive--prefer-undo-to-confirmation — this is a deliberate exception to it, on two grounds the pattern does not cover: the confirm is not buying safety here so much as resolving an ambiguity the gesture itself created, and the dialog is a seat being kept warm for the choice it grows into once parallel edges are creatable from the UI. A confirm that exists to ask "which of these did you mean" is not the tax the pattern is written against.
- Status: ruling
