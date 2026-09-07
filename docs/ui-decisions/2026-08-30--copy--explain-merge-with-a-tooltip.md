# Explain `Merge` with a tooltip rather than a longer label

- Situation: menu and toolbar labels short enough to fit but too short to carry their meaning — `Merge` does not say which of the two nodes survives.
- Proposed: spelling the meaning out in the label itself.
- Chosen: keep the label short and give every menu and toolbar button a native `title`. Gesture-arming items describe what to do next; ordinary actions describe what happens.
- Why: "Merge… cannot say which of the two nodes survives without more words than a menu item can carry." Filed as debt in the same change, and still open: "The node action menu is opened by long-press on a phone, where a hover tooltip can never appear — so `Merge`, the label that prompted these tooltips, stays unexplained in exactly the place it is most often used." The explanation must end up reachable by hover, focus and long-press alike, or live as a description line inside the menu.
- Pattern: copy--explain-a-short-label-where-hover-cannot-reach
- Status: open
