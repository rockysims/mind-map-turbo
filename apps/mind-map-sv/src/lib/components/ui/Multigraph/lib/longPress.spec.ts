import { describe, expect, it } from 'vitest';
import { recognizeLongPress } from './longPress';

describe('recognizeLongPress', () => {
	const minDuration = 500;
	const maxDistance = 8;

	it('rejects durations below the threshold', () => {
		expect(recognizeLongPress({ duration: 499, distance: 0, minDuration, maxDistance })).toBe(
			false
		);
	});

	it('accepts durations at and above the threshold', () => {
		expect(recognizeLongPress({ duration: 500, distance: 0, minDuration, maxDistance })).toBe(true);
		expect(recognizeLongPress({ duration: 750, distance: 0, minDuration, maxDistance })).toBe(true);
	});

	it('accepts movement at or below the distance threshold', () => {
		expect(recognizeLongPress({ duration: 500, distance: 8, minDuration, maxDistance })).toBe(true);
		expect(recognizeLongPress({ duration: 500, distance: 4, minDuration, maxDistance })).toBe(true);
	});

	it('rejects movement above the distance threshold', () => {
		expect(recognizeLongPress({ duration: 500, distance: 9, minDuration, maxDistance })).toBe(
			false
		);
	});
});
