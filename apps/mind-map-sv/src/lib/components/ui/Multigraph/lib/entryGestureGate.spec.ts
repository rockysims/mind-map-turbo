import { describe, expect, it } from 'vitest';
import {
	beginEntryGestureGate,
	EMPTY_ENTRY_GESTURE_GATE,
	stepEntryGestureGate
} from './entryGestureGate';

describe('entry gesture gate', () => {
	it('swallows entry zoom-in input and extends while the gesture continues', () => {
		let gate = beginEntryGestureGate(1000, 160);

		const first = stepEntryGestureGate(gate, { zoomingIn: true }, 1100, 160);
		expect(first.swallow).toBe(true);
		expect(first.state.swallowUntilMs).toBe(1260);

		gate = first.state;
		const continued = stepEntryGestureGate(gate, { zoomingIn: true }, 1230, 160);
		expect(continued.swallow).toBe(true);
		expect(continued.state.swallowUntilMs).toBe(1390);
	});

	it('lets a fresh zoom-in through after the gesture goes idle', () => {
		const gate = beginEntryGestureGate(1000, 160);

		const next = stepEntryGestureGate(gate, { zoomingIn: true }, 1200, 160);

		expect(next).toEqual({ state: EMPTY_ENTRY_GESTURE_GATE, swallow: false });
	});

	it('cancels immediately when the user reverses direction', () => {
		const gate = beginEntryGestureGate(1000, 160);

		const next = stepEntryGestureGate(gate, { zoomingIn: false }, 1050, 160);

		expect(next).toEqual({ state: EMPTY_ENTRY_GESTURE_GATE, swallow: false });
	});

	it('stays inactive when no idle gap is configured', () => {
		const gate = beginEntryGestureGate(1000, 0);

		expect(gate).toBe(EMPTY_ENTRY_GESTURE_GATE);
		expect(stepEntryGestureGate(gate, { zoomingIn: true }, 1000, 0)).toEqual({
			state: EMPTY_ENTRY_GESTURE_GATE,
			swallow: false
		});
	});
});
