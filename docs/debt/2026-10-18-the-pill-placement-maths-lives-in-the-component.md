# The menu pill's placement maths lives in the component, not a pure module

**Created:** 2026-10-18
**Area:** `apps/mind-map-sv/src/lib/components/ui/Multigraph/ActionMenuPill.svelte`
(`nudgeIntoViewport`)
**Cost if ignored:** the one piece of real geometry in the menus has no spec of
its own; it is checked only through browser stories, which are slower and
coarser than a table of inputs and expected nudges.

## What we did

T07 wrote `nudgeIntoViewport(anchor, size)` inside the pill because `lib/` was
outside its file list. The function is already pure (it reads `window.innerWidth`
and `innerHeight`, which can be passed in).

## Why

The task was scoped to the component so it could run alongside the wave-1
work without touching shared files.

## What paying it off looks like

Move it to `lib/menuPlacement.ts` taking the viewport size as a parameter, with
a spec covering the three cases (fits, slides sideways, drops below the press,
plus wider-than-viewport centring). The stories keep asserting the rendered
result.
