import type { Point } from '../../types/multigraph';

/**
 * The cut gesture's colour, for both the dashed line the Stage draws and the
 * edges it would delete — one red, so what the line touches reads as what the
 * line will take. #dc2626 is about 4.8:1 on the white canvas, past the 3:1 a
 * graphic needs, and no tag palette or other gesture on the canvas is this
 * red. Colour is never the only sign: both the line and its targets are also
 * dashed.
 */
export const EDGE_CUT_COLOR = '#dc2626';

/**
 * How close to zero a cross product, or how far outside a segment's bounding
 * box, still counts as on it. Absolute, in the points' own units, and tiny on
 * purpose: it absorbs floating-point rounding so an endpoint lying on the other
 * segment or two segments sharing one line count as touching, and it never
 * widens what the line takes beyond what it visibly crosses.
 */
const DEFAULT_TOUCH_EPSILON = 1e-9;

/** One drawn edge as the cut sees it: its id and the segment it is drawn along. */
export interface EdgeCutCandidate {
	id: string;
	source: Point;
	target: Point;
}

/**
 * Which way `c` turns from the line `a`→`b`: 1 one way, -1 the other, 0 when
 * the three points lie on one line (within `epsilon`). A zero-length `a`→`b`
 * is on a line with everything, which is what lets a point-sized cut fall
 * through to the containment test below.
 */
function orientation(a: Point, b: Point, c: Point, epsilon: number): -1 | 0 | 1 {
	const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
	if (Math.abs(cross) <= epsilon) return 0;
	return cross > 0 ? 1 : -1;
}

/** Whether `p`, already known to lie on the line through `a` and `b`, lies between them. */
function withinSegmentBounds(p: Point, a: Point, b: Point, epsilon: number): boolean {
	return (
		p.x >= Math.min(a.x, b.x) - epsilon &&
		p.x <= Math.max(a.x, b.x) + epsilon &&
		p.y >= Math.min(a.y, b.y) - epsilon &&
		p.y <= Math.max(a.y, b.y) + epsilon
	);
}

/**
 * Whether segment `a1`–`a2` and segment `b1`–`b2` share at least one point.
 *
 * A proper crossing counts, and so does touching: an endpoint of one lying on
 * the other, or two segments on one line that overlap. Parallel segments that
 * never meet, and segments on one line with a gap between them, do not. Either
 * segment may be zero-length, in which case it is a point and the question is
 * whether the other contains it.
 */
export function segmentsIntersect(
	a1: Point,
	a2: Point,
	b1: Point,
	b2: Point,
	epsilon = DEFAULT_TOUCH_EPSILON
): boolean {
	const o1 = orientation(a1, a2, b1, epsilon);
	const o2 = orientation(a1, a2, b2, epsilon);
	const o3 = orientation(b1, b2, a1, epsilon);
	const o4 = orientation(b1, b2, a2, epsilon);

	// Each segment's ends lie on different sides of the other's line (or one
	// end lies on it): the lines meet inside both segments.
	if (o1 !== o2 && o3 !== o4) return true;

	// What is left is an endpoint lying on the other segment's line, which
	// counts only when it also lies within that segment — the touch and the
	// collinear-overlap cases.
	if (o1 === 0 && withinSegmentBounds(b1, a1, a2, epsilon)) return true;
	if (o2 === 0 && withinSegmentBounds(b2, a1, a2, epsilon)) return true;
	if (o3 === 0 && withinSegmentBounds(a1, b1, b2, epsilon)) return true;
	if (o4 === 0 && withinSegmentBounds(a2, b1, b2, epsilon)) return true;
	return false;
}

/**
 * The ids of every edge the segment `a`–`b` crosses or touches, in the order
 * the edges were given. A zero-length line (`a` equal to `b`) takes the edges
 * whose segment contains that point.
 *
 * One pass, and nothing kept between calls: the cut asks again on every move
 * with the edges as they are drawn at that moment.
 */
export function edgeIdsCrossedBySegment(
	edges: readonly EdgeCutCandidate[],
	a: Point,
	b: Point,
	epsilon = DEFAULT_TOUCH_EPSILON
): string[] {
	const crossed: string[] = [];
	for (const edge of edges) {
		if (segmentsIntersect(a, b, edge.source, edge.target, epsilon)) crossed.push(edge.id);
	}
	return crossed;
}
