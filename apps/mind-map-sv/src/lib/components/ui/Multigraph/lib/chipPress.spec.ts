import { describe, expect, it } from 'vitest';
import {
	CHIP_PEEK_LONG_PRESS_MS,
	beginChipPress,
	isChipLongPress,
	trackChipPress
} from './chipPress';

describe('chipPress', () => {
	const thresholds = { minDuration: 500, maxDistance: 8 };
	const origin = { x: 100, y: 100 };

	it('does not fire before the threshold', () => {
		const press = beginChipPress('g', origin, 1000);
		expect(isChipLongPress(press, 1499, thresholds)).toBe(false);
	});

	it('fires at exactly the threshold', () => {
		const press = beginChipPress('g', origin, 1000);
		expect(isChipLongPress(press, 1500, thresholds)).toBe(true);
	});

	it('accumulates the furthest drift rather than the latest position', () => {
		// A finger that wandered off the chip has wandered, however tidily it came
		// back — reading only the final position would let a scrub open a peek.
		let press = beginChipPress('g', origin, 1000);
		press = trackChipPress(press, { x: 140, y: 100 });
		press = trackChipPress(press, origin);

		expect(press.maxDistance).toBe(40);
		expect(isChipLongPress(press, 1500, thresholds)).toBe(false);
	});

	it('allows drift up to the threshold', () => {
		let press = beginChipPress('g', origin, 1000);
		press = trackChipPress(press, { x: 108, y: 100 });

		expect(isChipLongPress(press, 1500, thresholds)).toBe(true);
	});

	it('never matches a press that began on another chip', () => {
		// The timer is armed for the key the press started on; a press that moved to
		// a different chip is a different question.
		const press = beginChipPress('g', origin, 1000);
		expect(isChipLongPress(press, 1500, { ...thresholds, key: 'm' })).toBe(false);
		expect(isChipLongPress(press, 1500, { ...thresholds, key: 'g' })).toBe(true);
	});

	it('answers false with no press in flight', () => {
		expect(isChipLongPress(null, 9999, thresholds)).toBe(false);
	});

	it('defaults to the configured chip hold, which is shorter than the canvas one', () => {
		const press = beginChipPress('g', origin, 0);
		expect(isChipLongPress(press, CHIP_PEEK_LONG_PRESS_MS - 1)).toBe(false);
		expect(isChipLongPress(press, CHIP_PEEK_LONG_PRESS_MS)).toBe(true);
	});
});
