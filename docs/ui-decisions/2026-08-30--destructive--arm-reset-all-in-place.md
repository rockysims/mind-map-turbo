# Arm `Reset all` in place, and name the count it would clear

- Situation: one control that clears work the reader cannot currently see — overrides in a collapsed group, or scrolled off screen.
- Proposed: a modal confirmation dialog.
- Chosen: `Reset all` arms on the first press and names the count it would clear; it disarms on blur and after six seconds, and ignores a second press inside the double-click window. Per-field and per-section resets go straight through. Shipped in `2be0d01` on the settings-panel branch, which is not yet merged into this line, so there is no `Reset all` in the code here.
- Why: "It arms in place rather than behind a modal because the reader is already looking at the thing being reset"; the timeout exists so "a panel left open never holds a destructive button one click away"; the double-click guard prevents "a single gesture the reader never got to read."
- Pattern: destructive--arm-a-wide-reset-in-place-not-in-a-modal
- Status: ruling
