/**
 * Whether anything the reader could be looking at is actually on screen.
 *
 * Zooming is anchored to the pointer, so zooming in on empty canvas moves the
 * graph away — correctly, and without bound. That is fine right up until every
 * node is off-view, at which point the canvas is blank, nothing on it suggests
 * what happened, and the only ways back are a keystroke nobody has been told
 * about and a page reload.
 *
 * So the affordance is conditional on this: the hint that names the key appears
 * exactly when it is the answer, and never adds a control to a canvas that is
 * working.
 */

interface ScreenCircleLike {
	center: { x: number; y: number };
	radius: number;
}

interface ViewportRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/**
 * True when at least one circle overlaps the viewport rect at all.
 *
 * A bounding-box test rather than a true circle/rect intersection: the two
 * disagree only in a corner sliver, where the answer is "a few pixels of one
 * node are technically visible" — and treating that as visible is the safer
 * error, since it withholds a hint rather than showing a false one.
 */
export function anyCircleOnScreen(
	circles: readonly ScreenCircleLike[],
	viewport: ViewportRect
): boolean {
	const right = viewport.left + viewport.width;
	const bottom = viewport.top + viewport.height;
	return circles.some(
		(circle) =>
			circle.center.x + circle.radius >= viewport.left &&
			circle.center.x - circle.radius <= right &&
			circle.center.y + circle.radius >= viewport.top &&
			circle.center.y - circle.radius <= bottom
	);
}

/**
 * Whether the reader has lost the graph: there is something to see, and none of
 * it is on screen.
 *
 * An empty graph is deliberately not "lost" — a new document has nothing to
 * bring back, and offering to fit the view to nothing would be the first thing
 * a first-time user is told.
 */
export function graphIsLost(circles: readonly ScreenCircleLike[], viewport: ViewportRect): boolean {
	if (circles.length === 0) return false;
	return !anyCircleOnScreen(circles, viewport);
}
