import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from '$lib/appConfig';
import {
	holdsMarkedScroller,
	nestedWheelDecision,
	resistedExitDelta,
	type NestedScrollCandidate,
	type NestedWheelInput
} from './nestedScrollTarget';

function candidate(patch: Partial<NestedScrollCandidate> = {}): NestedScrollCandidate {
	return {
		overflowY: 'auto',
		scrollTop: 50,
		clientHeight: 200,
		scrollHeight: 600,
		marked: true,
		...patch
	};
}

/** A long quiet gap and no image: the plain case each test varies from. */
function input(patch: Partial<NestedWheelInput> = {}): NestedWheelInput {
	return {
		chain: [candidate()],
		deltaY: DOWN,
		msSinceLastNestedScroll: 10_000,
		descendableImageUnderCursor: false,
		...patch
	};
}

/** Scrolls down, zooms out, and at the end of the scroll leaves focus. */
const DOWN = 120;
/** Scrolls up, zooms in, and at the end of the scroll may descend. */
const UP = -120;

const PAUSE_MS = APP_CONFIG.multigraph.focus.scrollerExitPauseMs;

const atTop = candidate({ scrollTop: 0 });
const atBottom = candidate({ scrollTop: 400, clientHeight: 200, scrollHeight: 600 });

describe('nestedWheelDecision', () => {
	it('scrolls while a marked scroller has room in the wheel direction', () => {
		expect(nestedWheelDecision(input({ deltaY: DOWN }))).toBe('scroll');
		expect(nestedWheelDecision(input({ deltaY: UP }))).toBe('scroll');
	});

	it('zooms with nothing above the target', () => {
		expect(nestedWheelDecision(input({ chain: [] }))).toBe('zoom');
	});

	it('zooms for an unmarked scroller, however scrollable', () => {
		expect(nestedWheelDecision(input({ chain: [candidate({ marked: false })] }))).toBe('zoom');
	});

	it('zooms for a marked element that is not a scroll container', () => {
		for (const overflowY of ['visible', 'hidden', 'clip']) {
			expect(nestedWheelDecision(input({ chain: [candidate({ overflowY })] }))).toBe('zoom');
		}
		expect(nestedWheelDecision(input({ chain: [candidate({ overflowY: 'scroll' })] }))).toBe(
			'scroll'
		);
	});

	it('zooms when the content fits, so an unscrollable marked element is not a scroller', () => {
		const fits = candidate({ scrollTop: 0, clientHeight: 600, scrollHeight: 600 });
		expect(nestedWheelDecision(input({ chain: [fits], deltaY: DOWN }))).toBe('zoom');
		expect(nestedWheelDecision(input({ chain: [fits], deltaY: UP }))).toBe('zoom');
	});

	it('zooms a zero delta, which has no direction to scroll in', () => {
		expect(nestedWheelDecision(input({ deltaY: 0 }))).toBe('zoom');
	});

	it('passes over an exhausted scroller to a further one that can still move', () => {
		expect(nestedWheelDecision(input({ chain: [atBottom, candidate({ scrollTop: 0 })] }))).toBe(
			'scroll'
		);
	});

	it('ignores unmarked ancestors between the target and a marked scroller', () => {
		const chain = [
			candidate({ marked: false, overflowY: 'visible' }),
			candidate({ marked: false, overflowY: 'visible' }),
			candidate()
		];
		expect(nestedWheelDecision(input({ chain }))).toBe('scroll');
	});

	it('treats a sub-pixel shortfall at the bottom as the bottom', () => {
		// Fractional layout heights leave `scrollTop + clientHeight` a hair under
		// `scrollHeight` at the very end of the scroll.
		const nearlyBottom = candidate({ scrollTop: 399.6, clientHeight: 200, scrollHeight: 600 });
		expect(nestedWheelDecision(input({ chain: [nearlyBottom], deltaY: DOWN }))).not.toBe('scroll');
	});

	describe('at the top, where the wheel would zoom in', () => {
		it('swallows rather than magnifying a surface the reader is reading', () => {
			expect(nestedWheelDecision(input({ chain: [atTop], deltaY: UP }))).toBe('swallow');
		});

		it('zooms when a descendable image is under the cursor, which opens it', () => {
			expect(
				nestedWheelDecision(
					input({ chain: [atTop], deltaY: UP, descendableImageUnderCursor: true })
				)
			).toBe('zoom');
		});

		it('still scrolls the other way, so the top is not a dead end', () => {
			expect(nestedWheelDecision(input({ chain: [atTop], deltaY: DOWN }))).toBe('scroll');
		});
	});

	describe('at the bottom, where the wheel would scrub out of focus', () => {
		it('leaves focus once the reader has paused', () => {
			expect(
				nestedWheelDecision(
					input({ chain: [atBottom], deltaY: DOWN, msSinceLastNestedScroll: PAUSE_MS })
				)
			).toBe('zoom');
		});

		it('swallows the momentum tail of the scroll that got here', () => {
			expect(
				nestedWheelDecision(
					input({ chain: [atBottom], deltaY: DOWN, msSinceLastNestedScroll: PAUSE_MS - 1 })
				)
			).toBe('swallow');
		});

		it('takes the pause as a parameter, so a caller can pin it', () => {
			const wheel = input({ chain: [atBottom], deltaY: DOWN, msSinceLastNestedScroll: 50 });
			expect(nestedWheelDecision(wheel, 40)).toBe('zoom');
			expect(nestedWheelDecision(wheel, 60)).toBe('swallow');
		});

		it('does not make a descendable image an escape from the pause', () => {
			// The image only matters where a zoom-in would descend, which is the
			// other end of the scroll.
			expect(
				nestedWheelDecision(
					input({
						chain: [atBottom],
						deltaY: DOWN,
						msSinceLastNestedScroll: 0,
						descendableImageUnderCursor: true
					})
				)
			).toBe('swallow');
		});

		it('still scrolls the other way however recent the last scroll', () => {
			expect(
				nestedWheelDecision(input({ chain: [atBottom], deltaY: UP, msSinceLastNestedScroll: 0 }))
			).toBe('scroll');
		});
	});
});

describe('holdsMarkedScroller', () => {
	// The caller reads this to decide whether a wheel is worth a hit test under
	// the cursor at all, so it has to answer for itself as well as inside the
	// decision above.
	it('is true for a marked scroll container with something to scroll', () => {
		expect(holdsMarkedScroller([atTop])).toBe(true);
		expect(holdsMarkedScroller([atBottom])).toBe(true);
	});

	it('is false with nothing marked, nothing scrollable, or nothing at all', () => {
		expect(holdsMarkedScroller([])).toBe(false);
		expect(holdsMarkedScroller([candidate({ marked: false })])).toBe(false);
		expect(holdsMarkedScroller([candidate({ overflowY: 'hidden' })])).toBe(false);
		expect(
			holdsMarkedScroller([candidate({ scrollTop: 0, clientHeight: 600, scrollHeight: 600 })])
		).toBe(false);
	});

	it('finds the scroller anywhere in the chain', () => {
		expect(holdsMarkedScroller([candidate({ marked: false }), atBottom])).toBe(true);
	});
});

describe('resistedExitDelta', () => {
	it('divides the delta when the chain holds a marked scroller', () => {
		expect(resistedExitDelta(120, [atBottom], 2)).toBe(60);
		expect(resistedExitDelta(120, [atBottom], 4)).toBe(30);
	});

	it('leaves the delta alone with no marked scroller in the chain', () => {
		expect(resistedExitDelta(120, [], 2)).toBe(120);
		expect(resistedExitDelta(120, [candidate({ marked: false })], 2)).toBe(120);
	});

	it('leaves the delta alone for a marked box whose content fits', () => {
		const fits = candidate({ scrollTop: 0, clientHeight: 600, scrollHeight: 600 });
		expect(resistedExitDelta(120, [fits], 2)).toBe(120);
	});

	it('resists from either end of the scroll, since the exit is one gesture', () => {
		expect(resistedExitDelta(120, [atTop], 2)).toBe(60);
	});

	it('defaults to the configured resistance', () => {
		expect(resistedExitDelta(120, [atBottom])).toBe(
			120 / APP_CONFIG.multigraph.focus.scrollerExitResistance
		);
	});

	it('ignores a resistance of zero or less rather than dividing by it', () => {
		expect(resistedExitDelta(120, [atBottom], 0)).toBe(120);
		expect(resistedExitDelta(120, [atBottom], -2)).toBe(120);
	});
});
