export interface EntryGestureGateState {
	swallowing: boolean;
	swallowUntilMs: number;
}

export interface EntryGestureGateStep {
	state: EntryGestureGateState;
	swallow: boolean;
}

export const EMPTY_ENTRY_GESTURE_GATE: EntryGestureGateState = {
	swallowing: false,
	swallowUntilMs: 0
};

export function beginEntryGestureGate(nowMs: number, idleMs: number): EntryGestureGateState {
	if (idleMs <= 0) return EMPTY_ENTRY_GESTURE_GATE;
	return {
		swallowing: true,
		swallowUntilMs: nowMs + idleMs
	};
}

export function stepEntryGestureGate(
	state: EntryGestureGateState,
	input: { zoomingIn: boolean },
	nowMs: number,
	idleMs: number
): EntryGestureGateStep {
	if (!state.swallowing || idleMs <= 0) {
		return { state: EMPTY_ENTRY_GESTURE_GATE, swallow: false };
	}
	if (!input.zoomingIn) {
		return { state: EMPTY_ENTRY_GESTURE_GATE, swallow: false };
	}
	if (nowMs > state.swallowUntilMs) {
		return { state: EMPTY_ENTRY_GESTURE_GATE, swallow: false };
	}
	return {
		state: {
			swallowing: true,
			swallowUntilMs: nowMs + idleMs
		},
		swallow: true
	};
}
