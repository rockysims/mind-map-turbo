# A save in one tab silently remounts the canvas in every other tab of the same graph

**Created:** 2026-09-07
**Area:** `apps/mind-map-sv/src/lib/graphPersistenceController.ts`
(`handleStorageEvent` → `load(..., { externalReload: true })`),
`apps/mind-map-sv/src/routes/+page.svelte` (the `{#key loadedGraphId:graphGeneration}`
around `Multigraph`)
**Cost if ignored:** A reader with the same graph open in two tabs loses their
place without warning: any save in the other tab (including the flush the
page does when it goes hidden, for example behind a file picker) bumps the
generation here, the whole canvas remounts, and an open deep zoom or edit
sheet is gone. Rare, but when it bites it looks like the app blanked itself.

## What we did

Cross-tab reload is deliberate: the draft in storage is the truth and a tab
that fell behind should catch up. Milestone 14's review traced the reported
"everything inside deep zoom went blank" through this path and found it can
only affect the *other* tab, so it was left as it was.

## Why

Reloading by remount is the simplest correct way to take another tab's graph;
milestone 12 built the in-place adopt path (`adoptGraphInPlace`,
`graphRevision`) for imports and restores but did not extend it to storage
events, and doing so touches the controller's generation model.

## What paying it off looks like

Route storage events through the in-place adopt path so the canvas stays
mounted and any open focus surface survives when its node still exists, or at
least tell the reader ("Reloaded from another tab") instead of resetting
silently. The check is a story with two controllers over one storage where a
save in one leaves the other's open focus surface on screen.
