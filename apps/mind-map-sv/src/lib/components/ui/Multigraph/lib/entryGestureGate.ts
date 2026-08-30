export type EntryGestureDirection = 'in' | 'out';

export interface EntryGestureGateState {
	swallowing: boolean;
	startedAtMs: number;
	swallowUntilMs: number;
	direction: EntryGestureDirection | null;
}

interface EntryGestureGateStep {
	state: EntryGestureGateState;
	swallow: boolean;
}

export const EMPTY_ENTRY_GESTURE_GATE: EntryGestureGateState = {
	swallowing: false,
	startedAtMs: 0,
	swallowUntilMs: 0,
	direction: null
};

export function beginEntryGestureGate(
	direction: EntryGestureDirection,
	nowMs: number,
	idleMs: number,
	maxMs: number
): EntryGestureGateState {
	if (idleMs <= 0 || maxMs <= 0) return EMPTY_ENTRY_GESTURE_GATE;
	return {
		swallowing: true,
		startedAtMs: nowMs,
		swallowUntilMs: nowMs + idleMs,
		direction
	};
}

export function stepEntryGestureGate(
	state: EntryGestureGateState,
	input: { direction: EntryGestureDirection },
	nowMs: number,
	idleMs: number,
	maxMs: number
): EntryGestureGateStep {
	if (!state.swallowing || idleMs <= 0 || maxMs <= 0) {
		return { state: EMPTY_ENTRY_GESTURE_GATE, swallow: false };
	}
	if (input.direction !== state.direction) {
		return { state: EMPTY_ENTRY_GESTURE_GATE, swallow: false };
	}
	const elapsedMs = nowMs - state.startedAtMs;
	if (elapsedMs > maxMs || nowMs > state.swallowUntilMs) {
		return { state: EMPTY_ENTRY_GESTURE_GATE, swallow: false };
	}
	const effectiveIdleMs = entryGestureIdleMsForElapsed(elapsedMs, idleMs, maxMs);
	return {
		state: {
			swallowing: true,
			startedAtMs: state.startedAtMs,
			swallowUntilMs: nowMs + effectiveIdleMs,
			direction: state.direction
		},
		swallow: true
	};
}

export function entryGestureIdleMsForElapsed(
	elapsedMs: number,
	idleMs: number,
	maxMs: number
): number {
	if (idleMs <= 0 || maxMs <= 0) return 0;
	const remainingRatio = Math.max(0, Math.min(1, (maxMs - Math.max(0, elapsedMs)) / maxMs));
	return idleMs * remainingRatio;
}
