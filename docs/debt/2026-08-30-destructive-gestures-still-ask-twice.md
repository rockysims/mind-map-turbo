# Destructive gestures still ask for confirmation now that undo exists

**Created:** 2026-08-30
**Area:** `apps/mind-map-sv/src/lib/components/ui/Multigraph/Multigraph.svelte`
(`deleteLegendTag`), `apps/mind-map-sv/src/lib/components/ui/RevertBanner/RevertBanner.svelte`
**Cost if ignored:** Two modal interruptions a session, both paying a tax the
app no longer owes. Deleting a tag from every use blocks on `window.confirm`,
which on a phone is a full-screen system dialog for an edit that is now one tap
away from being undone.

## What we did

Milestone 12 gave every edit a way back, and left both confirmations exactly as
they were: the `window.confirm` in `deleteLegendTag`, and the in-banner confirm
step in `RevertBanner`.

## Why

The confirmations were the price of having no undo, and the undo has not been
used in anger yet. Removing a safety net in the same change that builds its
replacement means that if the replacement has a hole, nothing catches it — and
a `window.confirm` costs a tap, while a lost tag across forty nodes costs an
afternoon. The plan called this out as a deliberate follow-up rather than an
oversight.

## What paying it off looks like

Drop the `window.confirm` from `deleteLegendTag` and let the toolbar's Undo be
the answer, with the status notice naming what just happened ('Undid "delete
tag".'). `RevertBanner`'s confirm is a closer call: reverting still discards
everything since the import, so it may earn its dialog even now — but the
dialog's own copy ("Everything changed since then is lost too") is a promise the
history can now soften, since the revert lands as one entry a redo can walk
back. The check is a story that deletes a used tag with no dialog and undoes it
back, at the phone viewport.
