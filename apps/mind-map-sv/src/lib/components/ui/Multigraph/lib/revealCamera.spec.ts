import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_SCALE, DEFAULT_MIN_SCALE } from './graphMath';
import {
	cameraViewAt,
	minimalRevealView,
	rectContainsRect,
	revealPursuitStep,
	viewportWorldRect,
	type CameraViewState,
	type RevealCircle,
	type RevealPursuit,
	type StageSize,
	type WorldRect
} from './revealCamera';

const STAGE: StageSize = { width: 400, height: 300 };
/** Pan 0 at scale 1 on `STAGE` shows world x ∈ [-200, 200], y ∈ [-150, 150]. */
const NEUTRAL: CameraViewState = { panX: 0, panY: 0, scale: 1 };

function circleRect(target: RevealCircle, margin = 0): WorldRect {
	const padded = target.radius + margin;
	return {
		minX: target.center.x - padded,
		minY: target.center.y - padded,
		maxX: target.center.x + padded,
		maxY: target.center.y + padded
	};
}

/** The reveal, resolved against the viewport `view` implies. */
function reveal(
	view: CameraViewState,
	target: RevealCircle,
	options: { margin?: number } = {}
): CameraViewState | null {
	return minimalRevealView({
		viewport: viewportWorldRect(view, STAGE),
		target,
		stage: STAGE,
		margin: options.margin
	});
}

describe('viewportWorldRect', () => {
	it('maps a neutral view to the stage centred on the world origin', () => {
		expect(viewportWorldRect(NEUTRAL, STAGE)).toEqual({
			minX: -200,
			minY: -150,
			maxX: 200,
			maxY: 150
		});
	});

	it('halves the world extent as the scale doubles, and pans against the world', () => {
		expect(viewportWorldRect({ panX: -100, panY: 60, scale: 2 }, STAGE)).toEqual({
			minX: -50,
			minY: -105,
			maxX: 150,
			maxY: 45
		});
	});
});

describe('rectContainsRect', () => {
	it('counts a touching edge as inside', () => {
		const outer: WorldRect = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

		expect(rectContainsRect(outer, { minX: 0, minY: 0, maxX: 10, maxY: 10 })).toBe(true);
	});

	it('rejects a rect that pokes out on one side', () => {
		const outer: WorldRect = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

		expect(rectContainsRect(outer, { minX: 0, minY: 0, maxX: 10.5, maxY: 10 })).toBe(false);
	});
});

describe('minimalRevealView', () => {
	it('does nothing when the target circle and its margin already fit on screen', () => {
		expect(reveal(NEUTRAL, { center: { x: 0, y: 0 }, radius: 50 }, { margin: 20 })).toBeNull();
	});

	it('does nothing when the padded circle exactly touches the viewport edge', () => {
		expect(reveal(NEUTRAL, { center: { x: 100, y: 0 }, radius: 80 }, { margin: 20 })).toBeNull();
	});

	it('moves when the margin is what pushes the circle off screen', () => {
		const target: RevealCircle = { center: { x: 150, y: 0 }, radius: 50 };

		expect(reveal(NEUTRAL, target)).toBeNull();
		expect(reveal(NEUTRAL, target, { margin: 25 })).not.toBeNull();
	});

	it('frames the union of the old viewport and a target off to the right', () => {
		// Union spans x ∈ [-200, 550] (750 wide) and y ∈ [-150, 150], so width is
		// what binds: scale 400/750, centred at x = 175 with the vertical untouched.
		const next = reveal(NEUTRAL, { center: { x: 500, y: 0 }, radius: 50 });

		expect(next?.scale).toBeCloseTo(400 / 750, 10);
		expect(next?.panX).toBeCloseTo(-175 * (400 / 750), 8);
		expect(next?.panY).toBeCloseTo(0, 10);
	});

	it('keeps everything already visible visible, target included, in every direction', () => {
		const before = viewportWorldRect(NEUTRAL, STAGE);
		const targets: RevealCircle[] = [
			{ center: { x: 900, y: 0 }, radius: 60 }, // right
			{ center: { x: -900, y: 0 }, radius: 60 }, // left
			{ center: { x: 0, y: -700 }, radius: 60 }, // above
			{ center: { x: 0, y: 700 }, radius: 60 }, // below
			{ center: { x: 800, y: -600 }, radius: 60 } // diagonal
		];

		for (const target of targets) {
			const next = reveal(NEUTRAL, target, { margin: 30 });
			expect(next).not.toBeNull();
			const after = viewportWorldRect(next as CameraViewState, STAGE);
			expect(rectContainsRect(after, before)).toBe(true);
			expect(rectContainsRect(after, circleRect(target, 30))).toBe(true);
		}
	});

	it('pans on one axis only when the target is straight above', () => {
		const next = reveal(NEUTRAL, { center: { x: 0, y: -500 }, radius: 50 });

		expect(next?.panX).toBeCloseTo(0, 10);
		expect(next?.panY).toBeGreaterThan(0);
	});

	it('only ever zooms out, never in', () => {
		const view: CameraViewState = { panX: 0, panY: 0, scale: 2 };
		const next = reveal(view, { center: { x: 400, y: 300 }, radius: 40 });

		expect(next?.scale).toBeLessThan(view.scale);
	});

	it('barely zooms out for a target that only just left the screen', () => {
		const next = reveal(NEUTRAL, { center: { x: 205, y: 0 }, radius: 1 });

		expect(next?.scale).toBeGreaterThan(0.98);
		expect(next?.scale).toBeLessThan(1);
	});

	it('never zooms in past the configured maximum, even from an over-zoomed view', () => {
		const view: CameraViewState = { panX: 0, panY: 0, scale: 10 };
		const next = reveal(view, { center: { x: 25, y: 0 }, radius: 1 });

		expect(next?.scale).toBe(DEFAULT_MAX_SCALE);
	});

	it('stops at the minimum scale and centres the union it cannot fit', () => {
		const view: CameraViewState = { panX: 0, panY: 0, scale: DEFAULT_MIN_SCALE };
		const target: RevealCircle = { center: { x: 100000, y: 0 }, radius: 50 };
		const next = reveal(view, target);
		const unionMinX = viewportWorldRect(view, STAGE).minX;
		const unionMaxX = circleRect(target).maxX;

		expect(next?.scale).toBe(DEFAULT_MIN_SCALE);
		expect(next?.panX).toBeCloseTo((-(unionMinX + unionMaxX) / 2) * DEFAULT_MIN_SCALE, 6);
	});
});

describe('cameraViewAt', () => {
	const from: CameraViewState = { panX: 20, panY: -10, scale: 1 };
	const to: CameraViewState = { panX: -50, panY: 20, scale: 0.5 };
	const tween = { from, to, startedAtMs: 1000, durationMs: 600 };

	it('starts exactly at the departing camera', () => {
		expect(cameraViewAt(tween, 1000)).toEqual(from);
	});

	it('lands exactly on the arriving camera', () => {
		expect(cameraViewAt(tween, 1600)).toEqual(to);
	});

	it('clamps a timestamp past the end to the arriving camera', () => {
		expect(cameraViewAt(tween, 9999)).toEqual(to);
	});

	it('jumps straight to the arriving camera when the duration is zero', () => {
		expect(cameraViewAt({ ...tween, durationMs: 0 }, 1000)).toEqual(to);
	});

	it('travels the world centre at an eased rate rather than lerping pan', () => {
		// easeInOut(0.5) is 0.5, so the midpoint sits at the average of the two
		// world centres (-20 and 100; 10 and -40) at the average scale — pan is
		// then derived from that centre rather than interpolated on its own.
		expect(cameraViewAt(tween, 1300)).toEqual({ panX: -30, panY: 11.25, scale: 0.75 });
	});

	it('re-aims mid-flight without restarting the easing', () => {
		// What the import reveal does every frame: same `from` and `startedAtMs`,
		// a `to` that moved because the arrival is still settling. The camera keeps
		// its place in the flight and simply heads somewhere slightly different.
		const moved: CameraViewState = { panX: -90, panY: 20, scale: 0.5 };
		const reaimed = cameraViewAt({ ...tween, to: moved }, 1300);

		expect(reaimed.scale).toBe(0.75);
		expect(reaimed.panX).toBeLessThan(-30);
		expect(cameraViewAt({ ...tween, to: moved }, 1600)).toEqual(moved);
	});
});

describe('revealPursuitStep', () => {
	/** Departs from the neutral camera, flies 1000→1600ms, gives up at 2800ms. */
	const PURSUIT: RevealPursuit = {
		from: NEUTRAL,
		viewport: viewportWorldRect(NEUTRAL, STAGE),
		stage: STAGE,
		startedAtMs: 1000,
		durationMs: 600,
		deadlineMs: 2800,
		marginRadiusFactor: 0
	};
	/** An arrival off to the right of everything the reader can see. */
	const OFF_RIGHT: RevealCircle = { center: { x: 500, y: 0 }, radius: 50 };

	function step(
		target: RevealCircle,
		options: {
			previousTarget?: RevealCircle;
			nowMs?: number;
			instant?: boolean;
			restEpsilon?: number;
		} = {}
	) {
		return revealPursuitStep({
			pursuit: options.instant === undefined ? PURSUIT : { ...PURSUIT, instant: options.instant },
			target,
			previousTarget: options.previousTarget ?? target,
			nowMs: options.nowMs ?? 1300,
			restEpsilon: options.restEpsilon ?? 0.25
		});
	}

	it('eases partway toward the goal while the flight is in progress', () => {
		const goal = reveal(NEUTRAL, OFF_RIGHT) as CameraViewState;
		const view = step(OFF_RIGHT).view as CameraViewState;

		expect(view.scale).toBeLessThan(NEUTRAL.scale);
		expect(view.scale).toBeGreaterThan(goal.scale);
	});

	it('lands exactly on the goal once the flight time is up', () => {
		const goal = reveal(NEUTRAL, OFF_RIGHT);

		expect(step(OFF_RIGHT, { nowMs: 1600 }).view).toEqual(goal);
	});

	it('re-aims at an arrival that drifted further away since the last frame', () => {
		// The whole point of the pursuit: the same frame of the same flight aims
		// somewhere further out because the layout carried the node further out.
		const drifted: RevealCircle = { center: { x: 900, y: 0 }, radius: 50 };
		const held = step(OFF_RIGHT).view as CameraViewState;
		const chased = step(drifted, { previousTarget: OFF_RIGHT }).view as CameraViewState;

		expect(chased.scale).toBeLessThan(held.scale);
		expect(chased.panX).toBeLessThan(held.panX);
	});

	it('reports the goal it would land on, so the caller can correct at the end', () => {
		expect(step(OFF_RIGHT).goal).toEqual(reveal(NEUTRAL, OFF_RIGHT));
	});

	it('leaves the camera alone when the arrival is already in the reader’s view', () => {
		const inView = step({ center: { x: 0, y: 0 }, radius: 50 });

		expect(inView.view).toBeNull();
		expect(inView.goal).toBeNull();
	});

	it('honours the margin factor, so a circle that only just fits still moves', () => {
		const target: RevealCircle = { center: { x: 150, y: 0 }, radius: 50 };
		const bare = revealPursuitStep({
			pursuit: PURSUIT,
			target,
			previousTarget: target,
			nowMs: 1300,
			restEpsilon: 0.25
		});
		const padded = revealPursuitStep({
			pursuit: { ...PURSUIT, marginRadiusFactor: 0.5 },
			target,
			previousTarget: target,
			nowMs: 1300,
			restEpsilon: 0.25
		});

		expect(bare.goal).toBeNull();
		expect(padded.goal).not.toBeNull();
	});

	it('moves no camera under reduced motion, but still names the landing view', () => {
		const instant = step(OFF_RIGHT, { instant: true });

		expect(instant.view).toBeNull();
		expect(instant.goal).toEqual(reveal(NEUTRAL, OFF_RIGHT));
	});

	it('is not done while the flight is still running, even at rest', () => {
		expect(step(OFF_RIGHT, { nowMs: 1100 }).done).toBe(false);
	});

	it('is not done after the flight while the arrival is still moving', () => {
		const drifted: RevealCircle = { center: { x: 505, y: 0 }, radius: 50 };

		expect(step(drifted, { previousTarget: OFF_RIGHT, nowMs: 1700 }).done).toBe(false);
	});

	it('is done once the flight is over and the arrival has come to rest', () => {
		const barelyMoved: RevealCircle = { center: { x: 500.1, y: 0 }, radius: 50 };

		expect(step(barelyMoved, { previousTarget: OFF_RIGHT, nowMs: 1700 }).done).toBe(true);
	});

	it('counts a still-growing radius as movement, not rest', () => {
		const growing: RevealCircle = { center: { x: 500, y: 0 }, radius: 58 };

		expect(step(growing, { previousTarget: OFF_RIGHT, nowMs: 1700 }).done).toBe(false);
	});

	it('gives up at the hard cap even while the arrival is still drifting', () => {
		const drifted: RevealCircle = { center: { x: 900, y: 0 }, radius: 50 };

		expect(step(drifted, { previousTarget: OFF_RIGHT, nowMs: 2800 }).done).toBe(true);
	});
});
