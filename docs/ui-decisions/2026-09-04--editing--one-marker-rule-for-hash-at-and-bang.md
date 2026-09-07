# One marker rule for `#`, `@` and `!` in a title

- Situation: a third title marker (`!` for add-ons) joining two that already had parsing rules.
- Proposed: a marker rule of its own for `!`, with its own position and count restrictions.
- Chosen: "Same as `#` and `@`: the direction prefix and all three markers are consumed from the front in any order and count, may abut, and a name ends at whitespace or the next marker." An unregistered `!name` ends the run and stays in the title with everything after it. The edit sheet's title field parses `#` and `!` additively, while `@` and the direction prefix stay as typed because the sheet has no created edge to apply them to.
- Why: "One rule to learn and one parser loop; the cost is that a tag name cannot contain `!`, which it already cannot for the other two." Decided by the user 2026-09-04 — `!task #nodish @edgish !ai Test` reads as title "Test" with the rest special.
- Pattern: editing--accept-what-the-reader-types-validate-after
- Status: ruling
