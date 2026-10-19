# A JSON graph export drops attachments without saying so

**Created:** 2026-10-18
**Area:** `apps/mind-map-sv/src/lib/graphFile.ts` (`serializeGraphFile`,
`graphFilePayload`, `parseGraphFilePayload`)
**Cost if ignored:** anyone who writes a `.json` export expecting a complete
document gets node content blocks pointing at assets the file does not carry;
opening it elsewhere draws missing images with no warning.

## What we did

Only the single-file HTML form embeds attachment bytes; the JSON form omits
`embeddedAssets` on write and never reads it. T02 found this while building the
clipboard payload and worked around it by writing the HTML form when
attachments are present, so the clipboard is unaffected. The JSON export's
behaviour was left as it was.

## Why

The HTML form is the one the app's Save produces and the one the plan for
attachments (milestone 13) targeted; JSON export is a secondary format whose
callers were not audited.

## What paying it off looks like

Either carry `embeddedAssets` in the JSON payload (additive, read on parse with
the same validation the HTML asset scripts get) or have the JSON export say in
its notice that attachments are not included. A spec that round-trips a
document with one asset through `serializeGraphFile` → `parseGraphFileText`
settles which.
