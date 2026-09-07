import { describe, expect, it } from 'vitest';
import { pinScrollToOrigin } from './pinScroll';

/**
 * A box that records every write, so "put it back" and "leave it alone" are
 * two different observations rather than the same one read twice.
 */
function countingBox(scrollTop: number, scrollLeft: number) {
	const writes: string[] = [];
	let top = scrollTop;
	let left = scrollLeft;
	return {
		writes,
		box: {
			get scrollTop() {
				return top;
			},
			set scrollTop(value: number) {
				writes.push(`top=${value}`);
				top = value;
			},
			get scrollLeft() {
				return left;
			},
			set scrollLeft(value: number) {
				writes.push(`left=${value}`);
				left = value;
			}
		}
	};
}

describe('pinScrollToOrigin', () => {
	it('puts a scrolled box back at its origin on both axes', () => {
		const box = { scrollTop: 1863, scrollLeft: 42 };
		pinScrollToOrigin(box);
		expect(box).toEqual({ scrollTop: 0, scrollLeft: 0 });
	});

	it('writes only the axis that is off origin', () => {
		const scrolled = countingBox(1863, 0);
		pinScrollToOrigin(scrolled.box);
		expect(scrolled.writes).toEqual(['top=0']);

		const shifted = countingBox(0, 240);
		pinScrollToOrigin(shifted.box);
		expect(shifted.writes).toEqual(['left=0']);
	});

	// The handler runs on every `scroll` the box fires, including the one its own
	// correction raises: a write there is how a reset loops forever.
	it('writes nothing at all when the box is already at its origin', () => {
		const settled = countingBox(0, 0);
		pinScrollToOrigin(settled.box);
		expect(settled.writes).toEqual([]);
	});

	// The caller is an event handler and its target is whatever the DOM handed
	// it, which for a listener on a detached element is nothing.
	it('does nothing when there is no box', () => {
		expect(() => pinScrollToOrigin(null)).not.toThrow();
		expect(() => pinScrollToOrigin(undefined)).not.toThrow();
	});

	// A negative position is not a thing a browser reports, but the guard is
	// "not at the origin" rather than "past it", so it is corrected too.
	it('corrects a position on the wrong side of the origin', () => {
		const box = { scrollTop: -12, scrollLeft: -3 };
		pinScrollToOrigin(box);
		expect(box).toEqual({ scrollTop: 0, scrollLeft: 0 });
	});
});
