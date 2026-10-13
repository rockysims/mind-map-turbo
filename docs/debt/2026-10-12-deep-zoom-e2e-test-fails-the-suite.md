# The deep-zoom e2e test fails on every run, so the e2e suite is never green

**Created:** 2026-10-12
**Area:** `apps/mind-map-sv/e2e/app.test.ts` ("deep zoom nests a node image as a
second level and pops back to the node", line ~743), and the descend rule in
`Multigraph/lib/zoomWorldController.ts` (`descendBoundaryDelta`)
**Cost if ignored:** `pnpm --filter mind-map-sv test:e2e` ends 29 passed, 1
failed on every run, so a real e2e regression is easy to wave through as "the
known failure". It also leaves nested image zoom with no passing end-to-end
coverage.

## What we did

Nothing: the test has been red since at least 2026-08-30 (confirmed failing at
5517f5c and again at 724456e, so it predates the graph-tunables work) and every
change since has shipped around it. `docs/roadmaps/TODO.md` records the symptom
twice, under BUGS.

## Why

It fails at the first assertion after a `deltaY: -3000` wheel, which reads
`data-zoom-world-scale` as 1. The TODO's diagnosis: that wheel asks for roughly
403x, far past `maxScale * (1 + preInscribeZoneFraction)`, so
`descendBoundaryDelta` saturates and the descend fires on the same event. The
node world unmounts and `.zoom-world.first()` is the new depth-2 image world,
still at scale 1. Whether the test's expectation or the descend rule is wrong
was never settled, and neither was in scope for the changes that hit it.

## What paying it off looks like

Decide which side is wrong. Either zoom the node world in with a wheel that does
not also saturate the descend zone, or make a descend need more than one
event's worth of pressure. Then delete this file and the two matching TODO.md
entries in the same commit.
