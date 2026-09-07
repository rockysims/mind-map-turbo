# `Connected` means a key is stored, not that it still works

**Created:** 2026-09-07
**Area:** `apps/mind-map-sv/src/routes/+page.svelte` (`aiConnected`, one boolean
feeding all three indicators), `apps/mind-map-sv/src/lib/components/ui/GraphToolbar/GraphToolbar.svelte`
(the dot), `apps/mind-map-sv/src/lib/components/ui/Multigraph/AiNodeContent.svelte`
(the `Connected · <model>` line)
**Cost if ignored:** A reader whose key was revoked, expired, or spend-capped —
which is exactly what the setup sheet's own advice, a key in its own workspace
with a spending limit, makes likely — is told `Connected · Opus 5` in two
places until a run fails. The status that was put in three places to be
trustworthy is the one that lies, and it lies in the direction that wastes a
run to find out.

## What we did

`aiConnected = (aiSettings.apiKey ?? '') !== ''`. That single boolean drives the
toolbar dot, the workbench's `Connected · <model>` line, and the sheet. The key
is validated once, by `Connect`, with the cheapest Messages call there is — and
never again. Nothing downgrades the indicator when a later run comes back 401,
429, or a spend cap.

The ruling `2026-09-06--status--show-the-connection-in-three-places` is
otherwise satisfied: all three surfaces exist, at the three weights it asked
for. This is about what they are all reading from.

## Why

At Connect time the boolean is true, and it is the only fact the app has
without spending a request to ask again. Re-validating on load would cost a
call per page load for a key that is almost always fine, and polling is worse.
Milestone 14 gave every API edge case a named state in the run record and a
sentence in the workbench, which is where a failure is currently told — the
gap is only that the ambient indicators do not hear about it. Found by the
2026-09-07 UI review.

## What paying it off looks like

Let the run that failed write back to the indicator: an auth or spend failure
sets the key's state to `unverified` (never clears the key — the reader may fix
it upstream and retry), the dot goes amber, and the line reads `Key rejected`
with the sheet one press away. `Connect` sets it back. No new requests, no
polling; the app already learns the truth at the only moment it can, and this
just stops throwing that away. The check is a story where a run fails with a
401 and the toolbar dot and the workbench line both stop saying connected.
