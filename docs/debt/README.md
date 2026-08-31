# Technical debt

Compromises this codebase is knowingly carrying: things that work, that we
chose to leave worse than they should be, and have not paid off yet.

One file per item, named `<YYYY-MM-DD>-<short-slug>.md`. There is deliberately
**no index file** — `ls docs/debt/` is the index, so it cannot drift out of
sync with what is actually here.

## When to file one

File an item when you knowingly leave something worse than it should be and
fixing it is out of scope for what you are doing:

- A review — `/code-review`, `/simplify`, or a human one — surfaces something
  real that the current change should not grow to include. File it rather than
  dropping the finding or widening the change; those are the two failure modes
  this folder exists to prevent.
- You take a deliberate shortcut to ship something, and you can name what the
  better version looks like.
- You satisfy a gate in a way that hides the problem instead of solving it (an
  ignore entry, a loosened assertion, a `knip` export kept alive by one caller).

Do not file:

- **Bugs.** Something that produces a wrong result gets fixed, or goes in
  `docs/roadmaps/TODO.md` under BUGS.
- **Feature ideas.** Those go in `docs/roadmaps/TODO.md`.
- **Anything you can just fix in the change you are already making.** A debt
  file is more expensive than a two-line fix.
- **Speculative cleanups.** "This could be nicer" with no cost attached is not
  debt, it is taste, and it will rot here.

The bar: a reader who was not there can tell what is wrong, why it was
accepted, and what paying it off would look like.

## Filing one

Copy `TEMPLATE.md`, date the filename, and keep it short — an item that needs
more than a screen is a milestone, not debt. File it in the same commit as the
work that incurred it, so the compromise and its record arrive together.

## Closing one

Delete the file in the same commit as the fix. Git history keeps the record,
and this folder stays an honest list of what is still owed. Do not mark items
resolved in place — a folder of mostly-dead entries stops being read.
