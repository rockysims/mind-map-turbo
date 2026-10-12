# Node weight is edited in the sheet

- Situation: a node's `weight` (what border width draws when the graph's border source is Node weight) could only come from an importer. The node edit sheet had no way to set or change it.
- Proposed: keep weight import-only, as the border width sources plan scoped it.
- Chosen: the edit sheet has a numeric Weight field after Node tags, labelled with the graph's `weightConfig` label and unit (else "Weight"), with a one-line hint saying when it is drawn. Done saves it with the other drafted fields in one commit. A blank field removes the weight, 0 is a real weight, a negative clamps to 0, and text the field cannot read keeps the stored weight. The graph's label and unit stay import-only.
- Why: owner ruling, 2026-10-12: "I'm not seeing a way to edit node weight (border width) via the node Edit dialog; it should be editable there."
- Pattern: none
- Status: ruling
