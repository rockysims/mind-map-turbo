# A large paste asks once, naming the size, and then brings every attachment

- Situation: copying nodes that carry attachments onto the clipboard, and pasting them into a document that may not hold those blobs yet.
- Proposed: embed attachments up to a per-asset cap on copy, skip the rest, and name what was skipped in the notice.
- Chosen: copy embeds every attachment the copied nodes reference, whatever its size. Paste sums the bytes of the embedded attachments this document does not already store; above a threshold it asks once, naming the total ("about 12 MB"), and OK pastes everything regardless of size. A same-document paste adds no bytes and never asks.
- Why: "warn the user on paste how many MB are being added (if above a threshold) but allow the user to ok it and paste anyway (with all the attachments regardless of size)." (owner's words)
- Pattern: status--warn-only-when-you-can-prove-it
- Status: ruling
