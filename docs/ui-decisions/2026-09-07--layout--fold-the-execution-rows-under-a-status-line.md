# Fold the execution rows under a status line

- Situation: a long-running action produces a row per step, each with a page of captured output, and the rows sit above the results the reader came for.
- Proposed: the rows stay open because they are what a reader acts on; only the prose folds away.
- Chosen: the rows fold too, under a closed disclosure whose one line names the latest step, how it ended, and the last line it printed. Errors and the traceback stay outside the fold.
- Why: "The analysis.py stuff is taking up a lot of scroll space. Lets put them in an expandable or something." (owner's words)
- Pattern: layout--design-the-empty-loading-error-and-overflow-states
- Status: ruling
