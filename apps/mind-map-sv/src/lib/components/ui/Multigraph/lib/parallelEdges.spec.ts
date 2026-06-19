import { describe, expect, it } from 'vitest';
import type { EdgeData } from '../../types/edge';
import type { Point } from '../../types/multigraph';
import {
	applyParallelEdgeOffset,
	computeParallelEdgeOffsets,
	parallelEdgeGroupKey,
	type ParallelEdgeGeometry
} from './parallelEdges';

const BASE_GEOMETRY: ParallelEdgeGeometry = {
	posByNodeId: {
		a: { x: 0, y: 0 },
		b: { x: 100, y: 0 },
		c: { x: 0, y: 100 }
	},
	radiusByNodeId: {
		a: 50,
		b: 50,
		c: 50
	}
};

describe('parallelEdges', () => {
	it('keeps a single edge centered with no offset', () => {
		const offsets = computeParallelEdgeOffsets([edge('only', 'a', 'b')], BASE_GEOMETRY);

		expect(offsets.only).toEqual({
			edgeId: 'only',
			groupKey: parallelEdgeGroupKey(edge('only', 'a', 'b')),
			groupCount: 1,
			slot: 0,
			offsetDistance: 0,
			offsetVector: { x: 0, y: 0 }
		});
	});

	it('assigns centered slots for two, three, and four edge groups', () => {
		const two = computeParallelEdgeOffsets(
			[edge('b', 'a', 'b'), edge('a', 'a', 'b')],
			BASE_GEOMETRY,
			{ spacingPx: 10 }
		);
		const three = computeParallelEdgeOffsets(
			[edge('c', 'a', 'b'), edge('a', 'a', 'b'), edge('b', 'a', 'b')],
			BASE_GEOMETRY,
			{ spacingPx: 10 }
		);
		const four = computeParallelEdgeOffsets(
			[edge('d', 'a', 'b'), edge('b', 'a', 'b'), edge('a', 'a', 'b'), edge('c', 'a', 'b')],
			BASE_GEOMETRY,
			{ spacingPx: 10 }
		);

		expect([two.a.slot, two.b.slot]).toEqual([-0.5, 0.5]);
		expect([three.a.slot, three.b.slot, three.c.slot]).toEqual([-1, 0, 1]);
		expect([four.a.slot, four.b.slot, four.c.slot, four.d.slot]).toEqual([-1.5, -0.5, 0.5, 1.5]);
	});

	it('sorts each group deterministically by stable edge id', () => {
		const offsets = computeParallelEdgeOffsets(
			[edge('z', 'a', 'b'), edge('a', 'a', 'b'), edge('m', 'a', 'b')],
			BASE_GEOMETRY,
			{ spacingPx: 10 }
		);

		expect(offsets.a.slot).toBe(-1);
		expect(offsets.m.slot).toBe(0);
		expect(offsets.z.slot).toBe(1);
		expect(offsets.a.offsetVector).toEqual({ x: 0, y: -10 });
		expect(offsets.z.offsetVector).toEqual({ x: 0, y: 10 });
	});

	it('uses uniform group spacing from the largest visual edge footprint', () => {
		const roomyGeometry: ParallelEdgeGeometry = {
			...BASE_GEOMETRY,
			radiusByNodeId: {
				a: 120,
				b: 120,
				c: 120
			}
		};
		const offsets = computeParallelEdgeOffsets(
			[edge('thin', 'a', 'b'), edge('arrow', 'a', 'b'), edge('stroke', 'a', 'b')],
			roomyGeometry,
			{
				spacingPx: 10,
				clearancePx: 4,
				visualHalfWidthByEdgeId: {
					thin: 1,
					arrow: 24,
					stroke: 8
				}
			}
		);

		expect(offsets.arrow.offsetDistance).toBe(-52);
		expect(offsets.stroke.offsetDistance).toBe(0);
		expect(offsets.thin.offsetDistance).toBe(52);
		expect(offsets.arrow.offsetVector).toEqual({ x: 0, y: -52 });
		expect(offsets.thin.offsetVector).toEqual({ x: 0, y: 52 });
	});

	it('groups opposite-direction edges by unordered node pair', () => {
		const offsets = computeParallelEdgeOffsets(
			[edge('forward', 'a', 'b'), edge('reverse', 'b', 'a')],
			BASE_GEOMETRY,
			{ spacingPx: 8 }
		);

		expect(offsets.forward.groupKey).toBe(offsets.reverse.groupKey);
		expect(offsets.forward.groupCount).toBe(2);
		expect(offsets.reverse.groupCount).toBe(2);
		expect([offsets.forward.slot, offsets.reverse.slot]).toEqual([-0.5, 0.5]);
		expect(offsets.forward.offsetVector).toEqual({ x: 0, y: -4 });
		expect(offsets.reverse.offsetVector).toEqual({ x: 0, y: 4 });
	});

	it('returns a zero offset for zero-length endpoint pairs', () => {
		const geometry: ParallelEdgeGeometry = {
			posByNodeId: {
				a: { x: 10, y: 10 },
				b: { x: 10, y: 10 }
			},
			radiusByNodeId: {
				a: 50,
				b: 50
			}
		};

		const offsets = computeParallelEdgeOffsets(
			[edge('a-edge', 'a', 'b'), edge('b-edge', 'a', 'b')],
			geometry,
			{ spacingPx: 10 }
		);

		expect(offsets['a-edge'].slot).toBe(-0.5);
		expect(offsets['a-edge'].offsetDistance).toBe(0);
		expect(offsets['a-edge'].offsetVector).toEqual({ x: 0, y: 0 });
		expect(offsets['b-edge'].offsetDistance).toBe(0);
		expect(offsets['b-edge'].offsetVector).toEqual({ x: 0, y: 0 });
	});

	it('returns group metadata but no offset when a node position is missing', () => {
		const geometry: ParallelEdgeGeometry = {
			posByNodeId: {
				a: { x: 0, y: 0 }
			},
			radiusByNodeId: {
				a: 50,
				b: 50
			}
		};

		const offsets = computeParallelEdgeOffsets(
			[edge('first', 'a', 'b'), edge('second', 'a', 'b')],
			geometry,
			{ spacingPx: 10 }
		);

		expect(offsets.first.groupCount).toBe(2);
		expect(offsets.first.slot).toBe(-0.5);
		expect(offsets.first.offsetDistance).toBe(0);
		expect(offsets.first.offsetVector).toEqual({ x: 0, y: 0 });
	});

	it('clamps offsets to a configured fraction of the smaller endpoint radius', () => {
		const geometry: ParallelEdgeGeometry = {
			posByNodeId: {
				a: { x: 0, y: 0 },
				b: { x: 0, y: 100 }
			},
			radiusByNodeId: {
				a: 8,
				b: 40
			}
		};

		const offsets = computeParallelEdgeOffsets(
			[edge('left', 'a', 'b'), edge('middle', 'a', 'b'), edge('right', 'a', 'b')],
			geometry,
			{ spacingPx: 20, maxOffsetRadiusFactor: 0.25 }
		);

		expect(offsets.left.offsetDistance).toBe(-2);
		expect(offsets.middle.offsetDistance).toBe(0);
		expect(offsets.right.offsetDistance).toBe(2);
		expect(Math.abs(offsets.left.offsetVector.x)).toBeLessThanOrEqual(2);
		expect(Math.abs(offsets.right.offsetVector.x)).toBeLessThanOrEqual(2);
	});

	it('still clamps visual footprint spacing to the configured radius fraction', () => {
		const geometry: ParallelEdgeGeometry = {
			posByNodeId: {
				a: { x: 0, y: 0 },
				b: { x: 100, y: 0 }
			},
			radiusByNodeId: {
				a: 20,
				b: 20
			}
		};

		const offsets = computeParallelEdgeOffsets(
			[edge('wide-a', 'a', 'b'), edge('wide-b', 'a', 'b')],
			geometry,
			{
				clearancePx: 4,
				maxOffsetRadiusFactor: 0.25,
				visualHalfWidthByEdgeId: {
					'wide-a': 24,
					'wide-b': 24
				}
			}
		);

		expect(offsets['wide-a'].offsetDistance).toBe(-5);
		expect(offsets['wide-b'].offsetDistance).toBe(5);
	});

	it('applies a straight offset to both source and target centers', () => {
		const source: Point = { x: 1, y: 2 };
		const target: Point = { x: 11, y: 12 };

		expect(
			applyParallelEdgeOffset(source, target, {
				offsetVector: { x: 3, y: -4 }
			})
		).toEqual({
			source: { x: 4, y: -2 },
			target: { x: 14, y: 8 }
		});
	});

	it('does not mutate edge or geometry inputs', () => {
		const edges = [edge('b', 'a', 'b'), edge('a', 'a', 'b')];
		const geometry: ParallelEdgeGeometry = {
			posByNodeId: {
				a: { x: 0, y: 0 },
				b: { x: 100, y: 0 }
			},
			radiusByNodeId: {
				a: 20,
				b: 20
			}
		};
		const originalEdges = JSON.stringify(edges);
		const originalGeometry = JSON.stringify(geometry);

		computeParallelEdgeOffsets(edges, geometry, { spacingPx: 10 });

		expect(JSON.stringify(edges)).toBe(originalEdges);
		expect(JSON.stringify(geometry)).toBe(originalGeometry);
	});
});

function edge(id: string, sourceNodeId: string, targetNodeId: string): EdgeData {
	return {
		id,
		sourceNodeId,
		targetNodeId,
		tags: []
	};
}
