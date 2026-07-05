import { describe, expect, it } from 'vitest';
import {
	clampZoomWorldState,
	pinchZoomWorld,
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

		const boundary = wheelZoomWorld(
			{ panX: 0, panY: 0, scale: 1 },
			250,
			{ x: 400, y: 300 },
			bounds
		);
		expect(boundary.state).toEqual({ panX: 0, panY: 0, scale: 1 });
		expect(boundary.exitBoundaryDelta).toBe(0.5);
	});

	it('uses the same focal transform for pinch and wheel consumers', () => {
		const focalPoint = { x: 300, y: 260 };
		const wheel = zoomWorldAtPoint({ panX: 0, panY: 0, scale: 1 }, 1.75, focalPoint, bounds);
		const pinch = pinchZoomWorld({ panX: 0, panY: 0, scale: 1 }, 1, 1.75, focalPoint, bounds);

		expect(pinch).toEqual(wheel);
	});
});
