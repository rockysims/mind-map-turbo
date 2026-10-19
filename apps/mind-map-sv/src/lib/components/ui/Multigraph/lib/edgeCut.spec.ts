import { describe, expect, it } from 'vitest';
import type { Point } from '../../types/multigraph';
import { edgeIdsCrossedBySegment, segmentsIntersect, type EdgeCutCandidate } from './edgeCut';

function p(x: number, y: number): Point {
	return { x, y };
}

function edge(id: string, source: Point, target: Point): EdgeCutCandidate {
	return { id, source, target };
}

describe('segmentsIntersect', () => {
	it('takes a proper crossing', () => {
		expect(segmentsIntersect(p(-10, 0), p(10, 0), p(0, -10), p(0, 10))).toBe(true);
		// A slanted pair, crossing away from either midpoint.
		expect(segmentsIntersect(p(0, 0), p(10, 4), p(8, -5), p(6, 10))).toBe(true);
	});

	it('misses a segment whose line it would cross only past its end', () => {
		expect(segmentsIntersect(p(-10, 0), p(10, 0), p(0, 1), p(0, 10))).toBe(false);
		expect(segmentsIntersect(p(-10, 0), p(-1, 0), p(0, -10), p(0, 10))).toBe(false);
	});

	it('counts touching: an endpoint lying on the other segment, from either side', () => {
		// The line ends exactly on the edge's middle.
		expect(segmentsIntersect(p(0, -10), p(0, 0), p(-10, 0), p(10, 0))).toBe(true);
		// The edge ends exactly on the line.
		expect(segmentsIntersect(p(-10, 0), p(10, 0), p(3, 0), p(3, 10))).toBe(true);
		// The two meet end to end.
		expect(segmentsIntersect(p(0, 0), p(5, 5), p(5, 5), p(10, 0))).toBe(true);
	});

	it('counts two segments on one line that overlap, and not two with a gap', () => {
		expect(segmentsIntersect(p(0, 0), p(10, 0), p(5, 0), p(20, 0))).toBe(true);
		// One inside the other.
		expect(segmentsIntersect(p(0, 0), p(10, 10), p(2, 2), p(4, 4))).toBe(true);
		// Sharing only an end.
		expect(segmentsIntersect(p(0, 0), p(10, 0), p(10, 0), p(20, 0))).toBe(true);
		// On one line, apart.
		expect(segmentsIntersect(p(0, 0), p(10, 0), p(11, 0), p(20, 0))).toBe(false);
	});

	it('never takes a parallel segment that does not overlap', () => {
		expect(segmentsIntersect(p(0, 0), p(10, 0), p(0, 1), p(10, 1))).toBe(false);
		expect(segmentsIntersect(p(0, 0), p(10, 10), p(1, 0), p(11, 10))).toBe(false);
	});

	it('treats a zero-length segment as a point the other must contain', () => {
		expect(segmentsIntersect(p(5, 0), p(5, 0), p(0, 0), p(10, 0))).toBe(true);
		expect(segmentsIntersect(p(0, 0), p(10, 0), p(5, 0), p(5, 0))).toBe(true);
		expect(segmentsIntersect(p(5, 1), p(5, 1), p(0, 0), p(10, 0))).toBe(false);
		// On the edge's line but past its end.
		expect(segmentsIntersect(p(12, 0), p(12, 0), p(0, 0), p(10, 0))).toBe(false);
		// Two points: only the same point.
		expect(segmentsIntersect(p(3, 3), p(3, 3), p(3, 3), p(3, 3))).toBe(true);
		expect(segmentsIntersect(p(3, 3), p(3, 3), p(3, 4), p(3, 4))).toBe(false);
	});

	it('absorbs rounding at the default tolerance, and widens only when asked to', () => {
		// 0.1 + 0.2 is not 0.3 in floating point; the end still lies on the edge.
		expect(segmentsIntersect(p(0.1 + 0.2, -1), p(0.1 + 0.2, 0), p(0.3, 0), p(0.3, 5))).toBe(true);
		// A real gap is a miss at the default...
		expect(segmentsIntersect(p(0, -10), p(0, -0.01), p(-10, 0), p(10, 0))).toBe(false);
		// ...and the tolerance is the one parameter that changes that.
		expect(segmentsIntersect(p(0, -10), p(0, -0.01), p(-10, 0), p(10, 0), 0.5)).toBe(true);
	});
});

describe('edgeIdsCrossedBySegment', () => {
	// Three verticals at x = 0, 10 and 20, each from y = -5 to 5.
	const verticals = [
		edge('left', p(0, -5), p(0, 5)),
		edge('middle', p(10, -5), p(10, 5)),
		edge('right', p(20, -5), p(20, 5))
	];

	it('takes exactly the edges the line crosses', () => {
		expect(edgeIdsCrossedBySegment(verticals, p(-1, 0), p(15, 0))).toEqual(['left', 'middle']);
		expect(edgeIdsCrossedBySegment(verticals, p(-1, 10), p(25, 10))).toEqual([]);
	});

	it('keeps the order the edges were given, not the order the line meets them', () => {
		// Drawn right to left, the line meets "right" first.
		expect(edgeIdsCrossedBySegment(verticals, p(25, 0), p(-1, 0))).toEqual([
			'left',
			'middle',
			'right'
		]);
		const reversed = [...verticals].reverse();
		expect(edgeIdsCrossedBySegment(reversed, p(-1, 0), p(25, 0))).toEqual([
			'right',
			'middle',
			'left'
		]);
	});

	it('cuts with a zero-length line only the edges through that point', () => {
		expect(edgeIdsCrossedBySegment(verticals, p(10, 2), p(10, 2))).toEqual(['middle']);
		expect(edgeIdsCrossedBySegment(verticals, p(5, 0), p(5, 0))).toEqual([]);
	});

	it('takes nothing from an empty list and leaves its input alone', () => {
		expect(edgeIdsCrossedBySegment([], p(0, 0), p(10, 0))).toEqual([]);
		const before = JSON.stringify(verticals);
		edgeIdsCrossedBySegment(verticals, p(-1, 0), p(25, 0));
		expect(JSON.stringify(verticals)).toBe(before);
	});
});
