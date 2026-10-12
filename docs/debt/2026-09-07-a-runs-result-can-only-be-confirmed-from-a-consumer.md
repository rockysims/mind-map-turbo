# A quantity that only a run reported has no confirmation chip on the node that reported it

**Created:** 2026-09-07
**Area:** `apps/mind-map-sv/src/lib/components/ui/Multigraph/AiNodeContent.svelte`,
`apps/mind-map-sv/src/lib/components/ui/Multigraph/lib/aiNode.ts` (`aiResultMath`),
the edit sheet's designation suggestions
**Cost if ignored:** a reader whose `RESULT` line is the _only_ statement of a
quantity cannot designate it from the node that measured it, and cannot
designate it at all until some other node references the same symbol.

## What we did

Milestone 15 makes a run's `RESULT R_{th} = 12.3 K/W` a definition: it is stored
on the run, rendered as display math under **Results**, and read by the dataflow
extractor through `derivedMath`. Nothing was added for _confirming_ it as an
output of that node:

- The AI workbench replaces the ordinary details view for a node carrying `!ai`,
  and it draws no designation chips at all — Results is a read-only section.
- The edit sheet builds its designation suggestions from the node's title,
  description and tags, and a result lives in none of the three.

So the only route to confirmation is a _consumer's_ peek card, which offers the
recorded value as the definition with **Label as output** — verified at the
milestone 15 smoke test, and the way the derived edge in that test was drawn. A
measured quantity with no consumer yet on the map has no route at all.

## Why

The results field, the extractor's third source and the follow-up flow were the
milestone; designation is milestone 09's surface and touching it would have
widened the change into a third component's chip model. The consumer-side route
does work end to end, and every result in the smoke test was one another node
already referenced — which is the case the milestone was built for.

## What paying it off looks like

Two candidates, and the owner has not ruled between them:

1. **Auto-confirm on record.** When a run commits results, mark those symbols as
   confirmed outputs of the node in the same write — one addition in
   `aiRunController`, in the commit that already exists. Cheapest, and it matches
   the reading that a script printing a number _is_ the node asserting it; the
   risk is confirming something the reader never looked at.
2. **Render chips in the workbench.** Give the Results section the same
   designation chips the details view has, sourced from `derivedMath`. More
   surface, but it keeps confirmation an act the reader performs.

Either way, the test is: a node whose only statement of `R_{th}` is a recorded
result can be made a confirmed definer of it without a consumer existing first.

**Awaiting the owner's ruling** on which of the two, or neither.
