# Key the edit sheet's reset on the node id, not the node object

- Situation: a sheet that seeds its fields from a prop object, sitting next to controls that commit to that object immediately.
- Proposed: resetting the drafts whenever the prop object's identity changes.
- Chosen (filed as debt, not yet shipped): key the reset on the object's _id_, or on the sheet opening.
- Why: "A reader who has typed into the title or description and then toggles Pin, adds or removes an attachment, or flips an add-on loses the draft: the field snaps back to the saved value."
- Pattern: editing--do-not-discard-drafts-when-the-object-commits
- Status: open
