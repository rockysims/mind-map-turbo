# UI decisions

Rulings the owner has made about this project's interface, one file each, named `<date>--<area>--<rule>.md`. These override the shared ui-patterns library. Agents: list this directory before changing UI, open the files whose names match, and write a new file when the owner overrides a choice.

Standing rules:

- Mobile-first input. One gesture vocabulary across desktop and mobile.
- Pointer Events only, never separate mouse and touch handlers.
- Reduced motion skips the animation and reaches the identical end state.
