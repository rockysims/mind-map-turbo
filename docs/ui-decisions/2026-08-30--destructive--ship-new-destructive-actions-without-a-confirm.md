# Ship new destructive actions without a confirm, and take the old ones out later

- Situation: a codebase that has just gained general undo while older `window.confirm` gates are still in place.
- Proposed: removing the existing confirmations in the same change that landed undo.
- Chosen: features shipped after undo skip the confirm — "Removing an add-on that holds data. **No confirm.** … the removal is one history entry with a label ('remove task add-on') and Undo is the safety net." The pre-existing confirmations were deliberately left alone and filed as debt, still unpaid.
- Why: "Removing a safety net in the same change that builds its replacement means that if the replacement has a hole, nothing catches it — and a `window.confirm` costs a tap, while a lost tag across forty nodes costs an afternoon."
- Pattern: destructive--prefer-undo-to-confirmation
- Status: open
