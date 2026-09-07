# Mark scrollers so the zoom yields the wheel

- Situation: a scrollable panel living inside the zoom/pan world, which owns the wheel.
- Proposed: no scroll container in the overlay at all, which left tall content permanently unreachable below the frame.
- Chosen: scrollers carry `data-zoom-scroll`; the zoom world yields the wheel while that element still has room to scroll in that direction and takes it back at the ends. Leaving at the outward end needs a quiet pause and twice the usual scrub, and any scroll resets an exit in flight.
- Why: "momentum cannot carry a reader out" — without the pause and the doubled threshold, flick-scrolling to the bottom of a panel ejects you from the view; a wheel-out at the top still exits focus.
- Pattern: pointer--give-the-wheel-and-the-scroll-back-to-scrollers
- Status: ruling
