import { describe, expect, it } from 'vitest';
import {
	displacementShares,
	neighborDegreeByNodeId,
	relaxEdgeDistancesStep,
	relaxGraphPhysics,
	relaxHopRepulsionStep,
	relaxOverlaps,
	relaxOverlapsStep
} from './physics';
import type { Point } from '../../types/multigraph';

const EDGE_DISTANCE_SETTINGS = {
	edgeGapMinRadiusFactor: 1,
	edgeGapMaxRadiusFactor: 3,
	edgeSpringStrength: 0.25
};

const HOP_REPULSION_SETTINGS = {
	hopRepulsionStrength: 1,
	hopRepulsionMinHops: 2,
	hopRepulsionMaxHops: 4,
	hopRepulsionMaxExtraGapRadiusFactor: 1
};

const GRAPH_PHYSICS_SETTINGS = {
	...EDGE_DISTANCE_SETTINGS,
	...HOP_REPULSION_SETTINGS,
	hopRepulsionStrength: 0
};

function overlapAmount(
	positions: Record<string, Point>,
	radii: Record<string, number>,
	sourceId: string,
	targetId: string
): number {
	const source = positions[sourceId];
	const target = positions[targetId];
	return radii[sourceId] + radii[targetId] - Math.hypot(target.x - source.x, target.y - source.y);
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
	describe('displacementShares', () => {
		it('splits displacement proportionally to node mobility', () => {
			expect(displacementShares('heavy', 'light', new Set(), { heavy: 0.1, light: 1 })).toEqual({
				sourceShare: 0.1 / 1.1,
				targetShare: 1 / 1.1
			});
		});

		it('keeps anchored nodes still', () => {
			expect(displacementShares('n0', 'n1', new Set(['n0']))).toEqual({
				sourceShare: 0,
				targetShare: 1
			});
		});
	});

	describe('neighborDegreeByNodeId', () => {
		it('counts unique neighbors per node', () => {
			expect(
				neighborDegreeByNodeId([
					{ sourceNodeId: 'hub', targetNodeId: 'a' },
					{ sourceNodeId: 'hub', targetNodeId: 'b' },
					{ sourceNodeId: 'hub', targetNodeId: 'c' },
					{ sourceNodeId: 'a', targetNodeId: 'b' }
				])
			).toEqual({ hub: 3, a: 2, b: 2, c: 1 });
		});
	});

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

		it('scales the visible edge gap range by connected node radii', () => {
			const positions = { n0: { x: 0, y: 0 }, n1: { x: 400, y: 0 } };
			const radii = { n0: 20, n1: 60 };

			const next = relaxEdgeDistancesStep(
				positions,
				radii,
				[{ sourceNodeId: 'n0', targetNodeId: 'n1' }],
				EDGE_DISTANCE_SETTINGS
			);

			expect(next.n0).toEqual({ x: 10, y: 0 });
			expect(next.n1).toEqual({ x: 390, y: 0 });
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

		it('moves a low-mobility node less than its lighter neighbor for the same edge stretch', () => {
			const positions = { heavy: { x: 0, y: 0 }, light: { x: 300, y: 0 } };
			const radii = { heavy: 20, light: 20 };

			const next = relaxEdgeDistancesStep(
				positions,
				radii,
				[{ sourceNodeId: 'heavy', targetNodeId: 'light' }],
				EDGE_DISTANCE_SETTINGS,
				new Set(),
				undefined,
				{ heavy: 0.1, light: 1 }
			);

			expect(Math.abs(next.heavy.x)).toBeLessThan(Math.abs(next.light.x - positions.light.x));
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

		it('moves a high-degree hub less than its leaves for the same edge stretch', () => {
			const radii = { hub: 20, leafA: 20, leafB: 20, leafC: 20 };
			const positions = {
				hub: { x: 0, y: 0 },
				leafA: { x: 300, y: 0 },
				leafB: { x: 0, y: 300 },
				leafC: { x: -300, y: 0 }
			};
			const edges = [
				{ sourceNodeId: 'hub', targetNodeId: 'leafA' },
				{ sourceNodeId: 'hub', targetNodeId: 'leafB' },
				{ sourceNodeId: 'hub', targetNodeId: 'leafC' }
			];

			const next = relaxEdgeDistancesStep(positions, radii, edges, EDGE_DISTANCE_SETTINGS);

			expect(Math.hypot(next.hub.x, next.hub.y)).toBeLessThan(
				Math.hypot(next.leafA.x - positions.leafA.x, next.leafA.y - positions.leafA.y)
			);
			expect(next.hub).toEqual({ x: 0, y: 5.833333333333333 });
			expect(next.leafA).toEqual({ x: 282.5, y: 0 });
		});

		it('computes all edge forces from the same position snapshot', () => {
			const radii = { hub: 20, leafA: 20, leafB: 20 };
			const positions = {
				hub: { x: 0, y: 0 },
				leafA: { x: 300, y: 0 },
				leafB: { x: 0, y: 300 }
			};
			const edges = [
				{ sourceNodeId: 'hub', targetNodeId: 'leafA' },
				{ sourceNodeId: 'hub', targetNodeId: 'leafB' }
			];

			const next = relaxEdgeDistancesStep(positions, radii, edges, EDGE_DISTANCE_SETTINGS);

			expect(next.hub).toEqual({ x: 8.75, y: 8.75 });
			expect(next.leafA).toEqual({ x: 282.5, y: 0 });
			expect(next.leafB).toEqual({ x: 0, y: 282.5 });
		});
	});

	describe('relaxHopRepulsionStep', () => {
		it('pushes nodes apart when shortest-path hops meet the minimum', () => {
			const positions = { n0: { x: 0, y: 0 }, n2: { x: 40, y: 0 } };
			const radii = { n0: 20, n2: 20 };

			const next = relaxHopRepulsionStep(
				positions,
				radii,
				{ n0: { n2: 2 }, n2: { n0: 2 } },
				HOP_REPULSION_SETTINGS
			);

			expect(next.n0.x).toBeCloseTo(-6.666666666666666);
			expect(next.n0.y).toBe(0);
			expect(next.n2.x).toBeCloseTo(46.666666666666664);
			expect(next.n2.y).toBe(0);
		});

		it('does not repel directly connected neighbors', () => {
			const positions = { n0: { x: 0, y: 0 }, n1: { x: 40, y: 0 } };
			const radii = { n0: 20, n1: 20 };

			expect(
				relaxHopRepulsionStep(
					positions,
					radii,
					{ n0: { n1: 1 }, n1: { n0: 1 } },
					HOP_REPULSION_SETTINGS
				)
			).toBe(positions);
		});

		it('normalizes maximum repulsion so larger hop caps keep the same final force', () => {
			const positions = { n0: { x: 0, y: 0 }, n40: { x: 40, y: 0 } };
			const radii = { n0: 20, n40: 20 };
			const shortCap = relaxHopRepulsionStep(
				positions,
				radii,
				{ n0: { n40: 40 }, n40: { n0: 40 } },
				{ ...HOP_REPULSION_SETTINGS, hopRepulsionMaxHops: 4 }
			);
			const longCap = relaxHopRepulsionStep(
				positions,
				radii,
				{ n0: { n40: 40 }, n40: { n0: 40 } },
				{ ...HOP_REPULSION_SETTINGS, hopRepulsionMaxHops: 40 }
			);

			expect(shortCap).toEqual(longCap);
		});

		it('keeps anchored nodes still while the unanchored node absorbs hop repulsion', () => {
			const positions = { n0: { x: 0, y: 0 }, n2: { x: 40, y: 0 } };
			const radii = { n0: 20, n2: 20 };

			const next = relaxHopRepulsionStep(
				positions,
				radii,
				{ n0: { n2: 2 }, n2: { n0: 2 } },
				HOP_REPULSION_SETTINGS,
				new Set(['n0'])
			);

			expect(next.n0).toEqual({ x: 0, y: 0 });
			expect(next.n2).toEqual({ x: 53.33333333333333, y: 0 });
		});

		it('moves a low-mobility node less than its lighter neighbor under hop repulsion', () => {
			const positions = { heavy: { x: 0, y: 0 }, light: { x: 40, y: 0 } };
			const radii = { heavy: 20, light: 20 };

			const next = relaxHopRepulsionStep(
				positions,
				radii,
				{ heavy: { light: 2 }, light: { heavy: 2 } },
				HOP_REPULSION_SETTINGS,
				new Set(),
				undefined,
				{ heavy: 0.1, light: 1 }
			);

			expect(Math.abs(next.heavy.x)).toBeLessThan(Math.abs(next.light.x - positions.light.x));
		});
	});

	describe('relaxOverlapsStep', () => {
		it('separates two overlapping circles symmetrically', () => {
			const positions = { n0: { x: 0, y: 0 }, n1: { x: 100, y: 0 } };

			const next = relaxOverlapsStep(positions, { n0: 100, n1: 100 });

			expect(next.n0).toEqual({ x: -50, y: 0 });
			expect(next.n1).toEqual({ x: 150, y: 0 });
		});

		it('keeps anchored nodes still while the unanchored node absorbs the push', () => {
			const positions = { n0: { x: 0, y: 0 }, n1: { x: 100, y: 0 } };

			const next = relaxOverlapsStep(positions, { n0: 100, n1: 100 }, new Set(['n0']));

			expect(next.n0).toEqual({ x: 0, y: 0 });
			expect(next.n1).toEqual({ x: 200, y: 0 });
		});

		it('moves a low-mobility node less than its lighter neighbor when overlapping', () => {
			const positions = { heavy: { x: 0, y: 0 }, light: { x: 100, y: 0 } };
			const radii = { heavy: 100, light: 100 };

			const next = relaxOverlapsStep(positions, radii, new Set(), undefined, {
				heavy: 0.1,
				light: 1
			});

			expect(Math.abs(next.heavy.x)).toBeLessThan(Math.abs(next.light.x - positions.light.x));
		});

		it('returns the original positions when nothing overlaps', () => {
			const positions = { n0: { x: 0, y: 0 }, n1: { x: 300, y: 0 } };

			expect(relaxOverlapsStep(positions, { n0: 100, n1: 100 })).toBe(positions);
		});

		it('uses a deterministic direction when circles have identical centers', () => {
			const positions = { n0: { x: 0, y: 0 }, n1: { x: 0, y: 0 } };

			const next = relaxOverlapsStep(positions, { n0: 10, n1: 10 });

			expect(next.n0).toEqual({ x: -10, y: 0 });
			expect(next.n1).toEqual({ x: 10, y: 0 });
		});

		it('does not mutate input positions', () => {
			const positions = { n0: { x: 0, y: 0 }, n1: { x: 100, y: 0 } };

			relaxOverlapsStep(positions, { n0: 100, n1: 100 });

			expect(positions).toEqual({ n0: { x: 0, y: 0 }, n1: { x: 100, y: 0 } });
		});

		it('ignores excluded nodes so they do not block active pairs', () => {
			const positions = {
				n0: { x: 0, y: 0 },
				n1: { x: 100, y: 0 },
				n2: { x: 50, y: 0 }
			};
			const radii = { n0: 100, n1: 100, n2: 100 };

			const next = relaxOverlapsStep(positions, radii, new Set(), new Set(['n0', 'n1']));

			expect(next.n0).toEqual({ x: -50, y: 0 });
			expect(next.n1).toEqual({ x: 150, y: 0 });
		});
	});

	describe('relaxOverlaps', () => {
		it('converges a deterministic cluster below overlap tolerance', () => {
			const positions = {
				n0: { x: 0, y: 0 },
				n1: { x: 30, y: 0 },
				n2: { x: 80, y: 0 }
			};
			const radii = { n0: 20, n1: 20, n2: 20 };

			const next = relaxOverlaps(positions, radii, 25);

			expect(overlapAmount(next, radii, 'n0', 'n1')).toBeLessThan(0.01);
			expect(overlapAmount(next, radii, 'n0', 'n2')).toBeLessThan(0.01);
			expect(overlapAmount(next, radii, 'n1', 'n2')).toBeLessThan(0.01);
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
				GRAPH_PHYSICS_SETTINGS,
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
