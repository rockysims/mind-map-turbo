# Pinned nodes share the node border width

- Situation: pinned nodes drew their border from a separate Advanced setting, "Pinned node border width" (`multigraph.pinnedNodeBorderWidthPx`), shipped at the same 8 px as "Node border width". Dragging the Basic "Node border width" slider therefore moved every node except the pinned ones, which read as a bug.
- Proposed: keep both widths and make the basic slider drive both; or keep both and promote the pinned one to Basic.
- Chosen: drop the pinned width. Every node, pinned or not, draws "Node border width" times its border-weight factor. A pin is shown by the darker border colour and the white halo only.
- Why: owner ruling, 2026-10-12. The colour and halo already distinguish a pinned node, so a second width added a setting without adding meaning, and it is what broke the basic slider. Old saved overrides of the pinned width are dropped as unknown settings.
- Pattern: none
- Status: ruling
