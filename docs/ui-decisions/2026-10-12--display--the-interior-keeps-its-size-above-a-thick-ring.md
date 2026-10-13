# The interior keeps its size above a thick ring

- Situation: a weighted border (up to ×10 of "Node border width", 80 px a side on a 200 px radius) was the node's own CSS border, so it ate inward and clipped the content to whatever interior it left. Past about ×2.2 the badge and chip rows clipped, and at the cap the title could not fit, so the readability stories had to stop at a "readable" ×3.
- Proposed: grow the node outward with its ring (changing layout and hit testing); or keep squeezing the content and cap the factor lower.
- Chosen (owner ruling, 2026-10-12), six points:
  1. **The ring still grows inward.** The node's outer diameter is unchanged and still matches its layout radius and hit area.
  2. **Only the content goes above the ring; the fill stays behind it.** The content block (title, description, badge row, chip row) keeps a fixed size, the interior at the base border width, and is drawn above the ring. The interior's solid fill is behind the ring, so a thick ring is fully visible and the content overlaps its inner part.
  3. **A translucent backdrop above the base width.** When the ring is wider than the base, the title's words (their own box, not the fitted title square, which spans the interior) and the badge and chip rows each get a soft white rounded backdrop (`rgb(255 255 255 / 0.72)`, padded by a spread shadow, no blur) so dark text stays readable over a coloured ring. At the base width nothing changes.
  4. **Backgrounds go under the ring.** Layers are fill/background → ring → content; a future picture or dynamic background fills the whole circle under the ring (`NodeChrome.svelte` says where).
  5. **Morph, pinned and tags are unchanged.** The pinned colour and halo, the tag conic gradient (now confined to the ring layer) and the deep-zoom morph (the frame interpolates the ring width; its interior is the details view) behave as before. The frame's content inset rides the same curve from the base width to the details border, so the handoff at progress 0 matches the canvas node.
  6. **The base is the "Node border width" setting** (`multigraph.nodeBorderWidthPx`), not a hard-coded 8.
- Why: the ring is a reading of the node's weight and the content is the node itself; the weight should not cost the reader the title. Growing inward keeps layout, physics and hit testing untouched.
- Pattern: none
- Status: ruling

## Addendum, 2026-10-12: the backdrop only where the words touch the ring, and it fades

- Situation: point 3 shipped as "ring wider than the base → every content element gets the backdrop", so a short title whose words sat well inside the ring's inner edge still wore a white patch over plain fill.
- Chosen (owner ruling, later the same day): the backdrop appears **only on an element whose own box actually overlaps the ring**, and it **fades in and out** (~150 ms) rather than snapping.
  - Overlap is geometry (`Node/lib/ringLayers.ts`, `boxOverlapsRing`): the element's box, in the circle's unscaled coordinates, overlaps the band between the ring's inner edge (`radius − ring`) and the content clip (`radius − base`) — its farthest corner is past the inner edge and its nearest point is inside the clip. Never at or below the base width. The deep-zoom morph's rounded rectangle is treated as a circle of the node's radius.
  - `NodeChrome` measures the title's words and the badge and chip rows only while the ring is wider than the base (otherwise it clears the marks and does nothing), re-measuring on ring, inset or size changes, on a resize of any of them, and when one appears or goes; each overlapping element gets `data-over-ring`. Boxes are `getBoundingClientRect` relative to the circle, divided by the circle's own on-screen scale, which holds under both the stage zoom and the deep-zoom frame's scaled compact layer.
  - The fade is a colour transition on the element's own background and spread shadow (transparent ↔ `rgb(255 255 255 / 0.72)`), not a pseudo-element, so `SquareText`'s fit never sees new overflow. `prefers-reduced-motion: reduce` drops the transition.
- Consequence: at the shipped 38 px font, a title of a few words (the stories' `'Short node title goes here.'`) already reaches about 10 px onto an 80 px ring and gets the backdrop; a one- or two-word title does not. At ×10 the badge and chip rows, out in the bands beyond the title square, always reach the ring; at ×1.5 they clear it.
