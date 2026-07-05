import { describe, expect, it } from 'vitest';
import { clampImageZoomState, imageFitScale, imageZoomLimits, zoomImageAtPoint } from './imageZoom';

const bounds = { viewportWidth: 500, viewportHeight: 300, naturalWidth: 1000, naturalHeight: 500 };

describe('image zoom math', () => {
	it('fits images inside the viewport', () => {
		expect(imageFitScale(bounds)).toBe(0.5);
		expect(imageZoomLimits(bounds).maxScale).toBeGreaterThan(1);
	});

	it('clamps pan so the image remains reachable', () => {
		const clamped = clampImageZoomState({ panX: 10_000, panY: -10_000, scale: 2 }, bounds);

		expect(clamped.panX).toBeLessThan(10_000);
		expect(clamped.panY).toBeGreaterThan(-10_000);
	});

	it('zooms around a focal point', () => {
		const next = zoomImageAtPoint(
			{ panX: 0, panY: 0, scale: 0.5 },
			1,
			{ x: 300, y: 150 },
			{ x: 250, y: 150 },
			bounds
		);

		expect(next.scale).toBe(1);
		expect(next.panX).toBeLessThan(0);
	});
});
