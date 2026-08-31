# Reporting back to the user

The user runs several agent sessions at once and switches between them. The
cost of that is not the work — it is re-reading a long report to answer one
question: _does this thread still need me?_ Every session must answer it in the
same place, in the same shape.

## The status footer

End the final message of every turn that did substantive work (implementation,
review, merge, investigation) with exactly this block, as the very last thing
in the message:

```
---
STATUS: done | needs-you | blocked
NEEDS YOU:
1. <action>
2. <action>

MERGE: ready for temp | not ready — <reason> | merged | n/a
```

Each `NEEDS YOU` item goes on its own numbered line. When there are none, write
`NEEDS YOU: nothing` inline. Keep the blank line before `MERGE:` — without it
the last numbered item visually swallows the merge line.

### STATUS

This thread's open business, not the quality of the work:

- `done` — nothing is pending for the user.
- `needs-you` — a decision or action is waiting on them.
- `blocked` — you cannot proceed.

### NEEDS YOU

Only items that require the user. Findings they might enjoy reading, caveats,
follow-up ideas, and "you may want to look at X someday" all stay **above** the
footer. Putting optional reading in `NEEDS YOU` is the failure mode that makes
the whole convention worthless — once the list contains things that can be
ignored, it has to be read carefully, which is what it exists to avoid.

### MERGE

This branch's readiness for `temp`, the shared integration branch:

- `ready for temp` — work is complete and the gates are green.
- `not ready — <reason>` — say what is missing in a few words.
- `merged` — already pushed to `temp` this turn.
- `n/a` — nothing mergeable happened (a question answered, an investigation).

`ready for temp` is a **signal, not an action**. Merging into a shared branch
always waits for the user's explicit go-ahead, every time; see the git rules in
`AGENTS.md`. Report readiness and stop.

## Accuracy over optimism

A footer claiming `done` when something is half-finished is worse than no
footer, because the user stops checking. If gates did not run, if a test is
failing, if part of the task was skipped — that is `needs-you` or `blocked`,
and the reason belongs in the list.

## Asking questions

When you need input, ask everything at once as a single numbered list, with a
recommended default per question wherever you have one, so the user can answer
`1. yes, 2. …` in one message. Questions dribbled across turns cost the user a
context switch each.
