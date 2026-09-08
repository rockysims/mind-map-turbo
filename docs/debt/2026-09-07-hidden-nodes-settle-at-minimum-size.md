# A graph read from storage parks its hidden nodes right beside the visible ones

**Created:** 2026-09-07
**Area:** `apps/mind-map-sv/src/lib/components/ui/Multigraph/Multigraph.svelte` (the ingest `$effect`), `apps/mind-map-sv/src/lib/components/ui/Multigraph/lib/graphLayout.ts`
**Cost if ignored:** every reader, on every load — a component's hidden nodes
start far closer to their visible neighbour than they will ever sit again, so
revealing one flings it outward, and several boundary stubs off one node point
at a huddle rather than in the directions their nodes actually lie.

## What we did

The ingest settle lays out the whole graph, hidden nodes included, under the
hop map the canvas will draw from. A hidden node is at `Infinity` hops there,
which `scaleByHops` floors to `minScale` — radius 20px against a beacon's 140 —
and the edge spring rests at a fraction of the radius sum, so it comes to rest
about 250px from a beacon whose own circle is 140px. It is the only moment a
node is laid out at the size it has while hidden: during a session a node that
becomes hidden simply stops participating and keeps the position it settled at
while it was on screen.

The boundary half-edge no longer reads that distance (`edgeRenderPoints` floors
a stub at two radii of the node it leaves), so the visible symptom is paid off.
The positions themselves are not.

## Why

Sizing hidden nodes for the settle changes where every node in every stored
graph lands on load, which is a layout change wearing a bug fix's clothes — far
past the fade this was reported as. The stub floor fixes what the reader sees
and leaves that call to be made deliberately.

## What paying it off looks like

Give the ingest settle a hop map that floors hidden nodes at the outermost
displayed layer rather than at `Infinity`, so they settle at the size they will
have the moment they are revealed. Visible nodes keep their exact sizes, so the
neighbourhood a reader pinned still settles as it does today. It worked if a
freshly loaded graph and the same graph after pinning and unpinning a beacon
place that beacon's neighbours at comparable distances.
