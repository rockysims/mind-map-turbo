# Compose a follow-up where you are, and commit on submit

- Situation: a control creates a new node that the reader then has to fill in, and the app moves them to it.
- Proposed: one press creates the empty node, focuses it and puts the caret in its prompt; typing happens on the new node.
- Chosen: the press opens a composer on the node the reader is already on; nothing is created while they type, Cancel or Escape discards it, and only submit creates the node, with the prompt already set, and moves them there.
- Why: "Lets have the user compose the follow up prompt from the original !ai node and only when they click submit (or w/e) does it create the new node and move them there." (owner's words)
- Pattern: editing--no matching library entry; closest is destructive--prefer-undo-over-confirmation, which this respects by never creating something to undo until the reader commits.
- Status: ruling
