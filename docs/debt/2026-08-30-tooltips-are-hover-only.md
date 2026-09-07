# Button tooltips are hover-only, so touch and keyboard users never see them

**Created:** 2026-08-30
**Area:** `apps/mind-map-sv/src/lib/components/ui/Multigraph/NodeActionMenu.svelte`,
`apps/mind-map-sv/src/lib/components/ui/GraphToolbar/GraphToolbar.svelte`,
`apps/mind-map-sv/src/lib/components/ui/Multigraph/AiNodeContent.svelte`
**Cost if ignored:** The people most likely to need the explanation are the
least likely to get it. The node action menu is opened by long-press on a
phone, where a hover tooltip can never appear — so `Merge`, the label that
prompted these tooltips because it does not explain itself, stays unexplained
in exactly the place it is most often used.

## What we did

Every button in the node action menu and the graph toolbar carries a native
`title` attribute. Browsers show that on mouse hover only: nothing on touch,
and nothing on keyboard focus in most browsers.

2026-09-06: the AI workbench's Promote control became an icon (`⤴`) with an
`aria-label` and a `title`, which puts one more explanation behind the same
hover. A screen reader still hears the label; a phone reader gets the glyph
and nothing else. The same payoff below covers it — a tooltip that reaches
focus and long-press would serve this button and the menu at once.

## Why

`title` is one attribute per button, needs no new component, no positioning or
dismissal logic, and no accessibility wiring — the browser exposes it as the
button's accessible description, which is the correct semantics. The repo
already used it for the same purpose in `NavBreadcrumbs.svelte`. A real
tooltip is a component with its own state, placement, and dismissal rules, and
the labels needed explaining before that was worth building.

## What paying it off looks like

A hint that reaches touch and keyboard: a tooltip component triggered by hover,
focus, and long-press alike, or a description line inside the menu itself
(which would suit a menu whose items are already stacked). The check is that
the explanation for `Merge` is reachable on a phone, without a mouse — assert
it in a story played at the phone viewport, alongside the hover case.
