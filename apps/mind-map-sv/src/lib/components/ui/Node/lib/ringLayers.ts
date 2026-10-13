/**
 * Whether a node's ring is wider than the band its content is inset by, so the
 * content block draws over the ring's inner part and needs its backdrop to stay
 * readable.
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
