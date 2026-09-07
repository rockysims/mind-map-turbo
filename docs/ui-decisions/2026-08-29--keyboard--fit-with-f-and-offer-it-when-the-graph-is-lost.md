# Fit with `F`, and offer it on screen when the graph is lost

- Situation: pointer-anchored zoom lets the reader zoom into empty space until no node is on screen, with no way back short of a reload.
- Proposed: `Escape`, or `Space`, as the fit key — and a bare shortcut as the whole answer.
- Chosen: `F` fits the visible graph, guarded so it cannot fire while text is being typed. A `graphIsLost` predicate also puts a hint in the middle of the empty canvas naming the key, as a real button for anyone holding a pointer. An empty graph is deliberately never "lost".
- Why: "Escape already belongs to the focus overlay, and Space is a poor canvas key: the browser scrolls with it and any focused button swallows it." And: "A bare-key shortcut nobody has been told about is not an affordance, so `graphIsLost` drives a second one that costs nothing while things are fine."
- Pattern: keyboard--advertise-the-gesture-where-the-gesture-works
- Status: ruling
