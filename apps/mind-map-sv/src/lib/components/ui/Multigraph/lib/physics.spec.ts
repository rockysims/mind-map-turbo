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

		describe('per-edge spring factor', () => {
			const positions = { n0: { x: 0, y: 0 }, n1: { x: 300, y: 0 } };
			const radii = { n0: 20, n1: 20 };

			function pullFor(springFactor?: number): number {
				const next = relaxEdgeDistancesStep(
					positions,
					radii,
					[{ sourceNodeId: 'n0', targetNodeId: 'n1', springFactor }],
					EDGE_DISTANCE_SETTINGS
				);
				return (next.n0?.x ?? 0) - positions.n0.x;
			}

			it('pulls at full strength when no factor is given', () => {
				// Every edge predates factors, so silence has to mean "as before".
				expect(pullFor(undefined)).toBe(pullFor(1));
			});

			it('scales the pull by the factor', () => {
				expect(pullFor(0.5)).toBeCloseTo(pullFor(1) / 2, 10);
			});

			it('pulls harder above one', () => {
				expect(pullFor(2)).toBeCloseTo(pullFor(1) * 2, 10);
			});

			// `edgeSpringStrength` is clamped to 1 because a step larger than the gap
			// carries the endpoints past the target and oscillates instead of settling.
			// A factor multiplies that strength, so the product has to respect the same
			// cap — otherwise one `derivedEdgeSpringFactor` above 1/strength puts the
			// clamp back where it started.
			it('never pulls past full strength, however large the factor', () => {
				// The base strength is 0.25, so a factor of 4 is already the whole
				// correction and everything above it is the same move.
				expect(pullFor(8)).toBe(pullFor(4));
				expect(pullFor(64)).toBe(pullFor(4));
			});

			it('lands on the target gap at full strength rather than overshooting it', () => {
				const next = relaxEdgeDistancesStep(
					positions,
					radii,
					[{ sourceNodeId: 'n0', targetNodeId: 'n1', springFactor: 64 }],
					EDGE_DISTANCE_SETTINGS
				);
				expect(gapAmount(next, radii, 'n0', 'n1')).toBeCloseTo(
					(radii.n0 + radii.n1) * EDGE_DISTANCE_SETTINGS.edgeGapMaxRadiusFactor,
					10
				);
			});

			it('exerts nothing at zero', () => {
				expect(pullFor(0)).toBe(0);
			});

			// A negative factor would invert the spring into something that pushes
			// harder the further apart two nodes get, which never settles.
			it('treats a negative factor as zero rather than inverting the spring', () => {
				expect(pullFor(-1)).toBe(0);
			});

			it('treats a non-finite factor as zero', () => {
				expect(pullFor(Number.NaN)).toBe(0);
			});

			// Degree divides each node's displacement, so a forceless edge left in the
			// count would quietly weaken the edges that do pull.
			it('does not let a zero-factor edge dampen the edges that do pull', () => {
				const withDeadEdge = relaxEdgeDistancesStep(
					{ ...positions, n2: { x: 0, y: 300 } },
					{ ...radii, n2: 20 },
					[
						{ sourceNodeId: 'n0', targetNodeId: 'n1' },
						{ sourceNodeId: 'n0', targetNodeId: 'n2', springFactor: 0 }
					],
					EDGE_DISTANCE_SETTINGS
				);
				expect(withDeadEdge.n0?.x).toBeCloseTo(positions.n0.x + pullFor(1), 10);
			});

			it('leaves a zero-factor edge endpoint where it was', () => {
				const next = relaxEdgeDistancesStep(
					positions,
					radii,
					[{ sourceNodeId: 'n0', targetNodeId: 'n1', springFactor: 0 }],
					EDGE_DISTANCE_SETTINGS
				);
				expect(next).toEqual(positions);
			});
		});

		// The band is the rest length: inside it the spring does nothing. A factor
		// that only changed convergence speed would leave the graph unchanged at
		// rest, so these specs relax to rest and look at where the edge ends up.
		describe('per-edge gap factor', () => {
			const radii = { n0: 20, n1: 20, m0: 20, m1: 20 };
			const radiusSum = 40;
			const { edgeGapMinRadiusFactor: minFactor, edgeGapMaxRadiusFactor: maxFactor } =
				EDGE_DISTANCE_SETTINGS;
			// The step stops once a correction is under its epsilon, so a pair
			// approaching the band from outside rests a hair beyond its edge.
			const SETTLE_TOLERANCE = 0.01;

			function settle(positions: Record<string, Point>): Record<string, Point> {
				return relaxGraphPhysics(
					positions,
					radii,
					[
						{ sourceNodeId: 'n0', targetNodeId: 'n1', gapFactor: 2 },
						{ sourceNodeId: 'm0', targetNodeId: 'm1' }
					],
					GRAPH_PHYSICS_SETTINGS,
					200
				);
			}

			it('moves the rest gap of a stretched edge, not just how fast it gets there', () => {
				const next = settle({
					n0: { x: 0, y: 0 },
					n1: { x: 440, y: 0 },
					m0: { x: 0, y: 1000 },
					m1: { x: 440, y: 1000 }
				});

				const scaled = gapAmount(next, radii, 'n0', 'n1');
				const unscaled = gapAmount(next, radii, 'm0', 'm1');
				expect(scaled).toBeGreaterThanOrEqual(2 * minFactor * radiusSum);
				expect(scaled).toBeLessThanOrEqual(2 * maxFactor * radiusSum + SETTLE_TOLERANCE);
				expect(unscaled).toBeGreaterThanOrEqual(minFactor * radiusSum);
				expect(unscaled).toBeLessThanOrEqual(maxFactor * radiusSum + SETTLE_TOLERANCE);
				// Outside the unscaled band altogether, so no strength could have put it there.
				expect(scaled).toBeGreaterThan(maxFactor * radiusSum + SETTLE_TOLERANCE);
			});

			it('moves the rest gap of a compressed edge', () => {
				const next = settle({
					n0: { x: 0, y: 0 },
					n1: { x: 40, y: 0 },
					m0: { x: 0, y: 1000 },
					m1: { x: 40, y: 1000 }
				});

				const scaled = gapAmount(next, radii, 'n0', 'n1');
				const unscaled = gapAmount(next, radii, 'm0', 'm1');
				expect(scaled).toBeGreaterThanOrEqual(2 * minFactor * radiusSum - SETTLE_TOLERANCE);
				expect(scaled).toBeLessThanOrEqual(2 * maxFactor * radiusSum);
				expect(unscaled).toBeGreaterThanOrEqual(minFactor * radiusSum - SETTLE_TOLERANCE);
				expect(unscaled).toBeLessThan(scaled);
			});

			// Unlike `springFactor`, where a bad value means "no pull", a bad gap
			// factor means "unchanged": a zero rest length would collapse the edge.
			it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
				'treats a gap factor of %s exactly like an absent one',
				(gapFactor) => {
					const positions = { n0: { x: 0, y: 0 }, n1: { x: 300, y: 0 } };
					const withFactor = relaxEdgeDistancesStep(
						positions,
						radii,
						[{ sourceNodeId: 'n0', targetNodeId: 'n1', gapFactor }],
						EDGE_DISTANCE_SETTINGS
					);
					const without = relaxEdgeDistancesStep(
						positions,
						radii,
						[{ sourceNodeId: 'n0', targetNodeId: 'n1' }],
						EDGE_DISTANCE_SETTINGS
					);

					expect(withFactor).toEqual(without);
				}
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

		// The ramp is `(hops - minHops + 1) / (maxHops - minHops + 1)` of
		// `hopRepulsionMaxExtraGapRadiusFactor`, over the radius sum, and has been
		// since repulsion existed. Nothing about unreachable pairs may move a pair
		// that has a path between it.
		it('holds a reachable pair to the hop ramp it has always used', () => {
			const positions = { n0: { x: 0, y: 0 }, n3: { x: 40, y: 0 } };
			const radii = { n0: 20, n3: 20 };
			const radiusSum = radii.n0 + radii.n3;

			const next = relaxHopRepulsionStep(
				positions,
				radii,
				{ n0: { n3: 3 }, n3: { n0: 3 } },
				HOP_REPULSION_SETTINGS
			);

			const { hopRepulsionMinHops, hopRepulsionMaxHops, hopRepulsionMaxExtraGapRadiusFactor } =
				HOP_REPULSION_SETTINGS;
			const progress =
				(3 - hopRepulsionMinHops + 1) / (hopRepulsionMaxHops - hopRepulsionMinHops + 1);
			expect(next.n3.x - next.n0.x).toBeCloseTo(
				radiusSum + radiusSum * hopRepulsionMaxExtraGapRadiusFactor * progress,
				10
			);
			expect(next.n0).toEqual({ x: -13.333333333333329, y: 0 });
			expect(next.n3).toEqual({ x: 53.33333333333333, y: 0 });
		});

		// Unreachable is not "very far": clamping `Infinity` to the hop cap gave the
		// one pair whose hop count carries no distance the strongest push in the
		// graph, which flung a freshly imported component away from its host.
		describe('nodes in different components', () => {
			const radii = { n0: 20, far: 20 };
			const radiusSum = radii.n0 + radii.far;
			const UNREACHABLE = { n0: { far: Infinity }, far: { n0: Infinity } };

			it('parts them by a seam rather than the full hop-ramp gap', () => {
				const positions = { n0: { x: 0, y: 0 }, far: { x: 40, y: 0 } };

				const next = relaxHopRepulsionStep(positions, radii, UNREACHABLE, HOP_REPULSION_SETTINGS);

				expect(next.far.x - next.n0.x).toBeCloseTo(radiusSum * 1.1, 10);
			});

			it('stops pushing once they clear the seam, where the hop cap still would', () => {
				const positions = { n0: { x: 0, y: 0 }, far: { x: 60, y: 0 } };

				expect(relaxHopRepulsionStep(positions, radii, UNREACHABLE, HOP_REPULSION_SETTINGS)).toBe(
					positions
				);
				expect(
					relaxHopRepulsionStep(
						positions,
						radii,
						{ n0: { far: HOP_REPULSION_SETTINGS.hopRepulsionMaxHops }, far: { n0: 4 } },
						HOP_REPULSION_SETTINGS
					)
				).not.toBe(positions);
			});

			it('never opens a wider gap than the configured cap', () => {
				const positions = { n0: { x: 0, y: 0 }, far: { x: 40, y: 0 } };

				const next = relaxHopRepulsionStep(positions, radii, UNREACHABLE, {
					...HOP_REPULSION_SETTINGS,
					hopRepulsionMaxExtraGapRadiusFactor: 0.02
				});

				expect(next.far.x - next.n0.x).toBeCloseTo(radiusSum * 1.02, 10);
			});
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

		// HOP_REPULSION_SETTINGS run at strength 1, so one step lands each pair on
		// exactly the distance it wants to hold open.
		describe('per-node repulsion factor', () => {
			const radii = { n0: 20, n2: 20 };
			const radiusSum = 40;
			const TWO_HOPS = { n0: { n2: 2 }, n2: { n0: 2 } };
			const touching = { n0: { x: 0, y: 0 }, n2: { x: 40, y: 0 } };

			function restingDistance(
				repulsionFactorByNodeId?: Record<string, number>,
				hops: Record<string, Record<string, number>> = TWO_HOPS,
				settings = HOP_REPULSION_SETTINGS
			): number {
				const next = relaxHopRepulsionStep(
					touching,
					radii,
					hops,
					settings,
					new Set(),
					undefined,
					undefined,
					repulsionFactorByNodeId
				);
				return next.n2.x - next.n0.x;
			}

			const unscaledExtraGap = restingDistance() - radiusSum;

			it('holds open the geometric mean of the two factors times the unscaled gap', () => {
				expect(unscaledExtraGap).toBeGreaterThan(0);
				// sqrt(4 × 1) = 2
				expect(restingDistance({ n0: 4 }) - radiusSum).toBeCloseTo(2 * unscaledExtraGap, 10);
				expect(restingDistance({ n0: 4, n2: 1 }) - radiusSum).toBeCloseTo(2 * unscaledExtraGap, 10);
			});

			it('holds the unscaled gap when the two factors cancel', () => {
				// sqrt(2 × 0.5) = 1
				expect(restingDistance({ n0: 2, n2: 0.5 })).toBe(restingDistance());
			});

			it('treats a non-finite or non-positive factor as absent', () => {
				for (const factor of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
					expect(restingDistance({ n0: factor })).toBe(restingDistance());
				}
			});

			it('leaves positions bit-identical for an empty map', () => {
				expect(
					relaxHopRepulsionStep(
						touching,
						radii,
						TWO_HOPS,
						HOP_REPULSION_SETTINGS,
						new Set(),
						undefined,
						undefined,
						{}
					)
				).toEqual(relaxHopRepulsionStep(touching, radii, TWO_HOPS, HOP_REPULSION_SETTINGS));
			});

			it('scales the cross-component seam by the same pair factor', () => {
				const unreachable = { n0: { n2: Infinity }, n2: { n0: Infinity } };
				const seam = restingDistance(undefined, unreachable) - radiusSum;

				expect(seam).toBeCloseTo(radiusSum * 0.1, 10);
				expect(restingDistance({ n0: 4 }, unreachable) - radiusSum).toBeCloseTo(2 * seam, 10);
			});

			it('scales the seam after its cap, so a capped seam still widens', () => {
				const unreachable = { n0: { n2: Infinity }, n2: { n0: Infinity } };
				const capped = { ...HOP_REPULSION_SETTINGS, hopRepulsionMaxExtraGapRadiusFactor: 0.02 };

				expect(restingDistance({ n0: 4 }, unreachable, capped) - radiusSum).toBeCloseTo(
					2 * radiusSum * 0.02,
					10
				);
			});
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

		describe('repulsionFactorByNodeId', () => {
			const positions = { n0: { x: 0, y: 0 }, n2: { x: 40, y: 0 } };
			const radii = { n0: 20, n2: 20 };
			const hops = { n0: { n2: 2 }, n2: { n0: 2 } };
			const settings = { ...EDGE_DISTANCE_SETTINGS, ...HOP_REPULSION_SETTINGS };

			function relax(repulsionFactorByNodeId?: Record<string, number>): Record<string, Point> {
				return relaxGraphPhysics(
					positions,
					radii,
					[],
					settings,
					4,
					new Set(),
					hops,
					undefined,
					undefined,
					repulsionFactorByNodeId
				);
			}

			it('reaches hop repulsion, pushing a spaced-out pair further apart', () => {
				expect(gapAmount(relax({ n0: 4 }), radii, 'n0', 'n2')).toBeGreaterThan(
					gapAmount(relax(), radii, 'n0', 'n2')
				);
			});

			it('changes nothing when empty', () => {
				expect(relax({})).toEqual(relax());
			});
		});
	});
});
