import { describe, expect, it } from 'vitest';
import { wheelDeltaForZoomFactor } from './graphMath';
import {
	clampZoomWorldState,
	pinchZoomWorld,
	pinchZoomWorldStep,
	wheelExitBoundaryAmount,
	wheelZoomWorld,
	worldRectForState,
	zoomWorldAtPoint
} from './zoomWorldController';

const bounds = {
	width: 800,
	height: 600,
	subjectWidth: 400,
	subjectHeight: 300,
	minScale: 1,
	maxScale: 6,
	wheelSensitivity: 0.002,
	exitDeltaScale: 500
};

describe('zoom world controller', () => {
	it('keeps the focal point stable while zooming', () => {
		const next = zoomWorldAtPoint({ panX: 0, panY: 0, scale: 1 }, 3, { x: 500, y: 300 }, bounds);

		expect(next.scale).toBe(3);
		expect(next.panX).toBeLessThan(0);
	});

	it('cover-clamps large worlds and recenters worlds that fit', () => {
		const covered = clampZoomWorldState({ panX: 500, panY: 0, scale: 3 }, bounds);
		const coveredRect = worldRectForState(covered, bounds);
		expect(coveredRect.left).toBeLessThanOrEqual(0);
		expect(coveredRect.left + coveredRect.width).toBeGreaterThanOrEqual(bounds.width);

		const fit = clampZoomWorldState({ panX: 100, panY: -80, scale: 1 }, bounds);
		expect(fit.panX).toBe(0);
		expect(fit.panY).toBe(0);
	});

	it('feeds exit accumulation only after the world is at centered fit', () => {
		const shrinking = wheelZoomWorld(
			{ panX: 120, panY: 80, scale: 2 },
			200,
			{ x: 400, y: 300 },
			bounds
		);
		expect(shrinking.exitBoundaryDelta).toBe(0);
		expect(shrinking.state.scale).toBeGreaterThan(1);

		// Said as a factor rather than as a delta: what this case is about is a
		// request for 0.75x from a fit scale of 1, which is halfway into a
		// half-width exit zone. A raw delta would only mean that under one
		// particular zoom curve — which is how the linear one used to be pinned here.
		const boundary = wheelZoomWorld(
			{ panX: 0, panY: 0, scale: 1 },
			wheelDeltaForZoomFactor(0.75, bounds.wheelSensitivity),
			{ x: 400, y: 300 },
			{ ...bounds, exitZoneFraction: 0.5 }
		);
		expect(boundary.state).toEqual({ panX: 0, panY: 0, scale: 1 });
		expect(boundary.exitBoundaryDelta).toBe(0.5);
		expect(boundary.exitProgress).toBe(0.5);
	});

	it('reverses exit boundary pressure proportionally', () => {
		const exiting = wheelExitBoundaryAmount(0.75, -10, {
			...bounds,
			exitZoneFraction: 0.5
		});
		expect(exiting).toBeGreaterThan(0);
		expect(exiting).toBeLessThan(0.75);

		const continuing = wheelExitBoundaryAmount(exiting, 10, {
			...bounds,
			exitZoneFraction: 0.5
		});
		expect(continuing).toBeGreaterThan(exiting);
		expect(continuing).toBeLessThan(1);

		expect(wheelExitBoundaryAmount(0.1, -5000, { ...bounds, exitZoneFraction: 0.5 })).toBe(0);
		expect(wheelExitBoundaryAmount(0.9, 5000, { ...bounds, exitZoneFraction: 0.5 })).toBe(1);
	});

	it('reports entryBoundaryDelta only for a zoom-in blocked at max scale', () => {
		// Not blocked: a gentle zoom-in that stays below maxScale reports 0.
		const belowMax = wheelZoomWorld(
			{ panX: 0, panY: 0, scale: 2 },
			-100,
			{ x: 400, y: 300 },
			{ ...bounds, maxScale: 6, entryBoundaryZoneFraction: 0.5 }
		);
		expect(belowMax.state.scale).toBeLessThan(6);
		expect(belowMax.entryBoundaryDelta).toBe(0);

		// Blocked at max: a bold zoom-in overshoots maxScale and reports pressure.
		const blocked = wheelZoomWorld(
			{ panX: 0, panY: 0, scale: 6 },
			-1000,
			{ x: 400, y: 300 },
			{ ...bounds, maxScale: 6, entryBoundaryZoneFraction: 0.5 }
		);
		expect(blocked.state.scale).toBe(6);
		expect(blocked.entryBoundaryDelta).toBe(1);

		// A gentle press just inside the zone reports a partial fraction.
		const partial = wheelZoomWorld(
			{ panX: 0, panY: 0, scale: 6 },
			-50,
			{ x: 400, y: 300 },
			{ ...bounds, maxScale: 6, entryBoundaryZoneFraction: 0.5 }
		);
		expect(partial.state.scale).toBe(6);
		expect(partial.entryBoundaryDelta).toBeGreaterThan(0);
		expect(partial.entryBoundaryDelta).toBeLessThan(1);

		// Zoom-out never reports descend pressure.
		const zoomOut = wheelZoomWorld(
			{ panX: 0, panY: 0, scale: 6 },
			1000,
			{ x: 400, y: 300 },
			{ ...bounds, maxScale: 6, entryBoundaryZoneFraction: 0.5 }
		);
		expect(zoomOut.entryBoundaryDelta).toBe(0);
	});

	it('uses the same focal transform for pinch and wheel consumers', () => {
		const focalPoint = { x: 300, y: 260 };
		const wheel = zoomWorldAtPoint({ panX: 0, panY: 0, scale: 1 }, 1.75, focalPoint, bounds);
		const pinch = pinchZoomWorld({ panX: 0, panY: 0, scale: 1 }, 1, 1.75, focalPoint, bounds);

		expect(pinch).toEqual(wheel);
	});

	it('descends exactly at the entry inscribe scale with large wheel and pinch steps', () => {
		const wheel = wheelZoomWorld(
			{ panX: 0, panY: 0, scale: 2.5 },
			-1000,
			{ x: 400, y: 300 },
			{ ...bounds, maxScale: 3, entryInscribeScale: 3, entryZoneFraction: 0.2 }
		);
		const pinch = pinchZoomWorldStep(
			{ panX: 0, panY: 0, scale: 2.5 },
			2.5,
			2,
			{ x: 400, y: 300 },
			{ ...bounds, maxScale: 3, entryInscribeScale: 3, entryZoneFraction: 0.2 }
		);

		expect(wheel.state.scale).toBe(3);
		expect(wheel.entryProgress).toBe(1);
		expect(wheel.boundary).toBe('descend');
		expect(pinch.state.scale).toBe(3);
		expect(pinch.entryProgress).toBe(1);
		expect(pinch.boundary).toBe('descend');
	});

	it('recenters to fit before the sub-fit zone reaches zero and ascends', () => {
		const recentered = wheelZoomWorld(
			{ panX: 120, panY: 0, scale: 1 },
			5000,
			{ x: 400, y: 300 },
			bounds
		);
		expect(recentered.state).toEqual({ panX: 0, panY: 0, scale: 1 });
		expect(recentered.exitProgress).toBe(0);
		expect(recentered.boundary).toBe('ascend');

		const centered = wheelZoomWorld(
			{ panX: 0, panY: 0, scale: 1 },
			5000,
			{ x: 400, y: 300 },
			bounds
		);
		expect(centered.boundary).toBe('ascend');
		expect(centered.exitProgress).toBe(0);
	});
});
