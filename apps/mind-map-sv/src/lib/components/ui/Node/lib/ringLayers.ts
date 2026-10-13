/**
 * Whether a node's ring is wider than the band its content is inset by, so the
 * content block draws over the ring's inner part. The cheap guard in front of
 * `boxOverlapsRing`: at or below the base nothing can overlap, so nothing is
 * measured.
 *
 * A node lays its content out inside the ring at the graph's base border width
 * (`multigraph.nodeBorderWidthPx`) whatever its weighted ring is, and a ring
 * wider than that grows inward underneath the content. At or below the base
 * there is no overlap, so nothing changes from a plain node.
 *
 * `tolerancePx` absorbs floating-point noise: the deep-zoom frame interpolates
 * both widths toward the same details width, and at progress 1 they must read
 * as equal even when the two lerps round differently.
 */
export function ringOverlapsContent(
	ringWidthPx: number,
	contentInsetPx: number,
	tolerancePx = 0.01
): boolean {
	return ringWidthPx - contentInsetPx > tolerancePx;
}

/**
 * An element's rectangle in the node circle's own coordinate space: offsets
 * from the circle box's top-left corner, in unscaled layout pixels, so the
 * stage's zoom transform (or a deep-zoom layer's) has already been divided out.
 */
type CircleBox = { left: number; top: number; width: number; height: number };

type RingGeometry = {
	/** The node's outer radius. */
	radiusPx: number;
	/** The ring as drawn, inward from the outer edge. */
	ringWidthPx: number;
	/** The content inset: the content is clipped to `radiusPx − baseWidthPx`. */
	baseWidthPx: number;
	/** The circle's centre; defaults to `(radiusPx, radiusPx)`, a square box. */
	centerXPx?: number;
	centerYPx?: number;
};

/**
 * Whether an element of the node's content actually sits on the ring, so its
 * words need the backdrop — rather than merely the ring being thicker than the
 * base, which says nothing about where a short title's words fall.
 *
 * The ring's visible inner part is the annulus between its inner edge,
 * `radiusPx − ringWidthPx`, and the content clip, `radiusPx − baseWidthPx`
 * (the content is clipped there, so nothing of it is visible further out). A
 * box overlaps that band iff its farthest corner from the centre lies beyond
 * the inner edge and its nearest point lies inside the clip: the box is convex,
 * so between those two points it crosses every radius in between, the band
 * included. The second test is the clamp to the clip — a box reaching past the
 * clip counts only as far as the clip, and a box wholly beyond it shows nothing
 * that needs backing.
 *
 * The node is treated as a circle of `radiusPx` even while the deep-zoom morph
 * gives it a non-circular border radius. The morph's ring and inset converge on
 * the details border, so the `ringOverlapsContent` guard turns the answer off
 * as the frame opens out, and near the start the shape is still close to the
 * node's circle.
 */
export function boxOverlapsRing(box: CircleBox, circle: RingGeometry, tolerancePx = 0.01): boolean {
	const { radiusPx, ringWidthPx, baseWidthPx } = circle;
	if (!ringOverlapsContent(ringWidthPx, baseWidthPx, tolerancePx)) return false;
	if (box.width <= 0 || box.height <= 0) return false;

	const cx = circle.centerXPx ?? radiusPx;
	const cy = circle.centerYPx ?? radiusPx;
	const left = box.left - cx;
	const right = left + box.width;
	const top = box.top - cy;
	const bottom = top + box.height;

	const farthest = Math.hypot(
		Math.max(Math.abs(left), Math.abs(right)),
		Math.max(Math.abs(top), Math.abs(bottom))
	);
	// The nearest point of the box to the centre: zero along an axis the box spans.
	const nearest = Math.hypot(
		left > 0 ? left : right < 0 ? -right : 0,
		top > 0 ? top : bottom < 0 ? -bottom : 0
	);

	const innerEdgePx = radiusPx - ringWidthPx;
	const clipPx = radiusPx - baseWidthPx;
	return farthest > innerEdgePx && nearest < clipPx;
}
