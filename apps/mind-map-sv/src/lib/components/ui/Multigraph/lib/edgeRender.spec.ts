import { describe, expect, it } from 'vitest';
import { trimSegmentToNodeBorders } from './edgeRender';

describe('trimSegmentToNodeBorders', () => {
	it('trims a horizontal segment to both node borders by default', () => {
		expect(trimSegmentToNodeBorders({ x: 0, y: 0 }, { x: 300, y: 0 }, 50, 75)).toEqual({
			source: { x: 50, y: 0 },
			target: { x: 225, y: 0 }
		});
	});

	it('can keep a gap on only the target end for arrowheads', () => {
		expect(trimSegmentToNodeBorders({ x: 10, y: 10 }, { x: 10, y: 210 }, 20, 30, 0, 5)).toEqual({
			source: { x: 10, y: 30 },
			target: { x: 10, y: 175 }
		});
	});

	it('keeps very short segments non-negative in length', () => {
		const trimmed = trimSegmentToNodeBorders({ x: 0, y: 0 }, { x: 10, y: 0 }, 100, 100);

		expect(trimmed.source).toEqual({ x: 5, y: 0 });
		expect(trimmed.target).toEqual({ x: 5, y: 0 });
	});

	it('leaves a zero-length segment unchanged', () => {
		expect(trimSegmentToNodeBorders({ x: 1, y: 2 }, { x: 1, y: 2 }, 10, 10)).toEqual({
			source: { x: 1, y: 2 },
			target: { x: 1, y: 2 }
		});
	});
});
