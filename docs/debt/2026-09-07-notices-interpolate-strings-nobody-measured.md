# Notices measure their fixed words and then interpolate ones nobody measured

**Created:** 2026-09-07
**Area:** `apps/mind-map-sv/src/lib/graphPersistenceController.ts` (`statusToNotice`,
and the import notice around line 786), `apps/mind-map-sv/src/lib/components/ui/GraphToolbar/GraphToolbar.svelte`
(`.notice-line`, in the fixed `12rem` column)
**Cost if ignored:** A reader who names a graph `2026-09-07 bench sweep, third
attempt` sees the toolbar's fixed column grow or the text spill out of it. It
bites hardest on a phone, where the toolbar has the least room to give, and on
the notice that matters most — a storage failure, whose message comes from the
browser and can be a paragraph.

## What we did

The fixed strings in the toolbar are genuinely measured against the column:
`buildInfo.ts` records the newer-app warning at "157px and 172px against its
184px widest existing line", and `documentStatus.ts` notes its sentences are
written to fit about thirty characters. That discipline is real, and it is the
whole of the ruling `2026-08-30--copy--measure-the-notice-string-before-writing-it`.

Four notices then interpolate a value nobody can measure, with no cap and no
truncation: `Loaded "${status.graphId}"`, `Saved ${status.filename}. Check your
downloads.`, `Could not cache draft. ${status.message}` (raw text from the
storage layer), and `Imported into "${graphId}"`. `.notice-line` sets
`white-space: normal`, so ordinary prose wraps and grows the column; a long
unbroken token — a filename with no spaces — has nothing to wrap on and spills
past it.

## Why

Every one of those interpolations is the notice doing its job: a save that
confirms by naming the file it wrote is the point of
`2026-08-29--copy--saved-is-the-file-cached-is-the-browser-copy`, and a storage
error that hides the browser's own words is worse than a wide one. The lengths
that reach them are the reader's, not ours, and the fixed-copy measurements
were the part the ruling was actually about. Found by the 2026-09-07 UI review.

## What paying it off looks like

One helper the interpolating notices share — middle-truncate a name to a
measured budget (`bench sweep, third…mpt.json`), clamp a foreign error string
to its first sentence — plus `overflow-wrap: anywhere` on `.notice-line` so an
unbroken token can never spill even when the budget is wrong. The check is a
story at the phone viewport with a fifty-character graph name and a
paragraph-long storage error, asserting the toolbar's width is unchanged from
the same story with short ones.
