/**
 * Recognizing a hold on a quantity chip, without a DOM.
 *
 * A chip asks a different question from the canvas underneath it — "where is
 * this defined?" rather than "what can I do with this node?" — and it answers on
 * a shorter hold, because the reader is already pointing at one small target.
 * So the threshold is its own tunable rather than the canvas's, and everything
 * that decides whether a hold counts lives here where a spec can pin it.
 *
 * Drift is accumulated rather than sampled: a finger that wanders off the chip
 * and comes back has still wandered, and treating the final position as the
 * whole story would let a scrub through the columns land on a peek.
 */

import { APP_CONFIG } from '$lib/appConfig';
import { recognizeLongPress } from './longPress';

export interface ChipPressPoint {
	x: number;
	y: number;
}

/** One press in flight, from the pointerdown that began it. */
export interface ChipPress {
	/** The quantity key the press began on — a press never transfers to another chip. */
	key: string;
	origin: ChipPressPoint;
	startedAtMs: number;
	/** The furthest the pointer has been from the origin, not where it is now. */
	maxDistance: number;
}

/** How long a chip has to be held, and how far the pointer may wander doing it. */
export interface ChipLongPressThresholds {
	/** Only this key counts; a press that began elsewhere never matches. */
	key?: string;
	minDuration?: number;
	maxDistance?: number;
}

export const CHIP_PEEK_LONG_PRESS_MS = APP_CONFIG.multigraph.dataflow.chipPeekLongPressMs;
export const CHIP_PEEK_MAX_DRIFT_PX = APP_CONFIG.interaction.longPressDistancePx;

export function beginChipPress(key: string, point: ChipPressPoint, nowMs: number): ChipPress {
	return { key, origin: { x: point.x, y: point.y }, startedAtMs: nowMs, maxDistance: 0 };
}

function distanceFrom(origin: ChipPressPoint, point: ChipPressPoint): number {
	return Math.hypot(point.x - origin.x, point.y - origin.y);
}

/** The same press with its drift updated. Immutable, like every other mutation here. */
export function trackChipPress(press: ChipPress, point: ChipPressPoint): ChipPress {
	const distance = distanceFrom(press.origin, point);
	if (distance <= press.maxDistance) return press;
	return { ...press, maxDistance: distance };
}

/**
 * Whether the press in flight has become a hold. Null presses answer false so a
 * timer that outlived its press needs no separate guard at the call site.
 */
export function isChipLongPress(
	press: ChipPress | null,
	nowMs: number,
	{
		key,
		minDuration = CHIP_PEEK_LONG_PRESS_MS,
		maxDistance = CHIP_PEEK_MAX_DRIFT_PX
	}: ChipLongPressThresholds = {}
): boolean {
	if (press === null) return false;
	if (key !== undefined && key !== press.key) return false;
	return recognizeLongPress({
		duration: nowMs - press.startedAtMs,
		distance: press.maxDistance,
		minDuration,
		maxDistance
	});
}
