export type EntryGestureDirection = 'in' | 'out';

export interface EntryGestureGateState {
	swallowing: boolean;
	swallowUntilMs: number;
	direction: EntryGestureDirection | null;
}

export interface EntryGestureGateStep {
	state: EntryGestureGateState;
	swallow: boolean;
}

export const EMPTY_ENTRY_GESTURE_GATE: EntryGestureGateState = {
	swallowing: false,
	swallowUntilMs: 0,
	direction: null
};

export function beginEntryGestureGate(
	direction: EntryGestureDirection,
	nowMs: number,
	idleMs: number
): EntryGestureGateState {
	if (idleMs <= 0) return EMPTY_ENTRY_GESTURE_GATE;
	return {
		swallowing: true,
		swallowUntilMs: nowMs + idleMs,
		direction
	};
}

export function stepEntryGestureGate(
	state: EntryGestureGateState,
	input: { direction: EntryGestureDirection },
	nowMs: number,
	idleMs: number
): EntryGestureGateStep {
	if (!state.swallowing || idleMs <= 0) {
		return { state: EMPTY_ENTRY_GESTURE_GATE, swallow: false };
	}
	if (input.direction !== state.direction) {
		return { state: EMPTY_ENTRY_GESTURE_GATE, swallow: false };
	}
	if (nowMs > state.swallowUntilMs) {
		return { state: EMPTY_ENTRY_GESTURE_GATE, swallow: false };
	}
	return {
		state: {
			swallowing: true,
			swallowUntilMs: nowMs + idleMs,
			direction: state.direction
		},
		swallow: true
	};
}
