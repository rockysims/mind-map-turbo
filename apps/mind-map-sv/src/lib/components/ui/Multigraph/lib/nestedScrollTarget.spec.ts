import { describe, expect, it } from 'vitest';
import { yieldsToNestedScroll, type NestedScrollCandidate } from './nestedScrollTarget';

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

const DOWN = 120;
const UP = -120;

describe('yieldsToNestedScroll', () => {
	it('yields when a marked scroller has room in the wheel direction', () => {
		expect(yieldsToNestedScroll([candidate()], DOWN)).toBe(true);
		expect(yieldsToNestedScroll([candidate()], UP)).toBe(true);
	});

	it('declines with nothing above the target', () => {
		expect(yieldsToNestedScroll([], DOWN)).toBe(false);
	});

	it('declines for an unmarked scroller, however scrollable', () => {
		expect(yieldsToNestedScroll([candidate({ marked: false })], DOWN)).toBe(false);
	});

	it('declines for a marked element that is not a scroll container', () => {
		for (const overflowY of ['visible', 'hidden', 'clip']) {
			expect(yieldsToNestedScroll([candidate({ overflowY })], DOWN)).toBe(false);
		}
		expect(yieldsToNestedScroll([candidate({ overflowY: 'scroll' })], DOWN)).toBe(true);
	});

	it('hands a wheel-out back to the world once the scroller is at its top', () => {
		// The gesture that exits focus has to keep working from the top of the
		// workbench, which is where the reader is when they want out.
		expect(yieldsToNestedScroll([candidate({ scrollTop: 0 })], UP)).toBe(false);
		expect(yieldsToNestedScroll([candidate({ scrollTop: 0 })], DOWN)).toBe(true);
	});

	it('hands a wheel-in back to the world once the scroller is at its bottom', () => {
		const atBottom = candidate({ scrollTop: 400, clientHeight: 200, scrollHeight: 600 });
		expect(yieldsToNestedScroll([atBottom], DOWN)).toBe(false);
		expect(yieldsToNestedScroll([atBottom], UP)).toBe(true);
	});

	it('treats a sub-pixel shortfall at the bottom as the bottom', () => {
		// Fractional layout heights leave `scrollTop + clientHeight` a hair under
		// `scrollHeight` at the very end of the scroll.
		const nearlyBottom = candidate({ scrollTop: 399.6, clientHeight: 200, scrollHeight: 600 });
		expect(yieldsToNestedScroll([nearlyBottom], DOWN)).toBe(false);
	});

	it('declines when content fits, so an unscrollable marked element zooms', () => {
		const fits = candidate({ scrollTop: 0, clientHeight: 600, scrollHeight: 600 });
		expect(yieldsToNestedScroll([fits], DOWN)).toBe(false);
		expect(yieldsToNestedScroll([fits], UP)).toBe(false);
	});

	it('declines a zero delta, which has no direction to scroll in', () => {
		expect(yieldsToNestedScroll([candidate()], 0)).toBe(false);
	});

	it('passes over an exhausted scroller to a further one that can still move', () => {
		const chain = [
			candidate({ scrollTop: 400, clientHeight: 200, scrollHeight: 600 }),
			candidate({ scrollTop: 0, clientHeight: 300, scrollHeight: 900 })
		];
		expect(yieldsToNestedScroll(chain, DOWN)).toBe(true);
	});

	it('ignores unmarked ancestors between the target and a marked scroller', () => {
		const chain = [
			candidate({ marked: false, overflowY: 'visible' }),
			candidate({ marked: false, overflowY: 'visible' }),
			candidate()
		];
		expect(yieldsToNestedScroll(chain, DOWN)).toBe(true);
	});
});
