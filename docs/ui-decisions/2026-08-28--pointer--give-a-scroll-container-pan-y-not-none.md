# Give a scroll container `pan-y`, not `none`

- Situation: an app that sets `touch-action: none` to protect its own canvas gestures, with a scrollable sheet inside it.
- Proposed: blanket `touch-action: none` — the node edit sheet and its tabs could not be scrolled by finger at all, so every field below the fold was unreachable on a phone, "and the taller the node the worse it got."
- Chosen: overlays that must swallow the gesture whole keep `none`, backdrop included; any container that is itself `overflow: auto` gets `pan-y`, returning the one gesture it wants while horizontal pan and pinch stay disabled.
- Why: "`none` is right for the overlays around it… It is wrong for a scroll container, which this is and those are not." The story asserts the _computed_ `touch-action`, because synthetic PointerEvents never exercise the browser's own gesture handling — "a scroll assertion would pass with the bug still in place."
- Pattern: pointer--give-the-wheel-and-the-scroll-back-to-scrollers
- Status: ruling
