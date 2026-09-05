# The edit sheet drops half-typed text whenever the canvas commits underneath it

**Created:** 2026-09-04
**Area:** `apps/mind-map-sv/src/lib/components/ui/Multigraph/NodeEditSheet.svelte`
(the `$effect` that seeds `title`, `description` and `nodeTags` from the
`node` prop)
**Cost if ignored:** A reader who has typed into the title or description and
then toggles Pin, adds or removes an attachment, or flips an add-on loses the
draft: the field snaps back to the saved value. It bites more now that the
sheet has three immediate controls beside the text fields.

## What we did

The seeding effect depends on the `node` prop object. Every immediate commit
from the sheet (Pin, attachment add/move/remove, add-on toggle) replaces that
object, so the effect re-runs and overwrites the drafts. Milestone 13's T03
added the add-on toggles to that set knowingly; the behaviour predates it.

## Why

Keying the reset on `node.id` instead of the object is the obvious fix, but
the effect also owns the sheet's focus and caret behaviour, which is carefully
documented in place, and T03 was already the milestone's widest task. Widening
it into that effect was the wrong trade for a bug that already existed.

## What paying it off looks like

Seed the drafts only when `node.id` changes (or when the sheet opens), keep
the focus/caret handling as it is, and add a story that types into the title,
toggles the task add-on, and asserts the typed text survived. Check Pin and
attachment removal in the same story.
