import { describe, expect, it } from 'vitest';
import {
	relaxEdgeDistancesStep,
	relaxGraphPhysics,
	relaxOverlaps,
	relaxOverlapsStep
} from './physics';
import type { Point } from '../../types/multigraph';

const EDGE_DISTANCE_SETTINGS = {
	edgeGapMinPx: 40,
	edgeGapMaxPx: 120,
	edgeSpringStrength: 0.25
};

function overlapAmount(
	positions: Record<string, Point>,
	radii: Record<string, number>,
	sourceId: string,
	targetId: string,
	paddingPx: number
): number {
	const source = positions[sourceId];
	const target = positions[targetId];
	return (
		radii[sourceId] +
		radii[targetId] +
		paddingPx -
		Math.hypot(target.x - source.x, target.y - source.y)
	);
}

function gapAmount(
	positions: Record<string, Point>,
	radii: Record<string, number>,
	sourceId: string,
	targetId: string
): number {
	const source = positions[sourceId];
	const target = positions[targetId];
	return Math.hypot(target.x - source.x, target.y - source.y) - radii[sourceId] - radii[targetId];
}

describe('physics', () => {
	describe('relaxEdgeDistancesStep', () => {
		it('pulls connected nodes together when their visible edge gap exceeds the max', () => {
			const positions = { n0: { x: 0, y: 0 }, n1: { x: 300, y: 0 } };
			const radii = { n0: 20, n1: 20 };

			const next = relaxEdgeDistancesStep(
				positions,
				radii,
				[{ sourceNodeId: 'n0', targetNodeId: 'n1' }],
				EDGE_DISTANCE_SETTINGS
			);

			expect(next.n0).toEqual({ x: 17.5, y: 0 });
			expect(next.n1).toEqual({ x: 282.5, y: 0 });
			expect(gapAmount(next, radii, 'n0', 'n1')).toBeLessThan(
				gapAmount(positions, radii, 'n0', 'n1')
			);
		});

		it('pulls more strongly as connected nodes get farther apart', () => {
			const radii = { n0: 20, n1: 20 };
			const near = relaxEdgeDistancesStep(
				{ n0: { x: 0, y: 0 }, n1: { x: 200, y: 0 } },
				radii,
				[{ sourceNodeId: 'n0', targetNodeId: 'n1' }],
				EDGE_DISTANCE_SETTINGS
			);
			const far = relaxEdgeDistancesStep(
				{ n0: { x: 0, y: 0 }, n1: { x: 400, y: 0 } },
				radii,
				[{ sourceNodeId: 'n0', targetNodeId: 'n1' }],
				EDGE_DISTANCE_SETTINGS
			);

			expect(near.n0.x).toBe(5);
			expect(far.n0.x).toBe(30);
		});

		it('pushes connected nodes apart when their visible edge gap is below the min', () => {
			const positions = { n0: { x: 0, y: 0 }, n1: { x: 60, y: 0 } };
			const radii = { n0: 20, n1: 20 };

			const next = relaxEdgeDistancesStep(
				positions,
				radii,
				[{ sourceNodeId: 'n0', targetNodeId: 'n1' }],
				EDGE_DISTANCE_SETTINGS
			);

			expect(next.n0).toEqual({ x: -2.5, y: 0 });
			expect(next.n1).toEqual({ x: 62.5, y: 0 });
		});

		it('keeps anchored connected nodes still while the unanchored node absorbs edge pull', () => {
			const positions = { n0: { x: 0, y: 0 }, n1: { x: 300, y: 0 } };
			const radii = { n0: 20, n1: 20 };

			const next = relaxEdgeDistancesStep(
				positions,
				radii,
				[{ sourceNodeId: 'n0', targetNodeId: 'n1' }],
				EDGE_DISTANCE_SETTINGS,
				new Set(['n0'])
			);

			expect(next.n0).toEqual({ x: 0, y: 0 });
			expect(next.n1).toEqual({ x: 265, y: 0 });
		});

		it('returns the original positions when connected nodes are already within range', () => {
			const positions = { n0: { x: 0, y: 0 }, n1: { x: 120, y: 0 } };
			const radii = { n0: 20, n1: 20 };

			expect(
				relaxEdgeDistancesStep(
					positions,
					radii,
					[{ sourceNodeId: 'n0', targetNodeId: 'n1' }],
					EDGE_DISTANCE_SETTINGS
				)
			).toBe(positions);
		});
	});

	describe('relaxOverlapsStep', () => {
		it('separates two overlapping circles symmetrically', () => {
			const positions = { n0: { x: 0, y: 0 }, n1: { x: 100, y: 0 } };

			const next = relaxOverlapsStep(positions, { n0: 100, n1: 100 }, 0);

			expect(next.n0).toEqual({ x: -50, y: 0 });
			expect(next.n1).toEqual({ x: 150, y: 0 });
		});

		it('keeps anchored nodes still while the unanchored node absorbs the push', () => {
			const positions = { n0: { x: 0, y: 0 }, n1: { x: 100, y: 0 } };

			const next = relaxOverlapsStep(positions, { n0: 100, n1: 100 }, 0, new Set(['n0']));

			expect(next.n0).toEqual({ x: 0, y: 0 });
			expect(next.n1).toEqual({ x: 200, y: 0 });
		});

		it('returns the original positions when nothing overlaps', () => {
			const positions = { n0: { x: 0, y: 0 }, n1: { x: 300, y: 0 } };

			expect(relaxOverlapsStep(positions, { n0: 100, n1: 100 }, 0)).toBe(positions);
		});

		it('uses a deterministic direction when circles have identical centers', () => {
			const positions = { n0: { x: 0, y: 0 }, n1: { x: 0, y: 0 } };

			const next = relaxOverlapsStep(positions, { n0: 10, n1: 10 }, 0);

			expect(next.n0).toEqual({ x: -10, y: 0 });
			expect(next.n1).toEqual({ x: 10, y: 0 });
		});

		it('does not mutate input positions', () => {
			const positions = { n0: { x: 0, y: 0 }, n1: { x: 100, y: 0 } };

			relaxOverlapsStep(positions, { n0: 100, n1: 100 }, 0);

			expect(positions).toEqual({ n0: { x: 0, y: 0 }, n1: { x: 100, y: 0 } });
		});
	});

	describe('relaxOverlaps', () => {
		it('converges a deterministic cluster below padding tolerance', () => {
			const positions = {
				n0: { x: 0, y: 0 },
				n1: { x: 30, y: 0 },
				n2: { x: 80, y: 0 }
			};
			const radii = { n0: 20, n1: 20, n2: 20 };

			const next = relaxOverlaps(positions, radii, 4, 25);

			expect(overlapAmount(next, radii, 'n0', 'n1', 4)).toBeLessThan(0.01);
			expect(overlapAmount(next, radii, 'n0', 'n2', 4)).toBeLessThan(0.01);
			expect(overlapAmount(next, radii, 'n1', 'n2', 4)).toBeLessThan(0.01);
		});
	});

	describe('relaxGraphPhysics', () => {
		it('combines edge pull with overlap relaxation across multiple iterations', () => {
			const positions = {
				n0: { x: 0, y: 0 },
				n1: { x: 320, y: 0 },
				n2: { x: 640, y: 0 }
			};
			const radii = { n0: 20, n1: 20, n2: 20 };

			const next = relaxGraphPhysics(
				positions,
				radii,
				[
					{ sourceNodeId: 'n0', targetNodeId: 'n1' },
					{ sourceNodeId: 'n1', targetNodeId: 'n2' }
				],
				12,
				EDGE_DISTANCE_SETTINGS,
				4,
				new Set(['n0'])
			);

			expect(next.n0).toEqual({ x: 0, y: 0 });
			expect(gapAmount(next, radii, 'n0', 'n1')).toBeLessThan(
				gapAmount(positions, radii, 'n0', 'n1')
			);
			expect(gapAmount(next, radii, 'n1', 'n2')).toBeLessThan(
				gapAmount(positions, radii, 'n1', 'n2')
			);
		});
	});
});
