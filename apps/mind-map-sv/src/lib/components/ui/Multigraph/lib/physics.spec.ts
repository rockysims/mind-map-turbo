import { describe, expect, it } from 'vitest';
import { relaxOverlaps, relaxOverlapsStep } from './physics';
import type { Point } from '../../types/multigraph';

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

describe('physics', () => {
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
});
