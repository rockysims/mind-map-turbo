# Find / Filter tag buttons are smaller than a 44px touch target

**Created:** 2026-10-11
**Area:** `apps/mind-map-sv/src/lib/components/ui/Multigraph/GraphQueryPanel.svelte`
(the shared `button` rule and `.tag-list button`)
**Cost if ignored:** Phone users mis-tap tags in the panel's bottom sheet. Now
that each tap cycles a tag's token rather than appending one, a missed tap
lands on the neighbouring tag and advances _its_ mode — a quiet change to the
query that the user has to notice and walk back round the cycle.

## What we did

The tag buttons inherit the panel's pill `button` rule — `0.45rem` vertical
padding around one line of text — which puts them under the 44px touch-target
floor. The 2026-10-11 plan that made them cycle their tokens
(`docs/roadmaps/2026-05-07 mind-map-mvp/plans/2026-10-11 query tag buttons cycle modes.md`,
T03) noticed this and left the sizing as it was.

## Why

The size is pre-existing and shared with the panel's other buttons; the plan
changed what a tap does, not the panel's layout. Growing the buttons is a
density decision for the bottom sheet (milestone 05 already flags mobile
density as a risk) that deserves its own look rather than a drive-by.

## What paying it off looks like

Give `.tag-list button` (and any other panel button under the floor) a
`min-height` of 44px, or an invisible hit area that reaches it, without letting
the bottom sheet cover the graph for a simple query. Verify in a
`GraphQueryPanel.stories.svelte` story at the phone viewport that each tag
button's bounding box is at least 44px tall.
