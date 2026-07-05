import { describe, expect, it } from 'vitest';
import { clientPointToGraphPoint, graphPointToClientPoint } from './stageCoordinates';

describe('clientPointToGraphPoint', () => {
	const stageRect = { left: 0, top: 0, width: 100, height: 100 };

	it('converts client points to center-origin graph points without pan or zoom', () => {
		expect(clientPointToGraphPoint({ x: 60, y: 40 }, stageRect)).toEqual({ x: 10, y: -10 });
	});

	it('accounts for pan before returning graph-local coordinates', () => {
		expect(clientPointToGraphPoint({ x: 60, y: 40 }, stageRect, { x: 10, y: -20 })).toEqual({
			x: 0,
			y: 10
		});
	});

	it('accounts for zoom by dividing the centered point by scale', () => {
		expect(clientPointToGraphPoint({ x: 70, y: 30 }, stageRect, { x: 0, y: 0 }, 2)).toEqual({
			x: 10,
			y: -10
		});
	});

	it('round-trips graph and client points across stage rect, pan, and scale', () => {
		const rect = { left: 24, top: 12, width: 320, height: 180 };
		const pan = { x: -40, y: 65 };
		const scale = 2.5;
		const graphPoint = { x: 18, y: -36 };
		const clientPoint = graphPointToClientPoint(graphPoint, rect, pan, scale);

		expect(clientPointToGraphPoint(clientPoint, rect, pan, scale).x).toBeCloseTo(graphPoint.x);
		expect(clientPointToGraphPoint(clientPoint, rect, pan, scale).y).toBeCloseTo(graphPoint.y);
	});
});
