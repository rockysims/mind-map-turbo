# Mark scrollers so the zoom yields the wheel

- Situation: a scrollable panel living inside the zoom/pan world, which owns the wheel.
- Proposed: no scroll container in the overlay at all, which left tall content permanently unreachable below the frame.
- Chosen: scrollers carry `data-zoom-scroll`; the world yields the wheel while that element still has room in that direction. At either end the world takes the wheel back and does nothing. Once the reader is inside a scrollable surface the wheel never leaves deep zoom — Close or Escape leaves. A descendable image under the cursor is the one exception and still zooms.
- Why: "a wheel at the end of a scroll is the end of a scroll, not a request to close what you are reading." An earlier version guarded the exit with a timed pause and a resistance factor; both were tuning knobs on a gesture the reader never wanted, and were removed rather than tuned.
- Pattern: pointer--give-the-wheel-and-the-scroll-back-to-scrollers
- Status: ruling
