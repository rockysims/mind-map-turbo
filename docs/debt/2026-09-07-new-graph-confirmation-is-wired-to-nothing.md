# The `New graph` confirmation exists, is specified, and is connected to nothing

**Created:** 2026-09-07
**Area:** `apps/mind-map-sv/src/lib/graphPersistenceController.ts` (`createGraph`,
and the `confirmNewGraphReplace` dep it calls), `apps/mind-map-sv/src/routes/+page.svelte`
(the `usePersistedGraph({ ... })` call that omits it)
**Cost if ignored:** Nothing today — no UI reaches `createGraph`. The cost is
the trap: the next caller wired to it inherits a `New` that, on a document with
unsaved changes, does nothing at all. No dialog, no new graph, no notice. It
fails closed and silently, which is the hardest shape of nothing to debug.

## What we did

`createGraph` asks `deps.confirmNewGraphReplace` before replacing a document
that has unsaved changes, and the call is optional-chained with a `?? false`
fallback:

```ts
const confirmed = !shouldConfirm
	? true
	: ((await this.deps.confirmNewGraphReplace?.({ ... })) ?? false);
if (!confirmed) return;
```

`+page.svelte` supplies `confirmGraphImportReplace` and
`chooseEmbeddedDocumentConflict`, but never `confirmNewGraphReplace`. So on the
real page that expression is `undefined ?? false` — an unconditional refusal.
Only `graphPersistenceController.spec.ts` and `PersistedGraphHarness.svelte`
pass the dep, which is why the specs pass and nothing is visibly broken.

Nothing is visibly broken because nothing calls it: the toolbar's `New` runs
`openNewGraphInNewTab()`, which opens a blank graph in a second tab and leaves
this one untouched. There is no document at risk, so there is correctly no
prompt — a different and better answer than the one the ruling was written for.

The ruling `2026-06-21--destructive--name-what-is-at-risk-in-each-new-graph-prompt`
specifies three exact strings for this prompt. None of them appear anywhere in
`src/`.

## Why

The new-tab route arrived after the ruling and made the in-place replace
unnecessary rather than wrong; `createGraph` kept working for the harness and
the specs, so nothing forced the question. Found by the 2026-09-07 UI review,
which was reading the ruling rather than the feature, and is the reason the gap
is visible at all: from the app there is nothing to see.

## What paying it off looks like

Decide which of the two the app actually wants, and make the code say so.
Either delete the in-place replace path with its dep and its specs, and let
"new graph" mean "new tab" everywhere — in which case the 2026-06-21 ruling
gets a note that its situation no longer exists here — or wire
`confirmNewGraphReplace` in `+page.svelte` with the ruling's three strings and
a story per document state. What must not survive is the third option we have
now: a specified prompt, a caller that refuses without it, and no way to tell
from the page which of those is true.
