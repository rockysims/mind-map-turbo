# Name what is at risk in each `New graph` prompt

- Situation: one action reachable from several document states, some holding work that is not durably kept and some clean.
- Proposed: one generic "Are you sure?" for every state.
- Chosen: copy per state — `This graph has changes that have not been downloaded. Start a new graph anyway?` / `Recovered local edits have not been downloaded. Start a new graph anyway?` / `This graph has changes since the last Download. Start a new graph anyway?` — and no prompt at all from a clean state.
- Why: the change's own specs state the rule — it "prompts for New graph only when changes have not been downloaded" and "uses status-specific New graph confirmation copy". A prompt that does not name the thing at risk cannot be answered, and a state with nothing at risk should not cost a click. (from the change itself; the commit body is empty)
- Pattern: destructive--confirm-only-the-lossy-part-and-name-it
- Status: ruling
