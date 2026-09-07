import { describe, expect, it } from 'vitest';
import {
	holdsMarkedScroller,
	nestedWheelDecision,
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

/** No image under the cursor: the plain case each test varies from. */
function input(patch: Partial<NestedWheelInput> = {}): NestedWheelInput {
	return {
		chain: [candidate()],
		deltaY: DOWN,
		descendableImageUnderCursor: false,
		...patch
	};
}

/** Scrolls down and zooms out. */
const DOWN = 120;
/** Scrolls up, zooms in, and at the end of the scroll may descend. */
const UP = -120;

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

	describe('at the bottom, where the wheel used to scrub out of focus', () => {
		it('never leaves focus, however many wheels arrive', () => {
			// The rule the reader asked for: once inside a scrollable surface the
			// wheel stays there, and Close (or Escape) is what leaves.
			const wheel = input({ chain: [atBottom], deltaY: DOWN });
			for (let repeat = 0; repeat < 5; repeat += 1) {
				expect(nestedWheelDecision(wheel)).toBe('swallow');
			}
		});

		it('is not escaped by a descendable image either', () => {
			// The image only matters where a zoom-in would descend, which is the
			// other end of the scroll.
			expect(
				nestedWheelDecision(
					input({ chain: [atBottom], deltaY: DOWN, descendableImageUnderCursor: true })
				)
			).toBe('swallow');
		});

		it('still scrolls the other way, so the bottom is not a dead end', () => {
			expect(nestedWheelDecision(input({ chain: [atBottom], deltaY: UP }))).toBe('scroll');
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
