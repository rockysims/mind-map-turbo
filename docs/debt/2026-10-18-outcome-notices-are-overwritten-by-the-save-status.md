# Outcome notices are overwritten by the save status half a second later

**Created:** 2026-10-18
**Area:** `apps/mind-map-sv/src/lib/graphPersistenceController.ts` (`reportNotice`,
`reportBlockedAction`, the save scheduler's status updates),
`apps/mind-map-sv/src/lib/components/ui/GraphToolbar/GraphToolbar.svelte`
**Cost if ignored:** every notice that follows an edit — "Pasted 3 nodes.",
"Deleted 3 nodes.", "Cut 1 node.", "Undid …" — is readable for about 500 ms
before "Caching draft…" and then "Draft cached in this browser." replace it.
The reader who looked away for a moment never learns what just happened, which
is the whole reason the notice exists.

## What we did

The selection work (T05, T06 of the 2026-10-18 plan) posts its outcomes
through the toolbar's single sticky notice, which is also where the save
scheduler writes its status. A commit schedules a save, the save reports
"Caching draft…" and then the cached line, and each write replaces whatever
the notice held. Measured in the dev app during T06's smoke test.

## Why

The notice line predates outcome notices: it was built to show the document's
save state, which is critical status and rightly persistent. The copy-and-paste
plan reused it rather than adding a second surface, and the overwrite only
became visible once an edit and a notice landed in the same half-second.

## What paying it off looks like

Either two slots (an outcome line that survives a save-status update for a few
seconds, with the save state beside it) or a rule that a save-status update
does not replace an outcome notice younger than N seconds. The check is a story
that pastes with the real `PersistedGraphHarness` and still reads "Pasted 3
nodes." after the draft-cached status has been written.
