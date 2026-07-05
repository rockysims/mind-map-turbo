import { describe, expect, it } from 'vitest';
import {
	beginEntryGestureGate,
	EMPTY_ENTRY_GESTURE_GATE,
	stepEntryGestureGate
} from './entryGestureGate';

describe('entry gesture gate', () => {
	it('swallows entry zoom-in input and extends while the gesture continues', () => {
		let gate = beginEntryGestureGate('in', 1000, 160);

		const first = stepEntryGestureGate(gate, { direction: 'in' }, 1100, 160);
		expect(first.swallow).toBe(true);
		expect(first.state.swallowUntilMs).toBe(1260);

		gate = first.state;
		const continued = stepEntryGestureGate(gate, { direction: 'in' }, 1230, 160);
		expect(continued.swallow).toBe(true);
		expect(continued.state.swallowUntilMs).toBe(1390);
	});

	it('swallows entry zoom-out input using the same direction-aware gate', () => {
		const gate = beginEntryGestureGate('out', 1000, 160);

		const next = stepEntryGestureGate(gate, { direction: 'out' }, 1100, 160);

		expect(next.swallow).toBe(true);
		expect(next.state.swallowUntilMs).toBe(1260);
		expect(next.state.direction).toBe('out');
	});

	it('lets a fresh same-direction gesture through after the gate goes idle', () => {
		const gate = beginEntryGestureGate('in', 1000, 160);

		const next = stepEntryGestureGate(gate, { direction: 'in' }, 1200, 160);

		expect(next).toEqual({ state: EMPTY_ENTRY_GESTURE_GATE, swallow: false });
	});

	it('cancels immediately when the user reverses direction', () => {
		const gate = beginEntryGestureGate('in', 1000, 160);

		const next = stepEntryGestureGate(gate, { direction: 'out' }, 1050, 160);

		expect(next).toEqual({ state: EMPTY_ENTRY_GESTURE_GATE, swallow: false });
	});

	it('stays inactive when no idle gap is configured', () => {
		const gate = beginEntryGestureGate('in', 1000, 0);

		expect(gate).toBe(EMPTY_ENTRY_GESTURE_GATE);
		expect(stepEntryGestureGate(gate, { direction: 'in' }, 1000, 0)).toEqual({
			state: EMPTY_ENTRY_GESTURE_GATE,
			swallow: false
		});
	});
});
