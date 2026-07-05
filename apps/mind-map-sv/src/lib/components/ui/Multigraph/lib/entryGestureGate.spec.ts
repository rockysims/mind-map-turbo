import { describe, expect, it } from 'vitest';
import {
	beginEntryGestureGate,
	EMPTY_ENTRY_GESTURE_GATE,
	entryGestureIdleMsForElapsed,
	stepEntryGestureGate
} from './entryGestureGate';

describe('entry gesture gate', () => {
	it('swallows entry zoom-in input and extends while the gesture continues', () => {
		let gate = beginEntryGestureGate('in', 1000, 160, 400);

		const first = stepEntryGestureGate(gate, { direction: 'in' }, 1100, 160, 400);
		expect(first.swallow).toBe(true);
		expect(first.state.swallowUntilMs).toBe(1220);

		gate = first.state;
		const continued = stepEntryGestureGate(gate, { direction: 'in' }, 1210, 160, 400);
		expect(continued.swallow).toBe(true);
		expect(continued.state.swallowUntilMs).toBe(1286);
	});

	it('swallows entry zoom-out input using the same direction-aware gate', () => {
		const gate = beginEntryGestureGate('out', 1000, 160, 400);

		const next = stepEntryGestureGate(gate, { direction: 'out' }, 1100, 160, 400);

		expect(next.swallow).toBe(true);
		expect(next.state.swallowUntilMs).toBe(1220);
		expect(next.state.direction).toBe('out');
	});

	it('lets a fresh same-direction gesture through after the gate goes idle', () => {
		const gate = beginEntryGestureGate('in', 1000, 160, 400);

		const next = stepEntryGestureGate(gate, { direction: 'in' }, 1200, 160, 400);

		expect(next).toEqual({ state: EMPTY_ENTRY_GESTURE_GATE, swallow: false });
	});

	it('stops swallowing after the hard cap even when the idle deadline was extended', () => {
		const gate = beginEntryGestureGate('out', 1000, 240, 300);

		const next = stepEntryGestureGate(gate, { direction: 'out' }, 1310, 240, 300);

		expect(next).toEqual({ state: EMPTY_ENTRY_GESTURE_GATE, swallow: false });
	});

	it('cancels immediately when the user reverses direction', () => {
		const gate = beginEntryGestureGate('in', 1000, 160, 400);

		const next = stepEntryGestureGate(gate, { direction: 'out' }, 1050, 160, 400);

		expect(next).toEqual({ state: EMPTY_ENTRY_GESTURE_GATE, swallow: false });
	});

	it('stays inactive when no idle gap is configured', () => {
		const gate = beginEntryGestureGate('in', 1000, 0, 400);

		expect(gate).toBe(EMPTY_ENTRY_GESTURE_GATE);
		expect(stepEntryGestureGate(gate, { direction: 'in' }, 1000, 0, 400)).toEqual({
			state: EMPTY_ENTRY_GESTURE_GATE,
			swallow: false
		});
	});

	it('shrinks the effective idle gap as swallow duration grows', () => {
		expect(entryGestureIdleMsForElapsed(0, 180, 420)).toBe(180);
		expect(entryGestureIdleMsForElapsed(210, 180, 420)).toBe(90);
		expect(entryGestureIdleMsForElapsed(420, 180, 420)).toBe(0);
	});
});
