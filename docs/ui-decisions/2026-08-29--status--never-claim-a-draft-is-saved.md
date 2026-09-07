# Never claim a draft is saved, and survive storage being blocked

- Situation: browsers that block site data throw from the `localStorage` getter itself, and a UI that inferred "saved" from whether the graph was dirty.
- Proposed: aborting startup (which left a blank page), and inferring saved-ness from dirtiness.
- Chosen: resolve storage up front, fall back to tab-lifetime memory storage with a standing warning, and derive `saved` from the fingerprint storage last _accepted_. Unsaved dirty states warn assertively, a pending save reads as `Saving…`, and leaving with work that is not durably held asks before unload.
- Why: the getter itself throwing "used to abort startup and leave a blank page"; saved-ness is a fact about what storage accepted, not a guess from local state. (from the commit body)
- Pattern: status--never-claim-work-is-saved-when-it-is-not
- Status: ruling
