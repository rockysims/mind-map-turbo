# Warn only about a newer version we can actually read

- Situation: detecting that a document was written by a newer build of the app than the one opening it.
- Proposed: warning whenever the stamps do not match.
- Chosen: only the newer-than-us direction warns. A document from before the stamp existed, a dev build on either side, and an unreadable stamp all stay silent rather than guess.
- Why: "a wrong 'newer' is worse than none."
- Pattern: status--warn-only-when-you-can-prove-it
- Status: ruling
