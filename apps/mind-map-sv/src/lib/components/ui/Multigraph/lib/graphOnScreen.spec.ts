import { describe, expect, it } from 'vitest';
import { anyCircleOnScreen, graphIsLost } from './graphOnScreen';

const viewport = { left: 0, top: 0, width: 800, height: 600 };

describe('anyCircleOnScreen', () => {
	it('sees a circle in the middle of the viewport', () => {
		expect(anyCircleOnScreen([{ center: { x: 400, y: 300 }, radius: 20 }], viewport)).toBe(true);
	});

	it('sees a circle whose centre is outside but whose edge reaches in', () => {
		expect(anyCircleOnScreen([{ center: { x: -30, y: 300 }, radius: 40 }], viewport)).toBe(true);
	});

	it('does not see a circle that falls entirely short of every edge', () => {
		expect(anyCircleOnScreen([{ center: { x: -200, y: 300 }, radius: 40 }], viewport)).toBe(false);
		expect(anyCircleOnScreen([{ center: { x: 400, y: 900 }, radius: 40 }], viewport)).toBe(false);
	});

	it('needs only one of many to be on screen', () => {
		expect(
			anyCircleOnScreen(
				[
					{ center: { x: -900, y: -900 }, radius: 10 },
					{ center: { x: 5000, y: 5000 }, radius: 10 },
					{ center: { x: 10, y: 10 }, radius: 10 }
				],
				viewport
			)
		).toBe(true);
	});

	it('honours a viewport that does not start at the origin', () => {
		const offset = { left: 100, top: 50, width: 200, height: 200 };
		expect(anyCircleOnScreen([{ center: { x: 150, y: 100 }, radius: 5 }], offset)).toBe(true);
		expect(anyCircleOnScreen([{ center: { x: 50, y: 100 }, radius: 5 }], offset)).toBe(false);
	});
});

describe('graphIsLost', () => {
	it('is true when there are nodes and none of them are on screen', () => {
		expect(graphIsLost([{ center: { x: -5000, y: 0 }, radius: 10 }], viewport)).toBe(true);
	});

	it('is false while any node is still on screen', () => {
		expect(graphIsLost([{ center: { x: 400, y: 300 }, radius: 10 }], viewport)).toBe(false);
	});

	it('is false for an empty graph, which has nothing to bring back', () => {
		expect(graphIsLost([], viewport)).toBe(false);
	});
});
