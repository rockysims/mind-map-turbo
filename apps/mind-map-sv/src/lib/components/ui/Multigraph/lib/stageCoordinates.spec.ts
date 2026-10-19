import { describe, expect, it } from 'vitest';
import {
	clientPointToGraphPoint,
	graphPointToClientPoint,
	rectFromCorners,
	usableStageRect,
	hasSize
} from './stageCoordinates';

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

describe('rectFromCorners', () => {
	const expected = { left: 10, top: 20, width: 30, height: 40 };

	it('spans the two corners when the second is below and to the right', () => {
		expect(rectFromCorners({ x: 10, y: 20 }, { x: 40, y: 60 })).toEqual(expected);
	});

	it('gives the same rect whichever diagonal and direction the corners come from', () => {
		expect(rectFromCorners({ x: 40, y: 60 }, { x: 10, y: 20 })).toEqual(expected);
		expect(rectFromCorners({ x: 40, y: 20 }, { x: 10, y: 60 })).toEqual(expected);
		expect(rectFromCorners({ x: 10, y: 60 }, { x: 40, y: 20 })).toEqual(expected);
	});

	it('never reports a negative size', () => {
		const rect = rectFromCorners({ x: 5, y: 5 }, { x: -15, y: -25 });
		expect(rect).toEqual({ left: -15, top: -25, width: 20, height: 30 });
	});

	it('collapses to a point when both corners coincide', () => {
		expect(rectFromCorners({ x: 7, y: 9 }, { x: 7, y: 9 })).toEqual({
			left: 7,
			top: 9,
			width: 0,
			height: 0
		});
	});
});

describe('usableStageRect', () => {
	const good = { left: 0, top: 0, width: 800, height: 600 };
	const older = { left: 1, top: 1, width: 10, height: 10 };
	const empty = { left: 0, top: 0, width: 0, height: 0 };

	it('uses the current measurement when it has size', () => {
		expect(usableStageRect(good, older)).toBe(good);
		expect(usableStageRect(good, null)).toBe(good);
	});

	it('falls back to the last good measurement when the current one is empty', () => {
		expect(usableStageRect(empty, good)).toBe(good);
		expect(usableStageRect({ left: 0, top: 0, width: 800, height: 0 }, good)).toBe(good);
		expect(usableStageRect({ left: 0, top: 0, width: Number.NaN, height: 600 }, good)).toBe(good);
	});

	it('hands back whatever there is when nothing good was ever measured', () => {
		expect(usableStageRect(empty, null)).toBe(empty);
		expect(usableStageRect(null, null)).toBeNull();
	});

	it('knows which measurements have size', () => {
		expect(hasSize(good)).toBe(true);
		expect(hasSize(empty)).toBe(false);
	});
});
