# Border width shows a node number the graph chooses

- Situation: the node-size plan drew `sizeBytes` as border thickness, hard-wired. Other graphs rank their nodes by other numbers (word count, importance, citations, how connected a node is), and an importer has no way to say which one matters.
- Proposed: keep border width tied to bytes; or carry the number on node scale instead.
- Chosen: border width shows one number per node, and **each graph chooses which** with a "Border shows" setting in the settings panel: **Size** (the default, so existing graphs draw as before), **Node weight** (a generic `weight` an importer writes), **Edge count**, **Attachments**, **Description length**, or **Nothing**. Every source shares the same bounded log curve and has its own reference value. **Node scale stays reserved for hop distance** from the pinned nodes. The details view names the weight with the graph's own label from `weightConfig` ("Word count 4,200", "Mass 12.5 kg"), and falls back to "Weight". The option labels stay static: "Node weight" does not take the graph's label.
- Why: owner ruling, 2026-10-11: "a source selector with a few computed sources plus a generic weight". Scale already means distance from the pinned nodes, and giving it a second meaning would muddy both (the reason the node-size plan recorded). Border width leaves layout, hit testing and physics untouched. What a border means is a property of the graph, so the choice is a per-graph setting that travels with the file rather than graph data.
- Pattern: none
- Status: ruling
